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
    reference: { 'levelComplete.flashCount': ref(4, 'count'), 'start.readyToGameStarted': ref(4.27) },
    gui, gameFps: 24,
  });
  assert.equal(row(rows, 'levelComplete.flashCount').status, 'not implemented');
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

const deathEvents = [
  { t: 0, type: 'readyShown' }, { t: 1, type: 'gameStarted' }, { t: 2, type: 'pacmanCaught' },
  { t: 3, type: 'deathFrame', frame: 1 }, { t: 4, type: 'deathEnded' },
  { t: 5, type: 'readyShown' }, { t: 7, type: 'gameStarted' },
];

test('post-death READY is measured from the READY after the death', () => {
  const reduced = reduceTimeline(timeline('death', deathEvents));
  assert.equal(reduced['death.readyToResume'].value, 2);
  assert.equal(reduced['death.endToReady'].value, 1);
});

test('post-death READY rows do not apply in competition mode', () => {
  const reference = { 'death.endToReady': ref(1), 'death.readyToResume': ref(2) };
  const gui = [timeline('death', deathEvents)];
  const competition = compareTimelines({ reference, gui, gameFps: 24, mode: 'competition' });
  assert.equal(row(competition, 'death.endToReady').status, 'not applicable');
  assert.equal(row(competition, 'death.readyToResume').status, 'not applicable');
  const arcade = compareTimelines({ reference, gui, gameFps: 24, mode: 'arcade' });
  assert.equal(row(arcade, 'death.endToReady').status, 'pass');
  assert.equal(row(arcade, 'death.readyToResume').status, 'pass');
});

test('the GUI now produces siren steps', async () => {
  const { GUI_NOT_IMPLEMENTED } = await import('./gaps.mjs');
  assert.equal(GUI_NOT_IMPLEMENTED.has('sirenStep'), false);
});

test('relative tolerance is 5% of the target', () => {
  assert.ok(Math.abs(toleranceFor('relative', 24, 20) - 1) < 1e-12);
});

test('eyes speed comes from the GUI eyes journey', () => {
  const reduced = reduceTimeline(timeline('ghostEaten', [
    { t: 0, type: 'ghostEaten' }, { t: 2.2, type: 'eyesTravelled', tiles: 20, seconds: 1.25 },
  ]));
  assert.equal(reduced['ghostEaten.eyesSpeed'].value, 16);
  assert.equal(reduced['ghostEaten.eyesSpeed'].unit, 'tiles/s');
});

test('eyes speed comes from the arcade eyes journey', () => {
  const reduced = reduceTimeline(timeline('ghostEaten', [
    { t: 1, type: 'eyesStarted' }, { t: 3, type: 'eyesArrived', tiles: 30 },
  ]));
  assert.equal(reduced['ghostEaten.eyesSpeed'].value, 15);
});

test('the eyes sound period comes from the end of the eyes sound', () => {
  const reduced = reduceTimeline(timeline('ghostEaten', [
    { t: 1, type: 'eyesSoundStarted' }, { t: 2, type: 'eyesSoundEnded', periodSeconds: 0.14 },
  ]));
  assert.equal(reduced['ghostEaten.eyesSoundPeriod'].value, 0.14);
});

test('eyes speed passes within 5%', () => {
  const reference = { 'ghostEaten.eyesSpeed': ref(16, 'tiles/s') };
  const at = (speed) => compareTimelines({ reference, gameFps: 24, gui: [timeline('ghostEaten', [
    { t: 0, type: 'eyesTravelled', tiles: speed, seconds: 1 },
  ])] });
  assert.equal(row(at(15.5), 'ghostEaten.eyesSpeed').status, 'pass');
  assert.equal(row(at(14), 'ghostEaten.eyesSpeed').status, 'fail');
});

test('the eyes sound length row is replaced and the eyes events are implemented', async () => {
  const rows = compareTimelines({ reference: {}, gui: [], gameFps: 24 });
  assert.equal(row(rows, 'ghostEaten.eyesSoundLength'), undefined);
  const { GUI_NOT_IMPLEMENTED } = await import('./gaps.mjs');
  assert.equal(GUI_NOT_IMPLEMENTED.has('eyesSoundStarted'), false);
  assert.equal(GUI_NOT_IMPLEMENTED.has('eyesSoundEnded'), false);
});

test('eyes speed does not apply in competition mode, which keeps the quick flight', () => {
  const reference = { 'ghostEaten.eyesSpeed': ref(14.58, 'tiles/s') };
  const rows = compareTimelines({ reference, gameFps: 24, mode: 'competition', gui: [timeline('ghostEaten', [])] });
  assert.equal(row(rows, 'ghostEaten.eyesSpeed').status, 'not applicable');
});
