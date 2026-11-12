// This opt-in API changes only presentation state. It never touches the socket,
// command dispatcher or live game stores. Legacy artwork fixtures stay separate.
export function validateArcadeCaptureState(state) {
 if(state?.schema!=='arcade-render-v1')throw Error('Invalid canonical state');
 const rejectOverrides=value=>{
  if(!value||typeof value!=='object')return;
  for(const [key,child]of Object.entries(value)){
   if(key==='frame'||key==='frameOverride')throw Error('Frame overrides cannot be used for sequence replay');
   rejectOverrides(child);
  }
 };
 rejectOverrides(state);
 return state;
}
export function createVisualCapture(search,target,onChange){
 if(new URLSearchParams(search).get('visual')!=='1')return null;
 let fixture=null;
 const api={
  setArcadeState(state){
   validateArcadeCaptureState(state);
   fixture={kind:'arcade',state:structuredClone(state),phase:0};onChange(fixture);
  },
  setFixture(state,phase=0){
   if(!state||typeof state!=='object'||!Number.isFinite(phase))throw Error('Invalid fixture');
   fixture={state:structuredClone(state),phase};onChange(fixture);
  },
  clearFixture(){fixture=null;onChange(null);},
  snapshotMetadata(){return structuredClone(fixture);},
 };
 target.__arcadeVisual=api;return api;
}
