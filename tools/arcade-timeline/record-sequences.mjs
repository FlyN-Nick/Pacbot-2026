// Painted MAME references. All artifact paths are relative to the index root.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { pathToFileURL } from 'node:url';
import { PNG } from 'pngjs';
import { checkRomDir, isRomsetGood } from './record.mjs';
import { validateSequence } from './sequence-contract.mjs';
import { requiredChecks } from './sequence-coverage.mjs';
import {expandedReferenceRanges} from './visual-scenarios.mjs';

const here = import.meta.dirname;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const readJSON = file => JSON.parse(fs.readFileSync(file, 'utf8'));
const writeJSON = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
const id = frame => `f${String(frame).padStart(6, '0')}`;

export function makeIndex(scope) {
  return { version: 2, scope, sequences: requiredChecks(scope).map(check => ({
    checkId: check.id, status: 'unavailable', reason: `No MAME sequence producer for ${check.id}`,
  })), context: [{ reason: 'The browser waiting maze has no equivalent arcade attract-screen reference.' }] };
}
export function requireVerifiedEnvironment(version, output, status) {
  if (!/^0\.289(?:\s|$)/.test(version.trim())) throw Error('Paint observer is calibrated only for MAME 0.289');
  if (status !== 0 || !isRomsetGood(output)) throw Error('ROM verification must identify the good pacman set');
}

export function validateCheckpointCoverage(samples, checkpoints, definition) {
  const byId = new Map(samples.map(sample => [sample.id, sample]));
  for (const check of definition.checkpoints) {
    const coverage = checkpoints?.[check.id];
    if (!coverage?.sampleIds?.length) throw Error(`Missing checkpoint ${check.id}`);
    if (new Set(coverage.sampleIds).size !== coverage.sampleIds.length) throw Error(`Duplicate samples for ${check.id}`);
    const selected = coverage.sampleIds.map(key => {
      if (!byId.has(key)) throw Error(`Missing sample ${key} for ${check.id}`);
      return byId.get(key);
    });
    if (check.completeness === 'all-observed') {
      const { firstFrame, lastFrame } = coverage;
      if (!Number.isSafeInteger(firstFrame) || !Number.isSafeInteger(lastFrame) || lastFrame <= firstFrame
        || selected.length !== lastFrame - firstFrame + 1
        || selected.some((sample, i) => sample.emulatedFrame !== firstFrame + i)) {
        throw Error(`Non-contiguous dense interval for ${check.id}`);
      }
      const codes = selected.map(sample => sample.state?.spriteAttributes?.[10] >> 2);
      if (definition.scenario === 'death-respawn' && check.id === 'death-art-transitions') {
        if (codes[0] >= 52 || codes.at(-1) !== 63 || codes.at(-2) !== 63
          || Array.from({ length: 12 }, (_, i) => 52 + i).some(code => !codes.includes(code))) {
          throw Error('Incomplete death art boundaries/transitions');
        }
      }
      if(definition.scenario?.startsWith('mouth-')&&check.id==='mouth-cycle') {
        const expected={left:[194,186,178,186,194],right:[192,184,176,184,192],up:[192,189,181,189,192],down:[192,188,180,188,192]}[definition.scenario.slice(6)];
        const attrs=selected.map(sample=>sample.state.spriteAttributes[10]),transitions=attrs.filter((a,i)=>!i||a!==attrs[i-1]);
        if(!expected||transitions.join(',')!==expected.join(','))throw Error('Incomplete or mismatched directional mouth cycle');
      }
      if (definition.scenario === 'ready-movement' && check.id === 'mouth-cycle') {
        const transitions = codes.filter((code, i) => !i || code !== codes[i - 1]);
        if (!transitions.join(',').includes('48,46,44,46,48')) throw Error('Incomplete observed mouth cycle');
      }
    }
  }
}

