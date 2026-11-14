import test from'node:test';import assert from'node:assert/strict';import fs from'node:fs';import{PNG}from'pngjs';import{catalog}from'../../web_client/src/lib/sprites/catalog.js';
const sheet=PNG.sync.read(fs.readFileSync(new URL('../../web_client/public/sprites/general.png',import.meta.url)));
const yellow=(frame,x,y)=>{const f=catalog[frame],i=((f.y+y)*sheet.width+f.x+x)*4;return sheet.data[i]===255&&sheet.data[i+1]===255&&sheet.data[i+2]===0;};
test('directional artwork puts the open mouth on the travel side',()=>{assert.equal(yellow('pacman-right-0',3,7),true);assert.equal(yellow('pacman-right-0',12,7),false);assert.equal(yellow('pacman-left-0',12,7),true);assert.equal(yellow('pacman-left-0',3,7),false);assert.equal(yellow('pacman-up-0',7,3),false);assert.equal(yellow('pacman-down-0',7,12),false);});

test('sprite and glyph sheets have transparent black backgrounds and opaque colored pixels',()=>{
 for(const name of ['general.png','text.png','life.png','punctuation.png']){
 const image=PNG.sync.read(fs.readFileSync(new URL('../../web_client/public/sprites/'+name,import.meta.url)));
 let transparent=0,foreground=0;for(let i=0;i<image.data.length;i+=4){const black=image.data[i]===0&&image.data[i+1]===0&&image.data[i+2]===0;if(black){assert.equal(image.data[i+3],0,`${name} has opaque black background`);transparent++;}else{assert.equal(image.data[i+3],255);foreground++;}}
 assert.ok(transparent>0&&foreground>0);
 }
});

import { checkAtlasPadding } from './atlas-padding.mjs';
test('STRUCTURAL/ARTWORK: every runtime frame has a full in-bounds two-pixel transparent band',()=>{
 const images=new Map();
 for(const frame of Object.values(catalog)){
  const asset=frame.render?.asset;
  if(asset&&!images.has(asset))images.set(asset,PNG.sync.read(fs.readFileSync(new URL('../../web_client/public/sprites/'+asset,import.meta.url))));
 }
 const result=checkAtlasPadding(catalog,images);
 assert.equal(result.status,'pass',JSON.stringify(result,null,2));
});
