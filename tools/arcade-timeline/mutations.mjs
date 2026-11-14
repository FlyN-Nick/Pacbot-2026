// Mutation evidence is independent of the already-failing full-screen matrix.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { PNG } from 'pngjs';

const repo = path.resolve(import.meta.dirname, '../..');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const failureCodes = { 'waiting-closed':'open-waiting-pose', 'captured-death-position':'death-position-moved', 'bot-death-art':'death-art-cancelled', 'colored-map-alpha':'opaque-background-pixel', 'no-neighbor-sampling':'neighbor-boundary-pixels' };
export function evaluateProof(target, baseline, mutated) {
  let reason = 'Healthy targeted baseline passed; mutation failed the same assertion.';
  if (baseline?.target !== target || baseline?.status !== 'pass' || baseline?.errors?.length) reason = 'Baseline did not pass the healthy targeted assertion.';
  else if (mutated?.target !== target || mutated?.status !== 'fail' || mutated?.errors?.length || !failureCodes[target] || mutated?.failureCode !== failureCodes[target]) reason = 'Mutation did not fail the healthy targeted assertion; unrelated errors and missing observations are not detection.';
  else return { target, status: 'pass', reason };
  return { target, status: 'fail', reason };
}
export const mutations = [
  { name: 'open-idle', target: 'waiting-closed', file: 'web_client/src/lib/sprites/frames.js',
    from: 'phase:active&&moving?Math.floor(phase/66):2', to: 'phase:active&&moving?Math.floor(phase/66):0' },
  { name: 'ignore-captured-death-position', target: 'captured-death-position', file: 'web_client/src/lib/agents/Pacman.svelte',
    from: 'if (deathPosition) {', to: 'if (false && deathPosition) {' },
  { name: 'cancel-death-on-bot-resume', target: 'bot-death-art', file: 'web_client/src/App.svelte',
    from: "if ($visualizerMode === 'arcade' && runner.running) {pauseTrace.record('botResumeDeferred',{sequence:currentKind()});break;}",
    to: "if ($visualizerMode === 'arcade' && runner.running) { runner.cancel(); clearSequenceDisplay(); }" },
  { name: 'opaque-black-backgrounds', target: 'colored-map-alpha', file: 'web_client/public/sprites/atlas.png' },
  { name: 'remove-atlas-gutters', target: 'no-neighbor-sampling', file: 'web_client/src/lib/sprites/catalog.js' },
];
export function applyMutation(root, mutation) {
  const file = path.join(root, mutation.file), before = fs.readFileSync(file);
  if (mutation.name === 'opaque-black-backgrounds') {
    const png = PNG.sync.read(before);
    for (let i = 0; i < png.data.length; i += 4) if (!png.data[i + 3]) png.data.set([0, 0, 0, 255], i);
    fs.writeFileSync(file, PNG.sync.write(png));
  } else if (mutation.name === 'remove-atlas-gutters') {
    fs.appendFileSync(file, '\n// Mutation: restore original contiguous source-sheet sampling.\nObject.values(catalog).forEach(frame => { frame.render = {asset:frame.asset,x:frame.x,y:frame.y,sheetWidth:frame.sheetWidth,sheetHeight:frame.sheetHeight}; });\n');
  } else {
    const source = before.toString();
    if (source.split(mutation.from).length !== 2) throw Error(`Mutation must match exactly once: ${mutation.name}`);
    fs.writeFileSync(file, source.replace(mutation.from, mutation.to));
  }
  return { file: mutation.file, before: sha(before), after: sha(fs.readFileSync(file)), replacement: mutation.to ?? mutation.name };
}
function trackedFiles(root) { return execFileSync('git', ['ls-files', '-z'], { cwd: root }).toString().split('\0').filter(file => file && fs.statSync(path.join(root,file)).isFile()); }
export function copyImplementation(root, destination) {
  // Only tracked implementation files; never recurse through an archive, ROM,
  // node_modules, .git, local evidence, build output, or other ignored artifacts.
  const files = [...new Set([...trackedFiles(root), 'tools/arcade-timeline/mutations.mjs'])].filter(file =>
    /^(web_client\/|server\/|tools\/arcade-timeline\/|config\.json$)/.test(file) && !/(^|\/)(node_modules|dist|\.git)(\/|$)|\.(zip|rom)$/i.test(file));
  for (const file of files) { const dest = path.join(destination, file); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(path.join(root, file), dest); }
  for (const dir of ['web_client', 'tools/arcade-timeline']) fs.symlinkSync(path.join(root, dir, 'node_modules'), path.join(destination, dir, 'node_modules'), 'dir');
  return files;
}
function hashes(root, files) { return Object.fromEntries(files.filter(file => fs.existsSync(path.join(root, file))).sort().map(file => [file, sha(fs.readFileSync(path.join(root, file)))])); }
function referenceFiles(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.relative(root, path.join(e.parentPath, e.name))).sort();
}
async function childProbe(copy, target, out) {
  fs.mkdirSync(out, { recursive: true });
  const log = fs.openSync(path.join(out, 'probe.log'), 'w');
  try {
    const result = await new Promise(resolve => {
      const child = spawn(process.execPath, [path.join(copy, 'tools/arcade-timeline/mutations.mjs'), '--probe', target, '--out', out], { cwd: copy, env: { ...process.env, GOWORK: 'off' }, stdio: ['ignore', log, log] });
      let expired = false;
      const timer = setTimeout(() => { expired = true; child.kill('SIGTERM'); }, 150000);
      child.once('error', error => { clearTimeout(timer); resolve({ error: error.message }); });
      child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal, expired }); });
    });
    const evidence = fs.existsSync(path.join(out, 'assertion.json')) ? read(path.join(out, 'assertion.json')) : { target, status: 'incomplete', errors: ['Probe did not produce assertion evidence'] };
    if (result.code !== 0 || result.expired) evidence.errors = [...(evidence.errors ?? []), `Probe process failed: ${JSON.stringify(result)}`];
    return { ...evidence, process: result, evidence: path.join(out, 'assertion.json') };
  } finally { fs.closeSync(log); }
}
export async function runMutations({ out, root = repo, reference = path.join(repo, '.superpowers/sdd/2026-11-10-sequence-validation/task-6-evidence/reference-final') }) {
  out = path.resolve(out); root = path.resolve(root); reference = path.resolve(reference);
  if (out === root || root.startsWith(out + path.sep) || out === reference || reference.startsWith(out + path.sep) || out.startsWith(reference + path.sep)) throw Error('Mutation output must be separate from source and reference inputs');
  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) throw Error('Mutation output must be empty');
  const sourceFiles = [...new Set([...trackedFiles(root), 'tools/arcade-timeline/mutations.mjs'])];
  const before = { source: hashes(root, sourceFiles), reference: hashes(reference, referenceFiles(reference)) };
  json(path.join(out, 'hashes-before.json'), before);
  const results = [], copies = path.join(out, 'copies'); fs.mkdirSync(copies);
  try {
    for (const mutation of mutations) {
      const copy = path.join(copies, mutation.name), evidence = path.join(out, mutation.name);
      const files = copyImplementation(root, copy); fs.mkdirSync(evidence);
      json(path.join(evidence, 'copy-inventory.json'), files);
      const baseline = await childProbe(copy, mutation.target, path.join(evidence, 'baseline'));
      const patch = applyMutation(copy, mutation); json(path.join(evidence, 'mutation.json'), patch);
      const mutated = await childProbe(copy, mutation.target, path.join(evidence, 'mutated'));
      const proof = evaluateProof(mutation.target, baseline, mutated);
      results.push({ name: mutation.name, ...proof, patch, baseline, mutated });
      json(path.join(out, 'results.json'), results);
      console.log(`${mutation.name}: ${proof.status} (${baseline.status} → ${mutated.status})`);
      fs.rmSync(copy, { recursive: true, force: true });
    }
  } finally {
    fs.rmSync(copies, { recursive: true, force: true });
    const after = { source: hashes(root, sourceFiles), reference: hashes(reference, referenceFiles(reference)) };
    json(path.join(out, 'hashes-after.json'), after);
    const unchanged = JSON.stringify(before) === JSON.stringify(after);
    json(path.join(out, 'summary.json'), { passed: unchanged && results.length === mutations.length && results.every(r => r.status === 'pass'), unchanged, results, reference, exclusions: ['git metadata', 'ROMs', 'ignored local artifacts'], dependencyPolicy: 'Existing node_modules linked read only; no install or extraction; disposable copies removed' });
    if (!unchanged) throw Error('Source or reference hashes changed during mutation run');
  }
  return read(path.join(out, 'summary.json'));
}

