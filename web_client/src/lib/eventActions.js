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

/** Use packed direction bits for motion; bit 5 marks a hidden location. */
export function getFrameActivity(frame, online) {
  const visible = ((frame.pacman.rowState | frame.pacman.colState) & 0x20) === 0;
  const active = online && visible && frame.lives > 0 && (frame.mode === 1 || frame.mode === 2);
  return {
    active,
    moving: active && ((frame.pacman.rowState | frame.pacman.colState) & 0xc0) !== 0,
    frightened: active && frame.ghosts.some((ghost) =>
      (ghost.frightState & 0x7f) > 0 && (ghost.trappedState & 0x80) === 0),
  };
}

export function isGameReset(previous, frame) {
  // The server stops its tick counter at 0xffff; it only decreases on reset.
  return Boolean(previous && (frame.tick < previous.tick || frame.level < previous.level));
}
