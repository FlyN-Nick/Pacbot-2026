import io
import tempfile
import unittest
from dataclasses import replace
from pathlib import Path

import pacbotClient
from gameState import GameModes, GameState
from speedLogger import SpeedLogger, moves, read_events, summarize


def message(tick: int, row: int, col: int, mode=GameModes.CHASE, lives=3, level=1) -> bytes:
    state = GameState()
    state.currTicks = tick
    state.gameMode = mode
    state.currLives = lives
    state.currLevel = level
    state.pacmanLoc.row, state.pacmanLoc.col = row, col
    return state.serialize()


class SpeedLoggerTests(unittest.TestCase):
    def record(self, frames) -> list:
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "run.csv"
            logger = SpeedLogger(path)
            for i, frame in enumerate(frames):
                logger.observe(message(*frame[:3], **frame[3] if len(frame) > 3 else {}),
                               wall_time=i / 24)
            logger.close()
            events = read_events(path)
        # The file keeps everything, with wall-clock times to the millisecond
        self.assertEqual([replace(e, wall_time=0) for e in events],
                         [replace(e, wall_time=0) for e in logger.events])
        for read, logged in zip(events, logger.events):
            self.assertAlmostEqual(read.wall_time, logged.wall_time, places=3)
        return moves(events)

    def walk(self, start_tick: int, cells, ticks_per_cell, **kw):
        '''One frame per tick while Pacman walks through cells'''
        frames, tick = [], start_tick
        for (row, col), n in zip(cells, ticks_per_cell):
            for _ in range(n):
                frames.append((tick % 65536, row, col, kw))
                tick += 1
        return frames, tick

    def test_counts_ticks_spent_in_each_cell(self):
        cells = [(23, 13), (23, 14), (23, 15), (23, 16), (22, 16), (21, 16)]
        frames, _ = self.walk(100, cells, [8, 9, 10, 12, 8, 8])
        result = self.record(frames)
        # The first cell's entry isn't seen and the last cell isn't left
        self.assertEqual([m.ticks for m in result], [9, 10, 12, 8])
        self.assertEqual([m.turn for m in result], [False, False, True, False])

    def test_pauses_deaths_and_jumps_break_the_count(self):
        frames, tick = self.walk(0, [(5, 1), (5, 2), (5, 3)], [8, 8, 8])
        frames.append((tick, 5, 3, {"mode": GameModes.PAUSED}))  # paused in (5, 3)
        more, tick = self.walk(tick + 50, [(5, 4), (5, 5), (5, 6)], [8, 8, 8])
        frames += more
        more, tick = self.walk(tick, [(23, 13), (23, 14), (23, 15)], [8, 8, 8], lives=2)
        frames += more  # died: respawned, lives changed
        more, tick = self.walk(tick, [(23, 17), (23, 18), (23, 19)], [8, 8, 8], lives=2)
        frames += more  # skipped a cell (missed frames)
        result = self.record(frames)
        self.assertEqual([m.ticks for m in result], [8, 8, 8, 8])

    def test_tick_counter_wraps(self):
        frames, _ = self.walk(65530, [(5, 1), (5, 2), (5, 3), (5, 4)], [8, 9, 10, 8])
        self.assertEqual([m.ticks for m in self.record(frames)], [9, 10])

    def test_summary_flags_speeds_outside_training(self):
        frames, _ = self.walk(0, [(5, c) for c in range(1, 12)], [18] * 11)
        out = io.StringIO()
        stats = summarize(self.record(frames), out=out)
        self.assertEqual(stats["p50"], 18)
        self.assertAlmostEqual(stats["ticks_per_second"], 24)
        self.assertIn("outside the trained range", out.getvalue())

    def test_client_option(self):
        self.assertEqual(pacbotClient.parse_args(["--log-speed", "x.csv"]).log_speed, "x.csv")
        self.assertIsNone(pacbotClient.parse_args([]).log_speed)


if __name__ == "__main__":
    unittest.main()
