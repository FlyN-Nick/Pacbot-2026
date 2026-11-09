import asyncio
from pathlib import Path

import numpy as np
import torch

from gameState import GameState, GameModes, Directions
from debugServer import DebugServer
from time import time
import low_level
from low_level import send_direction, unstuck

from pacbot_rl_models import models as _dqn_models

# Observation / action constants (from pacbot_rs_2/variables.rs and game_modes.rs)
OBS_SHAPE = torch.Size([17, 28, 31])
NUM_ACTIONS = 5
GHOST_FRIGHT_STEPS = 40
COMBO_MULTIPLIER = 200
PELLET_POINTS = 10
SUPER_PELLET_POINTS = 50
FRUIT_POINTS = 100
CHASE_DURATION = 180  # GameMode::CHASE.duration()
LAST_REWARD = 3_000   # env.rs: bonus for clearing the board, shown on the last pellet

# Game ticks per Pacman action. env.rs trains with NORMAL_TICKS_PER_STEP = 8,
# which is also the simulation cadence below (one move per 1/3 s at 24 fps).
TICKS_PER_STEP = 8

# env.rs are_ghosts_close(): summed Manhattan distance to the ghosts below this
GHOSTS_CLOSE_TOTAL_DISTANCE = 30

# Environment rule versions this module can reproduce (LATEST_ENV_VERSION in
# env.rs). Checkpoints record theirs as "env_version"; older ones are version 1.
SUPPORTED_ENV_VERSIONS = (1, 2)

SUPER_PELLET_ROWS = frozenset({3, 23})
SUPER_PELLET_COLS = frozenset({1, 26})

# Outside purgatory, training hands control to this fixed model
# (curc-pacbot-rl src/utils.py step_env_once).
SUPER_PELLET_MODEL_PATH = (Path(__file__).resolve().parent.parent / 'curc-pacbot-rl'
                           / 'src' / 'checkpoints_known' / 'superpelletmode.safetensors')


def _is_super_pellet(row: int, col: int) -> bool:
    return row in SUPER_PELLET_ROWS and col in SUPER_PELLET_COLS


def build_obs(g: GameState, ignore_super_pellets: bool) -> np.ndarray:
    '''
    Observation matching PacmanGym::obs in curc-pacbot-rl/pacbot_rs/src/env.rs,
    shape (17, 28, 31) indexed (channel, col, 30 - row).
    `ignore_super_pellets` mirrors PacmanGymConfiguration.obs_ignore_super_pellets.
    '''
    obs = np.zeros((17, 28, 31), dtype=np.float32)
    last_pellet = g.numPellets() == 1

    # Channels 0 (walls) and 1 (rewards)
    for row in range(31):
        obs_row = 30 - row
        for col in range(28):
            obs[0, col, obs_row] = float(g.wallAt(row, col))
            if g.pelletAt(row, col):
                if _is_super_pellet(row, col):
                    pts = 0 if ignore_super_pellets else SUPER_PELLET_POINTS
                else:
                    pts = PELLET_POINTS
                if last_pellet:
                    pts += LAST_REWARD
            elif g.fruitSteps > 0 and g.fruitLoc.row == row and g.fruitLoc.col == col:
                pts = FRUIT_POINTS
            else:
                pts = 0
            obs[1, col, obs_row] = pts / COMBO_MULTIPLIER

    # Channels 2-3: Pacman. Training puts the current position in both (the
    # last-position channel is disabled in env.rs).
    pr, pc = g.pacmanLoc.row, g.pacmanLoc.col
    if 0 <= pr < 31 and 0 <= pc < 28:
        obs[2, pc, 30 - pr] = 1.0
        obs[3, pc, 30 - pr] = 1.0

    # Channels 4-7: ghosts; 8-11: "last" ghost positions, which env.rs also
    # fills with the current positions; 12-14: mode state at each ghost
    for i, ghost in enumerate(g.ghosts):
        gr, gc = ghost.location.row, ghost.location.col
        if not (0 <= gr < 31 and 0 <= gc < 28):
            continue
        gobs = 30 - gr
        obs[4 + i, gc, gobs] = 1.0
        obs[8 + i, gc, gobs] = 1.0
        if ghost.isFrightened():
            obs[14, gc, gobs] = ghost.frightSteps / GHOST_FRIGHT_STEPS
            # env.rs adds the combo value here without dividing by COMBO_MULTIPLIER
            obs[1, gc, gobs] += 2 ** g.ghostCombo
        else:
            ch = 13 if g.gameMode == GameModes.CHASE else 12
            obs[ch, gc, gobs] = g.modeSteps / CHASE_DURATION

    # Channel 15: Pacman speed relative to ghost updates
    obs[15, :, :] = TICKS_PER_STEP / g.updatePeriod

    # Channel 16: super pellet locations
    if not ignore_super_pellets:
        for row in SUPER_PELLET_ROWS:
            for col in SUPER_PELLET_COLS:
                if g.pelletAt(row, col):
                    obs[16, col, 30 - row] = 1.0

    return obs


