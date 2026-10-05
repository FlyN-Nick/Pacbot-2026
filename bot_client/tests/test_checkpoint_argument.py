import unittest
from unittest.mock import patch

import pacbotClient


class CheckpointArgumentTests(unittest.TestCase):
    def test_dqn_requires_checkpoint(self):
        with patch("sys.stderr") as stderr:
            with self.assertRaises(SystemExit) as raised:
                pacbotClient.parse_args(["--strategy", "dqn"])
        self.assertEqual(raised.exception.code, 2)
        self.assertIn("--checkpoint", "".join(call.args[0] for call in stderr.write.call_args_list))

    def test_astar_does_not_require_checkpoint(self):
        args = pacbotClient.parse_args(["--strategy", "astar"])
        self.assertIsNone(args.checkpoint)


if __name__ == "__main__":
    unittest.main()
