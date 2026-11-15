import test from 'node:test';import assert from 'node:assert/strict';
import {makeReplayIndex,compareReplayImages,deathClock,assertReplayIsolation} from './render-sequences.mjs';
import {requiredChecks} from './sequence-coverage.mjs';

test('replay inventory preserves every independent requirement when input entries are absent',()=>{
 const index=makeReplayIndex({version:2,scope:'initial',sequences:[]});
 assert.equal(index.sequences.length,8);assert.ok(index.sequences.every(x=>x.status==='unavailable'));
 assert.deepEqual(index.sequences.map(x=>x.checkId),requiredChecks('initial').map(x=>x.id));
 assert.throws(()=>makeReplayIndex({version:2,scope:'initial',sequences:[{checkId:'x'},{checkId:'x'}]}),/duplicate|unknown/i);
});
test('requested initial replay filters full references without shrinking missing requirements',()=>{
 const source={version:2,scope:'full',sequences:[{checkId:'full-screen:mouth-right',status:'recorded'}]};
 const index=makeReplayIndex(source,'initial');
 assert.equal(index.sequences.length,8);assert.equal(index.scope,'initial');assert.equal(index.referenceScope,'full');
 assert.equal(index.sequences[0].status,'unavailable');
 assert.throws(()=>makeReplayIndex({...source,sequences:[{checkId:'unknown'}]},'initial'),/unknown/i);
});
test('comparison really counts full-screen pixels and rejects declared dimension mismatch',()=>{
 const image=()=>({width:224,height:288,data:Buffer.alloc(224*288*4)}),a=image(),b=image();b.data[(280*224+210)*4]=255;
 const result=compareReplayImages(a,b,{width:224,height:288});
 assert.equal(result.status,'fail');assert.equal(result.whole.differingPixels,1);assert.equal(result.regions.footer.differingPixels,1);
 assert.throws(()=>compareReplayImages(a,b,{width:225,height:288}),/dimensions/);
});
test('death clock requires recorded catch and actual adjacent onset evidence',()=>{
 const sample=(frame,code)=>({emulatedFrame:frame,state:{spriteAttributes:[0,0,0,0,0,0,0,0,0,0,code*4]}});
 const m={scenario:'death-respawn',provenance:{checkpoints:{'death-catch':{firstFrame:1373}}},samples:[sample(1433,44),sample(1434,52),sample(1435,52)]};
 assert.deepEqual(deathClock(m),{deathCatchFrame:1373,deathAnimationStartFrame:1434});
 m.samples.shift();assert.throws(()=>deathClock(m),/onset/);
});
test('capture isolation fails on any outgoing message or real-server state change',()=>{
 assertReplayIsolation({score:0},{score:0},[]);
 assert.throws(()=>assertReplayIsolation({score:0},{score:0},['P']),/command/);
 assert.throws(()=>assertReplayIsolation({score:0},{score:10},[]),/server state/);
});

test('actor diagnostic regions use native source positions without moving comparison pixels',()=>{
 const a={width:224,height:288,data:Buffer.alloc(224*288*4)},b={...a,data:Buffer.from(a.data)};
 b.data[(204*224+105)*4]=255;
 const r=compareReplayImages(a,b,{width:224,height:288},{pacman:{position:{x:113,y:188},visible:true},ghosts:[]});
 assert.equal(r.regions['actor-pacman'].differingPixels,1);assert.equal(r.whole.differingPixels,1);
});

test('actual artifact validation rejects tampered paint observations, bytes and missing evidence',async()=>{
 const fs=await import('node:fs'),os=await import('node:os'),path=await import('node:path');
 const {createHash}=await import('node:crypto'),{PNG}=await import('pngjs');
 const {validateRenderedSequence}=await import('./render-sequences.mjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'replay-evidence-test-'));
 const write=(file,value)=>fs.writeFileSync(path.join(root,file),JSON.stringify(value));
 const hash=file=>createHash('sha256').update(fs.readFileSync(path.join(root,file))).digest('hex');
 try{
  const state={raw:1},canonical={schema:'arcade-render-v1',pacman:{position:{x:113,y:188},visible:true,facing:'left',phase:132,deathElapsedMs:null},ghosts:[]};
  write('input.json',canonical);write('isolation.json',{before:{score:0},after:{score:0},commands:[]});write('adapter.json',{});write('comparison.json',[]);
  fs.writeFileSync(path.join(root,'image.png'),PNG.sync.write(new PNG({width:224,height:288})));
  const observation=frame=>({paintedFrame:frame,paintTimestamp:frame*16,dimensions:{width:224,height:288},actors:[{x:105,y:204}],capture:{kind:'arcade',state:canonical,phase:0}});
  const evidence={before:observation(1),after:observation(3),canonicalInput:'input.json',inputSha256:hash('input.json'),pngSha256:hash('image.png'),sourceState:state};
  write('paint.json',evidence);
  const sample={id:'one',event:'ready',offsetFrames:0,emulatedFrame:544,paintedFrame:3,image:'image.png',dimensions:{width:224,height:288},state,alignment:{method:'browser-stable-paint-v1',paintedFrame:3,state,evidence:['paint.json','input.json']}};
  const manifest={version:2,kind:'renderer-actual',scenario:'test',provenance:{isolation:'isolation.json',adapterEvidence:'adapter.json',comparisons:'comparison.json',checkpoints:{ready:{sampleIds:['one']}}},samples:[sample]};
  const definition={scenario:'test',checkpoints:[{id:'ready',completeness:'sample'}]};
  validateRenderedSequence(root,manifest,definition);
  canonical.pacman.frame='pacman-left-2';write('input.json',canonical);evidence.inputSha256=hash('input.json');write('paint.json',evidence);
  assert.throws(()=>validateRenderedSequence(root,manifest,definition),/override/);
  delete canonical.pacman.frame;write('input.json',canonical);evidence.inputSha256=hash('input.json');write('paint.json',evidence);
  evidence.after.actors[0].x=999;write('paint.json',evidence);
  assert.throws(()=>validateRenderedSequence(root,manifest,definition),/paint association/);
  evidence.after.actors[0].x=105;write('paint.json',evidence);
  const changed=new PNG({width:224,height:288});changed.data[0]=255;fs.writeFileSync(path.join(root,'image.png'),PNG.sync.write(changed));assert.throws(()=>validateRenderedSequence(root,manifest,definition),/paint association/);
  fs.rmSync(path.join(root,'paint.json'));assert.throws(()=>validateRenderedSequence(root,manifest,definition));
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
