import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createCleanup} from './processes.mjs';
const subject=import('./simulation-run.mjs').catch(()=>({}));
const isolated={ServerIP:'localhost',BotIP:'localhost',WebSocketPort:43111,TcpPort:43112,BotSocketPort:43113};
const tmp=()=>fs.mkdtempSync(path.join(os.tmpdir(),'simulation-test-'));

test('simulation rejects absent, default, remote and shared ports before creating connections',async()=>{
 const m=await subject;assert.equal(typeof m.prepareSimulation,'function');
 for(const config of [undefined,{}, {...isolated,WebSocketPort:3002},{...isolated,BotSocketPort:3003},{...isolated,TcpPort:3004},{...isolated,ServerIP:'example.com'},{...isolated,BotSocketPort:43111}]) {
  const dir=tmp();try{assert.throws(()=>m.prepareSimulation({gameConfig:config,tmp:dir}),/isolat|port|loopback/i);}finally{fs.rmSync(dir,{recursive:true,force:true});}
 }
});
test('Python cwd uses separate config and immutable source copies with auto-resume enabled',async()=>{
 const m=await subject;assert.equal(typeof m.prepareSimulation,'function');const dir=tmp();
 const original=fs.readFileSync(new URL('../../config.json',import.meta.url));
 try{const e=m.prepareSimulation({gameConfig:isolated,tmp:dir});assert.deepEqual(JSON.parse(fs.readFileSync(path.resolve(e.cwd,'../config.json'))),isolated);
 assert.ok(path.isAbsolute(e.script));assert.ok(e.script.endsWith('pacbotClient.py'));
 for(const name of ['distTable.json','dtDict.json'])assert.ok(fs.statSync(path.join(e.cwd,'static',name)).isFile());
 assert.ok(e.args.includes('--force_no_bot'));assert.equal(e.args[e.args.indexOf('--games')+1],'-1');
 assert.deepEqual(fs.readFileSync(new URL('../../config.json',import.meta.url)),original);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('missing bot executable and early successful exit are unavailable, with retained output',async()=>{
 const m=await subject;assert.equal(typeof m.startSimulationBot,'function');const dir=tmp();const cleanup=createCleanup();
 try{const e=m.prepareSimulation({gameConfig:isolated,tmp:dir});await assert.rejects(m.startSimulationBot({environment:e,python:'/missing/python',outDir:dir,timeoutMs:200},cleanup),/unavailable/);
 fs.writeFileSync(path.join(dir,'exit.cjs'),'console.log("connection refused");');
 await assert.rejects(m.startSimulationBot({environment:{...e,script:path.join(dir,'exit.cjs'),args:[]},python:process.execPath,outDir:dir,timeoutMs:2000},cleanup),/unavailable.*exit/i);
 assert.match(fs.readFileSync(path.join(dir,'bot.log'),'utf8'),/connection refused/);
 }finally{await cleanup.run();fs.rmSync(dir,{recursive:true,force:true});}
});
test('startup timeout tears down bot and descendant process group',async()=>{
 const m=await subject;assert.equal(typeof m.startSimulationBot,'function');const dir=tmp(),cleanup=createCleanup();
 const script=path.join(dir,'hang.cjs');fs.writeFileSync(script,`const {spawn}=require('node:child_process');const fs=require('node:fs');const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);fs.writeFileSync(${JSON.stringify(path.join(dir,'pids.json'))},JSON.stringify([process.pid,child.pid]));setInterval(()=>{},1000);`);
 try{await assert.rejects(m.startSimulationBot({environment:{cwd:dir,script,args:[]},python:process.execPath,outDir:dir,timeoutMs:300},cleanup),/unavailable.*timeout/i);
 await cleanup.run();for(const pid of JSON.parse(fs.readFileSync(path.join(dir,'pids.json'))))assert.throws(()=>process.kill(pid,0),/ESRCH/);
 }finally{await cleanup.run();fs.rmSync(dir,{recursive:true,force:true});}
});
test('elapsed time without actual connection and collision cannot pass simulation coverage',async()=>{
 const m=await subject;assert.equal(typeof m.evaluateSimulationTrace,'function');const result=m.evaluateSimulationTrace({mode:'arcade',rows:[],events:[],isolated:true,cleanup:true});
 assert.notEqual(result.status,'pass');assert.equal(result.checkpoints.find(c=>c.id==='natural-life-loss').status,'incomplete');
 const failed=m.evaluateSimulationTrace({mode:'arcade',rows:[],events:[],failure:'bot exited',isolated:true,cleanup:true});assert.equal(failed.status,'unavailable');
});

test('isolated game server honors explicitly supplied game and TCP endpoints',async()=>{
 const {startGameServer}=await import('./run.mjs'),{freePort}=await import('./processes.mjs');
 const dir=tmp(),cleanup=createCleanup();const config={...isolated,WebSocketPort:await freePort(),TcpPort:await freePort(),BotSocketPort:await freePort()};
 try{const port=await startGameServer(dir,cleanup,config);assert.equal(port,config.WebSocketPort);const actual=JSON.parse(fs.readFileSync(path.join(dir,'config.json')));assert.equal(actual.TcpPort,config.TcpPort);assert.equal(actual.BotSocketPort,config.BotSocketPort);}
 finally{await cleanup.run();fs.rmSync(dir,{recursive:true,force:true});}
});

test('connection label alone cannot prove the Python bot received or progressed game state',async()=>{
 const m=await subject;const result=m.evaluateSimulationTrace({mode:'arcade',rows:[],events:[{at:0,type:'driver',name:'bot-connected'}],isolated:true,cleanup:true});
 assert.notEqual(result.checkpoints.find(c=>c.id==='bot-connected').status,'pass');
});

test('a partial death animation cannot satisfy death-position preservation',async()=>{
 const m=await subject;const trace={mode:'arcade',isolated:true,cleanup:true,events:[{type:'driver',name:'bot-connected',at:0},{type:'collision',at:10,previous:{pacman:{rowState:11,colState:9}},received:{lives:2}}],rows:[{id:'r1',raf:1,at:11,server:{tick:3,lives:2},presentation:{kind:'death',dying:true},render:{frame:'death-0',x:76,y:92}}]};
 const result=m.evaluateSimulationTrace(trace);assert.equal(result.checkpoints.find(c=>c.id==='death-position-preserved').status,'incomplete');
});

test('cleanup check detects a still-listening child endpoint and an open browser',async()=>{
 const m=await subject;assert.equal(typeof m.verifySimulationCleanup,'function');const net=await import('node:net');const server=net.createServer(socket=>socket.end());
 await new Promise(resolve=>server.listen(0,resolve));
 try{const result=await m.verifySimulationCleanup({ports:[server.address().port],bot:{stopped:true},browser:{isConnected:()=>true}});assert.equal(result.stopped,false);assert.equal(result.ports[0].closed,false);assert.equal(result.browserClosed,false);}
 finally{await new Promise(resolve=>server.close(resolve));}
});

test('startup rejection retains the child handle so timeout cleanup cannot be assumed',async()=>{
 const m=await subject,dir=tmp(),cleanup=createCleanup();fs.writeFileSync(path.join(dir,'exit.cjs'),'process.exit(0)');let failure;
 try{await m.startSimulationBot({environment:{cwd:dir,script:path.join(dir,'exit.cjs'),args:[]},python:process.execPath,outDir:dir},cleanup);}catch(error){failure=error;}
 try{assert.ok(failure?.botState,'failed startup must retain child cleanup state');assert.equal(failure.botState.stopped,false);await cleanup.run();assert.equal(failure.botState.stopped,true);}
 finally{await cleanup.run();fs.rmSync(dir,{recursive:true,force:true});}
});

test('refused real bot socket is unavailable and its cleanup remains registered',async()=>{
 const m=await subject;assert.equal(typeof m.openBotSocket,'function');const {freePort}=await import('./processes.mjs');const cleanup=createCleanup();
 try{await assert.rejects(m.openBotSocket(await freePort(),cleanup),/unavailable.*connection/i);}finally{await cleanup.run();}
});

function completeNaturalDeath() {
 const rows=[];
 const add=(at,frame='pacman-left-2',kind='death',tick=0,x=76,y=92)=>rows.push({id:`r${rows.length}`,raf:rows.length+1,at,server:{mode:tick?1:0,tick,lives:at<15?3:2},presentation:{kind,dying:kind==='death'},render:{frame,x,y,ready:at===190}});
 for(const at of [0,10,20,30,40])add(at);
 add(50,'pacman-up-0');for(let i=0;i<11;i++)add(60+i*10,`death-${i}`);
 add(170,'blank');add(180,'blank');add(190,'pacman-left-2',null,1,108,188);add(200,'pacman-left-1',null,2,100,188);add(210,'pacman-left-0',null,3,92,188);
 return {mode:'arcade',isolated:true,cleanup:true,rows,events:[{type:'driver',name:'bot-connected',at:5},{type:'collision',at:15,previous:{pacman:{rowState:11,colState:9}},received:{lives:2}},{type:'command',at:185,command:'P',source:'sequence:death'}]};
}
test('natural death preservation covers the pre-collision callback through blank',async()=>{
 const m=await subject;assert.equal(m.evaluateSimulationTrace(completeNaturalDeath()).status,'pass');
});
for(const [boundary,at] of [['pre-collision',10],['first caught',20],['interior caught',30],['last caught',40],['first blank',170]])test(`natural death preservation rejects missing ${boundary} callback`,async()=>{
 const m=await subject,t=completeNaturalDeath();t.rows=t.rows.filter(r=>r.at!==at);
 assert.equal(m.evaluateSimulationTrace(t).checkpoints.find(c=>c.id==='death-position-preserved').status,'incomplete');
});
