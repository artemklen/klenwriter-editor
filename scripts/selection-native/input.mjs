// SPDX-License-Identifier: MIT OR Apache-2.0
// One fixture owner. Returned page points are not a general coordinate/key API.
import {actions,caseIds,limits} from './protocol.mjs';
const now=()=>process.hrtime.bigint(),age=start=>Number(now()-start)/1e6;
const mouseActions=new Set(['move-start','down','move-end','up']);
export function createInputOwner({browser,config,inputHelper,run,record,guard,mountedId}){
  if(!['safari','chrome'].includes(browser)||!/^[a-f0-9]{32}$/.test(config.nonce)
    ||config.origin!=='http://127.0.0.1:4174'||config.fixtureUrl!==config.origin+'/selection'
    ||config.title!=='KlenWriter Selection native '+config.nonce||!inputHelper.startsWith('/'))throw Error('Invalid closed selection input configuration');
  let disabled=false,serial=0,held=false,mayHaveDown=false,cleanupAttempted=false;
  async function perform(action,cleanup=false){
      let dispatchStarted=false,execution=null,proof=null,preAge=null;
      try{
        if((disabled&&!cleanup)||!actions.includes(action)||!mountedId())throw Error('Selection input disabled or missing owned mount');
        if(cleanup&&(action!=='up'||cleanupAttempted||!held&&!mayHaveDown))throw Error('No separately owned pointer cleanup is available');
        if(cleanup)cleanupAttempted=true;
        proof=await guard(action);const value=proof.value;
        if(typeof proof.start!=='bigint'||typeof proof.id!=='string'||!proof.id.startsWith(config.nonce+':')
          ||value.nonce!==config.nonce||value.url!==config.fixtureUrl||value.title!==config.title
          ||value.id!==mountedId()||value.mountedId!==mountedId()||value.action!==action||!caseIds.includes(value.caseId)
          ||value.allowed!==true||value.documentFocused!==true||value.editorConnected!==true
          ||!Number.isSafeInteger(value.serial)||value.serial<=serial||age(proof.start)>limits.guardAgeMs)throw Error('Fresh owned selection action guard refused');
        const expectedTarget=action==='tab'?'host-control':'editor';
        if(value.target!==expectedTarget&&!(action==='up'&&(held||mayHaveDown)&&value.target==='host-control'))throw Error('Selection input target differs');
        const viewport=value.viewport;
        if(!viewport||viewport.width!==1024||viewport.height!==768||viewport.scale!==1||viewport.offsetLeft!==0||viewport.offsetTop!==0)throw Error('Selection viewport is not the frozen geometry');
        if(typeof value.pointerDown!=='boolean'||action==='down'&&(held||value.pointerDown)
          ||action==='move-start'&&(held||value.pointerDown)||action==='move-end'&&(!held||!value.pointerDown)
          ||action==='up'&&!held&&!mayHaveDown||!mouseActions.has(action)&&action!=='shift-tab'&&(held||value.pointerDown))throw Error('Selection pointer transition differs');
        const point=value.point;
        if(mouseActions.has(action)?!point||!Number.isFinite(point.x)||!Number.isFinite(point.y)||point.x<0||point.x>=1024||point.y<0||point.y>=768:point!==null)throw Error('Missing or invalid fixed fixture point');
        serial=value.serial;preAge=age(proof.start);const remaining=Math.floor(limits.guardAgeMs-preAge);
        if(remaining<=0)throw Error('Selection guard expired before input');
        const request={format:'osr40-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,
          mountedId:mountedId(),requestId:proof.id,serial,caseId:value.caseId,action,target:value.target,point,viewport,
          pointerDown:held||mayHaveDown,cleanupOnly:cleanup,deadlineMs:remaining};
        const json=JSON.stringify(request);if(Buffer.byteLength(json)>limits.commandBytes)throw Error('Selection physical request exceeds bound');
        dispatchStarted=true;if(action==='down')mayHaveDown=true;
        execution=run(inputHelper,['--request',json],{timeout:remaining,fullStdout:true,maxBuffer:32768});
        const actual=JSON.parse(execution.stdout);
        if(actual.status!=='sent'||actual.action!==action||actual.requestId!==proof.id||actual.nonce!==config.nonce)throw Error('Native physical input receipt differs');
        if(age(proof.start)>limits.guardAgeMs)throw Error('Selection guard expired during physical input');
        if(action==='down'){held=true;mayHaveDown=false;}else if(action==='up'){held=false;mayHaveDown=false;}
        const receipt={action,requestId:proof.id,pageGuardSerial:serial,mountedId:mountedId(),caseId:value.caseId,
          point,target:value.target,preDispatchGuardAgeMs:preAge,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,
          execution,actual,delivery:'sent',pointerDown:held,cleanupOnly:cleanup};
        record(cleanup?'cleanup-pointer-release':'physical-input',receipt);return receipt;
      }catch(error){
        disabled=true;
        record(cleanup?'cleanup-pointer-release-failure':'physical-input-failure',{action,error:String(error?.message??error),execution:execution??error.execution??null,
          requestId:proof?.id??null,preDispatchGuardAgeMs:preAge,maximumGuardAgeMs:proof?.start?age(proof.start):null,
          delivery:dispatchStarted?'unknown/may_have_sent':'not_sent',pointerState:held?'down':mayHaveDown?'may-have-down':'up',dispatchStarted,cleanupOnly:cleanup});
        throw error;
      }
  }
  return {
    get disabled(){return disabled;},get pointerDown(){return held||mayHaveDown;},
    get pointerState(){return mayHaveDown?'may-have-down':held?'down':'up';},
    input:action=>perform(action),
    async releaseOwnedPointer(){disabled=true;return perform('up',true);},
  };
}
