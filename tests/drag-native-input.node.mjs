// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled mock-process lane only. No actual helper, AX, browser or native input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {caseActions,keySpecs} from '../scripts/drag-installed/protocol.mjs';
import {createInputOwner,fixedTransitions} from '../scripts/drag-installed/input.mjs';
const nonce='a'.repeat(32),frame={x:10,y:20,width:1040,height:850};
const config={format:'osr44-drag-http-broker/1',nonce,title:'KlenWriter Drag native '+nonce,fixtureUrl:'http://127.0.0.1:4174/ui'};
function setup({mutateGuard,mode,inspectPid=42,caseId='I44-N01-en',asyncRun=false}={}){
  const invocations=[],records=[];let serial=0;
  const stamp={session:'mock',generation:'1',revision:'0',selection_epoch:'1',history_epoch:'0'},context={build_id:'mock-only'};
  const gate=async(action,cleanup=false)=>{
    const point=['hover-source','move-start','down'].includes(action)?{x:20,y:20}:{x:100,y:100};
    const value={nonce,url:config.fixtureUrl,title:config.title,mountedId:'ui42-1',caseId,action,serial:++serial,editorConnected:true,allowed:true,releaseOnly:cleanup,documentFocused:true,
      sourceObject:'o1',handleObject:'o2',targetObject:'o3',viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0,pageZoom:1},point,actualUnpressedHandleMove:true,stamp,context};
    const g={id:nonce+':'+serial,start:process.hrtime.bigint(),value};mutateGuard?.(g,action,cleanup);return g;
  };
  const execute=(command,args)=>{
    assert.equal(command,'mock-helper-never-executed');const request=JSON.parse(args[1]);invocations.push({flag:args[0],request});
    if(args[0]==='--inspect-window')return{returnCode:0,stdout:JSON.stringify({status:'inspected',delivery:'not_sent',nonce,browser:'chrome',contained:true,frontPid:inspectPid,axWindow:frame})};
    const literalKeys={'tab':{normal:['key48-down','key48-up'],cleanup:['key48-up']},'zoom-in':{normal:['command-down','shift-down','key24-down','key24-up','shift-up','command-up'],cleanup:['command-up','shift-up','key24-up']}};
    const actual={format:'osr44-native-input-result/1',request,action:request.action,postedTransitions:literalKeys[request.action]?.[request.cleanupOnly?'cleanup':'normal']??fixedTransitions(request.action,request.cleanupOnly),coreComplete:true,status:'sent',delivery:'sent',frontPid:42,axWindow:frame,screenPoint:{x:request.point?.x??0,y:request.point?.y??0}};
    const special=mode?.(request,actual);if(special)throw Object.assign(Error('Controlled opaque/late completion'),{execution:{returnCode:2,stdout:JSON.stringify(special),stderr:'mock-only'}});
    return{returnCode:0,stdout:JSON.stringify(actual)};
  };
  const run=asyncRun?async(...args)=>execute(...args):execute;
  const owner=createInputOwner({browser:'chrome',config,inputHelper:'mock-helper-never-executed',run,record:(kind,value)=>records.push({kind,value}),guard:a=>gate(a),cleanupGuard:a=>gate(a,true),mountedId:()=>'ui42-1',ownedPointerPid:()=>42});
  return{owner,invocations,records};
}
async function down(f){await f.owner.input('hover-source');await f.owner.input('move-start');await f.owner.input('down');assert.equal(f.owner.pointerDown,true);}
test('D44-I01 original down held-move and up use separate closed phases with one owner',async()=>{
  const f=setup();await down(f);await f.owner.input('move-1');await f.owner.input('up');assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.disabled,false);
  const posts=f.invocations.filter(x=>x.flag==='--request').map(x=>x.request);assert.deepEqual(posts.map(x=>x.action),['hover-source','move-start','down','move-1','up']);
  assert.deepEqual(posts.map(x=>x.pointerDown),[false,false,false,true,true]);for(const p of posts){assert.equal(p.pid,42);assert.deepEqual(p.rootFrame,frame);assert.equal(p.sourceObject,'o1');}
});
test('D44-I02 a foreign mount nonce or repeated serial refuses before any platform request',async()=>{
  for(const field of ['nonce','mountedId']){const f=setup({mutateGuard:g=>g.value[field]='foreign'});await assert.rejects(f.owner.input('hover-source'));assert.equal(f.invocations.length,0);}
  const f=setup({mutateGuard:g=>g.value.serial=1});await f.owner.input('hover-source');const n=f.invocations.length;await assert.rejects(f.owner.input('move-start'));assert.equal(f.invocations.length,n);
});
test('D44-I03 an expired initial guard and foreign original browser PID cannot bind input',async()=>{
  const expired=setup({mutateGuard:g=>g.start-=2_000_000_000n});await assert.rejects(expired.owner.input('hover-source'),/expired/);assert.equal(expired.invocations.length,0);
  const foreign=setup({inspectPid:43});await assert.rejects(foreign.owner.input('hover-source'),/Chrome PID/);assert.equal(foreign.invocations.filter(x=>x.flag==='--request').length,0);
});
test('D44-I04 unknown original Down retains one matching UP-only cleanup and forbids replay',async()=>{
  const f=setup({mode:(r,a)=>r.action==='down'?{...a,coreComplete:false,status:'unknown',delivery:'unknown/may_have_sent'}:null});
  await f.owner.input('hover-source');await f.owner.input('move-start');await assert.rejects(f.owner.input('down'));assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.disabled,true);
  await assert.rejects(f.owner.input('down'));const release=await f.owner.releaseOwnedPointer();assert.equal(release.status,'released');assert.equal(f.owner.pointerDown,false);
  const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedPointer()).status,'not_required');assert.equal(f.invocations.length,n);
  const posts=f.invocations.filter(x=>x.flag==='--request').map(x=>x.request);assert.equal(posts.filter(x=>x.action==='down').length,1);assert.deepEqual(posts.at(-1).action,'up');assert.equal(posts.at(-1).cleanupOnly,true);
});
test('D44-I05 opaque move and failed cleanup cannot allocate a second release or another Down',async()=>{
  const f=setup({mode:(r,a)=>(r.action==='move-1'||r.cleanupOnly)?{...a,coreComplete:false,postedTransitions:[],status:'unknown',delivery:'unknown/may_have_sent'}:null});
  await down(f);await assert.rejects(f.owner.input('move-1'));assert.equal((await f.owner.releaseOwnedPointer()).status,'failed');const n=f.invocations.length;
  assert.equal((await f.owner.releaseOwnedPointer()).status,'already_attempted');await assert.rejects(f.owner.input('down'));assert.equal(f.invocations.length,n);
});
test('D44-I06 complete original Up with late refusal retires ownership before the failure',async()=>{
  const f=setup({mode:(r,a)=>r.action==='up'?{...a,status:'refused',delivery:'unknown/may_have_sent'}:null});await down(f);await assert.rejects(f.owner.input('up'));
  assert.equal(f.owner.pointerDown,false);const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedPointer()).status,'not_required');assert.equal(f.invocations.length,n);
});
test('D44-I07 wrong request echo or nonliteral transition cannot manufacture completed Up',async()=>{
  for(const corrupt of ['echo','transition']){
    const f=setup({mode:(r,a)=>r.action==='up'&&!r.cleanupOnly?{...a,...(corrupt==='echo'?{request:{...r,handleObject:'o999'}}:{postedTransitions:['down','up']})}:null});
    await down(f);await assert.rejects(f.owner.input('up'));assert.equal(f.owner.pointerDown,true);assert.equal((await f.owner.releaseOwnedPointer()).status,'released');
  }
});
test('D44-I08 a held native-stamp change refuses before move while same-owner cleanup remains release-only',async()=>{
  const f=setup({mutateGuard:(g,action,cleanup)=>{if(action==='move-1'&&!cleanup)g.value.stamp={...g.value.stamp,revision:'1'};}});await down(f);const n=f.invocations.length;
  await assert.rejects(f.owner.input('move-1'),/native stamp/);assert.equal(f.invocations.length,n);assert.equal((await f.owner.releaseOwnedPointer()).status,'released');
});

