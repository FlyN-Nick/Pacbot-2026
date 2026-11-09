// The arcade's background siren: it rises in pitch and speeds up as pellets run out.
// Synthesized with Web Audio; the pitches are a lookalike, the loop periods match the arcade.

/** Step n (1-based) starts when pellets remaining drop to `pellets`. */
export const SIREN_STEPS = Object.freeze([
  { pellets: 244, periodSeconds: 0.396, low: 380, high: 760 },
  { pellets: 123, periodSeconds: 0.363, low: 420, high: 840 },
  { pellets: 63, periodSeconds: 0.330, low: 460, high: 920 },
  // The arcade recording has no measurable period here; interpolated
  { pellets: 27, periodSeconds: 0.297, low: 500, high: 1000 },
  { pellets: 15, periodSeconds: 0.264, low: 540, high: 1080 },
]);

export function sirenStepFor(pelletsRemaining) {
  let step = 1;
  SIREN_STEPS.forEach(({ pellets }, i) => { if (pelletsRemaining <= pellets) step = i + 1; });
  return step;
}

export function sirenShouldPlay({ active, paused, frightened, eyes, dying, ready }) {
  return Boolean(active) && !paused && !frightened && !eyes && !dying && !ready;
}

const LOOKAHEAD_SECONDS = 2;
const REFRESH_MS = 1000;
const GAIN = 0.25;

/** getAudio() returns { context, destination } or null while audio is unavailable. */
export function createSiren({ getAudio, setRefresh = setInterval, clearRefresh = clearInterval }) {
  let step = 1;
  let voice = null; // { context, oscillator, gain, refresh, scheduledUntil }

  function audio() {
    try { return getAudio(); } catch { return null; }
  }

  // Queue sweeps from `from` until LOOKAHEAD_SECONDS past now
  function schedule(from) {
    const { context, oscillator } = voice;
    const { periodSeconds, low, high } = SIREN_STEPS[step - 1];
    const frequency = oscillator.frequency;
    let t = from;
    frequency.setValueAtTime(low, t);
    while (t < context.currentTime + LOOKAHEAD_SECONDS) {
      frequency.linearRampToValueAtTime(high, t + periodSeconds / 2);
      frequency.linearRampToValueAtTime(low, t + periodSeconds);
      t += periodSeconds;
    }
    voice.scheduledUntil = t;
  }

  function start() {
    if (voice) return;
    const graph = audio();
    if (!graph) return;
    try {
      const { context, destination } = graph;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'triangle';
      gain.gain.value = GAIN;
      oscillator.connect(gain);
      gain.connect(destination);
      voice = { context, oscillator, gain, scheduledUntil: context.currentTime };
      schedule(context.currentTime);
      oscillator.start();
      voice.refresh = setRefresh(() => { if (voice) schedule(voice.scheduledUntil); }, REFRESH_MS);
    } catch {
      voice = null;
    }
  }

  function stop() {
    if (!voice) return;
    const { oscillator, gain, refresh } = voice;
    voice = null;
    clearRefresh(refresh);
    try {
      oscillator.stop();
      oscillator.disconnect();
      gain.disconnect();
    } catch { /* Already stopped. */ }
  }

  function setStep(n) {
    if (n === step) return;
    step = n;
    if (!voice) return;
    voice.oscillator.frequency.cancelScheduledValues(voice.context.currentTime);
    schedule(voice.context.currentTime);
  }

  return {
    setStep,
    start,
    stop,
    get step() { return step; },
    get playing() { return voice !== null; },
  };
}
