const FILES = Object.freeze({
  intro: 'pacman_beginning.wav',
  chomp: 'pacman_chomp.wav',
  fruit: 'pacman_eatfruit.wav',
  ghost: 'pacman_eatghost.wav',
  extraLife: 'pacman_extrapac.wav',
  death: 'pacman_death.wav',
  frightened: 'fright.wav',
  frightenedFirstLoop: 'fright_firstloop.wav'
});
const PRIORITY = { intro: 1, death: 3 };

export const CUE_FILES = FILES;

// Loudness groups, in dBFS RMS: jingles and event sounds stand out, the chomp a little
// less, and background loops (fright, siren, eyes) sit underneath.
const EVENT_DB = -14;
const CHOMP_DB = -16;
const BACKGROUND_DB = -20;
export const LOUDNESS_TARGET_DB = Object.freeze({
  intro: EVENT_DB, death: EVENT_DB, fruit: EVENT_DB, ghost: EVENT_DB, extraLife: EVENT_DB,
  chomp: CHOMP_DB,
  frightened: BACKGROUND_DB, frightenedFirstLoop: BACKGROUND_DB,
});

// Per-cue gain bringing each file to its group's loudness (file RMS measured by audioBalance.test.js)
export const CUE_GAIN = Object.freeze({
  intro: 0.653,              // file -10.3 dB
  death: 0.668,              // -10.5 dB
  fruit: 0.484,              // -7.7 dB
  ghost: 0.490,              // -7.8 dB
  extraLife: 0.624,          // -9.9 dB
  chomp: 0.841,              // -14.5 dB
  frightened: 1.175,         // -21.4 dB
  frightenedFirstLoop: 1.216, // -21.7 dB
});

// Stopping fades out over this long, so a sound cut mid-wave doesn't click
const FADE_SECONDS = 0.015;

