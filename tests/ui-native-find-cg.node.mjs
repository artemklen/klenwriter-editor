// SPDX-License-Identifier: MIT OR Apache-2.0
// FD-C01..08: CG transport/ownership controls; no native acceptance claim.
// Every process callback below is an in-memory stub. No OS/helper/browser/input,
// clipboard, network, timing sleep or native editor is executed by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/ui-native/input.mjs';

const ROOT={x:22,y:52,width:1026,height:855};
const AUX={x:612,y:124,width:403,height:84};
const VIEW={width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0,pageZoom:1};
const KEYS={find:{code:3,modifiers:['command']},'close-find':{code:53,modifiers:[]},enter:{code:36,modifiers:[]}};
const transitions=(action,cleanup)=>{const k=KEYS[action];return cleanup?[...k.modifiers.map(x=>x+'-up'),`key${k.code}-up`]:[...k.modifiers.map(x=>x+'-down'),`key${k.code}-down`,`key${k.code}-up`,...k.modifiers.toReversed().map(x=>x+'-up')];};
const unknown=()=>{throw Object.assign(Error('FD controlled unknown completion'),{execution:{returnCode:null,stdout:'',stderr:'',error:'ETIMEDOUT',stubOnly:true}});};
const PROGRAMS={
  find:[{keyCode:55,down:true,flags:'command'},{keyCode:3,down:true,flags:'command'},{keyCode:3,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
  'close-find':[{keyCode:53,down:true,flags:'none'},{keyCode:53,down:false,flags:'none'}],
  'release-find':[{keyCode:55,down:false,flags:'none'},{keyCode:3,down:false,flags:'none'}],
  'release-close-find':[{keyCode:53,down:false,flags:'none'}],
};
function fixture({browser='chrome',optIn=true,cg=true,nonce='c'.repeat(32)}={}){
  const config={nonce,title:'KlenWriter UI native '+nonce,fixtureUrl:'http://127.0.0.1:4174/ui'};
  let mount='ui42-1',caseId='modes-zoom',phase='closed',sequence=0;
  let pageHook=null,cleanupHook=null,strictHook=null,windowHook=null,keyHook=null,captureHook=null,cgHook=null;
  const calls=[],records=[],proofs=[];
  const execution=value=>({returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true});
  const proof=(action,cleanup)=>{
    const value={nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,serial:++sequence,caseId,action,
      target:action==='click-strong'?'strong':'focused',allowed:true,editorConnected:true,documentFocused:phase==='closed',point:action==='click-strong'?{x:140,y:340}:null,pointerDown:false,
      viewport:{...VIEW},zoomEvidence:{dprRatio:1},...(cleanup?{releaseOnly:true}:{})};
    const p={id:nonce+':'+sequence,start:process.hrtime.bigint(),value};proofs.push(p);return p;
  };
  function ownedProof(measured){return {frontPid:73,frontName:'Google Chrome',frontBundle:'com.google.Chrome',rootTitle:config.title+' - Google Chrome',rootRole:'AXWindow',rootSubrole:'AXStandardWindow',rootFrame:{...ROOT},rootFocused:true,phase:measured,windowCount:measured==='open'?2:1,findAux:measured==='open'?{title:'Find in page\n    '+config.title,role:'AXWindow',subrole:'AXUnknown',frame:{...AUX}}:null,contained:true};}
  const owner=createInputOwner({browser,config,inputHelper:'/controlled/fd-helper',keyScriptPath:'/controlled/fd-keys.scpt',
    ...(optIn?{nativeFindEpisode:'chrome-fd01'}:{}),...(cg?{nativeFindKeyTransport:'cg-fd02',findKeyHelper:'/controlled/cg-helper'}:{}),mountedId:()=>mount,record:(kind,value)=>records.push({kind,value}),
    async guard(action){const p=proof(action,false);return pageHook?await pageHook(p):p;},
    async cleanupGuard(action){const p=proof(action,true);return cleanupHook?await cleanupHook(p):p;},
    run(command,argv,options){
      const call={command,argv:[...argv],options:{...options}};calls.push(call);
      if(command==='/controlled/cg-helper'){
        assert.deepEqual(argv.slice(0,1),['--request']);assert.equal(argv.length,2);const request=JSON.parse(argv[1]);call.request=request;
        assert.deepEqual(Object.keys(request).sort(),['format','browser','nonce','title','fixtureUrl','mountedId','caseId','findRequestId','requestId','serial','pid','rootFrame','purpose','deadlineMs','action','cleanupOnly'].sort());
        assert.equal(request.format,'osr42-chrome-find-key/1');assert.equal(request.browser,'chrome');assert.equal(request.purpose,'key');assert.ok(['find','close-find'].includes(request.action));assert.equal(typeof request.cleanupOnly,'boolean');
        const id=(request.cleanupOnly?'release-':'')+request.action,program=PROGRAMS[id].map(x=>({...x})),initial=phase;
        const measured=program.map((_,i)=>request.cleanupOnly?initial:request.action==='find'?(i<2?'closed':'open'):(i===0?'open':'closed'));
        if(!request.cleanupOnly)phase=request.action==='find'?'open':'closed';
        const value={format:'osr42-chrome-find-key-result/1',status:'completed',delivery:'sent',method:'CGEvent/cghidEventTap',request,programId:id,program,
          postedTransitions:program.map(x=>({...x})),postedCount:program.length,preflightProofs:measured.map(ownedProof),
          core:{status:request.cleanupOnly?'keys-released':'key-sent',action:id,keyCode:KEYS[request.action].code,modifiers:[...KEYS[request.action].modifiers],keyTransitions:transitions(request.action,request.cleanupOnly),frontPid:73},
          postcondition:{status:'verified',expectedPhase:request.cleanupOnly?'either':request.action==='find'?'open':'closed',observedPhase:phase,reads:1,proof:ownedProof(phase),diagnostic:null},diagnostic:null,elapsedMs:1};
        return cgHook?cgHook(value,call):execution(value);
      }
      if(command==='/usr/sbin/screencapture')return captureHook?captureHook(call):execution({captured:true});
      if(command==='/usr/bin/osascript'){
        assert.ok(argv.length===5||argv.length===9);const raw=argv[4],cleanup=raw.startsWith('release-'),action=cleanup?raw.slice(8):raw;
        assert.ok(KEYS[action]);call.action=action;call.cleanup=cleanup;
        if(!cleanup)phase=action==='find'?'open':action==='close-find'?'closed':phase;
        const value={status:cleanup?'keys-released':'key-sent',action:raw,keyCode:KEYS[action].code,
          modifiers:[...KEYS[action].modifiers],keyTransitions:transitions(action,cleanup),frontPid:73,
          ...(argv.length===9?{nativeFindPhase:phase}:{})};
        return keyHook?keyHook(value,call):execution(value);
      }
      assert.equal(command,'/controlled/fd-helper');assert.equal(argv.length,2);const request=JSON.parse(argv[1]);call.request=request;
      if(argv[0]==='--request'){
        assert.equal(request.action,'click-strong');assert.equal(request.target,'strong');
        return execution({status:'sent',delivery:'sent',transitions:['down','up'],action:request.action,requestId:request.requestId,
          nonce,mountedId:request.mountedId,caseId:request.caseId,target:request.target,axWindow:{...ROOT}});
      }
      if(argv[0]==='--guard-key'){
        const value={status:'guarded',delivery:'not_sent',action:request.action,requestId:request.requestId,nonce,
          mountedId:request.mountedId,caseId:request.caseId,target:request.target,cleanupOnly:request.cleanupOnly,
          frontBundle:browser==='chrome'?'com.google.Chrome':'com.apple.Safari',frontPid:73,
          expectedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
          observedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
          axWindowCount:1,axWindow:{...ROOT},axViewport:{x:23,y:139,width:1024,height:768},elapsedMs:1};
        return strictHook?strictHook(value,call):execution(value);
      }
      assert.ok(['--guard-find-key','--inspect-find-window'].includes(argv[0]));
      assert.deepEqual(Object.keys(request).sort(),['format','browser','nonce','title','fixtureUrl','mountedId','caseId','findRequestId','requestId','serial','pid','rootFrame','purpose','deadlineMs'].sort());
      assert.equal(request.format,'osr42-chrome-find-window/1');assert.equal('viewport' in request,false);assert.equal('point' in request,false);
      assert.deepEqual(request.rootFrame,ROOT);assert.equal(request.pid,73);
      assert.ok(Number.isInteger(request.deadlineMs)&&request.deadlineMs>0&&request.deadlineMs<=1000);
      const value={format:request.format,status:argv[0]==='--inspect-find-window'?'inspected':'guarded',delivery:'not_sent',
        measurement:'native-find-window-only',purpose:request.purpose,browser:'chrome',nonce,title:config.title,
        fixtureUrl:config.fixtureUrl,mountedId:request.mountedId,caseId:request.caseId,findRequestId:request.findRequestId,
        requestId:request.requestId,serial:request.serial,frontPid:73,frontBundle:'com.google.Chrome',
        expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',
        axWindowCount:phase==='open'?2:1,axWindow:{...ROOT},rootFocused:true,rootRole:'AXWindow',rootSubrole:'AXStandardWindow',
        findAux:phase==='open'?{title:'Find in page\n    '+config.title,role:'AXWindow',subrole:'AXUnknown',frame:{...AUX}}:null,
        contained:true,elapsedMs:1,nativeFindPhase:phase};
      return windowHook?windowHook(value,call):execution(value);
    }});
  return {owner,config,calls,records,proofs,execution,ownedProof,
    set mount(v){mount=v;},set caseId(v){caseId=v;},set phase(v){phase=v;},
    set pageHook(v){pageHook=v;},set cleanupHook(v){cleanupHook=v;},set strictHook(v){strictHook=v;},
    set windowHook(v){windowHook=v;},set keyHook(v){keyHook=v;},set captureHook(v){captureHook=v;},set cgHook(v){cgHook=v;}};
}
const helpers=f=>f.calls.filter(c=>c.command==='/controlled/fd-helper');
const keys=f=>f.calls.filter(c=>c.command==='/usr/bin/osascript');
const captures=f=>f.calls.filter(c=>c.command==='/usr/sbin/screencapture');
async function open(f){const result=await f.owner.input('find');assert.equal(result.delivery,'sent');return result;}
const cgCalls=f=>f.calls.filter(c=>c.command==='/controlled/cg-helper');
const notAttempted=expected=>({status:'not_attempted',expectedPhase:expected,observedPhase:null,reads:0,proof:null,diagnostic:null});
function incomplete(value,{refused=false,count=1}={}){
  const expected=value.postcondition.expectedPhase;
  return {...value,status:refused?'refused':'unknown',delivery:refused?'not_sent':'unknown/may_have_sent',postedCount:refused?0:count,
    postedTransitions:value.program.slice(0,refused?0:count),preflightProofs:value.preflightProofs.slice(0,refused?0:count),core:null,
    postcondition:notAttempted(expected),diagnostic:{code:refused?'precondition_refused':'partial_program',reason:'Controlled finite transport witness'}};
}
function refusedExecution(f,value){throw Object.assign(Error('Controlled typed helper refusal'),{execution:{...f.execution(value),returnCode:2}});}
async function uncertain(f,action='find',typed=true){
  f.cgHook=typed?(value,call)=>refusedExecution(f,incomplete(value)):unknown;
  await assert.rejects(f.owner.input(action));f.cgHook=null;assert.equal(f.owner.keysPending,true);assert.equal(f.owner.disabled,true);
}

test('FD-C01 explicit CG Find creates one owned accepted episode',async()=>{
  const f=fixture(),value=await open(f);assert.equal(f.calls.length,3);assert.equal(keys(f).length,0);assert.equal(cgCalls(f).length,1);
  const request=cgCalls(f)[0].request;assert.equal(request.requestId,request.findRequestId);assert.equal(request.action,'find');assert.equal(request.cleanupOnly,false);
  for(const key of ['program','keyCode','flags','coordinates','viewport','selectors'])assert.equal(key in request,false);
  assert.deepEqual(value.nativeFindKeyResult.program,PROGRAMS.find);assert.deepEqual(value.nativeFindKeyResult.postedTransitions,PROGRAMS.find);
  assert.deepEqual(value.nativeFindKeyResult.preflightProofs.map(p=>p.phase),['closed','closed','open','open']);
  assert.deepEqual(value.actual.keyTransitions,['command-down','key3-down','key3-up','command-up']);assert.equal(value.actual.nativeFindPhase,'open');
  assert.equal(value.nativeFindKeyResult.postcondition.status,'verified');assert.equal(value.nativeFindKeyResult.postcondition.proof.rootFocused,true);
  assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);assert.ok(cgCalls(f)[0].options.timeout<=1000);
  await f.owner.captureFindWindow('/controlled/cg-find.png');assert.equal(cgCalls(f).length,1,'Read-only screenshot never posts a key');assert.equal(captures(f).length,1);
  await assert.rejects(f.owner.input('find'));assert.equal(cgCalls(f).length,1,'One live episode has no duplicate DOWN');
});

test('FD-C02 CG Escape closes the accepted original episode',async()=>{
  const f=fixture();await open(f);const value=await f.owner.input('close-find');
  assert.equal(keys(f).length,0);assert.equal(cgCalls(f).length,2);const request=cgCalls(f).at(-1).request;
  assert.equal(request.action,'close-find');assert.equal(request.cleanupOnly,false);assert.notEqual(request.requestId,request.findRequestId);
  assert.deepEqual(value.nativeFindKeyResult.program,PROGRAMS['close-find']);assert.deepEqual(value.nativeFindKeyResult.preflightProofs.map(p=>p.phase),['open','closed']);
  assert.deepEqual(value.actual.keyTransitions,['key53-down','key53-up']);assert.equal(value.actual.nativeFindPhase,'closed');assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);
  const n=f.calls.length;await assert.rejects(f.owner.captureFindWindow('/controlled/closed.png'));assert.equal(f.calls.length,n);
  f.mount='ui42-2';await open(f);assert.equal(cgCalls(f).length,3,'Verified close frees the single live capacity');
});

