const AUDIO_CUES = {
  pellet: 'chomp',
  powerPellet: 'frightened',
  ghostEaten: 'ghost',
  fruitEaten: 'fruit',
  lifeLost: 'death',
  lifeGained: 'extraLife',
  levelChanged: 'intermission',
  gameStarted: 'intro',
};

export function getEventActions(events) {
  return {
    audioCues: events.flatMap((event) => AUDIO_CUES[event.type]
      ? [{ name: AUDIO_CUES[event.type], event }] : []),
    visualEvents: events,
  };
}

export function enrichGhostEvents(events, frame, previous) {
  const eatenCount = events.filter(({ type }) => type === 'ghostEaten').length;
  const initialCombo = frame.ghostCombo - eatenCount;
  let offset = 0;
  return events.map((event) => {
    if (event.type !== 'ghostEaten') return event;
    const current = frame.ghosts[event.ghostIndex];
    const last = previous?.ghosts[event.ghostIndex];
    const visible = (position) => position && ((position.rowState | position.colState) & 0x20) === 0;
    const location = visible(last) ? last : visible(current) ? current : frame.pacman;
    const popup = { ...event, row: location.rowState & 0x1f, col: location.colState & 0x1f };
    // The server awards 200 << combo in color order, then increments combo.
    // Derive from the resulting counter, since a new power pellet resets it.
    if (Number.isInteger(initialCombo) && initialCombo >= 0) {
      popup.points = (200 * 2 ** (initialCombo + offset)) % 65536;
    }
    offset++;
    return popup;
  });
}

export function hasPacmanMoved(previous, frame) {
  if (!previous) return false;
  const before = previous.pacman;
  const current = frame.pacman;
  if (((before.rowState | before.colState | current.rowState | current.colState) & 0x20) !== 0) return false;
  return (before.rowState & 0x1f) !== (current.rowState & 0x1f)
    || (before.colState & 0x1f) !== (current.colState & 0x1f);
}

/** Bit 5 marks a hidden location; facing bits do not prove movement. */
export function getFrameActivity(frame, online, lastMovementTick = -Infinity, updatePeriod = 1) {
  const visible = ((frame.pacman.rowState | frame.pacman.colState) & 0x20) === 0;
  const active = online && visible && frame.lives > 0 && (frame.mode === 1 || frame.mode === 2);
  return {
    active,
    moving: active && frame.tick >= lastMovementTick && frame.tick - lastMovementTick <= Math.max(1, updatePeriod),
    frightened: active && frame.ghosts.some((ghost) =>
      (ghost.frightState & 0x7f) > 0 && (ghost.trappedState & 0x80) === 0),
  };
}

export function isGameReset(previous, frame) {
  // The server stops its tick counter at 0xffff; it only decreases on reset.
  return Boolean(previous && (frame.tick < previous.tick || frame.level < previous.level));
}
