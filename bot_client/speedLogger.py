'''
Measures how many game ticks Pacman takes to move one cell, from the server's state
broadcasts, so the RL training and evaluation speeds (game ticks per Pacman move, 4 to 14
in training, 8 in the bot's simulation mode) can be matched to the physical robot.

Record while a game is played, then summarize:

	uv run python speedLogger.py record --out robot-run.csv     # Ctrl-C to stop
	uv run python speedLogger.py summarize robot-run.csv [more.csv ...]

`record` only listens (it never sends anything to the server), so it can run alongside any
client. The bot client can also record its own games with `--log-speed robot-run.csv`.

Each row of the CSV is one change of Pacman's cell, the game mode, lives or level. A move
is counted only between two adjacent cells with no pause, death or level change in between.
The robot may also choose to wait in place, which looks like a slow move, so the summary
reports the spread (percentiles), not just an average, and splits straight moves from turns.
'''

import argparse
import csv
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from struct import unpack_from
from typing import Iterable, Sequence

from gameState import GameModes, GameState

FIELDS = ['wall_time', 'tick', 'mode', 'row', 'col', 'lives', 'level']
TICK_MODULUS = 1 << 16  # currTicks is a 2-byte counter
TRAINING_SPEEDS = range(4, 15)  # curc-pacbot-rl utils.TRAINING_SPEEDS
_FORMAT = GameState().format  # the server's state layout, as the bot client parses it


@dataclass(frozen=True)
class Event:
	wall_time: float
	tick: int
	mode: int
	row: int
	col: int
	lives: int
	level: int

	def key(self) -> tuple[int, int, int, int, int]:
		return (self.mode, self.row, self.col, self.lives, self.level)


def parse_state(message: bytes, wall_time: float) -> Event:
	'''The fields this tool needs from one server state broadcast'''
	unpacked = unpack_from(_FORMAT, message, 0)
	loc = unpacked[22]
	return Event(wall_time, unpacked[0], unpacked[2], (loc >> 8) & 0x3f, loc & 0x3f,
	             unpacked[8], unpacked[7])


class SpeedLogger:
	'''Writes an event whenever Pacman's cell, the game mode, lives or level changes'''

	def __init__(self, path: str | Path) -> None:
		self._file = open(path, 'w', newline='', encoding='utf-8')
		self._writer = csv.writer(self._file)
		self._writer.writerow(FIELDS)
		self._last: Event | None = None
		self.events: list[Event] = []

	def observe(self, message: bytes, wall_time: float | None = None) -> None:
		event = parse_state(message, time.time() if wall_time is None else wall_time)
		if self._last is not None and event.key() == self._last.key():
			return
		self._last = event
		self.events.append(event)
		self._writer.writerow([f'{event.wall_time:.3f}', event.tick, event.mode, event.row,
		                       event.col, event.lives, event.level])
		self._file.flush()

	def close(self) -> None:
		self._file.close()


def read_events(path: str | Path) -> list[Event]:
	with open(path, newline='', encoding='utf-8') as f:
		return [Event(float(r['wall_time']), *(int(r[k]) for k in FIELDS[1:]))
		        for r in csv.DictReader(f)]


@dataclass(frozen=True)
class Move:
	ticks: int
	seconds: float
	turn: bool  # direction differs from the previous counted move


def moves(events: Sequence[Event]) -> list[Move]:
	'''Ticks between consecutive cell entries, keeping only clean single-cell moves'''
	result: list[Move] = []
	entry: Event | None = None  # when Pacman entered its current cell, if usable
	last_dir: tuple[int, int] | None = None
	for prev, curr in zip(events, events[1:]):
		paused = curr.mode == GameModes.PAUSED or prev.mode == GameModes.PAUSED
		reset = (curr.lives, curr.level) != (prev.lives, prev.level)
		if paused or reset:
			entry, last_dir = None, None
			continue
		if (curr.row, curr.col) == (prev.row, prev.col):
			continue  # mode change between scatter and chase only
		step = (curr.row - prev.row, curr.col - prev.col)
		ticks = (curr.tick - prev.tick) % TICK_MODULUS
		if abs(step[0]) + abs(step[1]) != 1 or ticks > TICK_MODULUS // 2:
			entry, last_dir = None, None  # jump (missed frames, respawn) or counter reset
			continue
		if entry is not None and (prev.row, prev.col) == (entry.row, entry.col):
			span = (curr.tick - entry.tick) % TICK_MODULUS
			result.append(Move(span, curr.wall_time - entry.wall_time,
			                   last_dir is not None and step != last_dir))
		entry, last_dir = curr, step
	return result