test('FD-C03 typed CG refusal before any post clears pending as not_sent',async()=>{
  const f=fixture();f.cgHook=(v,c)=>refusedExecution(f,incomplete(v,{refused:true}));
  await assert.rejects(f.owner.input('find'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(cgCalls(f).length,1);
  const failure=f.records.at(-1).value;assert.equal(failure.delivery,'not_sent');assert.equal(failure.nativeFindKeyResult.postedCount,0);assert.deepEqual(failure.nativeFindKeyResult.postedTransitions,[]);assert.equal(failure.nativeFindKeyResult.core,null);
  const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,n);
});

test('FD-C04 incomplete CG program retains one matching UP-only cleanup',async()=>{
  for(const typed of [true,false])for(const action of ['find','close-find']){
    const f=fixture();if(action==='close-find')await open(f);await uncertain(f,action,typed);
    const failure=f.records.at(-1).value;assert.equal(failure.delivery,'unknown/may_have_sent');assert.equal(failure.keysPending,true);
    const before=cgCalls(f).length,value=await f.owner.releaseOwnedKeys();assert.equal(cgCalls(f).length,before+1);
    assert.equal(cgCalls(f).at(-1).request.action,action);assert.equal(cgCalls(f).at(-1).request.cleanupOnly,true);
    assert.deepEqual(value.nativeFindKeyResult.program,PROGRAMS['release-'+action]);assert.ok(value.nativeFindKeyResult.program.every(x=>x.down===false&&x.flags==='none'));
    assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(keys(f).length,0);
    const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,n);
  }
});

