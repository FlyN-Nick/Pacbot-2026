// Reduce timelines to named measurements and compare ours with the arcade reference.
import { GAPS, COUNTS, DERIVED, SIREN, GUI_NOT_IMPLEMENTED } from './gaps.mjs';

const ARCADE_FPS = 60.606;

// Competition mode shows no READY after a death, so these have nothing to measure.
const COMPETITION_NOT_APPLICABLE = new Set(['death.endToReady', 'death.readyToResume']);

/** Allowed difference for a measurement kind, in seconds (or events, for counts; or 5% of target, for relative). */
export function toleranceFor(kind, gameFps, target) {
  switch (kind) {
    case 'relative': return 0.05 * Math.abs(target ?? 0);
    case 'animation': return 1 / ARCADE_FPS;
    case 'audio': return 0.05;
    case 'tick': return 1 / gameFps;
    case 'count': return 0;
    default: throw new Error(`unknown tolerance kind: ${kind}`);
  }
}

// `after` limits a match to events at or after the first event of that type.
function matcher(events, { type, frame, flash, after }) {
  const since = after == null ? -Infinity : events.find((event) => event.type === after)?.t;
  return (event) => since !== undefined && event.t >= since && event.type === type &&
    (frame == null || event.frame === frame) && (flash == null || event.flash === flash);
}

function measureGap(events, { from, to }) {
  const start = events.find(matcher(events, from));
  if (!start) return undefined;
  const isEnd = matcher(events, to);
  const end = events.find((event) => event.t >= start.t && event !== start && isEnd(event));
  return end ? end.t - start.t : undefined;
}

// Tiles per second: the GUI reports each journey; the arcade marks its start and arrival.
function eyesSpeed(events) {
  const travelled = events.find((event) => event.type === 'eyesTravelled' && event.seconds > 0);
  if (travelled) return travelled.tiles / travelled.seconds;
  const started = events.find((event) => event.type === 'eyesStarted');
  const arrived = started && events.find((event) => event.type === 'eyesArrived' && event.t > started.t);
  return arrived ? arrived.tiles / (arrived.t - started.t) : undefined;
}

/** A timeline's measurements: { key: { value, unit } }. Missing events leave keys out. */
export function reduceTimeline({ scenario, events }) {
  const reduced = {};
  for (const gap of GAPS.filter((g) => g.scenario === scenario)) {
    const value = measureGap(events, gap);
    if (value !== undefined) reduced[gap.key] = { value, unit: 's' };
  }
  for (const count of COUNTS.filter((c) => c.scenario === scenario)) {
    const value = events.filter((event) => event.type === count.type).length;
    if (value > 0) reduced[count.key] = { value, unit: 'count' };
  }
  const derived = DERIVED.filter((d) => d.scenario === scenario);
  if (derived.length) {
    const speed = eyesSpeed(events);
    if (speed !== undefined) reduced['ghostEaten.eyesSpeed'] = { value: speed, unit: 'tiles/s' };
    const period = events.find((event) => event.type === 'eyesSoundEnded' && typeof event.periodSeconds === 'number');
    if (period) reduced['ghostEaten.eyesSoundPeriod'] = { value: period.periodSeconds, unit: 's' };
  }
  if (scenario === SIREN.scenario) {
    events.filter((event) => event.type === SIREN.type).forEach((step, i) => {
      reduced[`siren.step${i + 1}.pelletsRemaining`] = { value: step.pelletsRemaining, unit: 'count' };
      if (typeof step.periodSeconds === 'number') {
        reduced[`siren.step${i + 1}.loopPeriod`] = { value: step.periodSeconds, unit: 's' };
      }
    });
  }
  return reduced;
}

/**
 * Actors that moved before the game started. In the arcade nothing moves until
 * READY is over, so moves before READY appears count too.
 */
