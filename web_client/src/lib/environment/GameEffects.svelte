<script>
  import { onDestroy } from 'svelte';
  import './GameEffects.css';

  export let events = [];
  export let gridSize;
  // READY! is shown for as long as the arcade sequence says (App.svelte)
  export let ready = false;
  // Scores of just-eaten ghosts, shown for as long as the ghost-eaten sequence says
  export let scores = [];

  let visibleEvents = [];
  let latestEventId = 0;
  const timers = new Set();
  const durations = {
    fruitEaten: 1100,
    gameOver: 3000,
    lifeLost: 900,
    lifeGained: 1500,
  };

  function enqueue(incoming) {
    for (const event of incoming) {
      if (event.id <= latestEventId) continue;
      latestEventId = event.id;
      const duration = durations[event.type];
      if (!duration) continue;

      visibleEvents = [...visibleEvents, event];
      const timer = setTimeout(() => {
        visibleEvents = visibleEvents.filter(({ id }) => id !== event.id);
        timers.delete(timer);
      }, duration);
      timers.add(timer);
    }
  }

  $: if (events?.length) enqueue(events);

  onDestroy(() => {
    for (const timer of timers) clearTimeout(timer);
  });
</script>

<div
  class="game-effects"
  style:--grid-size="{gridSize}px"
  aria-live="polite"
  aria-atomic="false"
>
  {#if ready}
    <div class="effect-banner ready-banner">READY!</div>
  {/if}
  {#each scores as score (score.ghostIndex)}
    <div
      class="effect-popup ghost-score"
      style:left="{gridSize * ((score.col ?? 13) + 0.5)}px"
      style:top="{gridSize * ((score.row ?? 14) + 0.5)}px"
    >{score.points ? `+${score.points}` : 'SCORE!'}</div>
  {/each}
  {#each visibleEvents as event (event.id)}
    {#if event.type === 'fruitEaten'}
      <div
        class="fruit-burst"
        style:left="{gridSize * (event.col + 0.5)}px"
        style:top="{gridSize * (event.row + 0.5)}px"
      >
        <span class="burst-ring" aria-hidden="true"></span>
      </div>
    {:else if event.type === 'gameOver'}
      <div class="effect-banner game-over-banner">GAME OVER</div>
    {:else if event.type === 'lifeLost'}
      <div class="death-impact" aria-hidden="true"></div>
    {:else if event.type === 'lifeGained'}
      <div class="effect-banner extra-life-banner">EXTRA LIFE</div>
    {/if}
  {/each}
</div>
