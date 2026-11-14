// The arcade's "retreating eyes" sound: a pitch that falls and jumps back up,
// once per period. Pitches are a lookalike; the period matches the arcade.
import { createSweepVoice } from './sweepVoice.js';

// A triangle wave at this gain matches the background loudness group (-20 dBFS RMS, audioController.js)
export const EYES_GAIN = 0.173;

export function createEyesSound({ getAudio, periodMs, setRefresh, clearRefresh }) {
  const voice = createSweepVoice({ getAudio, gain: EYES_GAIN, setRefresh, clearRefresh });
  voice.setSweep({ periodSeconds: periodMs / 1000, low: 270, high: 1800, shape: 'fall' });
  return { start: voice.start, stop: voice.stop, get playing() { return voice.playing; } };
}
