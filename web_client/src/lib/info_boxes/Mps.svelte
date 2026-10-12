<!-- MPS = Messages Per Second -->

<style>

  /* Control of header margins */
  h2 {
    margin: 0;
  }

  /* Information box for MPS Counter */
  .mps-counter {

    /* Positioning */
    position: absolute;
    text-align: center;

    /* Formatting */
    background-color: rgba(0,0,0,0.3);

    /* Grid-size related CSS */
    width:       calc(2.5 * var(--grid-size));
    height:      calc(1.5 * var(--grid-size));
    line-height: calc(1.5 * var(--grid-size));
    left:        calc(2.5 * var(--grid-size));
    top:         calc(11.5 * var(--grid-size));
    font-size:   calc(0.55 * var(--grid-size));
  }

</style>

<script>
  export let gridSize;
  export let mpsAvg;
</script>

<h2
  class='mps-counter'
  style:--grid-size='{gridSize}px'
>
  MPS: {mpsAvg}
</h2>
