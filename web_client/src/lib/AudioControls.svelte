<script>
  import { createEventDispatcher } from 'svelte';

  export let enabled = false;

  const dispatch = createEventDispatcher();
</script>

<div class="audio-controls" role="group" aria-label="Game audio controls">
  <button type="button" aria-label={enabled ? 'Mute game audio' : 'Unmute game audio'} aria-pressed={enabled} on:click={() => dispatch('toggle')}>
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 9v6h4l5 4V5L7 9H3z" />
      {#if enabled}
        <path class="wave" d="M15.5 8.5a5 5 0 0 1 0 7m2.8-9.8a9 9 0 0 1 0 12.6" />
      {:else}
        <path class="mute" d="m16 9 5 6m0-6-5 6" />
      {/if}
    </svg>
  </button>
</div>

<style>
  .audio-controls {
    display: flex;
    align-items: center;
    color: white;
    font: inherit;
  }

  button {
    width: calc(2.5 * var(--grid-size));
    height: calc(1.5 * var(--grid-size));
    display: grid;
    place-items: center;
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: rgba(0,0,0,0.3);
    color: inherit;
    cursor: pointer;
  }

  svg {
    width: calc(0.85 * var(--grid-size));
    height: calc(0.85 * var(--grid-size));
    fill: currentColor;
    stroke: currentColor;
    stroke-width: 1.8;
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  .wave, .mute { fill: none; }
  button[aria-pressed='true'] { color: #ffe528; }

  :global(.audio-controls) {
    position: absolute;
    z-index: 2;
    left: 0;
    top: calc(11.5 * var(--grid-size));
  }

  button:focus-visible {
    outline: 2px solid #ffd34e;
    outline-offset: 3px;
  }
</style>
