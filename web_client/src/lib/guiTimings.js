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
  // Native MAME capture phases (first event is an initial hold).
  deathFrameOffsetsMs: Object.freeze([0,495,610.5,742.5,858,990,1105.5,1237.5,1353,1485,1600.5,1848]),
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
  // Level clear: everything frozen until the maze starts flashing (levelComplete.toFirstFlash)
  levelFlashStartMs: 1931,
  // Each flash is 12 frames white then 12 blue (levelComplete.flashPeriod / 2)
  levelFlashHalfMs: 198,
  // Number of white flashes (levelComplete.flashCount)
  levelFlashCount: 4,
  // Walls blank while the arcade draws the new board (MAME probe: frame 883, clear at 670)
  levelMazeBlankMs: 3515,
  // New board shown (MAME probe: frame 903)
  levelNewBoardMs: 3845,
  // READY! on the new board (levelComplete.toReady)
  levelReadyMs: 3927,
  // READY! after a level clear, before play resumes (levelComplete.readyToResume)
  levelReadyHoldMs: 1865,
});
