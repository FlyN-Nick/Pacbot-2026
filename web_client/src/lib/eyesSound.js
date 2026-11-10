// The arcade's "retreating eyes" sound: a pitch that falls and jumps back up,
// once per period. Pitches are a lookalike; the period matches the arcade.
import { createSweepVoice } from './sweepVoice.js';

export function createEyesSound({ getAudio, periodMs, setRefresh, clearRefresh }) {
  const voice = createSweepVoice({ getAudio, gain: 0.2, setRefresh, clearRefresh });
  voice.setSweep({ periodSeconds: periodMs / 1000, low: 270, high: 1800, shape: 'fall' });
  return { start: voice.start, stop: voice.stop, get playing() { return voice.playing; } };
}
