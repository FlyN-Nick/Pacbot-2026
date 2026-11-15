import test from 'node:test';
import assert from 'node:assert/strict';
import { planSequence, createSequenceRunner, resumedElsewhere } from './arcadeSequencer.js';

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

const ghosts = [
  { ghostIndex: 0, row: 5, col: 6, points: 200 },
  { ghostIndex: 2, row: 5, col: 7, points: 400 },
];
const GT = { ...T, ghostFreezeMs: 941 };

test('arcade ghost eaten freezes with the scores, then sends the eyes home', () => {
  assert.deepEqual(planSequence({ kind: 'ghostEaten', mode: 'arcade', timings: GT, ghosts }), [
    step(0, 'hold'),
    step(0, 'hideActors', { ghostIndexes: [0, 2] }),
    step(0, 'showScore', { scores: ghosts }),
    step(0, 'cue', { name: 'ghost' }),
    step(941, 'hideScore'),
    step(941, 'showActors'),
    step(941, 'startEyes', { ghosts }),
    step(941, 'resume'),
  ]);
});

test('competition ghost eaten only shows the scores', () => {
  assert.deepEqual(planSequence({ kind: 'ghostEaten', mode: 'competition', timings: GT, ghosts }), [
    step(0, 'showScore', { scores: ghosts }),
    step(0, 'cue', { name: 'ghost' }),
    step(941, 'hideScore'),
  ]);
});

test('a switch to competition during the ghost freeze skips the resume', () => {
  const { runner, clock, done, setMode } = runnerWith();
  runner.run(planSequence({ kind: 'ghostEaten', mode: 'arcade', timings: GT, ghosts }));
  clock.advance(0);
  setMode('competition');
  clock.advance(2000);
  assert.deepEqual(done, ['hold', 'hideActors', 'showScore', 'cue', 'hideScore', 'showActors', 'startEyes']);
});

const LT = {
  ...T, levelFlashStartMs: 1931, levelFlashHalfMs: 198, levelFlashCount: 4,
  levelMazeBlankMs: 3515, levelNewBoardMs: 3845, levelReadyMs: 3927, levelReadyHoldMs: 1900,
};
const levelPlan = (mode) => planSequence({ kind: 'levelComplete', mode, timings: LT });

test('arcade level complete freezes, flashes 4 times, shows the new board and READY, then resumes', () => {
  const steps = levelPlan('arcade');
  const whites = steps.filter((s) => s.action === 'mazeFlash' && s.white);
  const blues = steps.filter((s) => s.action === 'mazeFlash' && !s.white);
  assert.deepEqual(whites.map(({ atMs, flash }) => [atMs, flash]), [[1931, 1], [2327, 2], [2723, 3], [3119, 4]]);
  assert.deepEqual(blues.map(({ atMs }) => atMs), [2129, 2525, 2921, 3317]);
  assert.deepEqual(steps.slice(0, 4), [
    step(0, 'freezeDisplay'), step(0, 'levelFreeze'),
    step(1931, 'hideActors', { all: true }), step(1931, 'mazeFlash', { white: true, flash: 1 }),
  ]);
  assert.deepEqual(steps.slice(-8), [
    step(3317, 'mazeFlash', { white: false }),
    step(3515, 'mazeBlank', { blank: true }),
    step(3845, 'mazeBlank', { blank: false }), step(3845, 'releaseDisplay'),
    step(3927, 'showActors', { all: true }), step(3927, 'showReady'),
    step(5827, 'hideReady'), step(5827, 'resume'),
  ]);
  assert.ok(!steps.some((s) => s.action === 'hold'));
  for (let i = 1; i < steps.length; i++) assert.ok(steps[i].atMs >= steps[i - 1].atMs, `sorted at ${i}`);
});

test('competition level complete shows the same flash but no READY and no resume', () => {
  const steps = levelPlan('competition');
  const actions = steps.map(({ action }) => action);
  for (const action of ['hold', 'resume', 'showReady', 'hideReady']) assert.ok(!actions.includes(action), action);
  assert.deepEqual(steps.at(-1), step(3927, 'showActors', { all: true }));
  assert.deepEqual(steps.slice(0, -1), levelPlan('arcade').filter((s) => s.atMs < 3927));
});

test('a switch to competition during the level sequence skips the resume', () => {
  const { runner, clock, done, setMode } = runnerWith();
  runner.run(levelPlan('arcade'));
  clock.advance(1000);
  setMode('competition');
  clock.advance(10000);
  assert.ok(!done.includes('resume'));
  assert.ok(done.includes('showReady'));
});

test('a level sequence is abandoned when play resumes from somewhere else', () => {
  assert.equal(resumedElsewhere({ runningKind: 'levelComplete', wasPaused: true, nowRunning: true }), true);
  // Still paused, or never paused (the moments before the server's own pause), or another sequence
  assert.equal(resumedElsewhere({ runningKind: 'levelComplete', wasPaused: true, nowRunning: false }), false);
  assert.equal(resumedElsewhere({ runningKind: 'levelComplete', wasPaused: false, nowRunning: true }), false);
  assert.equal(resumedElsewhere({ runningKind: 'death', wasPaused: true, nowRunning: true }), false);
  assert.equal(resumedElsewhere({ runningKind: null, wasPaused: true, nowRunning: true }), false);
});

test('steps due at once run immediately, so no frame paints before a freeze', () => {
  const { runner, done } = runnerWith();
  runner.run(plan('death', 'arcade'));
  assert.deepEqual(done, ['hold', 'freezeDisplay']);
});

test('the level plan shows every actor explicitly', () => {
  const show = levelPlan('arcade').find((s) => s.action === 'showActors');
  assert.deepEqual(show, step(3927, 'showActors', { all: true }));
});

const modeRelease=async()=>{
 const module=await import('./arcadeSequencer.js');assert.equal(typeof module.createModeChangeRelease,'function');return module.createModeChangeRelease();
};
test('switching an owned arcade sequence releases its acknowledged pause exactly once',async()=>{
 const release=await modeRelease();release.capture({mode:'arcade',running:true,pendingResume:true,socketOpen:true});
 assert.equal(release.consume({paused:true,socketOpen:true}),true);assert.equal(release.consume({paused:true,socketOpen:true}),false);
});
test('a pause acknowledgment after the mode switch consumes the pending release',async()=>{
 const release=await modeRelease();release.capture({mode:'arcade',running:true,pendingResume:true,socketOpen:true});
 assert.equal(release.consume({paused:false,socketOpen:true}),false);assert.equal(release.consume({paused:true,socketOpen:true}),true);
});
test('manual pause, last-life, competition and disconnected sequences never acquire resume ownership',async()=>{
 const defaults={mode:'arcade',running:true,pendingResume:true,socketOpen:true};
 for(const override of [{running:false},{pendingResume:false},{mode:'competition'},{socketOpen:false}]) {
  const release=await modeRelease();release.capture({...defaults,...override});assert.equal(release.consume({paused:true,socketOpen:true}),false);
 }
});
test('an explicit stop or reset cancels a pending mode-change release',async()=>{
 const release=await modeRelease();release.capture({mode:'arcade',running:true,pendingResume:true,socketOpen:true});release.cancel();
 assert.equal(release.consume({paused:true,socketOpen:true}),false);
});
