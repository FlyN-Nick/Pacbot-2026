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

// MAME 0.289 mappings verified by retained native pixel probes; no source
// position fitting. A missing phase throws instead of reducing the inventory.
export function expandedReferenceRanges(scenario,rows) {
 const has=(r,attr,palette)=>Array.from({length:8},(_,s)=>s).some(s=>{
  const raw=r.paintedState,x=240-raw.spriteCoordinates[s*2]-(s<=2?1:0),y=272-raw.spriteCoordinates[s*2+1];
  return raw.spriteAttributes[s*2]===attr&&raw.spriteAttributes[s*2+1]===palette&&x>=0&&x+16<=224&&y>=24&&y+16<=272;
 });
 const pick=(predicate,label)=>{const r=rows.find(predicate);if(!r)throw Error(`${label} not observed`);return [r.frame,r.frame];};
 const directionCode={right:128,down:136,left:144,up:152};
 if(scenario.startsWith('mouth-')) {
  const direction=scenario.slice(6),[open,half,closed]={left:[178,186,194],right:[176,184,192],up:[181,189,192],down:[180,188,192]}[direction]??[];
  const phases=rows.map(r=>({r,phase:has(r,open,9)?0:has(r,half,9)?1:has(r,closed,9)?2:null}));
  const changes=phases.filter((p,i)=>!i||p.phase!==phases[i-1].phase);
  for(let i=0;i+4<changes.length;i++)if(changes.slice(i,i+5).map(p=>p.phase).join(',')==='2,1,0,1,2') {
   const selected=changes.slice(i,i+5).map(p=>p.r.frame);
   return {'frame-0':[selected[2],selected[2]],'frame-1':[selected[1],selected[1]],'frame-2':[selected[0],selected[0]],'frame-3':[selected[3],selected[3]],'mouth-cycle':[selected[0],selected[4]]};
  }
  throw Error('Complete directional mouth cycle not observed');
 }

 if(scenario.startsWith('ghost-')){const[,color,direction]=scenario.split('-'),code=directionCode[direction],palette={red:1,pink:3,cyan:5,orange:7}[color];return {'foot-0':pick(r=>has(r,code,palette),'foot-0'),'foot-1':pick(r=>has(r,code+4,palette),'foot-1')};}
 if(scenario.startsWith('eyes-')){const code=directionCode[scenario.slice(5)];return {'eyes-visible':pick(r=>has(r,code,25)||has(r,code+4,25),'eyes-visible')};}
 if(scenario==='fright-restoration') {
  const ranges={};for(const[name,attr,palette]of [['blue-foot-0',112,17],['blue-foot-1',116,17],['white-foot-0',112,18],['white-foot-1',116,18]])ranges[name]=pick(r=>has(r,attr,palette),name);
  const after=Math.max(...Object.values(ranges).flat());ranges['normal-restored']=pick(r=>r.frame>after&&[128,132,136,140,144,148,152,156].some(a=>has(r,a,1))&&!r.paintedState.spriteAttributes.some((p,i)=>i%2&&[17,18].includes(p)),'normal-restored');return ranges;
 }
 throw Error(`Source mapping not calibrated for ${scenario}`);
}
