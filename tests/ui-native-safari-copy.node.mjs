// SPDX-License-Identifier: MIT OR Apache-2.0
// SC01 controlled transport boundaries. run/guard are in-memory stubs only;
// no helper, AppleScript, AX, clipboard, browser or physical event is executed.
// Literals are authored from frozen SC01, independently of the implementation.
// The fixture style follows ui-native-input.node.mjs. These stubs do not prove
// actual AppleScript-handler grammar rejection or a Safari DOM keyup.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/ui-native/input.mjs';

const SCRIPT='/controlled/sc01-keys.scpt',HELPER='/controlled/sc01-guard';
const ROOT={x:22,y:52,width:1026,height:855},VIEWPORT={x:23,y:139,width:1024,height:768};
const RELEASE_FIRST=['command-down','key8-down','command-up','key8-up'];
const LEGACY_COPY=['command-down','key8-down','key8-up','command-up'];
const RELEASE_COPY=['command-up','key8-up'];
const PROGRAM_ID='safari-copy-release-first/1';
const KEYS={copy:{code:8,modifiers:['command']},tab:{code:48,modifiers:[]},'ordinary-ru':{code:6,modifiers:[]}};
const execution=value=>({returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true});
const opaque=()=>{throw Object.assign(Error('SC01 controlled opaque completion'),{
  execution:{returnCode:null,stdout:'',stderr:'',error:'ETIMEDOUT',stubOnly:true}});};

function fixture({browser='safari',optIn=true,transport='sc-copy01',pid=73}={}){
  const nonce='7'.repeat(32),config={nonce,fixtureUrl:'http://127.0.0.1:4174/ui',title:'KlenWriter UI native '+nonce};
  let serial=0,mount='ui42-1',caseId='modes-zoom',pageHook=null,cleanupHook=null,guardHook=null,keyHook=null;
  const calls=[],records=[],proofs=[],guardCalls=[];
  const proof=(action,cleanup)=>{
    const next=++serial,value={nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,
      serial:next,caseId,action,target:'focused',point:null,pointerDown:false,allowed:true,
      editorConnected:true,documentFocused:true,viewport:{width:1024,height:768,scale:1,
        offsetLeft:0,offsetTop:0,pageZoom:1},zoomEvidence:{dprRatio:1},...(cleanup?{releaseOnly:true}:{})};
    const result={id:nonce+':'+next,start:process.hrtime.bigint(),value};proofs.push(result);return result;
  };
  const owner=createInputOwner({browser,config,inputHelper:HELPER,keyScriptPath:SCRIPT,
    ...(optIn?{safariCopyKeyTransport:transport}:{}),mountedId:()=>mount,
    record:(kind,value)=>records.push({kind,value}),
    async guard(action){guardCalls.push({kind:'normal',action});const p=proof(action,false);return pageHook?pageHook(p):p;},
    async cleanupGuard(action){guardCalls.push({kind:'cleanup',action});const p=proof(action,true);return cleanupHook?cleanupHook(p):p;},
    run(command,argv,options){
      const call={command,argv:[...argv],options:{...options}};calls.push(call);
      if(command===HELPER){
        assert.equal(argv.length,2);assert.equal(argv[0],'--guard-key');
        const request=JSON.parse(argv[1]);call.request=request;
        const title=config.title+(browser==='chrome'?' - Google Chrome':'');
        const value={status:'guarded',delivery:'not_sent',cleanupOnly:request.cleanupOnly,
          frontBundle:browser==='safari'?'com.apple.Safari':'com.google.Chrome',frontPid:pid,
          expectedAxWindowTitle:title,observedAxWindowTitle:title,axWindowCount:2,
          axWindow:{...ROOT},axViewport:{...VIEWPORT},action:request.action,requestId:request.requestId,
          nonce,mountedId:request.mountedId,caseId:request.caseId,target:request.target};
        return guardHook?guardHook(value,call):execution(value);
      }
      assert.equal(command,'/usr/bin/osascript','Only the controlled guard and AS stub are available');
      assert.equal(argv[0],SCRIPT);assert.ok(argv.length===5||argv.length===6);
      const rawAction=argv[4],cleanup=rawAction.startsWith('release-'),action=cleanup?rawAction.slice(8):rawAction;
      const key=KEYS[action];assert.ok(key,'Only independently declared SC01 fixture literals are available');
      call.action=action;call.cleanup=cleanup;
      const releaseFirst=argv.length===6;
      if(releaseFirst)assert.deepEqual(argv.slice(1),['safari',config.title,String(pid),'copy','sc-copy01']);
      const transitions=action==='copy'?(cleanup?RELEASE_COPY:releaseFirst?RELEASE_FIRST:LEGACY_COPY)
        :cleanup?[`key${key.code}-up`]:[`key${key.code}-down`,`key${key.code}-up`];
      const value={status:cleanup?'keys-released':'key-sent',action:rawAction,keyCode:key.code,
        modifiers:[...key.modifiers],...(releaseFirst?{programId:PROGRAM_ID}:{}),
        keyTransitions:[...transitions],frontPid:pid};
      return keyHook?keyHook(value,call):execution(value);
    }});
  return {owner,config,calls,records,proofs,guardCalls,
    set mount(v){mount=v;},set caseId(v){caseId=v;},set pageHook(v){pageHook=v;},
    set cleanupHook(v){cleanupHook=v;},set guardHook(v){guardHook=v;},set keyHook(v){keyHook=v;}};
}
const keyCalls=f=>f.calls.filter(call=>call.command==='/usr/bin/osascript');
const helperCalls=f=>f.calls.filter(call=>call.command===HELPER);
async function uncertain(f){
  f.keyHook=opaque;await assert.rejects(f.owner.input('copy'),/opaque completion/);f.keyHook=null;
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,true);
  assert.equal(keyCalls(f).length,1);assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
}

