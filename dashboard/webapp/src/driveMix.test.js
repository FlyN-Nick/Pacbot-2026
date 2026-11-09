// Run with: npm test  (uses Node's built-in test runner)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldToCommand, mixMotors, directionLabel } from './driveMix.js';

test('opposite keys cancel', () => {
  assert.deepEqual(heldToCommand(new Set(['up', 'down'])), { x: 0, y: 0, rot: 0 });
  assert.deepEqual(heldToCommand(new Set(['up', 'right'])), { x: 1, y: 1, rot: 0 });
  assert.deepEqual(heldToCommand(new Set(['cw'])), { x: 0, y: 0, rot: 1 });
});

test('cardinal moves match the motor_config.json vectors', () => {
  assert.deepEqual(mixMotors({ x: 0, y: 1, rot: 0 }, 128), [128, 0, 0, -128]);
  assert.deepEqual(mixMotors({ x: 0, y: -1, rot: 0 }, 128), [-128, 0, 0, 128]);
  assert.deepEqual(mixMotors({ x: 1, y: 0, rot: 0 }, 128), [0, -128, -128, 0]);
  assert.deepEqual(mixMotors({ x: -1, y: 0, rot: 0 }, 128), [0, 128, 128, 0]);
  assert.deepEqual(mixMotors({ x: 0, y: 0, rot: 1 }, 128), [-128, -128, 128, -128]);
});

test('diagonals and spin+translate never exceed the speed', () => {
  assert.deepEqual(mixMotors({ x: 1, y: 1, rot: 0 }, 200), [200, -200, -200, -200]);
  const m = mixMotors({ x: 0, y: 1, rot: 1 }, 200);
  assert.equal(Math.max(...m.map(Math.abs)), 200);
  assert.deepEqual(m, [0, -100, 100, -200]);
});

test('no input means all motors stopped', () => {
  assert.deepEqual(mixMotors({ x: 0, y: 0, rot: 0 }, 255), [0, 0, 0, 0]);
});

test('direction labels for the top-down arrow', () => {
  assert.equal(directionLabel({ x: 0, y: 1 }), 'forward');
  assert.equal(directionLabel({ x: -1, y: -1 }), 'backward-left');
  assert.equal(directionLabel({ x: 0, y: 0 }), null);
});
