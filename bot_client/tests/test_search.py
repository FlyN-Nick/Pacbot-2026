'''
Playing with search (--search): the server's game state loads into the Rust game unchanged and
simulates the same future, the planner sizes its search to Pacman's speed, and DQN and
AlphaZero checkpoints play legal moves through it.

    uv run --extra search python -m unittest tests.test_search
'''

import contextlib
import importlib.util
import io
import random
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import pacbotClient

HAVE_DQN = all(importlib.util.find_spec(m) for m in ('torch', 'pacbot_rl_models', 'safetensors'))
try:
	import pacbot_rs
	HAVE_SEARCH = hasattr(pacbot_rs, 'gumbel_search') and hasattr(pacbot_rs.PacmanGym, 'set_game_state_bytes')
except ImportError:
	HAVE_SEARCH = False


def random_game_states(games: int = 6, max_moves: int = 400, seed: int = 0):
	'''(env, ticks_per_step) at random points of random seeded games'''
	rng = random.Random(seed)
	for game in range(games):
		ticks = rng.randint(4, 14)
		config = pacbot_rs.PacmanGymConfiguration({
			'random_start': game % 2 == 1, 'random_ticks': True,
			'random_ticks_per_step_min': ticks, 'random_ticks_per_step_max': ticks})
		env = pacbot_rs.PacmanGym(config, seed=game)
		for _ in range(rng.randint(0, max_moves)):
			legal = [a for a, ok in enumerate(env.action_mask()) if ok]
			_, done = env.step(rng.choice(legal))
			if done:
				break
		if not env.is_done():
			yield env, ticks


class SearchArgumentTests(unittest.TestCase):

	def parse(self, *argv):
		return pacbotClient.parse_args(['--strategy', 'dqn', '--checkpoint', 'x.pt', *argv])

	def test_off_by_default(self):
		self.assertEqual(self.parse().search, 'off')

	def test_auto_and_numbers(self):
		self.assertEqual(self.parse('--search', 'auto').search, 'auto')
		self.assertEqual(self.parse('--search', '128').search, 128)

	def test_rejects_bad_values(self):
		for argv in (['--search', '0'], ['--search', 'many'], ['--search-budget', '0'],
		             ['--search-budget', '1.5'], ['--search-max-sims', '0'], ['--search-temperature', '0']):
			with self.subTest(argv=argv), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
				self.parse(*argv)

	def test_astar_cannot_search(self):
		with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
			pacbotClient.parse_args(['--search', 'auto'])


@unittest.skipUnless(HAVE_SEARCH, 'needs --extra search (pacbot_rs with gumbel_search)')
class ServerStateTests(unittest.TestCase):
	'''The search starts from the state the bot holds, as the Rust game would continue it'''

	def test_the_bot_state_serializes_back_to_the_server_bytes(self):
		from gameState import GameState
		for env, _ in random_game_states():
			state = GameState()
			state.update(env.game_state_bytes())
			self.assertEqual(state.serialize(), env.game_state_bytes())

	def test_loaded_state_plays_out_the_same(self):
		# A game loaded from its server bytes, with the same random seed, continues exactly as
		# the original: the bytes hold everything the game's future depends on
		rng = random.Random(1)
		for env, ticks in random_game_states():
			copy = pacbot_rs.PacmanGym(pacbot_rs.PacmanGymConfiguration({}))
			copy.set_game_state_bytes(env.game_state_bytes(), ticks)
			copy.seed = env.seed
			for move in range(60):
				legal = [a for a, ok in enumerate(env.action_mask()) if ok]
				action = rng.choice(legal)
				reward, done = env.step(action)
				copy_reward, copy_done = copy.step(action)
				self.assertEqual(done, copy_done, f'move {move}')
				if move > 0:
					# The first move's turn penalty (2 points) depends on the move before it,
					# which the server's state doesn't hold
					self.assertEqual(reward, copy_reward, f'move {move}')
				self.assertEqual(env.game_state_bytes(), copy.game_state_bytes(), f'move {move}')
				if env.is_done():
					break


