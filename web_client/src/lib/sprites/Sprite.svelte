<script>
 import {catalog} from './catalog.js';
 export let frame;
 export let scale=1;
 export let label=null;
 $: sprite=catalog[frame]??catalog.blank;
 $: render=sprite.render;
</script>
<span class="sprite" role={label?'img':undefined} aria-label={label} aria-hidden={label?undefined:'true'} style:width="{sprite.width*scale}px" style:height="{sprite.height*scale}px" style:background-image="url('{import.meta.env.BASE_URL}sprites/{render.asset}')" style:background-size="{render.sheetWidth*scale}px {render.sheetHeight*scale}px" style:background-position="{-render.x*scale}px {-render.y*scale}px"></span>
<style>.sprite{display:inline-block;flex-shrink:0;background-repeat:no-repeat;image-rendering:pixelated;vertical-align:top;}</style>
