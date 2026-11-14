import test from 'node:test';
import assert from 'node:assert/strict';
import { levelClearFrame } from './freezeFrames.js';

const rows = (cells) => {
  const pelletRows = new Array(31).fill(0);
  for (const [row, col] of cells) pelletRows[row] |= 1 << col;
  return pelletRows;
};
const frame = (pellets, pacman = { rowState: 23 | 0x40, colState: 12 }) => ({
  pacman, ghosts: [], pelletRows: rows(pellets),
});

test('at a level clear Pac-Man is frozen on the last pellet, facing the same way', () => {
  const frozen = levelClearFrame(frame([[23, 13]]));
  assert.equal(frozen.pacman.rowState & 0x3f, 23);
  assert.equal(frozen.pacman.colState & 0x3f, 13);
  assert.equal(frozen.pacman.rowState & 0xc0, 0x40);
});

test('without exactly one pellet left the frame is unchanged', () => {
  for (const cells of [[], [[1, 1], [1, 2]]]) {
    const original = frame(cells);
    assert.equal(levelClearFrame(original), original);
  }
  assert.equal(levelClearFrame(null), null);
});
