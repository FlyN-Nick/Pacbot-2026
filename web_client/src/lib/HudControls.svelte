<script>
  import { createEventDispatcher } from 'svelte';
  import ArcadeButton from './sprites/ArcadeButton.svelte';
  export let gridSize;
  export let paused = true;
  export let audioEnabled = false;
  export let mode = 'competition';
  const dispatch = createEventDispatcher();
</script>

<div data-game-controls class="pocket left" role="group" aria-label="Game controls" style:--unit="{gridSize}px">
  <ArcadeButton {gridSize} text={paused ? 'START' : 'PAUSE'} label="Start / pause" on:click={() => dispatch('pause')} />
  <ArcadeButton {gridSize} text="RESET" label="Reset" on:click={() => dispatch('reset')} />
</div>
<div data-game-controls class="pocket right" role="group" aria-label="Sound and mode controls" style:--unit="{gridSize}px">
  <ArcadeButton {gridSize} text={audioEnabled ? 'MUTE' : 'SOUND'} label={audioEnabled ? 'Mute game audio' : 'Unmute game audio'} pressed={audioEnabled} color={audioEnabled ? 'yellow' : 'white'} on:click={() => dispatch('audio')} />
  <ArcadeButton {gridSize} text={mode === 'arcade' ? 'ARCADE' : 'COMP'} label={mode === 'arcade' ? 'Arcade mode' : 'Competition mode'} pressed={mode === 'arcade'} color={mode === 'arcade' ? 'yellow' : 'white'} on:click={() => dispatch('mode', mode === 'arcade' ? 'competition' : 'arcade')} />
</div>

<style>
  .pocket {
    position: absolute;
    top: calc(10 * var(--unit));
    width: calc(4.5 * var(--unit));
    display: flex;
    flex-direction: column;
    gap: calc(0.25 * var(--unit));
    z-index: 6;
  }
  .left { left: calc(0.25 * var(--unit)); }
  .right { right: calc(0.25 * var(--unit)); }
</style>
