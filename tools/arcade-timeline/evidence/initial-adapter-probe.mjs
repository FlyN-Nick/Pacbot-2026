import fs from 'node:fs';import {createHash} from 'node:crypto';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{PNG}=require('pngjs');
const root=process.argv[2]??'/tmp/pacman-sequences-initial-20261110';const samples=['start','death'].flatMap(x=>JSON.parse(fs.readFileSync(`${root}/${x}/manifest.json`)).samples);
const digest=b=>createHash('sha256').update(b).digest('hex');const ghosts={};
for(const s of samples)for(let k=1;k<=4;k++){
 const attribute=s.state.spriteAttributes[2*k],x=240-s.state.spriteCoordinates[2*k]-(k<=2?1:0),y=272-s.state.spriteCoordinates[2*k+1];
 if(ghosts[attribute]||x<0||x>208||y<24||y>248)continue;
 const bytes=fs.readFileSync(`${root}/${s.image}`),p=PNG.sync.read(bytes),pupils=[],white=[],feet=[];
 for(let yy=0;yy<16;yy++)for(let xx=0;xx<16;xx++){
  let i=((y+yy)*224+x+xx)*4;const rgb=[...p.data.subarray(i,i+3)];
  if(rgb.join(',')==='33,33,255')pupils.push([xx,yy]);
  if(rgb.join(',')==='222,222,255')white.push([xx,yy]);
  if(yy===13&&rgb.some(c=>c!==0))feet.push({x:xx,rgb});
 }
 ghosts[attribute]={frame:s.emulatedFrame,slot:k,x,y,pngSha256:digest(bytes),pupils,white,feet};
}
const tileSamples=[544,662,668,694,1373,1593,1594,1603].map(frame=>{
 const s=samples.find(s=>s.emulatedFrame===frame),idx=(r,c)=>r<2||r>=34?29-c+(((r-2)&31)<<5):r-2+((29-c)<<5);
 return {frame,pngSha256:digest(fs.readFileSync(`${root}/${s.image}`)),logicalLives:s.state.lives,
  tiles:[0,1,6,20,34,35].map(row=>({row,codes:Array.from({length:28},(_,col)=>s.state.videoRam[idx(row,col)]),colors:Array.from({length:28},(_,col)=>s.state.colorRam[idx(row,col)])}))};
});
console.log(JSON.stringify({method:'direct reference PNG pupil/bottom-row scan plus raw tile observations',ghosts,tileSamples},null,2));
