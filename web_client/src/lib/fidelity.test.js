// Checks the visualizer's arcade-sequence timings against the timings recorded
// from the original arcade (tools/arcade-timeline).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GUI_TIMINGS } from './guiTimings.js';

const reference = JSON.parse(fs.readFileSync(
  new URL('../../../tools/arcade-timeline/reference/arcade-timings.json', import.meta.url), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../../../config.json', import.meta.url), 'utf8'));

// Same tolerance rules as tools/arcade-timeline/compare.mjs
const TOLERANCE = {
  animation: 1 / 60.606,
  tick: 1 / config.GameFPS,
  audio: 0.05,
  count: 0,
};

/** Length of a PCM WAV file in seconds: the data chunk's size over the fmt chunk's byte rate. */
function wavSeconds(url) {
  const buffer = fs.readFileSync(url);
  let byteRate;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buffer.readUInt32LE(offset + 16);
    if (id === 'data') return size / byteRate;
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no data chunk in ${url}`);
}

const startMusicSeconds = wavSeconds(new URL('../../public/audio/pacman_beginning.wav', import.meta.url));

const MAPPINGS = [
  { name: 'READY hold', ours: GUI_TIMINGS.readyHoldMs / 1000, key: 'start.readyToGameStarted', tolerance: 'tick' },
  { name: 'start music length', ours: startMusicSeconds, key: 'start.musicLength', tolerance: 'audio' },
  { name: 'death freeze', ours: GUI_TIMINGS.deathFreezeMs / 1000, key: 'death.caughtToFirstFrame', tolerance: 'animation' },
  { name: 'death animation length', ours: GUI_TIMINGS.deathAnimationMs / 1000, key: 'death.animationLength', tolerance: 'animation' },
  { name: 'death animation frame count', ours: GUI_TIMINGS.deathFrames, key: 'death.frameCount', tolerance: 'count' },
  { name: 'death end to READY', ours: GUI_TIMINGS.deathEndToReadyMs / 1000, key: 'death.endToReady', tolerance: 'tick' },
  { name: 'READY after a death', ours: GUI_TIMINGS.deathReadyMs / 1000, key: 'death.readyToResume', tolerance: 'tick' },
];

for (const { name, ours, key, tolerance } of MAPPINGS) {
  const arcade = reference[key]?.value;
  if (arcade === undefined) {
    test(`${name} matches the arcade`, { skip: `no reference for ${key}` }, () => {});
    continue;
  }
  test(`${name} matches the arcade (${key})`, () => {
    assert.ok(Math.abs(ours - arcade) <= TOLERANCE[tolerance] + 1e-9,
      `ours ${ours}, arcade ${arcade}, tolerance ${TOLERANCE[tolerance]}`);
  });
}
