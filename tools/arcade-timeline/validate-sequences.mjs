import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { requiredChecks } from './sequence-coverage.mjs';
import { writeSequenceReport } from './sequence-report.mjs';

const read = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const categories = suite => suite === 'renderer' ? ['full-screen','artwork','compositing'] : suite === 'live' ? ['live'] : ['full-screen','artwork','live','compositing'];
const nonpass = (d, reason, status = 'unavailable') => ({ checkId: d.id, category: d.category, status,
  checkpoints: d.checkpoints.map(p => ({ id: p.id, status, captured: false, compared: false, reason })) });
const exists = (root, file) => typeof file === 'string' && fs.existsSync(path.resolve(root, file));
function files(value) {
  if (typeof value === 'string') return /\.(png|json|log|md)$/.test(value) ? [value] : [];
  return value && typeof value === 'object' ? Object.values(value).flatMap(files) : [];
}

/** Convert actual producer evidence, rather than trusting status or boolean
 * fields in an index. Live comparisons are evaluated assertions, not pixels.
 */
export function loadCheckResults({ root, checks }) {
  const contexts = new Map();
  const visualContext = dir => {
    if (!contexts.has(dir)) {
      try {
        const provenance = read(path.join(dir, 'provenance.json'));
        const hashes = fs.readdirSync(path.join(dir, 'source')).map(file => createHash('sha256').update(fs.readFileSync(path.join(dir, 'source', file))).digest('hex'));
        const expected = Object.values(provenance.sourceHashes ?? {});
        if (!expected.length || !expected.every(hash => hashes.includes(hash))) throw Error('Missing or changed independent source sheets');
        contexts.set(dir, { provenance, observations: read(path.join(dir, 'native/observations.json')) });
      } catch (error) { contexts.set(dir, { error: error.message }); }
    }
    return contexts.get(dir);
  };
  return checks.map(check => {
    const traceFile = check.artifacts?.trace;
    const evidenceRoot = check.evidenceRoot ?? (traceFile && path.isAbsolute(traceFile) ? path.dirname(traceFile) : root);
    let trace, traceError;
    if (check.category === 'live') {
      try { trace = read(path.resolve(evidenceRoot, traceFile ?? check.checkpoints.find(p => p.evidence?.trace)?.evidence.trace ?? 'trace.json')); }
      catch (error) { traceError = error.message; }
    }
    const checkpoints = check.checkpoints.map(p => {
      const evidenceFiles = [...new Set(files(p.evidence))];
      const missing = evidenceFiles.filter(f => !exists(evidenceRoot, f));
      const images = evidenceFiles.filter(f => f.endsWith('.png'));
      let captured = images.length > 0 && images.every(f => exists(evidenceRoot, f));
      let measurements;
      const visual = ['artwork','compositing'].includes(check.category) ? visualContext(evidenceRoot) : null;
      if (check.category === 'compositing') {
        const observations = evidenceFiles.filter(f => f.endsWith('.json') && exists(evidenceRoot, f)).flatMap(f => read(path.resolve(evidenceRoot, f)));
        const group = o => o.case.checkId.includes('mouth-') ? 'directional-mouth' : o.case.checkId.includes('death-art') ? 'death-art' : /hud-|ready-art/.test(o.case.checkId) ? 'hud-glyphs' : 'ghost-feet';
        measurements = observations.filter(o => o.composition?.length && (!check.checkId.includes('sprite-boundaries') || group(o) === p.id)).map(o => ({ image: o.image, case: o.case.name, checkId: o.case.checkId, checkpoint: o.case.checkpoint, composition: o.composition }));
        captured = Boolean(measurements.length) && measurements.every(o => o.composition.every(c => exists(evidenceRoot, c.image)));
      }
      const artworkObserved = check.category !== 'artwork' || visual.observations?.some(o => o.case.checkId === check.checkId && (o.case.checkpoint === p.id || o.case.expectedHud));
      const observed = !trace || (p.observationIds ?? []).every(id => trace.rows?.some(r => r.id === id));
      const compared = ['pass','fail'].includes(p.status) && !missing.length && !traceError && !visual?.error && artworkObserved && observed
        && (check.category === 'live' ? Boolean(trace) : captured && evidenceFiles.length > 0);
      const imagesForContext = [...images, ...(measurements ?? []).map(m => m.image)];
      const neighbors = [...new Set(imagesForContext.flatMap(file => {
        const match = file.match(/^(.*\/)(\d+)(?:-\d+-actual)?\.png$/);
        return match ? [-1, 0, 1].map(offset => `${match[1]}${Number(match[2]) + offset}.png`).filter(file => exists(evidenceRoot, file)) : [];
      }))];
      return { ...p, captured, compared, ...(measurements ? { measurements } : {}),
        ...(['artwork','compositing'].includes(check.category) ? { artifacts: { trace: path.resolve(evidenceRoot, evidenceFiles.find(f => f.endsWith('.json')) ?? 'native/observations.json'), neighbors,
          ...(check.category === 'compositing' ? { referenceSource: path.join(evidenceRoot, 'source/general.png'), current: measurements?.flatMap(m => m.composition.map(c => c.image)),
            expectedRasterUnavailable: 'Producer retained source sheet and numeric palette/boundary measurements, not an expected composite raster',
            differenceRasterUnavailable: 'No independent expected-composite raster; no difference image invented' } : {}) } } : {}),
        ...(!compared && ['pass','fail'].includes(p.status) ? { status: 'incomplete', reportedStatus: p.status,
          reason: traceError ?? visual?.error ?? (missing.length ? `Missing evidence: ${missing.join(', ')}` : 'Required capture or evaluated observation evidence missing') } : {}) };
    });
    return { ...check, evidenceRoot, checkpoints, ...(traceError ? { errors: [...(check.errors ?? []), traceError] } : {}) };
  });
}