test('SC-N01 opted-in Safari Copy uses the closed release-first program and exact ACK',async()=>{
  for(const pid of [73,2147483647]){
    const f=fixture({pid}),value=await f.owner.input('copy');
    assert.equal(f.calls.length,2);assert.equal(helperCalls(f)[0].request.action,'copy');
    assert.equal(helperCalls(f)[0].request.cleanupOnly,false);assert.equal(helperCalls(f)[0].request.point,null);
    assert.deepEqual(keyCalls(f)[0].argv,[SCRIPT,'safari',f.config.title,String(pid),'copy','sc-copy01']);
    assert.deepEqual(Object.keys(value.actual).sort(),['status','action','keyCode','modifiers','programId','keyTransitions','frontPid'].sort());
    assert.deepEqual(value.actual,{status:'key-sent',action:'copy',keyCode:8,modifiers:['command'],
      programId:PROGRAM_ID,keyTransitions:RELEASE_FIRST,frontPid:pid});
    assert.equal(value.delivery,'sent');assert.equal(value.keyGuard.delivery,'not_sent');
    assert.equal(value.execution.stubOnly,true);assert.equal(value.keyGuardExecution.stubOnly,true);
    assert.ok(keyCalls(f)[0].options.timeout>0&&keyCalls(f)[0].options.timeout<=helperCalls(f)[0].options.timeout);
    assert.ok(helperCalls(f)[0].options.timeout<=1000);
    assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);
    await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,2);
  }
});

test('SC-N02 Safari Copy opt-in is closed and preserves every legacy route',async()=>{
  for(const options of [{transport:'sc-copy01\n'},{transport:'SC-COPY01'},{transport:null},{transport:true},{browser:'chrome'}])
    assert.throws(()=>fixture(options),'An invalid opt-in must fail before any stub process can be used');
  for(const browser of ['safari','chrome']){
    const f=fixture({browser,optIn:false}),value=await f.owner.input('copy');
    assert.deepEqual(keyCalls(f)[0].argv,[SCRIPT,browser,f.config.title+(browser==='chrome'?' - Google Chrome':''),'73','copy']);
    assert.deepEqual(value.actual.keyTransitions,LEGACY_COPY);assert.equal('programId'in value.actual,false);
    assert.equal(f.calls.length,2);assert.equal(f.owner.keysPending,false);
  }
  for(const action of ['tab','ordinary-ru']){
    const f=fixture(),value=await f.owner.input(action);
    assert.deepEqual(keyCalls(f)[0].argv,[SCRIPT,'safari',f.config.title,'73',action]);
    assert.equal('programId'in value.actual,false);assert.equal(f.calls.length,2);
    assert.deepEqual(value.actual.keyTransitions,[`key${KEYS[action].code}-down`,`key${KEYS[action].code}-up`]);
  }
  for(const pid of [0,-1,1.5,2147483648,'73',null]){
    const f=fixture({pid});await assert.rejects(f.owner.input('copy'));
    assert.equal(helperCalls(f).length,1);assert.equal(keyCalls(f).length,0,'Invalid strict PID cannot start the new program');
    assert.equal(f.owner.keysPending,false);assert.equal(f.records.at(-1).value.delivery,'not_sent');
  }
  // AS5 browser/action/tag rejection and unchanged AS8 are source/compile
  // obligations; no local stub is presented as executing those script handlers.
});

