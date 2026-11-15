import test from 'node:test';
import assert from 'node:assert/strict';
const loaded=import('./expanded-live.mjs').catch(()=>({}));
const row=(i,render={},server={})=>({id:`r${i}`,raf:i+1,at:i*20,render:{frame:'pacman-left-2',ghosts:[],...render},server:{mode:1,tick:i,lives:3,level:1,...server}});
async function evaluate(scenario,rows,extra={}){const m=await loaded;assert.equal(typeof m.evaluateExpandedTrace,'function');return m.evaluateExpandedTrace({scenario,mode:'arcade',rows,events:[],...extra});}
const point=(c,id)=>c.checkpoints.find(p=>p.id===id);
test('fright restoration needs visible blue then white then normal, not flags alone',async()=>{
 const rows=[row(0,{ghosts:[{frame:'fright-blue-0'}]}),row(1,{ghosts:[{frame:'fright-white-1'}]}),row(2,{ghosts:[{frame:'ghost-red-left-0'}]})];
 assert.equal((await evaluate('fright-restoration',rows)).status,'pass');
 rows[1].render.ghosts=[];assert.equal(point(await evaluate('fright-restoration',rows),'flashing').status,'incomplete');
});
test('ghost eaten needs a visible score, eyes journey, house arrival, restored normal actor',async()=>{
 const rows=[row(0,{scores:['+200']}),row(1,{ghosts:[{frame:'eyes-down',x:76,y:92}]}),row(2,{ghosts:[{frame:'eyes-down',x:108,y:116}]}),row(3,{ghosts:[{frame:'ghost-red-left-0',x:108,y:116}]})];
 assert.equal((await evaluate('ghost-eaten',rows)).status,'pass');
 rows[2].render.ghosts[0].y=44;assert.equal(point(await evaluate('ghost-eaten',rows),'house-arrival').status,'incomplete');
});
test('last life requires observed game-over and bounded dense no-resume interval',async()=>{
 const rows=[row(0,{}, {lives:1}),row(1,{frame:'death-0'},{lives:0,mode:0}),row(2,{frame:'blank',gameOver:true},{lives:0,mode:0}),row(3,{frame:null},{lives:0,mode:0})];
 const extra={events:[{type:'collision',at:20,previous:{lives:1},received:{lives:0}}],deadline:60,endAt:60,endRaf:4};
 assert.equal((await evaluate('last-life-death',rows,extra)).status,'pass');
 extra.events.push({type:'command',command:'P',source:'sequence:death',at:50});assert.equal(point(await evaluate('last-life-death',rows,extra),'no-sequence-resume').status,'fail');
 extra.events.pop();rows.splice(2,1);assert.equal(point(await evaluate('last-life-death',rows,extra),'no-sequence-resume').status,'incomplete');
});
test('level completion requires visible flashes and received next level, competition must progress without holds',async()=>{
 const rows=[row(0),row(1,{maze:'white'}),row(2,{maze:'blue'}),row(3,{maze:'white'}),row(4,{maze:'blue',ready:true},{level:2}),row(5,{}, {level:2})];
 const extra={events:[{type:'driver',name:'last-pellet',at:0},{type:'command',command:'P',source:'sequence:levelComplete',at:80}],deadline:100,endAt:100,endRaf:6};
 assert.equal((await evaluate('level-completion',rows,extra)).status,'pass');
 extra.mode='competition';assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'fail');
});
test('last-life no-resume distinguishes debug kill pause latency from post-blank continuation',async()=>{
 const rows=[row(0,{}, {lives:1}),row(1,{frame:'death-0'},{lives:0,mode:1}),row(2,{frame:'blank',gameOver:true},{lives:0,mode:0}),row(3,{frame:null},{lives:0,mode:0})];
 const extra={events:[{type:'collision',at:20,previous:{lives:1},received:{lives:0}}],deadline:60,endAt:60,endRaf:4};
 assert.equal(point(await evaluate('last-life-death',rows,extra),'no-sequence-resume').status,'pass');
 rows[3].server.mode=1;assert.equal(point(await evaluate('last-life-death',rows,extra),'no-sequence-resume').status,'fail');
});
test('last-life resumed frame after pause acknowledgment fails even before blank',async()=>{
 const rows=[row(0,{}, {lives:1}),row(1,{frame:'death-0'},{lives:0,mode:0}),row(2,{frame:'death-1'},{lives:0,mode:1}),row(3,{frame:'blank',gameOver:true},{lives:0,mode:0}),row(4,{frame:null},{lives:0,mode:0})];
 const extra={events:[{type:'collision',at:20,previous:{lives:1},received:{lives:0}}],deadline:80,endAt:80,endRaf:5};
 assert.equal(point(await evaluate('last-life-death',rows,extra),'no-sequence-resume').status,'fail');
});
test('expanded manifest screenshot evidence resolves beside its trace',async()=>{
 const{makeLiveManifest}=await import('./live-sequences.mjs');
 const check={mode:'arcade',scenario:'last-life-death',checkpoints:[]},capture={id:'a',image:'a.png',dimensions:{width:224,height:288},before:row(0),after:row(1)};
 assert.deepEqual(makeLiveManifest(check,[capture],'trace.json','screenshots.json').samples[0].alignment.evidence,['screenshots.json','trace.json']);
});
test('competition level continuation cannot borrow ticks before its paused next-level reset',async()=>{
 const rows=[row(0),row(1),row(2,{}, {level:2,mode:0,tick:2}),row(3,{}, {level:2,mode:0,tick:2})];
 const extra={mode:'competition',events:[{type:'driver',name:'last-pellet',at:0}]};
 assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'incomplete');
 extra.events.push({type:'command',command:'P',source:'driver:expanded-scenario',at:70});
 assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'incomplete','command alone is not progression');
 rows.push(row(4,{}, {level:2,mode:1,tick:3}),row(5,{}, {level:2,mode:1,tick:4}));
 assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'pass');
 extra.events[1].source='sequence:levelComplete';
 assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'fail');
});
test('progression before an external resume cannot satisfy competition continuation',async()=>{
 const rows=[row(0),row(1,{}, {level:2,tick:10}),row(2,{}, {level:2,tick:11}),row(3,{}, {level:2,mode:0,tick:11}),row(4,{}, {level:2,mode:0,tick:11})];
 const extra={mode:'competition',events:[{type:'driver',name:'last-pellet',at:0},{type:'command',command:'P',source:'driver:expanded-scenario',at:70}]};
 assert.equal(point(await evaluate('level-completion',rows,extra),'continuation-policy').status,'incomplete');
});
test('retained competition trace passes only with its external resume and subsequent progression',async()=>{
 const fs=await import('node:fs'),trace=JSON.parse(fs.readFileSync(new URL('./evidence/competition-level-continuation.json',import.meta.url)));
 const{evaluateExpandedTrace}=await loaded;
 assert.equal(evaluateExpandedTrace(trace).status,'pass');
 const resume=trace.events.find(e=>e.type==='command'&&e.command==='P'&&e.source==='driver:expanded-scenario');
 assert.ok(resume);
 const truncated={...trace,rows:trace.rows.filter(r=>r.at<resume.at),events:trace.events.filter(e=>e.at<resume.at)};
 assert.deepEqual(truncated.rows.at(-1).server,{level:2,mode:0,tick:110});
 assert.equal(point(evaluateExpandedTrace(truncated),'continuation-policy').status,'incomplete');
});
