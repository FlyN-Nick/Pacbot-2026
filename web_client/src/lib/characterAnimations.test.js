import test from 'node:test';
import assert from 'node:assert/strict';
import { getGhostVisualState } from './characterAnimations.js';

test('the trapped-state high bit selects returning eyes over frightened body', () => {
  assert.deepEqual(getGhostVisualState(0x85, 6, 0, 12), {
    eaten: true, frightened: false, flashing: false, spriteTwo: false,
  });
  assert.equal(getGhostVisualState(0x05, 0, 0, 12).eaten, false);
});

test('the frightened counter ignores the spawn bit', () => {
  assert.equal(getGhostVisualState(0, 0x80, 0, 12).frightened, false);
  assert.equal(getGhostVisualState(0, 0x8b, 0, 12).frightened, true);
});

test('frightened ghosts flash only in the final ten steps and second half of a period', () => {
  assert.equal(getGhostVisualState(0, 11, 7, 12).flashing, false);
  assert.equal(getGhostVisualState(0, 10, 5, 12).flashing, false);
  assert.equal(getGhostVisualState(0, 10, 6, 12).flashing, true);
  assert.equal(getGhostVisualState(0, 0, 6, 12).flashing, false);
});

test('the foot sprite alternates every two ticks', () => {
  assert.equal(getGhostVisualState(0, 0, 0, 12).spriteTwo, false);
  assert.equal(getGhostVisualState(0, 0, 1, 12).spriteTwo, false);
  assert.equal(getGhostVisualState(0, 0, 2, 12).spriteTwo, true);
  assert.equal(getGhostVisualState(0, 0, 4, 12).spriteTwo, false);
});
