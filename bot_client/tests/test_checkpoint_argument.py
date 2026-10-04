import unittest

import pacbotClient


class CheckpointArgumentTests(unittest.TestCase):
    def test_dqn_requires_checkpoint(self):
        with self.assertRaises(SystemExit) as raised:
            pacbotClient.parse_args(["--strategy", "dqn"])
        self.assertEqual(raised.exception.code, 2)

    def test_astar_does_not_require_checkpoint(self):
        args = pacbotClient.parse_args(["--strategy", "astar"])
        self.assertIsNone(args.checkpoint)


if __name__ == "__main__":
    unittest.main()
