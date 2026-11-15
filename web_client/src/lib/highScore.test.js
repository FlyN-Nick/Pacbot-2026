import test from 'node:test';
import assert from 'node:assert/strict';
import { createHighScore } from './highScore.js';

const KEY = 'pacbot.highScore';
function environment(saved) {
  const target = new EventTarget();
  const data = new Map(saved == null ? [] : [[KEY, saved]]);
  const writes = [];
  target.localStorage = {
    getItem: key => data.get(key) ?? null,
    setItem(key, value) { data.set(key, value); writes.push(value); },
  };
  const observed = [];
  const store = createHighScore({ target, onChange: score => observed.push(score) });
  const receive = (value, extra = {}) => {
    data.set(KEY, value);
    target.dispatchEvent(Object.assign(new Event('storage'), {
      key: KEY, newValue: value, storageArea: target.localStorage, ...extra,
    }));
  };
  return { target, data, writes, observed, store, receive };
}

test('loads the saved score and persists only a new maximum', () => {
  const e = environment('425');
  assert.deepEqual(e.observed, [425]);
  e.store.record(100);
  assert.deepEqual(e.writes, []);
  e.store.record(500);
  assert.deepEqual(e.observed, [425, 500]);
  assert.equal(e.data.get(KEY), '500');
  e.store.record(0); // Resetting a game cannot clear the record.
  assert.deepEqual(e.writes, ['500']);
});

test('merges other tabs and repairs a stale lower write', () => {
  const e = environment('425');
  e.receive('900');
  assert.deepEqual(e.observed, [425, 900]);
  e.receive('450');
  assert.equal(e.data.get(KEY), '900');
  assert.deepEqual(e.observed, [425, 900]);
});

test('reads the latest saved maximum before writing and handles out-of-order events', () => {
  const e = environment('425');
  e.data.set(KEY, '1200');
  e.store.record(600);
  assert.equal(e.observed.at(-1), 1200);
  e.target.dispatchEvent(Object.assign(new Event('storage'), {
    key: KEY, newValue: '900', storageArea: e.target.localStorage,
  }));
  assert.equal(e.data.get(KEY), '1200');
  assert.deepEqual(e.writes, []);
});

test('rejects malformed scores without breaking play', () => {
  for (const raw of ['garbage', '-1', '3.5', 'Infinity', '9007199254740992']) {
    const e = environment(raw);
    assert.deepEqual(e.observed, [0]);
    for (const value of [-1, 1.5, NaN, Infinity]) e.store.record(value);
    assert.deepEqual(e.observed, [0]);
    e.store.record(100);
    assert.equal(e.data.get(KEY), '100');
  }
});

test('ignores unrelated storage and detaches on destroy', () => {
  const e = environment('425');
  e.receive('900', { key: 'unrelated' });
  e.receive('900', { storageArea: {} });
  assert.deepEqual(e.observed, [425]);
  e.store.destroy();
  e.receive('1000');
  assert.deepEqual(e.observed, [425]);
});

test('keeps a session score when browser storage is blocked or full', () => {
  for (const blockedGetter of [false, true]) {
    const target = new EventTarget();
    Object.defineProperty(target, 'localStorage', blockedGetter ? {
      get() { throw new Error('Storage blocked'); },
    } : { value: {
      getItem() { throw new Error('Storage blocked'); },
      setItem() { throw new Error('Storage full'); },
    } });
    const observed = [];
    const store = createHighScore({ target, onChange: score => observed.push(score) });
    store.record(700);
    assert.deepEqual(observed, [0, 700]);
    store.destroy();
  }
});
