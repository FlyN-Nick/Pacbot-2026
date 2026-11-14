<script>
 import Sprite from './Sprite.svelte';
 import {catalog} from './catalog.js';
 export let text='';export let color='white';export let scale=1;
</script>
<span class="arcade-text" aria-label={text}>{#each [...String(text).toUpperCase()] as char}{#if catalog[`glyph-${color}-${char}`]}<Sprite frame={`glyph-${color}-${char}`} {scale}/>{:else}<span style:width="{8*scale}px"></span>{/if}{/each}</span>
<style>.arcade-text{display:inline-flex;white-space:nowrap;line-height:0}.arcade-text>span{display:inline-block}</style>
