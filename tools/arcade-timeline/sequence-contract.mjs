import { isDeepStrictEqual } from 'node:util';

const kinds = ['renderer-reference', 'renderer-actual', 'live'];
const nonempty = value => typeof value === 'string' && value.trim().length > 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const frame = value => Number.isSafeInteger(value) && value >= 0;

function json(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(child => json(child, ancestors));
  ancestors.delete(value);
  return valid;
}

function artifactPath(value) {
  return nonempty(value) && !/[\\\u0000-\u001f:?"<>|#%]/.test(value)
    && value.split('/').every(segment => segment && segment !== '.' && segment !== '..');
}

/**
 * Validate v2 sequence metadata without modifying it or inspecting artifact files.
 * Frame identifiers are integers in independent emulation/paint timelines.
 * Renderer captures are full native screens; live captures may use display sizes.
 *
 * alignment = {method, paintedFrame, state, evidence: relativeArtifactPath[]}.
 * The observer must bind the image and state to the same painted frame. `state`
 * remains opaque JSON, including unavailable-field reasons. Actual replay retains
 * that source state; canonical adapter inputs belong in provenance, not state.
 * Evidence file existence/content must be checked by the consuming runner.
 */
export function validateSequence(manifest) {
  if (!record(manifest) || manifest.version !== 2) throw Error('Invalid sequence version (expected 2)');
  if (!kinds.includes(manifest.kind)) throw Error('Invalid sequence kind');
  if (!nonempty(manifest.scenario)) throw Error('Missing scenario');
  if (!record(manifest.provenance) || !Object.keys(manifest.provenance).length || !json(manifest.provenance)) throw Error('Missing JSON provenance');
  if (!Array.isArray(manifest.samples) || !manifest.samples.length) throw Error('Missing samples');
  const ids = new Set();
  let previousPainted = -1;
  let previousEmulated = -1;
  for (const sample of manifest.samples) {
    if (!record(sample) || !nonempty(sample.id)) throw Error('Missing sample id');
    if (ids.has(sample.id)) throw Error(`Duplicate sample id: ${sample.id}`);
    ids.add(sample.id);
    if (!nonempty(sample.event)) throw Error(`Missing event: ${sample.id}`);
    if (!Number.isSafeInteger(sample.offsetFrames)) throw Error(`Invalid offsetFrames: ${sample.id}`);
    if (!frame(sample.paintedFrame)) throw Error(`Missing paintedFrame: ${sample.id}`);
    if (sample.paintedFrame <= previousPainted) throw Error(`Unordered painted frames: ${sample.id}`);
    previousPainted = sample.paintedFrame;
    if (sample.emulatedFrame !== undefined || manifest.kind === 'renderer-reference') {
      if (!frame(sample.emulatedFrame)) throw Error(`Missing emulatedFrame: ${sample.id}`);
      if (sample.emulatedFrame <= previousEmulated) throw Error(`Unordered emulated frames: ${sample.id}`);
      previousEmulated = sample.emulatedFrame;
    }
    if (!artifactPath(sample.image)) throw Error(`Invalid image artifact path: ${sample.id}`);
    const { width, height } = sample.dimensions ?? {};
    if (![width, height].every(value => Number.isSafeInteger(value) && value > 0)) throw Error(`Invalid dimensions: ${sample.id}`);
    if (manifest.kind !== 'live' && (width !== 224 || height !== 288)) throw Error(`Full-screen dimensions must be 224 × 288: ${sample.id}`);
    if (sample.state === null || !json(sample.state)) throw Error(`Missing JSON state: ${sample.id}`);
    const alignment = sample.alignment;
    if (!record(alignment) || !nonempty(alignment.method) || !Array.isArray(alignment.evidence)
      || !alignment.evidence.length || !alignment.evidence.every(artifactPath)) throw Error(`Missing alignment evidence: ${sample.id}`);
    if (alignment.paintedFrame !== sample.paintedFrame) throw Error(`Incompatible painted frame: ${sample.id}`);
    if (!json(alignment.state) || !isDeepStrictEqual(alignment.state, sample.state)) throw Error(`Incompatible painted state: ${sample.id}`);
  }
  return manifest;
}

/** Pair checkpoints by ID and compatible source identity, never array position.
 * A pair is only an aligned comparison candidate, not a passing visual check.
 * Issues have {code, id?, reason}; any issue is non-pass for the sequence.
 */
export function matchSamples(reference, actual) {
  const pairs = [], issues = [];
  for (const [label, manifest, kind] of [['reference', reference, 'renderer-reference'], ['actual', actual, 'renderer-actual']]) {
    try {
      validateSequence(manifest);
      if (manifest.kind !== kind) throw Error(`Expected ${kind}`);
    } catch (error) {
      issues.push({ code: `invalid-${label}`, reason: error.message });
    }
  }
  if (issues.length) return { pairs, issues };
  if (reference.scenario !== actual.scenario) return { pairs, issues: [{ code: 'incompatible-scenario', reason: 'Reference and actual scenarios differ' }] };
  const actualById = new Map(actual.samples.map(sample => [sample.id, sample]));
  const referenceIds = new Set(reference.samples.map(sample => sample.id));
  for (const source of reference.samples) {
    const target = actualById.get(source.id);
    if (!target) {
      issues.push({ code: 'missing-actual', id: source.id, reason: 'Reference checkpoint has no actual sample' });
      continue;
    }
    const mismatches = [
      ['event', 'event'], ['offsetFrames', 'offset'], ['emulatedFrame', 'emulated-frame'], ['state', 'state'],
    ].filter(([field]) => !isDeepStrictEqual(source[field], target[field]));
    for (const [field, code] of mismatches) issues.push({ code: `incompatible-${code}`, id: source.id, reason: `Checkpoint ${field} differs` });
    if (!mismatches.length) pairs.push({ id: source.id, reference: source, actual: target });
  }
  for (const sample of actual.samples) if (!referenceIds.has(sample.id)) issues.push({ code: 'missing-reference', id: sample.id, reason: 'Actual checkpoint has no reference sample' });
  return { pairs, issues };
}
