// The arcade's background siren: it rises in pitch and speeds up as pellets run out.
// Synthesized with Web Audio; the pitches are a lookalike, the loop periods match the arcade.
import { createSweepVoice } from './sweepVoice.js';

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

// A triangle wave at this gain matches the background loudness group (-20 dBFS RMS, audioController.js)
export const SIREN_GAIN = 0.173;

/** getAudio() returns { context, destination } or null while audio is unavailable. */
export function createSiren({ getAudio, setRefresh, clearRefresh }) {
  let step = 1;
  const voice = createSweepVoice({ getAudio, gain: SIREN_GAIN, setRefresh, clearRefresh });
  const sweepFor = (n) => {
    const { periodSeconds, low, high } = SIREN_STEPS[n - 1];
    return { periodSeconds, low, high, shape: 'riseFall' };
  };
  voice.setSweep(sweepFor(step));

  return {
    setStep(n) {
      if (n === step) return;
      step = n;
      voice.setSweep(sweepFor(step));
    },
    start: voice.start,
    stop: voice.stop,
    get step() { return step; },
    get playing() { return voice.playing; },
  };
}