test('D44-I09 an original fixed modifier/key program has exact complete source-literal release',async()=>{
  const f=setup({caseId:'I44-N03-en'}),receipt=await f.owner.input('zoom-in');
  assert.deepEqual(receipt.actual.postedTransitions,['command-down','shift-down','key24-down','key24-up','shift-up','command-up']);
  assert.equal(receipt.request.point,null);assert.equal(receipt.request.cleanupOnly,false);assert.equal(f.owner.keysPending,false);
  const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedKeys()).status,'not_required');assert.equal(f.invocations.length,n);
});
test('D44-I10 an unknown partial modifier/key core permits one source-literal UP-only cleanup',async()=>{
  const f=setup({caseId:'I44-N03-en',mode:(r,a)=>r.action==='zoom-in'&&!r.cleanupOnly?{...a,coreComplete:false,status:'unknown',delivery:'unknown/may_have_sent',postedTransitions:['command-down','shift-down','key24-down']}:null});
  await assert.rejects(f.owner.input('zoom-in'));assert.equal(f.owner.keysPending,true);await assert.rejects(f.owner.input('zoom-in'));
  const cleanup=await f.owner.releaseOwnedKeys();assert.equal(cleanup.status,'released');assert.equal(f.owner.keysPending,false);
  assert.deepEqual(cleanup.receipt.actual.postedTransitions,['command-up','shift-up','key24-up']);assert.equal(cleanup.receipt.request.action,'zoom-in');assert.equal(cleanup.receipt.request.cleanupOnly,true);assert.equal(cleanup.receipt.request.point,null);
  const posts=f.invocations.filter(x=>x.flag==='--request').map(x=>x.request);assert.equal(posts.filter(x=>!x.cleanupOnly).length,1);assert.equal(posts.filter(x=>x.cleanupOnly).length,1);
  const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedKeys()).status,'not_required');assert.equal(f.invocations.length,n);
});
test('D44-I11 a complete original key core with late refusal never allocates a redundant release',async()=>{
  const f=setup({caseId:'I44-N03-en',mode:(r,a)=>r.action==='zoom-in'?{...a,status:'refused',delivery:'unknown/may_have_sent'}:null});
  await assert.rejects(f.owner.input('zoom-in'));assert.equal(f.owner.keysPending,false);assert.equal(f.owner.disabled,true);
  const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedKeys()).status,'not_required');assert.equal(f.invocations.length,n);
});

