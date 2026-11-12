// Calibrated for the initial upright MAME 0.289 recordings only. See
// arcade-state-evidence.md for source coordinates, tile addresses and probes.
export const FRAME_MS = 16.5; // 384 * 264 / (18.432 MHz / 3)
export function tileOffset(row, col) {
 return row < 2 || row >= 34 ? 29-col+(((row-2)&31)<<5) : row-2+((29-col)<<5);
}
function position(raw, slot) {
 const left=240-raw.spriteCoordinates[slot*2]-(slot<=2?1:0), top=272-raw.spriteCoordinates[slot*2+1];
 return {position:{x:left+8,y:top+8-24},visible:left<224&&left+16>0&&top<272&&top+16>24};
}
function score(raw, first, last) {
 let text='';for(let col=first;col<=last;col++) {
  const code=raw.videoRam[tileOffset(1,col)];
  if(code===64)text+=' ';else if(code>=0&&code<=9)text+=code;else throw Error('Unverified score tile');
 }
 if(first===11&&!text.trim())return 0;
 if(!/^ *\d+$/.test(text))throw Error('Unverified score presentation');
 return Number(text);
}
/** Context carries observed chronology, never a phase fitted to sprite artwork. */
export function adaptArcadeState(raw, context={}) {
 if(raw?.schema!=='mame-pacman-raw-v1')throw Error('Unsupported raw state schema');
 for(const [field,length]of [['videoRam',1024],['colorRam',1024],['spriteAttributes',16],['spriteCoordinates',16]])
  if(!Array.isArray(raw[field])||raw[field].length!==length||raw[field].some(x=>!Number.isFinite(x)||x<0||x>255))throw Error(`Invalid ${field}`);
 if(raw.flipScreen!==0)throw Error('Unverified orientation');
 if(raw.levelByte!==0)throw Error('Unverified level progression');
 const ready=raw.videoRam[tileOffset(20,11)]===82;
 const pacman={...position(raw,5),facing:null,phase:0,deathElapsedMs:null};
 const attr=raw.spriteAttributes[10],code=attr>>2;
 if(pacman.visible) {
  if(raw.spriteAttributes[11]!==9)throw Error('Unverified Pac-Man palette');
  if(code>=52&&code<=63&&attr%4===0) {
   const {emulatedFrame,deathCatchFrame,deathAnimationStartFrame}=context;
   if(![emulatedFrame,deathCatchFrame,deathAnimationStartFrame].every(Number.isSafeInteger)||deathAnimationStartFrame<deathCatchFrame||emulatedFrame<deathAnimationStartFrame)throw Error('Missing verified death clock');
   pacman.deathElapsedMs=(emulatedFrame-deathAnimationStartFrame)*FRAME_MS;
   pacman.catchElapsedMs=(emulatedFrame-deathCatchFrame)*FRAME_MS;
  }else {
   const phase={178:0,186:66,194:132}[attr];
   if(phase===undefined)throw Error(`Unverified visible Pac-Man phase ${attr}`);
   pacman.facing='left';pacman.phase=phase;
  }
 }
 const ghosts=['red','pink','cyan','orange'].map((color,i)=>{
  const slot=i+1,actor={...position(raw,slot),color,facing:null,footPhase:0,eaten:false,frightened:false,flashing:false};
  if(actor.visible){
   const attribute=raw.spriteAttributes[slot*2],sprite=attribute>>2;
   if(attribute%4||raw.spriteAttributes[slot*2+1]!==[1,3,5,7][i]||![34,35,36,37,38,39].includes(sprite))throw Error(`Unverified visible ghost phase/palette ${attribute}`);
   actor.facing=sprite<36?'down':sprite<38?'left':'up';actor.footPhase=sprite%2;
  }
  return actor;
 });
 const pellets=Array.from({length:31},(_,row)=>Array.from({length:28},(_,col)=>{
  const offset=tileOffset(row+3,col),code=raw.videoRam[offset],color=raw.colorRam[offset]&31;
  return color===16?(code===16?1:code===20?2:0):0;
 }));
 // Count complete painted life tile blocks; RAM lives changes before these tiles.
 let spare=0;for(let col=0;col<27;col++)if(raw.videoRam[tileOffset(34,col)]===33&&raw.videoRam[tileOffset(34,col+1)]===32&&raw.videoRam[tileOffset(35,col)]===35&&raw.videoRam[tileOffset(35,col+1)]===34)spare++;
 if(![144,145,146,147].every((value,i)=>raw.videoRam[[4,5,36,37][i]]===value))throw Error('Unverified fruit history');
 return {schema:'arcade-render-v1',pacman,ghosts,pellets,ready,moving:!ready&&raw.subState===3,
  score:score(raw,1,6),highScore:score(raw,11,16),lives:spare+1,level:1,
  playerLabelVisible:raw.videoRam[tileOffset(0,3)]===49,
  maze:{flashing:false,blank:false},unavailable:{expandedActors:'Frightened, eyes, other facing and palettes have not been calibrated',progression:'Only first/cherry board is calibrated'}};
}
