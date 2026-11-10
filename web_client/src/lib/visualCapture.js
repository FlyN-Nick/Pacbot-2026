export function createVisualCapture(search,target,onChange){
 if(new URLSearchParams(search).get('visual')!=='1')return null;
 let fixture=null;
 const api={setFixture(state,phase=0){if(!state||typeof state!=='object'||!Number.isFinite(phase))throw Error('Invalid fixture');fixture={state:structuredClone(state),phase};onChange(fixture);},clearFixture(){fixture=null;onChange(null);},snapshotMetadata(){return structuredClone(fixture);}};
 target.__arcadeVisual=api;return api;
}
