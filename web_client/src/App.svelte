<style>

  :root {
    font-family: Inter, system-ui, Avenir, Helvetica, Arial, sans-serif;

    color-scheme: light dark;
    color: rgba(255, 255, 255, 0.87);
    background-color: #242424;

    font-synthesis: none;
    text-rendering: optimizeLegibility;
    -webkit-font-smoothing: antialiased;
    -moz-osx-font-smoothing: grayscale;
    -webkit-text-size-adjust: 100%;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    border: 0;
  }

  .maze-space {

    /* Positioning */
    position: absolute;
    transform: translate(50%, 50%);
    bottom: calc(50% + 26px);
    right: 50%;
    width: calc(28 * var(--grid-size));
    height: calc(31 * var(--grid-size));
  }

  .audio-toolbar {
    display: contents;
  }

  :global(.path) {
      border: 1px solid cyan !important;
  }

</style>

<script>
  import { onDestroy } from 'svelte';
  import AudioControls from './lib/AudioControls.svelte';
  import GameEffects from './lib/environment/GameEffects.svelte';
  import { createGameEventTracker } from './lib/gameEvents.js';
  import { createAudioController } from './lib/audioController.js';
  import { GUI_TIMINGS } from './lib/guiTimings.js';
  import { parseTimelineParams, createTimeline, deathFrameOffsetsMs, createFrameTimelineTracker } from './lib/timeline.js';
  import { getEventActions, getFrameActivity, isGameReset, enrichGhostEvents, hasPacmanMoved } from './lib/eventActions.js';
  import ModeToggle from './lib/ModeToggle.svelte';
  import { WALLS } from './lib/maze.js';
  import { visualizerMode, resolveMode, searchWithMode } from './lib/visualizerMode.js';
  import { planSequence, createSequenceRunner } from './lib/arcadeSequencer.js';
  import { createSiren, sirenStepFor, sirenShouldPlay, SIREN_STEPS } from './lib/siren.js';
  import { createEyesSound } from './lib/eyesSound.js';
  import { soundForState } from './lib/ghostEyes.js';
  import { mergeEatenGhosts, addEyes, advanceEyes } from './lib/ghostEatenState.js';
  import Eyes from './lib/agents/Eyes.svelte';

  // Arcade (demo) mode only with ?mode=arcade in the URL; otherwise competition
  visualizerMode.set(resolveMode(window.location.search));

  const eventTracker = createGameEventTracker();

  // Timeline mode (?timeline=1) records event timings for tools/arcade-timeline
  const timelineParams = parseTimelineParams(window.location.search);
  const timeline = createTimeline({ enabled: timelineParams.enabled });
  const frameTimelineTracker = createFrameTimelineTracker();
  // Record when the start music really starts and stops (it can be cut short)
  const recordMusicStart = ({ name }) => { if (name === 'intro') timeline.record('musicStarted'); };
  const recordMusicEnd = ({ name }) => { if (name === 'intro') timeline.record('musicEnded'); };

  const audioController = createAudioController({
    assetBase: `${import.meta.env.BASE_URL}audio`,
    onCueStarted: recordMusicStart,
    onCueEnded: recordMusicEnd,
  });
  const fruitTypeForLevel = (level) => ['cherry', 'strawberry', 'orange', 'orange', 'apple', 'apple', 'melon', 'melon', 'galaxian', 'galaxian', 'bell', 'bell', 'key'][Math.min(Math.max(level, 1) - 1, 12)];
  let audioEnabled = false;
  let latestFrame = null;
  let visualEvents = [];
  let effectsRevision = 0;
  let deathEventId = null;
  let ghostReturnEvents = [];
  let pacmanActive = false;
  let pacmanMoving = false;
  let lastPacmanMovementTick = -Infinity;
  // Arcade sequence state (see executeStep)
  let readyVisible = false;
  let displayFrozen = false;
  let frozenFrame = null;
  let catchFrame = null;
  let ghostsHidden = false;
  let startRequested = false;
  let sessionStarted = false;
  let dying = false;
  let dyingTimer;
  let deathCount = 0;
  let lastSirenStep = null;
  let sirenStep = 1;
  // Ghost-eaten state: hidden actors and scores during the freeze, eyes travelling home
  let hiddenGhosts = new Set();
  let pacmanHidden = false;
  let scoresVisible = [];
  let eyes = []; // [{ id, ghostIndex, path, elapsedMs }]
  let nextEyesId = 1;
  let freezeGhosts = []; // ghosts covered by the running ghost-eaten plan
  let eyesPositions = [];
  let eyesAnimation = null;
  let eyesLastMs = 0;
  let eyesFlightUntil = 0; // competition mode: the quick flight home
  let eyesFlightTimer;
  let runningKind = null;
  // Level-complete state: walls white or blank, every actor hidden, pellets shown empty
  let mazeFlashing = false;
  let mazeBlank = false;
  let allActorsHidden = false;
  let levelFrozen = false;
  const siren = createSiren({ getAudio: () => audioController.getAudioGraph() });
  const eyesSound = createEyesSound({ getAudio: () => audioController.getAudioGraph(), periodMs: GUI_TIMINGS.eyesSoundPeriodMs });
  audioController.onStopAll(() => { siren.stop(); eyesSound.stop(); });
  const runner = createSequenceRunner({ execute: executeStep, getMode: () => $visualizerMode });
  let pickedFruits = {};

  function clearGameEffects() {
    eventTracker.reset();
    latestFrame = null;
    visualEvents = [];
    deathEventId = null;
    runner.cancel();
    clearSequenceDisplay();
    startRequested = false;
    sessionStarted = false;
    dying = false;
    clearTimeout(dyingTimer);
    lastSirenStep = null;
    pickedFruits = {};
    ghostReturnEvents = [];
    effectsRevision++;
    pacmanActive = false;
    pacmanMoving = false;
    lastPacmanMovementTick = -Infinity;
    audioController.stopAll();
  }

  // One background sound at a time: returning eyes, then fright, then the siren
  function updateBackgroundSound() {
    const frame = latestFrame;
    const activity = frame ? getFrameActivity(frame, socketOpen) : { active: false, frightened: false };
    const running = Boolean(frame) && activity.active && frame.mode !== Modes.Paused;
    const eyesActive = (eyes.length > 0 && !pacmanHidden) || performance.now() < eyesFlightUntil;
    const sirenAllowed = Boolean(frame) && sirenShouldPlay({
      active: activity.active, paused: frame.mode === Modes.Paused,
      frightened: false, eyes: false, dying, ready: readyVisible,
    });
    // The level-complete sequence is silent, as in the arcade
    const silent = levelFrozen || allActorsHidden;
    const sound = silent ? null : soundForState({ eyes: running && eyesActive, frightened: activity.frightened, sirenAllowed });
    if (sound === 'eyes') eyesSound.start(); else eyesSound.stop();
    // Repeated calls are safe; they also restart after a priority jingle ends.
    if (sound === 'frightened') audioController.play('frightened', { loop: true });
    else audioController.stop('frightened');
    if (sound === 'siren') {
      siren.setStep(sirenStep);
      siren.start();
    } else {
      siren.stop();
    }
  }

  async function toggleAudio() {
    if (audioEnabled) {
      audioController.setEnabled(false);
      audioEnabled = false;
      return;
    }
    audioController.setEnabled(true);
    if (await audioController.unlock()) {
      audioEnabled = true;
      updateBackgroundSound();
    } else {
      audioController.setEnabled(false);
      audioEnabled = false;
    }
  }

  function clearSequenceDisplay() {
    readyVisible = false;
    displayFrozen = false;
    frozenFrame = null;
    ghostsHidden = false;
    mazeFlashing = false;
    mazeBlank = false;
    allActorsHidden = false;
    levelFrozen = false;
    clearGhostEaten();
  }

  // Stop the ghost-eaten freeze display and every eyes journey
  function clearGhostEaten() {
    hiddenGhosts = new Set();
    pacmanHidden = false;
    scoresVisible = [];
    freezeGhosts = [];
    eyes = [];
    eyesPositions = [];
    if (eyesAnimation !== null) cancelAnimationFrame(eyesAnimation);
    eyesAnimation = null;
    eyesFlightUntil = 0;
    clearTimeout(eyesFlightTimer);
    eyesSound.stop();
  }

  function runSequence(kind, { lastLife = false, serverPauses = false, ghosts = [] } = {}) {
    runningKind = kind;
    runner.run(planSequence({ kind, mode: $visualizerMode, timings: GUI_TIMINGS, lastLife, serverPauses, ghosts }));
  }

  const currentKind = () => (runner.running ? runningKind : null);

  const eyesSoundEnded = () => timeline.record('eyesSoundEnded', { periodSeconds: GUI_TIMINGS.eyesSoundPeriodMs / 1000 });

  // Arcade mode: eyes follow the corridors home; the ghost reappears when they arrive
  function startEyes(ghosts) {
    if (eyes.length === 0) timeline.record('eyesSoundStarted');
    ({ eyes, nextId: nextEyesId } = addEyes(eyes, ghosts, nextEyesId));
    if (eyesAnimation === null) {
      eyesLastMs = performance.now();
      eyesAnimation = requestAnimationFrame(moveEyes);
    }
    updateBackgroundSound();
  }

  function moveEyes(now) {
    const dt = Math.max(0, now - eyesLastMs);
    eyesLastMs = now;
    // Travelling eyes wait while another ghost-eaten freeze holds everything
    const step = advanceEyes(eyes, dt, GUI_TIMINGS.eyesTilesPerSecond, pacmanHidden);
    eyes = step.eyes;
    eyesPositions = step.positions;
    for (const entry of step.arrived) {
      timeline.record('eyesTravelled', { tiles: entry.path.length - 1, seconds: entry.elapsedMs / 1000 });
    }
    if (step.unhide.length) {
      hiddenGhosts = new Set([...hiddenGhosts].filter((index) => !step.unhide.includes(index)));
    }
    if (eyes.length === 0) {
      eyesAnimation = null;
      eyesSoundEnded();
      updateBackgroundSound();
      return;
    }
    eyesAnimation = requestAnimationFrame(moveEyes);
  }

  // Competition mode: the quick flight home, with the eyes sound for as long
  function startEyesFlight() {
    if (performance.now() >= eyesFlightUntil) timeline.record('eyesSoundStarted');
    eyesFlightUntil = performance.now() + 650;
    clearTimeout(eyesFlightTimer);
    eyesFlightTimer = setTimeout(() => {
      eyesFlightUntil = 0;
      eyesSoundEnded();
      updateBackgroundSound();
    }, 650);
    updateBackgroundSound();
  }

  // Carry out one step of an arcade sequence (lib/arcadeSequencer.js)
  function executeStep(step) {
    switch (step.action) {
      case 'hold':
        sendToSocket('p');
        break;
      case 'resume':
        sendToSocket('P');
        timeline.record('gameStarted');
        break;
      case 'showReady':
        readyVisible = true;
        ghostsHidden = false;
        timeline.anchor('readyShown');
        // In competition mode play is already live while READY shows
        if ($visualizerMode === 'competition') timeline.record('gameStarted');
        break;
      case 'hideReady':
        readyVisible = false;
        break;
      case 'freezeDisplay':
        frozenFrame = catchFrame;
        displayFrozen = Boolean(frozenFrame);
        break;
      case 'releaseDisplay':
        displayFrozen = false;
        frozenFrame = null;
        levelFrozen = false;
        break;
      case 'deathStart':
        deathEventId = ++deathCount;
        dying = true;
        clearTimeout(dyingTimer);
        dyingTimer = setTimeout(() => { dying = false; }, GUI_TIMINGS.deathAnimationMs);
        if ($visualizerMode === 'arcade') ghostsHidden = true;
        audioController.play('death');
        recordDeathFrames();
        break;
      case 'cue':
        audioController.play(step.name);
        break;
      case 'hideActors':
        if (step.all) {
          allActorsHidden = true;
        } else {
          hiddenGhosts = new Set([...hiddenGhosts, ...step.ghostIndexes]);
          pacmanHidden = true;
        }
        break;
      case 'showActors':
        if (allActorsHidden) {
          allActorsHidden = false;
        } else {
          pacmanHidden = false;
          timeline.record('freezeEnded');
        }
        break;
      case 'levelFreeze':
        levelFrozen = true;
        updateBackgroundSound();
        break;
      case 'mazeFlash':
        mazeFlashing = step.white;
        if (step.flash) timeline.record('mazeFlash', { flash: step.flash });
        break;
      case 'mazeBlank':
        mazeBlank = step.blank;
        break;
      case 'showScore':
        scoresVisible = step.scores;
        timeline.record('scorePopupShown');
        break;
      case 'hideScore':
        scoresVisible = [];
        freezeGhosts = [];
        break;
      case 'startEyes':
        startEyes(step.ghosts);
        break;
    }
  }

  // Arcade mode starts a fresh game with READY! first, then resumes the server
  function canRequestStart() {
    return $visualizerMode === 'arcade' && socketOpen && gameMode === Modes.Paused &&
      !sessionStarted && !runner.running;
  }

  // A pause or resume from a person or the bot client; it always wins over a sequence
  function sendControl(control) {
    if (control === 'P' && canRequestStart()) {
      startRequested = true;
      runSequence('start');
      return;
    }
    runner.cancel();
    clearSequenceDisplay();
    sendToSocket(control);
  }

  function changeMode(mode) {
    // Show the mode in the address bar without adding a history entry
    const { pathname, search, hash } = window.location;
    window.history.replaceState(window.history.state, '', pathname + searchWithMode(search, mode) + hash);
    visualizerMode.set(mode);
    runner.cancel();
    clearSequenceDisplay();
  }

  const popcount = (n) => { let count = 0; for (let v = n >>> 0; v; v &= v - 1) count++; return count; };

  function updateSirenStep(frame, activity) {
    const pelletsRemaining = frame.pelletRows.reduce((sum, row) => sum + popcount(row ?? 0), 0);
    sirenStep = sirenStepFor(pelletsRemaining);
    if (activity.active && sirenStep !== lastSirenStep) {
      lastSirenStep = sirenStep;
      timeline.record('sirenStep', { pelletsRemaining, periodSeconds: SIREN_STEPS[sirenStep - 1].periodSeconds });
    }
  }

  function routeFrame(frame) {
    if (isGameReset(latestFrame, frame)) clearGameEffects();
    const currentActive = getFrameActivity(frame, socketOpen).active;
    if (!currentActive) lastPacmanMovementTick = -Infinity;
    else if (pacmanActive && hasPacmanMoved(latestFrame, frame)) lastPacmanMovementTick = frame.tick;
    const activity = getFrameActivity(frame, socketOpen, lastPacmanMovementTick, updatePeriod);
    pacmanActive = activity.active;
    pacmanMoving = activity.moving;

    // Strip direction bits while preserving the hidden-location marker.
    const position = ({ rowState, colState, ...state }) => ({
      ...state,
      rowState: rowState & 0x3f,
      colState: colState & 0x3f,
    });
    const events = enrichGhostEvents(eventTracker.update({
      ...frame,
      pacman: position(frame.pacman),
      ghosts: frame.ghosts.map(position),
      fruit: position(frame.fruit),
    }), frame, latestFrame);
    for (const event of events) {
      if (event.type === 'fruitEaten') {
        const type = fruitTypeForLevel(frame.level);
        pickedFruits[type] = (pickedFruits[type] || 0) + 1;
        pickedFruits = { ...pickedFruits };
      }
      if (event.type === 'gameStarted') {
        sessionStarted = true;
        // Started from elsewhere (another client); arcade mode holds it for READY
        if (!startRequested) runSequence($visualizerMode === 'arcade' ? 'startDetected' : 'start');
      }
      if (event.type === 'lifeLost') {
        timeline.anchor('pacmanCaught');
        clearGhostEaten();
        catchFrame = latestFrame;
        // A real death removes Pac-Man from the board and the server pauses itself
        const pacmanRemoved = ((frame.pacman.rowState | frame.pacman.colState) & 0x20) !== 0;
        runSequence('death', { lastLife: frame.lives === 0, serverPauses: pacmanRemoved });
      }
      if (event.type === 'gameOver') audioController.stopAll();
      if (event.type === 'levelChanged') {
        timeline.anchor('levelCleared');
        clearGhostEaten();
        catchFrame = latestFrame;
        runSequence('levelComplete');
      }
    }
    const eaten = events.filter(({ type }) => type === 'ghostEaten');
    if (eaten.length) {
      timeline.anchor('ghostEaten');
      const newlyEaten = eaten.map(({ ghostIndex, row, col, points }) => ({ ghostIndex, row, col, points }));
      // A ghost eaten during a running freeze joins it, so no ghost is left hidden
      const ghosts = currentKind() === 'ghostEaten' ? mergeEatenGhosts(freezeGhosts, newlyEaten) : newlyEaten;
      const arcade = $visualizerMode === 'arcade';
      // A start or death sequence isn't interrupted (the server is paused then anyway)
      if (['start', 'startDetected', 'death'].includes(currentKind())) {
        audioController.play('ghost');
      } else {
        freezeGhosts = ghosts;
        runSequence('ghostEaten', { ghosts });
      }
      if (!arcade) {
        // Competition mode never freezes the game
        timeline.record('freezeEnded');
        for (const event of eaten) ghostReturnEvents[event.ghostIndex] = event;
        startEyesFlight();
      }
    }
    for (const { type, data } of frameTimelineTracker.update(frame, updatePeriod)) {
      timeline.record(type, data);
    }
    ghostReturnEvents = ghostReturnEvents;
    latestFrame = frame;
    const actions = getEventActions(events);
    visualEvents = actions.visualEvents;
    for (const { name, event } of actions.audioCues) {
      // Frightened mode is driven by state, including pause and respawn.
      if (name !== 'frightened') audioController.play(name);
    }
    updateSirenStep(frame, activity);
    updateBackgroundSound();
  }

  // The death animation starts as the lifeLost event is routed
  function recordDeathFrames() {
    const startMs = performance.now();
    deathFrameOffsetsMs(GUI_TIMINGS).forEach((offsetMs, i) => {
      timeline.record('deathFrame', { frame: i + 1 }, { atMs: startMs + offsetMs });
    });
    timeline.record('deathEnded', {}, { atMs: startMs + GUI_TIMINGS.deathAnimationMs });
  }

  // Test-only access for tools/arcade-timeline
  if (timelineParams.enabled) {
    window.__arcadeTimeline = {
      events: () => timeline.events(),
      reset: () => timeline.reset(),
      frame: () => latestFrame && {
        pacman: { row: latestFrame.pacman.rowState & 0x1f, col: latestFrame.pacman.colState & 0x1f },
        ghosts: latestFrame.ghosts.map(({ rowState, colState }) => ({ row: rowState & 0x1f, col: colState & 0x1f })),
        pellets: [...latestFrame.pelletRows],
      },
    };
  }

  /* Config */
  import config from '../../config.json';

  /* Agents */
  import Ghost from './lib/agents/Ghost.svelte';
  import Pacman from './lib/agents/Pacman.svelte';

  /* Environment */
  import Fruit from './lib/environment/Fruit.svelte';
  import Maze from './lib/environment/Maze.svelte';
  import Pellets from './lib/environment/Pellets.svelte';

  /* Info Boxes */
  import Lives from './lib/info_boxes/Lives.svelte';
  import FruitInventory from './lib/info_boxes/FruitInventory.svelte';
  import Mps from './lib/info_boxes/Mps.svelte';
  import Score from './lib/info_boxes/Score.svelte';
  import Ticker from './lib/info_boxes/Ticker.svelte';
  import Reset from './lib/info_boxes/reset.svelte';

  // Creating a websocket client
  var socket = new WebSocket(`ws://${config.ServerIP}:${timelineParams.wsPort ?? config.WebSocketPort}`);
  var botSocket = timelineParams.botEnabled
    ? new WebSocket(`ws://${config.BotIP}:${config.BotSocketPort}`)
    : null;

  socket.binaryType = 'arraybuffer';
  let socketOpen = false;
  let botSocketOpen = false;

  // Maze dimensions (rows 0..MAZE_ROWS-1, columns 0..MAZE_COLS-1)
  const MAZE_ROWS = 31;
  const MAZE_COLS = 28;

  /*
    This generates an empty array of pellet states
    (0 = none, 1 = pellet, 2 = super)
  */
  let pelletGrid = [];
  let pelletRows = new Array(MAZE_ROWS).fill(null);
  for (let row = 0; row < MAZE_ROWS; row++) {
    pelletGrid[row] = [];
    for (let col = 0; col < MAZE_COLS; col++) {
      pelletGrid[row][col] = 0;
    }
  }

  /*
    This generates an array of intersection labels
  */
  const intersections = [
    0b0000_0000000000000000000000000000, // row 0
    0b0000_0100001000001001000001000010, // row 1
    0b0000_0000000000000000000000000000, // row 2
    0b0000_0000000000000000000000000000, // row 3
    0b0000_0000000000000000000000000000, // row 4
    0b0000_0100001001001001001001000010, // row 5
    0b0000_0000000000000000000000000000, // row 6
    0b0000_0000000000000000000000000000, // row 7
    0b0000_0100001001001001001001000010, // row 8
    0b0000_0000000000000000000000000000, // row 9
    0b0000_0000000000000000000000000000, // row 10
    0b0000_0000000001001001001000000000, // row 11
    0b0000_0000000000000000000000000000, // row 12
    0b0000_0000000000000000000000000000, // row 13
    0b0000_0000001001000000001001000000, // row 14
    0b0000_0000000000000000000000000000, // row 15
    0b0000_0000000000000000000000000000, // row 16
    0b0000_0000000001000010001000000000, // row 17
    0b0000_0000000000000000000000000000, // row 18
    0b0000_0000000000000000000000000000, // row 19
    0b0000_0100001001001001001001000010, // row 20
    0b0000_0000000000000000000000000000, // row 21
    0b0000_0000000000000000000000000000, // row 22
    0b0000_0101001001001001001001001010, // row 23
    0b0000_0000000000000000000000000000, // row 24
    0b0000_0000000000000000000000000000, // row 25
    0b0000_0101001001001001001001001010, // row 26
    0b0000_0000000000000000000000000000, // row 27
    0b0000_0000000000000000000000000000, // row 28
    0b0000_0100000000001001000000000010, // row 29
    0b0000_0000000000000000000000000000  // row 30
  ];

  let intersectionGrid = [];
  for (let row = 0; row < MAZE_ROWS; row++) {
    intersectionGrid[row] = [];
    for (let col = 0; col < MAZE_COLS; col++) {
      intersectionGrid[row][col] = ((intersections[row] >> col) & 1) ? 1 : 0;
    }
  }

  // The wall map (lib/maze.js)
  const walls = WALLS;

  /*
    We use a circular queue (with a fixed max capacity to keep track of the
    times of the most recent messages. For every message we receive, we should
    add this time to the queue and remove all times longer than 1ms ago. The
    length of this array will be the MPS (messages per second), which should
    be synced with the frame rate of the game engine if there is no lag.
  */
  const MPS_BUFFER_SIZE = 2 * config.GameFPS; // Allow double the specified FPS
  let mpsBuffer = new Array(MPS_BUFFER_SIZE);
  let mpsIdxLeft = 0;
  let mpsIdxRight = 1;
  let mpsAvg = 0;
  mpsBuffer[0] = Date.now();

  // Keep track of the number of ticks elapsed (from the server)
  let currTicks = 0;

  // Keep track of the ticks per update (from the server)
  let updatePeriod = 12;

  // Keep track of the game mode (from the server)
  let gameMode = 0;

  /*
    Keep track of the number of steps until the mode changes, as well as the
    mode duration (from the server)
  */
  let modeSteps = 0;
  let modeDuration = 255;

  /*
    Keep track of the number of steps until the fruit disappears, as well as
    the fruit duration (from the server)
  */
  let fruitSteps = 0;
  let fruitDuration = 30;

  // Local object to encode the possible modes
  const Modes = {
    Paused:   0,
    Scatter:  1,
    Chase:    2,
    Offline:  10,
  }

  // Keep track of the level steps (from the server)
  let levelSteps = 960;

  // Keep track of the current score (from the server)
  let currScore = 0;

  // Keep track of the current level (from the server)
  let currLevel = 0;

  // Keep track of the current lives (from the server)
  let currLives = 1;

  // Keep track of the ghost combo (from the server)
  let ghostCombo = 0;

  // Local object to encode the starting states
  const Directions = {
    Up:       0b11000000,
    Left:     0b11000000,
    Down:     0b01000000,
    Right:    0b01000000,
  }

  // Initial states for all the agents / objects
  let pacmanRowState = 23;
  let pacmanColState = 13 | Directions.Right;

  let fruitRowState = 32;
  let fruitColState = 32;

  let numActiveGhosts = config.NumActiveGhosts;

  let redRowState = 11;
  let redColState = 13 | Directions.Left; // left
  let redFrightState = 0 | 128;
  let redTrappedState = 0 | 128;

  let pinkRowState = 13 | Directions.Down; // down
  let pinkColState = 13;
  let pinkFrightState = 0 | 128;
  let pinkTrappedState = 0 | 128;

  let cyanRowState = 14 | Directions.Up; // up
  let cyanColState = 11;
  let cyanFrightState = 0 | 128;
  let cyanTrappedState = 0 | 128;

  let orangeRowState = 14 | Directions.Up; // up
  let orangeColState = 15;
  let orangeFrightState = 0 | 128;
  let orangeTrappedState = 0 | 128;

  // Handling a new connection
  socket.addEventListener('open', (_) => {
    console.log('WebSocket connection established');
    socketOpen = true;
    clearGameEffects();
  });

  // Handling a new connection between webClient and bot 
  botSocket?.addEventListener('open', (_) => {
    console.log('WebSocket connection established with Bot');
    botSocketOpen = true;
  });

  // Message events
  socket.addEventListener('message', (event) => {
    // Ignore partial frames before changing any rendering/event state.
    if (event.data instanceof ArrayBuffer && event.data.byteLength >= 159) {

      // Log the time
      const ts = Date.now();
      mpsBuffer[mpsIdxRight] = ts;
      mpsAvg++;
      mpsIdxRight = (mpsIdxRight + 1) % MPS_BUFFER_SIZE;
      // If the write head caught up to the tail (more than MPS_BUFFER_SIZE
      // messages in the window), drop the oldest entry so the indices and
      // count stay consistent instead of overwriting unevicted timestamps
      if (mpsIdxRight === mpsIdxLeft) {
        mpsIdxLeft = (mpsIdxLeft + 1) % MPS_BUFFER_SIZE;
        mpsAvg--;
      }
      // With a 2% leeway, calculate the number of messages in the window
      while (ts - mpsBuffer[mpsIdxLeft] > 1020 && mpsIdxLeft != mpsIdxRight) {
        mpsIdxLeft = (mpsIdxLeft + 1) % MPS_BUFFER_SIZE;
        mpsAvg--;
      }

      // Binary frame for manually parsing the input
      let view = new DataView(event.data);

      if (view) {

        // Keep track of the byte index we are reading
        let byteIdx = 0;

        // Get the current ticks from the server
        currTicks         = view.getUint16(byteIdx, false); byteIdx += 2;

        // Get the update period from the server
        updatePeriod      = view.getUint8(byteIdx++, false);

        // Get the game mode from the server
        gameMode          = view.getUint8(byteIdx++, false);

        // Get the mode steps and duration from the server
        modeSteps         = view.getUint8(byteIdx++, false);
        modeDuration      = view.getUint8(byteIdx++, false);

        // Get the level steps from the server
        levelSteps        = view.getUint16(byteIdx, false); byteIdx += 2;

        // Get the current score from the server
        currScore         = view.getUint16(byteIdx, false); byteIdx += 2;

        // Get the current level from the server
        currLevel         = view.getUint8(byteIdx++, false);

        // Get the current lives from the server
        currLives         = view.getUint8(byteIdx++, false);

        // Get the ghost combo from the server
        ghostCombo        = view.getUint8(byteIdx++, false);

        // Parse ghost data
        redRowState        = view.getUint8(byteIdx++, false);
        redColState        = view.getUint8(byteIdx++, false);
        redFrightState     = view.getUint8(byteIdx++, false);
        redTrappedState    = view.getUint8(byteIdx++, false);
        pinkRowState       = view.getUint8(byteIdx++, false);
        pinkColState       = view.getUint8(byteIdx++, false);
        pinkFrightState    = view.getUint8(byteIdx++, false);
        pinkTrappedState   = view.getUint8(byteIdx++, false);
        cyanRowState       = view.getUint8(byteIdx++, false);
        cyanColState       = view.getUint8(byteIdx++, false);
        cyanFrightState    = view.getUint8(byteIdx++, false);
        cyanTrappedState   = view.getUint8(byteIdx++, false);
        orangeRowState     = view.getUint8(byteIdx++, false);
        orangeColState     = view.getUint8(byteIdx++, false);
        orangeFrightState  = view.getUint8(byteIdx++, false);
        orangeTrappedState = view.getUint8(byteIdx++, false);

        // Parse Pacman data
        pacmanRowState    = view.getUint8(byteIdx++, false);
        pacmanColState    = view.getUint8(byteIdx++, false);

        // Parse fruit data
        fruitRowState     = view.getUint8(byteIdx++, false);
        fruitColState     = view.getUint8(byteIdx++, false);

        // Get the fruit steps and duration from the server
        fruitSteps        = view.getUint8(byteIdx++, false);
        fruitDuration     = view.getUint8(byteIdx++, false);

        // Parse pellet data
        let pelletsChanged = false;
        for (let row = 0; row < MAZE_ROWS; row++) {
          const binRow = view.getUint32(byteIdx, false);
          if (pelletRows[row] !== binRow) {
            pelletRows[row] = binRow;
            pelletsChanged = true;
            for (let col = 0; col < MAZE_COLS; col++) {

              // Super pellet condition
              let superPellet = ((row === 3) || (row === 23))
                                && ((col === 1) || (col === 26));

              // Update the pellet grid
              pelletGrid[row][col] = ((binRow >> col) & 1) ?
                                      (superPellet ? 2 : 1) : 0;
            }
          }
          byteIdx += 4;
        }

        // Pellet data usually remains unchanged between game frames. Only
        // invalidate the grid when a server row actually changes.
        if (pelletsChanged) {
          pelletGrid = pelletGrid;
        }
        routeFrame({
          tick: currTicks, mode: gameMode, lives: currLives,
          score: currScore, level: currLevel, ghostCombo,
          pacman: { rowState: pacmanRowState, colState: pacmanColState },
          ghosts: [
            { rowState: redRowState, colState: redColState, frightState: redFrightState, trappedState: redTrappedState },
            { rowState: pinkRowState, colState: pinkColState, frightState: pinkFrightState, trappedState: pinkTrappedState },
            { rowState: cyanRowState, colState: cyanColState, frightState: cyanFrightState, trappedState: cyanTrappedState },
            { rowState: orangeRowState, colState: orangeColState, frightState: orangeFrightState, trappedState: orangeTrappedState },
          ].slice(0, numActiveGhosts),
          fruit: { rowState: fruitRowState, colState: fruitColState, steps: fruitSteps },
          pelletRows: [...pelletRows],
        });
      }
    }
  });

  // Message events for bot-web client connection
  botSocket?.addEventListener('message', (event) => {
    if (typeof event.data == 'string') {
      let content = event.data.split(" "); 

      let command = content[0];
      switch (command) {
        case 'set_cell_color': {
          let row = content[1];
          let col = content[2];
          let newColor = content[3];
          
          const elem = document.getElementById(`grid-element-${row}-${col}`);
          elem.style.backgroundColor = newColor;
          break;
        }
        case 'set_cell_color_multiple': { // One color, multiple cells
          const newColor = content[content.length - 1];
          for (let i = 1; i < content.length - 1; i += 2) {
            let row = content[i];
            let col = content[i + 1];
            
            const elem = document.getElementById(`grid-element-${row}-${col}`);
            elem.style.backgroundColor = newColor;
          }
          break;
        }
        case 'set_cell_colors': { // Multiple colors, multiple cells
          for (let i = 1; i < content.length; i += 3) {
            let row = content[i];
            let col = content[i + 1];
            let newColor = content[i + 2];
            
            const elem = document.getElementById(`grid-element-${row}-${col}`);
            elem.style.backgroundColor = newColor;
          }
          break;
        }
        case 'reset_all_cell_colors': {
          const gridElements = document.getElementsByClassName('grid-element');
          for (let i = 0; i < gridElements.length; i++) {
            gridElements[i].style.backgroundColor = '';
          }
          break;
        }
        case 'set_path': {
          const currentPathCells = Array.from(document.getElementsByClassName('path'));
          currentPathCells.forEach((cell) => cell.classList.remove('path'));
          
          for (let i = 1; i < content.length; i += 2) {
            let row = content[i];
            let col = content[i + 1];
            
            const elem = document.getElementById(`grid-element-${row}-${col}`);
            elem.classList.add('path');
          }
          break;
        }
        case 'reset_game': {
          toggleReset();
          console.log('Bot client requested game reset');
          break;
        }
        case 'pause_game': {
          sendControl('p');
          console.log('Bot client requested game pause');
          break;
        }
        case 'resume_game': {
          sendControl('P');
          console.log('Bot client requested game resume');
          break;
        }
        default: {
          console.log('Unknown command received from robot: ' + command);
          break;
        }
      }
    }
  });

  // Event on close
  socket.addEventListener('close', (_) => {
    socketOpen = false;
    gameMode = Modes.Offline;
    clearGameEffects();
    console.log('WebSocket connection closed');
  });

  // Event on close for bot-web client connection
  botSocket?.addEventListener('close', (_) => {
    botSocketOpen = false;
    console.log('WebSocket connection with robot closed');
  });

  // Track the size of the window, to determine the grid size
  let innerWidth = 0;
  let innerHeight = 0;
  // On mobile, overflowing content can expand innerWidth beyond the viewport.
  $: gridSize = Math.max(0, Math.min(
    (Math.min(innerHeight, document.documentElement.clientHeight) - 64) / MAZE_ROWS,
    Math.min(innerWidth, document.documentElement.clientWidth) / MAZE_COLS,
  ))

  // A cleared board, shown while the level-complete sequence is frozen
  $: emptyPelletGrid = pelletGrid.map((row) => row.map(() => 0));

  // While a death is frozen, show everyone where Pac-Man was caught
  $: frozenPacman = displayFrozen ? frozenFrame?.pacman : null;
  $: frozenGhosts = displayFrozen ? frozenFrame?.ghosts : null;

  // Calculate the remainder when currTicks is divided by updatePeriod
  $: modTicks = currTicks % updatePeriod

  // Deal with media control-related (pause, play) keys
  let mediaControlKeyHeld = false;
  const mediaControlCommand = (key) => {

    /*
      If media control-related keys are pressed, reset the cooldown and
      send the command back to the keydown handler
    */
    if (key === 'p' && gameMode !== Modes.Paused) {
      mediaControlKeyHeld = true;
      return 'p';
    } else if (key === 'P' && gameMode === Modes.Paused) {
      mediaControlKeyHeld = true;
      return 'P';
    } else if (key === ' ' && !mediaControlKeyHeld) {
      mediaControlKeyHeld = true;
      return (gameMode === Modes.Paused ? 'P' : 'p');
    } else if (key === 'Escape') {
      return 'r';
    }
    return null;
  }

  // Whether a (row, col) coordinate is on the grid
  const inBounds = (row, col) =>
    row >= 0 && row < MAZE_ROWS && col >= 0 && col < MAZE_COLS;

  // Deal with motion-related keys
  let lastMotionTicks = 0;
  const motionCommand = (key) => {

    /*
      If not enough ticks (with a threshold of 1/4 of the update period)
      have elapsed since the last motion key, ignore this key
    */
    if ((4 * (currTicks - lastMotionTicks) < updatePeriod)) {
      // If the server tick counter wrapped (uint16) or reset (new game), the
      // delta goes negative and would otherwise wedge motion input until
      // lastMotionTicks is reached again; re-sync whenever that happens
      if (currTicks < lastMotionTicks) {
        lastMotionTicks = currTicks;
      }
      return null;
    }

    const checkViolation = (rowDir, colDir, steps) => {
      let newRow = (pacmanRowState & 31) + rowDir * steps;
      let newCol = (pacmanColState & 31) + colDir * steps;
      // Off-grid counts as a violation so the step search always terminates,
      // even if the maze border were ever incomplete
      if (!inBounds(newRow, newCol)) {
        return true;
      }
      if ((walls[newRow] >> (newCol)) & 1) {
        // console.log('wall violation', (pacmanRowState & 0b11111) - 1, (pacmanColState & 0b11111))
        return true;
      }
      return false;
    };

    const checkIntersection = (rowDir, colDir, steps) => {
      let newRow = (pacmanRowState & 31) + rowDir * steps;
      let newCol = (pacmanColState & 31) + colDir * steps;
      // Reject off-grid coordinates (no intersection there)
      if (!inBounds(newRow, newCol)) {
        return [32, 32];
      }
      if ((intersections[newRow] >> (newCol)) & 1) {
        // console.log('valid intersection found', (pacmanRowState & 0b11111) - 1, (pacmanColState & 0b11111))
        return [newRow, newCol];
      }
      return [32, 32];
    };

    /*
      If motion-related keys are pressed, reset the cooldown and
      send the command back to the keydown handler
    */
    let rowDir = 0;
    let colDir = 0;
    if (key === 'w' || key === 'ArrowUp') {
      lastMotionTicks = currTicks;
      rowDir = -1;
      colDir = 0;
      if (shiftKeyHeld) {
        for (let steps = 1; !checkViolation(rowDir, colDir, steps); steps++) {
          var [newRow, newCol] = checkIntersection(rowDir, colDir, steps);
          if (newRow < 32 && newCol < 32) {
            return 'x' + String.fromCharCode(newRow) + String.fromCharCode(newCol);
          }
        }
      }
      return 'w';
    } else if (key === 'a' || key === 'ArrowLeft') {
      lastMotionTicks = currTicks;
      rowDir = 0;
      colDir = -1;
      if (shiftKeyHeld) {
        for (let steps = 1; !checkViolation(rowDir, colDir, steps); steps++) {
          var [newRow, newCol] = checkIntersection(rowDir, colDir, steps);
          if (newRow < 32 && newCol < 32) {
            return 'x' + String.fromCharCode(newRow) + String.fromCharCode(newCol);
          }
        }
      }
      return 'a';
    } else if (key === 's' || key === 'ArrowDown') {
      lastMotionTicks = currTicks;
      rowDir = 1;
      colDir = 0;
      if (shiftKeyHeld) {
        for (let steps = 1; !checkViolation(rowDir, colDir, steps); steps++) {
          var [newRow, newCol] = checkIntersection(rowDir, colDir, steps);
          if (newRow < 32 && newCol < 32) {
            return 'x' + String.fromCharCode(newRow) + String.fromCharCode(newCol);
          }
        }
      }
      return 's';
    } else if (key === 'd' || key === 'ArrowRight') {
      lastMotionTicks = currTicks;
      rowDir = 0;
      colDir = 1;
      if (shiftKeyHeld) {
        for (let steps = 1; !checkViolation(rowDir, colDir, steps); steps++) {
          var [newRow, newCol] = checkIntersection(rowDir, colDir, steps);
          if (newRow < 32 && newCol < 32) {
            return 'x' + String.fromCharCode(newRow) + String.fromCharCode(newCol);
          }
        }
      }
      return 'd';
    }
    return null;
  }

  // Send message to websocket server (with error handling for closed sockets)
  const sendToSocket = (message) => {
    if (socketOpen) {
      socket.send(message);
    }
  }

  // Const toggle pause
  const togglePause = () => {

    sendControl(gameMode === Modes.Paused ? 'P' : 'p');
  }

  const toggleReset = () => {
    // A reset always wins over a running arcade sequence
    runner.cancel();
    clearSequenceDisplay();
    startRequested = false;
    sendToSocket('R');
  }

  // Showing intersections
  let showIntersections = false;

  // Shift key held
  let shiftKeyHeld = false;

  // Handle key presses, to send responses back to the server
  const handleKeyDown = (event) => {
    if (event.target?.closest?.('button, input, select, textarea, a, [contenteditable], [role="button"], [role="slider"]')) return;

    // Retrieve the key information
    const key = event.code === 'Space' ? ' ' : event.key;

    if (key.toLowerCase() === 'm') {
      event.preventDefault();
      toggleAudio();
      return;
    }

    // Space should control the game instead of scrolling the page.
    if (event.code === 'Space') {
      event.preventDefault();
    }

    // Check if it is a pause/play command
    const control = mediaControlCommand(key);
    if (control) {
      sendControl(control);
    }

    // Check if it is a motion command
    const motion = motionCommand(key);
    if (motion) {
      sendToSocket(motion);
    }

    else if (key === 'i') {
      console.log('toggling intersections')
      showIntersections = !showIntersections;
    } else if (key == 'Shift') {
      // console.log('holding shift');
      shiftKeyHeld = true;
    }
  }

  // Handle key releases, for allowing toggle commands to be sent again
  const handleKeyUp = (event) => {

    // Retrieve the key information
    const key = event.code === 'Space' ? ' ' : event.key;

    if (key === 'p' || key === 'P' || key === ' ') {
      mediaControlKeyHeld = false;
    } else if (key == 'Shift') {
      // console.log('releasing shift');
      shiftKeyHeld = false;
    }
  }

  onDestroy(() => {
    runner.cancel();
    clearTimeout(dyingTimer);
    clearGhostEaten();
    siren.stop();
    audioController.destroy();
    socket.close();
    botSocket?.close();
  });

