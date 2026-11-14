import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { requiredChecks } from './sequence-coverage.mjs';
import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';

const reporting = import('./sequence-report.mjs'); reporting.catch(() => {});
const cli = import('./validate-sequences.mjs'); cli.catch(() => {});
const definition = (id, category, ids) => ({ id, category, checkpoints: ids.map(id => ({ id })) });
const three = [definition('full-screen:three', 'full-screen', ['a', 'b', 'c'])];
const result = (checkId, checkpoints, category = 'full-screen') => ({ checkId, category, checkpoints: checkpoints.map(p => ['pass','fail'].includes(p.status) ? { captured: true, compared: true, ...p } : p) });
function temporary(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sequence-report-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true })); return dir;
}

test('duplicate comparisons cannot inflate the independent required denominator', async () => {
  const { summarizeCoverage } = await reporting;
  const one = result('full-screen:three', [{ id: 'a', status: 'pass' }]);
  const summary = summarizeCoverage(three, [one, structuredClone(one)]);
  assert.deepEqual(summary.categories['full-screen'], { required: 3, captured: 1, compared: 1, passed: 1, failed: 0, unavailable: 0, incomplete: 2 });
  assert.equal(summary.complete, false); assert.equal(summary.passed, false);
  assert.equal(summary.groups['full-screen'].required, 1);
});

test('absent required results are incomplete; captures without comparisons never pass', async () => {
  const { summarizeCoverage } = await reporting;
  assert.equal(summarizeCoverage(three, []).categories['full-screen'].incomplete, 3);
  const summary = summarizeCoverage(three, [result('full-screen:three', [{ id: 'a', status: 'captured', captured: true }])]);
  assert.equal(summary.categories['full-screen'].captured, 1);
  assert.equal(summary.categories['full-screen'].compared, 0);
  assert.equal(summary.categories['full-screen'].passed, 0);
  assert.equal(summary.categories['full-screen'].incomplete, 3);
});

test('missing references stay unavailable even with a current screenshot', async () => {
  const { summarizeCoverage } = await reporting;
  const summary = summarizeCoverage(three, [result('full-screen:three', [{ id: 'a', status: 'unavailable', captured: true, reason: 'Missing reference' }])]);
  assert.deepEqual(summary.categories['full-screen'], { required: 3, captured: 1, compared: 0, passed: 0, failed: 0, unavailable: 1, incomplete: 2 });
  assert.equal(summary.passed, false);
});

test('a naked passing status is not evidence of capture or comparison', async () => {
  const { summarizeCoverage } = await reporting;
  const summary = summarizeCoverage(three, [{ checkId: 'full-screen:three', category: 'full-screen', checkpoints: [{ id: 'a', status: 'pass' }] }]);
  assert.equal(summary.categories['full-screen'].captured, 0);
  assert.equal(summary.categories['full-screen'].compared, 0);
  assert.equal(summary.categories['full-screen'].passed, 0);
  assert.equal(summary.categories['full-screen'].incomplete, 3);
});

test('summary layers do not multiply raw capture measurements', async () => {
  const { summarizeCoverage } = await reporting;
  const summary = summarizeCoverage(three, [result('full-screen:three', [{ id: 'a', status: 'pass', measurements: { raw: 'x'.repeat(100000) } }])]);
  assert.equal(summary.categories['full-screen'].passed, 1);
  assert.ok(JSON.stringify(summary).length < 4000);
});

test('five passing artwork crops cannot satisfy a failed full-screen sequence', async () => {
  const { summarizeCoverage } = await reporting;
  const definitions = [definition('full-screen:scene', 'full-screen', ['scene']), definition('artwork:crops', 'artwork', ['1','2','3','4','5'])];
  const summary = summarizeCoverage(definitions, [result('full-screen:scene', [{ id: 'scene', status: 'fail' }]), result('artwork:crops', ['1','2','3','4','5'].map(id => ({ id, status: 'pass' })), 'artwork')]);
  assert.equal(summary.categories.artwork.passed, 5); assert.equal(summary.categories['full-screen'].failed, 1);
  assert.equal(summary.complete, true); assert.equal(summary.passed, false);
});

test('conflicts, unknown IDs, category mismatches and unmatched states remain non-pass', async () => {
  const { summarizeCoverage } = await reporting;
  const summary = summarizeCoverage(three, [
    result('full-screen:three', [{ id: 'a', status: 'pass' }, { id: 'a', status: 'fail' }, { id: 'b', status: 'unmatched' }, { id: 'surplus', status: 'pass' }]),
    result('unknown', [{ id: 'a', status: 'pass' }]),
    result('full-screen:three', [{ id: 'c', status: 'pass' }], 'artwork'),
  ]);
  assert.equal(summary.categories['full-screen'].passed, 0);
  assert.equal(summary.categories['full-screen'].incomplete, 3);
  assert.equal(summary.passed, false); assert.ok(summary.issues.length >= 3);
});

