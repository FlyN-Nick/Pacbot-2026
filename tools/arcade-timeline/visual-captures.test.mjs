import test from 'node:test';
import assert from 'node:assert/strict';
import { validateCapture, normalizeCapture } from './visual-captures.mjs';
const capture = { version:1, source:'gui', scenario:'ready', anchor:'readyShown', frameOffset:0, state:'ready', phase:0, image:'ready.png', dimensions:{width:2,height:3}, normalization:{}, regions:{} };
test('incomplete metadata cannot masquerade as an aligned capture', () => {
  assert.equal(validateCapture(capture), capture);
  for (const key of ['phase','dimensions','state']) { const bad={...capture}; delete bad[key]; assert.throws(()=>validateCapture(bad)); }
});
test('asymmetric rotation and crop preserve exact pixels', () => {
 const image={width:2,height:3,data:Buffer.from([1,2,3,4,5,6].flatMap(x=>[x,0,0,255]))};
 const out=normalizeCapture(image,{rotate:90});
 assert.deepEqual([out.width,out.height],[3,2]);
 assert.deepEqual([...out.data].filter((_,i)=>i%4===0),[5,3,1,6,4,2]);
 assert.throws(()=>normalizeCapture(image,{crop:{x:1,y:0,width:2,height:1}}));
});
