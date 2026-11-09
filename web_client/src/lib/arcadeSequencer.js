// Plans the arcade's READY and death sequences as timed steps, and runs them.
// Competition mode never holds or resumes the server.

const SERVER_ACTIONS = new Set(['hold', 'resume']);

function startSteps(mode, timings) {
  const steps = [
    { atMs: 0, action: 'showReady' },
    { atMs: 0, action: 'cue', name: 'intro' },
    { atMs: timings.readyHoldMs, action: 'hideReady' },
  ];
  if (mode === 'arcade') steps.push({ atMs: timings.readyHoldMs, action: 'resume' });
  return steps;
}

function deathSteps(mode, timings, lastLife, serverPauses) {
  if (mode !== 'arcade') return [{ atMs: 0, action: 'deathStart' }];
  const animationAt = timings.deathFreezeMs;
  const steps = [
    // A real death pauses the server one update later, during the freeze. Holding
    // first would leave that pending pause to stop the game right after the resume,
    // so hold only for deaths the server won't pause for (the debug `k` command).
    ...(serverPauses ? [] : [{ atMs: 0, action: 'hold' }]),
    { atMs: 0, action: 'freezeDisplay' },
    { atMs: animationAt, action: 'releaseDisplay' },
    { atMs: animationAt, action: 'deathStart' },
  ];
  if (lastLife) return steps;
  const readyAt = animationAt + timings.deathAnimationMs + timings.deathEndToReadyMs;
  const resumeAt = readyAt + timings.deathReadyMs;
  steps.push(
    { atMs: readyAt, action: 'showReady' },
    { atMs: resumeAt, action: 'hideReady' },
    { atMs: resumeAt, action: 'resume' },
  );
  return steps;
}

/**
 * Steps for a sequence: kind is 'start', 'startDetected' (another client
 * resumed the server) or 'death'. Steps are ordered by atMs. serverPauses: the
 * server will pause itself for this death (Pac-Man was removed from the board).
 */
export function planSequence({ kind, mode, timings, lastLife = false, serverPauses = false }) {
  switch (kind) {
    case 'start': return startSteps(mode, timings);
    case 'startDetected': {
      const steps = startSteps(mode, timings);
      return mode === 'arcade' ? [{ atMs: 0, action: 'hold' }, ...steps] : steps;
    }
    case 'death': return deathSteps(mode, timings, lastLife, serverPauses);
    default: throw new Error(`unknown sequence: ${kind}`);
  }
}

/**
 * Runs one plan at a time. Steps due at the same time run together, in plan
 * order. Holds and resumes are skipped if the mode is competition when they come due.
 */
export function createSequenceRunner({ execute, getMode, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timers = [];
  let token = 0;

  function cancel() {
    token++;
    timers.forEach(clearTimer);
    timers = [];
  }

  function run(plan) {
    cancel();
    const runToken = token;
    const times = [...new Set(plan.map(({ atMs }) => atMs))];
    times.forEach((atMs, i) => {
      const timer = setTimer(() => {
        timers = timers.filter((t) => t !== timer);
        for (const step of plan.filter((s) => s.atMs === atMs)) {
          if (token !== runToken) return;
          if (SERVER_ACTIONS.has(step.action) && getMode() === 'competition') continue;
          execute(step);
        }
        if (i === times.length - 1 && token === runToken) timers = [];
      }, atMs);
      timers.push(timer);
    });
  }

  return {
    run,
    cancel,
    get running() { return timers.length > 0; },
  };
}
