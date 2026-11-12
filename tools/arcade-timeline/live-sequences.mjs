// Real server + production renderer initial-flow validation. No visual fixtures.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {PNG} from 'pngjs';
import {validateSequence} from './sequence-contract.mjs';
import {requiredChecks} from './sequence-coverage.mjs';
import {createCleanup} from './processes.mjs';
import {launchBrowser,startGameServer,startVisualizer,connectCommands} from './run.mjs';

// Independent expectations: native spawn center, closed mouth and observed
// artwork order. Do not import the selectors being tested or GUI timing plans.
const SPAWN={x:108,y:188};
const closed=r=>/^pacman-(left|right|up|down)-2$/.test(r?.render.frame??'');
const xy=r=>`${r?.render.x},${r?.render.y}`;
const spawn=r=>r?.render.x===SPAWN.x&&r?.render.y===SPAWN.y;
const visible=r=>r?.render.frame&&r.render.frame!=='blank';
const progressed=rows=>new Set(rows.map(r=>r.server?.tick)).size>1;
const moved=rows=>new Set(rows.filter(visible).map(xy)).size>1;
const compact=values=>values.filter((value,i)=>!i||value!==values[i-1]);
const completeStatus=checks=>checks.some(c=>c.status==='fail')?'fail':checks.every(c=>c.status==='pass')?'pass':'incomplete';
const ids=rows=>rows.map(r=>r.id);
const dense=rows=>rows.length>1&&rows.every((r,i)=>!i||r.raf===rows[i-1].raf+1);

/** Pure independent assertions over received/observed evidence. A check result
 * keeps the fixed inventory and each checkpoint, even on failure or timeout.
 * "all-observed" means every observer rAF callback in the bounded interval;
 * screenshots are asynchronous brackets, never claimed exact compositor IDs.
 */
