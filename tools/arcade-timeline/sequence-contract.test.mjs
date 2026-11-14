import test from 'node:test';
import assert from 'node:assert/strict';

// Dynamic loading keeps the first red run focused on the absent contract.
const contract = import('./sequence-contract.mjs');
const coverage = import('./sequence-coverage.mjs');
// Both imports are awaited inside tests so a missing module is a test failure.
contract.catch(() => {});
coverage.catch(() => {});

function sample(id = 'ready-visible', frame = 100, state = { phase: 'ready', actorsVisible: true }) {
  return {
    id, event: 'ready', offsetFrames: frame - 100,
    emulatedFrame: frame, paintedFrame: frame + 1,
    image: `frames/${id}.png`, dimensions: { width: 224, height: 288 }, state,
    alignment: { method: 'paint-observation', paintedFrame: frame + 1, state: structuredClone(state), evidence: ['observations/paint.json'] },
  };
}
function manifest(samples = [sample()], kind = 'renderer-reference') {
  return { version: 2, kind, scenario: 'ready-movement', provenance: { source: 'test-observation' }, samples };
}

test('rejects_duplicate_or_unordered_samples', async () => {
  const { validateSequence } = await contract;
  assert.throws(() => validateSequence(manifest([sample(), sample('ready-visible', 101)])), /duplicate/i);
  assert.throws(() => validateSequence(manifest([sample('later', 101), sample('earlier', 100)])), /order/i);
  const reversedEmulation = [sample('a', 100), sample('b', 101)];
  reversedEmulation[1].emulatedFrame = 99;
  assert.throws(() => validateSequence(manifest(reversedEmulation)), /order/i);
});

test('reports_missing_actual_and_reference_checkpoints', async () => {
  const { matchSamples } = await contract;
  const reference = manifest([sample('ready-visible'), sample('first-movement', 101)]);
  const actual = manifest([sample('ready-visible'), sample('unexpected', 101)], 'renderer-actual');
  const result = matchSamples(reference, actual);
  assert.deepEqual(result.pairs.map(pair => pair.id), ['ready-visible']);
  assert.deepEqual(result.issues.map(issue => [issue.code, issue.id]), [
    ['missing-actual', 'first-movement'], ['missing-reference', 'unexpected'],
  ]);
});

test('rejects_incompatible_painted_state', async () => {
  const { validateSequence, matchSamples } = await contract;
  const reference = manifest();
  const moving = sample('ready-visible', 100, { phase: 'moving', actorsVisible: true });
  const actual = manifest([moving], 'renderer-actual');
  const result = matchSamples(reference, actual);
  assert.equal(result.pairs.length, 0);
  assert.equal(result.issues[0].code, 'incompatible-state');
  moving.alignment.state = { phase: 'ready', actorsVisible: true };
  assert.throws(() => validateSequence(actual), /painted state/i);
});

test('preserves_source_state_and_separate_paint_identifiers', async () => {
  const { validateSequence, matchSamples } = await contract;
  const reference = manifest();
  const actual = structuredClone(reference);
  actual.kind = 'renderer-actual';
  actual.samples[0].paintedFrame = 7;
  actual.samples[0].alignment.paintedFrame = 7;
  actual.provenance.adapterInputs = { pacman: { phase: 'ready' } };
  assert.equal(validateSequence(actual), actual);
  const result = matchSamples(reference, actual);
  assert.equal(result.issues.length, 0);
  assert.equal(result.pairs[0].reference, reference.samples[0]);
  assert.equal(result.pairs[0].actual, actual.samples[0]);
  assert.equal(result.pairs[0].reference.emulatedFrame, 100);
  assert.equal(result.pairs[0].actual.paintedFrame, 7);
});

test('rejects_missing_metadata_unknown_versions_and_non_native_renderer_frames', async () => {
  const { validateSequence } = await contract;
  assert.equal(validateSequence(manifest()).version, 2);
  for (const key of ['kind', 'scenario', 'provenance', 'samples']) {
    const bad = manifest(); delete bad[key]; assert.throws(() => validateSequence(bad), undefined, key);
  }
  for (const key of ['id', 'event', 'offsetFrames', 'emulatedFrame', 'paintedFrame', 'image', 'dimensions', 'state', 'alignment']) {
    const bad = manifest(); delete bad.samples[0][key]; assert.throws(() => validateSequence(bad), undefined, key);
  }
  for (const edit of [
    m => { m.version = 1; }, m => { m.version = 3; }, m => { m.samples = []; },
    m => { m.samples[0].dimensions.width = 448; },
    m => { m.samples[0].alignment.evidence = []; },
    m => { m.samples[0].alignment.paintedFrame = 999; },
    m => { m.samples[0].alignment.method = ''; },
    m => { m.samples[0].offsetFrames = 0.5; },
    m => { m.samples[0].state = { unavailable: undefined }; },
  ]) {
    const bad = manifest(); edit(bad); assert.throws(() => validateSequence(bad));
  }
  const live = manifest([sample()], 'live');
  delete live.samples[0].emulatedFrame;
  live.samples[0].dimensions = { width: 800, height: 600 };
  assert.equal(validateSequence(live), live);
});

