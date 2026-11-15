// This inventory is independent of files returned by capture/replay runners.
// A check needs every checkpoint. all-observed additionally requires producer
// evidence that the whole cycle/transition interval was observed, including its
// boundaries; a single sample labeled "mouth-cycle" is insufficient.
// Categories are separate denominators: artwork/live/compositing cannot satisfy
// a full-screen check. Waiting has no equivalent MAME attract-screen reference.
const directions = ['right', 'left', 'up', 'down'];
const ghosts = ['red', 'pink', 'cyan', 'orange'];
const modes = ['arcade', 'competition'];
const point = (id, completeness = 'sample') => ({ id, completeness });
const allObserved = id => point(id, 'all-observed');
const ready = [point('ready-visible'), point('before-release'), point('first-movement'), allObserved('mouth-cycle')];
const death = [point('death-catch'), point('initial-hold'), allObserved('death-art-transitions'), point('blank'), point('next-life-ready'), point('first-movement')];
const check = (category, scenario, checkpoints, extra = {}) => ({
  id: [category, scenario, extra.mode, extra.display?.id].filter(Boolean).join(':'),
  scenario, category, checkpoints, ...extra,
});
const initial = [check('full-screen', 'ready-movement', ready), check('full-screen', 'death-respawn', death)];
for (const mode of modes) initial.push(
  check('live', 'waiting-pose', [point('waiting-visible'), allObserved('pose-continuity'), point('start-boundary')], { mode }),
  check('live', 'ready-movement', [...ready, point('intro-audio-start'), point('command-origin')], { mode }),
  check('live', 'death-respawn', [...death, point('death-audio-start'), point('captured-death-position'), point('command-origin')], { mode }),
);

const expanded = [];
for (const category of ['full-screen', 'artwork']) {
  for (const direction of directions) {
    expanded.push(check(category, `mouth-${direction}`, [0, 1, 2, 3].map(frame => point(`frame-${frame}`)).concat(allObserved('mouth-cycle'))));
    for (const ghost of ghosts) expanded.push(check(category, `ghost-${ghost}-${direction}`, [point('foot-0'), point('foot-1')], { ghost, direction }));
    expanded.push(check(category, `eyes-${direction}`, [point('eyes-visible')], { direction }));
  }
  expanded.push(check(category, 'fright-restoration', [point('blue-foot-0'), point('blue-foot-1'), point('white-foot-0'), point('white-foot-1'), point('normal-restored')]));
}
expanded.push(
  check('artwork', 'death-art', Array.from({ length: 13 }, (_, frame) => point(`frame-${frame}`))),
  check('artwork', 'ready-art', [point('ready-visible')]),
  check('full-screen', 'ghost-eaten', [point('score-popup'), point('eyes-start'), point('house-arrival'), point('normal-restored')]),
  check('full-screen', 'last-life-death', [point('death-catch'), allObserved('death-art-transitions'), point('blank'), point('game-over')]),
  check('full-screen', 'level-completion', [point('last-pellet'), point('initial-hold'), allObserved('maze-flashes'), point('next-level-ready'), point('first-movement')]),
);

// Representative HUD policy: zero, a repeated-fruit level (peach, level 4),
// history overflow beyond seven slots (8), and late repeated keys (21).
// These cases also span scores and remaining-life counts; they are not an
// exhaustive score/level cross product. Expectations need independent references.
const hudCases = [
  { name: 'zero', score: 0, highScore: 0, lives: 3, level: 1 },
  { name: 'repeated-fruit', score: 12340, highScore: 20000, lives: 1, level: 4 },
  { name: 'history-overflow', score: 999990, highScore: 999990, lives: 5, level: 8 },
  { name: 'late-keys', score: 123450, highScore: 999990, lives: 0, level: 21 },
];
for (const hud of hudCases) for (const category of ['full-screen', 'artwork']) expanded.push(check(category, `hud-${hud.name}`, [point('score'), point('high-score'), point('lives'), point('fruit-history')], { hud }));

for (const mode of modes) {
  for (const [scenario, ids] of [
    ['fright-restoration', ['blue', 'flashing', 'normal-restored']],
    ['ghost-eaten', ['score-popup', 'eyes-start', 'house-arrival', 'normal-restored']],
    ['last-life-death', ['death-catch', 'blank', 'game-over', 'no-sequence-resume']],
    ['level-completion', ['last-pellet', 'maze-flashes', 'next-level', 'continuation-policy']],
    ['bot-resume', ['hold-active', 'bot-command', 'hold-preserved', 'continuation-policy']],
    ['bot-reset', ['hold-active', 'bot-command', 'reset-observed', 'stale-callback-suppressed']],
    ['explicit-stop', ['sequence-active', 'stop-command', 'stopped', 'no-sequence-resume']],
    ['manual-reset', ['sequence-active', 'reset-command', 'reset-observed', 'stale-callback-suppressed']],
    ['reload-owned-hold', ['hold-active', 'reload', 'ownership-recovered', 'continuation-policy']],
    ['manual-pause', ['manual-pause-command', 'paused', 'no-automatic-resume']],
    ['real-bot-natural-life-loss', ['isolated-start', 'bot-connected', 'natural-life-loss', 'death-position-preserved', 'continuation-policy', 'cleanup']],
  ]) expanded.push(check('live', scenario, ids.map(id => ['maze-flashes', 'no-sequence-resume', 'no-automatic-resume'].includes(id) ? allObserved(id) : point(id)), { mode }));
  for (const phase of ['ready', 'death', 'level-clear']) expanded.push(check('live', `mode-change-${phase}`, [point('sequence-active'), point('mode-change'), point('pending-action-policy'), point('painted-continuation')], { mode, targetMode: mode === 'arcade' ? 'competition' : 'arcade' }));
}

const displays = [
  { id: 'native', width: 224, height: 288, deviceScaleFactor: 1 },
  { id: 'fractional', width: 291.2, height: 374.4, deviceScaleFactor: 1 },
  { id: 'retina', width: 224, height: 288, deviceScaleFactor: 2 },
];
for (const display of displays) expanded.push(
  check('compositing', 'sprite-boundaries', [point('directional-mouth'), point('ghost-feet'), point('death-art'), point('hud-glyphs')], { display }),
  check('compositing', 'colored-map-alpha', [point('transparent-background'), point('opaque-foreground'), point('colored-map-visible')], { display }),
  check('compositing', 'sprite-gutters', [point('no-neighbor-sampling')], { display }),
);

/** CheckDefinition = {id, scenario, category, checkpoints:[{id, completeness}],
 * mode?, targetMode?, display?, hud?, ghost?, direction?}. The full scope is a
 * fixed superset, even when producers, references or prerequisites are missing.
 * Return independent copies so a caller cannot shrink later denominators.
 */
export function requiredChecks(scope) {
  if (!['initial', 'full'].includes(scope)) throw Error(`Unknown coverage scope: ${scope}`);
  return structuredClone(scope === 'initial' ? initial : [...initial, ...expanded]);
}
