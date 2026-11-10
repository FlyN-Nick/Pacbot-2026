const levels=['cherry','strawberry','orange','orange','apple','apple','melon','melon','galaxian','galaxian','bell','bell','key'];
export const directionFor=(dx,dy)=>dx<0?'left':dx>0?'right':dy<0?'up':dy>0?'down':'left';
export function selectPacmanFrame({direction='left',phase=0,dying=false,deathFrame=0}){
 if(dying)return deathFrame>=11?'blank':`death-${Math.max(0,Math.floor(deathFrame))}`;
 return `pacman-${direction}-${[0,1,2,1][((Math.floor(phase)%4)+4)%4]}`;
}
export function selectGhostFrame({color='red',direction='left',phase=0,eaten=false,frightened=false,flashing=false}){
 if(eaten)return `eyes-${direction}`;
 const f=Math.floor(phase)%2;
 return frightened?`fright-${flashing?'white':'blue'}-${f}`:`ghost-${color}-${direction}-${f}`;
}
export const selectFruitFrame=(level)=>`fruit-${levels[Math.min(12,Math.max(0,Math.floor(level)-1))]}`;

// MAME 0.289 native death capture phases, relative to the first death event.
export const DEATH_ARTWORK_OFFSETS_MS=[495,610.5,742.5,858,990,1105.5,1237.5,1353,1485,1600.5,1848];
export function selectDeathFrame(elapsedMs){
 if(elapsedMs>=2112)return 'blank';
 let frame=-1;for(let i=0;i<DEATH_ARTWORK_OFFSETS_MS.length;i++)if(elapsedMs>=DEATH_ARTWORK_OFFSETS_MS[i])frame=i;
 return frame<0?'pacman-up-0':`death-${frame}`;
}
export function resolvePacmanFrame({previousFrame,direction,phase=0,active=false,moving=false,ready=false}){
 if(ready)return selectPacmanFrame({direction,phase:2});
 if(!previousFrame)return selectPacmanFrame({direction,phase:0});
 return active&&moving?selectPacmanFrame({direction,phase:Math.floor(phase/66)}):previousFrame;
}
