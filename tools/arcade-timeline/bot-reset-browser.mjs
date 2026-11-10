// Automatic bot restarts must not leave a new game paused; explicit stops still win.
import fs from'node:fs';import os from'node:os';import path from'node:path';import assert from'node:assert/strict';import{createCleanup}from'./processes.mjs';import{launchBrowser,startGameServer,startVisualizer}from'./run.mjs';
const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'bot-reset-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
try{const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());const page=await browser.newPage();let bot;await page.routeWebSocket(/localhost:3003/,r=>bot=r);await page.goto(`http://localhost:${port}/?timeline=1&mode=arcade&ws=${ws}`);await page.waitForTimeout(300);await page.getByRole('button',{name:'Start / pause',exact:true}).click();await page.waitForFunction(()=>window.__arcadeTimeline.state()?.mode===1,null,{timeout:10000});
 bot.send('reset_game');await page.waitForTimeout(5500);
 let status=await page.evaluate(()=>window.__arcadePauseTrace.status());assert.ok(status.mode===1||status.mode===2,`automatic bot reset stranded a new game: ${JSON.stringify(status)}`);
 bot.send('reset_game');bot.send('pause_game');await page.waitForTimeout(5500);
 status=await page.evaluate(()=>window.__arcadePauseTrace.status());assert.equal(status.mode,0,'explicit bot stop must not auto restart');assert.equal(status.runnerActive,false);
 await page.getByRole('button',{name:'Start / pause',exact:true}).click();await page.waitForFunction(()=>window.__arcadeTimeline.state()?.mode===1,null,{timeout:10000});
 await page.getByRole('button',{name:'Reset',exact:true}).click();await page.waitForTimeout(5500);
 status=await page.evaluate(()=>window.__arcadePauseTrace.status());assert.equal(status.mode,0,'manual reset must wait for the player');assert.equal(status.runnerActive,false);
 await page.getByRole('button',{name:'Arcade mode',exact:true}).click();bot.send('reset_game');await page.waitForTimeout(700);
 status=await page.evaluate(()=>window.__arcadePauseTrace.status());assert.ok(status.mode===1||status.mode===2,'competition bot reset must resume without an arcade hold');
 console.log('Bot resets resume in both modes; explicit stops and manual resets remain paused');
}finally{await cleanup.run();}
