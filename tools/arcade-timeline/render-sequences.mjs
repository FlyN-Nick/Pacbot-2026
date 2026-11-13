// Controlled display replay. Source PNGs are comparison references, never renderer inputs.
import fs from 'node:fs';import path from 'node:path';import os from 'node:os';
import {pathToFileURL} from 'node:url';import {createHash} from 'node:crypto';import {isDeepStrictEqual} from 'node:util';
import {PNG} from 'pngjs';
import {requiredChecks} from './sequence-coverage.mjs';
import {validateSequence,matchSamples} from './sequence-contract.mjs';
import {validateRecordedSequence,validateCheckpointCoverage} from './record-sequences.mjs';
import {validateArcadeCaptureState} from '../../web_client/src/lib/visualCapture.js';
import {adaptArcadeState} from './arcade-state.mjs';
import {compareImages} from './visual-compare.mjs';
import {createCleanup} from './processes.mjs';
import {launchBrowser,startGameServer,startVisualizer} from './run.mjs';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function artifact(root,relative){
 if(typeof relative!=='string'||/[\\\u0000-\u001f:?"<>|#%]/.test(relative)||relative.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('Unsafe artifact path');
 const file=fs.realpathSync(path.join(root,relative));if(!file.startsWith(fs.realpathSync(root)+path.sep))throw Error('Artifact outside root');return file;
}
export function makeReplayIndex(reference){
 if(reference.version!==2||!Array.isArray(reference.sequences))throw Error('Invalid reference index');
 const definitions=requiredChecks(reference.scope),known=new Set(definitions.map(d=>d.id)),seen=new Set();
 for(const entry of reference.sequences){if(seen.has(entry.checkId)||!known.has(entry.checkId))throw Error('Duplicate or unknown reference entry');seen.add(entry.checkId);}
 return {version:2,scope:reference.scope,sequences:definitions.map(d=>({checkId:d.id,status:'unavailable',reason:'No controlled renderer producer or recorded reference'})),context:structuredClone(reference.context??[])};
}
export function deathClock(manifest){
 if(manifest.scenario!=='death-respawn')return {};
 const caught=manifest.provenance.checkpoints?.['death-catch']?.firstFrame;
 const index=manifest.samples.findIndex(s=>(s.state.spriteAttributes[10]>>2)===52),start=manifest.samples[index],previous=manifest.samples[index-1];
 if(!Number.isSafeInteger(caught)||!previous||previous.emulatedFrame!==start.emulatedFrame-1||(previous.state.spriteAttributes[10]>>2)>=52)throw Error('Missing adjacent death onset evidence');
 return {deathCatchFrame:caught,deathAnimationStartFrame:start.emulatedFrame};
}
export function compareReplayImages(reference,actual,dimensions,state={}){
 if([reference,actual].some(p=>p.width!==dimensions.width||p.height!==dimensions.height)||dimensions.width!==224||dimensions.height!==288)throw Error('Declared dimensions disagree with native images');
 const actors={};
 for(const [name,actor]of [['pacman',state.pacman],...(state.ghosts??[]).map(g=>[g.color,g])])if(actor?.visible){
  const x=Math.max(0,Math.floor(actor.position.x-8)),y=Math.max(0,Math.floor(actor.position.y+16));
  const right=Math.min(224,Math.ceil(actor.position.x+8)),bottom=Math.min(288,Math.ceil(actor.position.y+32));
  if(right>x&&bottom>y)actors[`actor-${name}`]={x,y,width:right-x,height:bottom-y};
 }
 const result=compareImages(reference,actual,{...actors,hud:{x:0,y:0,width:224,height:24},maze:{x:0,y:24,width:224,height:248},footer:{x:0,y:272,width:224,height:16},actors:{x:0,y:24,width:224,height:248}});
 return {status:result.whole.differingPixels?'fail':'pass',...result};
}
export function assertReplayIsolation(before,after,commands){
 if(commands.length)throw Error('Replay sent a gameplay command or other WebSocket message');
 if(!isDeepStrictEqual(before,after))throw Error('Replay changed real server state');
}
async function observe(page){
 return page.evaluate(async()=>{
  await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
  const screen=document.querySelector('[data-arcade-screen]').getBoundingClientRect();
  const actors=[...document.querySelectorAll('.pacman-position,.ghost')].map(el=>{
   const bounds=el.getBoundingClientRect(),sprite=el.querySelector('.sprite'),style=getComputedStyle(sprite);
   return {actor:el.className,x:bounds.x-screen.x,y:bounds.y-screen.y,width:bounds.width,height:bounds.height,
    backgroundImage:style.backgroundImage,backgroundPosition:style.backgroundPosition,backgroundSize:style.backgroundSize};
  });
  return {paintedFrame:window.__sequencePaint.frame,paintTimestamp:window.__sequencePaint.timestamp,
   capture:window.__arcadeVisual.snapshotMetadata(),dimensions:{width:screen.width,height:screen.height},actors};
 });
}
export function validateRenderedSequence(root,manifest,definition){
 validateSequence(manifest);if(manifest.kind!=='renderer-actual')throw Error('Expected renderer actual');
 validateCheckpointCoverage(manifest.samples,manifest.provenance.checkpoints,definition);
 const isolation=read(artifact(root,manifest.provenance.isolation));assertReplayIsolation(isolation.before,isolation.after,isolation.commands);
 artifact(root,manifest.provenance.adapterEvidence);artifact(root,manifest.provenance.comparisons);
 for(const sample of manifest.samples){
  const bytes=fs.readFileSync(artifact(root,sample.image)),png=PNG.sync.read(bytes);
  if(png.width!==sample.dimensions.width||png.height!==sample.dimensions.height)throw Error('Actual PNG dimensions mismatch');
  for(const relative of sample.alignment.evidence)artifact(root,relative);
  const evidence=read(artifact(root,sample.alignment.evidence[0]));
  const input=validateArcadeCaptureState(read(artifact(root,evidence.canonicalInput)));
  if(evidence.pngSha256!==sha(bytes)||evidence.inputSha256!==sha(fs.readFileSync(artifact(root,evidence.canonicalInput)))
    ||evidence.after.paintedFrame!==sample.paintedFrame||evidence.before.paintedFrame>=evidence.after.paintedFrame
    ||!isDeepStrictEqual(evidence.before.actors,evidence.after.actors)
    ||!isDeepStrictEqual(evidence.before.dimensions,sample.dimensions)||!isDeepStrictEqual(evidence.after.dimensions,sample.dimensions)
    ||!isDeepStrictEqual(evidence.after.capture.state,input)||!isDeepStrictEqual(evidence.before.capture,evidence.after.capture)
    ||!isDeepStrictEqual(evidence.sourceState,sample.state))throw Error('Invalid browser paint association');
 }
 return manifest;
}
function contactSheets(out,folder,reference,actual){
 const interesting=new Set(Object.values(reference.provenance.checkpoints).flatMap(c=>[c.firstFrame,c.lastFrame]));
 for(let i=1;i<reference.samples.length;i++)if(reference.samples[i].state.spriteAttributes[10]!==reference.samples[i-1].state.spriteAttributes[10])for(const n of [-1,0,1])interesting.add(reference.samples[i].emulatedFrame+n);
 const rows=actual.samples.filter(s=>interesting.has(s.emulatedFrame)),index=[];
 for(let base=0;base<rows.length;base+=8){const selected=rows.slice(base,base+8),sheet=new PNG({width:224*3,height:288*selected.length});
  selected.forEach((sample,row)=>{const images=[`${folder}/reference/${sample.id}.png`,sample.image,`${folder}/difference/${sample.id}.png`];images.forEach((file,col)=>PNG.bitblt(PNG.sync.read(fs.readFileSync(path.join(out,file))),sheet,0,0,224,288,col*224,row*288));index.push({id:sample.id,emulatedFrame:sample.emulatedFrame,sheet:`${folder}/contact-${base/8}.png`,row,columns:images});});
  fs.writeFileSync(path.join(out,folder,`contact-${base/8}.png`),PNG.sync.write(sheet));
 }
 write(path.join(out,folder,'contact-sheet.json'),index);
}
export async function renderSequences({reference,out}){
 reference=path.resolve(reference);out=path.resolve(out);
 fs.mkdirSync(out,{recursive:true});if(fs.readdirSync(out).length)throw Error('Output directory must be empty');
 const referenceIndex=read(path.join(reference,'index.json')),index=makeReplayIndex(referenceIndex);write(path.join(out,'index.json'),index);
 fs.copyFileSync(new URL('./arcade-state-evidence.md',import.meta.url),path.join(out,'adapter-evidence.md'));
 fs.copyFileSync(new URL('./evidence/initial-adapter-observations.json',import.meta.url),path.join(out,'adapter-observations.json'));
 const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'sequence-replay-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 try {
  const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());
  const page=await browser.newPage({viewport:{width:224,height:352},deviceScaleFactor:1});const commands=[],errors=[];
  page.on('websocket',socket=>socket.on('framesent',frame=>commands.push(String(frame.payload))));page.on('pageerror',error=>errors.push(error.message));
  await page.addInitScript(()=>{window.__sequencePaint={frame:0,timestamp:0};const painted=t=>{window.__sequencePaint.frame++;window.__sequencePaint.timestamp=t;requestAnimationFrame(painted);};requestAnimationFrame(painted);});
  await page.goto(`http://localhost:${port}/?timeline=1&visual=1&ws=${ws}&bot=off&mode=arcade`);
  await page.waitForFunction(()=>window.__arcadeTimeline?.state());
  const before=await page.evaluate(()=>window.__arcadeTimeline.state());
  const isolation={before,after:before,commands};write(path.join(out,'isolation.json'),isolation);
  for(const entry of index.sequences){
   const sourceEntry=referenceIndex.sequences.find(e=>e.checkId===entry.checkId),definition=requiredChecks(index.scope).find(d=>d.id===entry.checkId);
   if(sourceEntry?.status!=='recorded'||definition.category!=='full-screen')continue;

   try {
    const sourceFile=artifact(reference,sourceEntry.manifest),source=read(sourceFile);validateRecordedSequence(reference,source,definition);
    const clock={...deathClock(source),...(source.provenance.pacmanFacing?{pacmanFacing:source.provenance.pacmanFacing}:{})},folder=source.scenario;
    for(const sub of ['actual','reference','difference','inputs','evidence'])fs.mkdirSync(path.join(out,folder,sub),{recursive:true});
    const actual={version:2,kind:'renderer-actual',scenario:source.scenario,provenance:{artifactBase:'index-root',
     sourceManifestSha256:sha(fs.readFileSync(sourceFile)),checkpoints:source.provenance.checkpoints,observedInterval:source.provenance.observedInterval,
     adapterEvidence:'adapter-evidence.md',isolation:'isolation.json',comparisons:`${folder}/comparisons.json`,contactSheets:`${folder}/contact-sheet.json`,
     excludedOverlay:'[data-game-controls]',capture:'native224x288; no normalization, actor alignment, masking or frame overrides',
     observer:'two browser animation callbacks before screenshot; stable canonical input and DOM actor observations across screenshot',clock},samples:[]};
    const reports=[];
    for(const sample of source.samples){
     const canonical=adaptArcadeState(sample.state,{...clock,emulatedFrame:sample.emulatedFrame}),input=`${folder}/inputs/${sample.id}.json`;
     write(path.join(out,input),canonical);await page.evaluate(state=>window.__arcadeVisual.setArcadeState(state),canonical);
     const first=await observe(page),image=`${folder}/actual/${sample.id}.png`;
     const bytes=await page.locator('[data-arcade-screen]').screenshot({path:path.join(out,image),style:'[data-game-controls] { visibility: hidden !important; }',animations:'allow'});
     const last=await observe(page);if(!isDeepStrictEqual(first.capture,last.capture)||!isDeepStrictEqual(first.capture.state,canonical))throw Error('Capture input changed during screenshot');
     const evidence=`${folder}/evidence/${sample.id}.json`;
     write(path.join(out,evidence),{method:'browser-stable-paint-v1',before:first,after:last,canonicalInput:input,inputSha256:sha(fs.readFileSync(path.join(out,input))),pngSha256:sha(bytes),sourceState:sample.state});
     actual.samples.push({...sample,image,paintedFrame:last.paintedFrame,alignment:{method:'browser-stable-paint-v1',paintedFrame:last.paintedFrame,state:sample.state,evidence:[evidence,input]}});
     const referenceBytes=fs.readFileSync(artifact(reference,sample.image));fs.writeFileSync(path.join(out,folder,'reference',`${sample.id}.png`),referenceBytes);
     const {difference,...measurement}=compareReplayImages(PNG.sync.read(referenceBytes),PNG.sync.read(bytes),sample.dimensions,canonical);
     fs.writeFileSync(path.join(out,folder,'difference',`${sample.id}.png`),PNG.sync.write(difference));reports.push({id:sample.id,emulatedFrame:sample.emulatedFrame,...measurement});
     if(actual.samples.length%100===0)console.log(`${source.scenario}: ${actual.samples.length}/${source.samples.length} compared`);
    }
    const matched=matchSamples(source,actual);if(matched.issues.length||matched.pairs.length!==source.samples.length)throw Error('Replay source identity mismatch');
    write(path.join(out,folder,'comparisons.json'),reports);contactSheets(out,folder,source,actual);
    isolation.after=await page.evaluate(()=>window.__arcadeTimeline.state());write(path.join(out,'isolation.json'),isolation);
    validateRenderedSequence(out,actual,definition);
    if(errors.length)throw Error(`Browser errors: ${errors.join('; ')}`);
    const manifest=`${folder}/manifest.json`;write(path.join(out,manifest),actual);
    Object.assign(entry,{status:'recorded',manifest,comparisonStatus:reports.some(r=>r.status==='fail')?'fail':'pass',comparedSamples:reports.length});delete entry.reason;
   }catch(error){entry.status='unavailable';entry.reason=error.message;console.error(`${entry.checkId}: ${error.message}`);}
   write(path.join(out,'index.json'),index);
  }
  isolation.after=await page.evaluate(()=>window.__arcadeTimeline.state());write(path.join(out,'isolation.json'),isolation);assertReplayIsolation(before,isolation.after,commands);
  await page.evaluate(()=>window.__arcadeVisual.clearFixture());
  write(path.join(out,'environment.json'),{browser:await browser.version(),viewport:{width:224,height:352},deviceScaleFactor:1,pageErrors:errors,commands});
  return index;
 }finally{await cleanup.run();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const arg=name=>{const i=process.argv.indexOf(name);if(i<0||!process.argv[i+1])throw Error(`Required ${name}`);return process.argv[i+1];};
 try{const index=await renderSequences({reference:arg('--reference'),out:arg('--out')});
  const expected=new Set(requiredChecks(index.scope).filter(d=>['full-screen','artwork'].includes(d.category)).map(d=>d.id));
  const results=index.sequences.filter(e=>expected.has(e.checkId));
  console.log(`${results.filter(e=>e.status==='recorded').length}/${results.length} renderer sequences recorded; ${results.filter(e=>e.comparisonStatus==='pass').length} fidelity passes`);
  if(results.some(e=>e.status!=='recorded'||e.comparisonStatus!=='pass'))process.exitCode=1;
 }catch(error){console.error(error.message);process.exitCode=1;}
}
