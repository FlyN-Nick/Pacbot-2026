<script>
 import Sprite from '../sprites/Sprite.svelte';
 import {directionFor} from '../sprites/frames.js';
 export let gridSize;export let row;export let col;export let dirRow=0;export let dirCol=0;
</script>
<div class="eyes" style:left="{(col+0.5)*gridSize}px" style:top="{(row+0.5)*gridSize}px"><Sprite frame={`eyes-${directionFor(dirCol,dirRow)}`} scale={gridSize/8}/></div>
<style>.eyes{position:absolute;transform:translate(-50%,-50%);line-height:0;z-index:4;pointer-events:none}</style>
