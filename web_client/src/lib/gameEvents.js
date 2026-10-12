const EATEN_FLAG = 0x80;

function isVisible(position) {
  return position && position.rowState < 31 && position.colState < 28;
}

function isActiveMode(mode) {
  return mode === 1 || mode === 2;
}

function isPowerPellet(row, col) {
  return (row === 3 || row === 23) && (col === 1 || col === 26);
}

function snapshot(frame) {
  return {
    ...frame,
    pacman: { ...frame.pacman },
    ghosts: frame.ghosts.map((ghost) => ({ ...ghost })),
    fruit: { ...frame.fruit },
    pelletRows: [...frame.pelletRows],
  };
}

export function createGameEventTracker() {
  let previous = null;
  let nextId = 1;
  let gameStartedForSession = false;

  function reset() {
    previous = null;
    gameStartedForSession = false;
  }

  function update(frame) {
    if (!previous) {
      previous = snapshot(frame);
      gameStartedForSession = isActiveMode(frame.mode);
      return [];
    }

    // A level transition starts a new board; use that frame as the next baseline.
    if (frame.level !== previous.level) {
      previous = snapshot(frame);
      return [{ id: nextId++, type: 'levelChanged' }];
    }

    const events = [];
    const add = (event) => events.push({ id: nextId++, ...event });
    let knownScore = 0;
    let hasPowerPellet = false;

    for (let row = 0; row < Math.min(frame.pelletRows.length, previous.pelletRows.length); row += 1) {
      const removed = (previous.pelletRows[row] >>> 0) & ~(frame.pelletRows[row] >>> 0);
      for (let col = 0; col < 32; col += 1) {
        if ((removed & (1 << col)) === 0) continue;
        const powerPellet = isPowerPellet(row, col);
        knownScore += powerPellet ? 50 : 10;
        hasPowerPellet ||= powerPellet;
        add({
          type: powerPellet ? 'powerPellet' : 'pellet',
          row,
          col,
          points: powerPellet ? 50 : 10,
        });
      }
    }

    const eatenGhosts = [];
    frame.ghosts.forEach((ghost, ghostIndex) => {
      const wasEaten = (previous.ghosts[ghostIndex]?.trappedState & EATEN_FLAG) !== 0;
      const isEaten = (ghost.trappedState & EATEN_FLAG) !== 0;
      if (!wasEaten && isEaten) {
        eatenGhosts.push(ghostIndex);
        add({ type: 'ghostEaten', ghostIndex });
      }
    });

    // Power pellets reset the combo. The final combo records the awards after
    // that reset; otherwise awards start at the preceding frame's combo.
    const comboStart = hasPowerPellet
      ? Math.max(0, frame.ghostCombo - eatenGhosts.length)
      : previous.ghostCombo;
    eatenGhosts.forEach((_, index) => {
      const combo = comboStart + index;
      // The server shifts a uint16, discarding overflow from each award.
      knownScore += combo < 16 ? (200 * (2 ** combo)) & 0xffff : 0;
    });

    const wasFruitVisible = isVisible(previous.fruit);
    const fruitIsGone = !isVisible(frame.fruit);
    const scoreDelta = (frame.score - previous.score + 0x10000) % 0x10000;
    const residual = scoreDelta - knownScore;
    // Absolute moves can collect fruit along a route then finish elsewhere.
    // Account for other scoring rather than requiring the final fruit tile.
    // At the server's score cap, only a positive unexplained increment proves
    // pickup; when known scoring already reaches the cap it is ambiguous.
    const fruitScored = residual === 100
      || (frame.score === 0xffff && residual > 0 && residual < 100);
    if (wasFruitVisible && previous.fruit.steps > 0 && fruitIsGone && fruitScored) {
      add({ type: 'fruitEaten', row: previous.fruit.rowState, col: previous.fruit.colState });
    }

    if (frame.lives < previous.lives) {
      add({ type: 'lifeLost' });
      if (frame.lives === 0) add({ type: 'gameOver' });
    } else if (frame.lives > previous.lives) {
      add({ type: 'lifeGained' });
    }

    if (!gameStartedForSession && !isActiveMode(previous.mode) && isActiveMode(frame.mode)) {
      add({ type: 'gameStarted' });
      gameStartedForSession = true;
    }

    previous = snapshot(frame);
    return events;
  }

  return { update, reset };
}