test('group failure and capture dependency errors cannot hide behind passing checkpoints', async () => {
  const { summarizeCoverage } = await reporting;
  const summary = summarizeCoverage(three, [{ ...result('full-screen:three', ['a','b','c'].map(id => ({ id, status: 'pass' }))), status: 'incomplete', errors: ['browser disconnected'] }]);
  assert.equal(summary.categories['full-screen'].passed, 3);
  assert.equal(summary.groups['full-screen'].incomplete, 1);
  assert.equal(summary.passed, false);
});

test('a measured failure cannot make missing or unavailable checkpoints complete', async () => {
  const { summarizeCoverage } = await reporting;
  for (const tail of [[], [{ id: 'b', status: 'unavailable' }, { id: 'c', status: 'pass' }]]) {
    const summary = summarizeCoverage(three, [result('full-screen:three', [{ id: 'a', status: 'fail' }, ...tail])]);
    assert.equal(summary.groups['full-screen'].failed, 1);
    assert.equal(summary.complete, false); assert.equal(summary.passed, false);
  }
  const checkpoints = ['a','b','c'].map(id => ({ id, status: id === 'a' ? 'fail' : 'pass' }));
  assert.equal(summarizeCoverage(three, [result('full-screen:three', checkpoints)]).complete, true);
  assert.equal(summarizeCoverage(three, [{ ...result('full-screen:three', checkpoints), status: 'fail', errors: ['capture interval interrupted'] }]).complete, false);
});

test('JSON and escaped static HTML retain measurements, explicit missing checks and artifact links', async t => {
  const { writeSequenceReport } = await reporting; const dir = temporary(t);
  const check = result('full-screen:three', [{ id: 'a', status: 'fail', reason: '<script>bad</script>', measurements: { whole: { differingPixels: 99 } }, artifacts: { reference: 'reference.png', current: 'current.png', difference: 'difference.png', neighbors: ['before.png','after.png'], trace: 'trace.json' } }]);
  check.evidenceRoot = dir;
  const summary = await writeSequenceReport({ definitions: three, results: [check], outDir: path.join(dir, 'report') });
  const json = JSON.parse(fs.readFileSync(path.join(dir, 'report/report.json')));
  const html = fs.readFileSync(path.join(dir, 'report/index.html'), 'utf8');
  assert.equal(summary.passed, false); assert.equal(json.results[0].checkpoints[0].measurements.whole.differingPixels, 99);
  assert.equal(json.coverage.entries[0].checkpoints[1].status, 'incomplete');
  for (const file of ['reference.png','current.png','difference.png','before.png','after.png','trace.json']) assert.ok(html.includes(`../${file}`));
  assert.ok(html.includes('&lt;script&gt;bad&lt;/script&gt;')); assert.ok(!html.includes('<script>bad</script>'));
});

test('bounded CLI fixtures exercise success and fidelity failure using real report and exit paths', async t => {
  await cli; const dir = temporary(t);
  const moduleURL = pathToFileURL(path.join(import.meta.dirname, 'validate-sequences.mjs')).href;
  const coverageURL = pathToFileURL(path.join(import.meta.dirname, 'sequence-coverage.mjs')).href;
  const driver = path.join(dir, 'fixture-cli.mjs');
  fs.writeFileSync(driver, `import {main} from ${JSON.stringify(moduleURL)}; import {requiredChecks} from ${JSON.stringify(coverageURL)};
const failed=process.env.FIXTURE_FAIL==='1';
const producers={renderer:async()=>requiredChecks('initial').filter(d=>d.category==='full-screen').map((d,i)=>({checkId:d.id,category:d.category,status:failed&&i===0?'fail':'pass',checkpoints:d.checkpoints.map(p=>({id:p.id,status:failed&&i===0?'fail':'pass',captured:true,compared:true,reason:'Bounded fixture only; no actual capture claimed'}))}))};
process.exitCode=await main(process.argv.slice(2),{producers,provenance:{fixture:true}});`);
  for (const failed of [false, true]) {
    const out = path.join(dir, failed ? 'failure' : 'success');
    const run = spawnSync(process.execPath, [driver, '--scope', 'initial', '--suite', 'renderer', '--reference', path.join(dir, 'reference'), '--out', out], { encoding: 'utf8', env: { ...process.env, FIXTURE_FAIL: failed ? '1' : '0' } });
    assert.equal(run.status, failed ? 1 : 0, run.stderr);
    const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
    assert.equal(report.passed, !failed); assert.equal(report.provenance.fixture, true);
    assert.equal(report.requestedCoverage.categories['full-screen'].required, 10);
    assert.equal(report.coverage.categories.live.incomplete, 36);
  }
});