/** Import a retained replay as explicitly inherited evidence, or inspect fresh
 * replay output. Contract alignment establishes candidates, never pixel pass.
 */
export async function loadRendererResults({ reference, actual, definitions }) {
  const { validateRecordedSequence } = await import('./record-sequences.mjs');
  const { validateRenderedSequence } = await import('./render-sequences.mjs');
  const { matchSamples } = await import('./sequence-contract.mjs');
  const index = read(path.join(actual, 'index.json')), sourceIndex = read(path.join(reference, 'index.json'));
  return definitions.filter(d => d.category === 'full-screen').map(d => {
    const entries = index.sequences.filter(e => e.checkId === d.id), sources = sourceIndex.sequences.filter(e => e.checkId === d.id);
    if (entries.length > 1 || sources.length > 1) return nonpass(d, 'Duplicate renderer/reference index entries', 'incomplete');
    const e = entries[0], source = sources[0];
    if (!e || e.status !== 'recorded' || !source || source.status !== 'recorded') return nonpass(d, e?.reason ?? source?.reason ?? 'Missing recorded reference or renderer result');
    try {
      const current = read(path.join(actual, e.manifest)), ref = read(path.join(reference, source.manifest));
      validateRecordedSequence(reference, ref, d); validateRenderedSequence(actual, current, d);
      const matched = matchSamples(ref, current);
      if (matched.issues.length) return { ...nonpass(d, 'Unmatched source/current samples', 'incomplete'), issues: matched.issues };
      const rows = read(path.join(actual, current.provenance.comparisons));
      const folder = path.dirname(current.provenance.comparisons);
      const checkpoints = d.checkpoints.map(p => {
        const ids = current.provenance.checkpoints[p.id].sampleIds;
        const measurements = ids.map(id => {
          const matches = rows.filter(r => r.id === id), sample = current.samples.find(s => s.id === id), i = current.samples.indexOf(sample);
          const artifacts = { reference: `${folder}/reference/${id}.png`, current: sample?.image, difference: `${folder}/difference/${id}.png`,
            neighbors: current.samples.slice(Math.max(0, i - 1), i + 2).map(s => s.image), trace: sample?.alignment.evidence,
            rawSource: ref.samples.find(s => s.id === id)?.alignment.evidence.map(f => path.resolve(reference, f)) };
          const captured = exists(actual, artifacts.reference) && exists(actual, artifacts.current);
          const row = matches[0];
          const compared = captured && matches.length === 1 && ['pass','fail'].includes(row.status) && Number.isSafeInteger(row.whole?.differingPixels) && exists(actual, artifacts.difference);
          return { ...row, id, artifacts, captured, compared, status: compared ? (row.whole.differingPixels === 0 && row.status === 'pass' ? 'pass' : 'fail') : 'incomplete' };
        });
        const compared = measurements.length > 0 && measurements.every(r => r.compared);
        return { id: p.id, captured: measurements.length > 0 && measurements.every(r => r.captured), compared,
          status: measurements.some(r => r.status === 'fail') ? 'fail' : compared ? 'pass' : 'incomplete', measurements,
          reason: compared ? 'Exact native full-screen RGBA comparison; all required mapped samples retained' : 'Missing/duplicate comparison or image evidence' };
      });
      return { checkId: d.id, category: d.category, status: e.comparisonStatus, checkpoints, evidenceRoot: actual, manifest: e.manifest,
        rawComparisons: rows, artifacts: { contactSheets: current.provenance.contactSheets, isolation: current.provenance.isolation } };
    } catch (error) { return nonpass(d, `Invalid renderer/reference evidence: ${error.message}`); }
  });
}

