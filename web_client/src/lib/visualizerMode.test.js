import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, searchWithMode, MODES } from './visualizerMode.js';

test('the modes are arcade and competition', () => {
  assert.deepEqual(MODES, ['arcade', 'competition']);
});

test('?mode=arcade selects arcade mode', () => {
  assert.equal(resolveMode('?mode=arcade'), 'arcade');
  assert.equal(resolveMode('?timeline=1&mode=arcade'), 'arcade');
});

test('anything else is competition mode', () => {
  for (const search of ['', '?mode=competition', '?mode=bogus', '?mode=ARCADE', undefined]) {
    assert.equal(resolveMode(search), 'competition', String(search));
  }
});

test('enabling arcade mode puts it in the URL', () => {
  assert.equal(searchWithMode('', 'arcade'), '?mode=arcade');
  assert.equal(searchWithMode('?timeline=1&ws=3002', 'arcade'), '?timeline=1&ws=3002&mode=arcade');
  assert.equal(searchWithMode('?mode=arcade', 'arcade'), '?mode=arcade');
});

test('competition mode removes the mode from the URL', () => {
  assert.equal(searchWithMode('?mode=arcade', 'competition'), '');
  assert.equal(searchWithMode('?timeline=1&mode=arcade&ws=3002', 'competition'), '?timeline=1&ws=3002');
  assert.equal(searchWithMode('?mode=competition', 'competition'), '');
});
