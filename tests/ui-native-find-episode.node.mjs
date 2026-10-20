// SPDX-License-Identifier: MIT OR Apache-2.0
// FD-N01..10: finite transport/ownership controls, not native Find acceptance.
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
function fixture({browser='chrome',optIn=true,nonce='c'.repeat(32)}={}){
  const config={nonce,title:'KlenWriter UI native '+nonce,fixtureUrl:'http://127.0.0.1:4174/ui'};
  let mount='ui42-1',caseId='modes-zoom',phase='closed',sequence=0;
  let pageHook=null,cleanupHook=null,strictHook=null,windowHook=null,keyHook=null,captureHook=null;
  const calls=[],records=[],proofs=[];
  const execution=value=>({returnCode:0,stdout:JSON.stringify(value),stderr:'',stubOnly:true});
  const proof=(action,cleanup)=>{
    const value={nonce,url:config.fixtureUrl,title:config.title,id:mount,mountedId:mount,serial:++sequence,caseId,action,
      target:action==='click-strong'?'strong':'focused',allowed:true,editorConnected:true,documentFocused:phase==='closed',point:action==='click-strong'?{x:140,y:340}:null,pointerDown:false,
      viewport:{...VIEW},zoomEvidence:{dprRatio:1},...(cleanup?{releaseOnly:true}:{})};
    const p={id:nonce+':'+sequence,start:process.hrtime.bigint(),value};proofs.push(p);return p;
  };
  const owner=createInputOwner({browser,config,inputHelper:'/controlled/fd-helper',keyScriptPath:'/controlled/fd-keys.scpt',
    ...(optIn?{nativeFindEpisode:'chrome-fd01'}:{}),mountedId:()=>mount,record:(kind,value)=>records.push({kind,value}),
    async guard(action){const p=proof(action,false);return pageHook?await pageHook(p):p;},
    async cleanupGuard(action){const p=proof(action,true);return cleanupHook?await cleanupHook(p):p;},
    run(command,argv,options){
      const call={command,argv:[...argv],options:{...options}};calls.push(call);
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
  return {owner,config,calls,records,proofs,execution,
    set mount(v){mount=v;},set caseId(v){caseId=v;},set phase(v){phase=v;},
    set pageHook(v){pageHook=v;},set cleanupHook(v){cleanupHook=v;},set strictHook(v){strictHook=v;},
    set windowHook(v){windowHook=v;},set keyHook(v){keyHook=v;},set captureHook(v){captureHook=v;}};
}
const helpers=f=>f.calls.filter(c=>c.command==='/controlled/fd-helper');
const keys=f=>f.calls.filter(c=>c.command==='/usr/bin/osascript');
const captures=f=>f.calls.filter(c=>c.command==='/usr/sbin/screencapture');
async function open(f){const result=await f.owner.input('find');assert.equal(result.delivery,'sent');return result;}
async function makeUnknown(f,action='find'){f.keyHook=unknown;await assert.rejects(f.owner.input(action),/FD controlled unknown/);f.keyHook=null;assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,true);}

test('FD-N01 own Find creates one exact accepted window-only episode',async()=>{
  const f=fixture(),result=await open(f);assert.equal(f.calls.length,3);assert.equal(f.proofs.length,1);
  assert.deepEqual(f.calls.map(c=>c.argv[0]),['--guard-key','/controlled/fd-keys.scpt','--inspect-find-window']);
  assert.deepEqual(keys(f)[0].argv,['/controlled/fd-keys.scpt','chrome',f.config.title+' - Google Chrome','73','find','22','52','1026','855']);
  const proof=helpers(f).at(-1).request;assert.equal(proof.purpose,'post-find');assert.equal(proof.requestId,proof.findRequestId);
  assert.equal(proof.requestId,f.proofs[0].id);assert.equal(proof.serial,f.proofs[0].value.serial);
  assert.equal(result.nativeFindWindow.actual.nativeFindPhase,'open');assert.equal('axViewport' in result.nativeFindWindow.actual,false);
  assert.equal(f.owner.disabled,false);assert.equal(f.owner.keysPending,false);
  const count=f.calls.length;await assert.rejects(f.owner.input('find'),/Only one live/);assert.equal(f.calls.length,count);
  assert.equal(f.records.filter(r=>r.kind==='owned-find-accepted').length,1);
});

test('FD-N02 exact closeFind retires the owned episode',async()=>{
  const f=fixture();await open(f);const result=await f.owner.input('close-find');
  assert.equal(result.actual.nativeFindPhase,'closed');assert.deepEqual(result.actual.keyTransitions,['key53-down','key53-up']);
  assert.equal(helpers(f).at(-1).request.purpose,'pre-close-find');assert.notEqual(helpers(f).at(-1).request.requestId,helpers(f).at(-1).request.findRequestId);
  assert.equal(f.calls.length,5);assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,false);
  assert.equal(f.records.at(-2).value.reason,'verified-close');
  const n=f.calls.length;await assert.rejects(f.owner.captureFindWindow('/controlled/absent.png'));assert.equal(f.calls.length,n);
  f.mount='ui42-2';await open(f);assert.equal(f.records.filter(r=>r.kind==='owned-find-accepted').length,2,'Cap is one live episode, not lifetime one');
});

test('FD-N03 unknown original key ACK permits only one owned UP cleanup',async()=>{
  for(const bad of [unknown,(value,fcall)=>({returnCode:0,stdout:JSON.stringify({...value,keyCode:53}),stderr:'',stubOnly:true})]){
    const f=fixture();f.keyHook=bad;await assert.rejects(f.owner.input('find'));f.keyHook=null;
    assert.equal(f.owner.disabled,true);assert.equal(f.owner.keysPending,true);assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
    const n=f.calls.length;await assert.rejects(f.owner.captureFindWindow('/controlled/no.png'));await assert.rejects(f.owner.input('close-find'));await assert.rejects(f.owner.input('enter'));assert.equal(f.calls.length,n);
    assert.equal(f.records.filter(r=>r.kind==='owned-find-accepted').length,0);
    const released=await f.owner.releaseOwnedKeys();assert.deepEqual(released.actual.keyTransitions,['command-up','key3-up']);
    assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(keys(f).length,2);
    await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(keys(f).length,2);
  }
});

test('FD-N04 owner tuple mismatch refuses special authority',async()=>{
  for(const nonce of ['c'.repeat(32)+'\n','c'.repeat(31)+'\n'])assert.throws(()=>fixture({nonce}),'New private nonce must be exactly 32 closed hex bytes');
  for(const change of [
    p=>{p.id+='\n';},p=>{p.value.id='ui42-1\n';},p=>{p.value.mountedId='ui42-2';},
    p=>{p.value.nonce='d'.repeat(32);},p=>{p.value.title+=' copy';},p=>{p.value.caseId='navigation';},
    p=>{p.value.serial=0;},p=>{p.start=process.hrtime.bigint()-2_000_000_000n;},
  ]){const f=fixture();f.pageHook=p=>{change(p);return p;};await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,0);}
  const malformedMount=fixture();malformedMount.mount='ui42-1\n';await assert.rejects(malformedMount.owner.input('find'));assert.equal(malformedMount.calls.length,0);
  for(const [name,value]of Object.entries({frontPid:74,frontBundle:'com.apple.Safari',nonce:'d'.repeat(32),title:'other',mountedId:'ui42-2',caseId:'navigation',findRequestId:'c'.repeat(32)+':999',requestId:'c'.repeat(32)+':999',serial:0})){
    const f=fixture();f.windowHook=(v,c)=>f.execution({...v,[name]:value});await assert.rejects(f.owner.input('find'),undefined,name);assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);
  }
});

