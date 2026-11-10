<script>
  import { onDestroy } from 'svelte';
  import Sprite from '../sprites/Sprite.svelte';
  import {resolvePacmanFrame,selectDeathFrame,directionFor} from '../sprites/frames.js';
  import { GUI_TIMINGS } from '../guiTimings.js';

  export let gridSize;
  export let phase=0;
  export let frameOverride=null;
  export let deathElapsedOverride=null;
  let aliveFrame=null;
  const motionPreference=window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion=motionPreference.matches;
  const updateMotion=()=>reducedMotion=motionPreference.matches;
  motionPreference.addEventListener("change",updateMotion);
  let deathStarted=0;
  let deathElapsed=0;
  const clock=setInterval(()=>{if(dying)deathElapsed=performance.now()-deathStarted;},16);
  $: aliveFrame=resolvePacmanFrame({previousFrame:aliveFrame,direction:directionFor(dirX,dirY),phase:reducedMotion?0:phase,active,moving,ready});
  $: selectedFrame=frameOverride??(dying||deathElapsedOverride!==null?(reducedMotion&&deathElapsedOverride===null?(deathElapsed>=2112?'blank':aliveFrame):selectDeathFrame(deathElapsedOverride??deathElapsed)):aliveFrame);
  export let pacmanRowState;
  export let pacmanColState;
  export let active = false;
  export let moving = false;
  export let deathEventId = null;
  export let deathPosition = null;
  // READY! is showing: Pac-Man waits without chomping
  export let ready = false;

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
    // The server may already have respawned Pac-Man while the arcade freeze
    // plays. Death belongs to the captured position, not the current packet.
    if (deathPosition) {
      lastX = deathPosition.colState & 0x1f;
      lastY = deathPosition.rowState & 0x1f;
    } else if (showPacman) {
      lastX = posX;
      lastY = posY;
      lastRotation = rotation;
    }
    clearTimeout(deathTimer);
    dying = true;
    deathStarted=performance.now();deathElapsed=0;
    deathTimer = setTimeout(() => {
      dying = false;
    }, GUI_TIMINGS.deathAnimationMs);
  }

  onDestroy(() => { clearTimeout(deathTimer);clearInterval(clock);motionPreference.removeEventListener("change",updateMotion); });
</script>

{#if showPacman || dying || deathElapsedOverride!==null}
  <div class="pacman-position" style:left="{gridSize*(dying?lastX:posX)+gridSize/2}px" style:top="{gridSize*(dying?lastY:posY)+gridSize/2}px">
    <Sprite frame={selectedFrame} scale={gridSize/8}/>
  </div>
{/if}
<style>.pacman-position{position:absolute;transform:translate(-50%,-50%);line-height:0;pointer-events:none;z-index:3}</style>