async function freshRenderer({ reference, outDir, scope, definitions }) {
  // Fail before starting isolated servers when no source index is available.
  read(path.join(reference, 'index.json'));
  const { renderSequences } = await import('./render-sequences.mjs');
  await renderSequences({ reference, out: outDir, scope });
  return loadRendererResults({ reference, actual: outDir, definitions });
}
const defaults = {
  renderer: freshRenderer,
  visual: async options => { const { runExpandedVisual } = await import('./expanded-visual.mjs'); return loadCheckResults({ root: options.outDir, checks: await runExpandedVisual(options) }); },
  initialLive: async options => { const { runLiveSequences } = await import('./live-sequences.mjs'); return loadCheckResults({ root: options.outDir, checks: await runLiveSequences({ ...options, scope: 'initial' }) }); },
  expandedLive: async options => { const { runExpandedLive } = await import('./expanded-live.mjs'); return loadCheckResults({ root: options.outDir, checks: await runExpandedLive(options) }); },
  races: async options => { const { runControlRaces } = await import('./live-sequences.mjs'); return loadCheckResults({ root: options.outDir, checks: await runControlRaces(options) }); },
  simulation: async options => { const { runSimulation } = await import('./simulation-run.mjs'); return loadCheckResults({ root: options.outDir, checks: await runSimulation(options) }); },
};

/** Every default producer performs fresh work. Injection is for bounded tests;
 * no CLI option treats a cached matrix as a new capture. Each producer has a
 * separate directory and catch boundary, preserving partial/later categories.
 */
export async function runValidation({ scope = 'initial', suite = 'all', reference, out, producers = defaults, provenance = {} }) {
  const definitions = requiredChecks(scope);
  if (!['renderer','live','all'].includes(suite)) throw Error(`Unknown suite: ${suite}`);
  if (!reference || !out) throw Error('--reference and --out are required');
  reference = path.resolve(reference); out = path.resolve(out);
  if (reference === out || reference.startsWith(out + path.sep) || out.startsWith(reference + path.sep)) throw Error('Reference and report directories must be separate');
  fs.mkdirSync(out, { recursive: true });
  if (fs.readdirSync(out).length) throw Error('Report output directory must be empty');
  const requestedCategories = categories(suite), results = [], producerErrors = [];
  const jobs = [];
  if (suite !== 'live') jobs.push(['renderer', d => d.category === 'full-screen']);
  if (suite !== 'live' && scope === 'full') jobs.push(['visual', d => ['artwork','compositing'].includes(d.category)]);
  if (suite !== 'renderer') {
    const initialIds = new Set(requiredChecks('initial').map(d => d.id));
    jobs.push(['initialLive', d => d.category === 'live' && initialIds.has(d.id)]);
    if (scope === 'full') jobs.push(
      ['expandedLive', d => d.category === 'live' && ['fright-restoration','ghost-eaten','last-life-death','level-completion'].includes(d.scenario)],
      ['races', d => d.category === 'live' && !initialIds.has(d.id) && !['fright-restoration','ghost-eaten','last-life-death','level-completion','real-bot-natural-life-loss'].includes(d.scenario)],
      ['simulation', d => d.scenario === 'real-bot-natural-life-loss']);
  }
  for (const [name, accepts] of jobs) {
    const assigned = definitions.filter(accepts), outDir = path.join(out, name);
    let produced = [], error;
    try { produced = await producers[name]({ scope, mode: 'both', reference, outDir, definitions: assigned }); }
    catch (caught) {
      error = caught.message; producerErrors.push({ producer: name, reason: error });
      try {
        if (name === 'renderer' && fs.existsSync(path.join(outDir, 'index.json'))) produced = await loadRendererResults({ reference, actual: outDir, definitions: assigned });
        else {
          const file = fs.existsSync(path.join(outDir, 'index.json')) ? path.join(outDir, 'index.json') : path.join(outDir, 'checks.json');
          const partial = read(file); produced = loadCheckResults({ root: outDir, checks: partial.checks ?? partial });
        }
      } catch { /* No usable partial index: keep all assigned entries unavailable. */ }
    }
    results.push(...produced);
    for (const d of assigned) if (!produced.some(r => r.checkId === d.id)) results.push(nonpass(d, error ?? 'Producer did not supply required checkpoint results', error ? 'unavailable' : 'incomplete'));
  }
  for (const d of definitions.filter(d => !requestedCategories.includes(d.category))) results.push(nonpass(d, `Not requested by --suite ${suite}`, 'incomplete'));
  return writeSequenceReport({ definitions, results, outDir: out, requestedCategories, producerErrors,
    provenance: { scope, suite, reference, capture: 'Fresh producers; reference directory read only', excludedOverlay: '[data-game-controls] (only renderer/display capture exclusion)',
      matching: 'No tolerance, actor alignment, masks or frame overrides; categories independent', ...provenance } });
}

export async function main(args = process.argv.slice(2), options = {}) {
  try {
    const parsed = {};
    for (let i = 0; i < args.length; i += 2) {
      if (!['--scope','--suite','--reference','--out'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw Error(`Invalid argument: ${args[i]}`);
      const key = args[i].slice(2); if (parsed[key]) throw Error(`Duplicate argument: ${args[i]}`); parsed[key] = args[i + 1];
    }
    const report = await runValidation({ ...parsed, ...options });
    console.log(`${report.passed ? 'PASS' : 'NON-PASS'}: ${path.resolve(parsed.out, 'index.html')}`);
    return report.passed ? 0 : 1;
  } catch (error) { console.error(error.message); return 1; }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exitCode = await main();
