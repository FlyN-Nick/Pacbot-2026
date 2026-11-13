// Expanded assertions over production DOM observations. No fixture API or
// selector implementation is imported; missing transitions remain incomplete.
import {requiredChecks} from './sequence-coverage.mjs';
export const EXPANDED_LIVE_SCENARIOS=['fright-restoration','ghost-eaten','last-life-death','level-completion'];
const dense=rows=>rows.length>1&&rows.every((r,i)=>!i||r.raf===rows[i-1].raf+1);
export function evaluateExpandedTrace(trace) {
 const definition=requiredChecks('full').find(d=>d.category==='live'&&d.mode===trace.mode&&d.scenario===trace.scenario);
 if(!definition||!EXPANDED_LIVE_SCENARIOS.includes(trace.scenario))throw Error('Unknown expanded live scenario');
 const rows=trace.rows??[],events=trace.events??[],found=new Map();
 const put=(id,condition,reason,selected)=>found.set(id,{id,status:condition?'pass':'fail',reason,observationIds:selected.map(r=>r.id)});
 const sample=(id,row,reason)=>{if(row)put(id,true,reason,[row]);};
 const ghosts=(r,pattern)=>(r.render.ghosts??[]).filter(g=>pattern.test(g.frame??''));
 const commands=events.filter(e=>e.type==='command'&&['p','P'].includes(e.command)&&e.source?.startsWith('sequence:'));
 if(trace.scenario==='fright-restoration') {
  const blue=rows.find(r=>ghosts(r,/^fright-blue-/).length);
  const white=rows.find(r=>blue&&r.at>blue.at&&ghosts(r,/^fright-white-/).length);
  const normal=rows.find(r=>white&&r.at>white.at&&ghosts(r,/^ghost-/).length&&!ghosts(r,/^fright-/).length);
  sample('blue',blue,'Visible blue frightened artwork.');sample('flashing',white,'Visible white artwork after blue.');sample('normal-restored',normal,'Visible normal artwork after flashing.');
 }
 if(trace.scenario==='ghost-eaten') {
  const score=rows.find(r=>r.render.scores?.length);
  const eyes=rows.find(r=>score&&r.at>score.at&&ghosts(r,/^eyes-/).length);
  // Native ghost house interior: rows12..16, cols10..17. Require visible eyes
  // inside, then normal artwork there; source flags alone cannot satisfy this.
  const inside=g=>g.x>=80&&g.x<=144&&g.y>=96&&g.y<=136;
  const identity=eyes&&ghosts(eyes,/^eyes-/)[0]?.identity;
  const same=g=>g.identity===identity;
  const arrival=rows.find(r=>eyes&&r.at>eyes.at&&ghosts(r,/^eyes-/).some(g=>same(g)&&inside(g)));
  const normal=rows.find(r=>arrival&&r.at>arrival.at&&ghosts(r,/^ghost-/).some(g=>same(g)&&inside(g)));
  sample('score-popup',score,'Rendered eaten score popup.');sample('eyes-start',eyes,'Visible returning eyes after popup.');sample('house-arrival',arrival,'Visible eyes enter the house.');sample('normal-restored',normal,'Normal actor artwork restored inside the house.');
 }
 if(trace.scenario==='last-life-death') {
  const collision=events.find(e=>e.type==='collision'&&e.previous?.lives===1&&e.received?.lives===0);
  const death=rows.filter(r=>collision&&r.at>=collision.at),blank=death.find(r=>r.render.frame==='blank');
  const paused=death.find(r=>r.server.mode===0);
  const completion=death.filter(r=>paused&&r.at>=paused.at);
  sample('death-catch',death[0],'Received last-life loss.');sample('blank',death.find(r=>r.render.frame==='blank'),'Observed blank death artwork.');sample('game-over',death.find(r=>r.render.gameOver&&r.server.lives===0),'Visible GAME OVER with zero lives.');
  if(collision&&trace.endAt>=trace.deadline&&Number.isFinite(trace.deadline)&&dense(death)&&death.at(-1).raf===trace.endRaf)put('no-sequence-resume',!commands.some(e=>e.at>=collision.at&&e.command==='P')&&Boolean(blank)&&completion.length>1&&completion.every(r=>r.server.mode===0&&r.server.lives===0),'No presentation resume after catch; no active server after pause acknowledgment through bounded completion deadline.',death);
 }
 if(trace.scenario==='level-completion') {
  const last=events.find(e=>e.type==='driver'&&e.name==='last-pellet');
  const after=rows.filter(r=>last&&r.at>=last.at),before=rows.findLast(r=>last&&r.at<=last.at);
  sample('last-pellet',before,'Driver consumes last retained pellet through server command.');
  const next=after.find(r=>before&&r.server.level>before.server.level);
  const ready=after.find(r=>r.render.ready),interval=after.filter(r=>!ready||r.at<=ready.at);
  if(trace.mode==='competition') {
   if(next&&new Set(after.map(r=>r.server.tick)).size>1)put('maze-flashes',!commands.length,'Competition skips presentation maze flashes and progresses without sequence holds.',after);
  } else if(next&&dense(interval))put('maze-flashes',interval.filter((r,i)=>r.render.maze==='white'&&interval[i-1]?.render.maze!=='white').length>=2,'Multiple visible white/blue maze transitions before next level.',interval);
  sample('next-level',next,'Received level increases.');
  if(next&&after.length>1)put('continuation-policy',trace.mode==='competition'?!commands.length&&new Set(after.map(r=>r.server.tick)).size>1:Boolean(ready)&&commands.some(e=>e.command==='P'&&e.at>=last.at),'Arcade READY and release; competition positive progression with no presentation holds.',after);
 }
 const checkpoints=definition.checkpoints.map(p=>found.get(p.id)??{id:p.id,status:'incomplete',reason:'Required visible transition or complete observation interval not reached.',observationIds:[]});
 return {checkId:definition.id,category:'live',scenario:trace.scenario,mode:trace.mode,checkpoints,status:checkpoints.some(c=>c.status==='fail')?'fail':checkpoints.every(c=>c.status==='pass')?'pass':'incomplete'};
}

