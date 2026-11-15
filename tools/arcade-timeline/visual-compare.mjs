import fs from 'node:fs';import path from 'node:path';import {pathToFileURL} from 'node:url';import {PNG} from 'pngjs';import {normalizeCapture,validateCapture} from './visual-captures.mjs';
export function compareImages(a,b,regions={}){
 if(a.width!==b.width||a.height!==b.height||a.data.length!==a.width*a.height*4||b.data.length!==b.width*b.height*4)throw Error('Image dimensions differ or data is invalid');
 const difference={width:a.width,height:a.height,data:Buffer.alloc(a.data.length)};
 const changed=new Uint8Array(a.width*a.height);
 for(let p=0;p<changed.length;p++){const i=p*4;changed[p]=[0,1,2,3].some(c=>a.data[i+c]!==b.data[i+c])?1:0;difference.data[i]=changed[p]?255:0;difference.data[i+1]=0;difference.data[i+2]=changed[p]?255:0;difference.data[i+3]=255;}
 function measure(r){if(![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<1||r.height<1||r.x+r.width>a.width||r.y+r.height>a.height)throw Error('Invalid region');let count=0;for(let y=r.y;y<r.y+r.height;y++)for(let x=r.x;x<r.x+r.width;x++)count+=changed[y*a.width+x];return {differingPixels:count,pixels:r.width*r.height,ratio:count/(r.width*r.height)};}
 return {whole:measure({x:0,y:0,width:a.width,height:a.height}),regions:Object.fromEntries(Object.entries(regions).map(([k,r])=>[k,measure(r)])),difference};
}
export function compareCapturePair(reference,actual){if(!reference)return{status:'missing reference'};if(reference.state!==actual.state)return{status:'state mismatch'};if(reference.phase!==actual.phase)return{status:'phase mismatch'};return{status:'aligned'};}
function main(){
 const arg=n=>{const i=process.argv.indexOf(n);if(i<0||!process.argv[i+1])throw Error(`Required ${n}`);return path.resolve(process.argv[i+1]);};
 const ref=arg('--reference'),actual=arg('--actual'),out=arg('--out');fs.mkdirSync(out,{recursive:true});
 const read=dir=>JSON.parse(fs.readFileSync(path.join(dir,'manifest.json'),'utf8')).captures.map(validateCapture);
 const refs=read(ref),captures=read(actual),reports=[];
 const key=c=>`${c.scenario}:${c.anchor}:${c.frameOffset}:${c.state}:${c.phase}`;
 for(const [i,c]of captures.entries()){
  const r=refs.find(r=>key(r)===key(c))??refs.find(r=>r.scenario===c.scenario&&r.anchor===c.anchor&&r.frameOffset===c.frameOffset);const report={key:key(c),...compareCapturePair(r,c)};
  if(r&&report.status==='aligned'){try{
   const load=(dir,c)=>{
    const image=PNG.sync.read(fs.readFileSync(path.join(dir,c.image)));
    if(image.width!==c.dimensions.width||image.height!==c.dimensions.height)throw Error('Declared dimensions differ from PNG');
    const normalized=normalizeCapture(image,c.normalization);
    compareImages(normalized,normalized,c.regions); // Validate both manifests' region bounds.
    return normalized;
   };
   const regionSignature=c=>JSON.stringify(Object.entries(c.regions).sort(([a],[b])=>a.localeCompare(b)).map(([name,r])=>[name,r.x,r.y,r.width,r.height]));
   if(regionSignature(r)!==regionSignature(c))throw Error('Capture regions differ');
   const a=load(ref,r),b=load(actual,c),result=compareImages(a,b,r.regions);
   report.whole=result.whole;report.regions=result.regions;
   // Live scenes are diagnostic even if their coarse event metadata matches.
   report.status=r.provenance?.kind==='fixture'&&c.provenance?.kind==='fixture'?(result.whole.differingPixels?'fail':'pass'):'diagnostic';
   for(const [name,image]of [['reference',a],['actual',b],['difference',result.difference]])fs.writeFileSync(path.join(out,`${i}-${name}.png`),PNG.sync.write(image));
  }catch(e){report.status='invalid';report.error=e.message;}}
  reports.push(report);
 }
 if(!captures.length)reports.push({status:'no captures'});
 for(const r of refs)if(!captures.some(c=>key(r)===key(c)))reports.push({key:key(r),status:'missing actual'});
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(reports,null,2)+'\n');
 console.log(reports.map(r=>`${r.key??'captures'} ${r.status.toUpperCase()}${r.whole?` ${r.whole.differingPixels}/${r.whole.pixels} pixels`:''}`).join('\n'));
 if(reports.some(r=>r.status!=='pass'))process.exitCode=1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)try{main();}catch(e){console.error(e.message);process.exitCode=1;}
