// SPDX-License-Identifier: MIT OR Apache-2.0
// Finite process/clock stubs only; no helper, browser, platform input or network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSafariAxReadiness} from '../scripts/ui-native/safari-readiness.mjs';

const nonce='a'.repeat(32),title='KlenWriter UI native '+nonce;
const config={nonce,title,fixtureUrl:'http://127.0.0.1:4174/ui'};
const refusal=()=>({status:'refused',reason:'Unique measured AXWebArea viewport unavailable',delivery:'not_sent',elapsedMs:20});
const success=()=>({format:'osr42-native-window-inspection/1',status:'inspected',delivery:'not_sent',browser:'safari',nonce,title,
  fixtureUrl:'http://127.0.0.1:4174/ui',frontBundle:'com.apple.Safari',frontPid:4312,expectedAxWindowTitle:title,
  observedAxWindowTitle:title,axWindowCount:2,axMatchCount:1,visitedNodes:45,maximumDepth:10,
  axWindow:{x:80,y:60,width:1024,height:820},axViewport:{x:80,y:112,width:1024,height:768},contained:true,elapsedMs:30});
function fixture(steps){
  const f={epoch:10000,mono:0,deadline:25000,calls:[],waits:[],records:[],steps:[...steps],clockRead:null};
  f.advance=ms=>{f.epoch+=ms;f.mono+=ms;};
  f.args={config,inputHelper:'/stub/fixture-input',remainingNavigate:()=>f.deadline-f.epoch,
    clock:()=>f.clockRead?f.clockRead():f.mono,
    record:(kind,value)=>f.records.push({kind,value:structuredClone(value)}),delay:async ms=>{f.waits.push(ms);f.advance(ms);},
    run:(command,argv,options)=>{
      const request=JSON.parse(argv[1]);f.calls.push({command,argv,options,request});
      assert.equal(command,'/stub/fixture-input');assert.equal(argv[0],'--inspect-window');assert.equal(argv.length,2);
      assert.deepEqual(Object.keys(request).sort(),['browser','deadlineMs','fixtureUrl','format','nonce','title'].sort());
      assert.deepEqual({...request,deadlineMs:500},{format:'osr42-native-window-inspection/1',browser:'safari',nonce,title,fixtureUrl:config.fixtureUrl,deadlineMs:500});
      assert.ok(Number.isInteger(request.deadlineMs)&&request.deadlineMs>0&&request.deadlineMs<=500);
      assert.equal(options.timeout,request.deadlineMs);assert.equal(options.fullStdout,true);assert.equal(options.maxBuffer,32768);
      const step=f.steps.shift();assert.ok(step,'No extra sample is permitted');
      let execution={command,argv,returnCode:0,signal:null,error:null,stdout:JSON.stringify(success()),stderr:''};
      if(step==='not-ready')execution={...execution,returnCode:2,stdout:JSON.stringify(refusal())};
      else if(typeof step==='function')execution=step(execution,request,f);
      if(execution.returnCode!==0)throw Object.assign(Error('Stub process refusal/error'),{execution});
      return execution;
    }};
  return f;
}
async function refused(f){
  const result=await prepareSafariAxReadiness(f.args);
  assert.equal(result.status,'refused','Invalid readiness must abort');
  assert.ok(Array.isArray(result.samples));assert.ok(f.records.length>0,'Raw readiness changes are retained');
  return result;
}

test('S01 first valid Safari AX sample completes readiness without waiting',async()=>{
  const f=fixture(['ready']);const r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'ready');assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);assert.deepEqual(r.waits.map(w=>w.durationMs),[]);
  assert.deepEqual(r.samples[0].actual,success());assert.deepEqual(r.samples[0].execution.argv,f.calls[0].argv);
  assert.equal(f.calls[0].request.deadlineMs,500);assert.equal(r.samples[0].execution.returnCode,0);
  const short=fixture(['ready']);short.deadline=short.epoch+250;short.args.originalPid=4312;
  assert.equal((await prepareSafariAxReadiness(short.args)).status,'ready');assert.equal(short.calls[0].request.deadlineMs,250);
});

test('S02 exact not-ready refusal then valid Safari AX sample performs one passive wait',async()=>{
  const f=fixture(['not-ready','ready']);const r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'ready');assert.equal(f.calls.length,2);assert.deepEqual(f.waits,[100]);assert.deepEqual(r.waits.map(w=>w.durationMs),[100]);
  assert.deepEqual(r.samples[0].actual,refusal());assert.equal(r.samples[0].execution.returnCode,2);
  assert.deepEqual(r.samples[1].actual,success());assert.equal(f.epoch,10100);
});

test('S03 three exact not-ready refusals stop readiness without a fourth sample',async()=>{
  const f=fixture(['not-ready','not-ready','not-ready']);const r=await refused(f);
  assert.equal(f.calls.length,3);assert.equal(r.samples.length,3);assert.deepEqual(f.waits,[100,100]);assert.deepEqual(r.waits.map(w=>w.durationMs),[100,100]);
  assert.deepEqual(r.samples.map(s=>s.actual),[refusal(),refusal(),refusal()]);assert.equal(f.steps.length,0);
});

test('S04 Safari AX ownership refusal aborts readiness without retry',async()=>{
  for(const reason of ['Fixture browser is not frontmost','Exact unique fixture title is not focused','Fixture guard expired or ownership changed before post']){
    const f=fixture([(execution)=>({...execution,returnCode:2,stdout:JSON.stringify({...refusal(),reason})})]);
    const r=await refused(f);assert.equal(f.calls.length,1,reason);assert.deepEqual(f.waits,[]);assert.equal(r.samples[0].actual.reason,reason);
  }
});

