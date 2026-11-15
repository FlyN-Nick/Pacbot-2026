<style>

  /* Maze image */
  .maze {

    /* Positioning */
    position: absolute;
    top: 0;
    left: 0;
    z-index: -1;

    /* Interaction */
    user-select: none;

    /* Grid-size related CSS */
    width:  calc(28 * var(--grid-size));
    height: calc(31 * var(--grid-size));
  }

  .maze.flashing { filter: brightness(0) invert(1); }
  .maze.blank { visibility: hidden; }
</style>

<script>
  export let gridSize;
  // Level complete: walls flash white, then go blank while the new board is drawn
  export let flashing = false;
  export let blank = false;
</script>

<img
  class='maze'
  src='maze.svg'
  alt='Pacman Maze'
  style:--grid-size='{gridSize}px'
  class:flashing
  class:blank
  draggable='false'
/>