import assert from 'node:assert/strict';
import test from 'node:test';
import { createAudioController } from './audioController.js';

function fixture({ failedFetch = false, failedDecode = false } = {}) {
  const sources = [];
  const oscillators = [];
  const gains = [];
  const context = {
    state: 'suspended',
    currentTime: 0,
    destination: {},
    resumeCount: 0,
    async resume() { this.resumeCount++; this.state = 'running'; },
    async close() { this.state = 'closed'; },
    createGain() {
      const gain = { gain: { value: 1, ramps: [],
        setValueAtTime(v, t) { this.ramps.push(['set', v, t]); },
        linearRampToValueAtTime(v, t) { this.ramps.push(['ramp', v, t]); } }, connect() {} };
      gains.push(gain);
      return gain;
    },
    createBufferSource() {
      const source = { loop: false, started: false, stopped: false, connect() {},
        start() { this.started = true; }, stop(when) { this.stopped = true; this.stopAt = when; this.onended?.(); } };
      sources.push(source);
      return source;
    },
    createOscillator() {
      const oscillator = { frequency: { value: 0 }, type: '', started: false, stopped: false,
        connect() {}, start() { this.started = true; }, stop() { this.stopped = true; this.onended?.(); } };
      oscillators.push(oscillator);
      return oscillator;
    },
    async decodeAudioData() {
      if (failedDecode) throw Error('bad WAV');
      return { duration: 1 };
    }
  };
  const urls = [];
  const fetcher = async (url) => {
    urls.push(url);
    if (failedFetch) throw Error('offline');
    return { ok: true, async arrayBuffer() { return new ArrayBuffer(8); } };
  };
  return { context, sources, oscillators, gains, urls, fetcher };
}

test('play while disabled leaves audio context untouched', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  await controller.play('intro');
  assert.equal(f.sources.length, 0);
  assert.equal(f.urls.length, 0);
});

test('unlock resumes the suspended context after enabling', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('intro');
  assert.equal(f.context.resumeCount, 1);
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].started, true);
});

test('volume is clamped to zero through one on shared master gain', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setVolume(2);
  controller.setEnabled(true);
  await controller.unlock();
  assert.equal(f.gains[0].gain.value, 1);
  controller.setVolume(-0.5);
  assert.equal(f.gains[0].gain.value, 0);
  controller.setVolume(0.35);
  assert.equal(f.gains[0].gain.value, 0.35);
});

test('missing assets and decode failures do not reject playback', async () => {
  for (const options of [{ failedFetch: true }, { failedDecode: true }]) {
    const f = fixture(options);
    const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
    controller.setEnabled(true);
    await controller.unlock();
    await assert.doesNotReject(controller.play('fruit'));
    assert.equal(f.sources.length, 0);
  }
});

test('loop cue has one active source and can restart after stop', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher, assetBase: '/test-audio' });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('chomp', { loop: true });
  await controller.play('chomp', { loop: true });
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].loop, true);
  assert.deepEqual(f.urls, ['/test-audio/pacman_chomp.wav']);
  controller.stop('chomp');
  assert.equal(f.sources[0].stopped, true);
  await controller.play('chomp', { loop: true });
  assert.equal(f.sources.length, 2);
});

test('disabling stops active loops and prevents new sounds', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('frightened', { loop: true });
  assert.equal(f.sources.length, 1);
  assert.deepEqual(f.urls, ['/audio/fright_firstloop.wav', '/audio/fright.wav']);
  controller.setEnabled(false);
  assert.equal(f.sources[0].stopped, true);
  await controller.play('frightened', { loop: true });
  assert.equal(f.sources.length, 1);
});

test('frightened mode plays its opening cue, then loops the frightened sound', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('frightened', { loop: true });
  assert.equal(f.sources[0].loop, false);
  f.sources[0].onended();
  assert.equal(f.sources.length, 2);
  assert.equal(f.sources[1].loop, true);
  assert.deepEqual(f.urls, ['/audio/fright_firstloop.wav', '/audio/fright.wav']);
});

