<style>

  /* Ghost SVG Sprite */
  .ghost-svg {
    position: absolute;
    width:  calc(var(--grid-size) + 2 * var(--pad));
    height: calc(var(--grid-size) + 2 * var(--pad));
    transform-origin: top left;
  }

  .ghost-svg.returning {
    animation: return-home 650ms ease-in-out both;
    z-index: 4;
  }

  @keyframes return-home {
    from { transform: translate3d(var(--return-from-x), var(--return-from-y), 0) scale(1.5); }
    to { transform: translate3d(var(--return-to-x), var(--return-to-y), 0) scale(1.5); }
  }

  @media (prefers-reduced-motion: reduce) {
    .ghost-svg.returning { animation-duration: 1ms; }
  }

  /* Blinky */
  path.red { fill: red; }

  /* Pinky */
  path.pink { fill: hotpink; }

  /* Inky */
  path.cyan { fill: turquoise; }

  /* Clyde */
  path.orange { fill: orange; }

  /* Blue body - frightened */
  path.blue {fill: blue; }

  /* White mouth - frightened */
  path.white { fill: white; }

  /* Outlined body - frightened */
  path.outlined { stroke: var(--color); stroke-width: var(--pad); }

  /* Transparent - not frightened */
  path.transparent { fill: transparent; }

  /* Sclera (also iris when frightened) */
  ellipse.white {
    fill: white;
  }

  /* Transparent sclera */
  ellipse.transparent {
    fill: transparent;
  }

  /* White sclera outline (frightened) - unused */
  .s-white {
    stroke: white;
    stroke-width: calc(0.3 * var(--pad));
  }

  /* White sclera outline (frightened, recovering) - unused */
  .s-red {
    stroke: red;
    stroke-width: calc(0.3 * var(--pad));
  }

  /* Iris */
  ellipse.blue {
    fill: blue;
  }

  /* Iris (frightened, recovering) */
  ellipse.red {
    fill: red;
  }

</style>

<script>
  import { onDestroy } from 'svelte';
  import { getGhostVisualState } from '../characterAnimations.js';

  // Grid size, same as for other components
  export let gridSize;

  // Manually specified color for this ghost
  export let color;

  // Ghost state
  export let rowState;
  export let colState;
  export let frightState;
  export let trappedState = 0;
  export let returnEvent = null;
  export let spawning;

  let returning = false;
  let seenReturnEventId = null;
  let returnTimer;
  let returnFromRow = 13;
  let returnFromCol = 13;
  // The server respawns red at pink's location, then moves it out of the house.
  $: returnTarget = color === 'cyan' ? [14, 11] : color === 'orange' ? [14, 15] : [13, 13];
  $: if (returnEvent && returnEvent.id !== seenReturnEventId) {
    seenReturnEventId = returnEvent.id;
    returnFromRow = returnEvent.row;
    returnFromCol = returnEvent.col;
    returning = true;
    clearTimeout(returnTimer);
    returnTimer = setTimeout(() => returning = false, 650);
  }
  onDestroy(() => clearTimeout(returnTimer));

  // Timing info
  export let modTicks;
  export let updatePeriod;

  // Padding for frightened ghost sprite
  $: pad = gridSize/20

  // Control whether ghosts look like they are fluidly moving
  const showMotion = true;

  // Hide the ghost if bit 5 (32) of either coordinate is set
  $: showGhost = ((colState | rowState) & 0b100000) ? false : true

  /*
    The last 5 bits of each state byte are the position,
    while the first 2 bits of are the signed direction
  */

  // Using the & operator to pick out the 5 lowest bits
  $: posX = colState & 0b11111
  $: posY = rowState & 0b11111

  // The below code is a sign-extension trick, taking advantage of 32-bit
  // integer representations in JavaScript
  $: dirX = ((colState >> 6) << 30) >> 30
  $: dirY = ((rowState >> 6) << 30) >> 30

  // The top fright-state bit controls the exit offset while the ghost spawns.
  $: spawning = (frightState >> 7)
  /*
    Visual effects, to make the ghosts appear as if they are
    between squares when spawning
  */
  $: spawnExitSquare1 = (colState === 13) &&
                        (rowState === (13 | 0xc0) /* up */)
  $: spawnOffsetY = (spawning && (posY > 12)) ?
                      (spawnExitSquare1 ?
                        ((updatePeriod - modTicks) / (updatePeriod) / 2) : (1/2)
                      ) : 0
  $: spawnExitSquare2 = (posX === 13) && (posY === 11)
  $: spawnOffsetX = (spawning) ?
                      (spawnExitSquare2 ?
                        ((updatePeriod - modTicks) / (updatePeriod) / 2) : (1/2)
                      ) : 0

  // Keep state decoding independent of the SVG shapes.
  $: visual = getGhostVisualState(returning ? 0x80 : trappedState, frightState, modTicks, updatePeriod);
  $: returnPad = pad + 0.25 * (gridSize + 2 * pad);

</script>

