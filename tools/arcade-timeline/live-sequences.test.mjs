import test from 'node:test';
import assert from 'node:assert/strict';
const modulePromise = import('./live-sequences.mjs').catch(() => ({}));
// Independent observations: no renderer selectors or timing constants imported.
const position = (row=23,col=13) => ({rowState:row,colState:col});
function trace(mode='arcade') {
 const rows=[];const events=[];
 const add=(at,frame,x=108,y=188,ready=false,lives=3,tick=0,kind=null)=>rows.push({id:`r${rows.length}`,raf:rows.length+1,at,server:{tick,mode:tick?1:0,lives,pacman:position(y/8-.5,x/8-.5)},render:{frame,x,y,ready,ghosts:[]},presentation:{kind}});
 add(0,'pacman-left-2');add(20,'pacman-left-2');
 events.push({at:30,type:'driver',name:'start'},{at:30,type:'command',command:'P',source:'manual'},{at:35,type:'audio-start',name:'intro'});
 add(40,'pacman-left-2',108,188,true);add(50,'pacman-left-2',108,188,true);add(60,'pacman-left-2',108,188,true);
 if(mode==='arcade') events.push({at:70,type:'command',command:'P',source:'sequence:start'});
 for(let i=0;i<9;i++)add(80+i*30,`pacman-left-${[2,1,0,1,2,1,0,1,2][i]}`,100-i*8,188,mode==='competition',3,i+1);
 events.push({at:360,type:'driver',name:'pursuit'},{at:400,type:'collision',previous:{pacman:position(11,9)},received:{pacman:position(32,32)},uncertainty:'last received position; exact collision unavailable'});
 add(400,'pacman-left-2',76,92,false,2,10,'death');add(410,'pacman-left-2',76,92,false,2,10,'death');add(420,'pacman-left-2',76,92,false,2,10,'death');
 events.push({at:440,type:'audio-start',name:'death'});
 add(440,'pacman-up-0',76,92,false,2,10,'death');
 for(let i=0;i<11;i++)add(460+i*20,`death-${i}`,76,92,false,2,mode==='arcade'?10:11+i,'death');
 add(700,'blank',76,92,false,2,mode==='arcade'?10:24,'death');add(720,'blank',76,92,false,2,mode==='arcade'?10:25,'death');
 add(750,'pacman-left-2',108,188,mode==='arcade',2,26,'death');add(770,'pacman-left-2',108,188,mode==='arcade',2,26,'death');
 if(mode==='arcade')events.push({at:790,type:'command',command:'P',source:'sequence:death'});
 else events.push({at:730,type:'command',command:'P',source:'driver:next-life'});
 add(810,'pacman-left-1',100,188,false,2,27);add(830,'pacman-left-0',92,188,false,2,28);
 return {mode,rows,events,errors:[]};
}
async function check(t,scenario) {const m=await modulePromise;assert.equal(typeof m.evaluateLiveTrace,'function','live trace evaluator must exist');return m.evaluateLiveTrace(t,{scope:'initial',mode:t.mode}).find(c=>c.scenario===scenario);}
const checkpoint=(result,id)=>result.checkpoints.find(c=>c.id===id);
test('complete independent arcade observations satisfy all three groups',async()=>{for(const s of ['waiting-pose','ready-movement','death-respawn'])assert.equal((await check(trace(),s)).status,'pass');});
test('open idle followed by closed READY fails waiting continuity',async()=>{const t=trace();t.rows[0].render.frame='pacman-left-0';assert.equal((await check(t,'waiting-pose')).status,'fail');});
test('death rendered at spawn fails captured position',async()=>{const t=trace();for(const r of t.rows.filter(r=>r.render.frame.startsWith('death-')))Object.assign(r.render,{x:108,y:188});assert.equal(checkpoint(await check(t,'death-respawn'),'captured-death-position').status,'fail');});
test('collision at spawn is incomplete evidence for teleport regression',async()=>{const t=trace();t.events.find(e=>e.type==='collision').previous.pacman=position();assert.equal(checkpoint(await check(t,'death-respawn'),'captured-death-position').status,'incomplete');});
test('movement during arcade READY hold fails before release',async()=>{const t=trace();t.rows[3].render.x=100;assert.equal(checkpoint(await check(t,'ready-movement'),'before-release').status,'fail');});
test('scheduled future death sound cannot replace actual audio start',async()=>{const t=trace();t.events=t.events.filter(e=>e.name!=='death');t.events.push({at:440,type:'scheduled',name:'death'});assert.equal(checkpoint(await check(t,'death-respawn'),'death-audio-start').status,'fail');});
test('arcade hold with no observed release is incomplete',async()=>{const t=trace();t.events=t.events.filter(e=>e.source!=='sequence:start');assert.equal(checkpoint(await check(t,'ready-movement'),'before-release').status,'incomplete');});
test('mouth cycle cannot be satisfied by one or two distinct frames',async()=>{const t=trace();for(const r of t.rows.filter(r=>r.at>=80&&r.at<360))r.render.frame='pacman-left-2';assert.equal(checkpoint(await check(t,'ready-movement'),'mouth-cycle').status,'fail');});
test('competition allows moving READY but still requires mouth cycling and no presentation commands',async()=>{const t=trace('competition');assert.equal((await check(t,'ready-movement')).status,'pass');t.events.push({at:50,type:'command',command:'p',source:'sequence:start'});assert.equal(checkpoint(await check(t,'ready-movement'),'before-release').status,'fail');});
test('missing death artwork or next life remains incomplete',async()=>{const t=trace();t.rows=t.rows.filter(r=>r.render.frame!=='death-5'&&r.at<750);const c=await check(t,'death-respawn');assert.equal(c.status,'incomplete');assert.equal(checkpoint(c,'death-art-transitions').status,'incomplete');assert.equal(checkpoint(c,'next-life-ready').status,'incomplete');});
test('unimplemented expanded groups are retained as incomplete',async()=>{const m=await modulePromise;assert.equal(typeof m.evaluateLiveTrace,'function');const checks=m.evaluateLiveTrace(trace(),{scope:'full',mode:'arcade'});assert.ok(checks.length>3);assert.equal(checks.find(c=>c.scenario==='manual-reset').status,'incomplete');});