test('stopping a pending loop prevents it from starting after load', async () => {
  const f = fixture();
  let releaseFetch;
  const fetcher = () => new Promise((resolve) => { releaseFetch = () => resolve({ ok: true, async arrayBuffer() { return new ArrayBuffer(8); } }); });
  const controller = createAudioController({ contextFactory: () => f.context, fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  const playing = controller.play('chomp', { loop: true });
  controller.stop('chomp');
  releaseFetch();
  await playing;
  assert.equal(f.sources.length, 0);
});

test('a one-shot cue can be interrupted', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('death');
  controller.stop('death');
  assert.equal(f.sources[0].stopped, true);
});

test('death interrupts gameplay audio and holds priority until it ends', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('frightened', { loop: true });
  await controller.play('death');
  assert.equal(f.sources[0].stopped, true);
  await controller.play('chomp');
  assert.equal(f.sources.length, 2);
  f.sources[1].onended();
  await controller.play('chomp');
  assert.equal(f.sources.length, 3);
});

test('death reserves priority while its WAV is loading', async () => {
  const f = fixture();
  let releaseFetch;
  const fetcher = () => new Promise((resolve) => {
    releaseFetch = () => resolve({ ok: true, async arrayBuffer() { return new ArrayBuffer(8); } });
  });
  const controller = createAudioController({ contextFactory: () => f.context, fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  const death = controller.play('death');
  await controller.play('frightened', { loop: true });
  assert.equal(f.sources.length, 0);
  releaseFetch();
  await death;
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].started, true);
});

test('pellets eaten in a row keep one chomp going instead of cutting it off', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('chomp');
  for (const time of [0.12, 0.25, 0.37]) {
    f.context.currentTime = time;
    await controller.play('chomp');
  }
  assert.equal(f.sources.length, 1);
  assert.equal(f.sources[0].stopped, false);
  // Once it has finished, the next pellet starts a new chomp
  f.sources[0].onended();
  f.context.currentTime = 0.8;
  await controller.play('chomp');
  assert.equal(f.sources.length, 2);
});

test('stopping a sound fades it out instead of cutting it, so it does not click', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  f.context.currentTime = 1;
  await controller.play('death');
  controller.stop('death');
  const source = f.sources[0];
  assert.ok(source.stopAt > 1 && source.stopAt <= 1.03, `stops at ${source.stopAt}`);
  const fade = f.gains.flatMap((g) => g.gain.ramps).find(([kind, value]) => kind === 'ramp' && value === 0);
  assert.ok(fade, 'gain ramps to zero');
  assert.ok(Math.abs(fade[2] - source.stopAt) < 1e-9, 'the fade ends as the sound stops');
});

test('onCueStarted reports each cue as its sound starts', async () => {
  const f = fixture();
  const started = [];
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher,
    onCueStarted: (cue) => started.push(cue) });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('intro');
  assert.deepEqual(started, [{ name: 'intro', duration: 1 }]);
});

test('onCueStarted is not called while audio is disabled', async () => {
  const f = fixture();
  const started = [];
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher,
    onCueStarted: (cue) => started.push(cue) });
  await controller.play('intro');
  assert.deepEqual(started, []);
});

test('onCueEnded reports when a cue really ends, including when stopped early', async () => {
  const f = fixture();
  const ended = [];
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher,
    onCueEnded: (cue) => ended.push(cue) });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('intro');
  assert.deepEqual(ended, []);
  controller.stopAll();
  assert.deepEqual(ended, [{ name: 'intro' }]);
});

test('stopAll runs the registered stop callbacks', () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  let calls = 0;
  controller.onStopAll(() => { calls++; });
  controller.stopAll();
  assert.equal(calls, 1);
});

test('the audio graph is only available once unlocked and enabled', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  assert.equal(controller.getAudioGraph(), null);
  controller.setEnabled(true);
  await controller.unlock();
  const graph = controller.getAudioGraph();
  assert.equal(graph.context, f.context);
  assert.ok(graph.destination);
  controller.setEnabled(false);
  assert.equal(controller.getAudioGraph(), null);
});

test('the intermission music is gone', async () => {
  const f = fixture();
  const controller = createAudioController({ contextFactory: () => f.context, fetcher: f.fetcher });
  controller.setEnabled(true);
  await controller.unlock();
  await controller.play('intermission');
  assert.equal(f.urls.length, 0);
});
