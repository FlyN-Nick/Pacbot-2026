import test from 'node:test';
import assert from 'node:assert/strict';
import {selectPacmanFrame,selectGhostFrame,selectFruitFrame} from './frames.js';
import {catalog} from './catalog.js';
test('mouth cycle closes between the two openings and wraps',()=>{
 assert.deepEqual([0,1,2,3,4].map(phase=>selectPacmanFrame({direction:'left',phase})),['pacman-left-0','pacman-left-1','pacman-left-2','pacman-left-1','pacman-left-0']);
 assert.equal(selectPacmanFrame({direction:'right',dying:true,deathFrame:99}),'blank');
});
test('eaten state wins over fright and selects directional eyes',()=>{
 assert.equal(selectGhostFrame({color:'red',direction:'up',phase:1,eaten:true,frightened:true,flashing:true}),'eyes-up');
 assert.equal(selectGhostFrame({color:'pink',direction:'left',phase:1}),'ghost-pink-left-1');
 assert.equal(selectGhostFrame({color:'cyan',phase:0,frightened:true,flashing:true}),'fright-white-0');
});
test('fruit progression repeats middle fruits and ends in keys',()=>{
 assert.deepEqual([1,2,3,4,5,13,99].map(selectFruitFrame),['fruit-cherry','fruit-strawberry','fruit-orange','fruit-orange','fruit-apple','fruit-key','fruit-key']);
});
test('every selected sprite fits inside its source sheet',()=>{
 for(const frame of Object.values(catalog))assert.ok(frame.x>=0&&frame.y>=0&&frame.x+frame.width<=frame.sheetWidth&&frame.y+frame.height<=frame.sheetHeight);
});

import {selectDeathFrame,resolvePacmanFrame} from './frames.js';
test('death artwork follows measured holds rather than uniform steps',()=>{assert.equal(selectDeathFrame(0),'pacman-up-0');assert.equal(selectDeathFrame(494),'pacman-up-0');assert.equal(selectDeathFrame(495),'death-0');assert.equal(selectDeathFrame(610.5),'death-1');assert.equal(selectDeathFrame(1848),'death-10');assert.equal(selectDeathFrame(2112),'blank');});
test('stopping and freezing keep the current mouth frame while READY chooses its pose',()=>{assert.equal(resolvePacmanFrame({previousFrame:'pacman-left-2',direction:'left',phase:99,active:false,moving:false}),'pacman-left-2');assert.equal(resolvePacmanFrame({previousFrame:'pacman-left-2',direction:'left',phase:99,ready:true}),'pacman-left-2');});

test('waiting to start and READY share the closed pose until movement begins',()=>{
 const waiting=resolvePacmanFrame({previousFrame:null,direction:'right',active:false,moving:false});
 assert.equal(waiting,'pacman-right-2');
 assert.equal(resolvePacmanFrame({previousFrame:waiting,direction:'right',ready:true}),'pacman-right-2');
 assert.equal(resolvePacmanFrame({previousFrame:waiting,direction:'right',active:true,moving:true,phase:0}),'pacman-right-0');
});

test('moving READY cycles its mouth while waiting or inactive READY stays closed',()=>{
 const phase=[0,66,132,198,264];
 assert.deepEqual(phase.map(phase=>resolvePacmanFrame({previousFrame:'pacman-left-2',direction:'left',phase,active:true,moving:true,ready:true})),
  ['pacman-left-0','pacman-left-1','pacman-left-2','pacman-left-1','pacman-left-0']);
 for(const state of [{active:true,moving:false},{active:false,moving:true},{active:false,moving:false}]) {
  assert.deepEqual(phase.map(phase=>resolvePacmanFrame({previousFrame:'pacman-left-0',direction:'left',phase,ready:true,...state})),Array(5).fill('pacman-left-2'));
 }
});
