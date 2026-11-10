// Bookkeeping for eaten ghosts in arcade mode: which ghosts a freeze covers, and
// the eyes journeys home. Kept pure so App.svelte only applies the results.
import { planEyesPath, eyesPositionAt } from './ghostEyes.js';

/** Ghosts in a freeze that is already running, plus newly eaten ones (latest details win). */
export function mergeEatenGhosts(current, incoming) {
  const result = [...current];
  for (const ghost of incoming) {
    const i = result.findIndex(({ ghostIndex }) => ghostIndex === ghost.ghostIndex);
    if (i === -1) result.push(ghost);
    else result[i] = ghost;
  }
  return result;
}

/** Start an eyes journey for each ghost; each journey has its own id. */
export function addEyes(eyes, ghosts, nextId) {
  const added = ghosts.map(({ ghostIndex, row, col }, i) => ({
    id: nextId + i, ghostIndex, path: planEyesPath({ row, col }), elapsedMs: 0,
  }));
  return { eyes: [...eyes, ...added], nextId: nextId + added.length };
}

/**
 * Move every journey on by dtMs unless a freeze holds them. Returns the journeys
 * still travelling, their positions and directions, the ones that arrived, and the
 * ghosts to show again (those with no journey left).
 */
export function advanceEyes(eyes, dtMs, tilesPerSecond, frozen) {
  const moved = eyes.map((entry) => ({ ...entry, elapsedMs: entry.elapsedMs + (frozen ? 0 : dtMs) }));
  const arrived = [];
  const travelling = [];
  const positions = [];
  for (const entry of moved) {
    const at = eyesPositionAt(entry.path, entry.elapsedMs, tilesPerSecond);
    if (at.done) {
      arrived.push(entry);
      continue;
    }
    const i = Math.min(Math.floor(entry.elapsedMs / 1000 * tilesPerSecond), entry.path.length - 1);
    const next = entry.path[Math.min(i + 1, entry.path.length - 1)];
    travelling.push(entry);
    positions.push({ id: entry.id, ghostIndex: entry.ghostIndex, row: at.row, col: at.col,
      dirRow: Math.sign(next.row - entry.path[i].row), dirCol: Math.sign(next.col - entry.path[i].col) });
  }
  const unhide = [...new Set(arrived.map(({ ghostIndex }) => ghostIndex))]
    .filter((ghostIndex) => !travelling.some((entry) => entry.ghostIndex === ghostIndex));
  return { eyes: travelling, positions, arrived, unhide };
}
