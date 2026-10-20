// SPDX-License-Identifier: MIT OR Apache-2.0
// Dedicated closed44 held-input owner. All platform operations are dependency supplied.
import assert from 'node:assert/strict';
import {isDeepStrictEqual as same} from 'node:util';
import {actions,caseActions,keySpecs,pointerActions,limits} from './protocol.mjs';
export {prepareChromeWindow} from './chrome-bootstrap.mjs';
const ms=start=>Number(process.hrtime.bigint()-start)/1e6;
const rect=value=>value&&['x','y','width','height'].every(k=>Number.isFinite(value[k]))&&value.width>0&&value.height>0;
const object=value=>typeof value==='string'&&/^o[1-9][0-9]{0,4}$/.test(value);
const modifiersUp=spec=>spec.modifiers.map(x=>x+'-up');
export function fixedTransitions(action,cleanup=false){
  if(pointerActions.includes(action))return [action==='up'?'up':action==='down'?'down':action.startsWith('move-')&&action!=='move-start'?'drag':'move'];
  const spec=keySpecs[action];assert.ok(spec,'Closed fixed key');
  return cleanup?[...modifiersUp(spec),'key'+spec.code+'-up']:[...spec.modifiers.map(x=>x+'-down'),'key'+spec.code+'-down','key'+spec.code+'-up',...spec.modifiers.toReversed().map(x=>x+'-up')];
}
export function createInputOwner({browser,config,inputHelper,run,record,guard,cleanupGuard,mountedId,ownedPointerPid}){
  assert.ok(['chrome','safari'].includes(browser));assert.equal(config.format,'osr44-drag-http-broker/1');assert.match(config.nonce,/^[a-f0-9]{32}$/);
  assert.equal(config.title,'KlenWriter Drag native '+config.nonce);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');
  let disabled=false,busy=false,pointer=null,key=null,owner=null,lastMove=null,previousScreenPoint=null,lastGuardSerial=0;
  const remaining=g=>{const value=Math.floor(limits.guardAgeMs-ms(g.start));assert.ok(value>0,'Original physical guard expired');return value;};
  const log=(kind,value)=>record(kind,value);
  function validate(g,action,cleanup){
    const v=g.value;assert.ok(typeof g.start==='bigint');remaining(g);assert.equal(v.nonce,config.nonce);assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);
    assert.equal(v.mountedId,mountedId());assert.match(v.mountedId,/^ui42-[1-9][0-9]{0,8}$/);assert.ok(caseActions[v.caseId]?.includes(action));assert.equal(v.action,action);
    assert.equal(v.editorConnected,true);assert.ok(Number.isSafeInteger(v.serial)&&v.serial>lastGuardSerial&&v.serial<=2048,'Fresh strictly increasing original guard serial');lastGuardSerial=v.serial;assert.ok([v.sourceObject,v.handleObject,v.targetObject].every(object));
    assert.ok(v.viewport&&Number.isFinite(v.viewport.width)&&Number.isFinite(v.viewport.height)&&v.viewport.width>0&&v.viewport.height>0);assert.equal(v.viewport.scale,1);assert.equal(v.viewport.offsetLeft,0);assert.equal(v.viewport.offsetTop,0);
    if(!cleanup){assert.equal(v.allowed,true);assert.equal(v.documentFocused,true);}else assert.equal(v.releaseOnly,true);
    const lineage={mountedId:v.mountedId,caseId:v.caseId,sourceObject:v.sourceObject,handleObject:v.handleObject,targetObject:v.targetObject};
    if(owner&&owner.lineage.mountedId!==v.mountedId){assert.equal(pointer,null);assert.equal(key,null);owner=null;lastMove=null;previousScreenPoint=null;}
    if(owner)assert.deepEqual(lineage,owner.lineage,'Original mount/source/handle/target identity differs');
    return {v,lineage};
  }
  function invoke(request){
    const text=JSON.stringify(request);assert.ok(Buffer.byteLength(text)<=4096);
    try{const execution=run(inputHelper,['--request',text],{timeout:request.deadlineMs,fullStdout:true,maxBuffer:32768});return {execution,actual:JSON.parse(execution.stdout)};}
    catch(error){let actual=null;try{actual=JSON.parse(error.execution?.stdout??'');}catch{}error.actual=actual;throw error;}
  }
  function identity(actual,request){
    assert.ok(actual&&same(actual.request,request),'Actual original request echo differs');
    assert.ok(Array.isArray(actual.postedTransitions));const expected=fixedTransitions(request.action,request.cleanupOnly);
    assert.ok(actual.postedTransitions.length<=expected.length);assert.deepEqual(actual.postedTransitions,expected.slice(0,actual.postedTransitions.length),'Closed literal post sequence differs');
    return actual.coreComplete===true&&same(actual.postedTransitions,expected);
  }
  async function perform(action,cleanup=false){
    assert.ok(actions.includes(action));assert.equal(busy,false,'Concurrent input forbidden');
    if(!cleanup)assert.equal(disabled,false,'Unknown input disables ordinary dispatch');
    busy=true;let request=null,g=null,receipt={action,cleanupOnly:cleanup,status:'claimed'};log('physical-action',receipt);
    try{
      g=await (cleanup?cleanupGuard:guard)(action);const {v,lineage}=validate(g,action,cleanup);
      const isPointer=pointerActions.includes(action),pending=cleanup?(isPointer?pointer:key):null;
      if(cleanup){assert.ok(pending,'No original pending release');assert.equal(pending.cleanupAttempted,true);assert.deepEqual(lineage,pending.lineage);assert.deepEqual(v.viewport,pending.viewport);}
      if(!owner){
        const inspect={format:'osr44-native-window-inspection/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:remaining(g),viewport:v.viewport};
        const execution=run(inputHelper,['--inspect-window',JSON.stringify(inspect)],{timeout:inspect.deadlineMs,fullStdout:true,maxBuffer:32768});const actual=JSON.parse(execution.stdout);
        log('original-window-binding',{request:inspect,execution,actual});assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');assert.equal(actual.nonce,config.nonce);assert.equal(actual.browser,browser);assert.equal(actual.contained,true);assert.ok(rect(actual.axWindow));
        assert.ok(Number.isSafeInteger(actual.frontPid)&&actual.frontPid>0&&actual.frontPid<=2147483647);if(browser==='chrome')assert.equal(actual.frontPid,ownedPointerPid(),'Original owned Chrome PID differs');
        owner={lineage,pid:actual.frontPid,rootFrame:actual.axWindow};
      }
      const point=isPointer?(cleanup?pending.point:v.point):null;
      if(isPointer){assert.ok(point&&Number.isFinite(point.x)&&Number.isFinite(point.y));assert.ok(point.x>=0&&point.x<v.viewport.width&&point.y>=0&&point.y<v.viewport.height);}
      if(!cleanup){
        if(['hover-source','move-start','down'].includes(action))assert.equal(pointer,null,'Second pointer Down forbidden');
        else if(isPointer)assert.ok(pointer,'Held phase requires original Down');
        if(action==='down'){assert.ok(lastMove&&lastMove.action==='move-start');assert.deepEqual(lastMove.point,point);assert.equal(v.actualUnpressedHandleMove,true,'Actual original trusted handle move required before Down');}
        if(!isPointer)assert.equal(key,null,'Unresolved key blocks another key');
        if(pointer){assert.deepEqual(v.viewport,pointer.viewport);if(!cleanup){assert.deepEqual(v.stamp,pointer.stamp,'Original held native stamp');assert.deepEqual(v.context,pointer.context,'Original held native context');}assert.ok(['right','escape'].includes(action)||isPointer,'Held gesture key outside closed set');}
      }
      request={format:'osr44-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:v.mountedId,requestId:g.id,serial:v.serial,caseId:v.caseId,action,point,viewport:v.viewport,pointerDown:!!pointer,cleanupOnly:cleanup,deadlineMs:remaining(g),pid:owner.pid,rootFrame:owner.rootFrame,...lineage,previousScreenPoint:isPointer?previousScreenPoint:null};
      // prospective ownership is retained BEFORE the potentially opaque platform call.
      if(!cleanup&&action==='down')pointer={lineage,viewport:v.viewport,point,stamp:v.stamp,context:v.context,cleanupAttempted:false};
      if(!cleanup&&!isPointer)key={lineage,viewport:v.viewport,point:null,action,cleanupAttempted:false};
      if(isPointer&&pointer)pointer.point=point;
      receipt={...receipt,request,status:'dispatched'};log('physical-action',receipt);
      let execution,actual;
      try{({execution,actual}=invoke(request));}
      catch(error){
        actual=error.actual;let complete=false;
        if(actual){try{complete=identity(actual,request);}catch(validation){error.receiptValidation=validation.message;}}
        // A fully observed original core retires key/Up even if late owner/deadline fails.
        if(complete){if(!isPointer)key=null;else if(action==='up')pointer=null;}
        else if(actual?.delivery==='not_sent'&&Array.isArray(actual.postedTransitions)&&actual.postedTransitions.length===0&&same(actual.request,request)){
          if(!isPointer)key=null;else if(action==='down')pointer=null;
        }
        receipt={...receipt,status:'failed',execution:error.execution??null,actual,knownCompleteCore:complete,error:error.message};log('physical-action',receipt);throw error;
      }
      const complete=identity(actual,request);assert.equal(complete,true,'Original full core required');
      if(!isPointer)key=null;else if(action==='up')pointer=null;
      // No ownership resurrection after the full core above.
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.equal(actual.frontPid,owner.pid);assert.deepEqual(actual.axWindow,owner.rootFrame);remaining(g);
      if(isPointer){assert.ok(actual.screenPoint&&Number.isFinite(actual.screenPoint.x)&&Number.isFinite(actual.screenPoint.y));previousScreenPoint=actual.screenPoint;if(['hover-source','move-start'].includes(action))lastMove={action,point};}
      receipt={...receipt,status:'completed',execution,actual,knownCompleteCore:true};log('physical-action',receipt);return receipt;
    }catch(error){disabled=true;log('physical-action-failure',{action,cleanupOnly:cleanup,error:error.message,execution:error.execution??null,request});throw error;}
    finally{busy=false;}
  }
  async function release(kind){
    const pending=kind==='pointer'?pointer:key;if(!pending)return {status:'not_required',kind};
    assert.equal(busy,false);if(pending.cleanupAttempted)return {status:'already_attempted',kind};
    pending.cleanupAttempted=true;const action=kind==='pointer'?'up':pending.action;
    try{return {status:'released',kind,receipt:await perform(action,true)};}catch(error){return {status:'failed',kind,error:{message:error.message,execution:error.execution??null},release:'UNKNOWN'};}
  }
  return {input:action=>perform(action),releaseOwnedPointer:()=>release('pointer'),releaseOwnedKeys:()=>release('keys'),get keysPending(){return key!==null;},get pointerDown(){return pointer!==null;},get disabled(){return disabled;},get pointerState(){return pointer?{...pointer,ownerPid:owner?.pid}:null;}};
}
