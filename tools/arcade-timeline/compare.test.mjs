import test from 'node:test';
import assert from 'node:assert/strict';
import { toleranceFor, reduceTimeline, compareTimelines, movementDuringReady, formatReport } from './compare.mjs';

const timeline = (scenario, events) => ({ scenario, events });
const row = (rows, key) => rows.find((r) => r.key === key);
const ref = (value, unit = 's') => ({ value, unit, source: 'test' });

test('tolerances follow the spec', () => {
  assert.ok(Math.abs(toleranceFor('animation', 24) - 1 / 60.606) < 1e-12);
  assert.equal(toleranceFor('audio', 24), 0.05);
  assert.ok(Math.abs(toleranceFor('tick', 24) - 0.0417) < 1e-4);
  assert.equal(toleranceFor('count', 24), 0);
});

test('a gap within tolerance passes and one outside fails', () => {
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 4.25, type: 'gameStarted' }])];
  const pass = compareTimelines({ reference: { 'start.readyToGameStarted': ref(4.27) }, gui, gameFps: 24 });
  assert.equal(row(pass, 'start.readyToGameStarted').status, 'pass');
  const fail = compareTimelines({ reference: { 'start.readyToGameStarted': ref(4.5) }, gui, gameFps: 24 });
  assert.equal(row(fail, 'start.readyToGameStarted').status, 'fail');
  assert.equal(row(fail, 'start.readyToGameStarted').ours, 4.25);
});

test('a gap whose end never comes did not complete', () => {
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 0.1, type: 'musicStarted' }])];
  const rows = compareTimelines({ reference: { 'start.musicLength': ref(4.22) }, gui, gameFps: 24 });
  assert.equal(row(rows, 'start.musicLength').status, 'did not complete');
});

test('a gap whose events never appear did not complete when the GUI implements them', () => {
  // e.g. audio locked in the browser: the music never starts
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }])];
  const rows = compareTimelines({ reference: { 'start.musicLength': ref(4.22) }, gui, gameFps: 24 });
  assert.equal(row(rows, 'start.musicLength').status, 'did not complete');
});

test('a gap using an event the GUI does not produce yet is not implemented', () => {
  const gui = [timeline('levelComplete', [{ t: 0, type: 'levelCleared' }])];
  const rows = compareTimelines({ reference: { 'levelComplete.toFirstFlash': ref(1.93) }, gui, gameFps: 24 });
  assert.equal(row(rows, 'levelComplete.toFirstFlash').status, 'not implemented');
});

test('reference keys the GUI cannot produce yet do not stop the report', () => {
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 1.25, type: 'gameStarted' }])];
  const rows = compareTimelines({
    reference: { 'siren.step1.pelletsRemaining': ref(64, 'count'), 'start.readyToGameStarted': ref(4.27) },
    gui, gameFps: 24,
  });
  assert.equal(row(rows, 'siren.step1.pelletsRemaining').status, 'not implemented');
  assert.equal(row(rows, 'start.readyToGameStarted').status, 'fail');
});

test('a measurement without a reference entry is reported as such', () => {
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 1.25, type: 'gameStarted' }])];
  const rows = compareTimelines({ reference: {}, gui, gameFps: 24 });
  assert.equal(row(rows, 'start.readyToGameStarted').status, 'no reference');
  assert.equal(row(rows, 'start.readyToGameStarted').ours, 1.25);
});

test('actors moving during READY are listed', () => {
  const moved = timeline('start', [
    { t: 0, type: 'readyShown' },
    { t: 0.2, type: 'actorMoved', actor: 'blinky' },
    { t: 1.25, type: 'gameStarted' },
    { t: 1.5, type: 'actorMoved', actor: 'pinky' },
  ]);
  assert.deepEqual(movementDuringReady(moved), ['blinky']);
  const still = timeline('start', [
    { t: 0, type: 'readyShown' },
    { t: 1.25, type: 'gameStarted' },
    { t: 1.5, type: 'actorMoved', actor: 'blinky' },
  ]);
  assert.deepEqual(movementDuringReady(still), []);
});

test('moves before or with READY also count', () => {
  const early = timeline('start', [
    { t: -0.04, type: 'actorMoved', actor: 'pinky' },
    { t: 0, type: 'readyShown' },
    { t: 0, type: 'actorMoved', actor: 'blinky' },
    { t: 1.25, type: 'gameStarted' },
  ]);
  assert.deepEqual(movementDuringReady(early), ['pinky', 'blinky']);
});

test('movement during READY fails the start check', () => {
  const gui = [timeline('start', [
    { t: 0, type: 'readyShown' },
    { t: 0.2, type: 'actorMoved', actor: 'blinky' },
    { t: 1.25, type: 'gameStarted' },
  ])];
  const check = row(compareTimelines({ reference: {}, gui, gameFps: 24 }), 'start.noMovementDuringReady');
  assert.equal(check.status, 'fail');
  assert.deepEqual(check.moved, ['blinky']);
});

