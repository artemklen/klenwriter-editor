// SPDX-License-Identifier: MIT OR Apache-2.0
// UI42 transport policy only. All run/guard callbacks are local stubs: no helper,
// osascript, OS, browser, native input, clipboard, permission or network execution.
// Fixture style follows selection-native-input.node.mjs; expectations below are
// separately literal UI42 action/ownership/release boundaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/ui-native/input.mjs';
import {validCall} from '../scripts/ui-native/protocol.mjs';
// This existing explicit unit entry also includes the pure finite CO controls;
// neither file executes a browser, helper, native editor or platform input.
import './ui-composition-observation.node.mjs';
import './ui-composition-after-click.node.mjs';
import './ui-composition-during-pointer.node.mjs';
import './ui-native-find-episode.node.mjs';
import './ui-native-find-cg.node.mjs';
import './ui-native-zoom-cg.node.mjs';

const keyLiterals={
  enter:{code:36,modifiers:[],caseId:'format-keyboard'},
  'shift-tab':{code:48,modifiers:['shift'],caseId:'navigation'},
  find:{code:3,modifiers:['command'],caseId:'modes-zoom'},
  'zoom-in':{code:24,modifiers:['command','shift'],caseId:'modes-zoom'},
  'deadkey-acute':{code:14,modifiers:['option'],caseId:'composition-format'},
  'ordinary-ru':{code:6,modifiers:[],caseId:'modes-zoom'},
};
const expectedTransitions=(action,cleanup=false)=>{
  const {code,modifiers}=keyLiterals[action];
  return cleanup?[...modifiers.map(m=>m+'-up'),`key${code}-up`]
    :[...modifiers.map(m=>m+'-down'),`key${code}-down`,`key${code}-up`,...modifiers.toReversed().map(m=>m+'-up')];
};
const pointerLiterals={'click-strong':{target:'strong',caseId:'format-pointer'},'click-add':{target:'add',caseId:'add-pointer'}};

function fixture(browser='safari'){
  const nonce='a'.repeat(32),config={nonce,fixtureUrl:'http://127.0.0.1:4174/ui',title:'KlenWriter UI native '+nonce};
  let sequence=0,mount='ui42-1',caseId='modes-zoom',normalHook=null,cleanupHook=null,keyGuardHook=null,keyHook=null,pointerHook=null;
  const records=[],calls=[],proofs=[],guardCalls=[];
  const frame={x:22,y:22,width:1072,height:950};
  const viewport={width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0,pageZoom:1};
  function proof(action,cleanup=false){
    const serial=++sequence;
    const value={nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,serial,caseId,action,
      target:pointerLiterals[action]?.target??'focused',allowed:true,editorConnected:true,documentFocused:true,
      point:pointerLiterals[action]?{x:140,y:340}:null,pointerDown:false,viewport:{...viewport},zoomEvidence:{dprRatio:1},
      ...(cleanup?{releaseOnly:true}:{})};
    const result={id:nonce+':'+serial,start:process.hrtime.bigint(),value};proofs.push(result);return result;
  }
  function execution(value){return {returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true};}
  function keyGuard(request){return {
    status:'guarded',delivery:'not_sent',action:request.action,requestId:request.requestId,nonce,
    mountedId:request.mountedId,caseId:request.caseId,target:request.target,cleanupOnly:request.cleanupOnly,
    frontBundle:browser==='chrome'?'com.google.Chrome':'com.apple.Safari',frontPid:73,
    expectedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
    observedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
    axWindowCount:1,axWindow:{...frame},axViewport:{x:22,y:139,width:1024,height:768},elapsedMs:12,
  };}
  const owner=createInputOwner({browser,config,inputHelper:'/controlled/no-native-helper',keyScriptPath:'/controlled/ui42-keys.scpt',
    mountedId:()=>mount,record:(kind,value)=>records.push({kind,value}),
    async guard(action){guardCalls.push({kind:'normal',action});const value=proof(action);return normalHook?normalHook(value):value;},
    async cleanupGuard(action){guardCalls.push({kind:'cleanup',action});const value=proof(action,true);return cleanupHook?cleanupHook(value):value;},
    run(command,argv,options){
      if(command==='/usr/bin/osascript'){
        const cleanup=argv.at(-1).startsWith('release-'),action=argv.at(-1).replace(/^release-/,'');
        const call={command,argv:[...argv],options:{...options},action,cleanup};calls.push(call);
        const literal=keyLiterals[action];assert.ok(literal,'Tests permit only independently declared key literals');
        const value={status:cleanup?'keys-released':'key-sent',action:argv.at(-1),keyCode:literal.code,
          modifiers:[...literal.modifiers],keyTransitions:expectedTransitions(action,cleanup),frontPid:73};
        return keyHook?keyHook(value,call):execution(value);
      }
      assert.equal(command,'/controlled/no-native-helper','Unexpected process request in controlled test');
      const request=JSON.parse(argv[1]),call={command,argv:[...argv],options:{...options},request};calls.push(call);
      if(argv[0]==='--guard-key'){
        const value=keyGuard(request);return keyGuardHook?keyGuardHook(value,call):execution(value);
      }
      assert.equal(argv[0],'--request');
      const value={...keyGuard(request),status:'sent',delivery:'sent',screenPoint:{x:22+request.point.x,y:139+request.point.y},
        transitions:request.cleanupOnly?['up']:['down','up']};
      return pointerHook?pointerHook(value,call):execution(value);
    }});
  return {owner,config,records,calls,proofs,guardCalls,execution,
    set caseId(value){caseId=value;},set mount(value){mount=value;},
    set normalHook(value){normalHook=value;},set cleanupHook(value){cleanupHook=value;},
    set keyGuardHook(value){keyGuardHook=value;},set keyHook(value){keyHook=value;},set pointerHook(value){pointerHook=value;}};
}
const unknownExecution=()=>{throw Object.assign(Error('Controlled unknown completion'),{execution:{returnCode:null,stdout:'',stderr:'',error:'ETIMEDOUT',stubOnly:true}});};
async function uncertainKey(f,action='find'){
  f.caseId=keyLiterals[action].caseId;f.keyHook=unknownExecution;
  await assert.rejects(f.owner.input(action),/Controlled unknown/);
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,true);assert.equal(f.calls.length,2);f.keyHook=null;
}
async function uncertainPointer(f){
  f.caseId='format-pointer';f.pointerHook=unknownExecution;
  await assert.rejects(f.owner.input('click-strong'),/Controlled unknown/);
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.pointerState,'unknown');f.pointerHook=null;
}