@unittest.skipUnless(HAVE_SEARCH and HAVE_DQN, 'needs --extra search')
class PlannerTests(unittest.TestCase):

	@classmethod
	def setUpClass(cls):
		import torch
		import dqn_module
		import searchPlanner
		from pacbot_rl_models import models
		cls.torch, cls.dqn, cls.sp = torch, dqn_module, searchPlanner
		torch.manual_seed(0)
		cls.q_net = models.QNetV2(dqn_module.OBS_SHAPE, dqn_module.NUM_ACTIONS).eval()
		cls.pv_net = models.PVNetV2(dqn_module.OBS_SHAPE, dqn_module.NUM_ACTIONS).eval()
		cls.tmp = tempfile.TemporaryDirectory()
		cls.dqn_path = Path(cls.tmp.name) / 'dqn.ckpt.pt'
		torch.save({'state_dict': cls.q_net.state_dict(), 'iter_num': 1, 'env_version': 2, 'single_model': True,
		            'config': {'model': 'QNetV2', 'discount_factor': 0.99, 'reward_scale': 0.02}}, cls.dqn_path)
		cls.az_path = Path(cls.tmp.name) / 'az.ckpt.pt'
		torch.save({'state_dict': cls.pv_net.state_dict(), 'env_version': 2, 'single_model': True,
		            'config': {'model': 'PVNetV2', 'discount': 0.99, 'reward_scale': 0.02,
		                       'c_visit': 50.0, 'c_scale': 0.1}}, cls.az_path)

	@classmethod
	def tearDownClass(cls):
		cls.tmp.cleanup()

	def planner(self, **kwargs):
		evaluator = self.sp.QNetworkEvaluator(self.q_net, self.torch.device('cpu'), 0.3)
		return self.sp.SearchPlanner(evaluator, {'discount': 0.99, 'reward_scale': 0.02}, 2, **kwargs)

	def test_plays_legal_moves_with_the_simulations_asked_for(self):
		planner = self.planner(sims=8)
		for env, ticks in random_game_states():
			action = planner.plan(bytes(env.game_state_bytes()), ticks)
			self.assertTrue(env.action_mask()[action])
			self.assertEqual(planner.last_sims, 8)

	def test_searches_after_a_lost_life_and_on_later_levels(self):
		# Training games end at the first lost life or a cleared board; the bot's go on
		planner = self.planner(sims=4)
		env, ticks = next(random_game_states())
		state = bytearray(env.game_state_bytes())
		state[self.sp.LEVEL_BYTE], state[self.sp.LIVES_BYTE] = 2, 1
		self.assertTrue(env.action_mask()[planner.plan(bytes(state), ticks)])

	def test_auto_scales_with_speed_within_bounds(self):
		planner = self.planner(min_sims=16, max_sims=512, budget=0.5)
		self.assertEqual(planner.sims_for(8), 16)  # nothing measured yet
		planner.seconds_per_sim = 0.001
		# Half of a move's time (4/24 s at speed 4) at 1 ms per simulation
		self.assertEqual(planner.sims_for(4), 83)
		self.assertEqual(planner.sims_for(8), 166)
		self.assertEqual(planner.sims_for(18), 375)
		planner.seconds_per_sim = 0.0001
		self.assertEqual(planner.sims_for(14), 512)
		planner.seconds_per_sim = 1.0
		self.assertEqual(planner.sims_for(4), 16)

	def test_warm_up_measures_a_simulation(self):
		planner = self.planner()
		self.assertGreater(planner.warm_up(sims=4), 0)
		self.assertGreater(planner.sims_for(14), planner.min_sims - 1)

	def test_q_evaluator_uses_legal_q_values(self):
		evaluator = self.sp.QNetworkEvaluator(self.q_net, self.torch.device('cpu'), 0.5)
		env, _ = next(random_game_states())
		obs = env.obs_numpy(pacbot_rs.PacmanGymConfiguration({}))[None]
		legal = self.torch.tensor([env.action_mask()]).numpy()
		value, logits = evaluator(obs, legal)
		with self.torch.no_grad():
			q = self.q_net(self.torch.from_numpy(obs))[0].numpy()
		legal_q = [q[a] for a in range(5) if legal[0, a]]
		self.assertAlmostEqual(float(value[0]), max(legal_q), places=5)
		for a in range(5):
			self.assertAlmostEqual(float(logits[0, a]), q[a] / 0.5 if legal[0, a] else 0.0, places=4)

	def bot_state(self):
		from gameState import GameState
		env, ticks = next(random_game_states())
		state = GameState()
		state.update(env.game_state_bytes())
		return state, env

	def test_dqn_and_alphazero_bots_play_through_the_search(self):
		for path in (self.dqn_path, self.az_path):
			with self.subTest(path=path.name), contextlib.redirect_stdout(io.StringIO()):
				state, env = self.bot_state()
				bot = self.dqn.DQNDecisionModule(state, str(path), speed=8, search=8)
				self.assertIsNotNone(bot.planner)
				# The decision loop gets the search's input, to run the search off the event loop
				self.assertEqual(bot._choose(), (state.serialize(), 8))
				direction = bot.get_direction()
				self.assertIn(direction, self.dqn._ACTION_TO_DIR)
				self.assertTrue(env.action_mask()[self.dqn._ACTION_TO_DIR.index(direction)])
				self.assertEqual(bot.planner.last_sims, 8)

	def test_alphazero_without_search_plays_its_policy(self):
		with contextlib.redirect_stdout(io.StringIO()):
			state, env = self.bot_state()
			bot = self.dqn.DQNDecisionModule(state, str(self.az_path), speed=8)
		self.assertTrue(bot.alphazero)
		obs = self.dqn.build_obs(state, ignore_super_pellets=False, ticks_per_step=8)
		with self.torch.no_grad():
			logits = self.pv_net(self.torch.from_numpy(obs)[None])[0][0]
		mask = self.dqn.action_mask(state)
		best = max((a for a in range(5) if mask[a]), key=lambda a: logits[a])
		self.assertEqual(bot.get_direction(), self.dqn._ACTION_TO_DIR[best])

	def test_search_runs_on_the_cpu_on_a_mac(self):
		# Apple's GPU slows down between moves, so the search is faster on the CPU
		from unittest import mock
		state, _ = self.bot_state()
		with mock.patch('torch.backends.mps.is_available', return_value=True), \
				mock.patch('torch.cuda.is_available', return_value=False), \
				contextlib.redirect_stdout(io.StringIO()):
			bot = self.dqn.DQNDecisionModule(state, str(self.az_path), speed=8, search=4)
		self.assertEqual(bot.device.type, 'cpu')

	def test_two_model_checkpoints_cannot_search(self):
		path = Path(self.tmp.name) / 'two-model.ckpt.pt'
		self.torch.save({'state_dict': self.q_net.state_dict(), 'env_version': 2, 'single_model': False,
		                 'config': {'model': 'QNetV2'}}, path)
		state, _ = self.bot_state()
		with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(ValueError):
			self.dqn.DQNDecisionModule(state, str(path), search=8)


if __name__ == '__main__':
	unittest.main()
