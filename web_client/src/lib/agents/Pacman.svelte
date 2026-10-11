<script>
  import { onDestroy } from 'svelte';

  export let gridSize;
  export let pacmanRowState;
  export let pacmanColState;
  export let active = false;
  export let moving = false;
  export let deathEventId = null;

  let lastX = 13;
  let lastY = 23;
  let lastRotation = 0;
  let seenDeathEventId = null;
  let dying = false;
  let deathTimer;

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
    }, 1300);
  }

  onDestroy(() => clearTimeout(deathTimer));
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
        class:chomping={active && moving && !dying}
        class:dying
        style:--dir-angle="{dying ? lastRotation : rotation}deg"
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
    filter: drop-shadow(0 0 calc(var(--grid-size) * 0.25) #ffe52888);
  }

  .pacman.chomping {
    animation: chomp 230ms linear infinite alternate;
  }

  .pacman.dying {
    animation: death 1300ms ease-in forwards;
  }

  @keyframes chomp {
    to {
      clip-path: polygon(-100% -100%, -100% 200%, 200% 200%, 100% 52%, 45% 50%, 100% 48%, 200% -100%);
    }
  }

  @keyframes death {
    0%, 28% { transform: scale(1.5) rotate(var(--dir-angle)); opacity: 1; }
    65% { transform: scale(1.15) rotate(calc(var(--dir-angle) + 180deg)); opacity: 1; }
    100% { transform: scale(0) rotate(calc(var(--dir-angle) + 360deg)); opacity: 0; }
  }
</style>