test('each checkpoint retains before/after/neighbor screenshots, including missing checkpoint failures',async()=>{
 const m=await modulePromise;assert.equal(typeof m.attachLiveEvidence,'function');
 const t=trace(),checks=m.evaluateLiveTrace(t,{mode:'arcade'});
 const captures=[0,200,500,900].map((at,i)=>({id:`screen-${i}`,image:`arcade/screen-${i}.png`,before:{at,raf:i*10+1},after:{at:at+5,raf:i*10+2}}));
 m.attachLiveEvidence(checks,t,captures,'arcade/trace.json');
 for(const c of checks)for(const p of c.checkpoints){assert.ok(p.evidence.trace);assert.ok(p.evidence.before);assert.ok(p.evidence.after);assert.ok(p.evidence.neighbors.length);}
 const missing=m.evaluateLiveTrace({rows:[],events:[]},{mode:'arcade'});m.attachLiveEvidence(missing,{rows:[]},captures,'arcade/trace.json');
 assert.equal(missing[0].status,'incomplete');assert.ok(missing[0].checkpoints[0].evidence.after);
});

test('live manifest preserves screenshot brackets and resolves artifact paths from index root',async()=>{
 const m=await modulePromise;assert.equal(typeof m.makeLiveManifest,'function');
 const t=trace(),c=(await check(t,'waiting-pose'));
 const captures=[{id:'screen-0',image:'arcade/screen-0.png',dimensions:{width:224,height:288},before:t.rows[0],after:t.rows[1]}];
 m.attachLiveEvidence([c],t,captures,'arcade/trace.json');
 const manifest=m.makeLiveManifest(c,captures,'arcade/trace.json');
 const {validateSequence}=await import('./sequence-contract.mjs');validateSequence(manifest);
 assert.equal(manifest.samples[0].paintedFrame,t.rows[1].raf);
 assert.equal(manifest.samples[0].state.before.raf,t.rows[0].raf);
 assert.deepEqual(manifest.samples[0].alignment.evidence,['arcade/screenshots.json','arcade/trace.json']);
 assert.match(manifest.samples[0].alignment.method,/not.*compositor/i);
});

test('death artwork coverage needs the initial up pose as well as numbered frames',async()=>{
 const t=trace();t.rows=t.rows.filter(r=>r.render.frame!=='pacman-up-0');
 assert.equal(checkpoint(await check(t,'death-respawn'),'death-art-transitions').status,'incomplete');
});
test('an animated stationary tail cannot supply a mouth cycle for preceding movement',async()=>{
 const t=trace();const moving=t.rows.filter(r=>r.at>=80&&r.at<360);
 for(const r of moving)r.render.x=100;
 assert.notEqual(checkpoint(await check(t,'ready-movement'),'mouth-cycle').status,'pass');
});

for(const [name,select] of [
 ['caught hold',r=>r.at>=400&&r.at<440],
 ['initial upward pose',r=>r.render.frame==='pacman-up-0'],
 ['caught hold and initial upward pose',r=>r.at>=400&&r.at<=440],
])test(`teleport during ${name} fails even when numbered death artwork returns`,async()=>{
 const t=trace();for(const r of t.rows.filter(select))Object.assign(r.render,{x:108,y:188});
 assert.equal(checkpoint(await check(t,'death-respawn'),'captured-death-position').status,'fail');
});

for(const [scenario,id,holdTimes] of [
 ['ready-movement','before-release',[40,50,60]],
 ['death-respawn','initial-hold',[400,410,420]],
])for(const [name,remove] of [
 ['interior',[holdTimes[1]]],
 ['first boundary',[holdTimes[0]]],
 ['last boundary',[holdTimes[2]]],
])test(`${id} rejects missing ${name} observer coverage`,async()=>{
 const t=trace();t.rows=t.rows.filter(r=>!remove.includes(r.at));
 assert.equal(checkpoint(await check(t,scenario),id).status,'incomplete');
});

