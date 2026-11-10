import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import{PNG}from'pngjs';
import{createCleanup}from'./processes.mjs';import{launchBrowser,startGameServer,startVisualizer,connectCommands}from'./run.mjs';
const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'death-bot-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
try{
 const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());const send=await connectCommands(ws,cleanup);
 const page=await browser.newPage({viewport:{width:224,height:352},deviceScaleFactor:1});let bot;
 await page.routeWebSocket(/localhost:3003/,route=>bot=route);
 await page.goto(`http://localhost:${port}/?timeline=1&visual=1&mode=arcade&ws=${ws}`);await page.waitForTimeout(400);assert.ok(bot);
 await page.evaluate(()=>{
  window.__arcadeVisual.setFixture({pellets:Array.from({length:31},()=>Array(28).fill(0)),pacman:{rowState:23,colState:13},ghosts:[{rowState:11,colState:13}],fruit:{row:17,col:13}},0);
  document.querySelectorAll('.grid-element').forEach(el=>el.style.backgroundColor='#12785a');
 });
 await page.waitForTimeout(120);
 const screenshot=PNG.sync.read(await page.locator('[data-arcade-screen]').screenshot());
 for(const [name,x,y]of [['Pac-Man',100,204],['ghost',100,108],['fruit',100,156]]){
 const i=(y*screenshot.width+x)*4;assert.deepEqual([...screenshot.data.subarray(i,i+4)],[18,120,90,255],`${name} background must reveal avoidance map`);
 }
 await page.evaluate(()=>{window.__arcadeVisual.clearFixture();document.querySelectorAll('.grid-element').forEach(el=>el.style.backgroundColor='');});

 await page.getByRole('button',{name:'Unmute game audio'}).click();await page.evaluate(()=>document.activeElement.blur());
 await page.keyboard.press('Space');await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='gameStarted'),null,{timeout:10000});
 // Debug death avoids dependence on pathfinding, while the bot channel sends the same automatic resume as simulation.
 send('k');await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='pacmanCaught'));
 bot.send('resume_game');await page.waitForTimeout(1400);
 const events=await page.evaluate(()=>window.__arcadeTimeline.events());assert.ok(events.some(e=>e.type==='deathFrame'),'bot auto-resume cancelled death before animation/sound');
 assert.ok(events.some(e=>e.type==='deathSoundStarted'),'death audio source must actually start');
 const first=await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition);await page.waitForTimeout(500);const next=await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition);assert.notEqual(first,next,'death artwork must advance');
 await page.waitForFunction(()=>window.__arcadeTimeline.events().filter(e=>e.type==='gameStarted').length>=2,null,{timeout:10000});
 console.log('Bot auto-resume preserves arcade death animation and scheduled next life');
}finally{await cleanup.run();}
