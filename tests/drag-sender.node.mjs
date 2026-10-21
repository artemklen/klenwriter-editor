// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled pipe/process model only: no real child, AX, browser or native input.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough, Writable} from 'node:stream';
import {createSender} from '../scripts/drag-installed/sender.mjs';

// Independent protocol literals. No production encoder/validator creates expectations.
const DOWN_JSON='{"format":"osr44-native-input/1","browser":"chrome","nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","title":"KlenWriter Drag native aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fixtureUrl":"http://127.0.0.1:4174/ui","mountedId":"ui42-1","requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:39","serial":39,"caseId":"I44-N01-en","action":"down","point":{"x":20,"y":20},"viewport":{"width":1024,"height":768,"scale":1,"offsetLeft":0,"offsetTop":0,"pageZoom":1},"pointerDown":false,"cleanupOnly":false,"deadlineMs":1000,"pid":42,"rootFrame":{"x":10,"y":20,"width":1040,"height":850},"sourceObject":"o1","handleObject":"o2","targetObject":"o3","previousScreenPoint":{"x":30,"y":40}}';
const UP_JSON='{"format":"osr44-native-input/1","browser":"chrome","nonce":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","title":"KlenWriter Drag native aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","fixtureUrl":"http://127.0.0.1:4174/ui","mountedId":"ui42-1","requestId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:40","serial":40,"caseId":"I44-N01-en","action":"up","point":{"x":100,"y":100},"viewport":{"width":1024,"height":768,"scale":1,"offsetLeft":0,"offsetTop":0,"pageZoom":1},"pointerDown":true,"cleanupOnly":true,"deadlineMs":1000,"pid":42,"rootFrame":{"x":10,"y":20,"width":1040,"height":850},"sourceObject":"o1","handleObject":"o2","targetObject":"o3","previousScreenPoint":{"x":30,"y":40}}';
const READY='{"format":"osr44-native-input-stream-ready/1","pid":4242}\n';
const DOWN_FRAME='{"format":"osr44-native-input-stream-request/1","frameId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:39","request":'+DOWN_JSON+'}\n';
const UP_FRAME='{"format":"osr44-native-input-stream-request/1","frameId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:40","request":'+UP_JSON+'}\n';
const DOWN_RESULT='{"format":"osr44-native-input-result/1","request":'+DOWN_JSON+',"action":"down","status":"sent","delivery":"sent","coreComplete":true,"postedTransitions":["down"],"frontPid":42,"screenPoint":{"x":30,"y":40},"senderContext":{"pid":4242,"sourceStateID":0,"sourceLifetime":"stream"},"postUptimeNs":"123456789"}';
const UP_RESULT='{"format":"osr44-native-input-result/1","request":'+UP_JSON+',"action":"up","status":"sent","delivery":"sent","coreComplete":true,"postedTransitions":["up"],"frontPid":42,"screenPoint":{"x":110,"y":120},"senderContext":{"pid":4242,"sourceStateID":0,"sourceLifetime":"stream"},"postUptimeNs":"123456790"}';
const DOWN_REPLY='{"format":"osr44-native-input-stream-response/1","frameId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:39","requestCode":0,"result":'+DOWN_RESULT+'}\n';
const UP_REPLY='{"format":"osr44-native-input-stream-response/1","frameId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:40","requestCode":0,"result":'+UP_RESULT+'}\n';
const REFUSAL_RESULT='{"format":"osr44-native-input-result/1","request":'+DOWN_JSON+',"action":"down","status":"refused","delivery":"unknown/may_have_sent","reason":"Controlled late owner refusal","coreComplete":false,"postedTransitions":["down"],"senderContext":{"pid":4242,"sourceStateID":0,"sourceLifetime":"stream"}}';
const REFUSAL='{"format":"osr44-native-input-stream-response/1","frameId":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:39","requestCode":2,"result":'+REFUSAL_RESULT+'}\n';
const original=()=>JSON.parse(DOWN_JSON);
const cleanup=()=>JSON.parse(UP_JSON);
const turn=()=>new Promise(resolve=>setImmediate(resolve));

