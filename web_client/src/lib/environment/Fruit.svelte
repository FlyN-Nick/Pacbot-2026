<script>
 import Sprite from '../sprites/Sprite.svelte';import {selectFruitFrame} from '../sprites/frames.js';
 export let gridSize;export let fruitRowState;export let fruitColState;export let fruitSteps;export const fruitDuration=30;export let currLevel=1;
 $: visible=((fruitRowState|fruitColState)&32)===0&&fruitSteps>0;
</script>
{#if visible}<div class="fruit" style:left="{((fruitColState&31)+0.5)*gridSize}px" style:top="{((fruitRowState&31)+0.5)*gridSize}px"><Sprite frame={selectFruitFrame(currLevel)} scale={gridSize/8}/></div>{/if}
<style>.fruit{position:absolute;transform:translate(-50%,-50%);line-height:0;z-index:3;pointer-events:none}</style>
