import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkRomDir, isRomsetGood, mergeGhostEaten, missingScenarios } from './record.mjs';

const folderWith = (...files) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'roms-'));
  for (const file of files) fs.writeFileSync(path.join(dir, file), '');
  return dir;
};

test('a missing PACMAN_ROM_DIR is named', () => {
  const result = checkRomDir(undefined);
  assert.equal(result.ok, false);
  assert.match(result.message, /PACMAN_ROM_DIR/);
});

test('a folder that does not exist is reported', () => {
  const result = checkRomDir(path.join(os.tmpdir(), 'no-such-rom-folder-xyz'));
  assert.equal(result.ok, false);
  assert.match(result.message, /does not exist/);
});

test('a folder with only puckman.zip is rejected as the wrong set', () => {
  const result = checkRomDir(folderWith('puckman.zip'));
  assert.equal(result.ok, false);
  assert.match(result.message, /pacman\.zip/);
  assert.match(result.message, /puckman\.zip is a different ROM set/);
});

test('a folder with pacman.zip passes', () => {
  assert.deepEqual(checkRomDir(folderWith('pacman.zip')), { ok: true });
});

test('MAME verify output is read correctly, including the parent set name', () => {
  assert.equal(isRomsetGood('romset pacman [puckman] is good\n1 romsets found, 1 were OK.'), true);
  assert.equal(isRomsetGood('romset pacman is good\n'), true);
  assert.equal(isRomsetGood('romset pacman [puckman] is bad\n'), false);
  assert.equal(isRomsetGood('romset puckman is good\n'), false);
});

test('the fright and ghost-eating runs merge into one ghostEaten timeline', () => {
  const fright = { scenario: 'fright', source: 'arcade', events: [
    { t: 0, type: 'frightStarted' },
    { t: 3.94, type: 'frightFlashStart', flash: 1 },
    { t: 5.92, type: 'frightEnded' },
  ] };
  const eat = { scenario: 'ghostEaten', source: 'arcade', events: [
    { t: -0.1, type: 'frightStarted' },
    { t: -0.05, type: 'actorMoved', actor: 'pacman' },
    { t: 0, type: 'ghostEaten' },
    { t: 0.02, type: 'scorePopupShown' },
    { t: 0.98, type: 'actorMoved', actor: 'pacman' },
    { t: 0.98, type: 'eyesSoundStarted' },
    { t: 0.98, type: 'eyesStarted' },
    { t: 2.3, type: 'eyesArrived', tiles: 19 },
    { t: 3, type: 'eyesSoundEnded' },
  ] };
  const merged = mergeGhostEaten(fright, eat);
  assert.equal(merged.scenario, 'ghostEaten');
  assert.deepEqual(merged.events.map((e) => e.type), [
    'frightStarted', 'frightFlashStart', 'frightEnded',
    'ghostEaten', 'scorePopupShown', 'actorMoved', 'eyesSoundStarted', 'eyesStarted', 'eyesArrived', 'eyesSoundEnded',
  ]);
  const ghostEaten = merged.events.find((e) => e.type === 'ghostEaten');
  assert.ok(ghostEaten.t > 5.92);
  const moved = merged.events.find((e) => e.type === 'actorMoved');
  assert.ok(Math.abs(moved.t - ghostEaten.t - 0.98) < 1e-9);
});

test('a ROM folder inside the repository is refused', () => {
  const repo = folderWith();
  const inside = path.join(repo, 'roms');
  fs.mkdirSync(inside);
  fs.writeFileSync(path.join(inside, 'pacman.zip'), '');
  const result = checkRomDir(inside, repo);
  assert.equal(result.ok, false);
  assert.match(result.message, /outside this repository/);
});

test('missing scenarios are listed so a partial recording cannot replace the reference', () => {
  const recorded = [{ scenario: 'start' }, { scenario: 'ghostEaten' }];
  assert.deepEqual(missingScenarios(['start', 'death', 'ghostEaten'], recorded), ['death']);
  assert.deepEqual(missingScenarios(['start'], recorded), []);
});
