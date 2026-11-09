import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


class StrategyDependencyTests(unittest.TestCase):
    def test_client_import_does_not_load_dqn(self):
        code = """
import sys
import pacbotClient
import low_level
assert 'dqn_module' not in sys.modules
assert 'torch' not in sys.modules
assert 'pacbot_rl_models' not in sys.modules
assert low_level.s is None
"""
        import subprocess

        result = subprocess.run(
            [sys.executable, "-c", code],
            cwd=__import__("pathlib").Path(__file__).parents[1],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_astar_decision_does_not_load_dqn(self):
        import pacbotClient

        fake_decision = object()
        args = SimpleNamespace(strategy="astar", debug=True, force_no_bot=False)
        dqn_modules = ("dqn_module", "torch", "pacbot_rl_models")
        # Other tests in this process may have loaded the DQN code already;
        # hide it so this checks only what the A* path imports.
        with patch.dict(sys.modules):
            for name in [m for m in sys.modules if m.split(".")[0] in dqn_modules]:
                del sys.modules[name]
            with patch.object(pacbotClient, "DecisionModule", return_value=fake_decision) as ctor:
                result = pacbotClient.make_decision_module(args, object())
            for name in dqn_modules:
                self.assertNotIn(name, sys.modules)
        self.assertIs(result, fake_decision)
        ctor.assert_called_once()

    def test_dqn_uses_installed_model_package(self):
        import pacbotClient

        sentinel = object()
        constructor = Mock(return_value=sentinel)
        dqn_module = SimpleNamespace(DQNDecisionModule=constructor)
        args = SimpleNamespace(
            strategy="dqn", checkpoint="/tmp/model.ckpt", debug=False,
            force_no_bot=False,
        )
        with patch.dict(sys.modules, {"dqn_module": dqn_module}):
            state = object()
            result = pacbotClient.make_decision_module(args, state)
        self.assertIs(result, sentinel)
        constructor.assert_called_once_with(
            state, "/tmp/model.ckpt", False,
            hybrid_mode=False, force_no_bot=False,
        )

    def test_hybrid_strategy_enables_astar_fallback(self):
        import pacbotClient

        sentinel = object()
        constructor = Mock(return_value=sentinel)
        dqn_module = SimpleNamespace(DQNDecisionModule=constructor)
        args = SimpleNamespace(
            strategy="hybrid", checkpoint="/tmp/model.ckpt", debug=False,
            force_no_bot=False,
        )
        with patch.dict(sys.modules, {"dqn_module": dqn_module}):
            state = object()
            result = pacbotClient.make_decision_module(args, state)
        self.assertIs(result, sentinel)
        constructor.assert_called_once_with(
            state, "/tmp/model.ckpt", False,
            hybrid_mode=True, force_no_bot=False,
        )


if __name__ == "__main__":
    unittest.main()
