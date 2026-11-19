'''
The live speed estimate (speedLogger.LiveSpeed) and how the DQN bot uses it: channel 15 of
the observation tells the network Pacman's speed, measured during the game unless --speed
fixes it.

    uv run python -m unittest tests.test_live_speed
    uv run --extra dqn python -m unittest tests.test_live_speed
'''

import importlib.util
import sys
import tempfile
import unittest
import unittest.mock
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pacbotClient  # noqa: E402
from gameState import GameModes, GameState  # noqa: E402
from speedLogger import LiveSpeed  # noqa: E402

HAVE_DQN = all(importlib.util.find_spec(m) for m in ('torch', 'pacbot_rl_models', 'safetensors'))


def message(tick: int, row: int, col: int, mode=GameModes.CHASE, lives=3, level=1) -> bytes:
	state = GameState()
	state.currTicks = tick
	state.gameMode = mode
	state.currLives = lives
	state.currLevel = level
	state.pacmanLoc.row, state.pacmanLoc.col = row, col
	return state.serialize()


class Walker:
	'''Feeds a LiveSpeed one broadcast per game tick while Pacman walks along row 5'''

	def __init__(self, speed: LiveSpeed) -> None:
		self.speed, self.tick, self.col = speed, 1000, 1

	def walk(self, ticks_per_cell, **state) -> None:
		for n in ticks_per_cell:
			for _ in range(n):
				self.speed.observe(message(self.tick % 65536, 5, self.col, **state), wall_time=self.tick / 24)
				self.tick += 1
			self.col = self.col % 26 + 1


class LiveSpeedTests(unittest.TestCase):
	def test_assumes_the_default_until_a_few_moves_are_measured(self):
		speed = LiveSpeed(default=8, min_moves=3)
		walker = Walker(speed)
		walker.walk([11, 11, 11])  # the first cell's entry isn't seen and the last isn't left: 1 move
		self.assertFalse(speed.measured)
		self.assertEqual(speed.ticks_per_move, 8)
		walker.walk([11])
		self.assertFalse(speed.measured)  # 2 moves
		walker.walk([11])
		self.assertTrue(speed.measured)
		self.assertEqual(speed.ticks_per_move, 11)

	def test_the_median_ignores_the_odd_slow_move_and_follows_a_lasting_change(self):
		speed = LiveSpeed(window=10)
		walker = Walker(speed)
		walker.walk([10] * 8 + [40] + [10] * 3)  # one long wait among steady moves
		self.assertEqual(speed.ticks_per_move, 10)
		walker.walk([12] * 6)  # the robot slows down for good
		self.assertEqual(speed.ticks_per_move, 12)

	def test_clamped_to_the_trained_speeds(self):
		slow = LiveSpeed(low=4, high=14)
		Walker(slow).walk([20] * 6)
		self.assertEqual(slow.ticks_per_move, 14)
		extended = LiveSpeed(low=4, high=18)
		Walker(extended).walk([20] * 6)
		self.assertEqual(extended.ticks_per_move, 18)
		fast = LiveSpeed(low=4, high=14)
		Walker(fast).walk([2] * 6)
		self.assertEqual(fast.ticks_per_move, 4)

	def test_pauses_and_deaths_dont_count_as_moves(self):
		speed = LiveSpeed(min_moves=1)
		walker = Walker(speed)
		walker.walk([9, 9, 9])
		self.assertEqual(list(speed.recent), [9])
		walker.walk([500], mode=GameModes.PAUSED)  # paused for a long time in one cell
		walker.walk([9, 9, 9], lives=2)  # then a death: the count starts over
		self.assertEqual(list(speed.recent), [9, 9])
		self.assertEqual(speed.ticks_per_move, 9)


class SpeedArgumentTests(unittest.TestCase):
	def test_live_by_default_or_a_fixed_number(self):
		self.assertEqual(pacbotClient.parse_args(['--strategy', 'astar']).speed, 'live')
		self.assertEqual(pacbotClient.parse_args(['--strategy', 'astar', '--speed', '12']).speed, 12.0)
		for bad in ('fast', '0'):
			with self.assertRaises(SystemExit), unittest.mock.patch('sys.stderr'):
				pacbotClient.parse_args(['--strategy', 'astar', '--speed', bad])


@unittest.skipUnless(HAVE_DQN, 'needs --extra dqn')
class DQNSpeedTests(unittest.TestCase):
	@classmethod
	def setUpClass(cls):
		import torch
		import dqn_module
		from pacbot_rl_models import models
		cls.dqn = dqn_module
		cls.tmp = tempfile.TemporaryDirectory()
		net = models.QNetV2(dqn_module.OBS_SHAPE, dqn_module.NUM_ACTIONS)
		cls.paths = {}
		for name, config in (('default', {'model': 'QNetV2'}), ('to18', {'model': 'QNetV2', 'max_speed': 18})):
			path = Path(cls.tmp.name) / f'{name}.ckpt.pt'
			torch.save({'state_dict': net.state_dict(), 'iter_num': 1, 'config': config,
			            'env_version': 2, 'single_model': True}, path)
			cls.paths[name] = str(path)

	@classmethod
	def tearDownClass(cls):
		cls.tmp.cleanup()

	def test_channel_15_holds_the_speed_over_the_ghosts_update_period(self):
		state = GameState()
		for ticks in (4, 8, 13.5, 18):
			obs = self.dqn.build_obs(state, ignore_super_pellets=False, ticks_per_step=ticks)
			self.assertTrue((obs[15] == ticks / state.updatePeriod).all())

	def test_the_network_is_told_the_measured_speed(self):
		state = GameState()
		module = self.dqn.DQNDecisionModule(state, self.paths['default'])
		self.assertEqual(module.ticks_per_step(), 8)  # nothing measured yet
		Walker(module.live_speed).walk([12] * 6)
		self.assertEqual(module.ticks_per_step(), 12)
		seen = []
		real_build = self.dqn.build_obs
		with unittest.mock.patch.object(self.dqn, 'build_obs',
		                                lambda *a, **kw: seen.append(kw['ticks_per_step']) or real_build(*a, **kw)):
			module.get_direction()
		self.assertEqual(seen, [12])

	def test_clamped_to_the_checkpoints_max_speed(self):
		for name, high in (('default', 14), ('to18', 18)):
			module = self.dqn.DQNDecisionModule(GameState(), self.paths[name])
			Walker(module.live_speed).walk([20] * 6)
			self.assertEqual(module.ticks_per_step(), high, name)

	def test_a_fixed_speed_skips_the_estimate(self):
		module = self.dqn.DQNDecisionModule(GameState(), self.paths['default'], speed=10)
		self.assertIsNone(module.live_speed)
		self.assertEqual(module.ticks_per_step(), 10)


if __name__ == '__main__':
	unittest.main()
