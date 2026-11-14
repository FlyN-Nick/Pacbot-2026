import test from'node:test';import assert from'node:assert/strict';
const mod=import('./visual-scenarios.mjs');
const row=(frame,attr,palette)=>({frame,paintedState:{spriteAttributes:[0,0,attr,palette,0,0,0,0,0,0,194,9,0,0,0,0],spriteCoordinates:[7,8,134,164,7,8,7,8,7,8,135,68,7,8,7,8]}});
test('expanded references require both observed foot phases, and eyes direction must be observed',async()=>{
 const {expandedReferenceRanges}=await mod;assert.equal(typeof expandedReferenceRanges,'function');
 const rows=[row(10,128,1),row(11,132,1)];
 assert.deepEqual(expandedReferenceRanges('ghost-red-right',rows),{'foot-0':[10,10],'foot-1':[11,11]});
 assert.throws(()=>expandedReferenceRanges('ghost-red-right',rows.slice(0,1)),/not observed/);
 assert.throws(()=>expandedReferenceRanges('eyes-left',rows),/not observed/);
});
test('frightened restoration cannot be satisfied by initial normal ghosts',async()=>{
 const {expandedReferenceRanges}=await mod;assert.equal(typeof expandedReferenceRanges,'function');
 const rows=[row(1,128,1),row(2,112,17),row(3,116,17),row(4,112,18),row(5,116,18)];
 assert.throws(()=>expandedReferenceRanges('fright-restoration',rows),/not observed/);
 rows.push(row(6,128,1));assert.deepEqual(expandedReferenceRanges('fright-restoration',rows)['normal-restored'],[6,6]);
});
test('mouth producer records a whole observed cycle and repeated half-frame checkpoint',async()=>{
 const {expandedReferenceRanges}=await mod;
 const rows=[194,186,178,186,194].map((a,i)=>{const r=row(10+i,128,1);r.paintedState.spriteAttributes[10]=a;return r;});
 assert.deepEqual(expandedReferenceRanges('mouth-left',rows),{'frame-0':[12,12],'frame-1':[11,11],'frame-2':[10,10],'frame-3':[13,13],'mouth-cycle':[10,14]});
});
test('declared direction cannot substitute a different dense mouth cycle',async()=>{
 const{validateCheckpointCoverage}=await import('./record-sequences.mjs');const samples=[192,188,180,188,192].map((a,i)=>({id:`f${i}`,emulatedFrame:i,state:{spriteAttributes:[0,0,0,0,0,0,0,0,0,0,a]}}));
 assert.throws(()=>validateCheckpointCoverage(samples,{'mouth-cycle':{sampleIds:samples.map(s=>s.id),firstFrame:0,lastFrame:4}},{scenario:'mouth-up',checkpoints:[{id:'mouth-cycle',completeness:'all-observed'}]}),/directional mouth/);
});