/** A missing observation is not evidence that death was cancelled. Include the
 * pre-action callback and independent final-rAF metadata so boundary deletions
 * cannot leave an apparently dense, but truncated, interval. */
export function evaluateBotDeathProbe(trace) {
  const action = trace.events?.find(e => e.type === 'driver' && e.name === 'race-action' && e.command === 'resume_game');
  const rows = trace.rows ?? [], epoch = action?.epoch ?? 0;
  const before = rows.findLast(r => action && r.at < action.at && (r.epoch ?? 0) === epoch);
  const after = rows.filter(r => action && r.at >= action.at);
  const coverage = before ? [before, ...after] : [];
  const metadata = trace.epochs?.find(e => e.epoch === epoch);
  const dense = coverage.length > 2 && coverage.every((row, i) =>
    Number.isSafeInteger(row.raf) && Number.isFinite(row.at) && (row.epoch ?? 0) === epoch
    && (!i || row.raf === coverage[i - 1].raf + 1 && row.at > coverage[i - 1].at));
  const complete = Number.isFinite(action?.at) && Number.isFinite(trace.deadline) && trace.deadline > action.at
    && trace.endAt >= trace.deadline && after.at(-1)?.at >= trace.deadline && dense
    && Number.isSafeInteger(trace.endRaf) && after.at(-1)?.raf === trace.endRaf
    && metadata?.lastRaf === trace.endRaf && !(trace.errors ?? []).length;
  const frames = after.filter(r => r.at <= trace.deadline && r.render?.frame?.startsWith('death-'));
  return { target: 'bot-death-art', status: !complete ? 'incomplete' : frames.length ? 'pass' : 'fail',
    reason: complete ? 'Bot resume during the caught freeze must preserve visible numbered death artwork before the observation deadline.'
      : 'Missing contiguous observations across the bot action and deadline, independent final callback, or healthy probe evidence.',
    action, deadline: trace.deadline, observationIds: coverage.map(r => r.id), deathObservationIds: frames.map(r => r.id),
    errors: trace.errors ?? [], fixtures: false, frameOverrides: false };
}