<!-- SVG Sprite of Ghost -->
{#if showGhost || returning}
  {#key returning ? seenReturnEventId : 'server'}
  <svg
    class='ghost-svg'
    class:returning
    style:--grid-size='{~~gridSize+1}px'
    style:--color={color}
    style:--pad='{pad}px'
    style:--return-from-x='{returnFromCol * gridSize - returnPad}px'
    style:--return-from-y='{returnFromRow * gridSize - returnPad}px'
    style:--return-to-x='{returnTarget[1] * gridSize - returnPad}px'
    style:--return-to-y='{returnTarget[0] * gridSize - returnPad}px'
    style:top='0'
    style:left='0'
    style:transform='translate3d({(posX + showMotion*(dirX*modTicks/updatePeriod) + spawnOffsetX) *
                          gridSize - pad - 0.25 * (gridSize + 2 * pad)}px,
                          {(posY + showMotion*(dirY*modTicks/updatePeriod) + spawnOffsetY) *
                          gridSize - pad - 0.25 * (gridSize + 2 * pad)}px, 0) scale(1.5)'
  >

    <!-- Body of ghost -->
    {#if !visual.eaten && visual.spriteTwo}
      <path
        d=' M {pad} {pad + gridSize/2}
            A {gridSize/2} {gridSize/2} 0 0 1 {pad + gridSize} {gridSize/2}
            L {pad + gridSize} {pad + gridSize}
            L {pad + 0.72 * gridSize} {pad + 0.9 * gridSize}
            L {pad + 0.50 * gridSize} {pad +       gridSize}
            L {pad + 0.26 * gridSize} {pad + 0.9 * gridSize}
            L {pad + 0    * gridSize} {pad +       gridSize}
            z'
        class={visual.frightened ? (visual.flashing ? 'white outlined' : 'blue outlined') : color}
      />
    {:else if !visual.eaten}
      <path
        d=' M {pad} {pad + gridSize/2}
            A {gridSize/2} {gridSize/2} 0 0 1 {pad + gridSize} {gridSize/2}
            L {pad + gridSize} {pad + gridSize}
            L {pad + 0.82 * gridSize} {pad + 0.9 * gridSize}
            L {pad + 0.67 * gridSize} {pad +       gridSize}
            L {pad + 0.50 * gridSize} {pad + 0.9 * gridSize}
            L {pad + 0.33 * gridSize} {pad +       gridSize}
            L {pad + 0.18 * gridSize} {pad + 0.9 * gridSize}
            L {pad + 0    * gridSize} {pad +       gridSize}
            z'
        class={visual.frightened ? (visual.flashing ? 'white outlined' : 'blue outlined') : color}
      />
    {/if}

    <!-- Left eye -->
    <ellipse
      cx='{pad + (0.30 + 0.06*dirX) * gridSize}'
      cy='{pad + (0.40 + 0.09*dirY) * gridSize}'
      rx='{0.14 * gridSize}'
      ry='{0.20 * gridSize}'
      class={visual.frightened ? 'transparent' : 'white'}
    />

    <!-- Right eye -->
    <ellipse
      cx='{pad + (0.70 + 0.06*dirX) * gridSize}'
      cy='{pad + (0.40 + 0.09*dirY) * gridSize}'
      rx='{0.14 * gridSize}'
      ry='{0.20 * gridSize}'
      class={visual.frightened ? 'transparent' : 'white'}
    />

    <!-- Left iris -->
    <ellipse
      cx='{pad + (0.30 + 0.12*dirX) * gridSize}'
      cy='{pad + (0.40 + 0.18*dirY) * gridSize}'
      rx='{0.07 * gridSize}'
      ry='{0.10 * gridSize}'
      class={visual.frightened ? (visual.flashing ? 'red' : 'white') : 'blue'}
    />

    <!-- Right iris -->
    <ellipse
      cx='{pad + (0.70 + 0.12*dirX) * gridSize}'
      cy='{pad + (0.40 + 0.18*dirY) * gridSize}'
      rx='{0.07 * gridSize}'
      ry='{0.10 * gridSize}'
      class={visual.frightened ? (visual.flashing ? 'red' : 'white') : 'blue'}
    />

    <!-- Mouth (when frightened) -->
    {#if visual.frightened}
      <path
        d=' M {pad + (0.30 + 0.06*dirX) * gridSize} {pad + (dirY ? (0.38 + 0.38*dirY) : 0.72) * gridSize}
            L {pad + (0.70 + 0.06*dirX) * gridSize} {pad + (dirY ? (0.38 + 0.38*dirY) : 0.72) * gridSize}
            L {pad + (0.70 + 0.06*dirX) * gridSize} {pad + (dirY ? (0.42 + 0.38*dirY) : 0.76)  * gridSize}
            L {pad + (0.30 + 0.06*dirX) * gridSize} {pad + (dirY ? (0.42 + 0.38*dirY) : 0.76)  * gridSize}
            z'
        class={visual.flashing ? 'red' : 'white'}
      />
    {/if}

  </svg>
  {/key}
{/if}
