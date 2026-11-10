import test from 'node:test';import assert from 'node:assert/strict';
import {createVisualCapture} from './visualCapture.js';
test('fixtures are opt-in and clearing restores the live display',()=>{
 let fixture=null;const target={};assert.equal(createVisualCapture('',target,x=>fixture=x),null);assert.equal(target.__arcadeVisual,undefined);
 const api=createVisualCapture('?visual=1',target,x=>fixture=x);api.setFixture({score:123},2);assert.deepEqual(fixture,{state:{score:123},phase:2});api.clearFixture();assert.equal(fixture,null);
 assert.throws(()=>api.setFixture({},NaN));
});
