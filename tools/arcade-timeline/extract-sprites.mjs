import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {PNG} from 'pngjs';
import {catalog,RENDER_ATLAS_WIDTH,RENDER_ATLAS_HEIGHT} from '../../web_client/src/lib/sprites/catalog.js';
import {normalizeCapture} from './visual-captures.mjs';
const input=process.argv[2]??path.join(os.homedir(),'Downloads/sprites');
const out=fileURLToPath(new URL('../../web_client/public/sprites',import.meta.url));
fs.mkdirSync(out,{recursive:true});
function transparentBackground(image){
 for(let i=0;i<image.data.length;i+=4)if(image.data[i]===0&&image.data[i+1]===0&&image.data[i+2]===0)image.data[i+3]=0;
 return image;
}
const sheet=PNG.sync.read(fs.readFileSync(path.join(input,'Arcade - Pac-Man - Miscellaneous - General Sprites.png')));
const text=PNG.sync.read(fs.readFileSync(path.join(input,'Arcade - Pac-Man - Miscellaneous - Text.png')));
fs.writeFileSync(path.join(out,'general.png'),PNG.sync.write(transparentBackground(sheet)));
fs.writeFileSync(path.join(out,'text.png'),PNG.sync.write(transparentBackground(text)));
const crop=normalizeCapture(sheet,{crop:{x:456,y:0,width:224,height:160}});
const preview=new PNG({width:896,height:640});
for(let y=0;y<640;y++)for(let x=0;x<896;x++){const i=(Math.floor(y/4)*224+Math.floor(x/4))*4;crop.data.copy(preview.data,(y*896+x)*4,i,i+4);}
fs.writeFileSync('/tmp/pacbot-sprite-detail.png',PNG.sync.write(preview));

const hud=PNG.sync.read(fs.readFileSync(path.join(input,'Arcade - Pac-Man - Miscellaneous - Attract Mode & HUD Assets.png')));
const life=normalizeCapture(hud,{crop:{x:928,y:176,width:16,height:16}});
for(let i=0;i<life.data.length;i+=4)if(life.data[i]===0&&life.data[i+1]>100&&life.data[i+2]===0)life.data[i+1]=0;
fs.writeFileSync(path.join(out,'life.png'),PNG.sync.write(transparentBackground(life)));

const palettes=PNG.sync.read(fs.readFileSync(path.join(input,'Arcade - Pac-Man - Miscellaneous - All Assets_Palettes.png')));
const punctuation=normalizeCapture(palettes,{crop:{x:509,y:205,width:8,height:8}});
fs.writeFileSync(path.join(out,'punctuation.png'),PNG.sync.write(transparentBackground(punctuation)));

const atlas=new PNG({width:RENDER_ATLAS_WIDTH,height:RENDER_ATLAS_HEIGHT});
const sources=new Map();
for(const frame of Object.values(catalog)){
 if(!sources.has(frame.asset))sources.set(frame.asset,PNG.sync.read(fs.readFileSync(path.join(out,frame.asset))));
 const source=sources.get(frame.asset);
 for(let y=0;y<frame.height;y++){
  const start=((frame.y+y)*source.width+frame.x)*4;
  source.data.copy(atlas.data,((frame.render.y+y)*atlas.width+frame.render.x)*4,start,start+frame.width*4);
 }
}
fs.writeFileSync(path.join(out,'atlas.png'),PNG.sync.write(atlas));