class FakeChild extends EventEmitter {
  constructor({eofReaps=true,killResult=true}={}){
    super();this.pid=4242;this.exitCode=null;this.signalCode=null;
    this.stdout=new PassThrough();this.stderr=new PassThrough();
    this.writes=[];this.ends=0;this.kills=[];this.closed=false;this.exited=false;
    this.stdin=new Writable({
      write:(chunk,encoding,done)=>{this.writes.push(Buffer.from(chunk));done();},
      final:done=>{this.ends++;done();if(eofReaps)queueMicrotask(()=>this.reap(0,null));}
    });
    this.killResult=killResult;
  }
  start(line=READY){this.emit('spawn');if(line!==null)this.stdout.write(line);}
  output(value){this.stdout.write(value);}
  exit(code,signal=null){
    if(this.exited)return;this.exited=true;this.exitCode=code;this.signalCode=signal;
    this.emit('exit',code,signal);
  }
  reap(code,signal=null){
    if(this.closed)return;this.exit(code,signal);this.closed=true;
    this.stdout.end();this.stderr.end();this.emit('close',code,signal);
  }
  kill(signal){this.kills.push({pid:this.pid,signal});return this.killResult;}
  get written(){return Buffer.concat(this.writes).toString('utf8');}
}
function fixture(t,{eofReaps=true,killResult=true,startupMs=1000,lifetimeMs=600000}={}){
  const child=new FakeChild({eofReaps,killResult}),spawns=[],records=[],env={OSR44_CONTROLLED:'literal'};
  const sender=createSender({command:'controlled-helper-never-executed',env,startupMs,lifetimeMs,
    spawnImpl:(command,argv,options)=>{spawns.push({command,argv,options});return child;},
    record:(kind,value)=>records.push({kind,value:structuredClone(value)})});
  t.after(async()=>{const closing=sender.close();child.reap(0,null);await closing;});
  return {sender,child,spawns,records,env};
}
async function started(f){f.child.start();await f.sender.ready();}
async function rejection(promise){let caught;await assert.rejects(promise,error=>{caught=error;return true;});return caught;}
function assertNoReplay(f,writes){assert.equal(f.spawns.length,1);assert.equal(f.child.written,writes);}
function assertExecution(execution,frame,response,result,requestCode){
  assert.equal(execution.command,'controlled-helper-never-executed');
  assert.deepEqual(execution.argv,['--serve']);assert.equal(execution.pid,4242);
  assert.equal(execution.streaming,true);assert.equal(execution.returnCode,null);
  assert.equal(execution.requestFrame,frame);assert.equal(execution.rawResponse,response);
  assert.equal(execution.stdout,result+'\n');assert.equal(execution.requestCode,requestCode);
  assert.equal(typeof execution.wallTimeMs,'number');assert.ok(execution.wallTimeMs>=0);
}

test('D44-S01 one ready child sends two original correlated phases, preserving raw result and actual lifetime',async t=>{
  const f=fixture(t);assert.equal(f.spawns.length,1);assert.equal(f.child.written,'');
  assert.deepEqual(f.spawns[0],{command:'controlled-helper-never-executed',argv:['--serve'],options:{env:f.env,stdio:['pipe','pipe','pipe'],detached:false}});
  await started(f);f.child.stderr.write('controlled diagnostic\n');
  const down=f.sender.request(original());await turn();assert.equal(f.child.written,DOWN_FRAME);
  f.child.output(DOWN_REPLY.slice(0,19));f.child.output(DOWN_REPLY.slice(19));
  const first=await down;assertExecution(first,DOWN_FRAME,DOWN_REPLY,DOWN_RESULT,0);assert.equal(first.stderr,'controlled diagnostic\n');
  const up=f.sender.request(cleanup());await turn();assert.equal(f.child.written,DOWN_FRAME+UP_FRAME);
  f.child.output(UP_REPLY);assertExecution(await up,UP_FRAME,UP_REPLY,UP_RESULT,0);
  const closed=await f.sender.close();
  assert.equal(closed.status,'CLOSED');assert.equal(closed.reaped,true);assert.equal(closed.exitCode,0);assert.equal(closed.signal,null);
  assert.equal(closed.pid,4242);assert.equal(closed.requestCount,2);assert.equal(closed.responseCount,2);
  assert.deepEqual(closed.rawFrames,[READY,DOWN_REPLY,UP_REPLY]);assert.deepEqual(closed.signals,[]);
  assert.deepEqual(f.records.filter(x=>x.kind==='sender-request').map(x=>x.value.requestFrame),[DOWN_FRAME,UP_FRAME]);
  assert.deepEqual(f.records.filter(x=>x.kind==='sender-response').map(x=>x.value.rawResponse),[DOWN_REPLY,UP_REPLY]);
  assertNoReplay(f,DOWN_FRAME+UP_FRAME);
});

