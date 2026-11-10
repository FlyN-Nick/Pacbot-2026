// What the comparison measures, per scenario. Event types are listed in the spec
// (docs: arcade timeline comparison design, "Events").
//
// Categories decide what counts as a target:
//   server        set by the game server's rules (used in competition); informational only
//   pause         holds the game; matches the arcade in arcade mode, must be zero in competition mode
//   presentation  sound and animation that never hold the game; matches the arcade in both modes

// Event-to-event durations. `after: type` matches only events at or after the first event of that type. Tolerance kinds are defined by toleranceFor() in compare.mjs.
export const GAPS = [
  { key: 'start.readyToGameStarted', category: 'pause', scenario: 'start', from: { type: 'readyShown' }, to: { type: 'gameStarted' }, tolerance: 'tick' },
  { key: 'start.musicLength', category: 'presentation', scenario: 'start', from: { type: 'musicStarted' }, to: { type: 'musicEnded' }, tolerance: 'audio' },
  { key: 'death.caughtToFirstFrame', category: 'pause', scenario: 'death', from: { type: 'pacmanCaught' }, to: { type: 'deathFrame', frame: 1 }, tolerance: 'animation' },
  { key: 'death.animationLength', category: 'presentation', scenario: 'death', from: { type: 'deathFrame', frame: 1 }, to: { type: 'deathEnded' }, tolerance: 'animation' },
  { key: 'death.endToReady', category: 'pause', scenario: 'death', from: { type: 'deathEnded' }, to: { type: 'readyShown', after: 'deathEnded' }, tolerance: 'tick' },
  { key: 'death.readyToResume', category: 'pause', scenario: 'death', from: { type: 'readyShown', after: 'deathEnded' }, to: { type: 'gameStarted', after: 'deathEnded' }, tolerance: 'tick' },
  { key: 'ghostEaten.toPopup', category: 'presentation', scenario: 'ghostEaten', from: { type: 'ghostEaten' }, to: { type: 'scorePopupShown' }, tolerance: 'animation' },
  // freezeEnded: the first movement after the eat (arcade), or when the GUI lets play continue
  { key: 'ghostEaten.freeze', category: 'pause', scenario: 'ghostEaten', from: { type: 'ghostEaten' }, to: { type: 'freezeEnded' }, tolerance: 'tick' },
  { key: 'ghostEaten.toFlash', category: 'server', scenario: 'ghostEaten', from: { type: 'frightStarted' }, to: { type: 'frightFlashStart', flash: 1 }, tolerance: 'tick' },
  { key: 'ghostEaten.frightLength', category: 'server', scenario: 'ghostEaten', from: { type: 'frightStarted' }, to: { type: 'frightEnded' }, tolerance: 'tick' },
  { key: 'levelComplete.toFirstFlash', category: 'pause', scenario: 'levelComplete', from: { type: 'levelCleared' }, to: { type: 'mazeFlash', flash: 1 }, tolerance: 'animation' },
  { key: 'levelComplete.toReady', category: 'pause', scenario: 'levelComplete', from: { type: 'levelCleared' }, to: { type: 'readyShown' }, tolerance: 'tick' },
];

// Values computed from event data rather than event times (see reduceTimeline).
// Eyes speed doesn't depend on how far the eyes travel, unlike the eyes sound's length.
export const DERIVED = [
  { key: 'ghostEaten.eyesSpeed', category: 'presentation', scenario: 'ghostEaten', tolerance: 'relative', unit: 'tiles/s' },
  { key: 'ghostEaten.eyesSoundPeriod', category: 'presentation', scenario: 'ghostEaten', tolerance: 'audio', unit: 's' },
];

// How many events of a type occur in a scenario.
export const COUNTS = [
  { key: 'death.frameCount', category: 'presentation', scenario: 'death', type: 'deathFrame' },
  { key: 'ghostEaten.flashCount', category: 'server', scenario: 'ghostEaten', type: 'frightFlashStart' },
  { key: 'levelComplete.flashCount', category: 'presentation', scenario: 'levelComplete', type: 'mazeFlash' },
];

// Each sirenStep event n (1-based) yields siren.step<n>.pelletsRemaining and siren.step<n>.loopPeriod.
// The movement-during-READY check (start.noMovementDuringReady) is a pause measurement.
export const SIREN = { scenario: 'siren', type: 'sirenStep', category: 'presentation' };

// Events the visualizer does not produce yet. Measurements that need one are
// reported as "not implemented"; remove a type here once the visualizer emits it.
export const GUI_NOT_IMPLEMENTED = new Set(['mazeFlash']);
