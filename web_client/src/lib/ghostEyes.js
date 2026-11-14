// Eaten ghosts' eyes travel home along the maze corridors (arcade mode). Our
// server teleports eaten ghosts, so this journey exists only in the visualizer.
import { isWall, HOUSE_DOOR, MAZE_COLS } from './maze.js';

const STEPS = [[-1, 0], [0, -1], [0, 1], [1, 0]];

/** Shortest corridor path from `from` to `to`, both included. A start on a wall flies straight there. */
export function planEyesPath(from, to = HOUSE_DOOR) {
  if (isWall(from.row, from.col)) return [from, to];
  const key = ({ row, col }) => row * MAZE_COLS + col;
  const previous = new Map([[key(from), null]]);
  const queue = [from];
  while (queue.length) {
    const tile = queue.shift();
    if (tile.row === to.row && tile.col === to.col) {
      const path = [];
      for (let at = tile; at; at = previous.get(key(at))) path.unshift({ row: at.row, col: at.col });
      return path;
    }
    for (const [dr, dc] of STEPS) {
      const next = { row: tile.row + dr, col: tile.col + dc };
      if (isWall(next.row, next.col) || previous.has(key(next))) continue;
      previous.set(key(next), tile);
      queue.push(next);
    }
  }
  return [from, to];
}

/** Where the eyes are after elapsedMs, moving tilesPerSecond; row and col are fractional between tiles. */
export function eyesPositionAt(path, elapsedMs, tilesPerSecond) {
  const steps = path.length - 1;
  const travelled = Math.max(0, (elapsedMs / 1000) * tilesPerSecond);
  if (travelled >= steps) return { ...path[steps], done: true };
  const index = Math.floor(travelled);
  const part = travelled - index;
  const a = path[index];
  const b = path[index + 1];
  return { row: a.row + (b.row - a.row) * part, col: a.col + (b.col - a.col) * part, done: false };
}

/** Which background sound plays: eyes beat fright, which beats the siren; nothing while muted. */
export function soundForState({ eyes, frightened, sirenAllowed, muted = false }) {
  if (muted) return null;
  if (eyes) return 'eyes';
  if (frightened) return 'frightened';
  return sirenAllowed ? 'siren' : null;
}