/** Browser audio stays silent until both enabled and unlocked by a user gesture. */
export function createAudioController({
  contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  assetBase = '/audio',
  fetcher = (...args) => globalThis.fetch(...args),
  onCueStarted = () => {},
  onCueEnded = () => {}
} = {}) {
  let context;
  let master;
  let enabled = false;
  let unlocked = false;
  let destroyed = false;
  let volume = 0.5;
  let generation = 0;
  const buffers = new Map();
  const active = new Map();
  const pendingLoops = new Map();
  const pendingPriority = new Map();
  const stopVersions = new Map();
  const stopAllCallbacks = [];

  function ensureContext() {
    if (context || destroyed) return context;
    try {
      context = contextFactory();
      master = context.createGain();
      master.gain.value = volume;
      master.connect(context.destination);
      return context;
    } catch {
      context = undefined;
      master = undefined;
      return undefined;
    }
  }

  async function unlock() {
    const audio = ensureContext();
    if (!audio) return false;
    try {
      if (audio.state !== 'running') await audio.resume();
      unlocked = audio.state === 'running';
    } catch {
      unlocked = false;
    }
    return unlocked;
  }

  // A buffer source through its own gain node; stopping it fades out instead of cutting
  function createVoice(buffer, gainName) {
    const source = context.createBufferSource();
    const gain = context.createGain();
    gain.gain.value = CUE_GAIN[gainName] ?? 1;
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(master);
    const fadeStop = () => {
      const now = context.currentTime;
      gain.gain.setValueAtTime(gain.gain.value, now);
      gain.gain.linearRampToValueAtTime(0, now + FADE_SECONDS);
      source.stop(now + FADE_SECONDS);
    };
    return { source, fadeStop };
  }

  function stop(name) {
    stopVersions.set(name, (stopVersions.get(name) || 0) + 1);
    pendingLoops.delete(name);
    pendingPriority.delete(name);
    const entry = active.get(name);
    if (!entry) return;
    active.delete(name);
    try { entry.stop(); } catch { /* A source can already have ended. */ }
  }

  function stopAll() {
    generation++;
    for (const callback of stopAllCallbacks) callback();
    pendingLoops.clear();
    pendingPriority.clear();
    for (const name of active.keys()) stop(name);
  }

  function setEnabled(value) {
    enabled = Boolean(value) && !destroyed;
    if (!enabled) stopAll();
  }

  function setVolume(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return;
    volume = Math.max(0, Math.min(1, number));
    if (master) master.gain.value = volume;
  }

  async function load(name) {
    if (!buffers.has(name)) {
      const file = FILES[name];
      const path = `${assetBase.replace(/\/$/, '')}/${file}`;
      const pending = (async () => {
        try {
          const response = await fetcher(path);
          if (!response.ok) return null;
          return await context.decodeAudioData(await response.arrayBuffer());
        } catch {
          return null;
        }
      })();
      buffers.set(name, pending);
    }
    return buffers.get(name);
  }

  async function startFrightened(loop) {
    const request = Symbol('frightened');
    const requestGeneration = generation;
    const stopVersion = stopVersions.get('frightened') || 0;
    if (loop) pendingLoops.set('frightened', request);
    const [firstLoopBuffer, loopBuffer] = await Promise.all([
      load('frightenedFirstLoop'),
      load('frightened')
    ]);
    if (loop && pendingLoops.get('frightened') === request) pendingLoops.delete('frightened');
    if (!loopBuffer || !enabled || destroyed || requestGeneration !== generation ||
      stopVersion !== (stopVersions.get('frightened') || 0) || context?.state !== 'running') return;

    try {
      let voice;
      const entry = { loop, stop: () => voice?.fadeStop() };
      active.set('frightened', entry);
      const playBuffer = (buffer, shouldLoop) => {
        if (active.get('frightened') !== entry) return;
        voice = createVoice(buffer, buffer === loopBuffer ? 'frightened' : 'frightenedFirstLoop');
        const { source } = voice;
        source.loop = shouldLoop;
        source.onended = () => {
          if (active.get('frightened') !== entry) return;
          if (shouldLoop) active.delete('frightened');
          else if (loop) playBuffer(loopBuffer, true);
          else active.delete('frightened');
        };
        source.start();
      };
      if (firstLoopBuffer) playBuffer(firstLoopBuffer, false);
      else playBuffer(loopBuffer, loop);
    } catch {
      active.delete('frightened');
    }
  }

  async function play(name, { loop = false } = {}) {
    if (!enabled || !unlocked || destroyed || context?.state !== 'running') return;
    if (name !== 'frightened' && !Object.hasOwn(FILES, name)) return;
    // Pellets eaten in a row keep the running chomp going: restarting it mid-wave clicks
    if (name === 'chomp' && !loop && active.has('chomp')) return;
    const cuePriority = PRIORITY[name] || 0;
    if ([...active.keys(), ...pendingPriority.keys()].some((activeName) =>
      (PRIORITY[activeName] || 0) > cuePriority)) return;
    if (loop && (active.has(name) || pendingLoops.has(name))) return;
    if (cuePriority) stopAll();
    if (name === 'frightened') {
      stop(name);
      await startFrightened(loop);
      return;
    }
    const requestGeneration = generation;
    const stopVersion = stopVersions.get(name) || 0;
    const request = Symbol(name);
    if (loop) pendingLoops.set(name, request);
    if (cuePriority) pendingPriority.set(name, request);
    const buffer = await load(name);
    if (loop && pendingLoops.get(name) === request) pendingLoops.delete(name);
    if (pendingPriority.get(name) === request) pendingPriority.delete(name);
    if (!buffer || !enabled || destroyed || requestGeneration !== generation ||
      stopVersion !== (stopVersions.get(name) || 0) || context.state !== 'running') return;
    if (loop && active.has(name)) return;
    stop(name);
    try {
      const { source, fadeStop } = createVoice(buffer, name);
      source.loop = loop;
      const entry = { loop, stop: fadeStop };
      active.set(name, entry);
      source.onended = () => {
        if (active.get(name) === entry) active.delete(name);
        onCueEnded({ name });
      };
      source.start();
      onCueStarted({ name, duration: buffer.duration });
    } catch {
      active.delete(name);
    }
  }

  async function destroy() {
    if (destroyed) return;
    destroyed = true;
    enabled = false;
    stopAll();
    buffers.clear();
    try { await context?.close(); } catch { /* Audio teardown must be safe. */ }
  }

  /** The context and output for sounds made outside the controller (the siren); null while silent. */
  function getAudioGraph() {
    if (!enabled || !unlocked || destroyed || context?.state !== 'running') return null;
    return { context, destination: master };
  }

  function onStopAll(callback) {
    stopAllCallbacks.push(callback);
  }

  return { unlock, setEnabled, setVolume, play, stop, stopAll, destroy, getAudioGraph, onStopAll };
}