export function evaluateLiveTrace(trace,{scope='initial',mode=trace.mode}={}) {
 const rows=trace.rows??[],events=trace.events??[];
 const start=events.find(e=>e.type==='driver'&&e.name==='start');
 const pursuit=events.find(e=>e.type==='driver'&&e.name==='pursuit');
 const collision=events.find(e=>e.type==='collision');
 const waiting=rows.filter(r=>r.server&&start&&r.at<start.at);
 const initial=rows.filter(r=>start&&r.at>=start.at&&r.at<(pursuit?.at??collision?.at??Infinity));
 const death=rows.filter(r=>collision&&r.at>=collision.at);
 const commands=(from,to=Infinity)=>events.filter(e=>e.type==='command'&&e.at>=from&&e.at<to);
 // Neighboring callbacks make a missing first/last hold observation detectable,
 // as well as interior gaps. The released frame may legitimately move.
 const holdCoverage=(from,to)=>{
  const before=rows.findLast(r=>r.at<from),after=rows.find(r=>r.at>=to);
  return before&&after?[before,...rows.filter(r=>r.at>=from&&r.at<to),after]:[];
 };
 return requiredChecks(scope).filter(d=>d.category==='live'&&d.mode===mode).map(definition=>{
  const found=new Map();
  function put(id,status,reason,selected=[],policy) {found.set(id,{id,status,reason,observationIds:ids(selected),...(policy?{policy}:{})});}
  const verify=(id,condition,reason,selected,policy)=>put(id,condition?'pass':'fail',reason,selected,policy);
  const missing=(id,reason,selected=[])=>put(id,'incomplete',reason,selected);
  if(definition.scenario==='waiting-pose') {
   if(waiting.length)verify('waiting-visible',waiting.every(closed),'Waiting pose must be closed independently of READY.',waiting);
   if(start&&dense(waiting))verify('pose-continuity',waiting.every(closed)&&!moved(waiting),'Closed stationary waiting pose through the start boundary.',waiting);
   if(start&&waiting.length&&initial.length)verify('start-boundary',closed(waiting.at(-1))&&closed(initial[0]),'Waiting to initial READY has no open-to-closed snap.',[waiting.at(-1),initial[0]]);
  }
  if(definition.scenario==='ready-movement') {
   const ready=initial.filter(r=>r.render.ready);
   const origin=initial.find(visible);
   const firstMove=initial.find(r=>visible(r)&&origin&&xy(r)!==xy(origin));
   const stationary=ready.filter(r=>!firstMove||r.at<firstMove.at);
   if(ready.length)verify('ready-visible',stationary.every(closed),'Closed READY pose while waiting for movement; moving competition READY may chomp.',ready);
   if(firstMove)put('first-movement','pass','Rendered geometry moves after start.',[origin,firstMove]);
   if(mode==='arcade') {
    const release=commands(start?.at??Infinity,pursuit?.at).find(e=>e.command==='P'&&e.source?.startsWith('sequence:'));
    const held=initial.filter(r=>r.at<(release?.at??Infinity));
    if(!release)missing('before-release','No observed arcade hold release.',held);
    else {
     const coverage=holdCoverage(start.at,release.at);
     if(held.length<2||!dense(coverage))missing('before-release','Missing observer callbacks across arcade READY hold or its boundaries.',coverage);
     else verify('before-release',!moved(held)&&!progressed(held),'Arcade READY holds received ticks and painted position until its observed release.',coverage);
    }
   } else if(firstMove&&progressed(initial))verify('before-release',!commands(start.at,pursuit?.at).some(e=>['p','P'].includes(e.command)&&e.source?.startsWith('sequence:')),'Competition progresses without presentation hold/resume commands.',initial,'No arcade hold required; positive server progression required.');
   if(firstMove) {
    const lastMove=initial.findLast((r,i)=>i>0&&visible(r)&&visible(initial[i-1])&&xy(r)!==xy(initial[i-1]));
    const moving=initial.filter(r=>r.at>=firstMove.at&&r.at<=(lastMove?.at??firstMove.at));
    const shapes=compact(moving.map(r=>r.render.frame?.match(/^pacman-\w+-(\d)$/)?.[1]).filter(x=>x!==undefined)).join(',');
    const cycle=['0,1,2,1,0','1,2,1,0,1','2,1,0,1,2','1,0,1,2,1'].some(pattern=>shapes.includes(pattern));
    if(!dense(moving))missing('mouth-cycle','Missing observer callbacks in mouth-cycle interval.',moving);
    else verify('mouth-cycle',cycle,'Observed full closed/open/closed mouth cycle during movement, including moving READY.',moving);
   }
   if(initial.length)verify('intro-audio-start',events.some(e=>e.type==='audio-start'&&e.name==='intro'&&e.at>=start.at&&e.at<(pursuit?.at??Infinity)),'An actual intro audio source started.',initial.slice(0,1));
   if(commands(start?.at??Infinity,pursuit?.at).length)put('command-origin','pass','Start and presentation commands retain their source.',initial.slice(0,1));
  }
  if(definition.scenario==='death-respawn'&&collision) {
   const catchRow=rows.filter(r=>r.at<collision.at&&visible(r)).at(-1);
   if(death.length)put('death-catch','pass','Natural server life loss received; exact collision coordinate unavailable on wire.',[catchRow,death[0]].filter(Boolean));
   const deathStart=death.find(r=>r.render.frame==='pacman-up-0'||r.render.frame?.startsWith('death-'));
   const artwork=death.filter(r=>r.render.frame?.startsWith('death-'));
   const blank=death.find(r=>r.render.frame==='blank');
   const hold=death.filter(r=>r.at<(deathStart?.at??Infinity));
   if(mode==='arcade'&&deathStart) {
    const coverage=holdCoverage(collision.at,deathStart.at);
    if(hold.length<2||!dense(coverage))missing('initial-hold','Missing observer callbacks across initial death hold or its boundaries.',coverage);
    else verify('initial-hold',!moved(hold),'Caught artwork remains stationary during arcade initial freeze.',coverage);
   }
   if(mode==='competition'&&progressed(death))verify('initial-hold',!commands(collision.at).some(e=>['p','P'].includes(e.command)&&e.source?.startsWith('sequence:')),'Competition has no presentation hold; observed server ticks progress.',death,'Server-owned death pause allowed; resumption must originate from driver/user, not presentation.');
   if(blank)put('blank','pass','Blank artwork actually observed after death animation.',[blank]);
   const animation=death.filter(r=>deathStart&&blank&&r.at>=deathStart.at&&r.at<=blank.at);
   const expected=Array.from({length:11},(_,i)=>`death-${i}`);
   const order=compact(artwork.map(r=>r.render.frame));
   if(deathStart?.render.frame==='pacman-up-0'&&blank&&dense(animation)&&expected.every(frame=>order.includes(frame)))verify('death-art-transitions',order.join(',')===expected.join(','),'Every death artwork transition observed in order through blank.',animation);
   else missing('death-art-transitions','Missing initial/death artwork/blank boundary or observer callbacks.',animation);
   const next=death.find(r=>spawn(r)&&closed(r)&&(mode==='competition'||r.render.ready));
   if(next)put('next-life-ready','pass','Next life observed at independent spawn center with closed pose.',[next],mode==='competition'?'Next life available; READY label is not required.':'Visible next-life READY required.');
   const nextMove=next&&death.find(r=>r.at>next.at&&visible(r)&&!spawn(r)&&!r.render.frame.startsWith('death-'));
   if(nextMove)put('first-movement','pass','Next-life rendered geometry leaves spawn.',[next,nextMove]);
   if(mode==='arcade'&&next&&!commands(collision.at).some(e=>e.command==='P'&&e.source==='sequence:death'))missing('first-movement','Arcade next-life hold lacks its observed release.',[next]);
   const p=collision.previous?.pacman;
   const expectedPosition=p?{x:((p.colState&31)+.5)*8,y:((p.rowState&31)+.5)*8}:null;
   // Include the caught freeze and initial upward pose, not just numbered art.
   // Stop at blank so the legitimate next-life spawn is outside this interval.
   const positionRows=death.filter(r=>visible(r)&&r.at<=(blank?.at??artwork.at(-1)?.at));
   if(!expectedPosition||expectedPosition.x===SPAWN.x&&expectedPosition.y===SPAWN.y)missing('captured-death-position','Natural death must be demonstrably away from spawn.',positionRows);
   else if(positionRows.length)verify('captured-death-position',positionRows.every(r=>r.render.x===expectedPosition.x&&r.render.y===expectedPosition.y),'Every visible caught/death pose stays at the last received pre-loss position through blank (exact collision position unknown).',positionRows);
   if(death.length)verify('death-audio-start',events.some(e=>e.type==='audio-start'&&e.name==='death'&&e.at>=collision.at),'An actual death audio source started; scheduled events do not count.',death.slice(0,1));
   if(commands(0).length)put('command-origin','pass','Driver and presentation commands retained, including collision pursuit.',death.slice(0,1));
  }
  const checkpoints=definition.checkpoints.map(c=>found.get(c.id)??{id:c.id,status:'incomplete',reason:'Required checkpoint not observed.',observationIds:[]});
  return {checkId:definition.id,scenario:definition.scenario,category:'live',mode,status:completeStatus(checkpoints),checkpoints};
 });
}

