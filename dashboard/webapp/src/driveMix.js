// Omniwheel mixing for manual driving. Vectors must match
// low_level/RPiPacBot/motor_config.json and MIX_* in drive.cpp.
const MIX_FWD    = [1,  0,  0, -1];
const MIX_RIGHT  = [0, -1, -1,  0];
const MIX_ROT_CW = [-1, -1, 1, -1];

// Held logical keys ('up','down','left','right','ccw','cw') -> body command,
// each axis in {-1, 0, 1}. Opposite keys cancel.
export function heldToCommand(held) {
  const axis = (pos, neg) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
  return {
    x: axis('right', 'left'),
    y: axis('up', 'down'),
    rot: axis('cw', 'ccw'),
  };
}

// Body command -> 4 signed motor speeds, scaled so the busiest motor runs at `speed`.
export function mixMotors({ x, y, rot }, speed) {
  const raw = MIX_FWD.map((_, i) => y * MIX_FWD[i] + x * MIX_RIGHT[i] + rot * MIX_ROT_CW[i]);
  const peak = Math.max(...raw.map(Math.abs));
  if (peak === 0) return [0, 0, 0, 0];
  return raw.map(v => Math.round(v / peak * speed) + 0);  // + 0 turns -0 into 0
}

// Translation -> label used by the top-down arrow, e.g. 'forward-left'.
export function directionLabel({ x, y }) {
  const fb = y > 0 ? 'forward' : y < 0 ? 'backward' : '';
  const lr = x > 0 ? 'right' : x < 0 ? 'left' : '';
  return [fb, lr].filter(Boolean).join('-') || null;
}
