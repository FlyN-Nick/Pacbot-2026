// npm run record [-- --write-reference]: record the arcade's timelines in MAME
// and reduce them to reference timings.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { reduceTimeline, formatValue } from './compare.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
// fright and ghostEaten are recorded separately and merged (see mergeGhostEaten)
const SCENARIOS = ['start', 'death', 'fright', 'ghostEaten', 'levelComplete', 'siren'];
const MAME_TIMEOUT_MS = 120000;

/** Check that PACMAN_ROM_DIR names a folder holding the pacman (Midway) set. */
export function checkRomDir(dir, repoRoot = repo) {
  if (!dir) {
    return { ok: false, message: 'Set PACMAN_ROM_DIR to the folder containing pacman.zip (kept outside this repository).' };
  }
  if (!fs.existsSync(dir)) return { ok: false, message: `PACMAN_ROM_DIR folder does not exist: ${dir}` };
  // ROMs are copyrighted and this repository is public
  const relative = path.relative(fs.realpathSync(repoRoot), fs.realpathSync(dir));
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    return { ok: false, message: `Keep the ROM folder outside this repository (got ${dir}).` };
  }
  if (fs.existsSync(path.join(dir, 'pacman.zip'))) return { ok: true };
  let message = `No pacman.zip in ${dir}. The recorder needs the pacman (Midway) ROM set.`;
  if (fs.existsSync(path.join(dir, 'puckman.zip'))) message += ' puckman.zip is a different ROM set (Namco Puck Man).';
  return { ok: false, message };
}

/** Whether `mame -verifyroms pacman` output says the set is good (MAME may name the parent set in brackets). */
export function isRomsetGood(output) {
  return /^romset pacman (\[\w+\] )?is good$/m.test(output);
}

// Event types the ghost-eating run contributes to the merged ghostEaten timeline
const EAT_EVENTS = new Set(['ghostEaten', 'scorePopupShown', 'eyesSoundStarted', 'eyesSoundEnded', 'eyesStarted', 'eyesArrived', 'freezeEnded']);

/**
 * Merge the fright-only run (full fright, flashes) and the ghost-eating run into
 * one ghostEaten timeline. The eating run's events from ghostEaten on are placed
 * after the fright run, since eating a ghost pauses the fright timer.
 */
export function mergeGhostEaten(fright, eat) {
  const eaten = eat.events.find((event) => event.type === 'ghostEaten');
  const afterFright = Math.max(0, ...fright.events.map((event) => event.t)) + 5;
  const eatEvents = eaten
    ? eat.events
      .filter((event) => event.t >= eaten.t && (EAT_EVENTS.has(event.type) || event.type === 'actorMoved'))
      .map((event) => ({ ...event, t: event.t - eaten.t + afterFright }))
    : [];
  return { scenario: 'ghostEaten', source: 'arcade', events: [...fright.events, ...eatEvents] };
}

/** Expected scenarios that produced no timeline. */
export function missingScenarios(expected, timelines) {
  const recorded = new Set(timelines.map((timeline) => timeline.scenario));
  return expected.filter((scenario) => !recorded.has(scenario));
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

function main() {
  const romDir = process.env.PACMAN_ROM_DIR;
  const rom = checkRomDir(romDir);
  if (!rom.ok) fail(rom.message);

  if (spawnSync('mame', ['-version']).error) fail('MAME is not installed. Install it with: brew install mame');

  // Refuse unknown ROM revisions: their memory layout may differ.
  const verify = spawnSync('mame', ['-rompath', romDir, '-verifyroms', 'pacman'], { encoding: 'utf8' });
  if (!isRomsetGood(verify.stdout)) {
    fail(`MAME could not verify the pacman ROM set in ${romDir}:\n${verify.stdout}${verify.stderr}`);
  }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-record-'));
  const timelines = [];
  try {
    for (const scenario of SCENARIOS) {
      console.log(`Recording ${scenario}...`);
      const out = path.join(tmp, `${scenario}.json`);
      try {
        execFileSync('mame', ['pacman', '-rompath', romDir,
          '-autoboot_script', path.join(here, 'mame', 'recorder.lua'),
          '-nothrottle', '-video', 'none', '-sound', 'none', '-skip_gameinfo'], {
          cwd: path.join(here, 'mame'),
          // SDL_VIDEODRIVER=dummy keeps MAME from opening a window
          env: { ...process.env, ARCADE_SCENARIO: scenario, ARCADE_OUT: out, SDL_VIDEODRIVER: 'dummy' },
          stdio: ['ignore', 'ignore', 'pipe'],
          timeout: MAME_TIMEOUT_MS,
        });
      } catch (error) {
        console.log(`  ${scenario}: MAME failed or timed out (${error.message.split('\n')[0]})`);
      }
      if (fs.existsSync(out)) timelines.push(JSON.parse(fs.readFileSync(out, 'utf8')));
      else console.log(`  ${scenario}: no timeline written`);
    }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // Checked before merging, so a failed fright or ghostEaten run counts
  const missing = missingScenarios(SCENARIOS, timelines);
  const fright = timelines.find((timeline) => timeline.scenario === 'fright');
  const eat = timelines.find((timeline) => timeline.scenario === 'ghostEaten');
  if (fright && eat) {
    timelines.splice(timelines.indexOf(fright), 1);
    timelines.splice(timelines.indexOf(eat), 1, mergeGhostEaten(fright, eat));
  }

  fs.writeFileSync(path.join(here, 'arcade-timeline.json'), JSON.stringify(timelines, null, 2));
  const reduced = Object.assign({}, ...timelines.map(reduceTimeline));
  console.log('\nArcade measurements:');
  for (const [key, { value, unit }] of Object.entries(reduced)) {
    console.log(`  ${key.padEnd(34)} ${formatValue(value, unit)}`);
  }

  if (process.argv.includes('--write-reference') && missing.length) {
    fail(`\nNot writing the reference: no recording for ${missing.join(', ')}.`);
  }
  if (process.argv.includes('--write-reference')) {
    const source = `MAME pacman, ${new Date().toISOString().slice(0, 10)}`;
    const reference = Object.fromEntries(Object.entries(reduced)
      .map(([key, { value, unit }]) => [key, { value: Number(value.toFixed(4)), unit, source }]));
    const referencePath = path.join(here, 'reference', 'arcade-timings.json');
    fs.mkdirSync(path.dirname(referencePath), { recursive: true });
    fs.writeFileSync(referencePath, JSON.stringify(reference, null, 2) + '\n');
    console.log(`\nWrote ${path.relative(process.cwd(), referencePath)}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
