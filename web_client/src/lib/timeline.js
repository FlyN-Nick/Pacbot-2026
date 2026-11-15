/**
 * Opt-in event timeline for comparing the visualizer's timing with the arcade
 * (tools/arcade-timeline). Records logic timestamps, never painted frames.
 */

import { getGhostVisualState } from './characterAnimations.js';

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
    elapsed() {
      if(!enabled||!entries.length)return null;
      const base=anchorMs??Math.min(...entries.map(({ms})=>ms));
      return (now()-base)/1000;
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
export function deathFrameOffsetsMs({ deathAnimationMs, deathFrames, deathFrameOffsetsMs: measured }) {
  if(measured)return [...measured];
  return Array.from({ length: deathFrames }, (_, k) => k * deathAnimationMs / deathFrames);
}

const GHOST_NAMES = ['blinky', 'pinky', 'inky', 'clyde'];
const cell = ({ rowState, colState }) => `${rowState & 0x3f},${colState & 0x3f}`;

/** Turn successive game frames into actorMoved and fright timeline events. */
export function createFrameTimelineTracker() {
  let previous = null;
  let frightened = false;
  let flashing = false;
  let flashCount = 0;

  return {
    update(frame, updatePeriod) {
      const events = [];
      const modTicks = frame.tick % updatePeriod;
      const states = frame.ghosts.map(({ trappedState, frightState }) =>
        getGhostVisualState(trappedState, frightState, modTicks, updatePeriod));
      const nowFrightened = states.some((state) => state.frightened);
      const nowFlashing = states.some((state) => state.flashing);

      if (previous) {
        if (cell(frame.pacman) !== cell(previous.pacman)) {
          events.push({ type: 'actorMoved', data: { actor: 'pacman' } });
        }
        frame.ghosts.forEach((ghost, i) => {
          if (previous.ghosts[i] && cell(ghost) !== cell(previous.ghosts[i])) {
            events.push({ type: 'actorMoved', data: { actor: GHOST_NAMES[i] } });
          }
        });
        if (nowFrightened && !frightened) {
          flashCount = 0;
          events.push({ type: 'frightStarted', data: {} });
        }
        if (nowFlashing && !flashing) {
          events.push({ type: 'frightFlashStart', data: { flash: ++flashCount } });
        }
        if (!nowFrightened && frightened) events.push({ type: 'frightEnded', data: {} });
      }

      previous = frame;
      frightened = nowFrightened;
      flashing = nowFlashing;
      return events;
    },
  };
}

/** Opt-in live evidence. Unlike createTimeline, all timestamps are receipt/read
 * times. No future timestamps, selectors, fixtures or frame overrides are used.
 * raf is a browser callback counter, NOT a compositor frame identifier.
 */
export function createLiveObservation({enabled,now=()=>performance.now()}) {
 const rows=[],events=[];
 return {
  record(type,detail={}) { if(enabled)events.push(structuredClone({...detail,at:now(),type})); },
  observe(detail) { if(enabled)rows.push(structuredClone({...detail,id:`r${rows.length}`,at:now()})); },
  snapshot() { return structuredClone({rows,events}); },
  latest() { return structuredClone(rows.at(-1)??null); },
 };
}