/** Image evidence is an asynchronous bracket, not a substitute for dense DOM
 * observations. Missing checkpoints still point at the last available evidence.
 */
export function attachLiveEvidence(checks,trace,captures,tracePath) {
 const rows=new Map(trace.rows.map(r=>[r.id,r]));
 for(const check of checks)for(const checkpoint of check.checkpoints) {
  const selected=checkpoint.observationIds.map(id=>rows.get(id)).filter(Boolean);
  const first=selected[0]?.at??captures.at(-1)?.after.at;
  const last=selected.at(-1)?.at??first;
  const before=captures.findLast(c=>c.after.at<=first)??captures[0];
  const after=captures.find(c=>c.before.at>=last)??captures.at(-1);
  const middle=captures.find(c=>c.after.at>=(first+last)/2);
  const neighbors=[captures[captures.indexOf(before)+1],middle,captures[captures.indexOf(after)-1]].filter(Boolean);
  checkpoint.evidence={trace:tracePath,before:before?.image??null,after:after?.image??null,neighbors:[...new Set(neighbors.map(c=>c.image))],alignment:'Screenshots bracket asynchronous post-render DOM reads; rAF counters are not compositor IDs.'};
  if(!before||!after||!neighbors.length) {
   if(checkpoint.status==='pass')checkpoint.status='incomplete';
   checkpoint.reason+=' Screenshot evidence incomplete.';
  }
 }
 for(const check of checks)check.status=completeStatus(check.checkpoints);
 return checks;
}
/** v2 images retain both neighboring DOM reads. paintedFrame is explicitly
 * the after-read rAF counter, not an assertion of compositor/image identity. */
export function makeLiveManifest(check,captures,tracePath) {
 const samples=captures.filter(c=>c.before&&c.after).map(c=>{
  const state={before:c.before,after:c.after};
  return {id:c.id,event:check.scenario,offsetFrames:0,paintedFrame:c.after.raf,image:c.image,dimensions:c.dimensions,state,
   alignment:{method:'Asynchronous post-render DOM bracket; rAF counter, not exact compositor identity',paintedFrame:c.after.raf,state,evidence:[`${check.mode}/screenshots.json`,tracePath]}};
 });
 const manifest={version:2,kind:'live',scenario:check.scenario,provenance:{mode:check.mode,trace:tracePath,fixtures:false,frameOverrides:false,
  observationPolicy:'All-observed intervals require contiguous observer callbacks in trace; screenshots are asynchronous brackets.',
  checkpoints:Object.fromEntries(check.checkpoints.map(c=>[c.id,{status:c.status,observationIds:c.observationIds,policy:c.policy??null,evidence:c.evidence}]))},samples};
 validateSequence(manifest);
 return manifest;
}
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');