async function probe(target, out) {
  if (target === 'waiting-closed' || target === 'captured-death-position') {
    const { runLiveSequences } = await import('./live-sequences.mjs');
    const checks = await runLiveSequences({ scope: 'initial', mode: 'arcade', outDir: path.join(out, 'live') });
    const check = checks.find(c => c.scenario === (target === 'waiting-closed' ? 'waiting-pose' : 'death-respawn'));
    const assertion = check.checkpoints.find(c => c.id === (target === 'waiting-closed' ? 'waiting-visible' : target));
    const trace = read(path.join(out, 'live/arcade/trace.json'));
    return { ...assertion, target, errors: trace.errors, fixtures: false, frameOverrides: false };
  }
  if (target === 'bot-death-art') {
    const { runControlRaces } = await import('./live-sequences.mjs');
    await runControlRaces({ mode: 'arcade', scenarios: ['bot-resume'], outDir: path.join(out, 'live') });
    const trace = read(path.join(out, 'live/arcade/bot-resume/trace.json'));
    return evaluateBotDeathProbe(trace);
  }
  const { createCleanup } = await import('./processes.mjs');
  const { launchBrowser, startGameServer, startVisualizer } = await import('./run.mjs');
  const { countBoundaryPixels } = await import('./sprite-boundary-browser.mjs');
  const cleanup = createCleanup(); cleanup.installSignalHandlers();
  const scratch = path.join(out, 'runtime'); fs.mkdirSync(scratch);
  const errors = [];
  try {
    const ws = await startGameServer(scratch, cleanup), port = await startVisualizer(scratch, cleanup), browser = await launchBrowser(); cleanup.add(() => browser.close());
    const page = await browser.newPage({ viewport: target === 'colored-map-alpha' ? { width: 224, height: 352 } : { width: 1000, height: 700 }, deviceScaleFactor: target === 'colored-map-alpha' ? 1 : 2 });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://localhost:${port}/?timeline=1&visual=1&bot=off&mode=arcade&ws=${ws}`); await page.waitForFunction(() => window.__arcadeVisual);
    await page.evaluate(() => { window.__arcadeVisual.setFixture({ pellets: Array.from({length:31},()=>Array(28).fill(0)), pacman:{rowState:23,colState:77,frame:'pacman-right-0'} },0); document.querySelectorAll('.grid-element').forEach(el => el.style.backgroundColor='#12785a'); });
    await page.waitForFunction(() => [...document.querySelectorAll('.grid-element')].every(el => getComputedStyle(el).backgroundColor === 'rgb(18, 120, 90)'));
    const bytes = await page.locator('.pacman-position .sprite').screenshot({ path: path.join(out, 'actual.png') }), png = PNG.sync.read(bytes);
    const boundaryPixels = countBoundaryPixels(png, (r,g,b) => r !== 18 || g !== 120 || b !== 90);
    const corner = [...png.data.subarray(0,4)];
    const passed = target === 'colored-map-alpha' ? JSON.stringify(corner) === '[18,120,90,255]' : boundaryPixels === 0;
    return { target, status: passed ? 'pass' : 'fail', reason: target === 'colored-map-alpha' ? 'Transparent source corner must reveal the colored map pixel exactly.' : 'Right open Pac-Man outer sprite boundary must contain only the colored map; adjacent same-palette artwork is forbidden.', corner, boundaryPixels, dimensions:{width:png.width,height:png.height}, screenshot:'actual.png', errors, fixtures:true, frameOverrides:true, scope:'Artwork/compositing only; fixed right-open frame, no frame-selection or full-screen fidelity claim' };
  } finally { await cleanup.run(); fs.rmSync(scratch,{recursive:true,force:true}); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv[2] === '--probe') {
    const out = process.argv[5];
    try { const result = await probe(process.argv[3],out); json(path.join(out,'assertion.json'), { ...result, ...(result.status === 'fail' && !result.errors?.length ? { failureCode: failureCodes[result.target] } : {}) }); }
    catch(error) { json(path.join(out,'assertion.json'), { target:process.argv[3],status:'incomplete',errors:[error.stack] }); process.exitCode=1; }
  } else {
    const args=process.argv.slice(2);
    if(args.length!==2||args[0]!=='--out'||!args[1]||args[1].startsWith('--')) { console.error('Usage: npm run validate:mutations -- --out <empty-directory>');process.exitCode=1; }
    else try { const result=await runMutations({out:args[1]});process.exitCode=result.passed?0:1; } catch(error) {console.error(error);process.exitCode=1;}
  }
}
