import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveMode, saveMode, STORAGE_KEY, MODES } from './visualizerMode.js';

const storageWith = (value) => ({ getItem: (key) => (key === STORAGE_KEY ? value : null), setItem() {} });
const throwing = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };

test('the modes are arcade and competition', () => {
  assert.deepEqual(MODES, ['arcade', 'competition']);
});

test('the URL parameter beats the stored mode', () => {
  assert.equal(resolveMode({ search: '?mode=arcade', storage: storageWith('competition') }), 'arcade');
});

test('the stored mode is used without a URL parameter', () => {
  assert.equal(resolveMode({ search: '', storage: storageWith('arcade') }), 'arcade');
});

test('with neither, the mode is competition', () => {
  assert.equal(resolveMode({ search: '', storage: storageWith(null) }), 'competition');
});

test('an unknown URL value is ignored', () => {
  assert.equal(resolveMode({ search: '?mode=bogus', storage: storageWith('arcade') }), 'arcade');
});

test('storage that throws falls back to competition', () => {
  assert.equal(resolveMode({ search: '', storage: throwing }), 'competition');
  assert.equal(resolveMode({ search: '', storage: undefined }), 'competition');
});

test('saving survives storage that throws', () => {
  assert.doesNotThrow(() => saveMode('arcade', throwing));
  assert.doesNotThrow(() => saveMode('arcade', undefined));
});

test('saving stores the mode under the storage key', () => {
  const saved = {};
  saveMode('arcade', { setItem: (key, value) => { saved[key] = value; } });
  assert.deepEqual(saved, { [STORAGE_KEY]: 'arcade' });
});
