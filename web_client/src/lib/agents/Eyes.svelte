<script>
  // An eaten ghost's eyes on their way home (arcade mode). Drawn like Ghost.svelte's
  // eaten state, at a fractional tile position.
  export let gridSize;
  export let row;
  export let col;
  // Direction of travel, -1/0/1 on each axis
  export let dirRow = 0;
  export let dirCol = 0;

  $: pad = gridSize / 20;
  $: offset = pad + 0.25 * (gridSize + 2 * pad);
</script>

<svg
  class="eyes-svg"
  aria-hidden="true"
  style:--grid-size="{~~gridSize + 1}px"
  style:--pad="{pad}px"
  style:transform="translate3d({col * gridSize - offset}px, {row * gridSize - offset}px, 0) scale(1.5)"
>
  {#each [0.30, 0.70] as x}
    <ellipse
      class="eye"
      cx={pad + (x + 0.06 * dirCol) * gridSize}
      cy={pad + (0.40 + 0.09 * dirRow) * gridSize}
      rx={0.14 * gridSize}
      ry={0.20 * gridSize}
    />
    <ellipse
      class="iris"
      cx={pad + (x + 0.12 * dirCol) * gridSize}
      cy={pad + (0.40 + 0.18 * dirRow) * gridSize}
      rx={0.07 * gridSize}
      ry={0.10 * gridSize}
    />
  {/each}
</svg>

<style>
  .eyes-svg {
    position: absolute;
    top: 0;
    left: 0;
    width: calc(var(--grid-size) + 2 * var(--pad));
    height: calc(var(--grid-size) + 2 * var(--pad));
    transform-origin: top left;
    pointer-events: none;
  }

  .eye { fill: white; }
  .iris { fill: blue; }
</style>
