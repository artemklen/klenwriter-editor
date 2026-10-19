// SPDX-License-Identifier: MIT OR Apache-2.0
// Installed42 only. No arbitrary JavaScript, URL, key, command or coordinate RPC.
export {boundedJson} from '../selection-native/protocol.mjs';
export const limits=Object.freeze({commands:2048,commandBytes:4096,resultBytes:4*1024*1024,trafficBytes:128*1024*1024,logBytes:128*1024*1024,polls:16384,commandMs:15000,runMs:600000,guardAgeMs:1000});
export const caseIds=Object.freeze(['navigation','format-keyboard','format-pointer','add-keyboard','add-pointer','move-menu-up','move-menu-down','move-key-up','move-key-down','host-dialog','composition-format','composition-move','composition-add','composition-dialog','modes-zoom']);
export const keySpecs=Object.freeze({tab:{code:48,modifiers:[],domCode:'Tab'},'shift-tab':{code:48,modifiers:['shift'],domCode:'Tab'},
  left:{code:123,modifiers:[],domCode:'ArrowLeft'},right:{code:124,modifiers:[],domCode:'ArrowRight'},up:{code:126,modifiers:[],domCode:'ArrowUp'},down:{code:125,modifiers:[],domCode:'ArrowDown'},
  home:{code:115,modifiers:[],domCode:'Home'},end:{code:119,modifiers:[],domCode:'End'},enter:{code:36,modifiers:[],domCode:'Enter'},space:{code:49,modifiers:[],domCode:'Space'},escape:{code:53,modifiers:[],domCode:'Escape'},
  'move-up':{code:126,modifiers:['option'],domCode:'ArrowUp'},'move-down':{code:125,modifiers:['option'],domCode:'ArrowDown'},
  copy:{code:8,modifiers:['command'],domCode:'KeyC'},find:{code:3,modifiers:['command'],domCode:'KeyF'},'close-find':{code:53,modifiers:[],domCode:'Escape'},
  'zoom-in':{code:24,modifiers:['command','shift'],domCode:'Equal'},'zoom-reset':{code:29,modifiers:['command'],domCode:'Digit0'},
  'ordinary-en':{code:6,modifiers:['shift'],domCode:'KeyZ'},'ordinary-ru':{code:6,modifiers:[],domCode:'KeyZ'},
  'deadkey-acute':{code:14,modifiers:['option'],domCode:'KeyE'},'complete-e':{code:14,modifiers:[],domCode:'KeyE'}});
export const pointerTargets=Object.freeze({'click-strong':'strong','click-add':'add','click-paragraph':'paragraph','click-move':'move','click-up':'up','click-down':'down','click-nest':'nest','click-title':'title','click-cancel':'cancel','click-recovery':'recovery'});
export const actions=Object.freeze([...Object.keys(keySpecs),...Object.keys(pointerTargets)]);
export const caseActions=Object.freeze({navigation:['tab','shift-tab','left','right','home','end'],
  'format-keyboard':['shift-tab','enter'],'format-pointer':['click-strong'],
  'add-keyboard':['tab','enter','down','end','up','home'],'add-pointer':['click-add','click-paragraph'],
  'move-menu-up':['click-move','click-up','click-nest'],'move-menu-down':['click-move','click-down','click-nest'],
  'move-key-up':['tab','move-up'],'move-key-down':['tab','move-down'],
  'host-dialog':['click-title','shift-tab','tab','escape','click-cancel'],
  'composition-format':['deadkey-acute','click-strong','complete-e'],
  'composition-move':['deadkey-acute','click-move','complete-e'],
  'composition-add':['deadkey-acute','click-add','complete-e'],
  'composition-dialog':['deadkey-acute','click-title','complete-e'],
  'modes-zoom':['copy','find','close-find','ordinary-en','ordinary-ru','click-strong','click-add','click-recovery','shift-tab','tab','zoom-in','zoom-reset']});
export const setupIds=Object.freeze(['before','editor','strong','add','move','title','recovery','readonly','disabled','editable','host-edit','late-accept','undo','redo']);
export function validCall(method,args){
  if(!Array.isArray(args))return false;
  if(method==='prepare')return args.length===2&&['en','ru'].includes(args[0])&&caseIds.includes(args[1]);
  if(['guard','cleanupGuard'].includes(method))return args.length===1&&actions.includes(args[0]);
  if(method==='setup')return args.length===1&&setupIds.includes(args[0]);
  return ['inspect','checkpoint','settle','finish','documentGuard'].includes(method)&&args.length===0;
}
