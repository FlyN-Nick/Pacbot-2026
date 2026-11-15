// Loudness balance: every sound file, times its gain, lands near its group's target
// loudness, and the synthesized background sounds sit with the background group.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CUE_FILES, CUE_GAIN, LOUDNESS_TARGET_DB } from './audioController.js';
import { SIREN_GAIN } from './siren.js';
import { EYES_GAIN } from './eyesSound.js';

/** RMS loudness of a PCM WAV file in dBFS (8-bit unsigned or 16-bit signed). */
function wavRmsDb(file) {
  const buffer = fs.readFileSync(new URL(`../../public/audio/${file}`, import.meta.url));
  let format;
  for (let offset = 12; offset + 8 <= buffer.length;) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    if (id === 'fmt ') format = { channels: buffer.readUInt16LE(offset + 10), bits: buffer.readUInt16LE(offset + 22) };
    if (id === 'data') {
      const bytes = format.bits / 8;
      let sum = 0;
      const count = size / bytes;
      for (let i = 0; i < count; i++) {
        const at = offset + 8 + i * bytes;
        const value = bytes === 1 ? (buffer[at] - 128) / 128 : buffer.readInt16LE(at) / 32768;
        sum += value * value;
      }
      return 10 * Math.log10(sum / count);
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error(`no data in ${file}`);
}

const db = (gain) => 20 * Math.log10(gain);
// A full-scale triangle wave's RMS is 1/√3
const TRIANGLE_RMS_DB = db(1 / Math.sqrt(3));

for (const [cue, file] of Object.entries(CUE_FILES)) {
  test(`${cue} is balanced with its group`, () => {
    const target = LOUDNESS_TARGET_DB[cue];
    assert.ok(target !== undefined, `no loudness group for ${cue}`);
    const loudness = wavRmsDb(file) + db(CUE_GAIN[cue] ?? 1);
    assert.ok(Math.abs(loudness - target) <= 1, `${cue}: ${loudness.toFixed(1)} dB, target ${target}`);
  });
}

test('the siren and eyes sounds sit with the background sounds', () => {
  const background = LOUDNESS_TARGET_DB.frightened;
  for (const [name, gain] of [['siren', SIREN_GAIN], ['eyes', EYES_GAIN]]) {
    const loudness = TRIANGLE_RMS_DB + db(gain);
    assert.ok(Math.abs(loudness - background) <= 1, `${name}: ${loudness.toFixed(1)} dB, target ${background}`);
  }
});
