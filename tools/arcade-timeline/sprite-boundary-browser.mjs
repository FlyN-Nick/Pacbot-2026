import{pathToFileURL}from'node:url';
import fs from'node:fs';import os from'node:os';import path from'node:path';import assert from'node:assert/strict';import{PNG}from'pngjs';import{createCleanup}from'./processes.mjs';import{launchBrowser,startGameServer,startVisualizer}from'./run.mjs';
export function countBoundaryPixels(png,predicate){let count=0;for(let y=0;y<png.height;y++)for(let x=0;x<png.width;x++)if(x===0||y===0||x===png.width-1||y===png.height-1){const i=(y*png.width+x)*4;if(predicate(...png.data.subarray(i,i+4)))count++;}return count;}
async function main(){
const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sprite-boundary-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
try{
 const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());const page=await browser.newPage({deviceScaleFactor:2});
 await page.goto(`http://localhost:${port}/?timeline=1&visual=1&bot=off&mode=arcade&ws=${ws}`);await page.waitForTimeout(300);
 const failures=[];
 for(const viewport of [{width:700,height:768},{width:1000,height:700},{width:1280,height:720},{width:1512,height:982},{width:1440,height:900}]){
 await page.setViewportSize(viewport);
 for(const[direction,row,col]of [['right',23,77],['left',23,205],['up',215,13],['down',87,13]])for(const phase of [0,66,132,198]){
 await page.evaluate(({row,col,phase})=>{window.__arcadeVisual.setFixture({pellets:Array.from({length:31},()=>Array(28).fill(0)),pacman:{rowState:row,colState:col}},phase);document.querySelectorAll('.grid-element').forEach(el=>el.style.backgroundColor='#12785a');},{row,col,phase});
 await page.waitForTimeout(20);const png=PNG.sync.read(await page.locator('.pacman-position .sprite').screenshot());const yellow=countBoundaryPixels(png,(r,g,b)=>r===255&&g===255&&b===0);
 if(yellow)failures.push({viewport,direction,phase,yellow});
 }
 }
 assert.deepEqual(failures,[],'neighboring atlas art must not bleed onto sprite boundaries');console.log('Pac-Man frame boundaries stay transparent at fractional scales');
}finally{await cleanup.run();}

}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)await main();
