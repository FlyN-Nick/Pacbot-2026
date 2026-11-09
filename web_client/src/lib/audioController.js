const FILES = Object.freeze({
  intro: 'pacman_beginning.wav',
  chomp: 'pacman_chomp.wav',
  fruit: 'pacman_eatfruit.wav',
  ghost: 'pacman_eatghost.wav',
  extraLife: 'pacman_extrapac.wav',
  intermission: 'pacman_intermission.wav',
  death: 'pacman_death.wav',
  frightened: 'fright.wav',
  frightenedFirstLoop: 'fright_firstloop.wav'
});
const PRIORITY = { intro: 1, intermission: 2, death: 3 };

/** Browser audio stays silent until both enabled and unlocked by a user gesture. */
export function createAudioController({
  contextFactory = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  assetBase = '/audio',
  fetcher = (...args) => globalThis.fetch(...args),
  onCueStarted = () => {}
} = {}) {
  let context;
  let master;
  let enabled = false;
  let unlocked = false;
  let destroyed = false;
  let volume = 0.5;
  let lastChompTime = -Infinity;
  let generation = 0;
  const buffers = new Map();
  const active = new Map();
  const pendingLoops = new Map();
  const pendingPriority = new Map();
  const stopVersions = new Map();

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
      let source;
      const entry = { loop, stop: () => source?.stop() };
      active.set('frightened', entry);
      const playBuffer = (buffer, shouldLoop) => {
        if (active.get('frightened') !== entry) return;
        source = context.createBufferSource();
        source.buffer = buffer;
        source.loop = shouldLoop;
        source.connect(master);
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
    if (name === 'chomp' && !loop && context.currentTime - lastChompTime < 0.09) return;
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
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.loop = loop;
      source.connect(master);
      const entry = { loop, stop: () => source.stop() };
      active.set(name, entry);
      source.onended = () => {
        if (active.get(name) === entry) active.delete(name);
      };
      source.start();
      onCueStarted({ name, duration: buffer.duration });
      if (name === 'chomp' && !loop) lastChompTime = context.currentTime;
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

  return { unlock, setEnabled, setVolume, play, stop, stopAll, destroy };
}
