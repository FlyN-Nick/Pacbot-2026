import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateProof } from './mutations.mjs';
const target='waiting-closed';
const pass={target,status:'pass',reason:'Closed waiting pose',errors:[]};
const fail={target,status:'fail',reason:'Open waiting pose',failureCode:'open-waiting-pose',errors:[]};
test('mutation proof rejects a mutation that never triggers the target',()=>assert.equal(evaluateProof(target,pass,pass).status,'fail'));
test('an already-failing baseline cannot demonstrate detection',()=>assert.equal(evaluateProof(target,fail,fail).status,'fail'));
test('an unrelated target failure cannot demonstrate detection',()=>assert.equal(evaluateProof(target,pass,{...fail,target:'other-check'}).status,'fail'));
test('browser or setup errors cannot demonstrate detection',()=>assert.equal(evaluateProof(target,pass,{...fail,errors:['Browser crashed']}).status,'fail'));
test('missing observations cannot demonstrate detection',()=>assert.equal(evaluateProof(target,pass,{...fail,status:'incomplete'}).status,'fail'));
test('a healthy matching pass to fail demonstrates detection',()=>assert.equal(evaluateProof(target,pass,fail).status,'pass'));

test('a matching target failing for another reason cannot demonstrate detection',()=>assert.equal(evaluateProof(target,pass,{...fail,failureCode:'connection-lost'}).status,'fail'));

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { copyImplementation, applyMutation, mutations } from './mutations.mjs';
const temporary = t => {const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mutation-test-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const write = (root,file,value) => {const dest=path.join(root,file);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,value);};
test('disposable copy excludes metadata, ROMs, ignored archives and submodule directories', t=>{
 const root=temporary(t),copy=path.join(temporary(t),'copy');
 for(const file of ['config.json','tools/arcade-timeline/mutations.mjs','web_client/src/component.svelte','server/main.go','web_client/public/pacman.zip','server/game.rom'])write(root,file,'test');
 for(const dir of ['web_client','tools/arcade-timeline'])fs.mkdirSync(path.join(root,dir,'node_modules'),{recursive:true});
 execFileSync('git',['init','-q'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});
 fs.mkdirSync(path.join(root,'submodule'));execFileSync('git',['update-index','--add','--cacheinfo','160000,1111111111111111111111111111111111111111,submodule'],{cwd:root});
 write(root,'server/ignored-cache.bin','do not copy');write(root,'.local-assets/sprites/source.png','do not copy');
 const inventory=copyImplementation(root,copy);
 assert.deepEqual(inventory.sort(),['config.json','server/main.go','tools/arcade-timeline/mutations.mjs','web_client/src/component.svelte']);
 for(const name of ['.git','.local-assets','submodule','server/ignored-cache.bin','server/game.rom','web_client/public/pacman.zip'])assert.equal(fs.existsSync(path.join(copy,name)),false,name);
 assert.equal(fs.readFileSync(path.join(copy,'server/main.go'),'utf8'),'test');
 assert.equal(fs.realpathSync(path.join(copy,'web_client/node_modules')),fs.realpathSync(path.join(root,'web_client/node_modules')));
});
test('each named mutation changes only its declared disposable file',t=>{
 const root=temporary(t),png=new PNG({width:1,height:1});
 for(const mutation of mutations){
  const original=mutation.name==='opaque-black-backgrounds'?PNG.sync.write(png):mutation.from??'export const catalog = {};';
  write(root,mutation.file,original);const before=fs.readFileSync(path.join(root,mutation.file));
  const patch=applyMutation(root,mutation);assert.notEqual(patch.before,patch.after,mutation.name);assert.notDeepEqual(fs.readFileSync(path.join(root,mutation.file)),before);
 }
 const changed=PNG.sync.read(fs.readFileSync(path.join(root,'web_client/public/sprites/atlas.png')));assert.deepEqual([...changed.data],[0,0,0,255]);
});
test('source mutations reject absent or ambiguous edits',t=>{
 const root=temporary(t),mutation=mutations[0];
 for(const text of ['different source',mutation.from+' '+mutation.from]){write(root,mutation.file,text);assert.throws(()=>applyMutation(root,mutation),/exactly once/);assert.equal(fs.readFileSync(path.join(root,mutation.file),'utf8'),text);}
});

