/**
 * Timing of the visualizer's arcade sequences, matched to the arcade reference
 * (tools/arcade-timeline/reference/arcade-timings.json) by fidelity.test.js.
 */
export const GUI_TIMINGS = Object.freeze({
  // READY! before play starts (start.readyToGameStarted)
  readyHoldMs: 4207,
  // Everything frozen after Pac-Man is caught, before the death animation (death.caughtToFirstFrame)
  deathFreezeMs: 990,
  // Length of Pac-Man's death animation (death.animationLength)
  deathAnimationMs: 2640,
  // Number of discrete steps in the death animation (death.frameCount)
  deathFrames: 12,
  // Blank maze between the end of the death animation and READY! (death.endToReady)
  deathEndToReadyMs: 132,
  // READY! after a death, before play resumes (death.readyToResume)
  deathReadyMs: 1898,
  // Everything frozen after a ghost is eaten, with its score shown (ghostEaten.freeze)
  ghostFreezeMs: 941,
  // How fast eaten ghosts' eyes travel home, in tiles per second (ghostEaten.eyesSpeed)
  eyesTilesPerSecond: 14.58,
  // Loop period of the retreating-eyes sound (ghostEaten.eyesSoundPeriod)
  eyesSoundPeriodMs: 264,
});