test('D44-S02 logical refusal2 preserves posted-core evidence and the same stream for original cleanup only',async t=>{
  const f=fixture(t);await started(f);
  const down=f.sender.request(original());await turn();f.child.output(REFUSAL);
  const error=await rejection(down);assertExecution(error.execution,DOWN_FRAME,REFUSAL,REFUSAL_RESULT,2);
  assert.deepEqual(JSON.parse(error.execution.stdout).postedTransitions,['down']);
  assert.equal(JSON.parse(error.execution.stdout).coreComplete,false);assert.equal(f.child.ends,0);
  const up=f.sender.request(cleanup());await turn();f.child.output(UP_REPLY);assertExecution(await up,UP_FRAME,UP_REPLY,UP_RESULT,0);
  const closed=await f.sender.close();assert.equal(closed.status,'CLOSED');assert.equal(closed.requestCount,2);assert.equal(closed.responseCount,2);
  assertNoReplay(f,DOWN_FRAME+UP_FRAME);
});

test('D44-S03 a second in-flight request is refused without another write or response reassignment',async t=>{
  const f=fixture(t);await started(f);const first=f.sender.request(original());await turn();
  const second=f.sender.request(cleanup());await rejection(second);await rejection(first);
  assertNoReplay(f,DOWN_FRAME);const closed=await f.sender.close();assert.equal(closed.status,'FAILED');
  assert.equal(closed.requestCount,1);assert.equal(closed.responseCount,0);
});

test('D44-S04 wrong, stale, duplicate and unsolicited replies poison correlation without replay',async t=>{
  for(const kind of ['wrong','stale','duplicate-same-chunk','duplicate-later','unexpected-ready','unsolicited'])await t.test(kind,async t=>{
    const f=fixture(t);await started(f);
    if(kind==='unsolicited'){
      f.child.output(DOWN_REPLY);await rejection(f.sender.request(original()));assertNoReplay(f,'');
    }else if(kind==='stale'){
      const first=f.sender.request(original());await turn();f.child.output(DOWN_REPLY);await first;
      const next=f.sender.request(cleanup());await turn();f.child.output(DOWN_REPLY);await rejection(next);assertNoReplay(f,DOWN_FRAME+UP_FRAME);
    }else if(kind==='duplicate-later'){
      const first=f.sender.request(original());await turn();f.child.output(DOWN_REPLY);await first;
      f.child.output(DOWN_REPLY);await rejection(f.sender.request(cleanup()));assertNoReplay(f,DOWN_FRAME);
    }else{
      const first=f.sender.request(original());await turn();
      f.child.output(kind==='wrong'?DOWN_REPLY.replace(':39\"',':38\"'):kind==='unexpected-ready'?READY:DOWN_REPLY+DOWN_REPLY);
      await rejection(first);await rejection(f.sender.request(cleanup()));assertNoReplay(f,DOWN_FRAME);
    }
    const closed=await f.sender.close();assert.equal(closed.status,'FAILED');assert.equal(closed.reaped,true);
  });
});

test('D44-S05 malformed, invalid UTF8, extra-key and oversized output retain failure rather than a sent phase',async t=>{
  const variants=[['json','{not-json}\n'],['utf8',Buffer.from([0xff,10])],['extra-key',DOWN_REPLY.replace('{\"format\"','{\"extra\":true,\"format\"')],['oversize-partial',Buffer.alloc(32769,120)],['oversize-complete',Buffer.concat([Buffer.alloc(32768,32),Buffer.from('\n')])],['partial-unsolicited-after-response',DOWN_REPLY+'{'],['foreign-source',DOWN_REPLY.replace('"pid":4242,"sourceStateID"','"pid":4243,"sourceStateID"')],['unallocated-sent-source',DOWN_REPLY.replace('"sourceStateID":0','"sourceStateID":null')],['foreign-echo',DOWN_REPLY.replace('"handleObject":"o2"','"handleObject":"o999"')],['invalid-code',DOWN_REPLY.replace('"requestCode":0','"requestCode":1')]];
  for(const [name,wire] of variants)await t.test(name,async t=>{
    const f=fixture(t);await started(f);const pending=f.sender.request(original());await turn();f.child.output(wire);
    await rejection(pending);await rejection(f.sender.request(cleanup()));assertNoReplay(f,DOWN_FRAME);
    const closed=await f.sender.close();assert.equal(closed.status,'FAILED');assert.equal(closed.requestCount,1);
    assert.ok(closed.stdout.bytes>=Buffer.byteLength(READY)+Buffer.byteLength(wire));
  });
});

