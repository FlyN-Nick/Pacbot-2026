import test from 'node:test';
import assert from 'node:assert/strict';
import { SIREN_STEPS, sirenStepFor, sirenShouldPlay, createSiren } from './siren.js';

test('siren steps match the arcade', () => {
  assert.deepEqual(SIREN_STEPS.map(({ pellets }) => pellets), [244, 123, 63, 27, 15]);
  assert.deepEqual(SIREN_STEPS.map(({ periodSeconds }) => periodSeconds), [0.396, 0.363, 0.330, 0.297, 0.264]);
});

test('the step changes when the pellets remaining reach each threshold', () => {
  const cases = [[300, 1], [244, 1], [243, 1], [124, 1], [123, 2], [64, 2], [63, 3], [28, 3], [27, 4], [16, 4], [15, 5], [1, 5]];
  for (const [pellets, step] of cases) assert.equal(sirenStepFor(pellets), step, `${pellets} pellets`);
});

test('the siren plays only during active, unpaused, ordinary play', () => {
  const base = { active: true, paused: false, frightened: false, eyes: false, dying: false, ready: false };
  assert.equal(sirenShouldPlay(base), true);
  for (const flag of ['paused', 'frightened', 'eyes', 'dying', 'ready']) {
    assert.equal(sirenShouldPlay({ ...base, [flag]: true }), false, flag);
  }
  assert.equal(sirenShouldPlay({ ...base, active: false }), false);
});

test('without audio the siren does nothing and does not throw', () => {
  for (const getAudio of [() => null, () => { throw new Error('locked'); }]) {
    const siren = createSiren({ getAudio });
    assert.doesNotThrow(() => { siren.setStep(3); siren.start(); siren.stop(); });
    assert.equal(siren.playing, false);
  }
});

function fakeAudio() {
  const oscillators = [];
  const param = () => ({ calls: [], setValueAtTime(v, t) { this.calls.push(['set', v, t]); },
    linearRampToValueAtTime(v, t) { this.calls.push(['ramp', v, t]); }, cancelScheduledValues() { this.calls = []; } });
  const context = {
    currentTime: 0,
    createOscillator() {
      const osc = { type: '', frequency: param(), started: false, stopped: false,
        connect() {}, disconnect() {}, start() { this.started = true; }, stop() { this.stopped = true; } };
      oscillators.push(osc);
      return osc;
    },
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; },
  };
  return { context, oscillators, destination: {} };
}

test('the siren sweeps once per loop period of its step', () => {
  const audio = fakeAudio();
  const siren = createSiren({ getAudio: () => audio });
  siren.setStep(3);
  siren.start();
  assert.equal(audio.oscillators.length, 1);
  assert.equal(siren.playing, true);
  const ramps = audio.oscillators[0].frequency.calls.filter(([kind]) => kind === 'ramp');
  // Up over half a period, down over the other half
  assert.ok(Math.abs(ramps[0][2] - 0.165) < 1e-9, `first ramp ends at ${ramps[0][2]}`);
  assert.ok(Math.abs(ramps[1][2] - 0.330) < 1e-9, `second ramp ends at ${ramps[1][2]}`);
  siren.stop();
  assert.equal(audio.oscillators[0].stopped, true);
  assert.equal(siren.playing, false);
  siren.stop();
});

test('starting twice keeps one oscillator', () => {
  const audio = fakeAudio();
  const siren = createSiren({ getAudio: () => audio });
  siren.start();
  siren.start();
  assert.equal(audio.oscillators.length, 1);
  siren.stop();
});