def _percentile(sorted_values: Sequence[float], q: float) -> float:
	if len(sorted_values) == 1:
		return sorted_values[0]
	pos = q * (len(sorted_values) - 1)
	lo = int(pos)
	hi = min(lo + 1, len(sorted_values) - 1)
	return sorted_values[lo] + (sorted_values[hi] - sorted_values[lo]) * (pos - lo)


def summarize(all_moves: Sequence[Move], out=sys.stdout) -> dict:
	if not all_moves:
		print('No clean moves found (was Pacman moving, and the game unpaused?)', file=out)
		return {}
	ticks = sorted(m.ticks for m in all_moves)
	pct = {q: _percentile(ticks, q / 100) for q in (10, 25, 50, 75, 90)}
	stats = {'moves': len(ticks), **{f'p{q}': v for q, v in pct.items()}}
	print(f'{len(ticks)} moves. Game ticks per cell: median {pct[50]:g}, middle half '
	      f'{pct[25]:g}-{pct[75]:g}, middle 80% {pct[10]:g}-{pct[90]:g}', file=out)
	for label, group in (('straight', [m.ticks for m in all_moves if not m.turn]),
	                     ('after a turn', [m.ticks for m in all_moves if m.turn])):
		if group:
			stats[f'median_{label.split()[0]}'] = statistics.median(group)
			print(f'  {label}: {len(group)} moves, median {statistics.median(group):g}', file=out)
	timed = [m for m in all_moves if m.seconds > 0]
	if timed:
		fps = sum(m.ticks for m in timed) / sum(m.seconds for m in timed)
		stats['ticks_per_second'] = fps
		print(f'  game clock: {fps:.1f} ticks/s (server config GameFPS is normally 24)', file=out)

	print('Histogram (ticks per cell):', file=out)
	counts: dict[int, int] = {}
	for t in ticks:
		counts[t] = counts.get(t, 0) + 1
	cap = int(pct[90] * 2) + 1  # long waits are listed together
	shown = {t: c for t, c in counts.items() if t <= cap}
	longer = sum(c for t, c in counts.items() if t > cap)
	width = max(shown.values(), default=1)
	for t in sorted(shown):
		print(f'  {t:4d} {"#" * max(1, round(40 * shown[t] / width))} {shown[t]}', file=out)
	if longer:
		print(f'  >{cap:3d} {longer} (waiting in place, or very slow moves)', file=out)

	lo, hi = round(pct[10]), round(pct[90])
	print(f'Training speeds cover {TRAINING_SPEEDS.start}-{TRAINING_SPEEDS.stop - 1} ticks per '
	      f'move; the robot\'s middle 80% is {lo}-{hi}.', file=out)
	if hi > TRAINING_SPEEDS.stop - 1 or lo < TRAINING_SPEEDS.start:
		print('  The robot is outside the trained range for some moves: consider widening '
		      'random_ticks_per_step in training.', file=out)
	return stats


def record(url: str, out: str) -> None:
	from websockets.sync.client import connect  # type: ignore

	logger = SpeedLogger(out)
	print(f'Recording {url} to {out}; Ctrl-C to stop')
	try:
		with connect(url) as connection:
			while True:
				message = connection.recv()
				if isinstance(message, str):
					message = message.encode('ascii')
				logger.observe(message)
	except KeyboardInterrupt:
		pass
	finally:
		logger.close()
		print()
		summarize(moves(logger.events))


def _connect_url() -> str:
	config = json.loads((Path(__file__).resolve().parents[1] / 'config.json').read_text())
	return f'ws://{config["ServerIP"]}:{config["WebSocketPort"]}'


def main(argv: Sequence[str] | None = None) -> None:
	parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0].strip())
	sub = parser.add_subparsers(dest='command', required=True)
	rec = sub.add_parser('record', help='listen to the game server and log Pacman\'s moves')
	rec.add_argument('--out', required=True, help='CSV file to write')
	rec.add_argument('--url', default=None, help='websocket URL (default: from ../config.json)')
	summ = sub.add_parser('summarize', help='ticks per cell from one or more recordings')
	summ.add_argument('files', nargs='+')
	args = parser.parse_args(argv)

	if args.command == 'record':
		record(args.url or _connect_url(), args.out)
	else:
		all_moves: list[Move] = []
		for path in args.files:
			all_moves += moves(read_events(path))
		summarize(all_moves)


if __name__ == '__main__':
	main()