test('D44-S06 a foreign ready PID and any output before spawn cannot authorize a request',async t=>{
  for(const beforeSpawn of [false,true])await t.test(String(beforeSpawn),async t=>{
    const f=fixture(t);const ready=f.sender.ready();
    if(beforeSpawn)f.child.output(READY);else f.child.start(READY.replace('4242','4243'));
    await rejection(ready);await rejection(f.sender.request(original()));assertNoReplay(f,'');
    const closed=await f.sender.close();assert.equal(closed.status,'FAILED');assert.equal(closed.readiness,null);
  });
});

test('D44-S07 original bindings and serial/frame identity cannot drift after the first admitted request',async t=>{
  const variants=[['serial',r=>{r.serial=39;}],['frame',r=>{r.requestId='aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:39';}],['browser',r=>{r.browser='safari';}],['pid',r=>{r.pid=43;}],['fixture',r=>{r.fixtureUrl='http://127.0.0.1:4174/foreign';}],['nonce',r=>{r.nonce='bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';r.title='KlenWriter Drag native '+r.nonce;r.requestId=r.nonce+':40';}]];
  for(const [name,change] of variants)await t.test(name,async t=>{
    const f=fixture(t);await started(f);const first=f.sender.request(original());await turn();f.child.output(DOWN_REPLY);await first;
    const next=cleanup();change(next);await rejection(f.sender.request(next));await rejection(f.sender.request(cleanup()));
    assertNoReplay(f,DOWN_FRAME);assert.equal((await f.sender.close()).status,'FAILED');
  });
});

test('D44-S08 request snapshot is immutable and closed data/one-second bounds refuse before writing',async t=>{
  const f=fixture(t);await started(f);const request=original(),pending=f.sender.request(request);
  request.point.x=777;request.sourceObject='o999';await turn();assert.equal(f.child.written,DOWN_FRAME);f.child.output(DOWN_REPLY);await pending;
  for(const [name,change] of [['extra',r=>{r.extra=true;}],['deadline',r=>{r.deadlineMs=1001;}],['oversize',r=>{r.fixtureUrl='x'.repeat(4097);}]] )await t.test(name,async t=>{
    const g=fixture(t);await started(g);const invalid=original();change(invalid);await rejection(g.sender.request(invalid));
    assertNoReplay(g,'');assert.equal((await g.sender.close()).requestCount,0);
  });
});

test('D44-S09 startup and a queued original request each have their own bounded deadline',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});
  const f=fixture(t,{startupMs:20,eofReaps:false});let settled=false;const ready=f.sender.ready().finally(()=>{settled=true;});
  t.mock.timers.tick(19);await turn();assert.equal(settled,false);t.mock.timers.tick(1);await rejection(ready);
  f.child.start();await rejection(f.sender.request(original()));assertNoReplay(f,'');
  f.child.reap(0,null);const lifetime=await f.sender.close();assert.equal(lifetime.status,'FAILED');assert.equal(lifetime.readiness,null);
  const g=fixture(t,{eofReaps:false});g.child.start(null);const request=original();request.deadlineMs=25;
  const pending=g.sender.request(request);t.mock.timers.tick(25);await rejection(pending);g.child.output(READY);
  await rejection(g.sender.request(cleanup()));assertNoReplay(g,'');g.child.reap(0,null);await g.sender.close();
});

