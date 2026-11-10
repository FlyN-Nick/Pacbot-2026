import test from 'node:test';
import assert from 'node:assert/strict';
import { planEyesPath, eyesPositionAt, soundForState } from './ghostEyes.js';
import { isWall, HOUSE_DOOR } from './maze.js';

const adjacent = (a, b) => Math.abs(a.row - b.row) + Math.abs(a.col - b.col) === 1;

test('the eyes path runs through open, adjacent tiles to the house door', () => {
  const path = planEyesPath({ row: 1, col: 1 });
  path.forEach((tile) => assert.equal(isWall(tile.row, tile.col), false, JSON.stringify(tile)));
  for (let i = 1; i < path.length; i++) assert.ok(adjacent(path[i - 1], path[i]), `step ${i}`);
  assert.deepEqual(path[0], { row: 1, col: 1 });
  assert.deepEqual(path.at(-1), HOUSE_DOOR);
});

test('the eyes path is the shortest one', () => {
  // Lengths (tiles, both ends included) computed independently from WALLS
  assert.equal(planEyesPath({ row: 5, col: 13 }).length, 15);
  assert.equal(planEyesPath({ row: 23, col: 13 }).length, 21);
  assert.equal(planEyesPath({ row: 1, col: 1 }).length, 23);
});

test('eyes eaten at the door have nowhere to go', () => {
  assert.deepEqual(planEyesPath(HOUSE_DOOR), [HOUSE_DOOR]);
});

test('eyes starting on a wall fly straight to the door', () => {
  assert.deepEqual(planEyesPath({ row: 0, col: 0 }), [{ row: 0, col: 0 }, HOUSE_DOOR]);
});

test('eyes move along the path at the given speed', () => {
  const path = planEyesPath({ row: 5, col: 13 }); // 14 steps
  assert.deepEqual(eyesPositionAt(path, 0, 10), { ...path[0], done: false });
  const half = eyesPositionAt(path, 700, 10);
  assert.deepEqual({ row: half.row, col: half.col }, path[7]);
  assert.equal(half.done, false);
  assert.deepEqual(eyesPositionAt(path, 1400, 10), { ...path[14], done: true });
  assert.deepEqual(eyesPositionAt(path, 1e9, 10), { ...path[14], done: true });
});

test('eyes between tiles are part-way across', () => {
  const path = [{ row: 5, col: 1 }, { row: 5, col: 2 }];
  const at = eyesPositionAt(path, 50, 10);
  assert.equal(at.row, 5);
  assert.ok(Math.abs(at.col - 1.5) < 1e-9);
});

test('the eyes sound beats fright, which beats the siren', () => {
  for (const eyes of [false, true]) {
    for (const frightened of [false, true]) {
      for (const sirenAllowed of [false, true]) {
        const expected = eyes ? 'eyes' : frightened ? 'frightened' : sirenAllowed ? 'siren' : null;
        assert.equal(soundForState({ eyes, frightened, sirenAllowed }), expected, JSON.stringify({ eyes, frightened, sirenAllowed }));
      }
    }
  }
});
