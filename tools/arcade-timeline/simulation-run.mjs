// Actual Python simulation in an isolated cwd; no changes to Python CLI defaults.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
import {createCleanup,freePort} from './processes.mjs';
import {launchBrowser,startGameServer,startVisualizer} from './run.mjs';
import {requiredChecks} from './sequence-coverage.mjs';
import {evaluateLiveTrace} from './live-sequences.mjs';
import {planSequence} from '../../web_client/src/lib/arcadeSequencer.js';
import {GUI_TIMINGS} from '../../web_client/src/lib/guiTimings.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function prepareSimulation({gameConfig,tmp}) {
 const defaults=JSON.parse(fs.readFileSync(path.join(repo,'config.json')));
 const ports=['WebSocketPort','TcpPort','BotSocketPort'].map(key=>gameConfig?.[key]);
 const forbidden=['WebSocketPort','TcpPort','BotSocketPort'].map(key=>defaults[key]);
 if(ports.some(port=>!Number.isInteger(port)||port<1024||port>65535||forbidden.includes(port))||new Set(ports).size!==3)throw Error('Explicit isolated non-default ports required');
 if(!['localhost','127.0.0.1','::1'].includes(gameConfig.ServerIP)||!['localhost','127.0.0.1','::1'].includes(gameConfig.BotIP))throw Error('Simulation requires loopback hosts');
 fs.mkdirSync(tmp,{recursive:true});write(path.join(tmp,'config.json'),gameConfig);
 const cwd=path.join(tmp,'bot');fs.mkdirSync(path.join(cwd,'static'),{recursive:true});
 for(const name of ['distTable.json','dtDict.json'])fs.copyFileSync(path.join(repo,'bot_client/static',name),path.join(cwd,'static',name));
 return {cwd,script:path.join(repo,'bot_client/pacbotClient.py'),args:['--force_no_bot','--strategy','astar','--games','-1']};
}

/** Keep output from spawn onwards, and kill the entire group even if its leader
 * exits before cleanup. Startup and later exits are both unavailable evidence. */
export async function startSimulationBot({environment,python=path.join(repo,'bot_client/.venv/bin/python3.14'),outDir,timeoutMs=15000},cleanup) {
 const log=path.join(outDir,'bot.log');fs.writeFileSync(log,'');
 const child=spawn(python,[environment.script,...environment.args],{cwd:environment.cwd,env:{...process.env,PYTHONUNBUFFERED:'1'},detached:true,stdio:['ignore','pipe','pipe']});
 const state={child,pid:child.pid,exit:null,error:null,stopped:false};
 cleanup.add(async()=>{
  if(!child.pid){state.stopped=true;return;}
  const kill=signal=>{try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
  kill('SIGTERM');
  for(let i=0;i<40;i++){try{process.kill(-child.pid,0);}catch{state.stopped=true;return;}await sleep(50);}
  kill('SIGKILL');
  for(let i=0;i<40;i++){try{process.kill(-child.pid,0);}catch{state.stopped=true;return;}await sleep(50);}
 });
 let output='';
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>fail('bot startup timeout'),timeoutMs);
  const fail=message=>{clearTimeout(timer);const error=Error(`Simulation unavailable: ${message}`);error.botState=state;reject(error);};
  child.once('error',error=>{state.error=error.message;fail(error.message);});
  child.once('exit',(code,signal)=>{state.exit={code,signal};fail(`bot exit ${code??signal}`);});
  const data=chunk=>{const value=chunk.toString();fs.appendFileSync(log,value);output+=value;if(/Server started on port/.test(output)){clearTimeout(timer);resolve();}};
  child.stdout.on('data',data);child.stderr.on('data',data);
 });
 return state;
}

/** Production plan durations are used ONLY as watchdog bounds, never as an
 * expected visual state. Competition death has a separate animation timer. */
export function sequenceDeadline(event) {
 if(!event)return 0;
 const plan=planSequence({...event,timings:GUI_TIMINGS});
 return event.at+Math.max(0,...plan.map(s=>s.atMs),event.kind==='death'?GUI_TIMINGS.deathAnimationMs:0)+1500;
}

