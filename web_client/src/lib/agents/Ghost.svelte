<script>
  import Sprite from '../sprites/Sprite.svelte';
  import {selectGhostFrame,directionFor} from '../sprites/frames.js';
  import { onDestroy } from 'svelte';
  import { getGhostVisualState } from '../characterAnimations.js';

  // Grid size, same as for other components
  export let gridSize;
  export let phase=0;
  export let frameOverride=null;
  export let nativeState=null;

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

  // State decoding is shared with timing instrumentation.
  $: visual = getGhostVisualState(returning ? 0x80 : trappedState, frightState, modTicks, updatePeriod);

$: spriteFrame=nativeState ? selectGhostFrame({...nativeState,direction:nativeState.facing,phase:nativeState.footPhase}) : frameOverride??selectGhostFrame({color,direction:directionFor(dirX,dirY),phase:Math.floor(phase/132),...visual});
  $: x=(posX+showMotion*(dirX*modTicks/updatePeriod)+spawnOffsetX)*gridSize+gridSize/2;
  $: y=(posY+showMotion*(dirY*modTicks/updatePeriod)+spawnOffsetY)*gridSize+gridSize/2;
</script>
{#if nativeState ? nativeState.visible : showGhost || returning}
{#key returning ? seenReturnEventId : 'server'}
<div class="ghost" class:returning style:left="{nativeState ? nativeState.position.x*gridSize/8 : returning?returnFromCol*gridSize+gridSize/2:x}px" style:top="{nativeState ? nativeState.position.y*gridSize/8 : returning?returnFromRow*gridSize+gridSize/2:y}px" style:--dx="{(returnTarget[1]-returnFromCol)*gridSize}px" style:--dy="{(returnTarget[0]-returnFromRow)*gridSize}px">
<Sprite frame={spriteFrame} scale={gridSize/8}/>
</div>
{/key}
{/if}
<style>
.ghost{position:absolute;transform:translate(-50%,-50%);line-height:0;pointer-events:none;z-index:3}
.returning{animation:return-home 650ms linear both}
@keyframes return-home{from{transform:translate(-50%,-50%)}to{transform:translate(calc(-50% + var(--dx)),calc(-50% + var(--dy)))}}
@media(prefers-reduced-motion:reduce){.returning{animation-duration:1ms}}
</style>
