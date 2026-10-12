import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameEventTracker } from './gameEvents.js';

const frame = (overrides = {}) => ({
  tick: 1,
  mode: 1,
  lives: 3,
  score: 0,
  level: 1,
  ghostCombo: 0,
  pacman: { rowState: 10, colState: 10 },
  ghosts: Array.from({ length: 4 }, () => ({ rowState: 0, colState: 0, frightState: 0, trappedState: 0 })),
  fruit: { rowState: 32, colState: 32, steps: 0 },
  pelletRows: Array(31).fill(0),
  ...overrides,
});

const withGhosts = (ghosts) => frame({ ghosts });

test('initial frame establishes a baseline without emitting events', () => {
  const tracker = createGameEventTracker();
  assert.deepEqual(tracker.update(frame()), []);
});

test('joining active play never emits a start cue on a later pause and resume', () => {
  const tracker = createGameEventTracker();
  assert.deepEqual(tracker.update(frame({ mode: 2 })), []);
  tracker.update(frame({ tick: 2, mode: 0 }));
  assert.deepEqual(tracker.update(frame({ tick: 3, mode: 1 })), []);
  tracker.reset();
  tracker.update(frame({ tick: 4, mode: 0 }));
  assert.deepEqual(tracker.update(frame({ tick: 5, mode: 1 })).map(({ type }) => type), ['gameStarted']);
});

test('removed pellets emit regular and power pellet events with coordinates and points', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[5] = (1 << 2) | (1 << 1);
  tracker.update(frame({ pelletRows: rows }));
  rows[5] = 0;
  const events = tracker.update(frame({ tick: 2, score: 60, pelletRows: rows }));
  assert.deepEqual(events.map(({ type, row, col, points }) => ({ type, row, col, points })), [
    { type: 'pellet', row: 5, col: 1, points: 10 },
    { type: 'pellet', row: 5, col: 2, points: 10 },
  ]);

  const powerTracker = createGameEventTracker();
  const powerRows = Array(31).fill(0);
  powerRows[3] = 1 << 1;
  powerTracker.update(frame({ pelletRows: powerRows }));
  powerRows[3] = 0;
  assert.deepEqual(powerTracker.update(frame({ tick: 2, score: 50, pelletRows: powerRows })).map(({ type, row, col, points }) => ({ type, row, col, points })), [
    { type: 'powerPellet', row: 3, col: 1, points: 50 },
  ]);
});

test('eaten ghost high-bit transitions emit one event per ghost including simultaneous transitions', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame());
  const ghosts = frame().ghosts.map((ghost, index) => ({ ...ghost, trappedState: index < 2 ? 0x80 : 0 }));
  const events = tracker.update(withGhosts(ghosts));
  assert.deepEqual(events.map(({ type, ghostIndex }) => ({ type, ghostIndex })), [
    { type: 'ghostEaten', ghostIndex: 0 },
    { type: 'ghostEaten', ghostIndex: 1 },
  ]);
});

test('fruit pickup matches Pac-Man position and score, while expiry is ignored', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ fruit: { rowState: 12, colState: 8, steps: 10 } }));
  assert.deepEqual(tracker.update(frame({
    tick: 2,
    score: 100,
    pacman: { rowState: 12, colState: 8 },
    fruit: { rowState: 32, colState: 32, steps: 0 },
  })).map(({ type }) => type), ['fruitEaten']);

  const expiryTracker = createGameEventTracker();
  expiryTracker.update(frame({ fruit: { rowState: 12, colState: 8, steps: 1 } }));
  assert.deepEqual(expiryTracker.update(frame({
    tick: 2,
    score: 10,
    pacman: { rowState: 12, colState: 7 },
    fruit: { rowState: 32, colState: 32, steps: 0 },
  })), []);
});

test('fruit collected while crossing its tile emits pickup at the original fruit position', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ pacman: { rowState: 12, colState: 7 }, fruit: { rowState: 12, colState: 8, steps: 10 } }));
  assert.deepEqual(tracker.update(frame({
    tick: 2, score: 100, pacman: { rowState: 12, colState: 9 },
  })).map(({ type, row, col }) => ({ type, row, col })), [{ type: 'fruitEaten', row: 12, col: 8 }]);
});

test('fruit expiry plus ten pellets elsewhere does not emit a pickup', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[5] = 0x3ff;
  tracker.update(frame({ pelletRows: rows, fruit: { rowState: 12, colState: 8, steps: 1 } }));
  const events = tracker.update(frame({ tick: 2, score: 100, pacman: { rowState: 5, colState: 10 } }));
  assert.equal(events.length, 10);
  assert.ok(events.every(({ type }) => type === 'pellet'));
});

