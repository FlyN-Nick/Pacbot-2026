// One oscillator whose pitch sweeps in a repeating pattern, for the arcade's
// synthesized sounds (siren, retreating eyes). Does nothing while audio is unavailable.

const LOOKAHEAD_SECONDS = 2;
const REFRESH_MS = 1000;
const FADE_SECONDS = 0.015;

/**
 * shape 'riseFall': low → high over half a period, back to low over the other half.
 * shape 'fall': high → low over the whole period, then jump back to high.
 */
export function createSweepVoice({ getAudio, gain = 0.25, setRefresh = setInterval, clearRefresh = clearInterval }) {
  let sweep = { periodSeconds: 0.4, low: 400, high: 800, shape: 'riseFall' };
  let voice = null; // { context, oscillator, gainNode, refresh, scheduledUntil }

  function audio() {
    try { return getAudio(); } catch { return null; }
  }

  // Queue sweeps from `from` until LOOKAHEAD_SECONDS past now
  function schedule(from) {
    const { context, oscillator } = voice;
    const { periodSeconds, low, high, shape } = sweep;
    const frequency = oscillator.frequency;
    let t = from;
    while (t < context.currentTime + LOOKAHEAD_SECONDS) {
      if (shape === 'fall') {
        frequency.setValueAtTime(high, t);
        frequency.linearRampToValueAtTime(low, t + periodSeconds);
      } else {
        frequency.setValueAtTime(low, t);
        frequency.linearRampToValueAtTime(high, t + periodSeconds / 2);
        frequency.linearRampToValueAtTime(low, t + periodSeconds);
      }
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
      const gainNode = context.createGain();
      oscillator.type = 'triangle';
      gainNode.gain.value = gain;
      oscillator.connect(gainNode);
      gainNode.connect(destination);
      voice = { context, oscillator, gainNode, scheduledUntil: context.currentTime };
      schedule(context.currentTime);
      oscillator.start();
      voice.refresh = setRefresh(() => { if (voice) schedule(voice.scheduledUntil); }, REFRESH_MS);
    } catch {
      voice = null;
    }
  }

  function stop() {
    if (!voice) return;
    const { context, oscillator, gainNode, refresh } = voice;
    voice = null;
    clearRefresh(refresh);
    // Fade out rather than cut mid-wave, which clicks
    const at = context.currentTime + FADE_SECONDS;
    try {
      gainNode.gain.setValueAtTime?.(gainNode.gain.value, at - FADE_SECONDS);
      gainNode.gain.linearRampToValueAtTime?.(0, at);
      oscillator.stop(at);
    } catch { /* Already stopped. */ }
    oscillator.onended = () => {
      try { oscillator.disconnect(); gainNode.disconnect(); } catch { /* Already disconnected. */ }
    };
  }

  function setSweep(next) {
    sweep = { ...sweep, ...next };
    if (!voice) return;
    voice.oscillator.frequency.cancelScheduledValues(voice.context.currentTime);
    schedule(voice.context.currentTime);
  }

  return { start, stop, setSweep, get playing() { return voice !== null; } };
}
