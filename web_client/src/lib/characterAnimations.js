export function getGhostVisualState(trappedState, frightState, modTicks, updatePeriod) {
  const eaten = (trappedState & 0x80) !== 0;
  const frightSteps = frightState & 0x7f;
  const frightened = !eaten && frightSteps > 0;

  return {
    eaten,
    frightened,
    flashing: frightened && frightSteps <= 10 && modTicks * 2 >= updatePeriod,
    spriteTwo: ((modTicks >> 1) & 1) !== 0,
  };
}
