import test from 'node:test';
import assert from 'node:assert/strict';
import { createEyesSound } from './eyesSound.js';

function fakeAudio() {
  const oscillators = [];
  const gains = [];
  const param = () => ({ calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); }, cancelScheduledValues() { this.calls = []; } });
  const context = {
    currentTime: 0,
    createOscillator() {
      const osc = { type: '', frequency: param(), stopped: false,
        connect() {}, disconnect() {}, start() {}, stop(when) { this.stopped = true; this.stopAt = when; } };
      oscillators.push(osc);
      return osc;
    },
    createGain() {
      const gain = { gain: { value: 1, ramps: [], setValueAtTime(v, t) { this.ramps.push(['set', v, t]); },
        linearRampToValueAtTime(v, t) { this.ramps.push(['ramp', v, t]); } }, connect() {}, disconnect() {} };
      gains.push(gain);
      return gain;
    },
  };
  return { context, oscillators, gains, destination: {} };
}

test('without audio the eyes sound does nothing and does not throw', () => {
  for (const getAudio of [() => null, () => { throw new Error('locked'); }]) {
    const sound = createEyesSound({ getAudio, periodMs: 264 });
    assert.doesNotThrow(() => { sound.start(); sound.stop(); });
    assert.equal(sound.playing, false);
  }
});

test('the eyes sound falls in pitch once per period, like the arcade', () => {
  const audio = fakeAudio();
  const sound = createEyesSound({ getAudio: () => audio, periodMs: 264 });
  sound.start();
  sound.start();
  assert.equal(audio.oscillators.length, 1);
  const calls = audio.oscillators[0].frequency.calls;
  const firstRamp = calls.find(([kind]) => kind === 'ramp');
  const firstSet = calls.find(([kind]) => kind === 'set');
  assert.ok(firstRamp[1] < firstSet[1], 'falls from high to low');
  assert.ok(Math.abs(firstRamp[2] - 0.264) < 1e-9, `first fall ends at ${firstRamp[2]}`);
  sound.stop();
  assert.equal(audio.oscillators[0].stopped, true);
  assert.equal(sound.playing, false);
});

test('stopping the eyes sound fades it out instead of cutting it', () => {
  const audio = fakeAudio();
  audio.context.currentTime = 2;
  const sound = createEyesSound({ getAudio: () => audio, periodMs: 264 });
  sound.start();
  sound.stop();
  const osc = audio.oscillators[0];
  assert.ok(osc.stopAt > 2 && osc.stopAt <= 2.03, `stops at ${osc.stopAt}`);
  const fade = audio.gains[0].gain.ramps.find(([kind, value]) => kind === 'ramp' && value === 0);
  assert.ok(fade && Math.abs(fade[2] - osc.stopAt) < 1e-9, 'gain fades to zero as it stops');
});
