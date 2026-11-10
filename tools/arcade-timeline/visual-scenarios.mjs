// Live checkpoint offsets are arcade frames after an observed event.
export const VISUAL_SCENARIOS = [
 {scenario:'start',anchor:'readyShown',offsets:[30]},
 {scenario:'start',anchor:'gameStarted',offsets:[1,8,16]},
 {scenario:'death',anchor:'deathFrame',offsets:[0]},
 {scenario:'ghostEaten',anchor:'frightStarted',offsets:[15,30]},
 {scenario:'ghostEaten',anchor:'frightFlashStart',offsets:[0]},
 {scenario:'ghostEaten',anchor:'eyesStarted',offsets:[5]},
];
export function visualFixtures(){
 const fixtures=[];const base={score:0,lives:3,level:1,highScore:0,pellets:Array.from({length:31},()=>Array(28).fill(0))};
 const add=(name,state,phase=0)=>fixtures.push({name,state:{...base,...state},phase});
 const directions={right:[0,64],left:[0,192],up:[192,0],down:[64,0]};
 for(const[direction,[row,col]]of Object.entries(directions))for(let f=0;f<4;f++)add(`pacman-${direction}-${f}`,{pacman:{rowState:23|row,colState:13|col},moving:true},f*66);
 for(const color of ['red','pink','cyan','orange'])for(const[direction,[row,col]]of Object.entries(directions))for(let f=0;f<2;f++)add(`ghost-${color}-${direction}-${f}`,{ghosts:[{rowState:11|row,colState:13|col,color}]},f*132);
 for(const [f,phase]of [0,495,610.5,742.5,858,990,1105.5,1237.5,1353,1485,1600.5,1848,2112].entries())add(`death-${f}`,{death:true,pacman:{rowState:23,colState:13}},phase);
 for(let level=1;level<=13;level++)add(`hud-level-${level}`,{level,score:level*1000,lives:level%6,fruit:{row:17,col:13}});
 for(let f=0;f<2;f++)for(const flashing of [false,true])add(`fright-${flashing?'white':'blue'}-${f}`,{modTicks:flashing?6:0,ghosts:[{rowState:11,colState:13,frightState:flashing?5:30}]},f*132);
 for(const[direction,[row,col]]of Object.entries(directions))add(`eyes-${direction}`,{ghosts:[{rowState:11|row,colState:13|col,trappedState:128}]});
 add('ready',{ready:true,pacman:{rowState:23,colState:13},moving:false});
 return fixtures;
}
