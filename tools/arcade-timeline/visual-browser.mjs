import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
import {PNG} from 'pngjs';
import {normalizeCapture} from './visual-captures.mjs';
import {compareImages} from './visual-compare.mjs';
import {createCleanup} from './processes.mjs';import {launchBrowser,startGameServer,startVisualizer,connectCommands} from './run.mjs';
const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pacbot-browser-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
try{
 const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());
 const send=await connectCommands(ws,cleanup);
 const page=await browser.newPage({viewport:{width:896,height:1280},deviceScaleFactor:1});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://localhost:${port}/?timeline=1&visual=1&ws=${ws}&bot=off&mode=arcade`);await page.waitForTimeout(600);
 const state={score:1250,lives:3,level:4,highScore:10000,pacman:{rowState:23,colState:13|192},ghosts:[{rowState:11,colState:13|192},{rowState:13,colState:13,color:'pink'},{rowState:14,colState:11,color:'cyan',frightState:30},{rowState:14,colState:15,color:'orange',trappedState:128}]};
 await page.evaluate(state=>window.__arcadeVisual.setFixture(state,0),state);await page.waitForTimeout(60);
 await page.evaluate(()=>window.__arcadeVisual.setFixture({pacman:{rowState:32,colState:32},ghosts:[{rowState:32,colState:32}]},0));await page.waitForTimeout(20);
 assert.equal(await page.locator('.pacman-position').count(),0);assert.equal(await page.locator('.ghost').count(),0);
 await page.evaluate(state=>window.__arcadeVisual.setFixture(state,132),state);await page.waitForTimeout(20);
 const mouthBefore=await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition);
 await page.evaluate(state=>window.__arcadeVisual.setFixture({...state,moving:false},264),state);await page.waitForTimeout(20);
 assert.equal(await page.locator('.pacman-position .sprite').evaluate(el=>el.style.backgroundPosition),mouthBefore);
 await page.evaluate(state=>window.__arcadeVisual.setFixture(state,0),state);await page.waitForTimeout(20);

 const option=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
 const out=path.resolve(option('--out','/tmp/pacbot-browser-visual'));fs.mkdirSync(out,{recursive:true});await page.locator('[data-arcade-screen]').screenshot({path:path.join(out,'arcade.png')});
 for(const viewport of [{width:320,height:568},{width:900,height:400}]){await page.setViewportSize(viewport);await page.waitForTimeout(30);const b=await page.locator('[data-arcade-screen]').boundingBox();assert.ok(b.x>=-0.1&&b.y>=-0.1&&b.x+b.width<=viewport.width+0.1&&b.y+b.height<=viewport.height+0.1);assert.ok(await page.getByRole('button',{name:'Arcade mode',exact:true}).isVisible());}
 await page.setViewportSize({width:896,height:1280});await page.getByRole('button',{name:'Arcade mode',exact:true}).click();await page.waitForTimeout(50);assert.deepEqual(await page.evaluate(()=>window.__arcadeVisual.snapshotMetadata().state),state);assert.equal(await page.locator('.score-box').count(),0);assert.equal(await page.locator('.hud').count(),1);await page.locator('[data-arcade-screen]').screenshot({path:path.join(out,'competition.png')});
 await page.getByRole('button',{name:'Competition mode',exact:true}).click();assert.equal(await page.locator('.score-box').count(),0);await page.setViewportSize({width:224,height:352});
 const referenceDir=option('--mame-reference',null);
 if(referenceDir){
 const reference=path.join(path.resolve(referenceDir),'start/gameStarted-2.png');
 assert.ok(fs.existsSync(reference),`Missing MAME reference: ${reference}`);
  const native=PNG.sync.read(fs.readFileSync(reference));
  const fixture={pellets:Array.from({length:31},()=>Array(28).fill(0)),ready:true,score:0,lives:3,level:1,highScore:0,pacman:{rowState:23,colState:13,frame:'pacman-left-2'},ghosts:[{rowState:11,colState:13,color:'red',frame:'ghost-red-left-0'}]};
  await page.evaluate(state=>window.__arcadeVisual.setFixture(state,0),fixture);await page.waitForTimeout(50);
  const actual=PNG.sync.read(await page.locator('[data-arcade-screen]').screenshot());
  assert.deepEqual([actual.width,actual.height],[224,288]);
  const readyReference=path.join(path.resolve(referenceDir),'start/readyShown-1.png');
  const nativeReady=PNG.sync.read(fs.readFileSync(readyReference));
  const pairs=[['ready',{x:88,y:160,width:48,height:8},{x:88,y:160,width:48,height:8},nativeReady],['pacman',{x:104,y:204,width:16,height:16},{x:100,y:204,width:16,height:16}],['blinky',{x:104,y:108,width:16,height:16},{x:100,y:108,width:16,height:16}],['lives',{x:16,y:272,width:48,height:16},{x:16,y:272,width:48,height:16}],['fruit',{x:192,y:272,width:16,height:16},{x:192,y:272,width:16,height:16}]];
  const reports=[];const manifests={reference:[],actual:[]};
 for(const kind of ['reference','actual'])fs.mkdirSync(path.join(out,kind),{recursive:true});
  for(const [name,referenceCrop,actualCrop,referenceImage=native]of pairs){const a=normalizeCapture(referenceImage,{crop:referenceCrop}),b=normalizeCapture(actual,{crop:actualCrop});const r=compareImages(a,b,{});for(const [kind,img]of [['reference',a],['actual',b],['difference',r.difference]])fs.writeFileSync(path.join(out,`${name}-${kind}.png`),PNG.sync.write(img));reports.push({name,referenceCrop,actualCrop,...r.whole});
   for(const [kind,img]of [['reference',a],['actual',b]]){
    fs.writeFileSync(path.join(out,kind,name+'.png'),PNG.sync.write(img));
    manifests[kind].push({version:1,source:kind==='reference'?'mame':'gui',scenario:'isolated',anchor:name,frameOffset:0,state:name,phase:0,image:name+'.png',dimensions:{width:img.width,height:img.height},normalization:{},regions:{sprite:{x:0,y:0,width:img.width,height:img.height}},provenance:{kind:'fixture',sourceImage:kind==='reference'?(name==='ready'?readyReference:reference):'browser native fixture',crop:kind==='reference'?referenceCrop:actualCrop,state:fixture}});
   }}
  for(const kind of ['reference','actual'])fs.writeFileSync(path.join(out,kind,'manifest.json'),JSON.stringify({version:1,captures:manifests[kind]},null,2));
  fs.writeFileSync(path.join(out,'mame-regions.json'),JSON.stringify(reports,null,2));
  assert.ok(reports.every(r=>r.differingPixels===0),JSON.stringify(reports));
 }
 await page.evaluate(()=>window.__arcadeVisual.clearFixture());
 // Exercise real READY transition, not only immutable fixture metadata.
 await page.getByRole('button',{name:'Start / pause',exact:true}).click();
 await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='readyShown'));
 const before=await page.evaluate(()=>window.__arcadeTimeline.state());
 await page.getByRole('button',{name:'Arcade mode',exact:true}).click();await page.waitForTimeout(30);
 const after=await page.evaluate(()=>window.__arcadeTimeline.state());
 assert.equal(after.score,before.score);assert.equal(after.lives,before.lives);assert.equal(after.level,before.level);
 // Switch during a real death animation.
 await page.getByRole('button',{name:'Competition mode',exact:true}).click();
 await page.evaluate(()=>window.__arcadeTimeline.reset());send('k');
 await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='deathFrame'));
 const deathState=await page.evaluate(()=>window.__arcadeTimeline.state());
 await page.getByRole('button',{name:'Arcade mode',exact:true}).click();await page.waitForTimeout(50);
 const deathAfter=await page.evaluate(()=>window.__arcadeTimeline.state());
 assert.equal(deathAfter.level,deathState.level);assert.equal(deathAfter.lives,deathState.lives);
 assert.ok(await page.locator('.pacman-position').count()>0);
 // Reset, start a real level clear and change mode while its display is frozen.
 send('r');await page.waitForTimeout(400);
 await page.getByRole('button',{name:'Competition mode',exact:true}).click();
 await page.evaluate(()=>window.__arcadeTimeline.reset());await page.getByRole('button',{name:'Start / pause',exact:true}).click();
 await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='gameStarted'),null,{timeout:10000});
 send('c');await page.waitForTimeout(200);
 const rows=await page.evaluate(()=>window.__arcadeTimeline.frame().pellets);
 let pellet=null;for(let row=0;row<rows.length&&!pellet;row++)for(let col=0;col<28;col++)if((rows[row]>>>col)&1){pellet=[row,col];break;}
 assert.ok(pellet);send('x'+String.fromCharCode(...pellet));
 await page.waitForFunction(()=>window.__arcadeTimeline.events().some(e=>e.type==='levelCleared'),null,{timeout:5000});
 const levelState=await page.evaluate(()=>window.__arcadeTimeline.state());
 await page.getByRole('button',{name:'Arcade mode',exact:true}).click();await page.waitForTimeout(100);
 const levelAfter=await page.evaluate(()=>window.__arcadeTimeline.state());assert.equal(levelAfter.level,levelState.level);assert.equal(levelAfter.score,levelState.score);
 assert.equal(await page.locator('.maze.blank').count(),0);assert.ok(await page.locator('.pacman-position').count()>0);


 await page.goto(`http://localhost:${port}/?timeline=1&ws=${ws}&bot=off`);assert.equal(await page.evaluate(()=>typeof window.__arcadeVisual),'undefined');assert.deepEqual(errors,[]);console.log(`Browser checks passed; screenshots: ${out}`);
}finally{await cleanup.run();}
