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
 add(40,'pacman-left-2',108,188,true);add(60,'pacman-left-2',108,188,true);
 if(mode==='arcade') events.push({at:70,type:'command',command:'P',source:'sequence:start'});
 for(let i=0;i<9;i++)add(80+i*30,`pacman-left-${[2,1,0,1,2,1,0,1,2][i]}`,100-i*8,188,mode==='competition',3,i+1);
 events.push({at:360,type:'driver',name:'pursuit'},{at:400,type:'collision',previous:{pacman:position(11,9)},received:{pacman:position(32,32)},uncertainty:'last received position; exact collision unavailable'});
 add(400,'pacman-left-2',76,92,false,2,10,'death');add(420,'pacman-left-2',76,92,false,2,10,'death');
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
