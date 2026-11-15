// The frame a level-complete freeze shows. The last frame before the clear still
// has the final pellet, with Pac-Man beside it; the arcade freezes him on it.
export function levelClearFrame(frame) {
  if (!frame?.pelletRows) return frame;
  let last = null;
  let count = 0;
  frame.pelletRows.forEach((bits, row) => {
    for (let col = 0; col < 32; col++) {
      if (((bits ?? 0) >>> col) & 1) {
        count++;
        last = { row, col };
      }
    }
  });
  if (count !== 1) return frame;
  const { rowState, colState } = frame.pacman;
  return {
    ...frame,
    pacman: { rowState: (rowState & 0xc0) | last.row, colState: (colState & 0xc0) | last.col },
  };
}