export function evaluateSimulationTrace(trace) {
 const definition=requiredChecks('full').find(c=>c.scenario==='real-bot-natural-life-loss'&&c.mode===trace.mode);
 const checks=new Map(),rows=trace.rows??[],events=trace.events??[];
 const put=(id,status,reason,selected=[])=>checks.set(id,{id,status,reason,observationIds:selected.map(r=>r.id)});
 put('isolated-start',trace.isolated?'pass':'unavailable','Explicit temporary loopback config with non-default game, TCP and bot ports.');
 const connected=events.find(e=>e.type==='driver'&&e.name==='bot-connected');
 put('bot-connected',connected&&new Set(rows.filter(r=>r.at>connected.at).map(r=>r.server?.tick)).size>1?'pass':'incomplete','Actual Python debug-channel connection and received server progression required.');
 const collision=events.find(e=>e.type==='collision');
 if(collision&&connected&&collision.at>connected.at)put('natural-life-loss','pass','Received life loss during unmodified AStar simulation; no driver movement or kill commands.',rows.filter(r=>r.at>=collision.at).slice(0,2));
 const death=evaluateLiveTrace(trace,{mode:trace.mode}).find(c=>c.scenario==='death-respawn');
 const position=death.checkpoints.find(c=>c.id==='captured-death-position');
 if(collision&&death.checkpoints.find(c=>c.id==='death-art-transitions').status==='pass'&&position.status!=='incomplete')put('death-position-preserved',position.status,position.reason,rows.filter(r=>position.observationIds.includes(r.id)));
 const after=rows.filter(r=>collision&&r.at>collision.at&&r.server?.lives===collision.received.lives);
 const complete=after.find(r=>!r.presentation?.dying&&!r.presentation?.kind&&r.server?.mode!==0&&r.render.frame&&r.render.frame!=='blank');
 const progression=complete&&after.filter(r=>r.at>=complete.at);
 if(progression?.length>1&&new Set(progression.map(r=>r.server.tick)).size>1) {
  const cmds=events.filter(e=>e.type==='command'&&e.at>=collision.at);
  const policy=trace.mode==='arcade'?cmds.some(e=>e.command==='P'&&e.source==='sequence:death'):cmds.some(e=>e.command==='P'&&e.source==='bot')&&!cmds.some(e=>e.source?.startsWith('sequence:')&&['p','P'].includes(e.command));
  put('continuation-policy',policy?'pass':'fail','Observed post-death server progression; arcade release belongs to sequence, competition to bot.',progression);
 }
 put('cleanup',trace.cleanup?'pass':'fail','Bot process group, browser, isolated server and preview stopped.');
 const checkpoints=definition.checkpoints.map(c=>checks.get(c.id)??{id:c.id,status:'incomplete',reason:'Required transition not observed before bounded watchdog.',observationIds:[]});
 const status=trace.failure?'unavailable':checkpoints.some(c=>c.status==='fail')?'fail':checkpoints.every(c=>c.status==='pass')?'pass':'incomplete';
 return {checkId:definition.id,category:'live',scenario:definition.scenario,mode:trace.mode,status,checkpoints,...(trace.failure?{errors:[trace.failure]}:{})};
}

export async function verifySimulationCleanup({ports=[],bot,browser}) {
 const endpoints=await Promise.all(ports.map(port=>new Promise(resolve=>{
  const socket=net.createConnection({port,host:'localhost'});
  const finish=closed=>{socket.destroy();resolve({port,closed});};
  socket.once('connect',()=>finish(false));
  socket.once('error',error=>finish(error.code==='ECONNREFUSED'));
  socket.setTimeout(1000,()=>finish(false));
 })));
 const botStopped=!bot||bot.stopped,browserClosed=!browser||!browser.isConnected();
 return {stopped:botStopped&&browserClosed&&endpoints.every(p=>p.closed),botStopped,browserClosed,ports:endpoints};
}

export function openBotSocket(port,cleanup) {
 const socket=new WebSocket(`ws://localhost:${port}`);
 cleanup.add(()=>socket.close());
 return new Promise((resolve,reject)=>{
  socket.addEventListener('open',()=>resolve(socket),{once:true});
  socket.addEventListener('error',()=>reject(Error('Simulation unavailable: bot debug connection failed')),{once:true});
 });
}