test('rejects_non_artifact_paths_for_images_and_alignment_evidence', async () => {
  const { validateSequence } = await contract;
  for (const path of ['/tmp/a.png', '../a.png', 'frames/../a.png', 'https://example.com/a.png', 'C:\\a.png', 'frames\\a.png', '', 'a.png?x=1', './a.png']) {
    const image = manifest(); image.samples[0].image = path;
    assert.throws(() => validateSequence(image), undefined, path);
    const evidence = manifest(); evidence.samples[0].alignment.evidence = [path];
    assert.throws(() => validateSequence(evidence), undefined, path);
  }
});

test('matches_only_compatible_checkpoint_identity_and_reports_invalid_inputs', async () => {
  const { matchSamples } = await contract;
  for (const [field, value, code] of [
    ['event', 'release', 'incompatible-event'], ['offsetFrames', 1, 'incompatible-offset'],
    ['emulatedFrame', 101, 'incompatible-emulated-frame'],
  ]) {
    const actual = manifest([sample()], 'renderer-actual'); actual.samples[0][field] = value;
    const result = matchSamples(manifest(), actual);
    assert.equal(result.pairs.length, 0);
    assert.equal(result.issues[0].code, code);
  }
  const actual = manifest([sample()], 'renderer-actual'); actual.scenario = 'death-respawn';
  assert.equal(matchSamples(manifest(), actual).issues[0].code, 'incompatible-scenario');
  actual.samples[0].alignment = null;
  assert.equal(matchSamples(manifest(), actual).issues[0].code, 'invalid-actual');
  assert.equal(matchSamples({ version: 1 }, actual).pairs.length, 0);
});

test('inventory_keeps_missing_initial_and_expanded_coverage_visible', async () => {
  const { requiredChecks } = await coverage;
  const initial = requiredChecks('initial');
  const full = requiredChecks('full');
  assert.ok(initial.some(check => check.scenario === 'ready-movement' && check.category === 'full-screen'
    && ['ready-visible', 'before-release', 'first-movement', 'mouth-cycle'].every(id => check.checkpoints.some(c => c.id === id))));
  assert.ok(initial.some(check => check.scenario === 'death-respawn' && check.category === 'full-screen'
    && ['death-catch', 'initial-hold', 'death-art-transitions', 'blank', 'next-life-ready', 'first-movement'].every(id => check.checkpoints.some(c => c.id === id))));
  assert.ok(initial.some(check => check.scenario === 'waiting-pose' && check.category === 'live'));
  for (const scenario of ['ready-movement', 'death-respawn']) assert.ok(initial.some(check => check.scenario === scenario && check.category === 'live'));
  assert.ok(initial.flatMap(c => c.checkpoints).filter(c => ['mouth-cycle', 'death-art-transitions'].includes(c.id)).every(c => c.completeness === 'all-observed'));
  assert.ok(full.length > initial.length);
  assert.ok(initial.every(check => full.some(c => c.id === check.id)));
  assert.equal(new Set(full.map(check => check.id)).size, full.length);
  assert.ok(full.every(check => ['full-screen', 'artwork', 'live', 'compositing'].includes(check.category) && check.checkpoints.length > 0));
  initial[0].checkpoints.length = 0;
  assert.ok(requiredChecks('initial')[0].checkpoints.length > 0);
  assert.throws(() => requiredChecks('typo'));
});

test('full_inventory_enumerates_frames_modes_display_and_control_requirements', async () => {
  const { requiredChecks } = await coverage;
  const full = requiredChecks('full');
  for (const direction of ['right', 'left', 'up', 'down']) {
    for (const category of ['full-screen', 'artwork']) {
      assert.ok(full.some(c => c.scenario === `mouth-${direction}` && c.category === category
        && ['frame-0', 'frame-1', 'frame-2', 'frame-3'].every(id => c.checkpoints.some(p => p.id === id))));
      for (const ghost of ['red', 'pink', 'cyan', 'orange']) assert.ok(full.some(c => c.scenario === `ghost-${ghost}-${direction}` && c.category === category
        && ['foot-0', 'foot-1'].every(id => c.checkpoints.some(p => p.id === id))));
    }
  }
  for (const mode of ['arcade', 'competition']) {
    for (const scenario of ['waiting-pose', 'ready-movement', 'death-respawn', 'last-life-death', 'level-completion',
      'fright-restoration', 'ghost-eaten', 'bot-resume', 'bot-reset', 'explicit-stop', 'manual-reset', 'reload-owned-hold', 'manual-pause', 'real-bot-natural-life-loss']) {
      assert.ok(full.some(c => c.scenario === scenario && c.category === 'live' && c.mode === mode), `${mode}/${scenario}`);
    }
    for (const phase of ['ready', 'death', 'level-clear']) assert.ok(full.some(c => c.scenario === `mode-change-${phase}` && c.mode === mode));
  }
  for (const scenario of ['fright-restoration', 'ghost-eaten', 'last-life-death', 'level-completion', 'hud-zero', 'hud-repeated-fruit', 'hud-history-overflow', 'hud-late-keys']) {
    assert.ok(full.some(c => c.scenario === scenario && c.category === 'full-screen'), scenario);
  }
  for (const display of ['native', 'fractional', 'retina']) for (const scenario of ['sprite-boundaries', 'colored-map-alpha', 'sprite-gutters']) {
    assert.ok(full.some(c => c.scenario === scenario && c.category === 'compositing' && c.display.id === display));
  }
  assert.ok(full.filter(c => c.scenario === 'waiting-pose').every(c => c.category === 'live'));
});