test('a gap ends at the first matching event after its start', () => {
  const reduced = reduceTimeline(timeline('death', [
    { t: -0.5, type: 'deathEnded' },
    { t: 0, type: 'deathFrame', frame: 1 },
    { t: 1.8, type: 'deathEnded' },
  ]));
  assert.deepEqual(reduced['death.animationLength'], { value: 1.8, unit: 's' });
});

test('counts and siren steps are reduced', () => {
  const level = reduceTimeline(timeline('levelComplete', [
    { t: 0, type: 'levelCleared' },
    { t: 1, type: 'mazeFlash', flash: 1 },
    { t: 1.2, type: 'mazeFlash', flash: 2 },
    { t: 1.4, type: 'mazeFlash', flash: 3 },
  ]));
  assert.deepEqual(level['levelComplete.flashCount'], { value: 3, unit: 'count' });
  assert.ok(Math.abs(level['levelComplete.toFirstFlash'].value - 1) < 1e-9);

  const siren = reduceTimeline(timeline('siren', [
    { t: 0, type: 'sirenStep', pelletsRemaining: 128, periodSeconds: 0.6 },
    { t: 30, type: 'sirenStep', pelletsRemaining: 64, periodSeconds: 0.5 },
  ]));
  assert.deepEqual(siren['siren.step2.pelletsRemaining'], { value: 64, unit: 'count' });
  assert.deepEqual(siren['siren.step2.loopPeriod'], { value: 0.5, unit: 's' });
});

test('the report has one line per row with its status', () => {
  const gui = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 1.25, type: 'gameStarted' }])];
  const report = formatReport(compareTimelines({
    reference: { 'start.readyToGameStarted': ref(4.27) }, gui, gameFps: 24,
  }));
  const line = report.split('\n').find((l) => l.startsWith('start.readyToGameStarted'));
  assert.match(line, /arcade 4\.270s/);
  assert.match(line, /ours 1\.250s/);
  assert.match(line, /FAIL/);
});

test('a siren step without a measurable loop period keeps only its pellet count', () => {
  const siren = reduceTimeline(timeline('siren', [
    { t: 0, type: 'sirenStep', pelletsRemaining: 27 },
  ]));
  assert.deepEqual(siren['siren.step1.pelletsRemaining'], { value: 27, unit: 'count' });
  assert.equal('siren.step1.loopPeriod' in siren, false);
});

test('game-rule measurements are informational, not failures', () => {
  const gui = [timeline('ghostEaten', [{ t: 0, type: 'frightStarted' }, { t: 19.8, type: 'frightEnded' }])];
  const fright = row(compareTimelines({ reference: { 'ghostEaten.frightLength': ref(5.92) }, gui, gameFps: 24 }),
    'ghostEaten.frightLength');
  assert.equal(fright.status, 'info');
  assert.match(formatReport([fright]), /INFO \(game rule\)/);
});

test('in competition mode, pauses must be zero', () => {
  const reference = { 'start.readyToGameStarted': ref(4.21) };
  const held = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 1.25, type: 'gameStarted' }])];
  const instant = [timeline('start', [{ t: 0, type: 'readyShown' }, { t: 0.01, type: 'gameStarted' }])];
  const heldRow = row(compareTimelines({ reference, gui: held, gameFps: 24, mode: 'competition' }), 'start.readyToGameStarted');
  assert.equal(heldRow.status, 'fail');
  assert.equal(heldRow.target, 0);
  assert.equal(row(compareTimelines({ reference, gui: instant, gameFps: 24, mode: 'competition' }),
    'start.readyToGameStarted').status, 'pass');
});

test('in competition mode, presentation still targets the arcade', () => {
  const gui = [timeline('death', [{ t: 0, type: 'deathFrame', frame: 1 }, { t: 1.8, type: 'deathEnded' }])];
  const rows = compareTimelines({ reference: { 'death.animationLength': ref(2.64) }, gui, gameFps: 24, mode: 'competition' });
  assert.equal(row(rows, 'death.animationLength').status, 'fail');
  assert.equal(row(rows, 'death.animationLength').target, 2.64);
});

test('the READY movement check does not apply in competition mode', () => {
  const gui = [timeline('start', [
    { t: 0, type: 'readyShown' }, { t: 0.2, type: 'actorMoved', actor: 'blinky' }, { t: 0.3, type: 'gameStarted' },
  ])];
  const check = row(compareTimelines({ reference: {}, gui, gameFps: 24, mode: 'competition' }), 'start.noMovementDuringReady');
  assert.equal(check.status, 'not applicable');
});