async function simulationMode({mode,gameConfig,outDir,durationMs}) {
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'real-bot-')),cleanup=createCleanup();
 cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 fs.mkdirSync(outDir,{recursive:true});let page,bot,browser,port,trace={mode,rows:[],events:[],isolated:false,cleanup:false},bridge,bridgeFailure;
 const stop=async()=>{await cleanup.run();process.exit(130);};for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
 try {
  const ws=await startGameServer(tmp,cleanup,gameConfig);
  const config={...JSON.parse(fs.readFileSync(path.join(tmp,'config.json'))),ServerIP:'localhost',BotIP:'localhost',WebSocketPort:ws};
  config.BotSocketPort=gameConfig?.BotSocketPort??await freePort();
  const environment=prepareSimulation({gameConfig:config,tmp});trace.isolated=true;trace.config=config;trace.invocation={script:environment.script,args:environment.args,cwd:environment.cwd};
  bot=await startSimulationBot({environment,outDir},cleanup);
  port=await startVisualizer(tmp,cleanup);browser=await launchBrowser();cleanup.add(()=>browser.close());
  page=await browser.newPage({viewport:{width:224,height:352}});
  // The browser's configured bot URL is intercepted before any connection can
  // reach it. Only a fresh loopback Python debug socket is opened by this bridge.
  const original=JSON.parse(fs.readFileSync(path.join(repo,'config.json')));
  await page.routeWebSocket(`ws://${original.BotIP}:${original.BotSocketPort}/`,async route=>{
   try {bridge=await openBotSocket(config.BotSocketPort,cleanup);}catch(error){bridgeFailure=error;return;}
   route.onMessage(data=>bridge.readyState===WebSocket.OPEN&&bridge.send(data));
   bridge.addEventListener('message',e=>{
    route.send(typeof e.data==='string'?e.data:Buffer.from(e.data));
    if(typeof e.data==='string'&&/^(resume_game|reset_game|pause_game)$/.test(e.data))page.evaluate(command=>window.__arcadeLive?.mark('python-bot-command',{command,source:'python debug socket'}),e.data).catch(()=>{});
   });
  });
  await page.goto(`http://localhost:${port}/?timeline=1&observe=1&mode=${mode}&ws=${ws}`);
  await page.waitForFunction(()=>window.__arcadeLive?.latest()?.server,null,{timeout:10000});
  for(let i=0;i<100&&!bridgeFailure&&bridge?.readyState!==WebSocket.OPEN;i++)await sleep(25);
  if(bridgeFailure)throw bridgeFailure;
  if(bridge?.readyState!==WebSocket.OPEN)throw Error('Bot channel connection unavailable');
  await page.evaluate(()=>window.__arcadeLive.mark('bot-connected'));
  await page.getByRole('button',{name:'Unmute game audio'}).click();
  await page.getByRole('button',{name:'Start / pause',exact:true}).click();
  const end=Date.now()+durationMs;let transitionEnd=end,continued=null;
  while(Date.now()<transitionEnd) {
   if(bot.exit||bot.error)throw Error(`Bot exited or disconnected: ${JSON.stringify(bot.exit??bot.error)}`);
   if(bridge.readyState!==WebSocket.OPEN)throw Error('Bot debug connection closed');
   // Avoid transferring the growing trace on every poll: that stalls the page
   // and can skip selected artwork. The complete trace is retrieved in finally.
   const sample=await page.evaluate(()=>({row:window.__arcadeLive.latest(),now:performance.now(),death:window.__arcadePauseTrace.events().findLast(e=>e.type==='sequenceStarted'&&e.kind==='death')}));
   if(sample.death) {
    transitionEnd=Math.min(end+10000,Date.now()+Math.max(0,sequenceDeadline(sample.death)-sample.now));
    const row=sample.row;
    if(row?.server?.lives<3&&row.server.mode!==0&&!row.presentation.kind&&!row.presentation.dying&&row.render.frame&&row.render.frame!=='blank') {
     continued??={tick:row.server.tick,at:sample.now};
     if(row.server.tick!==continued.tick&&sample.now-continued.at>=300)break;
    }
   }
   await page.waitForTimeout(100);
  }
  await page.locator('[data-arcade-screen]').screenshot({path:path.join(outDir,'final.png')});
 }catch(error){bot??=error.botState;trace.failure=error.message;}
 finally {
  if(page)try{trace={...trace,...await page.evaluate(()=>window.__arcadeLive.snapshot()),pauseTrace:await page.evaluate(()=>window.__arcadePauseTrace.events())};}catch{}
  await cleanup.run();
  trace.cleanupEvidence=await verifySimulationCleanup({bot,browser,ports:[trace.config?.WebSocketPort,trace.config?.TcpPort,trace.config?.BotSocketPort,port].filter(Boolean)});
  trace.cleanup=trace.cleanupEvidence.stopped;
  for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);
  trace.provenance={python:'Actual pacbotClient.py AStar --force_no_bot --games -1',driverMovement:false,fixtures:false,frameOverrides:false,excludedRegions:[],watchdog:'Natural-loss duration plus active production sequence deadline; time alone supplies no checkpoint'};
  write(path.join(outDir,'trace.json'),trace);
 }
 const result=evaluateSimulationTrace(trace);result.artifacts={trace:path.join(outDir,'trace.json'),botLog:path.join(outDir,'bot.log')};write(path.join(outDir,'checks.json'),[result]);return result;
}

export async function runSimulation({gameConfig,outDir='/tmp/pacman-simulation',durationMs=120000,mode='both'}={}) {
 if(!Number.isFinite(durationMs)||durationMs<=0)throw Error('Positive simulation duration required');
 if(!['arcade','competition','both'].includes(mode))throw Error('Unknown simulation mode');
 // Validate caller-supplied endpoints before starting any subprocess.
 if(gameConfig){const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'simulation-config-'));try{prepareSimulation({gameConfig,tmp});}finally{fs.rmSync(tmp,{recursive:true,force:true});}}
 const checks=[];for(const selected of mode==='both'?['arcade','competition']:[mode])checks.push(await simulationMode({mode:selected,gameConfig,outDir:path.resolve(outDir,selected),durationMs}));
 write(path.resolve(outDir,'index.json'),{version:2,kind:'live',checks});return checks;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 runSimulation({mode:arg('--mode','both'),outDir:arg('--out','/tmp/pacman-simulation'),durationMs:Number(arg('--duration-ms',120000))}).then(checks=>{for(const c of checks)console.log(`${c.status}: ${c.checkId} ${(c.errors??[]).join('; ')}`);if(checks.some(c=>c.status!=='pass'))process.exitCode=1;}).catch(error=>{console.error(error);process.exitCode=1;});
}