# Order matches the Action enum: Stay, Down, Up, Left, Right
_ACTION_DELTAS = [(0, 0), (1, 0), (-1, 0), (0, -1), (0, 1)]


def action_mask(g: GameState) -> list[bool]:
    '''PacmanGym::action_mask: True for moves that don't hit a wall.'''
    row, col = g.pacmanLoc.row, g.pacmanLoc.col
    return [True] + [not g.wallAt(row + dr, col + dc) for dr, dc in _ACTION_DELTAS[1:]]


def purgatory_action_mask(g: GameState) -> list[bool]:
    '''PacmanGym::purgatory_action_mask: also forbids stepping onto super pellet tiles.'''
    row, col = g.pacmanLoc.row, g.pacmanLoc.col
    return [True] + [not g.wallAt(row + dr, col + dc) and not _is_super_pellet(row + dr, col + dc)
                     for dr, dc in _ACTION_DELTAS[1:]]


def ghosts_close(g: GameState, env_version: int) -> bool:
    '''PacmanGym::are_ghosts_close under the given environment version.'''
    pr, pc = g.pacmanLoc.row, g.pacmanLoc.col
    distances = [(abs(pr - gh.location.row) + abs(pc - gh.location.col), gh) for gh in g.ghosts]
    if env_version == 1:
        # Version 1 summed in an i8 that wrapped at 128, so totals of 128 or
        # more (e.g. unspawned ghosts at (32, 32)) counted as close.
        total = sum(d for d, _ in distances)
        return (total + 128) % 256 - 128 < GHOSTS_CLOSE_TOTAL_DISTANCE
    if env_version == 2:
        # Only ghosts on the board count; with none on the board, nothing is close.
        on_board = [d for d, gh in distances if gh.location.row != 32 and gh.location.col != 32]
        return bool(on_board) and sum(on_board) < GHOSTS_CLOSE_TOTAL_DISTANCE
    raise ValueError(f'Unsupported environment version {env_version}')


def is_purgatory(g: GameState, env_version: int) -> bool:
    '''
    True when the trained purgatory model acts, as in utils.step_env_once:
    no ghost is frightened and the ghosts are not close.
    '''
    return not ghosts_close(g, env_version) and not any(gh.isFrightened() for gh in g.ghosts)

# DQN action index → Pacbot Directions enum
# Rust Action enum: Stay=0, Down=1, Up=2, Left=3, Right=4
_ACTION_TO_DIR = [
    Directions.NONE,   # 0: Stay
    Directions.DOWN,   # 1: Down
    Directions.UP,     # 2: Up
    Directions.LEFT,   # 3: Left
    Directions.RIGHT,  # 4: Right
]


HYBRID_GHOST_RADIUS = 3