test('real CLI missing-reference exits nonzero and writes both reports without starting browser', async t => {
  await cli; const dir = temporary(t), out = path.join(dir, 'missing-report');
  const run = spawnSync(process.execPath, [path.join(import.meta.dirname, 'validate-sequences.mjs'), '--scope', 'initial', '--suite', 'renderer', '--reference', path.join(dir, 'absent'), '--out', out], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.status, 1, run.stderr);
  const report = JSON.parse(fs.readFileSync(path.join(out, 'report.json')));
  assert.equal(report.requestedCoverage.categories['full-screen'].unavailable, 10);
  assert.equal(report.requestedCoverage.categories['full-screen'].captured, 0);
  assert.equal(report.passed, false); assert.ok(fs.existsSync(path.join(out, 'index.html')));
});

test('a failed producer preserves partial captures and later producers still report', async t => {
  const { runValidation } = await cli; const dir = temporary(t);
  const report = await runValidation({ scope: 'full', suite: 'all', reference: path.join(dir, 'reference'), out: path.join(dir, 'partial'), producers: {
    renderer: async ({ outDir }) => { fs.mkdirSync(outDir, { recursive: true }); fs.writeFileSync(path.join(outDir, 'frame.png'), PNG.sync.write(new PNG({ width: 1, height: 1 }))); fs.writeFileSync(path.join(outDir, 'checks.json'), JSON.stringify([result('full-screen:ready-movement', [{ id: 'ready-visible', status: 'captured', captured: true, evidence: ['frame.png'] }])])); throw Error('browser missing'); },
    visual: async () => [result('artwork:ready-art', [{ id: 'ready-visible', status: 'pass' }], 'artwork')],
    initialLive: async () => { throw Error('Go missing'); },
    expandedLive: async () => [], races: async () => [], simulation: async () => [result('live:real-bot-natural-life-loss:arcade', [{ id: 'cleanup', status: 'pass' }], 'live')],
  } });
  assert.equal(report.passed, false); assert.equal(report.producerErrors.length, 2);
  assert.equal(report.coverage.categories.artwork.passed, 1); assert.equal(report.coverage.categories.live.passed, 1);
  assert.equal(report.coverage.categories['full-screen'].captured, 1);
  assert.equal(report.coverage.categories['full-screen'].compared, 0);
  assert.equal(report.coverage.categories['full-screen'].required, 100);
  assert.ok(fs.existsSync(path.join(dir, 'partial/index.html')));
});

test('actual producer adapters reject missing image and trace artifacts despite passing status', async t => {
  const { loadCheckResults } = await cli; const dir = temporary(t);
  const checks = [result('artwork:ready-art', [{ id: 'ready-visible', status: 'pass', evidence: ['missing.png'] }], 'artwork'),
    { ...result('live:waiting-pose:arcade', [{ id: 'waiting-visible', status: 'pass', observationIds: ['r1'] }], 'live'), artifacts: { trace: 'absent.json' } }];
  const converted = loadCheckResults({ root: dir, checks });
  const summary = (await reporting).summarizeCoverage([
    definition('artwork:ready-art', 'artwork', ['ready-visible']), definition('live:waiting-pose:arcade', 'live', ['waiting-visible'])], converted);
  assert.equal(summary.categories.artwork.passed, 0); assert.equal(summary.categories.artwork.captured, 0);
  assert.equal(summary.categories.live.compared, 0); assert.equal(summary.passed, false);
});

test('an artwork screenshot alone does not establish a source comparison', async t => {
  const { loadCheckResults } = await cli; const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'actual.png'), PNG.sync.write(new PNG({ width: 1, height: 1 })));
  const [check] = loadCheckResults({ root: dir, checks: [result('artwork:ready-art', [{ id: 'ready-visible', status: 'pass', evidence: ['actual.png'] }], 'artwork')] });
  assert.equal(check.checkpoints[0].captured, true);
  assert.equal(check.checkpoints[0].compared, false);
  assert.equal(check.checkpoints[0].status, 'incomplete');
});

