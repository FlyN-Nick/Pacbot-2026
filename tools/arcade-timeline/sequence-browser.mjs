import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {createCleanup} from './processes.mjs';
import {launchBrowser,startGameServer,startVisualizer} from './run.mjs';
import {catalog} from '../../web_client/src/lib/sprites/catalog.js';
const cleanup=createCleanup(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-browser-'));
cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
try {
 const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());
 const page=await browser.newPage({viewport:{width:224,height:352},deviceScaleFactor:1});const sent=[],errors=[];
 page.on('websocket',socket=>socket.on('framesent',frame=>sent.push(String(frame.payload))));page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:${port}/?timeline=1&visual=1&ws=${ws}&bot=off&mode=arcade`);
 await page.waitForFunction(()=>window.__arcadeTimeline?.state());
 const before=await page.evaluate(()=>window.__arcadeTimeline.state()),commands=sent.length;
 const state={schema:'arcade-render-v1',score:70,highScore:70,lives:2,level:1,playerLabelVisible:false,ready:false,
  pellets:Array.from({length:31},()=>Array(28).fill(0)),
  pacman:{position:{x:112.5,y:188},visible:true,facing:'left',phase:132,deathElapsedMs:null},
  ghosts:[{position:{x:113,y:92},visible:true,color:'red',facing:'up',footPhase:1,eaten:true,frightened:true,flashing:true}]};
 const paint=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await page.evaluate(s=>window.__arcadeVisual.setArcadeState(s),state);await paint();
 const bounds=await page.locator('.pacman-position').boundingBox(),screen=await page.locator('[data-arcade-screen]').boundingBox();
 assert.equal(bounds.x-screen.x,104.5);assert.equal(bounds.y-screen.y,204);
 const framePosition=frame=>`${-catalog[frame].render.x}px ${-catalog[frame].render.y}px`;
 assert.equal(await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition),framePosition('pacman-left-2'));
 assert.equal(await page.locator('.ghost .sprite').evaluate(el=>el.style.backgroundPosition),framePosition('eyes-up'));
 state.ghosts[0].eaten=false;await page.evaluate(s=>window.__arcadeVisual.setArcadeState(s),state);await paint();
 assert.equal(await page.locator('.ghost .sprite').evaluate(el=>el.style.backgroundPosition),framePosition('fright-white-1'));
 state.pacman.deathElapsedMs=1006.5;await page.evaluate(s=>window.__arcadeVisual.setArcadeState(s),state);await paint();
 assert.equal(await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition),framePosition('death-4'));
 state.ready=true;state.pacman.phase=0;state.pacman.deathElapsedMs=null;await page.evaluate(s=>window.__arcadeVisual.setArcadeState(s),state);await paint();
 assert.equal(await page.locator('.game-effects.arcade .ready-banner').count(),1);
 assert.equal(await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition),framePosition('pacman-left-2')); 
 const ready=await page.locator('.ready-banner').boundingBox();assert.equal(ready.x-screen.x,88);assert.equal(ready.y-screen.y,160);
 state.pacman.visible=false;state.ghosts[0].visible=false;await page.evaluate(s=>window.__arcadeVisual.setArcadeState(s),state);await paint();
 assert.equal(await page.locator('.pacman-position').count(),0);assert.equal(await page.locator('.ghost').count(),0);
 assert.equal(sent.length,commands);assert.deepEqual(await page.evaluate(()=>window.__arcadeTimeline.state()),before);assert.deepEqual(errors,[]);
 await page.evaluate(()=>window.__arcadeVisual.clearFixture());await paint();assert.equal(await page.evaluate(()=>window.__arcadeVisual.snapshotMetadata()),null);
 console.log('Canonical browser checks passed: fractional centers, phases, eyes precedence, hidden actors, death timing, zero commands, unchanged real server state, legacy restore.');
}finally{await cleanup.run();}