test('D44-S10 each original request gets a fresh response budget, and timeout never sends cleanup itself',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t);await started(f);
  const a=original();const first=f.sender.request(a);await turn();t.mock.timers.tick(900);
  f.child.output(DOWN_REPLY);await first;
  const b=cleanup();const second=f.sender.request(b);await turn();t.mock.timers.tick(900);
  f.child.output(UP_REPLY);await second;
  const c={...cleanup(),requestId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:41',serial:41,deadlineMs:40};
  const timed=f.sender.request(c);await turn();const written=f.child.written;t.mock.timers.tick(40);await rejection(timed);
  await rejection(f.sender.request({...c,requestId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:42',serial:42}));assertNoReplay(f,written);
  const closed=await f.sender.close();assert.equal(closed.status,'FAILED');assert.equal(closed.requestCount,3);assert.equal(closed.responseCount,2);
});

test('D44-S11 a complete response arriving after a delayed timer is still UNKNOWN with full core evidence retained',async t=>{
  const f=fixture(t);await started(f);const request=original();request.deadlineMs=200;
  const pending=f.sender.request(request);await turn();
  // Deliberately occupy this controlled test turn: the overdue timeout cannot run first.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,250);
  const response=JSON.parse(DOWN_REPLY);response.result.request.deadlineMs=200;const raw=JSON.stringify(response)+'\n';
  f.child.output(raw);const error=await rejection(pending);
  assert.equal(error.execution.rawResponse,raw);assert.equal(error.execution.requestCode,0);
  assert.equal(JSON.parse(error.execution.stdout).coreComplete,true);assert.deepEqual(JSON.parse(error.execution.stdout).postedTransitions,['down']);
  await rejection(f.sender.request(cleanup()));assert.equal((await f.sender.close()).status,'FAILED');assert.equal(f.spawns.length,1);
});

test('D44-S12 EOF, crash, child errors and pipe failures cannot invent a completed original response',async t=>{
  for(const fault of ['eof','partial-eof','crash','child-error','stdin-error','stdout-error','stderr-error'])await t.test(fault,async t=>{
    const f=fixture(t,{eofReaps:false});await started(f);const pending=f.sender.request(original());await turn();
    if(fault==='eof')f.child.stdout.end();
    else if(fault==='partial-eof'){f.child.output('{\"format\":');f.child.stdout.end();}
    else if(fault==='crash')f.child.exit(9,null);
    else if(fault==='child-error')f.child.emit('error',Error('Controlled child error'));
    else f.child[fault.split('-')[0]].emit('error',Error('Controlled pipe failure'));
    const error=await rejection(pending);assert.equal(error.execution.stdout,'');assert.equal(error.execution.requestCode,null);
    assert.equal(error.execution.returnCode,fault==='crash'?9:null);assert.equal(error.execution.streaming,true);
    await rejection(f.sender.request(cleanup()));assertNoReplay(f,DOWN_FRAME);
    f.child.reap(fault==='crash'?9:0,null);const closed=await f.sender.close();
    assert.equal(closed.status,'FAILED');assert.equal(closed.reaped,true);assert.equal(closed.exitCode,fault==='crash'?9:0);
  });
});

test('D44-S13 close is EOF once with no generated request and waits beyond exit for actual close',async t=>{
  const f=fixture(t,{eofReaps:false});await started(f);let settled=false;
  const first=f.sender.close().then(value=>{settled=true;return value;}),second=f.sender.close();await turn();
  assert.equal(f.child.ends,1);assert.equal(f.child.written,'');assert.equal(settled,false);
  f.child.exit(0,null);await turn();assert.equal(settled,false);assert.deepEqual(f.child.kills,[]);
  f.child.reap(0,null);const [a,b]=await Promise.all([first,second]);assert.deepEqual(a,b);
  assert.equal(a.status,'CLOSED');assert.equal(a.reaped,true);assert.equal(a.exitCode,0);
  assert.equal(a.eofSent,true);assert.equal(a.requestCount,0);assert.equal(a.responseCount,0);assertNoReplay(f,'');
});

test('D44-S14 closing with an unresolved input is failure and never emits a synthetic matching Up',async t=>{
  const f=fixture(t);await started(f);const pending=f.sender.request(original());await turn();
  const closed=f.sender.close();await rejection(pending);const receipt=await closed;
  assert.equal(receipt.status,'FAILED');assert.equal(receipt.reaped,true);assert.equal(receipt.requestCount,1);
  assert.equal(f.child.ends,1);assertNoReplay(f,DOWN_FRAME);
});

test('D44-S15 EOF grace escalates only the owned PID to TERM and retains actual signal/reap failure',async t=>{
  t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{eofReaps:false});await started(f);
  const closing=f.sender.close();t.mock.timers.tick(999);await turn();assert.deepEqual(f.child.kills,[]);
  t.mock.timers.tick(1);await turn();assert.deepEqual(f.child.kills,[{pid:4242,signal:'SIGTERM'}]);
  f.child.reap(null,'SIGTERM');const receipt=await closing;
  assert.equal(receipt.status,'FAILED');assert.equal(receipt.reaped,true);assert.equal(receipt.exitCode,null);assert.equal(receipt.signal,'SIGTERM');
  assert.deepEqual(receipt.signals.map(x=>({pid:x.pid,signal:x.signal,sent:x.sent})),[{pid:4242,signal:'SIGTERM',sent:true}]);assertNoReplay(f,'');
});

test('D44-S16 KILL requires its own actual close, and kill acceptance never substitutes for reap',async t=>{
  for(const {name,observedClose,killResult} of [{name:'reaped',observedClose:true,killResult:true},{name:'kill-accepted-without-close',observedClose:false,killResult:true},{name:'kill-refused-without-close',observedClose:false,killResult:false}])await t.test(name,async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{eofReaps:false,killResult});await started(f);
    let settled=false;const closing=f.sender.close().then(receipt=>{settled=true;return receipt;});
    t.mock.timers.tick(1000);await turn();t.mock.timers.tick(1000);await turn();
    assert.deepEqual(f.child.kills,[{pid:4242,signal:'SIGTERM'},{pid:4242,signal:'SIGKILL'}]);
    assert.equal(settled,false);
    if(observedClose){f.child.exit(null,'SIGKILL');await turn();assert.equal(settled,false);f.child.reap(null,'SIGKILL');}
    else {t.mock.timers.tick(1000);await turn();}
    const receipt=await closing;assert.equal(receipt.status,'FAILED');assert.equal(receipt.reaped,observedClose);
    assert.equal(receipt.signal,observedClose?'SIGKILL':null);assert.equal(receipt.exitCode,null);
    assert.deepEqual(receipt.signals.map(x=>x.sent),[killResult,killResult]);
    assert.equal(receipt.eofSent,true);assertNoReplay(f,'');
  });
});