test('UI42 closed protocol permits only finite fixture methods/cases/actions',()=>{
  assert.equal(validCall('prepare',['ru','composition-dialog']),true);
  assert.equal(validCall('guard',['find']),true);assert.equal(validCall('cleanupGuard',['find']),true);
  for(const [method,args]of[['eval',['1+1']],['guard',['key-42']],['guard',['find',{x:1,y:1}]],['prepare',['en','invented']],['setup',['arbitrary-coordinate']],['checkpoint',['extra']]])
    assert.equal(validCall(method,args),false,`${method} must remain a closed request`);
});
for(const browser of ['chrome','safari'])for(const [action,literal]of Object.entries(keyLiterals))test(`UI42 controlled ${browser}/${action} delegates literal key once after separate read-only guard`,async()=>{
  const f=fixture(browser);f.caseId=literal.caseId;
  const receipt=await f.owner.input(action);
  assert.equal(f.calls.length,2);assert.equal(f.calls[0].argv[0],'--guard-key');
  assert.deepEqual(f.calls[1].argv,['/controlled/ui42-keys.scpt',browser,f.config.title+(browser==='chrome'?' - Google Chrome':''),'73',action]);
  assert.equal(f.calls[0].request.cleanupOnly,false);assert.equal(f.calls[0].request.pointerDown,false);assert.equal(f.calls[0].request.point,null);
  assert.deepEqual(receipt.actual.keyTransitions,expectedTransitions(action));assert.equal(receipt.delivery,'sent');
  assert.equal(receipt.keyGuard.delivery,'not_sent');assert.equal(receipt.keyGuardExecution.returnCode,0);assert.equal(receipt.execution.returnCode,0);
  assert.ok(f.calls[1].options.timeout>0&&f.calls[1].options.timeout<=f.calls[0].options.timeout&&f.calls[0].options.timeout<=1000);
  assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2,'Known successful keys never replay or release redundantly');
});
for(const [action,literal]of Object.entries(pointerLiterals))test(`UI42 controlled ${action} sends one exact target click and retains original receipt`,async()=>{
  const f=fixture();f.caseId=literal.caseId;const receipt=await f.owner.input(action);
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].argv[0],'--request');assert.equal(f.calls[0].request.target,literal.target);
  assert.deepEqual(f.calls[0].request.point,{x:140,y:340});assert.deepEqual(receipt.actual.transitions,['down','up']);
  assert.equal(receipt.execution.returnCode,0);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,false);
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);
});
for(const [name,change]of[
  ['expired',p=>{p.start=process.hrtime.bigint()-2_000_000_000n;}],
  ['foreign case',p=>{p.value.caseId='navigation';}],
  ['foreign mount',p=>{p.value.mountedId='ui42-2';}],
  ['foreign nonce',p=>{p.value.nonce='b'.repeat(32);}],
  ['foreign URL',p=>{p.value.url='http://127.0.0.1:4174/composition';}],
  ['foreign title',p=>{p.value.title+=' copied';}],
  ['document focus absent',p=>{p.value.documentFocused=false;}],
])test(`UI42 controlled ${name} page proof refuses before any helper dispatch`,async()=>{
  const f=fixture();f.normalHook=p=>{change(p);return p;};
  await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');assert.equal(f.owner.keysPending,false);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,0);
});
test('UI42 controlled changed exact AX window refuses before the next System Events dispatch',async()=>{
  const f=fixture();await f.owner.input('find');f.keyGuardHook=(v)=>f.execution({...v,axWindow:{...v.axWindow,x:v.axWindow.x+1}});
  await assert.rejects(f.owner.input('find'),/AX window changed/);assert.equal(f.calls.length,3,'One new read-only helper, no second key');
  assert.equal(f.owner.keysPending,false);assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('UI42 controlled read-only helper refusal never creates key ownership or invokes System Events',async()=>{
  const f=fixture();f.keyGuardHook=()=>{throw Object.assign(Error('Controlled AX refusal'),{execution:{returnCode:2,stdout:'',stderr:'refused',stubOnly:true}});};
  await assert.rejects(f.owner.input('find'),/AX refusal/);assert.equal(f.calls.length,1);assert.equal(f.owner.keysPending,false);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,1);assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('UI42 controlled deadline exhausted by read-only guard sends no key',async()=>{
  const f=fixture();f.keyGuardHook=v=>{f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return f.execution(v);};
  await assert.rejects(f.owner.input('find'),/AX guard consumed deadline/);assert.equal(f.calls.length,1);assert.equal(f.owner.keysPending,false);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('UI42 controlled unknown CmdF has one independent UP-only cleanup despite normal focus/CSP policy refusal',async()=>{
  const f=fixture();await uncertainKey(f);const original=f.records.at(-1).value;
  f.normalHook=()=>{throw Error('Normal guard refuses focus departure and CSP error');};
  f.cleanupHook=p=>{p.value.documentFocused=false;return p;};
  const receipt=await f.owner.releaseOwnedKeys();
  assert.equal(f.calls.length,4);assert.equal(f.guardCalls.at(-1).kind,'cleanup');assert.equal(f.calls[2].request.cleanupOnly,true);
  assert.equal(f.calls[2].request.action,'find');assert.equal(f.calls[2].request.pointerDown,false);
  assert.equal(f.calls[3].argv.at(-1),'release-find');assert.deepEqual(receipt.actual.keyTransitions,['command-up','key3-up']);
  assert.equal(receipt.keyGuard.delivery,'not_sent');assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);
  assert.equal(original.delivery,'unknown/may_have_sent');assert.equal(original.execution.error,'ETIMEDOUT','Original failed action receipt is retained');
  await assert.rejects(f.owner.input('find'));await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,4);
});
for(const [name,change]of[
  ['mount',p=>{p.value.id='ui42-2';p.value.mountedId='ui42-2';}],
  ['nonce',p=>{p.value.nonce='b'.repeat(32);}],
  ['case',p=>{p.value.caseId='add-keyboard';}],
  ['release-only proof',p=>{p.value.releaseOnly=false;}],
])test(`UI42 controlled key cleanup rejects foreign ${name} without dispatching another key`,async()=>{
  const f=fixture();await uncertainKey(f,'enter');f.cleanupHook=p=>{change(p);return p;};
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2);assert.equal(f.owner.keysPending,true);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2,'Cleanup is one attempt, never replay');
});
for(const [name,change]of[
  ['PID',v=>({...v,frontPid:74})],['AX window',v=>({...v,axWindow:{...v.axWindow,y:v.axWindow.y+1}})],
])test(`UI42 controlled key cleanup rejects changed ${name} after read-only check but before any UP post`,async()=>{
  const f=fixture();await uncertainKey(f);f.keyGuardHook=v=>f.execution(change(v));
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,3);assert.equal(f.calls[2].argv[0],'--guard-key');
  assert.equal(f.owner.keysPending,true);assert.equal(f.owner.disabled,true);await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,3);
});
test('UI42 controlled unavailable cleanup broker does not fall back to ordinary guard or a key replay',async()=>{
  const f=fixture();await uncertainKey(f);f.cleanupHook=()=>{throw Error('Controlled unknown broker command');};
  await assert.rejects(async()=>f.owner.releaseOwnedKeys(),/unknown broker/);assert.equal(f.calls.length,2);assert.equal(f.owner.keysPending,true);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2);
});
test('UI42 controlled key cleanup unknown completion preserves pending owner and cannot be attempted twice',async()=>{
  const f=fixture();await uncertainKey(f);f.keyHook=unknownExecution;
  await assert.rejects(async()=>f.owner.releaseOwnedKeys(),/Controlled unknown/);assert.equal(f.calls.length,4);assert.equal(f.owner.keysPending,true);
  await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,4);
});
test('UI42 controlled complete but late key receipt stays failed/disabled with no redundant UP cleanup',async()=>{
  const f=fixture();f.keyHook=v=>{f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return f.execution(v);};
  await assert.rejects(f.owner.input('find'),/Total42 key guard exceeded1s/);
  assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');assert.equal(f.records.at(-1).value.execution.returnCode,0);
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,false);await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2);
});
test('UI42 controlled unknown pointer completion releases once at the ORIGINAL point without a second DOWN',async()=>{
  const f=fixture();await uncertainPointer(f);const original=f.records.at(-1).value;
  f.cleanupHook=p=>{p.value.point={x:999,y:1};p.value.documentFocused=false;return p;};
  const receipt=await f.owner.releaseOwnedPointer();
  assert.equal(f.calls.length,2);assert.equal(f.calls[1].request.cleanupOnly,true);assert.equal(f.calls[1].request.pointerDown,true);
  assert.deepEqual(f.calls[1].request.point,{x:140,y:340},'Cleanup never retargets to a new page point');assert.deepEqual(receipt.actual.transitions,['up']);
  assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);assert.equal(original.delivery,'unknown/may_have_sent');
  await assert.rejects(f.owner.releaseOwnedPointer());await assert.rejects(f.owner.input('click-strong'));assert.equal(f.calls.length,2);
});
for(const [name,change]of[
  ['mount',p=>{p.value.id='ui42-2';p.value.mountedId='ui42-2';}],
  ['nonce',p=>{p.value.nonce='b'.repeat(32);}],
  ['case',p=>{p.value.caseId='add-pointer';}],
  ['viewport',p=>{p.value.viewport.height=736;}],
])test(`UI42 controlled pointer cleanup foreign ${name} refuses before any release helper`,async()=>{
  const f=fixture();await uncertainPointer(f);f.cleanupHook=p=>{change(p);return p;};
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.owner.pointerDown,true);
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);
});
test('UI42 controlled pointer helper not_sent refusal never creates a cleanup click',async()=>{
  const f=fixture();f.caseId='format-pointer';f.pointerHook=()=>{throw Object.assign(Error('Controlled not_sent refusal'),{execution:{returnCode:2,stdout:JSON.stringify({status:'refused',delivery:'not_sent'}),stderr:'',stubOnly:true}});};
  await assert.rejects(f.owner.input('click-strong'),/not_sent/);assert.equal(f.owner.pointerState,'up');assert.equal(f.records.at(-1).value.delivery,'not_sent');
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);
});
test('UI42 controlled known-completed late pointer stays failed without redundant release',async()=>{
  const f=fixture();f.caseId='format-pointer';f.pointerHook=v=>{f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return f.execution(v);};
  await assert.rejects(f.owner.input('click-strong'),/Total42 pointer guard exceeded1s/);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);
});
for(const [name,change]of[
  ['nonce',v=>({...v,nonce:'b'.repeat(32)})],['mount',v=>({...v,mountedId:'ui42-2'})],
  ['case',v=>({...v,caseId:'add-pointer'})],['AX window',v=>({...v,axWindow:{...v.axWindow,x:v.axWindow.x+1}})],
])test(`UI42 controlled pointer cleanup cannot accept a release receipt for changed ${name}`,async()=>{
  const f=fixture();
  // An AX-window comparison needs an actually returned prior owner baseline;
  // never require the owner to invent a rectangle after an opaque first failure.
  if(name==='AX window')await f.owner.input('find');
  const priorCalls=f.calls.length;await uncertainPointer(f);f.pointerHook=v=>f.execution(change(v));
  await assert.rejects(f.owner.releaseOwnedPointer(),'Foreign release receipt must not establish successful owned cleanup');
  assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.disabled,true);assert.equal(f.calls.length,priorCalls+2);
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,priorCalls+2);
});
