// SPDX-License-Identifier: MIT OR Apache-2.0
export {boundedJson} from '../selection-native/protocol.mjs';
export const limits=Object.freeze({commands:1024,commandBytes:4096,resultBytes:2*1024*1024,trafficBytes:64*1024*1024,logBytes:128*1024*1024,polls:16384,commandMs:15000,runMs:600000,guardAgeMs:1000});
export const caseIds=Object.freeze(['ordinary-layout','plain-deadkey','marked-deadkey','scene-deadkey','escape-preedit','blur-refocus']);
export const actions=Object.freeze(['ordinary-en','ordinary-ru','deadkey-acute','complete-e','escape','shift-tab','tab']);
export function validCall(method,args){
  if(!Array.isArray(args))return false;
  if(method==='prepare'){
    const [locale,caseId,fixture]=args;
    if(!['en','ru'].includes(locale))return false;
    if(args.length===2)return caseIds.includes(caseId);
    return args.length===3&&fixture==='verse'&&(caseId==='ordinary-layout'||locale==='en'&&caseId==='plain-deadkey');
  }
  if(method==='guard')return args.length===1&&actions.includes(args[0]);
  return ['inspect','checkpoint','settle','finish','focusControl','documentGuard','undo','redo'].includes(method)&&args.length===0;
}
