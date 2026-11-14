<script>
  import ArcadeText from './ArcadeText.svelte';
  export let text;
  export let label;
  export let gridSize;
  export let pressed = undefined;
  export let color = 'white';
</script>

<button type="button" aria-label={label} aria-pressed={pressed} style:--unit="{gridSize}px" on:click>
  <ArcadeText {text} {color} scale={gridSize / 8 * 0.75} />
</button>

<style>
  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    height: calc(1.25 * var(--unit));
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    cursor: pointer;
    line-height: 0;
  }
  button:hover { background: #101030; }
  button:focus-visible { outline: 1px solid #2121ff; outline-offset: 1px; }
  button:active { transform: translateY(1px); }
</style>
