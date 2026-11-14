// Arcade (demo) mode holds the game to match the arcade; competition mode never does.
// The URL is the only source: ?mode=arcade means arcade mode, anything else
// (including no mode at all) is competition. The toggle writes the mode it
// switches to, so the address bar shows which mode is on.
import { writable } from 'svelte/store';

export const MODES = ['arcade', 'competition'];

export function resolveMode(search) {
  return new URLSearchParams(search || '').get('mode') === 'arcade' ? 'arcade' : 'competition';
}

/** The URL search string with ?mode=<mode>, keeping every other parameter. */
export function searchWithMode(search, mode) {
  const params = new URLSearchParams(search || '');
  params.set('mode', mode === 'arcade' ? 'arcade' : 'competition');
  return `?${params}`;
}

/** The current mode; App.svelte initialises it from the URL. */
export const visualizerMode = writable('competition');
