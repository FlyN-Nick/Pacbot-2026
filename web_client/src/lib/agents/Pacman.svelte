<script>
  import { onDestroy } from 'svelte';
  import { GUI_TIMINGS } from '../guiTimings.js';

  export let gridSize;
  export let pacmanRowState;
  export let pacmanColState;
  export let active = false;
  export let moving = false;
  export let deathEventId = null;
  export let startupEventId = null;

  let lastX = 13;
  let lastY = 23;
  let lastRotation = 0;
  let seenDeathEventId = null;
  let dying = false;
  let deathTimer;
  let startedEventId = null;
  let starting = false;
  let startupTimer;

  $: showPacman = ((pacmanRowState | pacmanColState) & 0x20) === 0;
  $: posX = pacmanColState & 0x1f;
  $: posY = pacmanRowState & 0x1f;
  $: dirX = ((pacmanColState >> 6) << 30) >> 30;
  $: dirY = ((pacmanRowState >> 6) << 30) >> 30;
  $: rotation = dirX === 1 && dirY === 0 ? 0
    : dirY === 1 && dirX === 0 ? 90
    : dirX === -1 && dirY === 0 ? 180
    : dirY === -1 && dirX === 0 ? 270
    : 0;

  $: if (showPacman && !dying) {
    lastX = posX;
    lastY = posY;
    lastRotation = rotation;
  }

  $: if (deathEventId != null && deathEventId !== seenDeathEventId) {
    seenDeathEventId = deathEventId;
    if (showPacman) {
      lastX = posX;
      lastY = posY;
      lastRotation = rotation;
    }
    clearTimeout(deathTimer);
    dying = true;
    deathTimer = setTimeout(() => {
      dying = false;
    }, GUI_TIMINGS.deathAnimationMs);
  }

  $: if (startupEventId != null && startupEventId !== startedEventId) {
    startedEventId = startupEventId;
    clearTimeout(startupTimer);
    starting = true;
    startupTimer = setTimeout(() => { starting = false; }, GUI_TIMINGS.readyHoldMs);
  }

  onDestroy(() => { clearTimeout(deathTimer); clearTimeout(startupTimer); });
</script>

{#if showPacman || dying}
  <div
    class="pacman-position"
    style:--grid-size="{gridSize}px"
    style:left="{gridSize * (dying ? lastX : posX)}px"
    style:top="{gridSize * (dying ? lastY : posY)}px"
  >
    {#key dying ? deathEventId : 'alive'}
      <div
        class="pacman"
        class:chomping={active && moving && !dying && !starting}
        class:dying
        style:--dir-angle="{dying ? lastRotation : rotation}deg"
        style:--death-ms="{GUI_TIMINGS.deathAnimationMs}ms"
        style:--death-steps={GUI_TIMINGS.deathFrames}
      />
    {/key}
  </div>
{/if}

<style>
  .pacman-position {
    position: absolute;
    width: var(--grid-size);
    height: var(--grid-size);
    pointer-events: none;
    z-index: 3;
  }

  .pacman {
    width: 100%;
    height: 100%;
    border-radius: 50%;
    background: #ffe528;
    clip-path: polygon(-100% -100%, -100% 200%, 200% 200%, 100% 80%, 45% 50%, 100% 20%, 200% -100%);
    transform: scale(1.5) rotate(var(--dir-angle));
  }

  .pacman.chomping {
    animation: chomp 230ms linear infinite alternate;
  }

  .pacman.dying {
    animation: death var(--death-ms) steps(var(--death-steps), end) forwards;
  }

  @media (prefers-reduced-motion: reduce) {
    .pacman.chomping { animation: none; }
    .pacman.dying { animation: reduced-death var(--death-ms) ease-in forwards; }
  }

  @keyframes reduced-death {
    0%, 28% { opacity: 1; }
    100% { opacity: 0; }
  }

  @keyframes chomp {
    to {
      clip-path: polygon(-100% -100%, -100% 200%, 200% 200%, 100% 52%, 45% 50%, 100% 48%, 200% -100%);
    }
  }

  @keyframes death {
    0% { clip-path: polygon(-100% -100%, -100% 200%, 200% 200%, 100% 80%, 45% 50%, 100% 20%, 200% -100%); transform: scale(1.5) rotate(var(--dir-angle)); opacity: 1; }
    45% { clip-path: polygon(-100% -100%, -100% 200%, 200% 200%, 100% 53%, 45% 50%, 100% 47%, 200% -100%); transform: scale(1.5) rotate(var(--dir-angle)); opacity: 1; }
    100% { clip-path: circle(0% at 50% 50%); transform: scale(1.5) rotate(var(--dir-angle)); opacity: 0; }
  }
</style>
