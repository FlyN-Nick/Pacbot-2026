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

function ghostAwardTotal(comboStart, count) {
  let total = 0;
  for (let index = 0; index < count; index += 1) {
    const combo = comboStart + index;
    // The server shifts a uint16, discarding overflow from each award.
    total += combo < 16 ? (200 * (2 ** combo)) & 0xffff : 0;
  }
  return total;
}

function possibleGhostScores(priorCombo, finalCombo, eatenCount, resetCount) {
  if (resetCount === 0) return [ghostAwardTotal(priorCombo, eatenCount)];
  if (finalCombo > eatenCount) return [];

  // The resulting combo counts awards after the last power pellet. Earlier
  // awards may precede the first reset or fall between subsequent resets.
  const totals = new Set();
  const afterLastReset = ghostAwardTotal(0, finalCombo);
  function distribute(remaining, resets, combo, score) {
    if (resets === 1) {
      totals.add(score + ghostAwardTotal(combo, remaining) + afterLastReset);
      return;
    }
    for (let count = 0; count <= remaining; count += 1) {
      distribute(remaining - count, resets - 1, 0, score + ghostAwardTotal(combo, count));
    }
  }
  distribute(eatenCount - finalCombo, resetCount, priorCombo, 0);
  return [...totals];
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
    let powerPelletCount = 0;

    for (let row = 0; row < Math.min(frame.pelletRows.length, previous.pelletRows.length); row += 1) {
      const removed = (previous.pelletRows[row] >>> 0) & ~(frame.pelletRows[row] >>> 0);
      for (let col = 0; col < 32; col += 1) {
        if ((removed & (1 << col)) === 0) continue;
        const powerPellet = isPowerPellet(row, col);
        knownScore += powerPellet ? 50 : 10;
        if (powerPellet) powerPelletCount += 1;
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

    const wasFruitVisible = isVisible(previous.fruit);
    const fruitIsGone = !isVisible(frame.fruit);
    // Absolute moves can collect fruit along a route then finish elsewhere.
    // Account for every possible reset chronology. At saturation or with
    // multiple resets, emit only if no valid chronology explains expiry.
    const ghostScores = possibleGhostScores(
      previous.ghostCombo, frame.ghostCombo, eatenGhosts.length, powerPelletCount,
    );
    const matchesScore = (increment) => frame.score === 0xffff
      ? Math.min(previous.score + increment, 0xffff) === frame.score
      : (previous.score + increment) % 0x10000 === frame.score;
    const fruitScored = ghostScores.some((points) => matchesScore(knownScore + points + 100))
      && !ghostScores.some((points) => matchesScore(knownScore + points));
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