test('SC-N03 malformed Safari Copy program receipts refuse without clearing ownership or replay',async()=>{
  const mutations=[
    v=>{delete v.programId;},v=>{v.programId='safari-copy-release-first/2';},
    v=>{v.keyTransitions=[...LEGACY_COPY];},v=>{v.keyTransitions.pop();},
    v=>{v.keyTransitions.push('key8-up');},v=>{v.keyTransitions[2]='key8-down';},
    v=>{v.status='keys-released';},v=>{v.action='release-copy';},v=>{v.keyCode=0;},
    v=>{v.modifiers=[];},v=>{v.frontPid=74;},v=>{v.unexpected=true;},
  ];
  for(const mutate of mutations){
    const f=fixture();f.keyHook=v=>{mutate(v);return execution(v);};
    await assert.rejects(f.owner.input('copy'));assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,true);
    assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');assert.equal(keyCalls(f).length,1);
    const callCount=f.calls.length;await assert.rejects(f.owner.input('copy'));assert.equal(f.calls.length,callCount);
    f.keyHook=null;const cleanup=await f.owner.releaseOwnedKeys();
    assert.deepEqual(cleanup.actual.keyTransitions,RELEASE_COPY);assert.equal(keyCalls(f).length,2);
    assert.deepEqual(keyCalls(f)[1].argv,[SCRIPT,'safari',f.config.title,'73','release-copy']);
    await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(keyCalls(f).length,2);
  }
  const late=fixture();late.keyHook=v=>{late.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return execution(v);};
  await assert.rejects(late.owner.input('copy'),/Total42 key guard exceeded1s/);
  assert.equal(late.owner.disabled,true);assert.equal(late.owner.keysPending,false);
  assert.equal(late.records.at(-1).value.delivery,'sent/known_completed');assert.equal(keyCalls(late).length,1);
  await assert.rejects(async()=>late.owner.releaseOwnedKeys());await assert.rejects(late.owner.input('copy'));
  assert.equal(late.calls.length,2,'A proven complete but late program cannot be replayed or released again');
});

test('SC-N04 uncertain Safari Copy permits only one original legacy UP-only cleanup',async()=>{
  const f=fixture();await uncertain(f);const failed=f.records.at(-1).value;
  f.pageHook=()=>{throw Error('Normal policy unavailable after opaque Copy');};
  f.cleanupHook=p=>{p.value.documentFocused=false;return p;};
  const value=await f.owner.releaseOwnedKeys();
  assert.deepEqual(keyCalls(f).map(c=>c.argv),[
    [SCRIPT,'safari',f.config.title,'73','copy','sc-copy01'],
    [SCRIPT,'safari',f.config.title,'73','release-copy']]);
  assert.equal(helperCalls(f).at(-1).request.cleanupOnly,true);assert.equal(f.guardCalls.at(-1).kind,'cleanup');
  assert.deepEqual(value.actual,{status:'keys-released',action:'release-copy',keyCode:8,
    modifiers:['command'],keyTransitions:RELEASE_COPY,frontPid:73});
  assert.equal('programId'in value.actual,false);assert.ok(value.actual.keyTransitions.every(t=>t.endsWith('-up')));
  assert.equal(failed.delivery,'unknown/may_have_sent');assert.equal(failed.execution.error,'ETIMEDOUT');
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,false);
  const completeCalls=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());
  await assert.rejects(f.owner.input('copy'));assert.equal(f.calls.length,completeCalls);

  for(const field of ['PID','mount','case','nonce','window']){
    const foreign=fixture();await uncertain(foreign);const before=keyCalls(foreign).length;
    if(field==='PID')foreign.guardHook=v=>execution({...v,frontPid:74});
    else if(field==='window')foreign.guardHook=v=>execution({...v,axWindow:{...v.axWindow,x:v.axWindow.x+1}});
    else foreign.cleanupHook=p=>{
      if(field==='mount'){p.value.id='ui42-2';p.value.mountedId='ui42-2';}
      if(field==='case')p.value.caseId='navigation';
      if(field==='nonce')p.value.nonce='8'.repeat(32);
      return p;
    };
    await assert.rejects(async()=>foreign.owner.releaseOwnedKeys());assert.equal(keyCalls(foreign).length,before,field);
    assert.equal(foreign.owner.keysPending,true);const n=foreign.calls.length;
    foreign.guardHook=null;foreign.cleanupHook=null;
    await assert.rejects(async()=>foreign.owner.releaseOwnedKeys());assert.equal(foreign.calls.length,n,'No cleanup rebind or retry');
  }
  for(const failure of ['opaque','guard-refusal']){
    const unknown=fixture();await uncertain(unknown);
    if(failure==='opaque')unknown.keyHook=opaque;
    else unknown.cleanupHook=()=>{throw Error('SC01 controlled cleanup guard refusal');};
    await assert.rejects(async()=>unknown.owner.releaseOwnedKeys());assert.equal(unknown.owner.keysPending,true);
    assert.equal(unknown.owner.disabled,true);const n=unknown.calls.length;
    unknown.keyHook=null;unknown.cleanupHook=null;
    await assert.rejects(async()=>unknown.owner.releaseOwnedKeys());assert.equal(unknown.calls.length,n);
    assert.equal(keyCalls(unknown).length,failure==='opaque'?2:1);
  }
  const notSent=fixture();notSent.guardHook=()=>{throw Object.assign(Error('SC01 controlled initial guard refusal'),{
    execution:{returnCode:2,stdout:'',stderr:'refused',stubOnly:true}});};
  await assert.rejects(notSent.owner.input('copy'),/initial guard refusal/);
  assert.equal(keyCalls(notSent).length,0);assert.equal(notSent.owner.keysPending,false);
  assert.equal(notSent.records.at(-1).value.delivery,'not_sent');const n=notSent.calls.length;
  await assert.rejects(async()=>notSent.owner.releaseOwnedKeys());assert.equal(notSent.calls.length,n);
});
