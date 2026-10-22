// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed66 fixed keyboard chain only: no arbitrary key/call/coordinate RPC.
export {boundedJson} from '../selection-native/protocol.mjs';
export const limits=Object.freeze({commands:2048,commandBytes:4096,resultBytes:4*1024*1024,trafficBytes:128*1024*1024,logBytes:128*1024*1024,polls:16384,commandMs:15000,runMs:600000,guardAgeMs:1000});
export const caseIds=Object.freeze(['integrated-chain','selection-combining-reverse','selection-atom-nested-root-forward','held-save']);
export const keySpecs=Object.freeze({
  x:{code:7,modifiers:[],domCode:'KeyX'},y:{code:16,modifiers:[],domCode:'KeyY'},
  tab:{code:48,modifiers:[],domCode:'Tab'},'shift-tab':{code:48,modifiers:['shift'],domCode:'Tab'},
  left:{code:123,modifiers:[],domCode:'ArrowLeft'},right:{code:124,modifiers:[],domCode:'ArrowRight'},
  'line-start':{code:123,modifiers:['command'],domCode:'ArrowLeft'},'select-line-end':{code:124,modifiers:['command','shift'],domCode:'ArrowRight'},'line-end':{code:124,modifiers:['command'],domCode:'ArrowRight'},
  'select-egc-backward':{code:123,modifiers:['shift'],domCode:'ArrowLeft'},'select-all':{code:0,modifiers:['command'],domCode:'KeyA'},
  enter:{code:36,modifiers:[],domCode:'Enter'},escape:{code:53,modifiers:[],domCode:'Escape'},'move-up':{code:126,modifiers:['option'],domCode:'ArrowUp'},
  backspace:{code:51,modifiers:[],domCode:'Backspace'},undo:{code:6,modifiers:['command'],domCode:'KeyZ'},redo:{code:6,modifiers:['command','shift'],domCode:'KeyZ'},
});
export const pointerTargets=Object.freeze({});
export const actions=Object.freeze(Object.keys(keySpecs));
const chain=Object.freeze(['x','tab','shift-tab','left','right','line-start','select-line-end','line-end','enter','escape','move-up','backspace','undo']);
export const caseActions=Object.freeze({
  'integrated-chain':chain,
  'held-save':Object.freeze([...chain,'y']),
  'selection-combining-reverse':Object.freeze(['tab','shift-tab','select-egc-backward','enter','undo','redo']),
  'selection-atom-nested-root-forward':Object.freeze(['tab','shift-tab','select-all','enter','undo','redo']),
});
export function validCall(method,args){
  if(!Array.isArray(args))return false;
  if(method==='prepare')return args.length===2&&['en','ru'].includes(args[0])&&caseIds.includes(args[1]);
  if(['guard','cleanupGuard'].includes(method))return args.length===1&&actions.includes(args[0]);
  return ['inspect','checkpoint','finish','documentGuard','adoptReopened','acknowledgeOldSave','acknowledgeCurrentSave','acknowledgeLateOldSave','releaseHeldSaves'].includes(method)&&args.length===0;
}
