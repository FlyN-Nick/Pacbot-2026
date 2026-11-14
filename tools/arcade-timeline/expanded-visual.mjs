// Source-sheet artwork and composition are separate from full-screen MAME
// fidelity. No reference is generated from the current browser renderer.
import fs from'node:fs';import path from'node:path';import os from'node:os';import{pathToFileURL}from'node:url';import{createHash}from'node:crypto';
import{countBoundaryPixels}from'./sprite-boundary-browser.mjs';
export{countBoundaryPixels};
import{PNG}from'pngjs';import{visualFixtures}from'./visual-scenarios.mjs';import{requiredChecks}from'./sequence-coverage.mjs';import{compareImages}from'./visual-compare.mjs';
import{createCleanup}from'./processes.mjs';import{launchBrowser,startGameServer,startVisualizer}from'./run.mjs';
const blankPellets=()=>Array.from({length:31},()=>Array(28).fill(0));
// Independent policy references: original initial MAME painted tiles and
// Jamey Pittman's Pac-Man Dossier, appendix A / split-screen counter analysis.
// Expected values are literal; no HUD or sprite selectors are imported here.
const hudExpectations={zero:{score:'00',highScore:'',lives:2,fruits:['cherry']},'repeated-fruit':{score:'12340',highScore:'20000',lives:0,fruits:['cherry','strawberry','orange','orange']},'history-overflow':{score:'999990',highScore:'999990',lives:4,fruits:['strawberry','orange','orange','apple','apple','melon','melon']},'late-keys':{score:'123450',highScore:'999990',lives:0,fruits:['key','key','key','key','key','key','key']}};
export function artworkCases(){
 const result=[],fixtures=visualFixtures(),add=(checkId,checkpoint,fixture,expectedFrames)=>result.push({checkId,checkpoint,...fixture,expectedFrames});
 for(const direction of ['right','left','up','down']) {
  for(let f=0;f<=16;f++){const phase=f*16.5,step=Math.floor(f/4),fixture=fixtures.find(c=>c.name===`pacman-${direction}-${step%4}`);add(`artwork:mouth-${direction}`,f%4===0&&f<16?`frame-${step}`:'mouth-cycle',{...fixture,phase},[`pacman-${direction}-${[0,1,2,1,0][step]}`]);}
  for(const color of ['red','pink','cyan','orange'])for(let f=0;f<2;f++)add(`artwork:ghost-${color}-${direction}`,`foot-${f}`,fixtures.find(c=>c.name===`ghost-${color}-${direction}-${f}`),[`ghost-${color}-${direction}-${f}`]);
  add(`artwork:eyes-${direction}`,'eyes-visible',fixtures.find(c=>c.name===`eyes-${direction}`),[`eyes-${direction}`]);
 }
 for(const color of ['blue','white'])for(let f=0;f<2;f++)add('artwork:fright-restoration',`${color}-foot-${f}`,fixtures.find(c=>c.name===`fright-${color}-${f}`),[`fright-${color}-${f}`]);
 add('artwork:fright-restoration','normal-restored',fixtures.find(c=>c.name==='ghost-red-left-0'),['ghost-red-left-0']);
 for(let f=0;f<13;f++)add('artwork:death-art',`frame-${f}`,fixtures.find(c=>c.name===`death-${f}`),[f===0?'pacman-up-0':f===12?'blank':`death-${f-1}`]);
 add('artwork:ready-art','ready-visible',{name:'ready-art',phase:0,state:{ready:true,pellets:blankPellets()}},[]);
 for(const d of requiredChecks('full').filter(d=>d.category==='artwork'&&d.hud))result.push({checkId:d.id,checkpoint:'hud',name:d.scenario,state:{...d.hud,pellets:blankPellets()},phase:0,expectedFrames:[],expectedHud:hudExpectations[d.hud.name]});
 return result;
}
export function compositionBoundaryStatus(composition){return !composition.length?'incomplete':composition.every(c=>c.stats.unexpected===0)?'pass':'fail';}
export function inspectComposition(png,palette){let background=0,foreground=0,unexpected=0;for(let i=0;i<png.data.length;i+=4){const rgb=[...png.data.subarray(i,i+3)].join(',');if(rgb==='18,120,90'&&png.data[i+3]===255)background++;else if(palette.has(rgb)&&png.data[i+3]===255)foreground++;else unexpected++;}return{background,foreground,unexpected};}
const sourceFiles={general:'Arcade - Pac-Man - Miscellaneous - General Sprites.png',text:'Arcade - Pac-Man - Miscellaneous - Text.png',hud:'Arcade - Pac-Man - Miscellaneous - Attract Mode & HUD Assets.png',punctuation:'Arcade - Pac-Man - Miscellaneous - All Assets_Palettes.png'};
// Independent extraction coordinates from the archived user source sheets.
function sourceRect(frame){
 let m;if(m=frame.match(/^pacman-(right|left|up|down)-(\d)$/))return['general',456+16*Number(m[2]),16*['right','left','up','down'].indexOf(m[1]),16,16];
 if(m=frame.match(/^ghost-(red|pink|cyan|orange)-(right|left|up|down)-(\d)$/))return['general',456+32*['right','left','up','down'].indexOf(m[2])+16*Number(m[3]),64+16*['red','pink','cyan','orange'].indexOf(m[1]),16,16];
 if(m=frame.match(/^fright-(blue|white)-(\d)$/))return['general',584+(m[1]==='white'?32:0)+16*Number(m[2]),64,16,16];
 if(m=frame.match(/^eyes-(right|left|up|down)$/))return['general',584+16*['right','left','up','down'].indexOf(m[1]),80,16,16];
 if(m=frame.match(/^death-(\d+)$/))return['general',504+16*Number(m[1]),0,16,16];
 if(frame==='blank')return['general',664,224,16,16];if(frame==='life')return['hud',928,176,16,16];
 if(frame.startsWith('fruit-'))return['general',504+16*['cherry','strawberry','orange','apple','melon','galaxian','bell','key'].indexOf(frame.slice(6)),48,16,16];
 if(frame==='glyph-yellow-!')return['punctuation',509,205,8,8];
 if(m=frame.match(/^glyph-(white|yellow|red)-(.)$/)){const lines=['ABCDEFGHIJKLMNO','PQRSTUVWXYZ/-.','0123456789'],row=lines.findIndex(s=>s.includes(m[2]));if(row>=0)return['text',lines[row].indexOf(m[2])*8,({white:0,red:32,yellow:192}[m[1]])+row*8,8,8];}
 throw Error(`No independent source rectangle for ${frame}`);
}
function reference(frame,sources,bg=[0,0,0]){const[key,x,y,width,height]=sourceRect(frame),source=sources[key],p=new PNG({width,height});for(let yy=0;yy<height;yy++)for(let xx=0;xx<width;xx++){const i=((y+yy)*source.width+x+xx)*4,j=(yy*width+xx)*4;let rgb=[...source.data.subarray(i,i+3)];if(frame==='life'&&rgb[0]===0&&rgb[1]>100&&rgb[2]===0)rgb=[0,0,0];if(rgb.every(c=>c===0))rgb=bg;p.data.set([...rgb,255],j);}return p;}
const write=(file,value)=>fs.writeFileSync(file,JSON.stringify(value,null,2)+'\n');
const sha=b=>createHash('sha256').update(b).digest('hex');
export async function runExpandedVisual({outDir,sourceDir=path.resolve(import.meta.dirname,'../../.local-assets/sprites'),displayIds=['native','fractional','retina']}) {
 outDir=path.resolve(outDir);fs.mkdirSync(outDir,{recursive:true});if(fs.readdirSync(outDir).length)throw Error('Visual output must be empty');
 const definitions=requiredChecks('full').filter(d=>['artwork','compositing'].includes(d.category)),checks=definitions.map(d=>({checkId:d.id,category:d.category,scenario:d.scenario,status:'incomplete',checkpoints:d.checkpoints.map(p=>({id:p.id,status:'incomplete',reason:'Not observed',evidence:[]}))}));
 const save=()=>write(path.join(outDir,'index.json'),{version:2,checks});save();const sources={};
 try {fs.mkdirSync(path.join(outDir,'source'));for(const[key,file]of Object.entries(sourceFiles)){const bytes=fs.readFileSync(path.join(sourceDir,file));sources[key]=PNG.sync.read(bytes);fs.writeFileSync(path.join(outDir,'source',`${key}.png`),bytes);} }
 catch(error){for(const c of checks)for(const p of c.checkpoints)p.reason=error.message;save();return checks;}
 write(path.join(outDir,'provenance.json'),{reference:'Archived user source sheets; extraction coordinates independent of runtime catalog',sourceHashes:Object.fromEntries(Object.entries(sourceFiles).map(([key,file])=>[file,sha(fs.readFileSync(path.join(sourceDir,file)))])),hudPolicy:'https://pacman.holenet.info/ (appendix A; seven-symbol counter discussion); initial MAME footer and score tiles',categories:'Artwork/compositing cannot satisfy full-screen fidelity',fixtures:true,frameOverrides:false,excludedOverlay:'[data-game-controls]',displayObservation:'Screenshot dimensions and actual CSS screen bounds retained'});
 const cleanup=createCleanup();cleanup.installSignalHandlers();const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'expanded-visual-'));cleanup.add(()=>fs.rmSync(tmp,{recursive:true,force:true}));
 const record=(id,checkpoint,status,evidence,reason)=>{const c=checks.find(c=>c.checkId===id),p=c?.checkpoints.find(p=>p.id===checkpoint);if(p){p.status=p.status==='fail'?'fail':status;p.reason=reason;p.evidence.push(evidence);}};
 try {
  const ws=await startGameServer(tmp,cleanup),port=await startVisualizer(tmp,cleanup),browser=await launchBrowser();cleanup.add(()=>browser.close());const cases=artworkCases();
  for(const display of requiredChecks('full').filter(d=>d.category==='compositing'&&d.scenario==='sprite-boundaries').map(d=>d.display).filter(d=>displayIds.includes(d.id))) {
   const page=await browser.newPage({viewport:{width:Math.ceil(display.width),height:display.id==='fractional'?304:Math.ceil(display.height)+64},deviceScaleFactor:display.deviceScaleFactor});
   await page.goto(`http://localhost:${port}/?timeline=1&visual=1&mode=arcade&bot=off&ws=${ws}`);await page.waitForFunction(()=>window.__arcadeVisual);
   await page.addStyleTag({content:'[data-game-controls] {visibility:hidden!important}'});
   // Controlled display test: uniform whole-screen1.3 scale of native224x288.
   // This never runs in the MAME fidelity pipeline or scales actors separately.
   if(display.id==='fractional')await page.evaluate(()=>{const el=document.querySelector('[data-arcade-screen]'),b=el.getBoundingClientRect();if(b.width!==224||b.height!==288)throw Error('Fractional setup requires native screen');el.style.transformOrigin='top left';el.style.transform='scale(1.3)';});
   const dir=path.join(outDir,display.id);fs.mkdirSync(dir);const observations=[];
   for(const [index,c]of cases.entries()) {
    await page.evaluate(({state,phase})=>{window.__arcadeVisual.setFixture(state,phase);document.querySelectorAll('.grid-element').forEach(el=>el.style.backgroundColor='');},c);await page.waitForFunction(()=>[...document.querySelectorAll('.grid-element')].every(el=>getComputedStyle(el).backgroundColor==='rgba(0, 0, 0, 0)'));await page.evaluate(()=>new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r))));
    const image=`${display.id}/${index}.png`,bytes=await page.locator('[data-arcade-screen]').screenshot({path:path.join(outDir,image)});
    const observation=await page.evaluate(()=>({screen:(()=>{const b=document.querySelector('[data-arcade-screen]').getBoundingClientRect();return{width:b.width,height:b.height};})(),actors:[...document.querySelectorAll('.pacman-position .sprite,.ghost .sprite')].map(e=>e.dataset.frame),scores:[...document.querySelectorAll('.hud .score')].map(e=>[...e.querySelectorAll('.sprite')].map(s=>s.dataset.frame.slice(-1)).join('')),lives:document.querySelectorAll('.hud .lives .sprite').length,fruits:[...document.querySelectorAll('.hud .fruits .sprite')].map(e=>e.dataset.frame.slice(6)),ready:[...document.querySelectorAll('.ready-banner .sprite')].map(e=>e.dataset.frame)}));
    const png=PNG.sync.read(bytes);observations.push({case:c,observation,image,dimensions:{width:png.width,height:png.height},sha256:sha(bytes)});
    if(display.id==='native') {
     if(c.expectedHud){const expected=c.expectedHud;for(const[key,actual,want]of [['score',observation.scores[0],expected.score],['high-score',observation.scores[1]??'',expected.highScore],['lives',observation.lives,expected.lives],['fruit-history',observation.fruits,expected.fruits]])record(c.checkId,key,JSON.stringify(actual)===JSON.stringify(want)?'pass':'fail',image,'Literal independent HUD policy; source glyph pixel comparisons retained below.');}
     else record(c.checkId,c.checkpoint,JSON.stringify(observation.actors)===JSON.stringify(c.expectedFrames)&&(!c.name.includes('ready')||observation.ready.length===6)?'pass':'fail',image,'Semantic phase selected visible expected artwork.');
    }
    const sprites=page.locator(c.expectedHud?'.hud .sprite':c.name==='ready-art'?'.ready-banner .sprite':'.pacman-position .sprite,.ghost .sprite'),frames=await sprites.evaluateAll(es=>es.map(e=>e.dataset.frame));
    const group=c.checkId.includes('mouth-')?'directional-mouth':c.checkId.includes('death-art')?'death-art':c.checkId.includes('hud-')||c.checkId.includes('ready-art')?'hud-glyphs':'ghost-feet';
    for(let n=0;display.id==='native'&&n<frames.length;n++) {
     const frame=frames[n],expected=reference(frame,sources),actual=PNG.sync.read(await sprites.nth(n).screenshot());
     if(display.id==='native') {
      const equal=actual.width===expected.width&&actual.height===expected.height&&compareImages(expected,actual).whole.differingPixels===0;
      if(!equal){const evidence=`${display.id}/${index}-${n}`;fs.writeFileSync(path.join(outDir,evidence+'-reference.png'),PNG.sync.write(expected));fs.writeFileSync(path.join(outDir,evidence+'-actual.png'),PNG.sync.write(actual));record(c.checkId,c.expectedHud?(frame.startsWith('fruit-')?'fruit-history':frame==='life'?'lives':'score'):c.checkpoint,'fail',evidence+'-actual.png','Source-sheet pixel mismatch; no offsets or tolerance applied.');}
     }
    }
    // Repeat on a colored maze, preserving the source transparency. Palette
    // contamination or black pixels are failures even at fractional density.
    await page.evaluate(()=>document.querySelectorAll('.grid-element').forEach(el=>el.style.backgroundColor='#12785a'));
    await page.waitForFunction(()=>[...document.querySelectorAll('.grid-element')].every(el=>getComputedStyle(el).backgroundColor==='rgb(18, 120, 90)'));
    const actors=page.locator('.pacman-position .sprite,.ghost .sprite');let valid=true,gutters=true,totalBackground=0,totalForeground=0;const composition=[];
    for(let n=0;n<await actors.count();n++) {const frame=await actors.nth(n).getAttribute('data-frame'),expected=reference(frame,sources,[18,120,90]),palette=new Set();for(let i=0;i<expected.data.length;i+=4){const rgb=[...expected.data.subarray(i,i+3)].join(',');if(rgb!=='18,120,90')palette.add(rgb);}const composed=PNG.sync.read(await actors.nth(n).screenshot({path:path.join(dir,`${index}-colored-${n}.png`)})),stats=inspectComposition(composed,palette);const boundaryPixels=countBoundaryPixels(composed,(r,g,b)=>r!==18||g!==120||b!==90);composition.push({frame,image:`${display.id}/${index}-colored-${n}.png`,stats,boundaryPixels,sha256:sha(PNG.sync.write(composed))});valid&&=stats.unexpected===0;gutters&&=boundaryPixels===0;totalBackground+=stats.background;totalForeground+=stats.foreground;}
    observations.at(-1).composition=composition;
    const evidence=`${display.id}/observations.json`;
    record(`compositing:sprite-boundaries:${display.id}`,group,compositionBoundaryStatus(composition),evidence,!composition.length?'No colored composition pixels measured for this checkpoint; source crops and screenshots do not establish composition.':'Visible sprites use only source foreground and colored-map background.');
    if(await actors.count()) {
     record(`compositing:colored-map-alpha:${display.id}`,'transparent-background',valid&&totalBackground>0?'pass':'fail',evidence,'Colored map is visible through sprite background.');
     record(`compositing:colored-map-alpha:${display.id}`,'opaque-foreground',valid&&(c.expectedFrames[0]==='blank'||totalForeground>0)?'pass':'fail',evidence,'Foreground remains an opaque source color.');
     record(`compositing:colored-map-alpha:${display.id}`,'colored-map-visible',totalBackground>0?'pass':'fail',evidence,'Colored background pixels actually observed.');
     record(`compositing:sprite-gutters:${display.id}`,'no-neighbor-sampling',valid&&gutters?'pass':'fail',evidence,'No same-palette or foreign artwork on transparent outer boundary at sampled display density.');
    }
    write(path.join(dir,'observations.json'),observations);
   }
   await page.close();
  }
 }finally{await cleanup.run();for(const c of checks){if(c.checkId.startsWith('artwork:mouth-')){const p=c.checkpoints.find(p=>p.id==='mouth-cycle');if(p.status==='pass'&&p.evidence.length!==13){p.status='incomplete';p.reason='Dense controlled cycle not completed';}}c.status=c.checkpoints.some(p=>p.status==='fail')?'fail':c.checkpoints.every(p=>p.status==='pass')?'pass':'incomplete';}save();}
 return checks;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){const out=process.argv[process.argv.indexOf('--out')+1];runExpandedVisual({outDir:out,...(process.argv.includes('--display')?{displayIds:[process.argv[process.argv.indexOf('--display')+1]]}:{})}).then(checks=>{console.log(JSON.stringify(checks.map(c=>({checkId:c.checkId,status:c.status})),null,2));if(checks.some(c=>c.status!=='pass'))process.exitCode=1;}).catch(e=>{console.error(e);process.exitCode=1;});}
