import test from 'node:test';
import assert from 'node:assert/strict';
import { planSequence, createSequenceRunner } from './arcadeSequencer.js';

const T = { readyHoldMs: 4207, deathFreezeMs: 990, deathAnimationMs: 2640, deathFrames: 12, deathEndToReadyMs: 132, deathReadyMs: 2000 };
const plan = (kind, mode, lastLife = false) => planSequence({ kind, mode, timings: T, lastLife });
const step = (atMs, action, extra = {}) => ({ atMs, action, ...extra });

test('arcade start shows READY with the intro, then resumes', () => {
  assert.deepEqual(plan('start', 'arcade'), [
    step(0, 'showReady'), step(0, 'cue', { name: 'intro' }), step(4207, 'hideReady'), step(4207, 'resume'),
  ]);
});

test('arcade start detected from another client holds first', () => {
  assert.deepEqual(plan('startDetected', 'arcade'), [step(0, 'hold'), ...plan('start', 'arcade')]);
});

test('competition start shows READY and the intro without touching the server', () => {
  assert.deepEqual(plan('start', 'competition'), [
    step(0, 'showReady'), step(0, 'cue', { name: 'intro' }), step(4207, 'hideReady'),
  ]);
});

test('arcade death freezes, animates, shows READY and resumes', () => {
  assert.deepEqual(plan('death', 'arcade'), [
    step(0, 'hold'), step(0, 'freezeDisplay'), step(990, 'releaseDisplay'), step(990, 'deathStart'),
    step(3762, 'showReady'), step(5762, 'hideReady'), step(5762, 'resume'),
  ]);
});

test('an arcade death on the last life never resumes', () => {
  assert.deepEqual(plan('death', 'arcade', true), [
    step(0, 'hold'), step(0, 'freezeDisplay'), step(990, 'releaseDisplay'), step(990, 'deathStart'),
  ]);
});

test('competition death only starts the animation', () => {
  assert.deepEqual(plan('death', 'competition'), [step(0, 'deathStart')]);
});

test('no competition plan holds or resumes the server', () => {
  for (const kind of ['start', 'startDetected', 'death']) {
    for (const lastLife of [false, true]) {
      const actions = plan(kind, 'competition', lastLife).map(({ action }) => action);
      assert.ok(!actions.includes('hold') && !actions.includes('resume'), `${kind} ${lastLife}`);
    }
  }
});

// Fake timers: advance(ms) fires due timers in time order.
function fakeClock() {
  let now = 0;
  let timers = [];
  return {
    setTimer: (fn, ms) => { const t = { at: now + ms, fn }; timers.push(t); return t; },
    clearTimer: (t) => { timers = timers.filter((x) => x !== t); },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = timers.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
        if (!due) break;
        timers = timers.filter((t) => t !== due);
        now = due.at;
        due.fn();
      }
      now = end;
    },
  };
}

function runnerWith(mode = 'arcade') {
  const clock = fakeClock();
  const done = [];
  let current = mode;
  const runner = createSequenceRunner({
    execute: (s) => done.push(s.action),
    getMode: () => current,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { runner, clock, done, setMode: (m) => { current = m; } };
}

test('the runner executes steps in order at their times', () => {
  const { runner, clock, done } = runnerWith();
  runner.run(plan('start', 'arcade'));
  clock.advance(0);
  assert.deepEqual(done, ['showReady', 'cue']);
  clock.advance(4206);
  assert.deepEqual(done, ['showReady', 'cue']);
  clock.advance(1);
  assert.deepEqual(done, ['showReady', 'cue', 'hideReady', 'resume']);
});

test('cancel drops the remaining steps', () => {
  const { runner, clock, done } = runnerWith();
  runner.run(plan('start', 'arcade'));
  clock.advance(100);
  runner.cancel();
  clock.advance(10000);
  assert.deepEqual(done, ['showReady', 'cue']);
  assert.equal(runner.running, false);
});

test('running a new plan cancels the one in progress', () => {
  const { runner, clock, done } = runnerWith();
  runner.run(plan('start', 'arcade'));
  clock.advance(100);
  runner.run(plan('death', 'competition'));
  clock.advance(10000);
  assert.deepEqual(done, ['showReady', 'cue', 'deathStart']);
});

test('after a switch to competition, pending holds and resumes are skipped', () => {
  const { runner, clock, done, setMode } = runnerWith();
  runner.run(plan('death', 'arcade'));
  clock.advance(0);
  setMode('competition');
  clock.advance(10000);
  assert.deepEqual(done, ['hold', 'freezeDisplay', 'releaseDisplay', 'deathStart', 'showReady', 'hideReady']);
});

test('the runner is running until its last step', () => {
  const { runner, clock } = runnerWith();
  assert.equal(runner.running, false);
  runner.run(plan('start', 'arcade'));
  assert.equal(runner.running, true);
  clock.advance(4206);
  assert.equal(runner.running, true);
  clock.advance(1);
  assert.equal(runner.running, false);
});

test('an arcade death the server pauses for itself is not held again', () => {
  // The server's pause after a real death comes one update later; holding first
  // would leave its pending pause to stop the game again right after the resume.
  const steps = planSequence({ kind: 'death', mode: 'arcade', timings: T, serverPauses: true });
  assert.deepEqual(steps, plan('death', 'arcade').filter(({ action }) => action !== 'hold'));
});