test('FD-N05 malformed Find topology never invents a viewport',async()=>{
  const variants=[v=>{v.axWindowCount=3;},v=>{v.axWindowCount=1;},v=>{v.rootFocused=false;},v=>{v.rootRole='AXGroup';},
    v=>{v.rootSubrole='AXUnknown';},v=>{v.axWindow.x++;},v=>{v.findAux=null;},v=>{v.findAux.title+=' copy';},
    v=>{v.findAux.title=v.findAux.title.replace('c','d');},v=>{v.findAux.role='AXGroup';},v=>{v.findAux.subrole='AXStandardWindow';},
    v=>{v.findAux.frame.x=0;},v=>{v.findAux.frame.width=0;},v=>{v.findAux.frame.height=Infinity;},
    v=>{v.axViewport={x:0,y:0,width:1,height:1};},v=>{v.point={x:1,y:1};},v=>{delete v.contained;},v=>{v.contained=false;}];
  for(const change of variants){const f=fixture();f.windowHook=(v,c)=>{change(v);return f.execution(v);};await assert.rejects(f.owner.input('find'));assert.equal(keys(f).length,1);assert.equal(f.owner.keysPending,false);assert.equal(captures(f).length,0);}
});

test('FD-N06 prospective Find permits one matching UP-only cleanup',async()=>{
  for(const action of ['find','close-find'])for(const measured of ['open','closed']){
    const f=fixture();if(action==='close-find')await open(f);await makeUnknown(f,action);f.phase=measured;
    const before=keys(f).length,result=await f.owner.releaseOwnedKeys();
    assert.equal(keys(f).length,before+1);assert.equal(keys(f).at(-1).argv[4],'release-'+action);
    assert.equal(helpers(f).at(-1).request.purpose,'release-'+action);assert.equal(result.keyGuard.nativeFindPhase,measured);
    assert.deepEqual(result.actual.keyTransitions,action==='find'?['command-up','key3-up']:['key53-up']);
    assert.equal(result.actual.keyTransitions.some(x=>x.endsWith('-down')),false);
    assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(result.cleanupOnly,true);
    const n=f.calls.length;await assert.rejects(async()=>f.owner.releaseOwnedKeys());assert.equal(f.calls.length,n);
  }
});

