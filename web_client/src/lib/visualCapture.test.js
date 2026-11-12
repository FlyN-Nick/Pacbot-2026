import test from 'node:test';import assert from 'node:assert/strict';
import {createVisualCapture} from './visualCapture.js';
test('fixtures are opt-in and clearing restores the live display',()=>{
 let fixture=null;const target={};assert.equal(createVisualCapture('',target,x=>fixture=x),null);assert.equal(target.__arcadeVisual,undefined);
 const api=createVisualCapture('?visual=1',target,x=>fixture=x);api.setFixture({score:123},2);assert.deepEqual(fixture,{state:{score:123},phase:2});api.clearFixture();assert.equal(fixture,null);
 assert.throws(()=>api.setFixture({},NaN));
});

test('canonical capture preserves fractional positions and rejects frame-key overrides',()=>{
 let fixture;const api=createVisualCapture('?visual=1',{},x=>fixture=x);
 const state={schema:'arcade-render-v1',pacman:{position:{x:112.5,y:188},visible:true,facing:'left',phase:132},ghosts:[]};
 api.setArcadeState(state);assert.equal(fixture.kind,'arcade');assert.equal(fixture.state.pacman.position.x,112.5);
 state.pacman.position.x=0;assert.equal(api.snapshotMetadata().state.pacman.position.x,112.5);
 assert.throws(()=>api.setArcadeState({...state,pacman:{...state.pacman,frame:'pacman-left-2'}}),/override/i);
});
