// Reduce timelines to named measurements and compare ours with the arcade reference.
import { GAPS, COUNTS, SIREN } from './gaps.mjs';

const ARCADE_FPS = 60.606;

/** Allowed difference for a measurement kind, in seconds (or events, for counts). */
export function toleranceFor(kind, gameFps) {
  switch (kind) {
    case 'animation': return 1 / ARCADE_FPS;
    case 'audio': return 0.05;
    case 'tick': return 1 / gameFps;
    case 'count': return 0;
    default: throw new Error(`unknown tolerance kind: ${kind}`);
  }
}

const matches = (event, { type, frame, flash }) =>
  event.type === type && (frame == null || event.frame === frame) && (flash == null || event.flash === flash);

function measureGap(events, { from, to }) {
  const start = events.find((event) => matches(event, from));
  if (!start) return undefined;
  const end = events.find((event) => event.t >= start.t && event !== start && matches(event, to));
  return end ? end.t - start.t : undefined;
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
export function compareTimelines({ reference, gui, gameFps }) {
  const ours = Object.assign({}, ...gui.map(reduceTimeline));
  const seen = new Set(gui.flatMap(({ events }) => events.map((event) => event.type)));

  // [key, tolerance kind, unit, event types that measure it]
  const measurements = [
    ...GAPS.map((gap) => [gap.key, gap.tolerance, 's', [gap.from.type, gap.to.type]]),
    ...COUNTS.map((count) => [count.key, 'count', 'count', [count.type]]),
  ];
  const sirenKeys = [...new Set([...Object.keys(reference), ...Object.keys(ours)])]
    .filter((key) => key.startsWith('siren.step')).sort();
  for (const key of sirenKeys) {
    const isCount = key.endsWith('.pelletsRemaining');
    measurements.push([key, isCount ? 'count' : 'audio', isCount ? 'count' : 's', [SIREN.type]]);
  }

  const rows = measurements.map(([key, kind, unit, types]) => {
    const arcade = reference[key]?.value;
    const measured = ours[key]?.value;
    const tolerance = toleranceFor(kind, gameFps);
    let status;
    if (arcade === undefined) status = 'no reference';
    else if (!types.some((type) => seen.has(type))) status = 'not implemented';
    else if (measured === undefined) status = 'did not complete';
    else status = Math.abs(measured - arcade) <= tolerance + 1e-9 ? 'pass' : 'fail';
    return { key, status, arcade, ours: measured, tolerance, unit };
  });

  const start = gui.find(({ scenario }) => scenario === 'start');
  if (start?.events.some((event) => event.type === 'readyShown')) {
    const moved = movementDuringReady(start);
    rows.push({ key: 'start.noMovementDuringReady', status: moved.length ? 'fail' : 'pass', moved, tolerance: 0, unit: 'count' });
  }
  return rows;
}

const formatValue = (value, unit) =>
  value === undefined ? '—' : unit === 'count' ? String(value) : `${value.toFixed(3)}s`;

/** Human-readable report, one line per row. */
export function formatReport(rows) {
  return rows.map((row) => {
    const status = row.status.toUpperCase();
    if (row.key === 'start.noMovementDuringReady') {
      const detail = row.moved.length ? `moved: ${row.moved.join(', ')}` : 'nothing moved';
      return `${row.key.padEnd(36)} ${detail}  ${status}`;
    }
    return `${row.key.padEnd(36)} arcade ${formatValue(row.arcade, row.unit).padEnd(7)}` +
      `  ours ${formatValue(row.ours, row.unit).padEnd(7)}` +
      `  tol ${formatValue(row.tolerance, row.unit)}  ${status}`;
  }).join('\n');
}
