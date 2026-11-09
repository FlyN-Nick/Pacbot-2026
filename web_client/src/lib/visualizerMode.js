// Arcade (demo) mode holds the game to match the arcade; competition mode never does.
import { writable } from 'svelte/store';

export const MODES = ['arcade', 'competition'];
export const STORAGE_KEY = 'pacbot.visualizerMode';
const DEFAULT_MODE = 'competition';

const valid = (mode) => MODES.includes(mode);

/** The ?mode= URL parameter, then the stored mode, then competition. */
export function resolveMode({ search, storage }) {
  const fromUrl = new URLSearchParams(search || '').get('mode');
  if (valid(fromUrl)) return fromUrl;
  try {
    const stored = storage?.getItem(STORAGE_KEY);
    if (valid(stored)) return stored;
  } catch { /* Storage can be blocked; fall through to the default. */ }
  return DEFAULT_MODE;
}

export function saveMode(mode, storage) {
  try {
    storage?.setItem(STORAGE_KEY, mode);
  } catch { /* Storage can be blocked; the mode still applies for this page. */ }
}

/** The current mode; App.svelte initialises it with resolveMode(). */
export const visualizerMode = writable(DEFAULT_MODE);
