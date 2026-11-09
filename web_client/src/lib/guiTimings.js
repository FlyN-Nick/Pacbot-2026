/** Timing of the visualizer's arcade sequences, checked against the arcade reference by fidelity tests. */
export const GUI_TIMINGS = Object.freeze({
  // How long gameplay is held while READY! shows (App.svelte) and Pac-Man's startup state lasts (Pacman.svelte)
  readyHoldMs: 1250,
  // How long gameplay is held after Pac-Man is caught (App.svelte)
  deathHoldMs: 1800,
  // Length of Pac-Man's death animation and dying state (Pacman.svelte)
  deathAnimationMs: 1800,
  // Number of discrete steps in the death animation (Pacman.svelte)
  deathFrames: 10,
});