test('source hashes and semantic observations cannot substitute for artwork pixel measurements', async t => {
  const { loadCheckResults } = await cli; const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'source')); fs.mkdirSync(path.join(dir, 'native'));
  const image = PNG.sync.write(new PNG({ width: 16, height: 16 }));
  fs.writeFileSync(path.join(dir, 'source/general.png'), image); fs.writeFileSync(path.join(dir, 'native/0.png'), image);
  fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify({ sourceHashes: { general: createHash('sha256').update(image).digest('hex') } }));
  fs.writeFileSync(path.join(dir, 'native/observations.json'), JSON.stringify([{ case: { checkId: 'artwork:mouth-right', checkpoint: 'frame-0' }, image: 'native/0.png', observation: { actors: ['pacman-right-0'] } }]));
  const [check] = loadCheckResults({ root: dir, checks: [{ ...result('artwork:mouth-right', [{ id: 'frame-0', status: 'pass', evidence: ['native/0.png'] }], 'artwork'), status: 'pass' }] });
  assert.equal(check.checkpoints[0].captured, true); assert.equal(check.checkpoints[0].compared, false);
  assert.equal(check.checkpoints[0].status, 'incomplete'); assert.equal(check.status, 'incomplete');
});

test('retained independent artwork crop differences remain measured failures', async t => {
  const { loadCheckResults } = await cli; const dir = temporary(t);
  fs.mkdirSync(path.join(dir, 'source')); fs.mkdirSync(path.join(dir, 'native'));
  const reference = new PNG({ width: 16, height: 16 }), actual = new PNG({ width: 16, height: 16 }); actual.data[0] = 255;
  const source = PNG.sync.write(reference);
  fs.writeFileSync(path.join(dir, 'source/general.png'), source);
  fs.writeFileSync(path.join(dir, 'native/0-reference.png'), source); fs.writeFileSync(path.join(dir, 'native/0-actual.png'), PNG.sync.write(actual));
  fs.writeFileSync(path.join(dir, 'provenance.json'), JSON.stringify({ sourceHashes: { general: createHash('sha256').update(source).digest('hex') } }));
  fs.writeFileSync(path.join(dir, 'native/observations.json'), JSON.stringify([{ case: { checkId: 'artwork:ghost-red-up', checkpoint: 'foot-1' } }]));
  const [check] = loadCheckResults({ root: dir, checks: [{ ...result('artwork:ghost-red-up', [{ id: 'foot-1', status: 'fail', evidence: ['native/0-actual.png'] }], 'artwork'), status: 'fail' }] });
  assert.equal(check.checkpoints[0].compared, true); assert.equal(check.checkpoints[0].status, 'fail');
  assert.equal(check.checkpoints[0].measurements[0].measurement.whole.differingPixels, 1);
});

test('repeated observation-file references retain measurements once', async t => {
  const { loadCheckResults } = await cli; const dir = temporary(t);
  fs.writeFileSync(path.join(dir, 'observations.json'), JSON.stringify([{ image: 'screen.png', case: { name: 'mouth-right', checkId: 'artwork:mouth-right', checkpoint: 'frame-0' }, composition: [{ image: 'sprite.png', stats: { unexpected: 2 } }] }]));
  const [check] = loadCheckResults({ root: dir, checks: [result('compositing:sprite-boundaries:native', [{ id: 'directional-mouth', status: 'fail', evidence: ['observations.json','observations.json'] }], 'compositing')] });
  assert.equal(check.checkpoints[0].measurements.length, 1);
});

test('artwork failure reports derive exact differences without writing source artifacts', async t => {
  const { writeSequenceReport } = await reporting; const dir = temporary(t);
  const before = new PNG({ width: 1, height: 1 }), after = new PNG({ width: 1, height: 1 }); after.data[0] = 255;
  fs.writeFileSync(path.join(dir, 'crop-reference.png'), PNG.sync.write(before)); fs.writeFileSync(path.join(dir, 'crop-actual.png'), PNG.sync.write(after));
  const check = { ...result('artwork:crop', [{ id: 'pixel', status: 'fail', evidence: ['crop-actual.png'] }], 'artwork'), evidenceRoot: dir };
  const report = writeSequenceReport({ definitions: [definition('artwork:crop', 'artwork', ['pixel'])], results: [check], outDir: path.join(dir, 'out') });
  const pair = report.results[0].checkpoints[0].artifacts.sourcePairs[0];
  assert.equal(pair.measurement.whole.differingPixels, 1); assert.ok(fs.existsSync(pair.difference));
  assert.equal(PNG.sync.read(fs.readFileSync(pair.difference)).data[0], 255);
  assert.equal(fs.existsSync(path.join(dir, 'crop-difference.png')), false);
  assert.ok(fs.readFileSync(path.join(dir, 'out/index.html'), 'utf8').includes('derived-artifacts/'));
});