test('FD-N07 failed cleanup cannot retry or rebind',async()=>{
  for(const mutate of [v=>{v.frontPid=74;},v=>{v.axWindow.height++;},v=>{v.axWindowCount=4;}]){
    const f=fixture();await makeUnknown(f);f.windowHook=(v,c)=>{mutate(v);return f.execution(v);};
    await assert.rejects(f.owner.releaseOwnedKeys());assert.equal(f.owner.keysPending,true);assert.equal(f.owner.disabled,true);assert.equal(keys(f).length,1);
    const count=f.calls.length;f.windowHook=null;await assert.rejects(f.owner.releaseOwnedKeys());await assert.rejects(f.owner.input('find'));assert.equal(f.calls.length,count);
  }
  const moved=fixture();await makeUnknown(moved);moved.mount='ui42-2';const count=moved.calls.length;
  await assert.rejects(moved.owner.releaseOwnedKeys());assert.equal(moved.calls.length,count);assert.equal(moved.owner.keysPending,true);
  assert.equal(moved.records.at(-1).value.cleanupOnly,true);moved.mount='ui42-1';await assert.rejects(moved.owner.releaseOwnedKeys());assert.equal(moved.calls.length,count,'Mount mismatch consumes the only cleanup attempt');
});

test('FD-N08 screenshot uses only accepted original-root closure',async()=>{
  const f=fixture();await assert.rejects(f.owner.captureFindWindow('/controlled/no.png'));assert.equal(f.calls.length,0);await open(f);
  const original=helpers(f).at(-1).request.findRequestId,result=await f.owner.captureFindWindow('/controlled/find.png');
  const inspect=helpers(f).at(-1);assert.equal(inspect.argv[0],'--inspect-find-window');assert.equal(inspect.request.purpose,'screenshot');
  assert.equal(inspect.request.findRequestId,original);assert.notEqual(inspect.request.requestId,original);assert.equal(f.proofs.at(-1).value.action,'close-find');
  assert.equal(result.actual.nativeFindPhase,'open');assert.equal('axViewport' in result.actual,false);assert.equal(result.measurement,'native-find-window-only');
  assert.deepEqual(captures(f)[0].argv,['-x','-R22,52,1026,855','/controlled/find.png']);assert.ok(captures(f)[0].options.timeout>0&&captures(f)[0].options.timeout<=1000);
  assert.equal(keys(f).length,1,'Screenshot sends no Escape or other key');
  const g=fixture();await open(g);g.pageHook=p=>{p.start=process.hrtime.bigint()-2_000_000_000n;return p;};await assert.rejects(g.owner.captureFindWindow('/controlled/expired.png'));assert.equal(captures(g).length,0);
});

