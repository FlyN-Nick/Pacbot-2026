import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {PNG} from 'pngjs';
import {createCleanup} from './processes.mjs';
import {launchBrowser,startGameServer,startVisualizer,connectCommands,runScenario} from './run.mjs';
import {SCENARIOS} from './gui-scenarios.mjs';
import {checkRomDir,isRomsetGood} from './record.mjs';
import {VISUAL_SCENARIOS,visualFixtures} from './visual-scenarios.mjs';
import {validateCapture} from './visual-captures.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const arg=(name,fallback)=>{const i=process.argv.indexOf(name);return i<0?fallback:process.argv[i+1];};
const source=arg('--source','gui'),out=path.resolve(arg('--out','visual-captures'));
fs.mkdirSync(out,{recursive:true});
if(fs.readdirSync(out).length)throw Error('Output directory must be empty to prevent stale capture reuse');
const captures=[];
function add(image,scenario,anchor,phase,extra={}) {
 const png=PNG.sync.read(fs.readFileSync(path.join(out,image)));
 captures.push(validateCapture({version:1,source,scenario,anchor,frameOffset:extra.frameOffset??0,state:anchor,phase,image,dimensions:{width:png.width,height:png.height},normalization:{},regions:png.width===224&&png.height===288?{hud:{x:0,y:0,width:224,height:24},maze:{x:0,y:24,width:224,height:248},footer:{x:0,y:272,width:224,height:16}}:{},provenance:{kind:'live',...extra}}));
}
async function main(){
 if(!['gui','mame'].includes(source)) throw Error('source must be gui or mame');
 const cleanup=createCleanup();cleanup.installSignalHandlers();
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'pacbot-visual-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 try {
  if(source==='mame'){
   const dir=process.env.PACMAN_ROM_DIR;const check=checkRomDir(dir);if(!check.ok)throw Error(`UNAVAILABLE: ${check.message}`);
   if(!isRomsetGood(execFileSync('mame',['-rompath',dir,'-verifyroms','pacman'],{encoding:'utf8'})))throw Error('UNAVAILABLE: unsupported ROM revision');
   for(const scenario of ['start','death','fright','ghostEaten']){
    const dest=path.join(out,scenario);fs.mkdirSync(dest,{recursive:true});
    execFileSync('mame',['pacman','-rompath',dir,'-autoboot_script',path.join(here,'mame/recorder.lua'),'-nothrottle','-video','none','-sound','none','-skip_gameinfo'],{cwd:path.join(here,'mame'),env:{...process.env,SDL_VIDEODRIVER:'dummy',ARCADE_SCENARIO:scenario,ARCADE_OUT:path.join(tmp,scenario+'.json'),ARCADE_CAPTURE_DIR:dest},timeout:120000,stdio:'pipe'});
    for(const name of fs.readdirSync(dest).filter(x=>x.endsWith('.meta'))){const [anchor,frame,phase,offset]=fs.readFileSync(path.join(dest,name),'utf8').split('\n');add(`${scenario}/${name.replace('.meta','.png')}`,scenario,anchor,Number(phase),{frame:Number(frame),frameOffset:Number(offset??0),mame:execFileSync('mame',['-version'],{encoding:'utf8'}).trim()});}
   }
  }else{
   const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),send=await connectCommands(ws,cleanup);
   const browser=await launchBrowser();cleanup.add(()=>browser.close());
   const page=await browser.newPage({viewport:{width:224,height:352},deviceScaleFactor:1});
   await page.goto(`http://localhost:${port}/?timeline=1&visual=1&ws=${ws}&bot=off&mode=arcade`);
   if(process.argv.includes('--fixtures')){
    for(const fixture of visualFixtures()){
     await page.evaluate(f=>window.__arcadeVisual.setFixture(f.state,f.phase),fixture);
     await page.evaluate(()=>new Promise(requestAnimationFrame));
     const name=fixture.name+'.png';await page.locator('[data-arcade-screen]').screenshot({path:path.join(out,name)});
     add(name,'fixture',fixture.name,fixture.phase,{kind:'fixture',state:fixture.state});
    }
   }else{
   await page.getByRole('button',{name:'Unmute game audio'}).click();
   await page.evaluate(()=>document.activeElement?.blur());
   await page.waitForTimeout(800);
   for(const scenario of SCENARIOS.filter(s=>['start','death','ghostEaten'].includes(s.name))){
    await page.evaluate(()=>window.__arcadeTimeline.reset());
    const seen=new Set();let busy=false;let captureError=null;const pending=[];
    const timer=setInterval(()=>{if(busy)return;busy=true;pending.push((async()=>{
      const {events,elapsed}=await page.evaluate(()=>({events:window.__arcadeTimeline.events(),elapsed:window.__arcadeTimeline.elapsed()}));
      const due=[];
      for(const event of events)for(const checkpoint of VISUAL_SCENARIOS.filter(s=>s.scenario===scenario.name&&s.anchor===event.type))for(const offset of checkpoint.offsets){
       const key=`${event.type}:${event.t}:${offset}`;
       if(!seen.has(key)&&elapsed>=event.t+offset/60.606){seen.add(key);due.push({event,offset,key});}
      }
      // One painted screenshot may satisfy multiple delayed checkpoints; actual latency remains in provenance.
      for(const {event,offset,key}of due){
       const name=`${scenario.name}-${event.type}-${event.frame??event.t}-${offset}.png`;
       await page.locator('[data-arcade-screen]').screenshot({path:path.join(out,name),animations:'allow'});
       const phase=event.frame??0;add(name,scenario.name,event.type,phase,{eventTime:event.t,observedTime:elapsed,requestedFrameOffset:offset,captureKey:key});
       captures.at(-1).frameOffset=offset;
      }
    })().catch(error=>{captureError=error;}).finally(()=>busy=false));},20);
    try{const result=await runScenario(scenario,page,send);if(result.problem)throw Error(result.problem);}finally{clearInterval(timer);await Promise.all(pending);if(captureError)throw captureError;}

   }
  }
  }
  if(!captures.length)throw Error('No captures produced');
  fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify({version:1,captures},null,2)+'\n');
  console.log(`Recorded ${captures.length} ${source} frames in ${out}`);
 }finally{await cleanup.run();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
