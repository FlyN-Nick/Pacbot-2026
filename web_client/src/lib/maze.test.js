import test from 'node:test';
import assert from 'node:assert/strict';
import { WALLS, MAZE_ROWS, MAZE_COLS, isWall, HOUSE_DOOR } from './maze.js';

test('the maze is 31 rows by 28 columns', () => {
  assert.equal(WALLS.length, 31);
  assert.equal(MAZE_ROWS, 31);
  assert.equal(MAZE_COLS, 28);
});

test('known walls and corridors', () => {
  assert.equal(isWall(0, 0), true);
  assert.equal(isWall(1, 1), false);
  assert.equal(isWall(23, 13), false); // Pac-Man's spawn tile
});

test('outside the board counts as a wall', () => {
  for (const [row, col] of [[-1, 5], [31, 5], [5, 28], [5, -1]]) assert.equal(isWall(row, col), true);
});

test('the tile above the ghost-house door is open', () => {
  assert.equal(isWall(HOUSE_DOOR.row, HOUSE_DOOR.col), false);
});