async function runMode({scope,mode,outDir}) {
 const cleanup=createCleanup(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'live-sequences-'));
 cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const stop=async()=>{await cleanup.run();process.exit(130);};
 for(const signal of ['SIGINT','SIGTERM'])process.on(signal,stop);
 fs.mkdirSync(path.join(outDir,mode),{recursive:true});
 const errors=[],captures=[],driverCommands=[];
 let page,capturing=false,captureLoop,trace={mode,rows:[],events:[]};
 try {
  const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup);
  const browser=await launchBrowser();cleanup.add(()=>browser.close());
  const send=await connectCommands(ws,cleanup);
  page=await browser.newPage({viewport:{width:224,height:352},deviceScaleFactor:1});
  page.on('pageerror',error=>errors.push(error.message));
  await page.goto(`http://localhost:${port}/?timeline=1&observe=1&mode=${mode}&ws=${ws}&bot=off`);
  await page.waitForFunction(()=>window.__arcadeLive?.latest()?.server,{},{timeout:10000});
  if(await page.evaluate(()=>typeof window.__arcadeVisual!=='undefined'))throw Error('Live run must not enable fixture API');
  const mark=(name,detail={})=>page.evaluate(({name,detail})=>window.__arcadeLive.mark(name,detail),{name,detail});
  const command=async(command,source='driver:movement')=>{
   const at=await page.evaluate(()=>performance.now());driverCommands.push({at,type:'command',command,source});send(command);
  };
  const screenshot=async()=>{
   const before=await page.evaluate(()=>window.__arcadeLive.latest());
   const image=`${mode}/screen-${String(captures.length).padStart(4,'0')}.png`;
   const bytes=await page.locator('[data-arcade-screen]').screenshot({path:path.join(outDir,image),timeout:5000});
   const {width,height}=PNG.sync.read(bytes);
   const after=await page.evaluate(()=>window.__arcadeLive.latest());
   captures.push({id:`screen-${captures.length}`,image,dimensions:{width,height},before,after});
  };
  capturing=true;
  captureLoop=(async()=>{while(capturing){try{await screenshot();}catch(error){errors.push(`Screenshot: ${error.message}`);break;}if(capturing)await page.waitForTimeout(90);}})();
  await page.getByRole('button',{name:'Unmute game audio'}).click();
  await page.evaluate(()=>document.activeElement?.blur());
  await page.waitForTimeout(450);
  await mark('start');
  await page.getByRole('button',{name:'Start / pause',exact:true}).click();
  await page.evaluate(()=>document.activeElement?.blur());
  await page.waitForFunction(()=>window.__arcadeLive.snapshot().rows.some(r=>r.render.ready),{},{timeout:10000});
  if(mode==='arcade')await page.waitForFunction(()=>window.__arcadeLive.snapshot().events.some(e=>e.type==='command'&&e.command==='P'&&e.source?.startsWith('sequence:')),{},{timeout:10000});
  // Small real direction commands move along the starting corridor. Competition
  // deliberately exercises moving READY during its intro, when no hold applies.
  for(let i=0;i<14;i++){await command(i<6?'a':'d');await page.waitForTimeout(90);}
  await page.waitForTimeout(200);
  await mark('pursuit',{method:'Real position updates towards Blinky; normal server collision, no kill command.'});
  await command('x'+String.fromCharCode(23,8),'driver:collision-pursuit');
  await page.waitForTimeout(120);
  for(let i=0;i<60;i++) {
   const state=await page.evaluate(()=>window.__arcadeTimeline.state());
   if(state.lives<3)break;
   const red=state.ghosts[0],row=red.rowState&31,col=red.colState&31;
   if(row!==23||col!==13)await command('x'+String.fromCharCode(row,col),'driver:collision-pursuit');
   await page.waitForTimeout(90);
  }
  await page.waitForFunction(()=>window.__arcadeLive.snapshot().events.some(e=>e.type==='collision'),{},{timeout:3000});
  // Natural collision owns a server pause in both modes. Competition needs an
  // explicit client resume, not an arcade presentation resume. First preserve
  // death art through blank and observe the next-life spawn before moving it.
  await page.waitForFunction(()=>window.__arcadeLive.snapshot().rows.some(r=>r.render.frame==='blank'),{},{timeout:7000});
  await page.waitForFunction(()=>{const r=window.__arcadeLive.latest();return r?.server?.lives===2&&r.render.x===108&&r.render.y===188&&/^pacman-\w+-2$/.test(r.render.frame);},{},{timeout:7000});
  if(mode==='arcade')await page.waitForFunction(()=>window.__arcadeLive.snapshot().events.some(e=>e.type==='command'&&e.command==='P'&&e.source==='sequence:death'),{},{timeout:6000});
  else await command('P','driver:next-life');
  for(let i=0;i<5;i++){await command('a','driver:next-life-movement');await page.waitForTimeout(100);}
  await page.waitForTimeout(200);
 } catch(error) {errors.push(error.message);}
 finally {
  capturing=false;
  if(captureLoop)await captureLoop.catch(error=>errors.push(error.message));
  if(page) {
   try{trace={mode,...await page.evaluate(()=>window.__arcadeLive?.snapshot()??{rows:[],events:[]})};}catch(error){errors.push(error.message);}
   try{trace.pauseTrace=await page.evaluate(()=>window.__arcadePauseTrace?.events()??[]);}catch{}
  }
  trace.events.push(...driverCommands);trace.events.sort((a,b)=>a.at-b.at);
  trace.errors=errors;
  trace.provenance={driver:'isolated live Go server and production Vite build',fixtures:false,frameOverrides:false,bot:'off',capture:'post-rAF timer DOM reads with asynchronous screenshot brackets',collision:'Last received pre-loss coordinates; exact collision unavailable on wire',excludedRegions:[],competitionPolicy:'No presentation holds; server-owned collision pause allowed and explicitly resumed by driver'};
  write(path.join(outDir,mode,'trace.json'),trace);
  write(path.join(outDir,mode,'screenshots.json'),captures);
  await cleanup.run();
  for(const signal of ['SIGINT','SIGTERM'])process.removeListener(signal,stop);
 }
 const tracePath=`${mode}/trace.json`;
 const checks=attachLiveEvidence(evaluateLiveTrace(trace,{scope,mode}),trace,captures,tracePath);
 for(const check of checks) {
  check.artifacts={trace:tracePath,screenshots:`${mode}/screenshots.json`};
  if(errors.length){check.errors=errors;if(check.status==='pass')check.status='incomplete';}
  if(captures.length&&['waiting-pose','ready-movement','death-respawn'].includes(check.scenario)){
   const manifest=`${mode}/${check.scenario}.json`;
   write(path.join(outDir,manifest),makeLiveManifest(check,captures,tracePath));
   check.manifest=manifest;
  }
 }
 write(path.join(outDir,mode,'checks.json'),checks);
 return checks;
}

