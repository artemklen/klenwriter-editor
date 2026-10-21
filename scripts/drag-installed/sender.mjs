// SPDX-License-Identifier: MIT OR Apache-2.0
// Source-first OSR44 candidate. Private original-input pipe; no retries or respawn.
import {spawn} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {TextDecoder} from 'node:util';

const READY='osr44-native-input-stream-ready/1';
const REQUEST='osr44-native-input-stream-request/1';
const RESPONSE='osr44-native-input-stream-response/1';
const MAX_REQUESTS=1024,MAX_ORIGINAL=4096,MAX_REQUEST=8192,MAX_RESPONSE=32768;
const MAX_STDOUT=(MAX_REQUESTS+1)*MAX_RESPONSE,MAX_STDERR=1048576,SHUTDOWN_MS=1000;
const ORIGINAL_KEYS=['format','browser','nonce','title','fixtureUrl','mountedId','requestId','serial','caseId','action','point','viewport','pointerDown','cleanupOnly','deadlineMs','pid','rootFrame','sourceObject','handleObject','targetObject','previousScreenPoint'];
const POINTER=['hover-source','move-start','down','move-1','move-2','move-3','move-4','move-5','move-6','move-7','move-8','up'];
const ACTIONS=[...POINTER,'tab','shift-tab','enter','down-key','right','escape','zoom-in','zoom-reset'];
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const keys=(v,names)=>plain(v)&&Object.keys(v).length===names.length&&names.every(name=>Object.hasOwn(v,name));
const ensure=(condition,message)=>{if(!condition)throw Error(message);};
const integer=(n,min,max)=>Number.isSafeInteger(n)&&n>=min&&n<=max;
const finite=n=>typeof n==='number'&&Number.isFinite(n);
const same=(a,b)=>{
  if(a===b)return true;
  if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((v,i)=>same(v,b[i]));
  return plain(a)&&plain(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
};
function jsonData(value,depth=0,budget={nodes:0}){
  ensure(depth<=32&&++budget.nodes<=1024,'Bounded original JSON structure required');
  if(value===null||typeof value==='boolean')return;
  if(typeof value==='number'){ensure(finite(value),'Finite original JSON number required');return;}
  if(typeof value==='string'){ensure(Buffer.byteLength(value)<=MAX_ORIGINAL,'Bounded original JSON string required');return;}
  ensure(Array.isArray(value)||plain(value),'Plain original JSON data required');
  for(const member of Object.values(value))jsonData(member,depth+1,budget);
}
function originalFrame(original){
  ensure(keys(original,ORIGINAL_KEYS),'Closed original input envelope required');jsonData(original);
  const text=JSON.stringify(original);ensure(Buffer.byteLength(text)<=MAX_ORIGINAL,'Original input exceeds4096 bytes');
  const r=JSON.parse(text); // Snapshot caller data once; later mutation cannot change a posted frame.
  ensure(r.format==='osr44-native-input/1'&&['chrome','safari'].includes(r.browser),'Original format/browser required');
  ensure(typeof r.nonce==='string'&&/^[a-f0-9]{32}$/.test(r.nonce),'Original nonce required');
  ensure(r.title==='KlenWriter Drag native '+r.nonce&&typeof r.fixtureUrl==='string'&&r.fixtureUrl.length>0,'Original title/fixture binding required');
  ensure(typeof r.requestId==='string'&&r.requestId.startsWith(r.nonce+':')&&r.requestId.length<=128,'Original request correlation required');
  ensure(integer(r.serial,1,2048)&&integer(r.deadlineMs,1,1000)&&integer(r.pid,1,2147483647),'Original serial/deadline/PID required');
  ensure(typeof r.mountedId==='string'&&/^ui42-[1-9][0-9]{0,8}$/.test(r.mountedId),'Original mounted identity required');
  ensure(typeof r.caseId==='string'&&/^I44-N0[1-8]-(en|ru)$/.test(r.caseId)&&ACTIONS.includes(r.action),'Closed case/action required');
  ensure(typeof r.pointerDown==='boolean'&&typeof r.cleanupOnly==='boolean','Original pointer/cleanup booleans required');
  for(const name of ['sourceObject','handleObject','targetObject'])ensure(typeof r[name]==='string'&&/^o[1-9][0-9]{0,4}$/.test(r[name]),'Original object token required');
  ensure(keys(r.viewport,['width','height','scale','offsetLeft','offsetTop','pageZoom'])&&Object.values(r.viewport).every(finite)&&r.viewport.width>0&&r.viewport.height>0,'Original viewport required');
  ensure(keys(r.rootFrame,['x','y','width','height'])&&Object.values(r.rootFrame).every(finite)&&r.rootFrame.width>0&&r.rootFrame.height>0,'Original root frame required');
  const point=p=>keys(p,['x','y'])&&finite(p.x)&&finite(p.y);
  ensure(r.previousScreenPoint===null||point(r.previousScreenPoint),'Original previous screen point required');
  if(POINTER.includes(r.action))ensure(point(r.point)&&r.point.x>=0&&r.point.x<r.viewport.width&&r.point.y>=0&&r.point.y<r.viewport.height,'Original fixed point inside viewport required');
  else ensure(r.point===null,'Original fixed key must have null point');
  const frame={format:REQUEST,frameId:r.requestId,request:r},raw=JSON.stringify(frame)+'\n';
  ensure(Buffer.byteLength(raw)<=MAX_REQUEST,'Request frame exceeds8192 bytes');
  return {original:r,frame,raw,binding:{browser:r.browser,nonce:r.nonce,title:r.title,fixtureUrl:r.fixtureUrl,pid:r.pid}};
}

export function createSender({command,env=process.env,spawnImpl=spawn,record=()=>{},startupMs=1000,lifetimeMs=600000}){
  ensure(typeof command==='string'&&command.length>0,'Sender command required');
  ensure(integer(startupMs,1,1000)&&integer(lifetimeMs,1,600000),'Bounded sender startup/lifetime required');
  ensure(typeof spawnImpl==='function'&&typeof record==='function','Sender spawn/record callbacks required');
  const began=performance.now(),startedAt=new Date().toISOString(),argv=['--serve'];
  let child=null,pid=null,spawned=false,closed=false,closing=false,eofSent=false,exitObserved=false;
  let exitCode=null,signal=null,closedAt=null,readyFact=null,fault=null,pending=null,binding=null,lastSerial=0;
  let requestCount=0,responseCount=0,stdoutBytes=0,stderrBytes=0,stdoutRetained=0,stderrRetained=0;
  let partial=Buffer.alloc(0),stdoutChunks=[],stderrChunks=[],startupTimer=null,lifetimeTimer=null,shutdownPromise=null;
  const signals=[],rawFrames=[],seen=new Set(),closeWaiters=new Set(),recordErrors=[];
  let resolveReady,rejectReady;
  const readyPromise=new Promise((resolve,reject)=>{resolveReady=resolve;rejectReady=reject;});
  readyPromise.catch(()=>{}); // Lifecycle failure remains observable even if ready() is never awaited.
  const elapsed=()=>performance.now()-began;
  const stderrText=()=>Buffer.concat(stderrChunks,stderrRetained).toString('utf8');
  function execution(entry,message=null){
    return {command,argv:[...argv],requestFrame:entry?.raw??null,rawResponse:entry?.rawResponse??null,
      stdout:entry?.response?JSON.stringify(entry.response.result)+'\n':'',stderr:stderrText(),
      wallTimeMs:entry?performance.now()-entry.began:elapsed(),pid,streaming:true,
      requestCode:entry?.response?.requestCode??null,returnCode:exitObserved?exitCode:null,
      signal:exitObserved?signal:null,error:message,requestWritten:entry?.written??false};
  }
  function errorFor(message,entry=pending){const error=Error(message);error.execution=execution(entry,message);return error;}
  function publish(kind,value){
    try{record(kind,{command,argv:[...argv],pid,...value});}
    catch(error){recordErrors.push(String(error?.message??error).slice(0,4096));fail('Sender evidence recording failed');}
  }
  function finishPending(error=null){
    const entry=pending;if(!entry)return;
    pending=null;clearTimeout(entry.timer);
    if(error)entry.reject(error);else entry.resolve(execution(entry));
  }
  function fail(message){
    if(!fault){
      fault={message:String(message).slice(0,8192),at:new Date().toISOString(),elapsedMs:elapsed()};
      rejectReady(errorFor(fault.message));
      const error=errorFor(fault.message);finishPending(error);
      // Do not call publish recursively when the recording callback itself failed.
      try{record('sender-fault',{command,argv:[...argv],pid,fault});}catch(error){recordErrors.push(String(error?.message??error).slice(0,4096));}
    }
    if(child&&!closed)void startShutdown();
  }
  function appendLog(kind,chunk){
    const isOut=kind==='stdout',cap=isOut?MAX_STDOUT:MAX_STDERR;
    const retained=isOut?stdoutRetained:stderrRetained,keep=chunk.subarray(0,Math.max(0,cap-retained));
    if(isOut){stdoutBytes+=chunk.length;stdoutRetained+=keep.length;stdoutChunks.push(keep);if(stdoutChunks.length>=4096)stdoutChunks=[Buffer.concat(stdoutChunks,stdoutRetained)];}
    else {stderrBytes+=chunk.length;stderrRetained+=keep.length;stderrChunks.push(keep);if(stderrChunks.length>=4096)stderrChunks=[Buffer.concat(stderrChunks,stderrRetained)];}
    if(keep.length!==chunk.length)fail('Sender '+kind+' total bound exceeded; retained prefix and omitted byte count are explicit');
    return keep;
  }
  function validateResponse(value,raw,receivedAt){
    ensure(keys(value,['format','frameId','requestCode','result'])&&value.format===RESPONSE,'Closed sender response required');
    ensure(pending&&pending.written&&!pending.response,'Unexpected/duplicate sender response');
    ensure(value.frameId===pending.original.requestId,'Wrong/stale sender response correlation');
    ensure(value.requestCode===0||value.requestCode===2,'Logical requestCode0/2 required');
    ensure(plain(value.result),'Original native result required');
    const context=value.result.senderContext;
    ensure(keys(context,['pid','sourceStateID','sourceLifetime'])&&context.pid===pid&&context.sourceLifetime==='stream'&&(context.sourceStateID===0||context.sourceStateID===null),'Original senderContext required');
    if(Object.hasOwn(value.result,'request'))ensure(same(value.result.request,pending.original),'Original native request echo differs');
    if(value.requestCode===0){
      ensure(value.result.status==='sent'&&value.result.delivery==='sent'&&same(value.result.request,pending.original),'Sent original native result/echo required');
      ensure(context.sourceStateID===0,'Sent input must use retained combined source');
    }else ensure(value.result.status==='refused','Refusal result required for requestCode2');
    pending.rawResponse=raw;pending.response=value;responseCount++;
    const receivedElapsedMs=receivedAt-pending.began,deadlineMs=pending.original.deadlineMs;
    publish('sender-response',{frameId:value.frameId,requestCode:value.requestCode,rawResponse:raw,result:value.result,receivedElapsedMs});
    ensure(receivedElapsedMs<=deadlineMs,'Original sender response arrived after deadline; delivery UNKNOWN');
  }
  function consumeLine(bytes){
    const receivedAt=performance.now();
    ensure(bytes.length<=MAX_RESPONSE,'Sender response frame exceeds32768 bytes including LF');
    const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes);
    ensure(!raw.includes('\r')&&raw.endsWith('\n'),'Sender JSONLF framing required');
    ensure(rawFrames.length<MAX_REQUESTS+1,'Sender output frame count exceeded');
    rawFrames.push(raw);
    if(readyFact&&pending?.written)pending.rawResponse=raw;
    const value=JSON.parse(raw.slice(0,-1));
    if(!readyFact){
      ensure(keys(value,['format','pid'])&&value.format===READY,'Initial closed sender readiness required');
      ensure(spawned&&integer(pid,1,2147483647)&&value.pid===pid,'Ready PID differs from owned child');
      readyFact={pid,rawResponse:raw,at:new Date().toISOString(),elapsedMs:elapsed()};clearTimeout(startupTimer);
      publish('sender-ready',{readiness:readyFact});if(!fault)resolveReady();
    }else validateResponse(value,raw,receivedAt);
  }
  function onStdout(data){
    const chunk=appendLog('stdout',Buffer.isBuffer(data)?data:Buffer.from(data));
    if(fault)return;
    try{
      let offset=0;
      while(offset<chunk.length){
        const end=chunk.indexOf(10,offset),stop=end<0?chunk.length:end+1,part=chunk.subarray(offset,stop);
        ensure(partial.length+part.length<=MAX_RESPONSE,'Sender partial frame exceeds32768 bytes');
        partial=Buffer.concat([partial,part]);offset=stop;
        if(end>=0){const line=partial;partial=Buffer.alloc(0);consumeLine(line);if(fault)return;}
      }
      ensure(!partial.length||!readyFact||(pending?.written&&!pending.response),'Unexpected unsolicited partial sender output');
      // A second frame in this same chunk must fault before a phase can settle.
      if(pending?.response&&!fault){
        const entry=pending;
        if(entry.response.requestCode===2)finishPending(errorFor(entry.response.result.reason??'Original input refused',entry));
        else finishPending();
      }
    }catch(error){fail('Sender output integrity failure: '+String(error?.message??error));}
  }
  function waitClosed(ms){
    if(closed)return Promise.resolve(true);
    return new Promise(resolve=>{
      const done=()=>{clearTimeout(timer);closeWaiters.delete(done);resolve(true);};
      const timer=setTimeout(()=>{closeWaiters.delete(done);resolve(false);},ms);closeWaiters.add(done);
    });
  }
  function signalOwned(name){
    if(closed||exitObserved)return;
    const entry={signal:name,pid,at:new Date().toISOString(),sent:false};signals.push(entry);
    try{ensure(integer(pid,1,2147483647)&&child.pid===pid,'Original owned child PID required for termination');entry.sent=child.kill(name)===true;}
    catch(error){entry.error=String(error?.message??error).slice(0,4096);}
  }
  function lifetimeReceipt(){
    return {format:'osr44-native-input-sender-lifetime/1',command,argv:[...argv],pid,
      exitCode:exitObserved?exitCode:null,signal:exitObserved?signal:null,reaped:closed,
      status:closed&&exitCode===0&&signal===null&&readyFact&&!fault?'CLOSED':'FAILED',
      startedAt,closedAt,wallTimeMs:elapsed(),readiness:readyFact,requestCount,responseCount,
      signals:signals.map(v=>({...v})),fault,recordErrors:[...recordErrors],eofSent,
      rawFrames:[...rawFrames],partialStdoutBase64:partial.toString('base64'),
      stdout:{bytes:stdoutBytes,retainedBytes:stdoutRetained,omittedBytes:stdoutBytes-stdoutRetained,base64:Buffer.concat(stdoutChunks,stdoutRetained).toString('base64')},
      stderr:{bytes:stderrBytes,retainedBytes:stderrRetained,omittedBytes:stderrBytes-stderrRetained,base64:Buffer.concat(stderrChunks,stderrRetained).toString('base64')}};
  }
  function startShutdown(){
    if(shutdownPromise)return shutdownPromise;
    closing=true;
    let settleShutdown;
    shutdownPromise=new Promise(resolve=>{settleShutdown=resolve;});
    // Publish the one shutdown promise before any synchronous fake-child callback.
    void (async()=>{
      if(child&&!closed&&!eofSent){
        eofSent=true;
        try{child.stdin.end();}catch(error){fail('Sender stdin EOF failed: '+String(error?.message??error));}
      }
      if(child&&!await waitClosed(SHUTDOWN_MS)){
        fail('Sender did not close within EOF grace');signalOwned('SIGTERM');
        if(!await waitClosed(SHUTDOWN_MS)){
          signalOwned('SIGKILL');
          if(!await waitClosed(SHUTDOWN_MS))fail('Sender close/reap unobserved after owned SIGKILL');
        }
      }
      clearTimeout(startupTimer);clearTimeout(lifetimeTimer);
      const receipt=lifetimeReceipt();publish('sender-lifetime',{lifetime:receipt});
      return lifetimeReceipt();
    })().then(settleShutdown,error=>{fail('Sender shutdown failed: '+String(error?.message??error));settleShutdown(lifetimeReceipt());});
    return shutdownPromise;
  }
  try{
    child=spawnImpl(command,argv,{env,stdio:['pipe','pipe','pipe'],detached:false});
    ensure(child&&child.stdin&&child.stdout&&child.stderr&&typeof child.on==='function','Owned child and three pipes required');
    if(integer(child.pid,1,2147483647))pid=child.pid;
    child.once('spawn',()=>{spawned=true;pid=child.pid;if(!integer(pid,1,2147483647))fail('Invalid actual child PID');});
    child.stdout.on('data',onStdout);
    child.stderr.on('data',data=>appendLog('stderr',Buffer.isBuffer(data)?data:Buffer.from(data)));
    child.stdin.on('error',error=>fail('Sender stdin error: '+String(error?.message??error)));
    child.stdout.on('error',error=>fail('Sender stdout error: '+String(error?.message??error)));
    child.stderr.on('error',error=>fail('Sender stderr error: '+String(error?.message??error)));
    child.stdout.once('end',()=>{if(!closing||pending||partial.length)fail('Sender stdout EOF before complete requested close/response');});
    child.once('error',error=>fail('Sender child error: '+String(error?.message??error)));
    child.once('exit',(code,terminationSignal)=>{
      exitObserved=true;exitCode=code;signal=terminationSignal;
      if(!closing||pending||code!==0||terminationSignal!==null)fail('Sender child exited before clean requested close');
    });
    child.once('close',(code,terminationSignal)=>{
      closed=true;exitObserved=true;exitCode=code;signal=terminationSignal;closedAt=new Date().toISOString();
      clearTimeout(startupTimer);clearTimeout(lifetimeTimer);
      if(!closing||pending||partial.length||!readyFact||code!==0||terminationSignal!==null)fail('Sender closed without complete clean lifecycle');
      for(const done of [...closeWaiters])done();
    });
    startupTimer=setTimeout(()=>fail('Sender readiness timed out'),startupMs);
    lifetimeTimer=setTimeout(()=>fail('Sender600s lifetime expired'),lifetimeMs);
  }catch(error){fail('Sender spawn failed: '+String(error?.message??error));}

  function request(original){
    let entry=null;
    try{
      ensure(!fault&&!closing&&!closed,'Sender unavailable; no respawn/replay');
      ensure(!pending,'Exactly one in-flight sender request required');
      ensure(elapsed()<lifetimeMs&&requestCount<MAX_REQUESTS,'Sender lifetime/request limit reached');
      const value=originalFrame(original);
      ensure(!seen.has(value.original.requestId)&&value.original.serial>lastSerial,'Repeated frame ID or nonincreasing original serial');
      ensure(!binding||same(binding,value.binding),'Original browser/nonce/title/fixture/PID binding differs');
      entry={...value,began:performance.now(),written:false,response:null,rawResponse:null,timer:null,resolve:null,reject:null};
      const promise=new Promise((resolve,reject)=>{entry.resolve=resolve;entry.reject=reject;});promise.catch(()=>{});
      pending=entry;entry.timer=setTimeout(()=>fail('Original sender response deadline expired; delivery UNKNOWN'),entry.original.deadlineMs);
      readyPromise.then(()=>{
        if(pending!==entry||fault||closing||closed)return;
        try{
          ensure(performance.now()-entry.began<entry.original.deadlineMs,'Original input deadline expired before write');
          binding??=entry.binding;lastSerial=entry.original.serial;seen.add(entry.original.requestId);
          publish('sender-request',{frameId:entry.original.requestId,requestFrame:entry.raw});
          if(fault||pending!==entry)return;
          entry.written=true;requestCount++;
          child.stdin.write(entry.raw,'utf8',error=>{if(error)fail('Sender request write failed: '+String(error?.message??error));});
        }catch(error){fail(String(error?.message??error));}
      },error=>fail(String(error?.message??error)));
      return promise;
    }catch(error){
      const message=String(error?.message??error);fail(message);return Promise.reject(errorFor(message,entry));
    }
  }
  function close(){
    if(pending)fail('Sender close requested with unresolved original input');
    return startShutdown();
  }
  return {ready:()=>readyPromise,request,close};
}