test('D44-S17 process lifetime, request count and stderr are independently finite',async t=>{
  await t.test('lifetime',async t=>{
    t.mock.timers.enable({apis:['setTimeout']});const f=fixture(t,{lifetimeMs:25});await started(f);
    t.mock.timers.tick(25);await turn();await rejection(f.sender.request(original()));assertNoReplay(f,'');
    assert.equal((await f.sender.close()).status,'FAILED');
  });
  await t.test('request-count',async t=>{
    const f=fixture(t);await started(f);
    for(let serial=1;serial<=1024;serial++){
      const request={...original(),requestId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:'+serial,serial};
      const pending=f.sender.request(request);await turn();
      const response=JSON.parse(DOWN_REPLY);response.frameId=request.requestId;response.result.request=request;
      f.child.output(JSON.stringify(response)+'\n');await pending;
    }
    const written=f.child.written;await rejection(f.sender.request({...original(),requestId:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa:1025',serial:1025}));
    assertNoReplay(f,written);const receipt=await f.sender.close();assert.equal(receipt.status,'FAILED');assert.equal(receipt.requestCount,1024);assert.equal(receipt.responseCount,1024);
  });
  await t.test('stderr',async t=>{
    const f=fixture(t);await started(f);f.child.stderr.write(Buffer.alloc(1048577,101));
    await rejection(f.sender.request(original()));const receipt=await f.sender.close();
    assert.equal(receipt.status,'FAILED');assert.equal(receipt.stderr.bytes,1048577);assert.equal(receipt.stderr.retainedBytes,1048576);
    assert.equal(receipt.stderr.omittedBytes,1);assert.equal(Buffer.from(receipt.stderr.base64,'base64').length,1048576);assertNoReplay(f,'');
  });
});

test('D44-S18 spawn failure is retained and cannot create a second child on ready/request/close',async()=>{
  let spawns=0;const sender=createSender({command:'controlled-helper-never-executed',spawnImpl:()=>{spawns++;throw Error('Controlled spawn failure');}});
  await rejection(sender.ready());await rejection(sender.request(original()));const receipt=await sender.close();
  assert.equal(spawns,1);assert.equal(receipt.status,'FAILED');assert.equal(receipt.pid,null);assert.equal(receipt.reaped,false);
  assert.equal(receipt.exitCode,null);assert.equal(receipt.signal,null);assert.deepEqual(receipt.signals,[]);
});
