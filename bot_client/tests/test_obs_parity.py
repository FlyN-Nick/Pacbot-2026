'''
Checks that dqn_module builds exactly the observations, action masks, and
model choice that the RL training environment (curc-pacbot-rl's pacbot_rs)
produces for the same game state.

Each state goes through the competition server's wire format: the Rust
environment serializes it and the bot's GameState parses those bytes, as it
would a server update.

Needs the DQN extra and the Rust training environment (built from source):
    uv run --extra dqn --group parity python -m unittest tests.test_obs_parity
'''

import importlib.util
import random
import sys
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

try:
	import pacbot_rs
	HAVE_PACBOT_RS = hasattr(pacbot_rs.PacmanGym, 'game_state_bytes')
except ImportError:
	HAVE_PACBOT_RS = False

# Imported in setUpClass, so that other tests in the same run can check
# that the A* strategy never loads the DQN code.
HAVE_DQN = all(importlib.util.find_spec(m) for m in ('torch', 'pacbot_rl_models', 'safetensors'))
dqn_module = None
GameState = None

# Byte offsets in the server's game state message (see server/game/serialize.go)
GHOST_COMBO = 12
GHOST_LOC = [13 + 4 * i for i in range(4)]
GHOST_AUX = [13 + 4 * i + 2 for i in range(4)]  # (spawning << 7) | frightSteps
FRUIT_LOC = 31
FRUIT_STEPS = 33
PELLETS = 35


@unittest.skipUnless(HAVE_PACBOT_RS and HAVE_DQN,
                     'needs --extra dqn --group parity (pacbot_rs with game_state_bytes)')
class ObsParityTests(unittest.TestCase):

	@classmethod
	def setUpClass(cls):
		global dqn_module, GameState
		import dqn_module
		from gameState import GameState
		C = pacbot_rs.PacmanGymConfiguration
		cls.full_config = C({})
		cls.purgatory_config = C({'obs_ignore_super_pellets': True})

	def assert_matches_env(self, env, context: str):
		self.assertEqual(env.ticks_per_step, dqn_module.TICKS_PER_STEP)
		state = GameState()
		state.update(env.game_state_bytes())
		for config, ignore in ((self.full_config, False), (self.purgatory_config, True)):
			np.testing.assert_allclose(
				dqn_module.build_obs(state, ignore_super_pellets=ignore),
				env.obs_numpy(config), rtol=1e-6, atol=0,
				err_msg=f'{context}, ignore_super_pellets={ignore}')
		self.assertEqual(dqn_module.action_mask(state), list(env.action_mask()), context)
		self.assertEqual(dqn_module.purgatory_action_mask(state),
		                 list(env.purgatory_action_mask()), context)
		for version in dqn_module.SUPPORTED_ENV_VERSIONS:
			env.env_version = version
			self.assertEqual(dqn_module.is_purgatory(state, version),
			                 not env.are_ghosts_close() and env.all_ghosts_not_frightened(),
			                 f'{context}, env_version={version}')
		env.env_version = pacbot_rs.PacmanGym.LATEST_ENV_VERSION

	def test_supports_latest_env_version(self):
		# Fails when env.rs gains a new version that dqn_module doesn't reproduce yet
		self.assertIn(pacbot_rs.PacmanGym.LATEST_ENV_VERSION, dqn_module.SUPPORTED_ENV_VERSIONS)

	def test_random_games(self):
		rng = random.Random(0)
		C = pacbot_rs.PacmanGymConfiguration
		configs = [
			C({'random_start': False}),
			C({'random_start': True}),
			C({'random_start': True, 'randomize_ghosts': True}),
		]
		checked = frightened = 0
		for game in range(9):
			env = pacbot_rs.PacmanGym(configs[game % len(configs)])
			for step in range(250):
				if not env.all_ghosts_not_frightened():
					frightened += 1
				self.assert_matches_env(env, f'game {game} step {step}')
				checked += 1
				# Mostly keep going the same way so Pacman covers ground
				if step % 6 == 0:
					moves = [a for a, ok in enumerate(env.action_mask()) if ok and a]
					action = rng.choice(moves)
				_, done = env.step(action)
				if done:
					break
		self.assertGreater(checked, 500)

	def _edited_env(self, edit) -> 'pacbot_rs.PacmanGym':
		env = pacbot_rs.PacmanGym(pacbot_rs.PacmanGymConfiguration({}))
		state = bytearray(env.game_state_bytes())
		edit(state)
		env.set_game_state_bytes(bytes(state), dqn_module.TICKS_PER_STEP)
		return env

	def test_frightened_ghosts_with_combo(self):
		def edit(state):
			state[GHOST_COMBO] = 2
			state[GHOST_AUX[0]] = 30
			state[GHOST_AUX[2]] = 5
		env = self._edited_env(edit)
		self.assertFalse(env.all_ghosts_not_frightened())
		self.assert_matches_env(env, 'frightened ghosts')

	def test_ghosts_off_board(self):
		# (32, 32) is the location of ghosts that haven't spawned
		for off_board in ([0, 1, 2, 3], [0, 1], [3]):
			def edit(state):
				for i in off_board:
					state[GHOST_LOC[i]:GHOST_LOC[i] + 2] = bytes([32, 32])
			self.assert_matches_env(self._edited_env(edit), f'ghosts {off_board} off the board')

	def test_fruit(self):
		def edit(state):
			state[FRUIT_LOC:FRUIT_LOC + 2] = bytes([17, 13])
			state[FRUIT_STEPS] = 20
		self.assert_matches_env(self._edited_env(edit), 'fruit')

	def test_last_pellet(self):
		for row, col in ((5, 6), (3, 1)):  # a regular pellet and a super pellet
			def edit(state):
				pellets = [0] * 31
				pellets[row] = 1 << col
				state[PELLETS:] = b''.join(p.to_bytes(4, 'big') for p in pellets)
			env = self._edited_env(edit)
			self.assertEqual(env.remaining_pellets(), 1)
			self.assert_matches_env(env, f'last pellet at {(row, col)}')


if __name__ == '__main__':
	unittest.main()
