// What the comparison measures, per scenario. Event types are listed in the spec
// (docs: arcade timeline comparison design, "Events").

// Event-to-event durations. Tolerance kinds are defined by toleranceFor() in compare.mjs.
export const GAPS = [
  { key: 'start.readyToGameStarted', scenario: 'start', from: { type: 'readyShown' }, to: { type: 'gameStarted' }, tolerance: 'tick' },
  { key: 'start.musicLength', scenario: 'start', from: { type: 'musicStarted' }, to: { type: 'musicEnded' }, tolerance: 'audio' },
  { key: 'death.caughtToFirstFrame', scenario: 'death', from: { type: 'pacmanCaught' }, to: { type: 'deathFrame', frame: 1 }, tolerance: 'animation' },
  { key: 'death.animationLength', scenario: 'death', from: { type: 'deathFrame', frame: 1 }, to: { type: 'deathEnded' }, tolerance: 'animation' },
  { key: 'death.endToReady', scenario: 'death', from: { type: 'deathEnded' }, to: { type: 'readyShown' }, tolerance: 'tick' },
  { key: 'ghostEaten.toPopup', scenario: 'ghostEaten', from: { type: 'ghostEaten' }, to: { type: 'scorePopupShown' }, tolerance: 'animation' },
  { key: 'ghostEaten.freeze', scenario: 'ghostEaten', from: { type: 'ghostEaten' }, to: { type: 'actorMoved' }, tolerance: 'tick' },
  { key: 'ghostEaten.toFlash', scenario: 'ghostEaten', from: { type: 'frightStarted' }, to: { type: 'frightFlashStart', flash: 1 }, tolerance: 'tick' },
  { key: 'ghostEaten.frightLength', scenario: 'ghostEaten', from: { type: 'frightStarted' }, to: { type: 'frightEnded' }, tolerance: 'tick' },
  { key: 'ghostEaten.eyesSoundLength', scenario: 'ghostEaten', from: { type: 'eyesSoundStarted' }, to: { type: 'eyesSoundEnded' }, tolerance: 'audio' },
  { key: 'levelComplete.toFirstFlash', scenario: 'levelComplete', from: { type: 'levelCleared' }, to: { type: 'mazeFlash', flash: 1 }, tolerance: 'animation' },
  { key: 'levelComplete.toReady', scenario: 'levelComplete', from: { type: 'levelCleared' }, to: { type: 'readyShown' }, tolerance: 'tick' },
];

// How many events of a type occur in a scenario.
export const COUNTS = [
  { key: 'death.frameCount', scenario: 'death', type: 'deathFrame' },
  { key: 'ghostEaten.flashCount', scenario: 'ghostEaten', type: 'frightFlashStart' },
  { key: 'levelComplete.flashCount', scenario: 'levelComplete', type: 'mazeFlash' },
];

// Each sirenStep event n (1-based) yields siren.step<n>.pelletsRemaining and siren.step<n>.loopPeriod.
export const SIREN = { scenario: 'siren', type: 'sirenStep' };

// Events the visualizer does not produce yet. Measurements that need one are
// reported as "not implemented"; remove a type here once the visualizer emits it.
export const GUI_NOT_IMPLEMENTED = new Set(['sirenStep', 'mazeFlash', 'eyesSoundStarted', 'eyesSoundEnded']);