import { evaluateBotDeathProbe } from './mutations.mjs';
const botTrace = (death = true) => ({
 events:[{type:'driver',name:'race-action',command:'resume_game',at:25,epoch:0}],deadline:65,endAt:95,endRaf:9,epochs:[{epoch:0,firstRaf:1,lastRaf:9}],errors:[],
 rows:Array.from({length:9},(_,i)=>({id:`r${i+1}`,raf:i+1,at:(i+1)*10,epoch:0,render:{frame:death&&i>=3&&i<=5?`death-${i-3}`:'pacman-left-2'}})),
});
const retainedBot = name => {
 const data=JSON.parse(fs.readFileSync(new URL('./evidence/bot-death-mutation-observations.json',import.meta.url)))[name];
 return {...data,rows:data.rows.map(([id,raf,at,epoch,frame])=>({id,raf,at,epoch,render:{frame}}))};
};
test('complete bot observation distinguishes visible death from actual cancellation',()=>{
 assert.equal(evaluateBotDeathProbe(botTrace()).status,'pass');assert.equal(evaluateBotDeathProbe(botTrace(false)).status,'fail');
});
for(const [label,raf] of [['interior callback',5],['last pre-action callback',2],['first post-action callback',3],['last pre-deadline callback',6],['first post-deadline callback',7],['final observed callback',9]])test(`missing ${label} makes bot cancellation incomplete`,()=>{
 const trace=botTrace(false);trace.rows=trace.rows.filter(r=>r.raf!==raf);assert.equal(evaluateBotDeathProbe(trace).status,'incomplete');
});
test('deleted death observations cannot masquerade as a detected cancellation',()=>{
 const baseline=evaluateBotDeathProbe(botTrace()),trace=botTrace();trace.rows=trace.rows.filter(r=>!r.render.frame.startsWith('death-'));
 const result=evaluateBotDeathProbe(trace);assert.equal(result.status,'incomplete');assert.equal(evaluateProof('bot-death-art',baseline,{...result,failureCode:'death-art-cancelled'}).status,'fail');
});
test('missing bot action bracket or independent final callback cannot complete the interval',()=>{
 for(const edit of [t=>{t.rows=t.rows.filter(r=>r.at>=25);},t=>{delete t.endRaf;},t=>{t.epochs=[];},t=>{t.rows=t.rows.filter(r=>r.at<65);}]){const trace=botTrace(false);edit(trace);assert.equal(evaluateBotDeathProbe(trace).status,'incomplete');}
});
test('actual retained bot baseline and production mutant remain valid; removed death interval is incomplete',()=>{
 const baseline=retainedBot('baseline'),mutated=retainedBot('mutated');assert.equal(evaluateBotDeathProbe(baseline).status,'pass');assert.equal(evaluateBotDeathProbe(mutated).status,'fail');
 const removed=baseline.rows.filter(r=>r.render.frame?.startsWith('death-'));assert.equal(removed.length,97);
 baseline.rows=baseline.rows.filter(r=>!r.render.frame?.startsWith('death-'));const result=evaluateBotDeathProbe(baseline);assert.equal(result.status,'incomplete');assert.equal(evaluateProof('bot-death-art',evaluateBotDeathProbe(retainedBot('baseline')),{...result,failureCode:'death-art-cancelled'}).status,'fail');
});

