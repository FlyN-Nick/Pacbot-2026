/**
 * Opt-in event timeline for comparing the visualizer's timing with the arcade
 * (tools/arcade-timeline). Records logic timestamps, never painted frames.
 */

/** Read ?timeline=1, plus the ws=<port> and bot=off overrides it enables. */
export function parseTimelineParams(search) {
  const params = new URLSearchParams(search);
  const enabled = params.get('timeline') === '1';
  if (!enabled) return { enabled: false, wsPort: null, botEnabled: true };

  const port = Number(params.get('ws'));
  const wsPort = Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
  return { enabled, wsPort, botEnabled: params.get('bot') !== 'off' };
}

/**
 * Events are stored in absolute milliseconds. events() reports seconds since
 * the first anchor after the last reset() (or since the earliest event).
 */
export function createTimeline({ enabled, now = () => performance.now() }) {
  let entries = [];
  let anchorMs = null;

  function add(type, data, atMs, isAnchor) {
    if (!enabled) return;
    const ms = atMs ?? now();
    if (isAnchor && anchorMs === null) anchorMs = ms;
    entries.push({ ms, type, data });
  }

  return {
    record(type, data = {}, { atMs } = {}) { add(type, data, atMs, false); },
    anchor(type, data = {}) { add(type, data, undefined, true); },
    reset() {
      entries = [];
      anchorMs = null;
    },
    events() {
      if (!enabled || entries.length === 0) return [];
      const base = anchorMs ?? Math.min(...entries.map(({ ms }) => ms));
      return [...entries]
        .sort((a, b) => a.ms - b.ms)
        .map(({ ms, type, data }) => ({ t: (ms - base) / 1000, type, ...data }));
    },
  };
}

/** Offset of each death-animation frame from the animation's start, in milliseconds. */
export function deathFrameOffsetsMs({ deathAnimationMs, deathFrames }) {
  return Array.from({ length: deathFrames }, (_, k) => k * deathAnimationMs / deathFrames);
}
