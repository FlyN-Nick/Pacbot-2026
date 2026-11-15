<script>
  import Sprite from "../sprites/Sprite.svelte";
  export let gridSize;
  export let fruits = {};

  const entries = [
    ['cherry', '🍒', 'Cherry'],
    ['strawberry', '🍓', 'Strawberry'],
    ['orange', '🍊', 'Orange'],
    ['apple', '🍎', 'Apple'],
    ['melon', '🍈', 'Melon'],
    ['galaxian', '👾', 'Galaxian'],
    ['bell', '🔔', 'Bell'],
    ['key', '🔑', 'Key'],
  ];
</script>

<div class="fruit-inventory" style:--grid-size="{gridSize}px" aria-label="Fruit collected">
  {#each entries as [type, icon, label]}
    {#if fruits[type]}
      <div class="fruit-entry" title={`${label}: ${fruits[type]}`} aria-label={`${label}: ${fruits[type]}`}>
        <Sprite frame={`fruit-${type}`} scale={gridSize/16}/><b>{fruits[type]}</b>
      </div>
    {/if}
  {/each}
</div>

<style>
  .fruit-inventory {
    position: absolute;
    left: calc(23 * var(--grid-size));
    top: calc(10 * var(--grid-size));
    width: calc(5 * var(--grid-size));
    min-height: calc(3 * var(--grid-size));
    padding: calc(0.2 * var(--grid-size));
    box-sizing: border-box;
    display: flex;
    flex-wrap: wrap;
    align-content: flex-start;
    gap: calc(0.12 * var(--grid-size));
    background: rgba(0, 0, 0, 0.3);
    color: white;
    font: calc(0.55 * var(--grid-size))/1 system-ui, sans-serif;
  }
  .fruit-entry {
    min-width: calc(1.05 * var(--grid-size));
    display: flex;
    align-items: center;
    justify-content: center;
    gap: calc(0.08 * var(--grid-size));
  }
  .fruit-entry b { font-size: calc(0.45 * var(--grid-size)); }
</style>