// Source-first forward navigation correction; controlled mock-process evidence only.
test('D44-I12 forward Tab is an unmodified N02 key in both locales with independent literal completion',async()=>{
  const programs=JSON.parse(readFileSync(new URL('../contracts/drag/v1/installed-programs.json',import.meta.url),'utf8'));
  const family=programs.families.find(value=>value.id==='N02'),spec={code:48,modifiers:[],domCode:'Tab'};
  const literal={normal:['key48-down','key48-up'],cleanup:['key48-up']};
  assert.equal(family.reach_handle.key,'tab');assert.equal(family.reach_handle.maximum,16);
  assert.deepEqual(programs.fixed_keys.tab,spec);assert.deepEqual(keySpecs.tab,spec);
  assert.deepEqual(programs.fixed_key_programs.tab,literal);assert.deepEqual(fixedTransitions('tab'),literal.normal);assert.deepEqual(fixedTransitions('tab',true),literal.cleanup);
  assert.deepEqual(programs.fixed_key_programs['shift-tab'],{normal:['shift-down','key48-down','key48-up','shift-up'],cleanup:['shift-up','key48-up']});
  for(const locale of ['en','ru']){
    const caseId='I44-N02-'+locale;assert.deepEqual(caseActions[caseId],family.actions);assert.ok(caseActions[caseId].includes('tab'));assert.ok(caseActions[caseId].includes('shift-tab'));
    const f=setup({caseId}),receipt=await f.owner.input('tab');
    assert.deepEqual(receipt.actual.postedTransitions,['key48-down','key48-up']);assert.equal(receipt.request.action,'tab');
    assert.equal(receipt.request.point,null);assert.equal(receipt.request.pointerDown,false);assert.equal(receipt.request.cleanupOnly,false);assert.equal(f.owner.keysPending,false);
    assert.deepEqual(f.invocations.filter(value=>value.flag==='--request').map(value=>value.request.action),['tab']);
    const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedKeys()).status,'not_required');assert.equal(f.invocations.length,n);
  }
  const unrelated=setup();await assert.rejects(unrelated.owner.input('tab'));assert.equal(unrelated.invocations.length,0);
});
test('D44-I13 unknown bare Tab completion permits only one original key48 Up without a Shift transition',async()=>{
  const f=setup({caseId:'I44-N02-en',mode:(request,actual)=>request.action==='tab'&&!request.cleanupOnly?{...actual,coreComplete:false,status:'unknown',delivery:'unknown/may_have_sent',postedTransitions:['key48-down']}:null});
  await assert.rejects(f.owner.input('tab'));assert.equal(f.owner.keysPending,true);await assert.rejects(f.owner.input('tab'));
  const cleanup=await f.owner.releaseOwnedKeys();assert.equal(cleanup.status,'released');assert.equal(f.owner.keysPending,false);
  assert.deepEqual(cleanup.receipt.actual.postedTransitions,['key48-up']);assert.equal(cleanup.receipt.request.action,'tab');assert.equal(cleanup.receipt.request.cleanupOnly,true);assert.equal(cleanup.receipt.request.point,null);
  const posts=f.invocations.filter(value=>value.flag==='--request').map(value=>value.request);assert.equal(posts.filter(value=>!value.cleanupOnly).length,1);assert.equal(posts.filter(value=>value.cleanupOnly).length,1);
  const n=f.invocations.length;assert.equal((await f.owner.releaseOwnedKeys()).status,'not_required');assert.equal(f.invocations.length,n);
});