test('FD-N09 finish and context change retire while legacy lanes stay strict',async()=>{
  for(const kind of ['finish','mount','case']){
    const f=fixture();await open(f);const before=f.calls.length;
    if(kind==='finish')f.owner.retireFindEpisode();else if(kind==='mount')f.mount='ui42-2';else f.caseId='navigation';
    await assert.rejects(f.owner.captureFindWindow('/controlled/stale.png'));assert.equal(keys(f).length,1);
    if(kind!=='case')assert.equal(f.calls.length,before,'Retired mount/finish has no special measurement');
  }
  const f=fixture();await open(f);f.owner.retireFindEpisode();f.phase='closed';f.mount='ui42-2';await open(f);assert.equal(f.owner.disabled,false);
  for(const browser of ['chrome','safari']){
    const legacy=fixture({browser,optIn:false});const value=await legacy.owner.input('find');assert.equal(value.delivery,'sent');assert.equal(legacy.calls.length,2);assert.equal(keys(legacy)[0].argv.length,5);assert.equal(helpers(legacy)[0].argv[0],'--guard-key');
  }
  const ordinary=fixture();ordinary.caseId='format-keyboard';await ordinary.owner.input('enter');assert.equal(ordinary.calls.length,2);assert.equal(keys(ordinary)[0].argv.length,5);assert.equal(helpers(ordinary)[0].argv[0],'--guard-key');
  const pointer=fixture();pointer.caseId='format-pointer';await pointer.owner.input('click-strong');assert.equal(pointer.calls.length,1);assert.equal(pointer.calls[0].argv[0],'--request');
  const failed=fixture();await open(failed);const count=failed.calls.length;
  failed.pageHook=p=>{p.value.allowed=false;return p;};await assert.rejects(failed.owner.input('copy'));
  assert.equal(failed.calls.length,count);assert.equal(failed.owner.disabled,true);
  assert.ok(failed.records.some(r=>r.kind==='owned-find-retired'&&r.value.reason==='ordinary-input-failed'));
  const pending=fixture();let release;pending.pageHook=p=>new Promise(resolve=>{release=()=>resolve(p);});const operation=pending.owner.input('find');
  await assert.rejects(pending.owner.input('enter'),/One private Find operation/);pending.owner.retireFindEpisode();release();await assert.rejects(operation,/retired/);assert.equal(pending.calls.length,0);
});

test('FD-N10 known-completed key never receives redundant UP after new postcondition failure',async()=>{
  for(const kind of ['phase','postproof','deadline']){
    const f=fixture();
    if(kind==='phase')f.keyHook=(v,c)=>f.execution({...v,nativeFindPhase:'closed'});
    if(kind==='postproof')f.windowHook=(v,c)=>f.execution({...v,rootFocused:false});
    if(kind==='deadline')f.keyHook=(v,c)=>{f.proofs.at(-1).start=process.hrtime.bigint()-2_000_000_000n;return f.execution(v);};
    await assert.rejects(f.owner.input('find'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);assert.equal(keys(f).length,1);
    assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');const count=f.calls.length;
    await assert.rejects(async()=>f.owner.releaseOwnedKeys());await assert.rejects(f.owner.captureFindWindow('/controlled/no.png'));assert.equal(f.calls.length,count);
  }
});
