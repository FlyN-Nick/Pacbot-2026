'''
Gumbel AlphaZero search for the bot: plays each move by searching ahead in curc-pacbot-rl's
Rust game (pacbot_rs.gumbel_search, the search the evaluation reports use), started from the
live game state the server sent.

The server's game state bytes load straight into the Rust game (PacmanGym.set_game_state_bytes),
so the search simulates exactly the state the bot sees. The search plays the game it was trained
on: lives and level are set to the start's (training games end at the first lost life or a
cleared board), so after a lost life or on a later level it still searches the board as it is.

The number of simulations per move is fixed, or ("auto") scaled to the time Pacman takes to move
one cell: a share of that time (`budget`), divided by the measured time per simulation, within
[min_sims, max_sims]. Slower speeds leave time for more simulations, and the evaluations found
more simulations keep helping (128 -> 256 added ~400 points, mostly at the fast speeds).

Needs pacbot_rs (built from Rust source): uv sync --extra search
'''

from __future__ import annotations

import math
from time import perf_counter

import numpy as np
import torch

import pacbot_rs

# Game ticks per second (the server's GameFPS)
GAME_TICKS_PER_SECOND = 24

# Byte offsets in the server's game state message (server/game/serialize.go)
LEVEL_BYTE = 10
LIVES_BYTE = 11


class QNetworkEvaluator:
    '''
    A DQN as the search's evaluator (curc-pacbot-rl alphazero.QNetworkEvaluator): a state's value
    is its best legal Q value, and the policy's logits are the legal Q values over `temperature`.
    '''

    def __init__(self, q_net: torch.nn.Module, device: torch.device, temperature: float) -> None:
        self.q_net = q_net
        self.device = device
        self.temperature = temperature

    @torch.inference_mode()
    def __call__(self, obs: np.ndarray, legal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        q = self.q_net(torch.from_numpy(obs).to(self.device)).float()
        q = q.masked_fill(~torch.from_numpy(legal).to(self.device), -torch.inf)
        value = q.amax(dim=1)
        logits = (q / self.temperature).masked_fill(q == -torch.inf, 0.0)
        return value.cpu().numpy(), logits.cpu().numpy()


class PolicyValueEvaluator:
    '''An AlphaZero network (PVNetV2, PVNetV2Wide) as the search's evaluator.'''

    def __init__(self, net: torch.nn.Module, device: torch.device) -> None:
        self.net = net
        self.device = device

    @torch.inference_mode()
    def __call__(self, obs: np.ndarray, legal: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        logits, value = self.net(torch.from_numpy(obs).to(self.device))
        return value.float().cpu().numpy(), logits.float().cpu().numpy()


def search_settings(config: dict, alphazero: bool) -> dict:
    '''The checkpoint's units (discount, reward scale) and search constants, as the evaluations use.'''
    if alphazero:
        return {'discount': config['discount'], 'reward_scale': config['reward_scale'],
                'c_visit': config['c_visit'], 'c_scale': config['c_scale']}
    # A DQN: its own discount and reward scale, AlphaZero's default search constants
    return {'discount': config.get('discount_factor', 0.99), 'reward_scale': config.get('reward_scale', 0.02)}


class SearchPlanner:
    '''
    Picks moves by searching from the server's game state bytes. `sims` fixes the simulations
    per move; None scales them to Pacman's speed (see the module docstring).
    '''

    def __init__(self, evaluator, settings: dict, env_version: int, ghost_next_obs: bool = False,
                 sims: int | None = None, min_sims: int = 16, max_sims: int = 512,
                 budget: float = 0.5, seed: int = 0) -> None:
        if sims is not None and sims < 1:
            raise ValueError('sims must be at least 1')
        if not 1 <= min_sims <= max_sims:
            raise ValueError('need 1 <= min_sims <= max_sims')
        if not 0 < budget <= 1:
            raise ValueError('budget must be in (0, 1]')
        self.evaluator = evaluator
        self.settings = settings
        self.sims = sims
        self.min_sims = min_sims
        self.max_sims = max_sims
        self.budget = budget
        self.seed = seed
        self.obs_config = pacbot_rs.PacmanGymConfiguration({})  # single model: the full observation
        self.env = pacbot_rs.PacmanGym(self.obs_config)
        self.env.env_version = env_version
        self.env.ghost_next_obs = ghost_next_obs
        start = self.env.game_state_bytes()
        self._start_level, self._start_lives = start[LEVEL_BYTE], start[LIVES_BYTE]
        self._start = bytes(start)
        # Seconds per simulation, measured (an average over recent moves)
        self.seconds_per_sim: float | None = None
        self.last_sims = 0
        self.last_seconds = 0.0

    def warm_up(self, ticks_per_step: int = 8, sims: int = 32) -> float:
        '''Searches the start a few times (the first calls are slow) to measure a simulation's time.'''
        self._search(self._start, ticks_per_step, sims)
        self.seconds_per_sim = None  # the first call includes one-off setup
        for _ in range(2):
            self._search(self._start, ticks_per_step, sims)
        return self.seconds_per_sim

    def sims_for(self, ticks_per_step: float) -> int:
        '''Simulations for a move at this speed (game ticks per cell).'''
        if self.sims is not None:
            return self.sims
        if self.seconds_per_sim is None:
            return self.min_sims
        seconds = self.budget * ticks_per_step / GAME_TICKS_PER_SECOND
        return max(self.min_sims, min(self.max_sims, math.floor(seconds / self.seconds_per_sim)))

    def plan(self, state_bytes: bytes, ticks_per_step: float) -> int:
        '''The action (0 stay, 1 down, 2 up, 3 left, 4 right) to play in this server state.'''
        return self._search(state_bytes, ticks_per_step, self.sims_for(ticks_per_step))

    def _search(self, state_bytes: bytes, ticks_per_step: float, sims: int) -> int:
        state = bytearray(state_bytes)
        state[LEVEL_BYTE], state[LIVES_BYTE] = self._start_level, self._start_lives
        self.env.set_game_state_bytes(bytes(state), max(1, round(ticks_per_step)))
        config = pacbot_rs.GumbelConfig(num_simulations=sims, gumbel_scale=0.0, **self.settings)
        self.seed += 1
        t = perf_counter()
        action = int(pacbot_rs.gumbel_search([self.env], self.evaluator, config, self.obs_config, self.seed)[0][0])
        seconds = perf_counter() - t
        per_sim = seconds / sims
        self.seconds_per_sim = per_sim if self.seconds_per_sim is None else 0.8 * self.seconds_per_sim + 0.2 * per_sim
        self.last_sims, self.last_seconds = sims, seconds
        return action
