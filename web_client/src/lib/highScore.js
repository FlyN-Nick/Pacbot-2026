const KEY = 'pacbot.highScore';

function validScore(value) {
  if (typeof value === 'string') value = /^\d+$/.test(value) ? Number(value) : 0;
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function createHighScore({ target, onChange }) {
  let storage;
  try { storage = target.localStorage; } catch { /* Session-only if storage is blocked. */ }

  function savedScore() {
    try { return validScore(storage?.getItem(KEY)); } catch { return 0; }
  }

  let best = savedScore();
  onChange(best);

  function record(score) {
    const saved = savedScore();
    const next = Math.max(best, validScore(score), saved);
    if (next !== best) {
      best = next;
      onChange(best);
    }
    if (best > saved) {
      try { storage?.setItem(KEY, String(best)); } catch { /* Keep playing with the session record. */ }
    }
  }

  function receive(event) {
    if (event.key !== KEY || (event.storageArea && event.storageArea !== storage)) return;
    // Merge both the event and current storage: another tab may have written
    // again since this event was queued. Repair stale lower writes as well.
    record(event.newValue);
  }
  target.addEventListener('storage', receive);
  return { record, destroy: () => target.removeEventListener('storage', receive) };
}
