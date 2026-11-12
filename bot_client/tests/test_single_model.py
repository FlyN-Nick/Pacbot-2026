'''
Single-model checkpoints (curc-pacbot-rl --single-model): the bot plays every move with
the checkpoint, using the full observation and action mask, and never loads the super
pellet model. With the Rust training environment available, the bot's move is compared
with the training environment's for the same states.

    uv run --extra dqn python -m unittest tests.test_single_model
    uv run --extra dqn --group parity python -m unittest tests.test_single_model
'''

import importlib.util
import random
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

HAVE_DQN = all(importlib.util.find_spec(m) for m in ('torch', 'pacbot_rl_models', 'safetensors'))
try:
	import pacbot_rs
	HAVE_PACBOT_RS = hasattr(pacbot_rs.PacmanGym, 'game_state_bytes')
except ImportError:
	HAVE_PACBOT_RS = False


@unittest.skipUnless(HAVE_DQN, 'needs --extra dqn')
class SingleModelTests(unittest.TestCase):

	@classmethod
	def setUpClass(cls):
		import torch
		import dqn_module
		from pacbot_rl_models import models
		cls.torch, cls.dqn = torch, dqn_module
		cls.tmp = tempfile.TemporaryDirectory()
		torch.manual_seed(0)
		net = models.QNetV2(dqn_module.OBS_SHAPE, dqn_module.NUM_ACTIONS)
		cls.weights = net.state_dict()
		cls.paths = {}
		for single in (True, False):
			path = Path(cls.tmp.name) / f'single-{single}.ckpt.pt'
			torch.save({'state_dict': cls.weights, 'iter_num': 1, 'config': {'model': 'QNetV2'},
			            'env_version': 2, 'single_model': single}, path)
			cls.paths[single] = str(path)

	@classmethod
	def tearDownClass(cls):
		cls.tmp.cleanup()

	def module(self, single: bool):
		return self.dqn.DQNDecisionModule(self.state, self.paths[single])

	def setUp(self):
		from gameState import GameState
		self.state = GameState()

	def test_single_model_never_loads_the_super_pellet_model(self):
		with patch.object(self.dqn.DQNDecisionModule, '_load_super_pellet_model') as load:
			bot = self.module(True)
		load.assert_not_called()
		self.assertTrue(bot.single_model)
		self.assertIsNone(bot.super_q_net)

	def test_two_model_checkpoints_still_load_it(self):
		with patch.object(self.dqn.DQNDecisionModule, '_load_super_pellet_model') as load:
			bot = self.module(False)
		load.assert_called_once()
		self.assertFalse(bot.single_model)

	def test_older_checkpoints_are_two_model(self):
		path = Path(self.tmp.name) / 'old.ckpt.pt'
		self.torch.save({'state_dict': self.weights, 'config': {'model': 'QNetV2'}}, path)
		with patch.object(self.dqn.DQNDecisionModule, '_load_super_pellet_model'):
			self.assertFalse(self.dqn.DQNDecisionModule(self.state, str(path)).single_model)

	def test_plays_with_the_full_observation_and_mask(self):
		bot = self.module(True)
		seen = []
		original = bot._q_action
		def spy(net, obs, mask):
			seen.append((net, obs.copy(), mask))
			return original(net, obs, mask)
		bot._q_action = spy
		bot.get_direction()
		(net, obs, mask), = seen
		self.assertIs(net, bot.q_net)
		self.assertEqual(mask, self.dqn.action_mask(self.state))
		self.assertTrue((obs == self.dqn.build_obs(self.state, ignore_super_pellets=False)).all())

	@unittest.skipUnless(HAVE_PACBOT_RS, 'needs --group parity (pacbot_rs with game_state_bytes)')
	def test_moves_match_training(self):
		'''The move training's single-model step (utils.step_env_once) would make'''
		from gameState import GameState
		torch = self.torch
		bot = self.module(True)
		full = pacbot_rs.PacmanGymConfiguration({})
		rng = random.Random(1)
		checked = outside_purgatory = 0
		for game in range(6):
			env = pacbot_rs.PacmanGym(pacbot_rs.PacmanGymConfiguration({'random_start': game % 2 == 1}))
			for _ in range(200):
				bot.state = GameState()
				bot.state.update(env.game_state_bytes())
				with torch.no_grad():
					q = bot.q_net(torch.from_numpy(env.obs_numpy(full)).unsqueeze(0).to(bot.device))
					q[~torch.tensor(env.action_mask(), device=bot.device).unsqueeze(0)] = -float('inf')
				expected = self.dqn._ACTION_TO_DIR[int(q.argmax(dim=1).item())]
				self.assertEqual(bot.get_direction(), expected)
				checked += 1
				outside_purgatory += not self.dqn.is_purgatory(bot.state, bot.env_version)
				moves = [a for a, ok in enumerate(env.action_mask()) if ok]
				_, done = env.step(rng.choice(moves))
				if done:
					break
		self.assertGreater(checked, 300)
		self.assertGreater(outside_purgatory, 0, 'never left purgatory; the test proves little')


if __name__ == '__main__':
	unittest.main()
