// SPDX-License-Identifier: MIT OR Apache-2.0
// Closed source-authored OSR66 presentation scenes; no arbitrary call/selector/key.
export {boundedJson} from '../selection-native/protocol.mjs';
export const limits=Object.freeze({commands:2048,commandBytes:4096,resultBytes:4*1024*1024,trafficBytes:128*1024*1024,logBytes:128*1024*1024,polls:16384,commandMs:15000,runMs:600000,guardAgeMs:1000});
export const caseIds=Object.freeze(['presentation-kwdj','presentation-notes','presentation-recovery']);
export const keySpecs=Object.freeze({tab:{code:48,modifiers:[],domCode:'Tab'},'shift-tab':{code:48,modifiers:['shift'],domCode:'Tab'},left:{code:123,modifiers:[],domCode:'ArrowLeft'},right:{code:124,modifiers:[],domCode:'ArrowRight'},up:{code:126,modifiers:[],domCode:'ArrowUp'},down:{code:125,modifiers:[],domCode:'ArrowDown'},home:{code:115,modifiers:[],domCode:'Home'},end:{code:119,modifiers:[],domCode:'End'},enter:{code:36,modifiers:[],domCode:'Enter'},escape:{code:53,modifiers:[],domCode:'Escape'},'zoom-in':{code:24,modifiers:['command','shift'],domCode:'Equal'},'zoom-reset':{code:29,modifiers:['command'],domCode:'Digit0'}});
export const pointerTargets=Object.freeze({'click-strong':'strong'});
export const actions=Object.freeze([...Object.keys(keySpecs),...Object.keys(pointerTargets)]);
export const caseActions=Object.freeze({'presentation-kwdj':actions,'presentation-notes':['tab','shift-tab','enter','escape','zoom-in','zoom-reset'],'presentation-recovery':['tab','shift-tab','zoom-in','zoom-reset']});
export const setupIds=Object.freeze(['before','readonly','editable','theme-default','theme-high-contrast']);
export function validCall(method,args){if(!Array.isArray(args))return false;if(method==='prepare')return args.length===2&&['en','ru'].includes(args[0])&&caseIds.includes(args[1]);if(method==='setup')return args.length===1&&setupIds.includes(args[0]);if(['guard','cleanupGuard'].includes(method))return args.length===1&&actions.includes(args[0]);return ['inspect','checkpoint','finish','documentGuard'].includes(method)&&args.length===0;}
