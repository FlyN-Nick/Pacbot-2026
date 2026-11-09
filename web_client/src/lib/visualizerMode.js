// Arcade (demo) mode holds the game to match the arcade; competition mode never does.
// The URL is the only source: ?mode=arcade means arcade mode, anything else is
// competition, so the address bar always shows which mode is on.
import { writable } from 'svelte/store';

export const MODES = ['arcade', 'competition'];

export function resolveMode(search) {
  return new URLSearchParams(search || '').get('mode') === 'arcade' ? 'arcade' : 'competition';
}

/** The URL search string for `mode`, keeping every other parameter. */
export function searchWithMode(search, mode) {
  const params = new URLSearchParams(search || '');
  if (mode === 'arcade') params.set('mode', 'arcade');
  else params.delete('mode');
  const result = params.toString();
  return result ? `?${result}` : '';
}

/** The current mode; App.svelte initialises it from the URL. */
export const visualizerMode = writable('competition');