/** Returns independent CheckResult[] for the requested live inventory. Expanded
 * groups remain incomplete. Renderer fidelity failures belong to another index.
 */
export async function runLiveSequences({scope='initial',mode='both',outDir='/tmp/pacman-live-sequences'}={}) {
 requiredChecks(scope);
 if(!['arcade','competition','both'].includes(mode))throw Error(`Unknown live mode: ${mode}`);
 outDir=path.resolve(outDir);fs.mkdirSync(outDir,{recursive:true});
 const checks=[];
 for(const selected of mode==='both'?['arcade','competition']:[mode]) {
  checks.push(...await runMode({scope,mode:selected,outDir}));
  write(path.join(outDir,'index.json'),{version:2,kind:'live',scope,mode,checks});
 }
 write(path.join(outDir,'summary.json'),{milestone:'initial live flows only',expandedCoverage:'not completed',renderer:'Separate renderer results; live passes do not resolve fidelity failures.',counts:Object.fromEntries(['pass','fail','incomplete'].map(status=>[status,checks.filter(c=>c.status===status).length])),checks:checks.map(({checkId,status})=>({checkId,status}))});
 return checks;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
 const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 runLiveSequences({scope:arg('--scope','initial'),mode:arg('--mode','both'),outDir:arg('--out','/tmp/pacman-live-sequences')}).then(checks=>{
  for(const c of checks)console.log(`${c.status}: ${c.checkId}${c.errors?' '+c.errors.join('; '):''}`);
  if(checks.some(c=>c.status!=='pass'))process.exitCode=1;
 }).catch(error=>{console.error(error);process.exitCode=1;});
}
