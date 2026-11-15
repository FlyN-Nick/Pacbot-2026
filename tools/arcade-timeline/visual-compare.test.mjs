import test from 'node:test';import assert from 'node:assert/strict';
import {compareImages,compareCapturePair} from './visual-compare.mjs';
const a={width:2,height:2,data:Buffer.from([0,0,0,255,0,0,0,255,0,0,0,255,0,0,0,255])};
test('differences count pixels once and respect named regions',()=>{const b={...a,data:Buffer.from(a.data)};b.data[4]=255;b.data[5]=128;const r=compareImages(a,b,{left:{x:0,y:0,width:1,height:2}});assert.equal(r.whole.differingPixels,1);assert.equal(r.whole.ratio,0.25);assert.equal(r.regions.left.differingPixels,0);assert.equal(compareImages(a,a,{}).whole.differingPixels,0);});
test('invalid geometry cannot pass',()=>{assert.throws(()=>compareImages(a,{...a,width:3},{}));assert.throws(()=>compareImages(a,a,{bad:{x:2,y:0,width:1,height:1}}));});
test('missing references and incompatible phases cannot pass',()=>{assert.equal(compareCapturePair(null,{}).status,'missing reference');assert.equal(compareCapturePair({state:'ready',phase:0},{state:'ready',phase:1}).status,'phase mismatch');assert.equal(compareCapturePair({state:'ready',phase:0},{state:'moving',phase:0}).status,'state mismatch');});

import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {spawnSync}from'node:child_process';import{PNG}from'pngjs';
test('CLI rejects false dimensions and invalid actual regions even for identical PNGs',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'visual-cli-test-'));
 try{for(const dir of ['reference','actual']){fs.mkdirSync(path.join(tmp,dir));fs.writeFileSync(path.join(tmp,dir,'frame.png'),PNG.sync.write(a));}
 const meta={version:1,source:'gui',scenario:'fixture',anchor:'ready',frameOffset:0,state:'ready',phase:0,image:'frame.png',dimensions:{width:2,height:2},normalization:{},regions:{},provenance:{kind:'fixture'}};
 const write=(dir,c)=>fs.writeFileSync(path.join(tmp,dir,'manifest.json'),JSON.stringify({version:1,captures:[c]}));write('reference',meta);
 const run=()=>spawnSync(process.execPath,[new URL('./visual-compare.mjs',import.meta.url).pathname,'--reference',path.join(tmp,'reference'),'--actual',path.join(tmp,'actual'),'--out',path.join(tmp,'report')],{encoding:'utf8'});
 write('actual',{...meta,dimensions:{width:999,height:123}});assert.notEqual(run().status,0);
 write('actual',{...meta,regions:{bad:{x:-1,y:0,width:1,height:1}}});assert.notEqual(run().status,0);
 write('actual',{...meta,phase:1});assert.match(run().stdout,/PHASE MISMATCH/);
 write('actual',meta);assert.equal(run().status,0);
 }finally{fs.rmSync(tmp,{recursive:true,force:true});}
});
