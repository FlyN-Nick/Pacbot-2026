<script>
 import ArcadeText from './sprites/ArcadeText.svelte';import Sprite from './sprites/Sprite.svelte';import {fruitHistory,spareLives,scoreText} from './arcadeHud.js';
 export let gridSize;export let score=0;export let lives=3;export let level=1;export let highScore=0;
 $: scale=gridSize/8;
</script>
<div class="hud" style:--unit="{gridSize}px">
 <div class="label" style:left="{3*gridSize}px"><ArcadeText text="1UP" {scale}/></div>
 <div class="label" style:left="{9*gridSize}px"><ArcadeText text="HIGH SCORE" {scale}/></div>
 <div class="score" style:right="{21*gridSize}px"><ArcadeText text={scoreText(score)} {scale}/></div>
 {#if highScore>0}<div class="score" style:right="{9*gridSize}px"><ArcadeText text={scoreText(highScore)} {scale}/></div>{/if}
 <div class="lives" aria-label={`${spareLives(lives)} spare lives`}>{#each Array(spareLives(lives)) as _}<Sprite frame="life" {scale}/>{/each}</div>
 <div class="fruits" aria-label={`Level ${Math.max(1,level)} fruit history`}>{#each fruitHistory(level) as frame}<Sprite {frame} {scale}/>{/each}</div>
</div>
<style>.hud{position:absolute;inset:0;pointer-events:none}.label{position:absolute;top:0;line-height:0}.score{position:absolute;top:var(--unit);line-height:0}.lives{position:absolute;left:calc(2*var(--unit));top:calc(34*var(--unit));display:flex;line-height:0}.fruits{position:absolute;right:calc(2*var(--unit));top:calc(34*var(--unit));display:flex;flex-direction:row-reverse;line-height:0}</style>
