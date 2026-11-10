<script>
 import Pacman from './agents/Pacman.svelte';import Ghost from './agents/Ghost.svelte';import Eyes from './agents/Eyes.svelte';import Fruit from './environment/Fruit.svelte';import ArcadeText from './sprites/ArcadeText.svelte';
 export let fixture;export let gridSize;
 $: state=fixture.state;
</script>
{#if state.pacman}<Pacman {gridSize} pacmanRowState={state.pacman.rowState} pacmanColState={state.pacman.colState} phase={fixture.phase} active={true} moving={state.moving??true} ready={state.ready??false} frameOverride={state.pacman.frame??null} deathElapsedOverride={state.death?fixture.phase:null}/>{/if}
{#each state.ghosts??[] as ghost,i}<Ghost {gridSize} phase={fixture.phase} rowState={ghost.rowState} colState={ghost.colState} color={ghost.color??['red','pink','cyan','orange'][i]} frightState={ghost.frightState??0} trappedState={ghost.trappedState??0} modTicks={state.modTicks??(Math.floor(fixture.phase/132)%2)*6} updatePeriod={12} frameOverride={ghost.frame??null}/>{/each}
{#each state.eyes??[] as eye}<Eyes {gridSize} {...eye}/>{/each}
{#if state.fruit}<Fruit {gridSize} fruitRowState={state.fruit.row} fruitColState={state.fruit.col} fruitSteps={1} fruitDuration={1} currLevel={state.level??1}/>{/if}
{#if state.ready}<div class="ready" style:left="{11*gridSize}px" style:top="{17*gridSize}px"><ArcadeText text="READY!" color="yellow" scale={gridSize/8}/></div>{/if}
<style>.ready{position:absolute;line-height:0;z-index:5}</style>
