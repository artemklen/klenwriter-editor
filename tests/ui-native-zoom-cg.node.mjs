// SPDX-License-Identifier: MIT OR Apache-2.0
// CZ transport boundaries only: every run/guard below is an in-memory stub.
// No browser/helper/CGEvent/OS/input/clipboard/native editor is executed.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/ui-native/input.mjs';
const ROOT={x:22,y:52,width:1026,height:855},AXVIEW={x:23,y:139,width:1024,height:768};
const KEYS={'zoom-in':{code:24,modifiers:['command','shift']},'zoom-reset':{code:29,modifiers:['command']},enter:{code:36,modifiers:[]},find:{code:3,modifiers:['command']}};
const PROGRAMS={
  'zoom-in':[{keyCode:55,down:true,flags:'command'},{keyCode:56,down:true,flags:'command+shift'},{keyCode:24,down:true,flags:'command+shift'},{keyCode:24,down:false,flags:'command+shift'},{keyCode:56,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
  'zoom-reset':[{keyCode:55,down:true,flags:'command'},{keyCode:29,down:true,flags:'command'},{keyCode:29,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
  'release-zoom-in':[{keyCode:55,down:false,flags:'none'},{keyCode:56,down:false,flags:'none'},{keyCode:24,down:false,flags:'none'}],
  'release-zoom-reset':[{keyCode:55,down:false,flags:'none'},{keyCode:29,down:false,flags:'none'}],
};
const transitions=(action,cleanup)=>{const k=KEYS[action];return cleanup?[...k.modifiers.map(x=>x+'-up'),`key${k.code}-up`]:[...k.modifiers.map(x=>x+'-down'),`key${k.code}-down`,`key${k.code}-up`,...k.modifiers.toReversed().map(x=>x+'-up')];};
const opaque=()=>{throw Object.assign(Error('CZ opaque helper timeout'),{execution:{returnCode:null,stdout:'',stderr:'',error:'ETIMEDOUT',stubOnly:true}});};
function fixture({browser='chrome',zoom=true,transport='cg-zoom01'}={}){
  const nonce='e'.repeat(32),config={nonce,title:'KlenWriter UI native '+nonce,fixtureUrl:'http://127.0.0.1:4174/ui'};
  let mount='ui42-1',caseId='modes-zoom',sequence=0,pageZoom=1,pageHook=null,cleanupHook=null,keyHook=null,cgHook=null,ordinaryHook=null;
  const calls=[],records=[],proofs=[],execution=value=>({returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true});
  const viewport=()=>({width:1024/pageZoom,height:768/pageZoom,scale:1,offsetLeft:0,offsetTop:0,pageZoom});
  const proof=(action,cleanup)=>{const serial=++sequence,result={id:nonce+':'+serial,start:process.hrtime.bigint(),value:{nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,serial,caseId,action,target:action==='click-strong'?'strong':'focused',point:action==='click-strong'?{x:140,y:340}:null,pointerDown:false,allowed:true,editorConnected:true,documentFocused:true,viewport:viewport(),zoomEvidence:{dprRatio:pageZoom},...(cleanup?{releaseOnly:true}:{})}};proofs.push(result);return result;};
  const nativeProof=()=>({frontPid:73,frontName:'Google Chrome',frontBundle:'com.google.Chrome',expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',axWindowCount:2,axMatchCount:1,axWindow:{...ROOT},axViewport:{...AXVIEW},contained:true,visitedNodes:42,maximumDepth:9,rootFocused:true});
  const owner=createInputOwner({browser,config,inputHelper:'/controlled/zoom-guard',keyScriptPath:'/controlled/old-keys.scpt',...(zoom?{nativeZoomKeyTransport:transport,findKeyHelper:'/controlled/zoom-key'}:{}),mountedId:()=>mount,record:(kind,value)=>records.push({kind,value}),
    async guard(action){const p=proof(action,false);return pageHook?await pageHook(p):p;},async cleanupGuard(action){const p=proof(action,true);return cleanupHook?await cleanupHook(p):p;},
    run(command,argv,options){
      const call={command,argv:[...argv],options:{...options}};calls.push(call);
      if(command==='/usr/bin/osascript'){
        assert.equal(argv.length,5);const raw=argv[4],cleanup=raw.startsWith('release-'),action=cleanup?raw.slice(8):raw;
        const value={status:cleanup?'keys-released':'key-sent',action:raw,keyCode:KEYS[action].code,modifiers:[...KEYS[action].modifiers],keyTransitions:transitions(action,cleanup),frontPid:73};return keyHook?keyHook(value,call):execution(value);
      }
      assert.ok(['/controlled/zoom-guard','/controlled/zoom-key'].includes(command));const request=JSON.parse(argv[1]);call.request=request;
      if(command==='/controlled/zoom-guard'){
        if(argv[0]==='--request')return execution({status:'sent',delivery:'sent',transitions:['down','up'],action:request.action,requestId:request.requestId,nonce,mountedId:request.mountedId,caseId:request.caseId,target:request.target,axWindow:{...ROOT}});
        assert.equal(argv[0],'--guard-key');const suffix=browser==='chrome'?' - Google Chrome':'';
        const value={status:'guarded',delivery:'not_sent',cleanupOnly:request.cleanupOnly,frontBundle:browser==='chrome'?'com.google.Chrome':'com.apple.Safari',frontPid:73,expectedAxWindowTitle:config.title+suffix,observedAxWindowTitle:config.title+suffix,action:request.action,requestId:request.requestId,nonce,mountedId:request.mountedId,caseId:request.caseId,target:request.target,axWindow:{...ROOT},axViewport:{...AXVIEW},axWindowCount:2};return ordinaryHook?ordinaryHook(value,call):execution(value);
      }
      assert.equal(argv[0],'--zoom-request');assert.equal(argv.length,2);
      assert.deepEqual(Object.keys(request).sort(),['format','browser','nonce','title','fixtureUrl','mountedId','requestId','serial','caseId','action','target','point','viewport','pointerDown','cleanupOnly','deadlineMs','originalPid','originalRootFrame'].sort());
      assert.equal(request.format,'osr42-chrome-zoom-key/1');assert.equal(request.originalPid,73);assert.deepEqual(request.originalRootFrame,ROOT);assert.equal(request.point,null);assert.equal(request.target,'focused');assert.equal(request.caseId,'modes-zoom');
      const id=(request.cleanupOnly?'release-':'')+request.action,program=PROGRAMS[id].map(x=>({...x}));
      const value={format:'osr42-chrome-zoom-key-result/1',status:'completed',delivery:'sent',method:'CGEvent/cghidEventTap',request,programId:id,program,postedTransitions:program.map(x=>({...x})),postedCount:program.length,preflightProofs:program.map(nativeProof),core:{status:request.cleanupOnly?'keys-released':'key-sent',action:id,keyCode:KEYS[request.action].code,modifiers:[...KEYS[request.action].modifiers],keyTransitions:transitions(request.action,request.cleanupOnly),frontPid:73},diagnostic:null,elapsedMs:1};
      return cgHook?cgHook(value,call):execution(value);
    }});
  return {owner,config,calls,records,proofs,execution,set mount(v){mount=v;},set caseId(v){caseId=v;},set pageZoom(v){pageZoom=v;},set pageHook(v){pageHook=v;},set cleanupHook(v){cleanupHook=v;},set keyHook(v){keyHook=v;},set cgHook(v){cgHook=v;},set ordinaryHook(v){ordinaryHook=v;}};
}
const cgs=f=>f.calls.filter(c=>c.command==='/controlled/zoom-key'),guards=f=>f.calls.filter(c=>c.command==='/controlled/zoom-guard'),as=f=>f.calls.filter(c=>c.command==='/usr/bin/osascript');
function partial(value,{zero=false,count=1}={}){const n=zero?0:count;return {...value,status:zero?'refused':'unknown',delivery:zero?'not_sent':'unknown/may_have_sent',postedCount:n,postedTransitions:value.program.slice(0,n),preflightProofs:value.preflightProofs.slice(0,n),core:null,diagnostic:{code:'controlled_zoom_refusal',reason:'Finite pure transport witness'}};}
const typed=(f,value,exit=2)=>{throw Object.assign(Error('CZ typed result'),{execution:{...f.execution(value),returnCode:exit}});};
async function unknown(f,action='zoom-in',opaqueResult=false){f.cgHook=opaqueResult?opaque:(v,c)=>typed(f,partial(v));await assert.rejects(f.owner.input(action));f.cgHook=null;assert.equal(f.owner.keysPending,true);assert.equal(f.owner.disabled,true);}

test('CZ01 explicit CG Zoom uses source literal programs and an ordinary postproof',async()=>{
  for(const action of ['zoom-in','zoom-reset']){
    const f=fixture();if(action==='zoom-reset')f.pageZoom=2;const value=await f.owner.input(action);
    assert.equal(f.calls.length,3);assert.deepEqual(f.calls.map(c=>c.argv[0]),['--guard-key','--zoom-request','--guard-key']);assert.equal(as(f).length,0);assert.equal(f.proofs.length,1);
    assert.deepEqual(value.nativeZoomKeyResult.program,PROGRAMS[action]);assert.deepEqual(value.nativeZoomKeyResult.postedTransitions,PROGRAMS[action]);assert.deepEqual(value.actual.keyTransitions,transitions(action,false));
    assert.equal(cgs(f)[0].request.viewport.width*cgs(f)[0].request.viewport.pageZoom,1024);assert.equal(cgs(f)[0].request.viewport.height*cgs(f)[0].request.viewport.pageZoom,768);
    for(const name of ['program','keyCode','flags','expectedZoom','coordinates'])assert.equal(name in cgs(f)[0].request,false);
    assert.equal(guards(f)[0].request.requestId,guards(f)[1].request.requestId);assert.equal(guards(f)[0].request.serial,guards(f)[1].request.serial);assert.equal(guards(f)[1].request.format,'osr42-native-input/1');
    assert.ok(guards(f)[1].request.deadlineMs<=guards(f)[0].request.deadlineMs);assert.ok(cgs(f)[0].options.timeout<=1000);assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);
  }
});

test('CZ02 CG Zoom refusal and unknown preserve truthful one-UP cleanup',async()=>{
  const refused=fixture();refused.cgHook=(v,c)=>typed(refused,partial(v,{zero:true}));await assert.rejects(refused.owner.input('zoom-in'));assert.equal(refused.owner.keysPending,false);assert.equal(refused.records.at(-1).value.delivery,'not_sent');const count=refused.calls.length;await assert.rejects(async()=>refused.owner.releaseOwnedKeys());assert.equal(refused.calls.length,count);
  for(const action of ['zoom-in','zoom-reset'])for(const opaqueResult of [false,true]){
    const f=fixture();await unknown(f,action,opaqueResult);const value=await f.owner.releaseOwnedKeys();assert.deepEqual(value.nativeZoomKeyResult.program,PROGRAMS['release-'+action]);assert.ok(value.nativeZoomKeyResult.program.every(p=>p.down===false&&p.flags==='none'));assert.deepEqual(value.actual.keyTransitions,transitions(action,true));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,n);
  }
  const zero=fixture();await unknown(zero);zero.cgHook=(v,c)=>typed(zero,partial(v,{zero:true}));await assert.rejects(zero.owner.releaseOwnedKeys());assert.equal(zero.owner.keysPending,true);assert.equal(zero.records.at(-1).value.delivery,'not_sent');const n=zero.calls.length;zero.cgHook=null;await assert.rejects(zero.owner.releaseOwnedKeys());assert.equal(zero.calls.length,n);
  const changed=fixture();await unknown(changed);changed.mount='ui42-2';const before=changed.calls.length;await assert.rejects(changed.owner.releaseOwnedKeys());changed.mount='ui42-1';await assert.rejects(changed.owner.releaseOwnedKeys());assert.equal(changed.calls.length,before);assert.equal(changed.owner.keysPending,true);
});

test('CZ03 malformed or late CG Zoom completion never gains authority or redundant UP',async()=>{
  for(const mutate of [v=>{v.request={...v.request,originalPid:74};},v=>{v.request={...v.request,requestId:v.request.requestId+'\n'};},v=>{v.programId='zoom-reset';},v=>{v.program[0].flags='none';},v=>{v.postedTransitions.reverse();},v=>{v.core.keyCode=29;},v=>{v.core.frontPid=74;},v=>{v.preflightProofs[0].rootFocused=false;},v=>{v.preflightProofs[0].axViewport.width=500;},v=>{v.preflightProofs[0].axMatchCount=2;},v=>{v.preflightProofs[0].maximumDepth=33;},v=>{v.preflightProofs[0].axWindow.x++;}]){
    const f=fixture();f.cgHook=(v,c)=>{mutate(v);return f.execution(v);};await assert.rejects(f.owner.input('zoom-in'));assert.equal(f.owner.keysPending,true);assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');assert.equal(guards(f).length,1);
  }
  for(const kind of ['malformed-zero-exit','zero-unknown']){const f=fixture();f.cgHook=(v,c)=>kind==='malformed-zero-exit'?f.execution(partial(v,{zero:true})):typed(f,{...partial(v),postedCount:0,postedTransitions:[],preflightProofs:[]});await assert.rejects(f.owner.input('zoom-in'));assert.equal(f.owner.keysPending,true);}
  for(const kind of ['helper-late','node-late','post-failure','post-pid','post-frame']){
    const f=fixture();if(kind==='helper-late')f.cgHook=(v,c)=>f.execution({...v,elapsedMs:1001});if(kind==='node-late')f.cgHook=(v,c)=>{f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return f.execution(v);};
    f.ordinaryHook=(v,c)=>{if(guards(f).length===2){if(kind==='post-failure')throw Object.assign(Error('Controlled ordinary postproof refusal'),{execution:{returnCode:1,stdout:'',stderr:'Refused',stubOnly:true}});if(kind==='post-pid')v.frontPid=74;if(kind==='post-frame')v.axWindow.x++;}return f.execution(v);};
    await assert.rejects(f.owner.input('zoom-in'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,n);
  }
});

test('CZ04 CG Zoom opt-in preserves legacy Safari default and ordinary transports',async()=>{
  assert.throws(()=>fixture({browser:'safari'}));assert.throws(()=>fixture({transport:'cg-zoom01\n'}));
  for(const browser of ['chrome','safari'])for(const action of ['zoom-in','zoom-reset']){const f=fixture({browser,zoom:false});await f.owner.input(action);assert.equal(f.calls.length,2);assert.equal(as(f)[0].argv.length,5);assert.equal(cgs(f).length,0);}
  const ordinary=fixture();ordinary.caseId='format-keyboard';await ordinary.owner.input('enter');assert.equal(ordinary.calls.length,2);assert.equal(cgs(ordinary).length,0);assert.equal(as(ordinary)[0].argv.length,5);
  const pointer=fixture();pointer.caseId='format-pointer';await pointer.owner.input('click-strong');assert.equal(pointer.calls.length,1);assert.equal(cgs(pointer).length,0);assert.equal(pointer.calls[0].argv[0],'--request');
  const find=fixture();await find.owner.input('find');assert.equal(find.calls.length,2);assert.equal(cgs(find).length,0);assert.equal(as(find)[0].argv.length,5,'Zoom-only opt-in does not reroute Find');
  const concurrent=fixture();let release;concurrent.pageHook=p=>p.value.action==='zoom-in'?new Promise(resolve=>{release=()=>resolve(p);}):p;const operation=concurrent.owner.input('zoom-in');
  await assert.rejects(concurrent.owner.input('click-strong'),/One private Find operation/);assert.equal(concurrent.calls.length,0,'Ordinary pointer cannot race the Zoom-only guard');release();await operation;assert.equal(concurrent.calls.length,3);
});