export function movementDuringReady({ events }) {
  const ready = events.find((event) => event.type === 'readyShown');
  if (!ready) return [];
  const started = events.find((event) => event.type === 'gameStarted' && event.t >= ready.t);
  const moved = events.filter((event) => event.type === 'actorMoved' &&
    (!started || event.t < started.t));
  return [...new Set(moved.map((event) => event.actor))];
}

/** One row per measurement: pass, fail, did not complete, not implemented, or no reference. */
export function compareTimelines({ reference, gui, gameFps, mode = 'arcade' }) {
  const ours = Object.assign({}, ...gui.map(reduceTimeline));

  // [key, tolerance kind, unit, event types that measure it]
  const measurements = [
    ...GAPS.map((gap) => [gap.key, gap.tolerance, 's', [gap.from.type, gap.to.type], gap.category]),
    ...COUNTS.map((count) => [count.key, 'count', 'count', [count.type], count.category]),
    ...DERIVED.map((d) => [d.key, d.tolerance, d.unit, [], d.category]),
  ];
  const sirenKeys = [...new Set([...Object.keys(reference), ...Object.keys(ours)])]
    .filter((key) => key.startsWith('siren.step')).sort();
  for (const key of sirenKeys) {
    const isCount = key.endsWith('.pelletsRemaining');
    measurements.push([key, isCount ? 'count' : 'audio', isCount ? 'count' : 's', [SIREN.type], SIREN.category]);
  }

  const rows = measurements.map(([key, kind, unit, types, category]) => {
    const arcade = reference[key]?.value;
    const measured = ours[key]?.value;
    // In competition mode the game is never held, so pauses must be zero
    const target = mode === 'competition' && category === 'pause' ? 0 : arcade;
    const tolerance = toleranceFor(kind, gameFps, target);
    let status;
    if (category === 'server') status = 'info';
    else if (mode === 'competition' && COMPETITION_NOT_APPLICABLE.has(key)) status = 'not applicable';
    else if (target === undefined) status = 'no reference';
    else if (types.some((type) => GUI_NOT_IMPLEMENTED.has(type))) status = 'not implemented';
    else if (measured === undefined) status = 'did not complete';
    else status = Math.abs(measured - target) <= tolerance + 1e-9 ? 'pass' : 'fail';
    return { key, category, status, arcade, target, ours: measured, tolerance, unit };
  });

  const start = gui.find(({ scenario }) => scenario === 'start');
  if (start?.events.some((event) => event.type === 'readyShown')) {
    const moved = movementDuringReady(start);
    const status = mode === 'competition' ? 'not applicable' : moved.length ? 'fail' : 'pass';
    rows.push({ key: 'start.noMovementDuringReady', category: 'pause', status, moved, tolerance: 0, unit: 'count' });
  }
  return rows;
}

/** A measured value with its unit, for reports. */
export const formatValue = (value, unit) =>
  value === undefined ? '—' : unit === 'count' ? String(value)
    : unit === 'tiles/s' ? `${value.toFixed(2)}t/s` : `${value.toFixed(3)}s`;

/** Human-readable report, one line per row. */
export function formatReport(rows) {
  return rows.map((row) => {
    const status = row.status === 'info' ? 'INFO (game rule)' : row.status.toUpperCase();
    if (row.key === 'start.noMovementDuringReady') {
      const detail = row.moved.length ? `moved: ${row.moved.join(', ')}` : 'nothing moved';
      return `${row.key.padEnd(36)} ${detail}  ${status}`;
    }
    const target = row.target !== undefined && row.target !== row.arcade ? `  target ${formatValue(row.target, row.unit)}` : '';
    return `${row.key.padEnd(36)} arcade ${formatValue(row.arcade, row.unit).padEnd(7)}${target}` +
      `  ours ${formatValue(row.ours, row.unit).padEnd(7)}` +
      `  tol ${formatValue(row.tolerance, row.unit)}  ${status}`;
  }).join('\n');
}
