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
      return [];
    }

    // A level transition starts a new board; use that frame as the next baseline.
    if (frame.level !== previous.level) {
      previous = snapshot(frame);
      return [{ id: nextId++, type: 'levelChanged' }];
    }

    const events = [];
    const add = (event) => events.push({ id: nextId++, ...event });

    for (let row = 0; row < Math.min(frame.pelletRows.length, previous.pelletRows.length); row += 1) {
      const removed = (previous.pelletRows[row] >>> 0) & ~(frame.pelletRows[row] >>> 0);
      for (let col = 0; col < 32; col += 1) {
        if ((removed & (1 << col)) === 0) continue;
        const powerPellet = isPowerPellet(row, col);
        add({
          type: powerPellet ? 'powerPellet' : 'pellet',
          row,
          col,
          points: powerPellet ? 50 : 10,
        });
      }
    }

    frame.ghosts.forEach((ghost, ghostIndex) => {
      const wasEaten = (previous.ghosts[ghostIndex]?.trappedState & EATEN_FLAG) !== 0;
      const isEaten = (ghost.trappedState & EATEN_FLAG) !== 0;
      if (!wasEaten && isEaten) add({ type: 'ghostEaten', ghostIndex });
    });

    const wasFruitVisible = isVisible(previous.fruit);
    const fruitIsGone = !isVisible(frame.fruit);
    const scoreChanged = frame.score > previous.score;
    if (wasFruitVisible && previous.fruit.steps > 0 && frame.fruit.steps > 0 && fruitIsGone && scoreChanged) {
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