</script>

<svelte:window
  on:keydown={handleKeyDown}
  on:keyup={handleKeyUp}
  bind:innerWidth
  bind:innerHeight
/>

<div class='maze-space' style:--grid-size="{gridSize}px">

  <Maze
    {gridSize}
    flashing={mazeFlashing}
    blank={mazeBlank}
  />

  <Pellets
    pelletGrid={levelFrozen ? emptyPelletGrid : pelletGrid}
    {gridSize}
    {botSocket}
    {intersectionGrid}
    {showIntersections}
  />

  <Fruit
    {gridSize}
    {fruitRowState}
    {fruitColState}
    {fruitSteps}
    {fruitDuration}
    currLevel={currLevel}
  />

  {#key effectsRevision}
  {#if !pacmanHidden && !allActorsHidden}
  <Pacman
    {gridSize}
    pacmanRowState={frozenPacman?.rowState ?? pacmanRowState}
    pacmanColState={frozenPacman?.colState ?? pacmanColState}
    active={pacmanActive}
    moving={pacmanMoving}
    {deathEventId}
    ready={readyVisible}
  />
  {/if}

  {#if !ghostsHidden && !allActorsHidden}
  {#if numActiveGhosts >= 1 && !hiddenGhosts.has(0)}
    <Ghost
      {gridSize}
      {modTicks}
      {updatePeriod}
      rowState={frozenGhosts?.[0]?.rowState ?? redRowState}
      colState={frozenGhosts?.[0]?.colState ?? redColState}
      frightState={redFrightState}
      trappedState={redTrappedState}
      returnEvent={ghostReturnEvents[0]}
      color='red'
    />
  {/if}

  {#if numActiveGhosts >= 2 && !hiddenGhosts.has(1)}
    <Ghost
      {gridSize}
      {modTicks}
      {updatePeriod}
      rowState={frozenGhosts?.[1]?.rowState ?? pinkRowState}
      colState={frozenGhosts?.[1]?.colState ?? pinkColState}
      frightState={pinkFrightState}
      trappedState={pinkTrappedState}
      returnEvent={ghostReturnEvents[1]}
      color='pink'
    />
  {/if}

  {#if numActiveGhosts >= 3 && !hiddenGhosts.has(2)}
    <Ghost
      {gridSize}
      {modTicks}
      {updatePeriod}
      rowState={frozenGhosts?.[2]?.rowState ?? cyanRowState}
      colState={frozenGhosts?.[2]?.colState ?? cyanColState}
      frightState={cyanFrightState}
      trappedState={cyanTrappedState}
      returnEvent={ghostReturnEvents[2]}
      color='cyan'
    />
  {/if}

  {#if numActiveGhosts >= 4 && !hiddenGhosts.has(3)}
    <Ghost
      {gridSize}
      {modTicks}
      {updatePeriod}
      rowState={frozenGhosts?.[3]?.rowState ?? orangeRowState}
      colState={frozenGhosts?.[3]?.colState ?? orangeColState}
      frightState={orangeFrightState}
      trappedState={orangeTrappedState}
      returnEvent={ghostReturnEvents[3]}
      color='orange'
    />
  {/if}
  {/if}

  {#each eyesPositions as eye (eye.id)}
    <Eyes {gridSize} row={eye.row} col={eye.col} dirRow={eye.dirRow} dirCol={eye.dirCol} />
  {/each}
  {/key}

  <FruitInventory {gridSize} fruits={pickedFruits} />

  <Mps {gridSize} {mpsAvg} />

  <Ticker
    {gridSize}
    {modTicks}
    {updatePeriod}
    {gameMode}
    {modeSteps}
    {modeDuration}
    {Modes}
    {togglePause}
  />

  <Reset
    {gridSize}
    {toggleReset}
  />

  <Score
    {gridSize}
    {currLevel}
    {currScore}
  />

  <Lives
    {gridSize}
    {currLives}
    {Directions}
  />

  {#key effectsRevision}
    <GameEffects events={visualEvents} {gridSize} ready={readyVisible} scores={scoresVisible} />
  {/key}

  <div class="audio-toolbar">
    <AudioControls
      enabled={audioEnabled}
      on:toggle={toggleAudio}
    />
    <ModeToggle
      mode={$visualizerMode}
      on:change={(event) => changeMode(event.detail)}
    />
  </div>
</div>
