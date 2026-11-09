// Checks the visualizer's arcade-sequence timings against the timings recorded
// from the original arcade (tools/arcade-timeline). Marked todo until the
// arcade-mode work matches them, so differences are reported without failing.
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
  count: 0,
};

const MAPPINGS = [
  { name: 'READY hold', ours: GUI_TIMINGS.readyHoldMs / 1000, key: 'start.readyToGameStarted', tolerance: 'tick' },
  { name: 'death animation length', ours: GUI_TIMINGS.deathAnimationMs / 1000, key: 'death.animationLength', tolerance: 'animation' },
  { name: 'death animation frame count', ours: GUI_TIMINGS.deathFrames, key: 'death.frameCount', tolerance: 'count' },
];

for (const { name, ours, key, tolerance } of MAPPINGS) {
  const arcade = reference[key]?.value;
  if (arcade === undefined) {
    test(`${name} matches the arcade`, { skip: `no reference for ${key}` }, () => {});
    continue;
  }
  test(`${name} matches the arcade (${key})`, { todo: true }, () => {
    assert.ok(Math.abs(ours - arcade) <= TOLERANCE[tolerance] + 1e-9,
      `ours ${ours}, arcade ${arcade}, tolerance ${TOLERANCE[tolerance]}`);
  });
}