test('D44-I14 asynchronous execution preserves original inspection, ownership and full phase replies',async()=>{
  const f=setup({asyncRun:true});await down(f);await f.owner.input('move-1');const up=await f.owner.input('up');
  assert.equal(up.knownCompleteCore,true);assert.equal(up.actual.request.action,'up');assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.disabled,false);
  assert.deepEqual(f.invocations.map(x=>x.flag),['--inspect-window','--request','--request','--request','--request','--request']);
  assert.deepEqual(f.invocations.filter(x=>x.flag==='--request').map(x=>x.request.action),['hover-source','move-start','down','move-1','up']);
});
test('D44-I15 asynchronous unknown Down still owns exactly one matching Up cleanup',async()=>{
  const f=setup({asyncRun:true,mode:(r,a)=>r.action==='down'?{...a,coreComplete:false,status:'unknown',delivery:'unknown/may_have_sent'}:null});
  await f.owner.input('hover-source');await f.owner.input('move-start');await assert.rejects(f.owner.input('down'));assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,true);
  await assert.rejects(f.owner.input('down'));assert.equal((await f.owner.releaseOwnedPointer()).status,'released');assert.equal(f.owner.pointerDown,false);
  assert.equal((await f.owner.releaseOwnedPointer()).status,'not_required');
  const posts=f.invocations.filter(x=>x.flag==='--request').map(x=>x.request);assert.equal(posts.filter(x=>x.action==='down').length,1);
  assert.deepEqual(posts.filter(x=>x.cleanupOnly).map(x=>[x.action,x.pointerDown]),[['up',true]]);
});
