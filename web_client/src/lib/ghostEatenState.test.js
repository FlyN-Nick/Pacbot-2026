import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeEatenGhosts, addEyes, advanceEyes } from './ghostEatenState.js';

const A = { ghostIndex: 0, row: 5, col: 6, points: 200 };
const B = { ghostIndex: 2, row: 5, col: 13, points: 400 };

test('a ghost eaten during a running freeze joins it instead of replacing it', () => {
  assert.deepEqual(mergeEatenGhosts([A], [B]), [A, B]);
  assert.deepEqual(mergeEatenGhosts([], [B]), [B]);
  // The same ghost reported twice keeps its latest details
  const A2 = { ...A, points: 800 };
  assert.deepEqual(mergeEatenGhosts([A, B], [A2]), [A2, B]);
});

test('every eyes journey gets its own id, even for the same ghost', () => {
  const { eyes, nextId } = addEyes([], [A], 1);
  const again = addEyes(eyes, [A], nextId);
  assert.equal(again.eyes.length, 2);
  assert.notEqual(again.eyes[0].id, again.eyes[1].id);
  assert.equal(again.nextId, 3);
});

test('eyes advance only while no freeze holds them', () => {
  const { eyes } = addEyes([], [B], 1); // (5,13): 14 steps to the door
  const frozen = advanceEyes(eyes, 500, 10, true);
  assert.equal(frozen.eyes[0].elapsedMs, 0);
  const moving = advanceEyes(eyes, 500, 10, false);
  assert.equal(moving.eyes[0].elapsedMs, 500);
  assert.equal(moving.positions.length, 1);
  assert.equal(moving.positions[0].id, eyes[0].id);
  assert.deepEqual(moving.unhide, []);
});

test('a ghost is shown again only when its last eyes arrive', () => {
  const first = addEyes([], [B], 1);
  const second = addEyes(advanceEyes(first.eyes, 1000, 10, false).eyes, [B], first.nextId);
  // The first journey arrives; the second, for the same ghost, is still travelling
  const step = advanceEyes(second.eyes, 500, 10, false);
  assert.equal(step.arrived.length, 1);
  assert.equal(step.eyes.length, 1);
  assert.deepEqual(step.unhide, []);
  const done = advanceEyes(step.eyes, 1000, 10, false);
  assert.deepEqual(done.unhide, [2]);
  assert.equal(done.eyes.length, 0);
});
