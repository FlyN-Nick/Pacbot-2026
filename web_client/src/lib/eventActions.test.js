import test from 'node:test';
import assert from 'node:assert/strict';
import { getEventActions, getFrameActivity, isGameReset, enrichGhostEvents } from './eventActions.js';

test('game transitions select the matching audio cue without losing visual event identity', () => {
  const events = [
    { id: 1, type: 'pellet', row: 1, col: 2 },
    { id: 2, type: 'powerPellet', row: 3, col: 1 },
    { id: 3, type: 'ghostEaten', ghostIndex: 0, row: 7, col: 8 },
    { id: 4, type: 'fruitEaten', row: 17, col: 13 },
    { id: 5, type: 'lifeLost' },
    { id: 6, type: 'lifeGained' },
    { id: 7, type: 'levelChanged' },
    { id: 8, type: 'gameStarted' },
    { id: 9, type: 'gameOver' },
  ];
  const { audioCues, visualEvents } = getEventActions(events);
  assert.deepEqual(audioCues.map(({ name }) => name), [
    'chomp', 'frightened', 'ghost', 'fruit', 'death', 'extraLife', 'intermission', 'intro',
  ]);
  assert.deepEqual(audioCues.map(({ event }) => event.id), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual(visualEvents, events);
  assert.equal(visualEvents[2].row, 7);
  assert.equal(visualEvents[2].col, 8);
  assert.equal(Object.hasOwn(visualEvents[2], 'points'), false);
});

test('empty and unknown events produce no audio', () => {
  assert.deepEqual(getEventActions([]), { audioCues: [], visualEvents: [] });
  assert.deepEqual(getEventActions([{ id: 10, type: 'futureEvent' }]).audioCues, []);
});

const activeFrame = {
  mode: 1, lives: 3,
  pacman: { rowState: 23, colState: 13 | 0x40 },
  ghosts: [{ frightState: 8, trappedState: 0 }],
};

test('movement and frightened loops follow active visible play', () => {
  assert.deepEqual(getFrameActivity(activeFrame, true), { active: true, moving: true, frightened: true });
  assert.deepEqual(getFrameActivity({ ...activeFrame, mode: 2 }, true), { active: true, moving: true, frightened: true });
  for (const mode of [0, 10]) {
    assert.deepEqual(getFrameActivity({ ...activeFrame, mode }, true), { active: false, moving: false, frightened: false });
  }
  assert.deepEqual(getFrameActivity(activeFrame, false), { active: false, moving: false, frightened: false });
  assert.deepEqual(getFrameActivity({ ...activeFrame, pacman: { rowState: 32, colState: 32 } }, true), { active: false, moving: false, frightened: false });
  assert.deepEqual(getFrameActivity({ ...activeFrame, lives: 0 }, true), { active: false, moving: false, frightened: false });
});

test('stationary players stop chomping and eaten or spawning ghosts do not sustain frightened audio', () => {
  assert.equal(getFrameActivity({ ...activeFrame, pacman: { rowState: 23, colState: 13 } }, true).moving, false);
  for (const ghost of [{ frightState: 0x80, trappedState: 0 }, { frightState: 8, trappedState: 0x80 }]) {
    assert.equal(getFrameActivity({ ...activeFrame, ghosts: [ghost] }, true).frightened, false);
  }
});

test('server reset is detected before fake extra-life or level cues, while ordinary transitions remain events', () => {
  const previous = { tick: 120, score: 500, level: 2, lives: 1 };
  assert.equal(isGameReset(null, previous), false);
  assert.equal(isGameReset(previous, { tick: 0, score: 0, level: 0, lives: 3 }), true);
  assert.equal(isGameReset(previous, { tick: 121, score: 500, level: 3, lives: 1 }), false);
  assert.equal(isGameReset(previous, { tick: 121, score: 500, level: 2, lives: 0 }), false);
});

test('ghost popups preserve IDs and derive coordinates and sequential awards from the resulting combo', () => {
  const events = [{ id: 20, type: 'ghostEaten', ghostIndex: 0 }, { id: 21, type: 'ghostEaten', ghostIndex: 2 }];
  const frame = {
    ghostCombo: 3,
    pacman: { rowState: 23, colState: 13 | 0x40 },
    ghosts: [
      { rowState: 7 | 0xc0, colState: 8 },
      { rowState: 13, colState: 13 },
      { rowState: 32, colState: 32 },
    ],
  };
  assert.deepEqual(enrichGhostEvents(events, frame), [
    { id: 20, type: 'ghostEaten', ghostIndex: 0, row: 7, col: 8, points: 400 },
    { id: 21, type: 'ghostEaten', ghostIndex: 2, row: 23, col: 13, points: 800 },
  ]);
  assert.deepEqual(events, [{ id: 20, type: 'ghostEaten', ghostIndex: 0 }, { id: 21, type: 'ghostEaten', ghostIndex: 2 }]);
  assert.equal(enrichGhostEvents([events[0]], { ...frame, ghostCombo: 1 })[0].points, 200);
  assert.equal(Object.hasOwn(enrichGhostEvents(events, { ...frame, ghostCombo: 0 })[0], 'points'), false);
  assert.deepEqual(enrichGhostEvents([events[0]], { ...frame, ghostCombo: 1 }, {
    ghosts: [{ rowState: 9 | 0x40, colState: 10 | 0xc0 }],
  })[0], { id: 20, type: 'ghostEaten', ghostIndex: 0, row: 9, col: 10, points: 200 });
});
