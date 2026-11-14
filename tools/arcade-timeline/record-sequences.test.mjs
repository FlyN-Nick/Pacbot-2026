import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PNG } from 'pngjs';
const api = () => import('./record-sequences.mjs');
const temp = t => { const dir=fs.mkdtempSync(path.join(os.tmpdir(),'sequences-test-')); t.after(()=>fs.rmSync(dir,{recursive:true,force:true})); return dir; };
test('absent ROM records unavailable inventory and exits nonzero', async t => {
 await api(); const out=path.join(temp(t),'out');
 const result=spawnSync(process.execPath,['record-sequences.mjs','--scope','initial','--out',out],{cwd:import.meta.dirname,env:{...process.env,PACMAN_ROM_DIR:''},encoding:'utf8'});
 assert.equal(result.status,1); const index=JSON.parse(fs.readFileSync(path.join(out,'index.json')));
 assert.equal(index.sequences.length,8);
 assert.deepEqual(index.sequences.slice(0,2).map(x=>[x.checkId,x.status]),[['full-screen:ready-movement','unavailable'],['full-screen:death-respawn','unavailable']]);
});
test('unsupported ROM verification or emulator revision rejects', async () => {
 const {requireVerifiedEnvironment}=await api();
 assert.throws(()=>requireVerifiedEnvironment('0.289 (unknown)','romset puckman is good',0),/pacman/);
 assert.throws(()=>requireVerifiedEnvironment('0.290','romset pacman [puckman] is good',0),/0.289/);
 assert.throws(()=>requireVerifiedEnvironment('0.289','romset pacman [puckman] is good',1),/verification/);
});
test('missing PNG or substantive painted association cannot publish a recording', async t => {
 const {validateRecordedSequence}=await api(); const dir=temp(t); const state={raw:'fixture'};
 const sample={id:'f-1',event:'ready-visible',offsetFrames:0,paintedFrame:1,emulatedFrame:1,image:'1.png',dimensions:{width:224,height:288},state,alignment:{method:'mame-sprite-observer-v1',paintedFrame:1,state,evidence:['1.json']}};
 const manifest={version:2,kind:'renderer-reference',scenario:'ready-movement',provenance:{checkpoints:{'ready-visible':{sampleIds:['f-1']}}},samples:[sample]};
 const definition={checkpoints:[{id:'ready-visible',completeness:'sample'}]};
 assert.throws(()=>validateRecordedSequence(dir,manifest,definition),/PNG|ENOENT/);
 fs.writeFileSync(path.join(dir,'1.png'),PNG.sync.write(new PNG({width:224,height:288})));
 fs.writeFileSync(path.join(dir,'1.json'),JSON.stringify({paintedFrame:1,state}));
 assert.throws(()=>validateRecordedSequence(dir,manifest,definition),/association|evidence|observer/);
});
test('all-observed coverage rejects missing interior frames and absent checkpoints', async () => {
 const {validateCheckpointCoverage}=await api();
 const definition={checkpoints:[{id:'death-art-transitions',completeness:'all-observed'},{id:'blank',completeness:'sample'}]};
 const samples=[{id:'f-1',emulatedFrame:1},{id:'f-3',emulatedFrame:3}];
 const checkpoints={'death-art-transitions':{sampleIds:['f-1','f-3'],firstFrame:1,lastFrame:3},blank:{sampleIds:['f-3']}};
 assert.throws(()=>validateCheckpointCoverage(samples,checkpoints,definition),/dense|interior|contiguous/);
 assert.throws(()=>validateCheckpointCoverage(samples,{blank:checkpoints.blank},definition),/death-art-transitions/);
});
test('full scope preserves every independent requirement as unavailable without producers', async () => {
 const {makeIndex}=await api(); const index=makeIndex('full'); assert.equal(index.sequences.length,108); assert.ok(index.sequences.every(x=>x.status==='unavailable'&&x.reason));
});

test('declaring a shortened death interval cannot hide unobserved art transitions', async () => {
 const {validateCheckpointCoverage}=await api();
 const samples=[52,53,54,55].map((code,i)=>({id:`f-${i}`,emulatedFrame:100+i,state:{spriteAttributes:[0,0,0,0,0,0,0,0,0,0,code*4]}}));
 assert.throws(()=>validateCheckpointCoverage(samples,{'death-art-transitions':{sampleIds:samples.map(s=>s.id),firstFrame:100,lastFrame:103}},
   {scenario:'death-respawn',checkpoints:[{id:'death-art-transitions',completeness:'all-observed'}]}),/boundar|death art/);
});