function raceTrace(scenario='mode-change-ready',mode='arcade') {
 const rows=[0,20,40,60,80].map((at,i)=>({id:`r${i}`,raf:i+1,at,server:{mode:i<2?0:1,tick:i<2?0:i,lives:3},presentation:{kind:i<2?'start':null,dying:false},render:{frame:'pacman-left-2',x:108-i*8,y:188,ready:i<2}}));
 return {scenario,mode,targetMode:mode==='arcade'?'competition':'arcade',rows,events:[{type:'driver',name:'race-action',at:30,command:'mode-change'},{type:'command',source:'mode change',command:'P',at:32}],endAt:100,endRaf:5,deadline:90};
}
test('mode change cannot pass when canceling an owned hold strands the server',async()=>{
 const m=await modulePromise;assert.equal(typeof m.evaluateRaceTrace,'function');const t=raceTrace();for(const r of t.rows){r.server.mode=0;r.server.tick=0;}
 assert.equal(m.evaluateRaceTrace(t).checkpoints.find(c=>c.id==='painted-continuation').status,'fail');
});
test('mode change requires command evidence, cancellation and actual painted progression',async()=>{
 const m=await modulePromise;assert.equal(typeof m.evaluateRaceTrace,'function');const t=raceTrace();assert.equal(m.evaluateRaceTrace(t).status,'pass');
 t.events.push({type:'command',source:'sequence:start',command:'P',at:95});assert.equal(m.evaluateRaceTrace(t).status,'fail');
});
test('stop and manual pause require complete bounded observations and no automatic resume',async()=>{
 const m=await modulePromise;assert.equal(typeof m.evaluateRaceTrace,'function');const t=raceTrace('explicit-stop');t.events[0].command='reset-and-stop';t.events[1]={at:32,type:'command',source:'bot',command:'p'};
 for(const r of t.rows.slice(2)){r.server.mode=0;r.server.tick=0;r.render.x=108;}
 assert.equal(m.evaluateRaceTrace(t).status,'pass');t.rows.splice(3,1);assert.equal(m.evaluateRaceTrace(t).status,'incomplete');
});
test('competition shared hold label needs active phase plus positive progression and no sequence hold',async()=>{
 const m=await modulePromise;assert.equal(typeof m.evaluateRaceTrace,'function');const t=raceTrace('bot-resume','competition');
 t.events[0].command='resume_game';t.events[1].source='bot';for(const r of t.rows.slice(0,2)){r.server.mode=1;r.server.tick=r.raf;r.presentation.kind=null;r.presentation.dying=true;}
 assert.equal(m.evaluateRaceTrace(t).checkpoints.find(c=>c.id==='hold-active').status,'pass');t.rows[1].server.tick=t.rows[0].server.tick;
 assert.notEqual(m.evaluateRaceTrace(t).checkpoints.find(c=>c.id==='hold-active').status,'pass');
});

test('manual-pause absence assertion starts at the actual pause acknowledgment',async()=>{
 const m=await modulePromise,t=raceTrace('manual-pause');t.events[0].command='manual-pause';t.events[1]={at:32,type:'command',source:'manual',command:'p'};
 t.rows[2].server.mode=1;for(const r of t.rows.slice(3))r.server.mode=0;
 assert.equal(m.evaluateRaceTrace(t).status,'pass');t.rows[4].server.mode=1;assert.equal(m.evaluateRaceTrace(t).status,'fail');
});

test('expanded producer results replace only matching checks and cannot shrink the inventory',async()=>{
 const m=await modulePromise;assert.equal(typeof m.mergeLiveResults,'function');
 const base=m.evaluateLiveTrace(trace(),{scope:'full',mode:'arcade'}),replacement={...base.find(c=>c.scenario==='bot-reset'),status:'pass'};
 const merged=m.mergeLiveResults(base,[replacement]);assert.equal(merged.length,base.length);assert.equal(merged.find(c=>c.scenario==='bot-reset').status,'pass');assert.equal(merged.find(c=>c.scenario==='level-completion').status,'incomplete');
 assert.throws(()=>m.mergeLiveResults(base,[{checkId:'live:not-in-inventory'}]),/inventory/);
});

for(const boundary of ['first','last'])test(`stop absence assertion rejects a missing ${boundary} observer boundary`,async()=>{
 const m=await modulePromise,t=raceTrace('explicit-stop');t.endRaf=5;t.events[0].command='reset-and-stop';t.events[1]={at:32,type:'command',source:'bot',command:'p'};
 for(const r of t.rows.slice(2)){r.server.mode=0;r.server.tick=0;}
 t.rows.splice(boundary==='first'?2:4,1);
 assert.equal(m.evaluateRaceTrace(t).checkpoints.find(c=>c.id==='no-sequence-resume').status,'incomplete');
});

test('race CLI validates options after module constants initialize',async()=>{
 const {spawnSync}=await import('node:child_process');
 const result=spawnSync(process.execPath,[new URL('./live-sequences.mjs',import.meta.url).pathname,'--races','--mode','invalid'],{encoding:'utf8'});
 assert.equal(result.status,1);assert.match(result.stderr,/Unknown race or mode/);assert.doesNotMatch(result.stderr,/ReferenceError/);
});