// Independent PNG observation, not a value copied from RAM. In the initial
// sequences yellow Pac-Man is in slot 5. Source geometry is verified below
// using moving closed poses; masked pixels/occlusion are never called full art.
function pacmanSlot(state) {
  const slots=Array.from({length:8},(_,slot)=>slot).filter(slot=>state.spriteAttributes[slot*2+1]===9);
  return slots.length===1?slots[0]:-1;
}
function pacmanAttribute(state) {const slot=pacmanSlot(state);return slot<0?null:state.spriteAttributes[slot*2];}
function pacmanOrigin(state) {const slot=pacmanSlot(state);return slot<0?null:{left:240-state.spriteCoordinates[slot*2]-(slot<=2?1:0),top:272-state.spriteCoordinates[slot*2+1]};}
function yellowBounds(png, state) {
  const origin=pacmanOrigin(state);if(!origin)return null;const {left,top}=origin;
  const points = [];
  for (let y = Math.max(24, top); y < Math.min(264, top + 16); y++) {
    for (let x = Math.max(0, left); x < Math.min(224, left + 16); x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] === 255 && png.data[i + 1] === 255 && png.data[i + 2] === 0) points.push([x, y]);
    }
  }
  return points.length ? { left: Math.min(...points.map(p => p[0])), top: Math.min(...points.map(p => p[1])),
    right: Math.max(...points.map(p => p[0])), bottom: Math.max(...points.map(p => p[1])), pixels: points.length } : null;
}
function closedBounds(state) {
  const origin=pacmanOrigin(state);if(!origin)return null;const {left,top}=origin;
  return { left: left + 1, top: top + 1, right: left + 13, bottom: top + 13, pixels: 137 };
}
function artifact(root, relative) {
  if (typeof relative !== 'string' || /[\\\u0000-\u001f:?"<>|#%]/.test(relative)
    || relative.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Unsafe artifact path');
  const file = path.join(root, relative);
  const resolved = fs.realpathSync(file), base = fs.realpathSync(root) + path.sep;
  if (!resolved.startsWith(base)) throw Error('Artifact escapes root');
  return resolved;
}
function verifyCalibration(root, file) {
  const calibration = readJSON(artifact(root, file));
  if (calibration.method !== 'mame-frame-done-motion-v1' || calibration.proofs?.length < 4) throw Error('Missing substantive paint observer calibration');
  const frames = new Set();
  for (const proof of calibration.proofs) {
    const raw = readJSON(artifact(root, proof.raw));
    const png = PNG.sync.read(fs.readFileSync(artifact(root, proof.image)));
    const observed = yellowBounds(png, raw.paintedState);
    if (frames.has(raw.frame) || pacmanAttribute(raw.paintedState) !== 194 || pacmanAttribute(raw.machineState) !== 194
      || raw.screenFrame !== raw.machineScreenFrame + 1
      || !isDeepStrictEqual(observed, closedBounds(raw.paintedState))
      || isDeepStrictEqual(observed, closedBounds(raw.machineState))) throw Error('Paint observer calibration does not distinguish adjacent state');
    frames.add(raw.frame);
  }
  return calibration;
}

export function validateRecordedSequence(root, manifest, definition) {
  validateSequence(manifest);
  const checked = new Set();
  for (const sample of manifest.samples) {
    const bytes = fs.readFileSync(artifact(root, sample.image));
    const png = PNG.sync.read(bytes);
    if (png.width !== 224 || png.height !== 288) throw Error('PNG dimensions must be native 224 x 288');
    const evidence = readJSON(artifact(root, sample.alignment.evidence[0]));
    if (evidence.method !== 'mame-frame-done-motion-v1' || !evidence.raw || !evidence.calibration) throw Error('Missing painted association observer evidence');
    if (!checked.has(evidence.calibration)) {
      verifyCalibration(root, evidence.calibration); checked.add(evidence.calibration);
    }
    const raw = readJSON(artifact(root, evidence.raw));
    if (raw.frame !== sample.emulatedFrame || raw.screenFrame !== sample.paintedFrame
      || !isDeepStrictEqual(raw.paintedState, sample.state) || evidence.pngSha256 !== digest(bytes)
      || evidence.rawSha256 !== digest(fs.readFileSync(artifact(root, evidence.raw)))
      || !isDeepStrictEqual(evidence.yellowBounds, yellowBounds(png, sample.state))) throw Error(`Painted association mismatch at ${sample.id}`);
    for (const file of sample.alignment.evidence) artifact(root, file);
  }
  // Publishing includes retained input/verification provenance, not just PNGs.
  artifact(root, manifest.provenance.commands);
  artifact(root, manifest.provenance.rawEvents);
  const environment = readJSON(artifact(root, manifest.provenance.verificationArtifact));
  requireVerifiedEnvironment(environment.mameVersion, environment.verification, environment.verificationExitStatus);
  validateCheckpointCoverage(manifest.samples, manifest.provenance.checkpoints, definition);
  return manifest;
}

function capture(root, scenario, romDir, direction) {
  const relative = `${scenario}/raw`, dir = path.join(root, relative);
  fs.mkdirSync(dir, { recursive: true });
  const args = ['pacman', '-rompath', romDir, '-autoboot_script', path.join(here, 'mame/recorder.lua'),
    '-nothrottle', '-video', 'none', '-sound', 'none', '-seconds_to_run', '120', '-skip_gameinfo', '-noreadconfig', '-nowriteconfig',
    '-cfg_directory', path.join(root, scenario, 'cfg'), '-nvram_directory', path.join(root, scenario, 'nvram')];
  const result = spawnSync('mame', args, { cwd: path.join(here, 'mame'), encoding: 'utf8', timeout: 120000,
    env: { ...process.env, SDL_VIDEODRIVER: 'dummy', ARCADE_SCENARIO: direction?'start':scenario, ...(direction?{ARCADE_SEQUENCE_DIRECTION:direction}:{}),
      ARCADE_OUT: path.join(dir, 'timeline.json'), ARCADE_SEQUENCE_DIR: dir } });
  fs.writeFileSync(path.join(root, scenario, 'mame.log'), `${result.stdout ?? ''}${result.stderr ?? ''}`);
  writeJSON(path.join(root, scenario, 'command.json'), { executable: 'mame', args,
    inputs: [{ frame: 300, input: 'Coin 1', value: 1 }, { frame: 306, input: 'Coin 1', value: 0 },
      { frame: 400, input: '1 Player Start', value: 1 }, { frame: 406, input: '1 Player Start', value: 0 }],
    joystick: direction?`${direction} held from recorder frame700; retained sequenceInput event`:'untouched; default left movement', memoryWrites: scenario==='fright'?'Existing recorder plants power pellet at firstPelletsEaten[3]':scenario==='ghostEaten'?'Existing recorder plants power pellet and teleports Pac-Man to Blinky for ghost-eaten setup':'none', environment: { SDL_VIDEODRIVER: 'dummy' } });
  if (result.status !== 0 || result.error || /LUA ERROR|Fatal error/.test(`${result.stdout}${result.stderr}`)) throw Error(`MAME capture failed: ${result.error?.message ?? result.status}`);
  const rows = fs.readdirSync(dir).filter(name => /^f\d+\.json$/.test(name)).sort().map(name => readJSON(path.join(dir, name)));
  if (!rows.length) throw Error('No painted frames recorded');
  return { relative, rows, events: readJSON(path.join(dir, 'events.json')) };
}

function build(root, scenario, capture, environment, expanded) {
  const { rows, relative } = capture;
  const checkId = expanded?.definition.id ?? (scenario === 'start' ? 'full-screen:ready-movement' : 'full-screen:death-respawn');
  const definition = expanded?.definition ?? requiredChecks('initial').find(check => check.id === checkId);
  const folder=expanded?`${scenario}/${definition.scenario}`:scenario;fs.mkdirSync(path.join(root,folder),{recursive:true});
  const first = (predicate, reason) => { const row = rows.find(predicate); if (!row) throw Error(`Unavailable checkpoint: ${reason}`); return row.frame; };
  const ready = first(r => r.frame > 500 && r.paintedState.mainState === 3 && r.paintedState.readyTile === 0x52
    && r.paintedState.spriteCoordinates[10] === 135, 'ready-visible with initialized actors');
  const movement = after => first(r => r.frame > after && r.paintedState.subState === 3
    && r.paintedState.spriteCoordinates[10] !== 135, 'first painted movement');
  const startMove = movement(ready);
  let from, to, anchor;
  const ranges = expanded?.ranges ?? {};
  if(expanded){from=Math.min(...Object.values(ranges).flat())-1;to=Math.max(...Object.values(ranges).flat())+1;anchor=from+1;}
  else if (scenario === 'start') {
    from = ready - 2; to = startMove + 32; anchor = ready;
    ranges['ready-visible'] = [ready, ready];
    ranges['before-release'] = [startMove - 1, startMove - 1];
    ranges['first-movement'] = [startMove, startMove];
    ranges['mouth-cycle'] = [startMove - 1, startMove + 32];
  } else {
    const caught = first(r => r.frame > startMove && r.paintedState.deathAnimation > 0, 'death-catch');
    const art = first(r => r.frame > caught && (r.paintedState.spriteAttributes[10] >> 2) === 52, 'death art start');
    const blank = first(r => r.frame > art && (r.paintedState.spriteAttributes[10] >> 2) === 63, 'blank death art');
    const nextReady = first(r => r.frame > blank && r.paintedState.readyTile === 0x52
      && r.paintedState.spriteCoordinates[10] === 135, 'next-life-ready with visible actors');
    const nextMove = movement(nextReady);
    const caughtRow = rows.find(r => r.frame === caught);
    if (caughtRow.paintedState.actorRam[8] === 196 && caughtRow.paintedState.actorRam[9] === 128) throw Error('Death occurred at spawn');
    from = caught - 3; to = nextMove + 16; anchor = caught;
    ranges['death-catch'] = [caught, caught];
    ranges['initial-hold'] = [caught + 1, art - 1];
    ranges['death-art-transitions'] = [art - 1, blank + 1];
    ranges.blank = [blank, blank + 1];
    ranges['next-life-ready'] = [nextReady, nextReady];
    ranges['first-movement'] = [nextMove, nextMove];
  }
  const selected = rows.filter(row => expanded?Object.values(ranges).some(([a,b])=>row.frame>=a-1&&row.frame<=b+1):row.frame >= from && row.frame <= to);
  if (!expanded && selected.length !== to - from + 1) throw Error('Incomplete dense capture interval');
  // Prove the callback association using several independent moving, closed
  // poses. Their PNG bounds match AFTER state and reject BEFORE state.
  const proofs = rows.filter(row => pacmanAttribute(row.paintedState) === 194
    && pacmanAttribute(row.machineState) === 194
    && !isDeepStrictEqual(pacmanOrigin(row.paintedState),pacmanOrigin(row.machineState)))
    .filter(row => isDeepStrictEqual(yellowBounds(PNG.sync.read(fs.readFileSync(path.join(root, relative, row.image))), row.paintedState), closedBounds(row.paintedState)))
    .slice(0, 8).map(row => ({ raw: `${relative}/${id(row.frame)}.json`, image: `${relative}/${row.image}` }));
  const calibration = `${folder}/paint-calibration.json`;
  writeJSON(path.join(root, calibration), { method: 'mame-frame-done-motion-v1',
    relationship: 'frame_done PNG agrees with post-update sprite registers; machine notifier precedes that paint; logical actor RAM may lead hardware sprite state',
    proofs, coordinateFormula: 'unique palette9 slot s: upright left=240-coordinate[2*s]-(s<=2?1:0), top=272-coordinate[2*s+1]',
    source: 'https://github.com/mamedev/mame/blob/mame0289/src/mame/pacman/pacman_v.cpp' });
  verifyCalibration(root, calibration);
  fs.mkdirSync(path.join(root, folder, 'evidence'));
  const checkpoints = Object.fromEntries(Object.entries(ranges).map(([name, [firstFrame, lastFrame]]) => [name, {
    sampleIds: selected.filter(r => r.frame >= firstFrame && r.frame <= lastFrame).map(r => id(r.frame)), firstFrame, lastFrame,
  }]));
  const samples = selected.map(row => {
    const image = `${relative}/${row.image}`, raw = `${relative}/${id(row.frame)}.json`, evidence = `${folder}/evidence/${id(row.frame)}.json`;
    const bytes = fs.readFileSync(path.join(root, image));
    writeJSON(path.join(root, evidence), { method: 'mame-frame-done-motion-v1', calibration, raw,
      pngSha256: digest(bytes), rawSha256: digest(fs.readFileSync(path.join(root, raw))), yellowBounds: yellowBounds(PNG.sync.read(bytes), row.paintedState) });
    return { id: id(row.frame), event: definition.scenario, offsetFrames: row.frame - anchor,
      emulatedFrame: row.frame, paintedFrame: row.screenFrame, image, dimensions: { width: 224, height: 288 }, state: row.paintedState,
      alignment: { method: 'mame-frame-done-motion-v1', paintedFrame: row.screenFrame, state: row.paintedState, evidence: [evidence, raw, calibration] } };
  });
  const manifest = { version: 2, kind: 'renderer-reference', scenario: definition.scenario,
    provenance: { ...environment, artifactBase: 'index-root', capture: 'full native upright screen; no crop, scale, region suppression or overlays',
      ...(definition.scenario.startsWith('mouth-')?{pacmanFacing:definition.scenario.slice(6)}:{}),
      commands: `${scenario}/command.json`, rawEvents: `${relative}/events.json`, checkpoints,
      observedInterval: { firstFrame: from, lastFrame: to, sampling: expanded?'checkpoint frames and immediate neighbors':'every emulated frame including both boundaries' },
      rawSchema: 'mame-pacman-raw-v1; logical RAM is not assumed to be already painted',
      unsupported: ['pre-start full-screen browser waiting equivalent', 'unobserved level and fruit progression', 'unreached directional states, anonymous frightened identities and score-popup rendering'] }, samples };
  validateRecordedSequence(root, manifest, definition);
  const file = `${folder}/manifest.json`;
  writeJSON(path.join(root, file), manifest);
  // Human-review contact sheet: full native frames at anchors and art changes.
  const interesting = new Set(Object.values(ranges).flat());
  for (let i = 1; i < selected.length; i++) if (selected[i].paintedState.spriteAttributes[10] !== selected[i - 1].paintedState.spriteAttributes[10]) {
    for (const offset of [-1, 0, 1]) interesting.add(selected[i].frame + offset);
  }
  const frames = selected.filter(row => interesting.has(row.frame));
  const sheet = new PNG({ width: 224 * 8, height: 288 * Math.ceil(frames.length / 8) });
  frames.forEach((row, i) => PNG.bitblt(PNG.sync.read(fs.readFileSync(path.join(root, relative, row.image))), sheet, 0, 0, 224, 288, (i % 8) * 224, Math.floor(i / 8) * 288));
  fs.writeFileSync(path.join(root, folder, 'contact-sheet.png'), PNG.sync.write(sheet));
  writeJSON(path.join(root, folder, 'contact-sheet.json'), frames.map(row => ({ frame: row.frame, image: `${relative}/${row.image}` })));
  return { checkId, status: 'recorded', manifest: file };
}

function main() {
  const args = process.argv.slice(2);
  const scope = args[args.indexOf('--scope') + 1];
  const destination = args[args.indexOf('--out') + 1];
  if (!args.includes('--scope') || !args.includes('--out') || !destination || !['initial', 'full'].includes(scope)
    || args.length !== 4) throw Error('Usage: record-sequences.mjs --scope initial|full --out <empty-directory>');
  const root = path.resolve(destination);
  if (fs.existsSync(root) && fs.readdirSync(root).length) throw Error('Output directory must be empty; references are never overwritten');
  fs.mkdirSync(root, { recursive: true });
  const index = makeIndex(scope);
  const save = () => writeJSON(path.join(root, 'index.json'), index);
  save();
  try {
    const rom = checkRomDir(process.env.PACMAN_ROM_DIR);
    if (!rom.ok) throw Error(rom.message);
    const version = spawnSync('mame', ['-version'], { encoding: 'utf8' });
    const verification = spawnSync('mame', ['-rompath', process.env.PACMAN_ROM_DIR, '-verifyroms', 'pacman'], { encoding: 'utf8' });
    requireVerifiedEnvironment(version.stdout ?? '', verification.stdout ?? '', verification.status);
    const environment = { mameVersion: version.stdout.trim(), romSet: 'pacman', verification: verification.stdout.trim(), verificationArtifact: 'environment.json' };
    writeJSON(path.join(root, 'environment.json'), { ...environment, verificationExitStatus: verification.status,
      commands: [['mame', '-version'], ['mame', '-rompath', process.env.PACMAN_ROM_DIR, '-verifyroms', 'pacman']] });
    for (const scenario of ['start', 'death']) {
      const checkId = `full-screen:${scenario === 'start' ? 'ready-movement' : 'death-respawn'}`;
      const position = index.sequences.findIndex(entry => entry.checkId === checkId);
      try { index.sequences[position] = build(root, scenario, capture(root, scenario, process.env.PACMAN_ROM_DIR), environment); }
      catch (error) { index.sequences[position] = { checkId, status: 'incomplete', reason: error.message }; }
      save();
    }
    if(scope==='full')for(const scenario of ['fright','ghostEaten']) {
      const recording=capture(root,scenario,process.env.PACMAN_ROM_DIR);
      for(const definition of requiredChecks(scope).filter(d=>d.category==='full-screen'&&(scenario==='fright'?d.scenario==='fright-restoration'||d.scenario.startsWith('ghost-')&&d.scenario!=='ghost-eaten':d.scenario.startsWith('eyes-')))) {
        const position=index.sequences.findIndex(e=>e.checkId===definition.id);
        try{const ranges=expandedReferenceRanges(definition.scenario,recording.rows);index.sequences[position]=build(root,scenario,recording,environment,{definition,ranges});}
        catch(error){index.sequences[position]={checkId:definition.id,status:'unavailable',reason:error.message};}
        save();
      }
    }
    if(scope==='full')for(const direction of ['left','right','up','down']) {
      const scenario=`direction-${direction}`,definition=requiredChecks(scope).find(d=>d.id===`full-screen:mouth-${direction}`),position=index.sequences.findIndex(e=>e.checkId===definition.id);
      try {const recording=capture(root,scenario,process.env.PACMAN_ROM_DIR,direction[0].toUpperCase()+direction.slice(1)),ranges=expandedReferenceRanges(definition.scenario,recording.rows);index.sequences[position]=build(root,scenario,recording,environment,{definition,ranges});}
      catch(error){index.sequences[position]={checkId:definition.id,status:'unavailable',reason:error.message};}save();
    }
  } catch (error) {
    index.sequences = index.sequences.map(entry => ({ ...entry, reason: error.message })); save(); console.error(error.message);
  }
  const renderer = index.sequences.filter(entry => /^(full-screen|artwork):/.test(entry.checkId));
  console.log(JSON.stringify(index.sequences.map(({ checkId, status, reason }) => ({ checkId, status, reason })), null, 2));
  process.exitCode = renderer.every(entry => entry.status === 'recorded') ? 0 : 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
