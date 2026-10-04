import importlib
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


class StrategyDependencyTests(unittest.TestCase):
    def test_client_import_does_not_load_dqn(self):
        code = """
import sys
import pacbotClient
assert 'dqn_module' not in sys.modules
assert 'torch' not in sys.modules
assert 'pacbot_rl_models' not in sys.modules
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
        with patch.object(pacbotClient, "DecisionModule", return_value=fake_decision) as ctor:
            result = pacbotClient.make_decision_module(args, object())
        self.assertIs(result, fake_decision)
        ctor.assert_called_once()
        self.assertNotIn("dqn_module", sys.modules)

    def test_dqn_uses_installed_model_package(self):
        import pacbotClient

        sentinel = object()
        constructor = Mock(return_value=sentinel)
        dqn_module = SimpleNamespace(DQNDecisionModule=constructor)
        args = SimpleNamespace(
            strategy="dqn", checkpoint="/tmp/model.ckpt", debug=False,
            hybrid_mode=True, force_no_bot=False,
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
