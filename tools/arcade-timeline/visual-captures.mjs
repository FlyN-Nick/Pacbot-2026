export function validateCapture(c) {
  if (c?.version !== 1 || !['gui','mame'].includes(c.source)) throw Error('Invalid capture version/source');
  for (const key of ['scenario','anchor','state','image']) if (typeof c[key] !== 'string' || !c[key]) throw Error(`Missing ${key}`);
  if (!Number.isInteger(c.frameOffset) || !Number.isFinite(c.phase)) throw Error('Missing frame/phase');
  if (!c.dimensions || ![c.dimensions.width,c.dimensions.height].every(n=>Number.isInteger(n)&&n>0)) throw Error('Invalid dimensions');
  if (!c.normalization || !c.regions) throw Error('Missing geometry');
  return c;
}
export function normalizeCapture(image, {crop, rotate=0, scale=1}={}) {
  if (![0,90,180,270].includes(rotate) || !Number.isInteger(scale) || scale<1) throw Error('Invalid transform');
  const r=crop ?? {x:0,y:0,width:image.width,height:image.height};
  if (![r.x,r.y,r.width,r.height].every(Number.isInteger)||r.x<0||r.y<0||r.width<=0||r.height<=0||r.x+r.width>image.width||r.y+r.height>image.height||r.width%scale||r.height%scale) throw Error('Invalid crop');
  const w=r.width/scale,h=r.height/scale;
  const out={width:rotate%180?h:w,height:rotate%180?w:h,data:Buffer.alloc(w*h*4)};
  for(let y=0;y<h;y++) for(let x=0;x<w;x++) {
    const [ox,oy]=rotate===90?[h-1-y,x]:rotate===180?[w-1-x,h-1-y]:rotate===270?[y,w-1-x]:[x,y];
    const src=((r.y+y*scale)*image.width+r.x+x*scale)*4;
    image.data.copy(out.data,(oy*out.width+ox)*4,src,src+4);
  }
  return out;
}
