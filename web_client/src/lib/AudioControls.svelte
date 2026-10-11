<script>
  import { createEventDispatcher } from 'svelte';

  export let controller;
  export let enabled = false;
  export let volume = 0.5;

  const dispatch = createEventDispatcher();

  async function toggleAudio() {
    const nextEnabled = !enabled;
    controller?.setEnabled(nextEnabled);
    if (nextEnabled && !(await controller?.unlock())) {
      controller?.setEnabled(false);
      enabled = false;
    } else {
      enabled = nextEnabled;
    }
    dispatch('enabled', enabled);
  }

  function changeVolume(event) {
    volume = Number(event.currentTarget.value) / 100;
    controller?.setVolume(volume);
    dispatch('volume', volume);
  }
</script>

<div class="audio-controls" role="group" aria-label="Game audio controls">
  <button type="button" aria-pressed={enabled} on:click={toggleAudio}>
    {enabled ? 'Sound on' : 'Sound off'}
  </button>
  <label for="game-audio-volume">Volume</label>
  <input
    id="game-audio-volume"
    type="range"
    min="0"
    max="100"
    step="1"
    value={Math.round(volume * 100)}
    on:input={changeVolume}
  />
</div>

<style>
  .audio-controls {
    display: flex;
    align-items: center;
    gap: 0.65rem;
    color: white;
    font: inherit;
  }

  button {
    padding: 0.35rem 0.65rem;
    border: 1px solid currentColor;
    border-radius: 0.3rem;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
  }

  button[aria-pressed='true'] {
    background: #ffd34e;
    color: #15121e;
  }

  button:focus-visible, input:focus-visible {
    outline: 2px solid #ffd34e;
    outline-offset: 3px;
  }

  input { accent-color: #ffd34e; }
</style>