test('fruit scoring excludes simultaneous pellet and escalating ghost awards', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[12] = 1 << 7;
  const baseline = frame({ score: 500, ghostCombo: 1, pelletRows: rows, fruit: { rowState: 12, colState: 8, steps: 10 } });
  const ghosts = frame().ghosts.map((ghost, index) => ({ ...ghost, trappedState: index < 2 ? 0x80 : 0 }));
  tracker.update(baseline);
  const events = tracker.update(frame({
    tick: 2, score: 1810, ghostCombo: 3, ghosts, pacman: { rowState: 12, colState: 9 },
  }));
  assert.deepEqual(events.map(({ type }) => type), ['pellet', 'ghostEaten', 'ghostEaten', 'fruitEaten']);

  const expiryTracker = createGameEventTracker();
  expiryTracker.update(baseline);
  const expiryEvents = expiryTracker.update(frame({
    tick: 2, score: 1710, ghostCombo: 3, ghosts, pacman: { rowState: 12, colState: 8 },
  }));
  assert.deepEqual(expiryEvents.map(({ type }) => type), ['pellet', 'ghostEaten', 'ghostEaten']);
});

test('a power pellet resets the combo used to account for simultaneous ghost scoring', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[3] = 1 << 1;
  tracker.update(frame({ ghostCombo: 2, pelletRows: rows, fruit: { rowState: 12, colState: 8, steps: 10 } }));
  const ghosts = frame().ghosts.map((ghost, index) => ({ ...ghost, trappedState: index === 0 ? 0x80 : 0 }));
  assert.deepEqual(tracker.update(frame({
    tick: 2, score: 350, ghostCombo: 1, ghosts, pacman: { rowState: 12, colState: 9 },
  })).map(({ type }) => type), ['powerPellet', 'ghostEaten', 'fruitEaten']);
});

test('fruit residual handles a wrapped uint16 packet score', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ score: 65500, fruit: { rowState: 12, colState: 8, steps: 10 } }));
  assert.deepEqual(tracker.update(frame({
    tick: 2, score: 64, pacman: { rowState: 12, colState: 9 },
  })).map(({ type }) => type), ['fruitEaten']);
});

test('fruit pickup is recognized when its score increment reaches the server cap', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ score: 65490, fruit: { rowState: 12, colState: 8, steps: 10 } }));
  assert.deepEqual(tracker.update(frame({
    tick: 2, score: 65535, pacman: { rowState: 12, colState: 9 },
  })).map(({ type }) => type), ['fruitEaten']);
});

test('score saturation without an unexplained increment does not invent a fruit pickup', () => {
  const rows = Array(31).fill(0);
  rows[12] = 1 << 8;
  for (const score of [65530, 65535]) {
    const tracker = createGameEventTracker();
    tracker.update(frame({ score, pelletRows: rows, fruit: { rowState: 12, colState: 8, steps: 1 } }));
    assert.deepEqual(tracker.update(frame({
      tick: 2, score: 65535, pacman: { rowState: 12, colState: 8 },
    })).map(({ type }) => type), ['pellet']);
  }
});

test('life loss and gain are distinct transitions', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame());
  assert.deepEqual(tracker.update(frame({ tick: 2, lives: 2 })).map(({ type }) => type), ['lifeLost']);
  assert.deepEqual(tracker.update(frame({ tick: 3, lives: 3 })).map(({ type }) => type), ['lifeGained']);
});

test('active play start and final life loss emit start and game-over cues', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ mode: 0, lives: 1 }));
  assert.deepEqual(tracker.update(frame({ tick: 2, mode: 1, lives: 1 })).map(({ type }) => type), ['gameStarted']);
  assert.deepEqual(tracker.update(frame({ tick: 3, mode: 0, lives: 0 })).map(({ type }) => type), ['lifeLost', 'gameOver']);
});

test('gameStarted emits once per session, including after explicit reset', () => {
  const tracker = createGameEventTracker();
  tracker.update(frame({ mode: 0 }));
  assert.deepEqual(tracker.update(frame({ tick: 2, mode: 1 })).map(({ type }) => type), ['gameStarted']);
  tracker.update(frame({ tick: 3, mode: 0 }));
  assert.deepEqual(tracker.update(frame({ tick: 4, mode: 1 })), []);

  tracker.reset();
  tracker.update(frame({ tick: 5, mode: 0 }));
  assert.deepEqual(tracker.update(frame({ tick: 6, mode: 1 })).map(({ type }) => type), ['gameStarted']);
});

test('level change emits once and treats the new frame as a reset baseline', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[5] = 1;
  tracker.update(frame({ pelletRows: rows }));
  const events = tracker.update(frame({ tick: 2, level: 2, pelletRows: Array(31).fill(0) }));
  assert.deepEqual(events.map(({ type }) => type), ['levelChanged']);
  assert.deepEqual(tracker.update(frame({ tick: 3, score: 10, level: 2, pelletRows: rows })), []);
});

test('reset clears the baseline and event ids continue increasing', () => {
  const tracker = createGameEventTracker();
  const rows = Array(31).fill(0);
  rows[1] = 1;
  tracker.update(frame({ pelletRows: rows }));
  rows[1] = 0;
  const first = tracker.update(frame({ tick: 2, score: 10, pelletRows: rows }));
  tracker.reset();
  assert.deepEqual(tracker.update(frame({ tick: 3, lives: 1, pelletRows: Array(31).fill(0) })), []);
  const next = tracker.update(frame({ tick: 4, lives: 2 }));
  assert.equal(next[0].type, 'lifeGained');
  assert.ok(next[0].id > first[0].id);
});
