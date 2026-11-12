import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptArcadeState} from './arcade-state.mjs';
function raw(){
 const videoRam=Array(1024).fill(64),colorRam=Array(1024).fill(16);
 // Hand-derived upright tile offsets: READY at screen (11,20); score at (5,1).
 videoRam[594]=82;videoRam[1016]=0;videoRam[1015]=0;videoRam[1006]=0;videoRam[1005]=0;
 videoRam[26]=32;videoRam[27]=33;videoRam[58]=34;videoRam[59]=35;
 videoRam[4]=144;videoRam[5]=145;videoRam[36]=146;videoRam[37]=147;
 return {schema:'mame-pacman-raw-v1',flipScreen:0,videoRam,colorRam,spriteAttributes:[0,0,144,1,136,3,152,5,152,7,194,9,252,0,0,0],spriteCoordinates:[0,0,134,164,134,140,151,140,119,140,135,68,7,8,0,0],levelByte:0,subState:2};
}
test('hardware positions subtract header once and retain native fractional centers',()=>{
 const r=raw();r.spriteCoordinates[10]=135.5;const s=adaptArcadeState(r);
 assert.deepEqual(s.pacman.position,{x:112.5,y:188});
 assert.deepEqual(s.ghosts[0].position,{x:113,y:92});
 assert.equal(s.ghosts[1].facing,'down');assert.equal(s.ghosts[2].facing,'up');
 assert.equal(s.pacman.phase,132);assert.equal(s.pacman.facing,'left');
});
test('offscreen hardware actors stay hidden even with unknown sprite phases',()=>{
 const r=raw();r.spriteCoordinates[10]=7;r.spriteCoordinates[11]=8;r.spriteAttributes[10]=176;
 assert.equal(adaptArcadeState(r).pacman.visible,false);
});
test('rejects visible unknown phases, orientation and unverified progression',()=>{
 const r=raw();r.spriteAttributes[10]=180;assert.throws(()=>adaptArcadeState(r),/unverified.*Pac-Man/i);
 r.spriteAttributes[10]=194;r.flipScreen=1;assert.throws(()=>adaptArcadeState(r),/orientation/);
 r.flipScreen=0;r.levelByte=1;assert.throws(()=>adaptArcadeState(r),/level/);
});
test('death uses elapsed source frames and never maps artwork code to a matching time',()=>{
 const r=raw();r.readyTile=64;r.subState=4;r.spriteAttributes[10]=208;
 assert.throws(()=>adaptArcadeState(r),/death.*clock/i);
 const s=adaptArcadeState(r,{emulatedFrame:1434,deathCatchFrame:1373,deathAnimationStartFrame:1434});
 assert.equal(s.pacman.deathElapsedMs,0);assert.equal(s.pacman.catchElapsedMs,1006.5);assert.equal(s.pacman.visible,true);
 r.spriteAttributes[10]=252;assert.equal(adaptArcadeState(r,{emulatedFrame:1547,deathCatchFrame:1373,deathAnimationStartFrame:1434}).pacman.deathElapsedMs,1864.5);
});
test('painted tile state controls pellets, score, READY and spare lives rather than logical lives',()=>{
 const r=raw();r.lives=3;r.videoRam[898]=16;r.videoRam[900]=20;r.colorRam[900]=0;r.videoRam[1016]=7;
 const s=adaptArcadeState(r);assert.equal(s.score,70);assert.equal(s.lives,2);assert.equal(s.ready,true);
 assert.equal(s.pellets[1][1],1);assert.equal(s.pellets[3][1],0);
 assert.equal(s.level,1);assert.equal(s.playerLabelVisible,false);
});

test('blank painted high score remains hidden zero; malformed score tiles reject',()=>{
 const r=raw();r.videoRam[1006]=64;r.videoRam[1005]=64;
 assert.equal(adaptArcadeState(r).highScore,0);
 r.videoRam[1016]=55;assert.throws(()=>adaptArcadeState(r),/score tile/);
});