class DQNDecisionModule:
    '''
    Decision module that uses a pretrained DQN to select Pacbot actions.
    Drop-in replacement for DecisionModule — exposes the same decisionLoop().
    '''

    def __init__(self, state: GameState, checkpoint_path: str, log: bool = False,
                 hybrid_mode: bool = False, force_no_bot: bool = False) -> None:
        self.state = state
        self.log = log
        self.hybrid_mode = hybrid_mode
        self.force_no_bot = force_no_bot
        self.device = torch.device(
            'mps' if torch.backends.mps.is_available()
            else 'cuda' if torch.cuda.is_available()
            else 'cpu'
        )
        self._using_astar: bool = False
        self._load_model(checkpoint_path)
        self._load_super_pellet_model(SUPER_PELLET_MODEL_PATH)

        if hybrid_mode:
            from decisionModule import DecisionModule
            self._astar = DecisionModule(state, log, hybrid_mode=True)
            print('[DQN] Hybrid mode enabled: falls back to A* when ghost within '
                  f'{HYBRID_GHOST_RADIUS} tiles')

    # ------------------------------------------------------------------
    # Model loading
    # ------------------------------------------------------------------

    def _load_model(self, checkpoint_path: str) -> None:
        loaded = torch.load(checkpoint_path, map_location='cpu', weights_only=False)
        self.env_version = int(loaded.get('env_version', 1))
        if self.env_version not in SUPPORTED_ENV_VERSIONS:
            raise ValueError(
                f'{checkpoint_path} was trained with environment version {self.env_version}, but '
                f'this bot only supports versions {SUPPORTED_ENV_VERSIONS}. Update dqn_module.py '
                f'to match curc-pacbot-rl/pacbot_rs/src/env.rs.')
        model_name: str = loaded.get('config', {}).get('model', 'QNetV2')
        model_class = getattr(_dqn_models, model_name)
        self.q_net = model_class(OBS_SHAPE, NUM_ACTIONS).to(self.device)
        self.q_net.load_state_dict(loaded['state_dict'])
        self.q_net.eval()
        print(f'[DQN] Loaded {model_name} (iter={loaded.get("iter_num","?")}, '
              f'env version {self.env_version}) on {self.device}')

    def _load_super_pellet_model(self, path: Path) -> None:
        from safetensors.torch import load_file
        self.super_q_net = _dqn_models.QNetV2(OBS_SHAPE, NUM_ACTIONS).to(self.device)
        self.super_q_net.load_state_dict(load_file(str(path)))
        self.super_q_net.eval()
        print(f'[DQN] Loaded super pellet model {path.name} on {self.device}')

    def _q_action(self, net: torch.nn.Module, obs: np.ndarray, mask: list[bool]) -> int:
        obs_t = torch.from_numpy(obs).unsqueeze(0).to(self.device)
        mask_t = torch.tensor(mask, dtype=torch.bool, device=self.device).unsqueeze(0)
        with torch.no_grad():
            q_vals = net(obs_t)        # (1, 5)
            q_vals[~mask_t] = -float('inf')
            return int(q_vals.argmax(dim=1).item())

    # ------------------------------------------------------------------
    # Hybrid-mode helper
    # ------------------------------------------------------------------

    SUPER_PELLET_CHASE_RADIUS = 20

    def _ghost_within_radius(self) -> bool:
        pr, pc = self.state.pacmanLoc.row, self.state.pacmanLoc.col
        for ghost in self.state.ghosts:
            if ghost.isFrightened():
                continue
            gr, gc = ghost.location.row, ghost.location.col
            if abs(pr - gr) + abs(pc - gc) <= HYBRID_GHOST_RADIUS:
                return True
        return False

    def _astar_targeting_nearby_super_pellet(self) -> bool:
        """Return True if A*'s current destination is a super pellet within 20 tiles."""
        dest = getattr(self._astar, 'destination', None)
        if dest is None:
            return False
        dr, dc = dest
        if dr not in SUPER_PELLET_ROWS or dc not in SUPER_PELLET_COLS:
            return False
        if not self.state.pelletAt(dr, dc):
            return False
        pr, pc = self.state.pacmanLoc.row, self.state.pacmanLoc.col
        return abs(pr - dr) + abs(pc - dc) <= self.SUPER_PELLET_CHASE_RADIUS

    def _any_ghost_frightened(self) -> bool:
        return any(ghost.isFrightened() for ghost in self.state.ghosts)

    # ------------------------------------------------------------------
    # Inference
    # ------------------------------------------------------------------

    def get_direction(self) -> Directions:
        any_frightened = self._any_ghost_frightened()
        stay_in_astar = self._using_astar and self._astar_targeting_nearby_super_pellet()
        if self.hybrid_mode and (self._ghost_within_radius() or any_frightened or stay_in_astar):
            if not self._using_astar:
                self._using_astar = True
                if any_frightened:
                    print('[DQN] Hybrid: switching to A* (super pellet eaten, ghosts frightened)')
                else:
                    print('[DQN] Hybrid: switching to A* (ghost nearby)')
            self._astar.avoidance_map.updateMap(self.state)
            self._astar.avoidance_map.show_map()
            return self._astar.get_direction()

        if self.hybrid_mode and self._using_astar:
            self._using_astar = False
            print('[DQN] Hybrid: switching to RL (no frightened ghosts, ghost far)')
            DebugServer.instance.reset_cell_colors()
            DebugServer.instance.clear_path()

        # Same split as training (utils.step_env_once): the trained model only
        # plays purgatory, with super pellets hidden and off limits; otherwise
        # the fixed super pellet model plays with the full observation.
        if is_purgatory(self.state, self.env_version):
            action = self._q_action(self.q_net, build_obs(self.state, ignore_super_pellets=True),
                                    purgatory_action_mask(self.state))
        else:
            action = self._q_action(self.super_q_net, build_obs(self.state, ignore_super_pellets=False),
                                    action_mask(self.state))

        return _ACTION_TO_DIR[action]

    # ------------------------------------------------------------------
    # Main async loop (same interface as DecisionModule.decisionLoop)
    #
    # Two modes depending on low_level.connected:
    #   connected     — act once per server state update (gate on currTicks)
    #   not connected — one move per TICKS_PER_STEP (8) ticks = 1/3 s at
    #                   24 fps; ghosts move every 12 ticks (0.5 s)
    #
    # Calls send_direction only when the output direction changes.
    # ------------------------------------------------------------------

    async def decisionLoop(self) -> None:
        last_ticks = -1
        last_direction = Directions.NONE
        stuck_pos = None
        stuck_start = None
        unstuck_triggered = False

        while self.state.isConnected():
            if low_level.connected:
                # Physical robot: act once per server state update
                await asyncio.sleep(0)
                if self.state.currTicks == last_ticks:
                    continue
                last_ticks = self.state.currTicks
            else:
                # Simulation: one move per TICKS_PER_STEP ticks at 24 fps (1/3 s),
                # the speed the observation's channel 15 reports
                await asyncio.sleep(TICKS_PER_STEP / 24)
                last_ticks = self.state.currTicks

            if self.state.gameMode == GameModes.PAUSED:
                continue

            if len(self.state.writeServerBuf):
                continue

            self.state.lock()

            direction = self.get_direction()
            pacman_pos = (self.state.pacmanLoc.row, self.state.pacmanLoc.col)

            if self.log:
                print(f'[DQN] pos=({self.state.pacmanLoc.row},{self.state.pacmanLoc.col}) '
                      f'dir={direction.name}')

            if direction != Directions.NONE:
                self.state.queueAction(1, direction)

            self.state.unlock()

            if direction != Directions.NONE:
                if pacman_pos != stuck_pos:
                    unstuck_triggered = False
                    stuck_pos = pacman_pos
                    stuck_start = time()
                elif not unstuck_triggered and (time() - stuck_start) >= 2.0:
                    unstuck_triggered = True
                    if not self.force_no_bot:
                        await unstuck(self.state, stuck_pos)
            else:
                stuck_pos = None
                stuck_start = None
                unstuck_triggered = False

            if direction != last_direction:
                if not self.force_no_bot:
                    send_direction(direction)
                last_direction = direction