export async function runExpandedLive({mode='both',outDir,scenarios=EXPANDED_LIVE_SCENARIOS}) {
 const fs=await import('node:fs'),path=await import('node:path'),os=await import('node:os');
 const {PNG}=await import('pngjs');
 const {createCleanup}=await import('./processes.mjs');
 const {startGameServer,startVisualizer,launchBrowser,connectCommands}=await import('./run.mjs');
 const {attachLiveEvidence,makeLiveManifest}=await import('./live-sequences.mjs');
 const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'expanded-live-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const checks=[],write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
 try {
  const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());const send=await connectCommands(ws,cleanup);
  for(const selected of mode==='both'?['arcade','competition']:[mode])for(const scenario of scenarios) {
   const dir=path.resolve(outDir,selected,scenario);fs.mkdirSync(dir,{recursive:true});send('r');await new Promise(r=>setTimeout(r,250));
   const page=await browser.newPage({viewport:{width:224,height:352}}),captures=[],commands=[],errors=[];let collecting=true,loop,trace,deadline;
   const command=async(value)=>{const at=await page.evaluate(()=>performance.now());commands.push({type:'command',command:value,source:'driver:expanded-scenario',at});send(value);};
   const move=async(row,col)=>command('x'+String.fromCharCode(row,col));
   const wait=async(fn,timeout=10000)=>page.waitForFunction(fn,null,{timeout});
   try {
    page.on('pageerror',e=>errors.push(e.message));await page.goto(`http://localhost:${port}/?timeline=1&observe=1&mode=${selected}&bot=off&ws=${ws}`);
    await wait(()=>window.__arcadeLive?.latest()?.server);if(await page.evaluate(()=>typeof window.__arcadeVisual!=='undefined'))throw Error('Live fixture API enabled');
    loop=(async()=>{while(collecting){try{const before=await page.evaluate(()=>window.__arcadeLive.latest()),image=`screen-${captures.length}.png`,bytes=await page.locator('[data-arcade-screen]').screenshot({path:path.join(dir,image),timeout:5000}),after=await page.evaluate(()=>window.__arcadeLive.latest()),{width,height}=PNG.sync.read(bytes);captures.push({id:`screen-${captures.length}`,image,dimensions:{width,height},before,after});if(collecting)await page.waitForTimeout(100);}catch(e){errors.push(e.message);break;}}})();
    await page.getByRole('button',{name:'Start / pause',exact:true}).click();await page.evaluate(()=>document.activeElement?.blur());
    await wait(()=>{const r=window.__arcadeLive.latest();return r.server.mode!==0&&!r.render.ready;});
    if(scenario==='last-life-death') {
     for(const lives of [2,1,0]) {
      if(lives)await command('k');
      else {
       await move(23,8);await page.waitForTimeout(120);
       for(let i=0;i<80;i++){const state=await page.evaluate(()=>window.__arcadeTimeline.state());if(state.lives===0)break;const target=state.ghosts.find(g=>!g.frightState&&!((g.rowState|g.colState)&32)&&!((g.rowState&31)>=12&&(g.rowState&31)<=16&&(g.colState&31)>=10&&(g.colState&31)<=17));if(target)await move(target.rowState&31,target.colState&31);await page.waitForTimeout(90);}
      }
      await page.waitForFunction(lives=>window.__arcadeLive.latest().server.lives===lives,lives,{timeout:3000});
      if(lives){await page.waitForTimeout(6500);if(selected==='competition')await command('P');await page.waitForTimeout(300);}
     }
     deadline=await page.evaluate(()=>performance.now())+6000;
     await page.waitForTimeout(6100);
    } else if(scenario==='level-completion') {
     await command('c');await page.waitForTimeout(180);const state=await page.evaluate(()=>window.__arcadeTimeline.frame());
     let pellet;for(let row=0;row<state.pellets.length&&!pellet;row++)for(let col=0;col<28;col++)if((state.pellets[row]>>>col)&1){pellet=[row,col];break;}
     if(!pellet)throw Error('Last pellet not available');await page.evaluate(()=>window.__arcadeLive.mark('last-pellet'));await move(...pellet);
     await page.waitForTimeout(7000);
     if(selected==='competition'){await command('P');await page.waitForTimeout(600);}
    } else {
     await move(23,1);await wait(()=>window.__arcadeLive.latest().render.ghosts.some(g=>g.frame?.startsWith('fright-')),5000);
     if(scenario==='fright-restoration')await page.waitForTimeout(35000);
     else {
      for(let i=0;i<100;i++) {
       if(await page.evaluate(()=>window.__arcadeLive.snapshot().rows.some(r=>r.render.scores?.length)))break;
       const state=await page.evaluate(()=>window.__arcadeTimeline.state());
       const target=state.ghosts.find(g=>g.frightState>0&&!((g.rowState|g.colState)&32)&&!((g.rowState&31)>=12&&(g.rowState&31)<=16&&(g.colState&31)>=10&&(g.colState&31)<=17));
       if(target)await move(target.rowState&31,target.colState&31);await page.waitForTimeout(100);
      }
      await page.waitForTimeout(5000);
     }
    }
   }catch(e){errors.push(e.message);}
   finally {
    collecting=false;if(loop)await loop;
    try{trace={scenario,mode:selected,...await page.evaluate(()=>window.__arcadeLive.snapshot()),endAt:await page.evaluate(()=>performance.now())};trace.endRaf=trace.rows.at(-1)?.raf;trace.deadline=deadline;}catch(e){trace={scenario,mode:selected,rows:[],events:[],errors:[e.message]};}
    trace.events.push(...commands);trace.events.sort((a,b)=>a.at-b.at);trace.errors=errors;trace.provenance={fixtures:false,frameOverrides:false,setup:'Real isolated server; debug k/c and position commands explicitly retained',paint:'Post-render DOM+rAF observations; asynchronous screenshots, not exact compositor IDs',excludedRegions:[]};
    write(path.join(dir,'trace.json'),trace);write(path.join(dir,'screenshots.json'),captures);await page.close();
   }
   const [check]=attachLiveEvidence([evaluateExpandedTrace(trace)],trace,captures,'trace.json');if(errors.length&&check.status==='pass')check.status='incomplete';check.errors=errors;check.artifacts={trace:path.join(dir,'trace.json'),screenshots:path.join(dir,'screenshots.json')};
   if(captures.length)write(path.join(dir,'manifest.json'),makeLiveManifest(check,captures,'trace.json','screenshots.json'));
   write(path.join(dir,'checks.json'),[check]);checks.push(check);write(path.resolve(outDir,'index.json'),{version:2,kind:'live',checks});
  }
 }finally{await cleanup.run();}
 return checks;
}