test('a valid observer associates pixels with post-update state and rejects altered PNG, state or calibration', async t => {
 const {validateRecordedSequence}=await api();
 const {createHash}=await import('node:crypto');
 const hash=b=>createHash('sha256').update(b).digest('hex');
 const dir=temp(t), proofs=[],samples=[];
 for(let frame=1;frame<=4;frame++){
   const slot=frame%2?5:1; // Fright reorders Pac-Man into slot1; hardware correction applies.
   const coordinates=Array(16).fill(0); coordinates[slot*2]=135+frame-(slot<=2?1:0);coordinates[slot*2+1]=68;
   const attributes=Array(16).fill(0);attributes[slot*2]=194;attributes[slot*2+1]=9;
   const state={spriteAttributes:attributes,spriteCoordinates:coordinates};
   const machineState=structuredClone(state);machineState.spriteCoordinates[slot*2]--;
   const p=new PNG({width:224,height:288}),left=105-frame;
   const points=[];
   for(let y=1;y<=13;y++)for(let x=1;x<=13;x++)if(!((x<=4||x>=10)&&(y<=2||y>=12)))points.push([x,y]);
   assert.equal(points.length,137);
   for(const [x,y]of points){const i=((204+y)*224+left+x)*4;p.data[i]=255;p.data[i+1]=255;p.data[i+3]=255;}
   const bytes=PNG.sync.write(p),raw={frame,screenFrame:frame,machineScreenFrame:frame-1,machineState,paintedState:state};
   const rawBytes=Buffer.from(JSON.stringify(raw));fs.writeFileSync(path.join(dir,`${frame}.png`),bytes);fs.writeFileSync(path.join(dir,`${frame}.raw.json`),rawBytes);
   fs.writeFileSync(path.join(dir,`${frame}.evidence.json`),JSON.stringify({method:'mame-frame-done-motion-v1',raw:`${frame}.raw.json`,calibration:'calibration.json',pngSha256:hash(bytes),rawSha256:hash(rawBytes),yellowBounds:{left:left+1,top:205,right:left+13,bottom:217,pixels:137}}));
   proofs.push({raw:`${frame}.raw.json`,image:`${frame}.png`});
   samples.push({id:`f-${frame}`,event:'fixture',offsetFrames:frame,paintedFrame:frame,emulatedFrame:frame,image:`${frame}.png`,dimensions:{width:224,height:288},state,alignment:{method:'mame-frame-done-motion-v1',paintedFrame:frame,state,evidence:[`${frame}.evidence.json`]}});
 }
 const calibration={method:'mame-frame-done-motion-v1',proofs};fs.writeFileSync(path.join(dir,'calibration.json'),JSON.stringify(calibration));
 fs.writeFileSync(path.join(dir,'command.json'),JSON.stringify({inputs:[]}));
 fs.writeFileSync(path.join(dir,'events.json'),'[]');
 fs.writeFileSync(path.join(dir,'environment.json'),JSON.stringify({mameVersion:'0.289',verification:'romset pacman [puckman] is good',verificationExitStatus:0}));
 const manifest={version:2,kind:'renderer-reference',scenario:'fixture',provenance:{commands:'command.json',rawEvents:'events.json',verificationArtifact:'environment.json',checkpoints:{fixture:{sampleIds:['f-1']}}},samples};
 const definition={checkpoints:[{id:'fixture',completeness:'sample'}]};
 assert.equal(validateRecordedSequence(dir,manifest,definition),manifest);
 const missingCommand=structuredClone(manifest);missingCommand.provenance.commands='absent.json';
 assert.throws(()=>validateRecordedSequence(dir,missingCommand,definition),/ENOENT/);
 const original=fs.readFileSync(path.join(dir,'4.png'));
 fs.writeFileSync(path.join(dir,'4.png'),PNG.sync.write(new PNG({width:224,height:288})));
 assert.throws(()=>validateRecordedSequence(dir,manifest,definition),/observer|association/);
 fs.writeFileSync(path.join(dir,'4.png'),original);
 const altered=structuredClone(manifest);altered.samples[0].state.spriteCoordinates[10]++;
 assert.throws(()=>validateRecordedSequence(dir,altered,definition),/painted state|association/);
 fs.writeFileSync(path.join(dir,'calibration.json'),JSON.stringify({...calibration,proofs:[proofs[0],proofs[0],proofs[0],proofs[0]]}));
 assert.throws(()=>validateRecordedSequence(dir,manifest,definition),/observer/);
});

test('a partial mouth cycle is incomplete even with dense samples', async () => {
 const {validateCheckpointCoverage}=await api();
 const samples=[48,46,44].map((code,i)=>({id:`f-${i}`,emulatedFrame:10+i,state:{spriteAttributes:[0,0,0,0,0,0,0,0,0,0,code*4]}}));
 assert.throws(()=>validateCheckpointCoverage(samples,{'mouth-cycle':{sampleIds:samples.map(s=>s.id),firstFrame:10,lastFrame:12}},
  {scenario:'ready-movement',checkpoints:[{id:'mouth-cycle',completeness:'all-observed'}]}),/mouth cycle/);
});