const structuralTarget = 'structural-atlas-padding';
const structuralPass = { target: structuralTarget, category: 'STRUCTURAL/ARTWORK', status: 'pass', errors: [] };
const structuralFail = { ...structuralPass, status: 'fail', failureCode: 'structural-atlas-padding-violation' };
test('structural padding proof accepts only its own healthy pass-to-fail evidence', () => {
 assert.equal(evaluateProof(structuralTarget, structuralPass, structuralFail).status, 'pass');
});
test('structural proof cannot relabel visual results, missing observations, or setup failures as detection', () => {
 for (const mutated of [structuralPass, {...structuralFail,target:'no-neighbor-sampling'}, {...structuralFail,failureCode:'neighbor-boundary-pixels'}, {...structuralFail,status:'incomplete'}, {...structuralFail,errors:['Missing PNG']}, {...structuralFail,category:'VISUAL'}]) {
  assert.equal(evaluateProof(structuralTarget,structuralPass,mutated).status,'fail');
 }
 assert.equal(evaluateProof(structuralTarget,structuralFail,structuralFail).status,'fail');
});

import { spawnSync } from 'node:child_process';
// Exercise the real CLI and actual catalog/PNGs in a small disposable git root.
// This catches a runner that ignores --only, changes the mutation, or exits zero
// for an invalid proof, without starting any browser or server.
test('gutter-only CLI proves actual structural removal and rejects unhealthy baselines or probe errors', t => {
 for (const scenario of ['healthy', 'already-removed', 'missing-asset']) {
  const root=fs.realpathSync(temporary(t)), out=path.join(fs.realpathSync(temporary(t)),'evidence');
  for(const file of ['tools/arcade-timeline/mutations.mjs','tools/arcade-timeline/atlas-padding.mjs','web_client/src/lib/sprites/catalog.js','web_client/package.json',...['atlas.png','general.png','text.png','life.png','punctuation.png'].map(n=>'web_client/public/sprites/'+n)]) {
   write(root,file,fs.readFileSync(new URL('../../'+file,import.meta.url)));
  }
  fs.symlinkSync(new URL('./node_modules',import.meta.url).pathname,path.join(root,'tools/arcade-timeline/node_modules'),'dir');
  fs.mkdirSync(path.join(root,'web_client/node_modules'));
  if(scenario==='already-removed')applyMutation(root,mutations.find(m=>m.name==='remove-atlas-gutters'));
  if(scenario==='missing-asset')fs.appendFileSync(path.join(root,'web_client/src/lib/sprites/catalog.js'),"\nObject.values(catalog).forEach(frame=>{frame.render.asset='missing.png';});\n");
  execFileSync('git',['init','-q'],{cwd:root});
  execFileSync('git',['add','tools/arcade-timeline/mutations.mjs','tools/arcade-timeline/atlas-padding.mjs','web_client/src','web_client/public','web_client/package.json'],{cwd:root});
  const child=spawnSync(process.execPath,['tools/arcade-timeline/mutations.mjs','--out',out,'--only','remove-atlas-gutters'],{cwd:root,encoding:'utf8'});
  assert.equal(child.status,scenario==='healthy'?0:1,child.stderr + fs.readFileSync(path.join(out,'summary.json'),'utf8'));
  const summary=JSON.parse(fs.readFileSync(path.join(out,'summary.json'),'utf8'));
  assert.equal(summary.unchanged,true); assert.deepEqual(summary.selected,['remove-atlas-gutters']);
  const result=summary.results[0];
  assert.equal(result.category,'STRUCTURAL/ARTWORK');
  assert.equal(result.baseline.status,scenario==='healthy'?'pass':scenario==='already-removed'?'fail':'incomplete');
  assert.equal(result.mutated.status,'fail');
  assert.equal(result.mutated.failureCode,'structural-atlas-padding-violation');
  assert.equal(summary.passed,scenario==='healthy');
  assert.ok(result.mutated.counts.nontransparentPixels>0);
  assert.ok(result.mutated.counts.outOfBoundsPixels>0);
  assert.equal(fs.existsSync(path.join(out,'copies')),false);
 }
});
