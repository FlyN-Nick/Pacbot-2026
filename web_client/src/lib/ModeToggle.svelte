<script>
  import { createEventDispatcher } from 'svelte';

  // 'arcade' (demo: holds the game like the arcade) or 'competition' (never holds it)
  export let mode = 'competition';

  const dispatch = createEventDispatcher();
  $: arcade = mode === 'arcade';
</script>

<button
  type="button"
  class="mode-toggle"
  aria-label={arcade ? 'Arcade mode' : 'Competition mode'}
  aria-pressed={arcade}
  title={arcade ? 'Arcade mode: READY and death pauses like the arcade. Click for competition mode.' : 'Competition mode: never pauses the game. Click for arcade mode.'}
  on:click={() => dispatch('change', arcade ? 'competition' : 'arcade')}
>{arcade ? 'ARCADE' : 'COMP'}</button>

<style>
  .mode-toggle {
    position: absolute;
    z-index: 2;
    left: 0;
    top: calc(13.25 * var(--grid-size));
    width: calc(2.5 * var(--grid-size));
    height: calc(1.5 * var(--grid-size));
    padding: 0;
    border: 0;
    border-radius: 4px;
    background: rgba(0,0,0,0.3);
    color: white;
    font: inherit;
    font-size: calc(0.45 * var(--grid-size));
    letter-spacing: 0.05em;
    cursor: pointer;
  }

  .mode-toggle[aria-pressed='true'] { color: #ffe528; }

  .mode-toggle:focus-visible {
    outline: 2px solid #ffd34e;
    outline-offset: 3px;
  }
</style>
