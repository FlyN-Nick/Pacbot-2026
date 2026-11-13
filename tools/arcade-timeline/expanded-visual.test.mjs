import test from'node:test';import assert from'node:assert/strict';
const api=import('./expanded-visual.mjs').catch(()=>({}));
test('HUD overflow uses independent seven-level history including repeated fruits',async()=>{
 const {artworkCases}=await api;assert.equal(typeof artworkCases,'function');const cases=artworkCases();
 const hud=cases.find(c=>c.checkId==='artwork:hud-history-overflow');assert.deepEqual(hud.expectedHud,{score:'999990',highScore:'999990',lives:4,fruits:['strawberry','orange','orange','apple','apple','melon','melon']});
 assert.deepEqual(cases.find(c=>c.checkId==='artwork:hud-late-keys').expectedHud.fruits,['key','key','key','key','key','key','key']);
});
test('directional and death cases exercise semantic selection with no frame override',async()=>{
 const {artworkCases}=await api;assert.equal(typeof artworkCases,'function');const cases=artworkCases();
 assert.deepEqual(cases.filter(c=>c.checkId==='artwork:mouth-up'&&c.phase%66===0).map(c=>c.expectedFrames[0]),['pacman-up-0','pacman-up-1','pacman-up-2','pacman-up-1','pacman-up-0']);
 assert.equal(cases.filter(c=>c.checkId==='artwork:death-art').length,13);
 assert.ok(cases.every(c=>!JSON.stringify(c.state).includes('"frame"')));
});
test('pixel composition rejects opaque black and neighboring artwork at display boundaries',async()=>{
 const {inspectComposition}=await api;assert.equal(typeof inspectComposition,'function');
 const p={width:2,height:2,data:Uint8Array.from([18,120,90,255,255,255,0,255,18,120,90,255,18,120,90,255])};
 assert.equal(inspectComposition(p,new Set(['255,255,0'])).unexpected,0);p.data.set([0,0,0],0);assert.equal(inspectComposition(p,new Set(['255,255,0'])).unexpected,1);
});
test('artwork mouth cycle retains every native cadence phase through repeated boundary',async()=>{const{artworkCases}=await api;const phases=artworkCases().filter(c=>c.checkId==='artwork:mouth-left').map(c=>c.phase);assert.deepEqual(phases,Array.from({length:17},(_,i)=>i*16.5));});
test('sprite gutter boundary scan catches a same-palette neighbor but ignores interior artwork',async()=>{const m=await api;assert.equal(typeof m.countBoundaryPixels,'function');const p={width:3,height:3,data:new Uint8Array(36)};p.data[16]=255;assert.equal(m.countBoundaryPixels(p,(r)=>r===255),0);p.data[0]=255;assert.equal(m.countBoundaryPixels(p,(r)=>r===255),1);});