test('FD-C05 CG cleanup cannot retry rebind or send another down',async()=>{
  for(const kind of ['zero-up','wrong-request','wrong-owner']){
    const f=fixture();await uncertain(f);
    f.cgHook=(value,call)=>{
      if(kind==='zero-up')return refusedExecution(f,incomplete(value,{refused:true}));
      if(kind==='wrong-request')value.request={...value.request,mountedId:'ui42-2'};
      if(kind==='wrong-owner')value.preflightProofs[0].rootFocused=false;
      return f.execution(value);
    };
    await assert.rejects(f.owner.releaseOwnedKeys());assert.equal(f.owner.keysPending,true,'No valid UP completion clears the original unknown');assert.equal(f.owner.disabled,true);
    const last=cgCalls(f).at(-1);assert.equal(last.request.cleanupOnly,true);assert.equal(last.request.action,'find');
    const n=f.calls.length;f.cgHook=null;await assert.rejects(f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,n);
  }
  const moved=fixture();await uncertain(moved);moved.mount='ui42-2';const n=moved.calls.length;await assert.rejects(moved.owner.releaseOwnedKeys());moved.mount='ui42-1';await assert.rejects(moved.owner.releaseOwnedKeys());assert.equal(moved.calls.length,n);
});

test('FD-C06 complete CG core survives final-phase refusal without redundant UP',async()=>{
  for(const kind of ['unobserved','refused','malformed-post','late-helper','late-node','post-owner']){
    const f=fixture();f.cgHook=(value,call)=>{
      if(kind==='unobserved')value.postcondition={...value.postcondition,status:'unobserved',observedPhase:'closed',proof:f.ownedProof('closed'),reads:12};
      if(kind==='refused')value.postcondition={...value.postcondition,status:'refused',observedPhase:null,proof:null,diagnostic:{code:'owner_changed',reason:'Controlled final ownership refusal'}};
      if(kind==='malformed-post')value.postcondition=null;
      if(kind==='late-helper')value.elapsedMs=1001;
      if(kind==='late-node')f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;
      if(kind==='post-owner')value.postcondition.proof.rootFocused=false;
      return f.execution(value);
    };
    await assert.rejects(f.owner.input('find'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(cgCalls(f).length,1);
    assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');assert.equal(f.records.at(-1).value.nativeFindKeyResult.status,'completed');
    const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.captureFindWindow('/controlled/not-accepted.png'));assert.equal(f.calls.length,n);
  }
});

test('FD-C07 mismatched CG owner or literal program never grants authority',async()=>{
  const changes=[v=>{v.request={...v.request,nonce:'d'.repeat(32)};},v=>{v.request={...v.request,pid:74};},v=>{v.request={...v.request,requestId:v.request.requestId+'\n'};},
    v=>{v.programId='close-find';},v=>{v.program[0].keyCode=54;},v=>{v.program[0].flags='none';},v=>{v.postedTransitions.reverse();},
    v=>{v.postedCount=0;},v=>{v.core.frontPid=74;},v=>{v.core.keyCode=53;},v=>{v.core.keyTransitions=['command-down'];},
    v=>{v.preflightProofs[0].frontName='Safari';},v=>{v.preflightProofs[0].frontBundle='com.apple.Safari';},v=>{v.preflightProofs[0].rootFrame.x++;},
    v=>{v.preflightProofs[0].rootRole='AXGroup';},v=>{v.preflightProofs[2].windowCount=3;},v=>{v.preflightProofs[2].findAux.frame.x=0;},v=>{v.preflightProofs[0].axViewport={x:1,y:1,width:1,height:1};}];
  for(const change of changes){const f=fixture();f.cgHook=(value,call)=>{change(value);return f.execution(value);};await assert.rejects(f.owner.input('find'));assert.equal(f.owner.keysPending,true);assert.equal(f.owner.disabled,true);assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');assert.equal(f.records.filter(x=>x.kind==='owned-find-accepted').length,0);}
  for(const exit of [0,null]){
    const f=fixture();f.cgHook=(value,call)=>{const result={...f.execution(incomplete(value,{refused:true})),returnCode:exit};if(exit===null)throw Object.assign(Error('Controlled opaque exit with stale bytes'),{execution:result});return result;};
    await assert.rejects(f.owner.input('find'));assert.equal(f.owner.keysPending,true,'Malformed refused exit never proves no posts');assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
  }
  const zero=fixture();zero.cgHook=(value,call)=>refusedExecution(zero,incomplete(value,{count:0}));await assert.rejects(zero.owner.input('find'));assert.equal(zero.owner.keysPending,true,'Zero-post unknown is not the strict partial-program class');assert.equal(zero.records.at(-1).value.delivery,'unknown/may_have_sent');
});

test('FD-C08 CG opt-in preserves all legacy Safari and ordinary transports',async()=>{
  assert.throws(()=>fixture({browser:'safari',optIn:false,cg:true}));assert.throws(()=>fixture({optIn:false,cg:true}));
  for(const browser of ['chrome','safari']){const f=fixture({browser,optIn:false,cg:false});await f.owner.input('find');assert.equal(f.calls.length,2);assert.equal(keys(f)[0].argv.length,5);assert.equal(cgCalls(f).length,0);}
  const oldFind=fixture({cg:false});await open(oldFind);assert.equal(oldFind.calls.length,3);assert.equal(keys(oldFind)[0].argv.length,9);assert.equal(cgCalls(oldFind).length,0);
  const ordinary=fixture();ordinary.caseId='format-keyboard';await ordinary.owner.input('enter');assert.equal(ordinary.calls.length,2);assert.equal(keys(ordinary)[0].argv.length,5);assert.equal(cgCalls(ordinary).length,0);
  const pointer=fixture();pointer.caseId='format-pointer';await pointer.owner.input('click-strong');assert.equal(pointer.calls.length,1);assert.equal(pointer.calls[0].argv[0],'--request');assert.equal(cgCalls(pointer).length,0);
});
