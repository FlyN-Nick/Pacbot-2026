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
