<script>
  import { onDestroy } from 'svelte';
  import './GameEffects.css';

  export let events = [];
  export let gridSize;

  let visibleEvents = [];
  let latestEventId = 0;
  const timers = new Set();
  const durations = {
    ghostEaten: 950,
    fruitEaten: 1100,
    gameStarted: 1250,
    gameOver: 3000,
    levelChanged: 1600,
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
  {#each visibleEvents as event (event.id)}
    {#if event.type === 'ghostEaten'}
      <div
        class="effect-popup ghost-score"
        style:left="{gridSize * ((event.col ?? 13) + 0.5)}px"
        style:top="{gridSize * ((event.row ?? 14) + 0.5)}px"
      >{event.points ? `+${event.points}` : 'SCORE!'}</div>
    {:else if event.type === 'fruitEaten'}
      <div
        class="fruit-burst"
        style:left="{gridSize * (event.col + 0.5)}px"
        style:top="{gridSize * (event.row + 0.5)}px"
      >
        <span class="burst-ring" aria-hidden="true"></span>
        <span class="effect-popup fruit-score">FRUIT!</span>
      </div>
    {:else if event.type === 'gameStarted'}
      <div class="effect-banner ready-banner">READY!</div>
    {:else if event.type === 'gameOver'}
      <div class="effect-banner game-over-banner">GAME OVER</div>
    {:else if event.type === 'levelChanged'}
      <div class="level-transition"><span class="effect-banner level-banner">LEVEL UP</span></div>
    {:else if event.type === 'lifeLost'}
      <div class="death-impact" aria-hidden="true"></div>
    {:else if event.type === 'lifeGained'}
      <div class="effect-banner extra-life-banner">EXTRA LIFE</div>
    {/if}
  {/each}
</div>
