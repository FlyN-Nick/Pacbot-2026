// Small local-only history for distinguishing server pauses, arcade holds and bot controls.
export function createPauseTrace({limit=128,now=()=>performance.now()}={}){
 let entries=[];
 return {record(type,detail={}){entries.push(structuredClone({at:now(),type,...detail}));if(entries.length>limit)entries=entries.slice(-limit);},events(){return structuredClone(entries);}};
}
