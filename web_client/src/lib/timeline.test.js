import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTimelineParams, createTimeline, deathFrameOffsetsMs, createFrameTimelineTracker } from './timeline.js';

const clock = (...times) => {
  let i = 0;
  return () => times[Math.min(i++, times.length - 1)];
};

test('timeline mode honors ws and bot overrides', () => {
  assert.deepEqual(parseTimelineParams('?timeline=1&ws=4100&bot=off'),
    { enabled: true, wsPort: 4100, botEnabled: false });
});

test('ws and bot are ignored without timeline mode', () => {
  assert.deepEqual(parseTimelineParams('?ws=4100&bot=off'),
    { enabled: false, wsPort: null, botEnabled: true });
});

test('invalid ws ports are ignored', () => {
  assert.equal(parseTimelineParams('?timeline=1&ws=abc').wsPort, null);
  assert.equal(parseTimelineParams('?timeline=1&ws=70000').wsPort, null);
});

test('a disabled timeline records nothing', () => {
  const timeline = createTimeline({ enabled: false, now: clock(1000) });
  timeline.anchor('readyShown');
  timeline.record('gameStarted');
  assert.deepEqual(timeline.events(), []);
});

test('times are seconds since the first anchor', () => {
  const timeline = createTimeline({ enabled: true, now: clock(1000, 1500) });
  timeline.anchor('readyShown');
  timeline.record('gameStarted');
  assert.deepEqual(timeline.events(), [
    { t: 0, type: 'readyShown' },
    { t: 0.5, type: 'gameStarted' },
  ]);
});

test('a later anchor keeps the time base', () => {
  const timeline = createTimeline({ enabled: true, now: clock(1000, 3000, 4500) });
  timeline.anchor('pacmanCaught');
  timeline.record('deathEnded');
  timeline.anchor('readyShown');
  assert.deepEqual(timeline.events().map(({ t }) => t), [0, 2, 3.5]);
});

test('events at an explicit time are sorted into place', () => {
  const timeline = createTimeline({ enabled: true, now: clock(1000, 6000) });
  timeline.anchor('musicStarted');
  timeline.record('musicEnded', {}, { atMs: 5220 });
  timeline.record('gameStarted');
  const events = timeline.events();
  assert.deepEqual(events.map(({ type }) => type), ['musicStarted', 'musicEnded', 'gameStarted']);
  assert.ok(Math.abs(events[1].t - 4.22) < 1e-9);
});

test('reset clears events and starts a new time base', () => {
  const timeline = createTimeline({ enabled: true, now: clock(1000, 2000, 9000) });
  timeline.anchor('readyShown');
  timeline.record('gameStarted');
  timeline.reset();
  assert.deepEqual(timeline.events(), []);
  timeline.anchor('pacmanCaught');
  assert.deepEqual(timeline.events(), [{ t: 0, type: 'pacmanCaught' }]);
});

test('event data is kept', () => {
  const timeline = createTimeline({ enabled: true, now: clock(1000) });
  timeline.record('actorMoved', { actor: 'blinky' });
  assert.deepEqual(timeline.events(), [{ t: 0, type: 'actorMoved', actor: 'blinky' }]);
});

test('death frames are spread evenly over the animation', () => {
  const offsets = deathFrameOffsetsMs({ deathAnimationMs: 1800, deathFrames: 10 });
  assert.equal(offsets.length, 10);
  assert.equal(offsets[0], 0);
  assert.equal(offsets[1], 180);
  assert.equal(offsets[9], 1620);
});

const ghost = (row, col, frightSteps = 0) =>
  ({ rowState: row, colState: col, frightState: frightSteps, trappedState: 0 });
const frame = ({ tick = 0, pacman = [23, 13], ghosts = [[11, 13], [13, 13], [14, 11], [14, 15]], fright = 0 } = {}) => ({
  tick,
  pacman: { rowState: pacman[0], colState: pacman[1] },
  ghosts: ghosts.map(([row, col]) => ghost(row, col, fright)),
});

test('the first frame produces no events', () => {
  const tracker = createFrameTimelineTracker();
  assert.deepEqual(tracker.update(frame(), 12), []);
});

test('moving actors are reported by name', () => {
  const tracker = createFrameTimelineTracker();
  tracker.update(frame(), 12);
  const events = tracker.update(frame({ pacman: [23, 12], ghosts: [[11, 12], [13, 13], [14, 11], [14, 15]] }), 12);
  assert.deepEqual(events, [
    { type: 'actorMoved', data: { actor: 'pacman' } },
    { type: 'actorMoved', data: { actor: 'blinky' } },
  ]);
});

test('a direction change without a cell change is not a move', () => {
  const tracker = createFrameTimelineTracker();
  tracker.update(frame(), 12);
  assert.deepEqual(tracker.update(frame({ pacman: [23 | 0x40, 13] }), 12), []);
});

test('fright start, each flash, and fright end are reported', () => {
  const tracker = createFrameTimelineTracker();
  tracker.update(frame(), 12);
  assert.deepEqual(tracker.update(frame({ fright: 40 }), 12),
    [{ type: 'frightStarted', data: {} }]);
  // Within the last 10 steps, the second half of each update period flashes
  assert.deepEqual(tracker.update(frame({ fright: 10, tick: 6 }), 12),
    [{ type: 'frightFlashStart', data: { flash: 1 } }]);
  assert.deepEqual(tracker.update(frame({ fright: 9, tick: 12 }), 12), []);
  assert.deepEqual(tracker.update(frame({ fright: 9, tick: 18 }), 12),
    [{ type: 'frightFlashStart', data: { flash: 2 } }]);
  assert.deepEqual(tracker.update(frame({ fright: 0, tick: 24 }), 12),
    [{ type: 'frightEnded', data: {} }]);
});

test('flash numbering restarts with each fright', () => {
  const tracker = createFrameTimelineTracker();
  tracker.update(frame(), 12);
  tracker.update(frame({ fright: 10, tick: 6 }), 12);
  tracker.update(frame({ fright: 0, tick: 12 }), 12);
  tracker.update(frame({ fright: 40, tick: 13 }), 12);
  assert.deepEqual(tracker.update(frame({ fright: 10, tick: 18 }), 12),
    [{ type: 'frightFlashStart', data: { flash: 1 } }]);
});