test('S05 Safari AX timeout or malformed refusal never retries',async()=>{
  const badRefusal=change=>execution=>({...execution,returnCode:2,stdout:JSON.stringify(change(refusal()))});
  const vectors=[
    execution=>({...execution,returnCode:null,error:'spawnSync timed out',signal:'SIGTERM'}),
    execution=>({...execution,returnCode:2,error:'process error'}),
    execution=>({...execution,returnCode:2,signal:'SIGKILL'}),
    execution=>({...execution,returnCode:2,stderr:'unexpected diagnostic'}),
    execution=>({...execution,returnCode:2,command:'/foreign/helper',stdout:JSON.stringify(refusal())}),
    execution=>({...execution,returnCode:2,argv:['--inspect-window','{}'],stdout:JSON.stringify(refusal())}),
    execution=>({...execution,returnCode:2,stdout:'{broken'}),
    badRefusal(value=>({...value,extra:true})),badRefusal(({delivery,...value})=>value),
    badRefusal(value=>({...value,elapsedMs:'20'})),badRefusal(value=>({...value,elapsedMs:501})),
    badRefusal(value=>({...value,elapsedMs:-1})),badRefusal(value=>({...value,delivery:'unknown/may_have_sent'})),
    badRefusal(value=>({...value,status:'inspected'})),
    (execution,request,f)=>{f.advance(501);return{...execution,returnCode:2,stdout:JSON.stringify(refusal())};},
    (execution,request,f)=>{f.advance(2000);return{...execution,returnCode:2,stdout:JSON.stringify(refusal())};},
    (execution,request,f)=>{f.epoch=f.deadline;return{...execution,returnCode:2,stdout:JSON.stringify(refusal())};},
    (execution,request,f)=>{f.advance(1900);return{...execution,returnCode:2,stdout:JSON.stringify(refusal())};},
  ];
  for(const [index,step]of vectors.entries()){
    const f=fixture([step]);await refused(f);assert.equal(f.calls.length,1,'Vector '+index);assert.deepEqual(f.waits,[],'Vector '+index);
  }
  const expired=fixture(['ready']);expired.deadline=expired.epoch;await refused(expired);assert.equal(expired.calls.length,0);
  const privateExpired=fixture(['ready']);let reads=0;privateExpired.clockRead=()=>reads++===0?0:2000;
  await refused(privateExpired);assert.equal(privateExpired.calls.length,0);
  const noWait=fixture(['not-ready']);noWait.deadline=noWait.epoch+100;
  noWait.args.run=(command,argv)=>{noWait.calls.push({command,argv});return{command,argv,returnCode:2,signal:null,error:null,stdout:JSON.stringify(refusal()),stderr:''};};
  await refused(noWait);assert.equal(noWait.calls.length,1);assert.deepEqual(noWait.waits,[]);
});

test('S06 foreign or invalid Safari AX success proof never grants readiness',async()=>{
  const changes=[
    v=>({...v,nonce:'b'.repeat(32)}),v=>({...v,title:title+'x'}),v=>({...v,fixtureUrl:'http://127.0.0.1:4174/other'}),
    v=>({...v,browser:'chrome'}),v=>({...v,frontBundle:'com.google.Chrome'}),v=>({...v,frontPid:0}),v=>({...v,frontPid:2147483648}),
    v=>({...v,format:'other/1'}),v=>({...v,status:'guarded'}),v=>({...v,delivery:'sent'}),v=>({...v,extra:true}),
    ({frontBundle,...v})=>v,v=>({...v,expectedAxWindowTitle:title+' - Safari'}),v=>({...v,observedAxWindowTitle:'foreign'}),
    v=>({...v,axWindow:{...v.axWindow,extra:0}}),v=>({...v,axWindow:{...v.axWindow,width:0}}),
    v=>({...v,axViewport:{...v.axViewport,x:null}}),v=>({...v,axViewport:{...v.axViewport,width:1027}}),
    v=>({...v,axViewport:{...v.axViewport,height:765}}),v=>({...v,axViewport:{...v.axViewport,y:113}}),
    v=>({...v,contained:false}),v=>({...v,axWindowCount:0}),v=>({...v,axWindowCount:33}),v=>({...v,axMatchCount:2}),
    v=>({...v,visitedNodes:513}),v=>({...v,maximumDepth:33}),v=>({...v,maximumDepth:-1}),v=>({...v,elapsedMs:501}),
  ];
  for(const [index,change]of changes.entries()){
    const f=fixture([execution=>({...execution,stdout:JSON.stringify(change(success()))})]);await refused(f);
    assert.equal(f.calls.length,1,'Vector '+index);assert.deepEqual(f.waits,[],'Vector '+index);
  }
  const late=fixture([(execution,request,f)=>{f.epoch=f.deadline;return execution;}]);await refused(late);assert.equal(late.calls.length,1);assert.deepEqual(late.waits,[]);
  const sampleLate=fixture([(execution,request,f)=>{f.advance(501);return execution;}]);await refused(sampleLate);assert.equal(sampleLate.calls.length,1);assert.deepEqual(sampleLate.waits,[]);
  const foreignPid=fixture(['ready']);foreignPid.args.originalPid=4313;await refused(foreignPid);assert.equal(foreignPid.calls.length,1);assert.deepEqual(foreignPid.waits,[]);
});
