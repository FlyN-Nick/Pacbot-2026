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
 const pacmanSlots=Array.from({length:8},(_,slot)=>slot).filter(slot=>raw.spriteAttributes[slot*2+1]===9);
 if(pacmanSlots.length!==1)throw Error('Unverified Pac-Man slot assignment');
 const pacmanSlot=pacmanSlots[0];
 const pacman={...position(raw,pacmanSlot),facing:null,phase:0,deathElapsedMs:null};
 const attr=raw.spriteAttributes[pacmanSlot*2],code=attr>>2;
 if(pacman.visible) {
  if(raw.spriteAttributes[pacmanSlot*2+1]!==9)throw Error('Unverified Pac-Man palette');
  if(code>=52&&code<=63&&attr%4===0) {
   const {emulatedFrame,deathCatchFrame,deathAnimationStartFrame}=context;
   if(![emulatedFrame,deathCatchFrame,deathAnimationStartFrame].every(Number.isSafeInteger)||deathAnimationStartFrame<deathCatchFrame||emulatedFrame<deathAnimationStartFrame)throw Error('Missing verified death clock');
   pacman.deathElapsedMs=(emulatedFrame-deathAnimationStartFrame)*FRAME_MS;
   pacman.catchElapsedMs=(emulatedFrame-deathCatchFrame)*FRAME_MS;
  }else {
   const mapped={176:['right',0],178:['left',0],180:['down',0],181:['up',0],184:['right',66],186:['left',66],188:['down',66],189:['up',66],194:['left',132]}[attr];
   if(attr===192){if(!['right','up','down'].includes(context.pacmanFacing))throw Error('Missing verified Pac-Man facing context');pacman.facing=context.pacmanFacing;pacman.phase=132;}
   else {if(!mapped)throw Error(`Unverified visible Pac-Man phase ${attr}`);[pacman.facing,pacman.phase]=mapped;}
  }
 }
 const ghosts=[];
 for(let slot=0;slot<8;slot++) {
  if(slot===pacmanSlot)continue;
  const geometry=position(raw,slot),attribute=raw.spriteAttributes[slot*2],palette=raw.spriteAttributes[slot*2+1],sprite=attribute>>2;
  if(!geometry.visible||palette===0)continue;
  if(palette===24)throw Error('Unverified score-popup rendering');
  const normalColor={1:'red',3:'pink',5:'cyan',7:'orange'}[palette];
  const actor={...geometry,color:normalColor??'red',facing:null,footPhase:0,eaten:palette===25,frightened:palette===17||palette===18,flashing:palette===18};
  if(actor.frightened) {
   if(![112,116].includes(attribute))throw Error('Unverified frightened artwork');
   actor.facing='left';actor.footPhase=sprite%2; // Direction is visually immaterial for frightened art.
  }else {
   if(attribute%4||(!normalColor&&!actor.eaten)||sprite<32||sprite>39)throw Error(`Unverified visible ghost phase/palette ${attribute}`);
   actor.facing=['right','down','left','up'][Math.floor((sprite-32)/2)];actor.footPhase=sprite%2;
  }
  // Anonymous frightened/eyes hardware slots retain paint position and phase;
  // their original character identity is not inferred from reordered slots.
  actor.sourceSlot=slot;ghosts.push(actor);
 }
 if(ghosts.length>4)throw Error('Unverified visible ghost count');
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
  maze:{flashing:false,blank:false},unavailable:{expandedActors:'Score popups remain uncalibrated; frightened/eyes character identity is not inferred',progression:'Only first/cherry board is calibrated'}};
}
