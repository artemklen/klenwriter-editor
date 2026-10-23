// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled process/clock receipts only. No helper/AX/CG/OS/browser/network invocation.
// Expected geometry is synthetic and source-authored, not learned from candidate output.
import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareSafariAxReadiness} from '../scripts/accessibility-presentation/safari-readiness.mjs';

const nonce='c'.repeat(32),title='KlenWriter Accessibility native '+nonce;
const config={nonce,title,fixtureUrl:'http://127.0.0.1:4174/accessibility'};
const legacy=()=>({format:'osr66-native-window-inspection/1',status:'inspected',delivery:'not_sent',browser:'safari',
  nonce,title,fixtureUrl:config.fixtureUrl,frontBundle:'com.apple.Safari',frontPid:4312,
  expectedAxWindowTitle:title,observedAxWindowTitle:title,axWindowCount:2,axMatchCount:1,visitedNodes:45,maximumDepth:10,
  axWindow:{x:80,y:60,width:1200,height:900},axViewport:{x:80,y:112,width:1024,height:768},contained:true,elapsedMs:30});
const scrollProof=()=>({basis:'safari-scroll-viewport',content:{x:80,y:112,width:1007,height:900},
  scrollArea:{x:80,y:112,width:1024,height:768},visibleContent:{x:80,y:112,width:1007,height:768},
  scrollBar:{role:'AXScrollBar',orientation:'AXVerticalOrientation',frame:{x:1087,y:130,width:17,height:800}},
  totalWebAreas:1,oldExactWebAreaMatches:0,genuineDirectParent:true});
const fallback=()=>{const proof=scrollProof();return {...legacy(),axViewportProof:{...proof,rechecks:[scrollProof()]}};};
const notReady=()=>({status:'refused',reason:'Unique measured AXWebArea viewport unavailable',delivery:'not_sent',elapsedMs:20});
const withValue=(change,make=fallback)=>(execution)=>{const value=make();change(value);return {...execution,stdout:JSON.stringify(value)};};

function fixture(steps){
  const f={mono:0,epoch:10000,deadline:25000,calls:[],waits:[],records:[],steps:[...steps]};
  f.advance=ms=>{f.mono+=ms;f.epoch+=ms;};
  f.args={config,inputHelper:'/stub/a66-fixture-input',originalPid:4312,clock:()=>f.mono,
    remainingNavigate:()=>f.deadline-f.epoch,
    delay:async ms=>{f.waits.push(ms);f.advance(ms);},
    record:(kind,value)=>f.records.push({kind,value:structuredClone(value)}),
    run:(command,argv,options)=>{
      const request=JSON.parse(argv[1]);f.calls.push({command,argv:structuredClone(argv),options:structuredClone(options),request});
      // Any future valid-input or alternate-process invocation fails the control itself.
      assert.equal(command,'/stub/a66-fixture-input');assert.equal(argv.length,2);assert.equal(argv[0],'--inspect-window');
      assert.deepEqual(Object.keys(request).sort(),['format','browser','nonce','title','fixtureUrl','deadlineMs'].sort());
      assert.deepEqual({...request,deadlineMs:500},{format:'osr66-native-window-inspection/1',browser:'safari',nonce,title,fixtureUrl:config.fixtureUrl,deadlineMs:500});
      assert.ok(Number.isInteger(request.deadlineMs)&&request.deadlineMs>0&&request.deadlineMs<=500);
      assert.equal(options.timeout,request.deadlineMs);assert.equal(options.fullStdout,true);assert.equal(options.maxBuffer,32768);
      const step=f.steps.shift();assert.ok(step,'No unplanned process sample is permitted');
      const value=step==='not-ready'?notReady():step==='fallback'?fallback():legacy();
      f.advance(value.elapsedMs);
      let execution={command,argv,returnCode:step==='not-ready'?2:0,signal:null,error:null,stdout:JSON.stringify(value),stderr:''};
      if(typeof step==='function')execution=step(execution,request,f);
      if(execution.returnCode!==0)throw Object.assign(Error('Controlled process refusal/error'),{execution});
      return execution;
    }};
  return f;
}
async function refuseOnce(f,label){
  const value=await prepareSafariAxReadiness(f.args);
  assert.equal(value.status,'refused',label);assert.equal(f.calls.length,1,label);assert.deepEqual(f.waits,[],label);
  assert.equal(value.samples.length,1,label);assert.equal(value.samples[0].execution.stdout,f.records.find(row=>row.kind==='safari-ax-readiness-sample').value.execution.stdout,label);
  assert.ok(value.reason?.length,label);assert.equal(f.records.at(-1).kind,'safari-ax-readiness-terminal',label);
  return value;
}
async function rejectChanges(changes,make=fallback){
  for(const [label,change]of changes){
    const f=fixture([withValue(change,make)]),r=await refuseOnce(f,label);
    assert.equal(r.samples[0].execution.returnCode,0,label);
    assert.deepEqual(r.samples[0].actual,JSON.parse(r.samples[0].execution.stdout),label);
    assert.equal(f.steps.length,0,label);
  }
}

test('APR01 original closed19 inspection remains ready without fallback or passive wait',async()=>{
  const f=fixture(['legacy']),r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'ready');assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
  assert.deepEqual(r.measurement,legacy());assert.equal(Object.keys(r.measurement).length,19);
  assert.equal(Object.hasOwn(r.measurement,'axViewportProof'),false);assert.equal(r.elapsedMs,30);
});

test('APR02 closed20 classic17 fallback and exactly one fresh owner recheck preserve full proof',async()=>{
  const f=fixture(['fallback']),r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'ready');assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
  assert.deepEqual(r.measurement,fallback());assert.equal(Object.keys(r.measurement).length,20);
  assert.equal(r.measurement.axViewport.width,1024);assert.equal(r.measurement.axViewportProof.content.width,1007);
  assert.deepEqual(r.measurement.axViewportProof.visibleContent,{x:80,y:112,width:1007,height:768});
  assert.equal(r.measurement.axViewportProof.rechecks.length,1);
});

test('APR03 source-valid content growth or offscreen vertical extent does not become viewport authority',async()=>{
  const values=[
    value=>{value.axViewportProof.rechecks[0].content.height=940;},
    value=>{for(const p of [value.axViewportProof,...value.axViewportProof.rechecks]){p.content.y=72;p.content.height=940;}},
    value=>{for(const p of [value.axViewportProof,...value.axViewportProof.rechecks]){p.scrollBar.frame.y=2000;p.scrollBar.frame.height=3;}},
  ];
  for(const change of values){const expected=fallback();change(expected);const f=fixture([withValue(change)]),r=await prepareSafariAxReadiness(f.args);
    assert.equal(r.status,'ready');assert.deepEqual(r.measurement,expected);assert.deepEqual(r.measurement.axViewport,{x:80,y:112,width:1024,height:768});assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);}
});

test('APR04 overlay zero-gap fallback without a scrollbar remains a valid distinct geometry',async()=>{
  const change=value=>{for(const p of [value.axViewportProof,...value.axViewportProof.rechecks]){p.content.width=1024;p.visibleContent.width=1024;p.scrollBar=null;}};
  const f=fixture([withValue(change)]),r=await prepareSafariAxReadiness(f.args),expected=fallback();change(expected);
  assert.equal(r.status,'ready');assert.deepEqual(r.measurement,expected);assert.equal(f.calls.length,1);assert.deepEqual(f.waits,[]);
});

test('APR05 unknown or missing outer fields never broaden original19 or optional20 completion',async()=>{
  for(const make of [legacy,fallback])await rejectChanges([
    ['extra outer',v=>{v.extra=true;}],['missing owner',v=>{delete v.frontBundle;}],
    ['missing viewport',v=>{delete v.axViewport;}],['false success',v=>{v.status='guarded';}],
  ],make);
  await rejectChanges([['null fallback',v=>{v.axViewportProof=null;}],['unrelated object fallback',v=>{v.axViewportProof={};}]]);
});

test('APR06 proof and recheck are exact closed shapes with truthful route and parent facts',async()=>{
  await rejectChanges([
    ['extra outer proof',v=>{v.axViewportProof.extra=true;}],['missing outer visible',v=>{delete v.axViewportProof.visibleContent;}],
    ['extra recheck proof',v=>{v.axViewportProof.rechecks[0].extra=true;}],['missing recheck parent',v=>{delete v.axViewportProof.rechecks[0].genuineDirectParent;}],
    ['wrong basis',v=>{v.axViewportProof.basis='AXWebArea';}],['multiple webareas',v=>{v.axViewportProof.totalWebAreas=2;}],
    ['old route also matches',v=>{v.axViewportProof.oldExactWebAreaMatches=1;}],['false direct parent',v=>{v.axViewportProof.genuineDirectParent=false;}],
    ['recheck false route',v=>{v.axViewportProof.rechecks[0].oldExactWebAreaMatches=1;}],
  ]);
});

test('APR07 zero or multiple or recursively nested rechecks are not the one inspection recheck',async()=>{
  await rejectChanges([
    ['zero rechecks',v=>{v.axViewportProof.rechecks=[];}],['two rechecks',v=>{v.axViewportProof.rechecks.push(scrollProof());}],
    ['nonarray recheck',v=>{v.axViewportProof.rechecks=scrollProof();}],['null recheck',v=>{v.axViewportProof.rechecks=[null];}],
    ['nested rechecks',v=>{v.axViewportProof.rechecks[0].rechecks=[];}],
  ]);
});

test('APR08 full scroll viewport and exact visible intersection cannot be relabeled or rebound',async()=>{
  await rejectChanges([
    ['content mislabeled viewport',v=>{v.axViewport={...v.axViewportProof.content};}],
    ['outer scroll not viewport',v=>{v.axViewportProof.scrollArea.x=81;}],
    ['initial visible wrong',v=>{v.axViewportProof.visibleContent.width=1008;}],
    ['recheck visible wrong',v=>{v.axViewportProof.rechecks[0].visibleContent.y=113;}],
    ['valid but changed visible/bar',v=>{const p=v.axViewportProof.rechecks[0];p.content.width=1008;p.visibleContent.width=1008;p.scrollBar.frame.x=1088;p.scrollBar.frame.width=16;}],
  ]);
});

test('APR09 content left top coverage and right-strip geometry fail closed rather than clamp',async()=>{
  await rejectChanges([
    ['left escapes alignment',v=>{v.axViewportProof.content.x=81;}],
    ['top leaves uncovered strip',v=>{v.axViewportProof.content.y=113;}],
    ['bottom leaves uncovered strip',v=>{v.axViewportProof.content.height=767;}],
    ['content right beyond scroll',v=>{v.axViewportProof.content.width=1025;}],
    ['right gap exceeds32',v=>{v.axViewportProof.content.width=991;}],
    ['recheck coverage lost',v=>{v.axViewportProof.rechecks[0].content.height=767;}],
    ['scroll outside owned root',v=>{v.axWindow.width=1023;}],
  ]);
});

test('APR10 classic-strip scrollbar identity role orientation and finite frame stay closed',async()=>{
  await rejectChanges([
    ['classic strip missing bar',v=>{v.axViewportProof.scrollBar=null;}],
    ['bar role',v=>{v.axViewportProof.scrollBar.role='AXScrollArea';}],
    ['horizontal bar',v=>{v.axViewportProof.scrollBar.orientation='AXHorizontalOrientation';}],
    ['bar extra field',v=>{v.axViewportProof.scrollBar.extra=true;}],
    ['bar wrong x',v=>{v.axViewportProof.scrollBar.frame.x=1088;}],
    ['bar wrong width',v=>{v.axViewportProof.scrollBar.frame.width=16;}],
    ['bar zero height',v=>{v.axViewportProof.scrollBar.frame.height=0;}],
    ['bar changed Y only on recheck',v=>{v.axViewportProof.rechecks[0].scrollBar.frame.y++;}],
  ]);
});

test('APR11 malformed numeric rectangles never become finite positive geometry',async()=>{
  await rejectChanges([
    ['null content x',v=>{v.axViewportProof.content.x=null;}],
    ['nonfinite serialized width',v=>{v.axViewportProof.content.width=Infinity;}],
    ['negative visible width',v=>{v.axViewportProof.visibleContent.width=-1;}],
    ['missing recheck coordinate',v=>{delete v.axViewportProof.rechecks[0].content.y;}],
    ['extra rectangle key',v=>{v.axViewportProof.scrollArea.scale=1;}],
    ['string coordinate',v=>{v.axViewportProof.content.x='80';}],
  ]);
});

test('APR12 fallback geometry cannot replace owner nonce title bundle PID or AX observation bounds',async()=>{
  await rejectChanges([
    ['foreign nonce',v=>{v.nonce='d'.repeat(32);}],['foreign title',v=>{v.title+='x';}],
    ['foreign URL',v=>{v.fixtureUrl='http://127.0.0.1:4174/other';}],['foreign bundle',v=>{v.frontBundle='com.google.Chrome';}],
    ['foreign expected title',v=>{v.expectedAxWindowTitle+='x';}],['foreign actual title',v=>{v.observedAxWindowTitle='foreign';}],
    ['different original PID',v=>{v.frontPid=4313;}],['zero PID',v=>{v.frontPid=0;}],
    ['wrong browser',v=>{v.browser='chrome';}],['sent delivery',v=>{v.delivery='sent';}],['false containment',v=>{v.contained=false;}],
    ['window cap',v=>{v.axWindowCount=33;}],['node cap',v=>{v.visitedNodes=513;}],['depth cap',v=>{v.maximumDepth=33;}],
    ['duplicate title match',v=>{v.axMatchCount=2;}],
  ]);
});

test('APR13 malformed or failed process completion never triggers another readiness sample',async()=>{
  const vectors=[
    e=>({...e,stdout:'{broken'}),e=>({...e,stdout:JSON.stringify(fallback())+' '.repeat(32769)}),
    e=>({...e,stderr:'diagnostic'}),e=>({...e,signal:'SIGTERM'}),e=>({...e,error:'timeout'}),
    e=>({...e,command:'/foreign/helper'}),e=>({...e,argv:['--inspect-window','{}']}),
    e=>({...e,returnCode:null,signal:'SIGKILL'}),e=>({...e,returnCode:2}),
  ];
  for(const [index,step]of vectors.entries())await refuseOnce(fixture([step]),'Process vector '+index);
});

test('APR14 only exact unavailable refusal may passively wait then return a closed fallback sample',async()=>{
  const f=fixture(['not-ready','fallback']),r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'ready');assert.equal(f.calls.length,2);assert.deepEqual(f.waits,[100]);
  assert.deepEqual(r.samples[0].actual,notReady());assert.equal(r.samples[0].execution.returnCode,2);
  assert.deepEqual(r.samples[1].actual,fallback());assert.deepEqual(r.measurement,fallback());assert.equal(r.elapsedMs,150);
  const badReasons=['Fixture browser is not frontmost','Fixture title not focused','Original Safari scroll viewport changed before post'];
  for(const reason of badReasons){const step=e=>({...e,returnCode:2,stdout:JSON.stringify({...notReady(),reason})});await refuseOnce(fixture([step]),reason);}
});

test('APR15 original navigate remainder and delayed passive wait cannot reset cumulative budgets',async()=>{
  const short=fixture(['not-ready','fallback']);short.deadline=short.epoch+200;
  const result=await prepareSafariAxReadiness(short.args);assert.equal(result.status,'ready');
  assert.deepEqual(short.calls.map(c=>c.request.deadlineMs),[200,80]);assert.equal(result.elapsedMs,150);assert.deepEqual(short.waits,[100]);
  const expired=fixture(['fallback']);expired.deadline=expired.epoch;
  assert.equal((await prepareSafariAxReadiness(expired.args)).status,'refused');assert.equal(expired.calls.length,0);assert.deepEqual(expired.waits,[]);
  const noWait=fixture(['not-ready']);noWait.deadline=noWait.epoch+100;await refuseOnce(noWait,'No budget for full100ms passive wait');
  const delayed=fixture(['not-ready']);delayed.args.delay=async ms=>{delayed.waits.push(ms);delayed.advance(2000);};
  const late=await prepareSafariAxReadiness(delayed.args);assert.equal(late.status,'refused');assert.equal(delayed.calls.length,1);assert.deepEqual(delayed.waits,[100]);assert.ok(late.elapsedMs>=2000);
  const processLate=fixture([(execution,request,f)=>{f.advance(471);return {...execution,stdout:JSON.stringify(fallback())};}]);await refuseOnce(processLate,'Actual sample501ms');
  const helperLate=fixture([withValue(v=>{v.elapsedMs=501;})]);await refuseOnce(helperLate,'Helper-reported sample501ms');
});

test('APR16 three exact notReady samples retain all raw refusals and never make a fourth attempt',async()=>{
  const f=fixture(['not-ready','not-ready','not-ready']),r=await prepareSafariAxReadiness(f.args);
  assert.equal(r.status,'refused');assert.equal(f.calls.length,3);assert.equal(r.samples.length,3);assert.equal(f.steps.length,0);
  assert.deepEqual(f.waits,[100,100]);assert.deepEqual(r.samples.map(s=>s.actual),[notReady(),notReady(),notReady()]);
  assert.deepEqual(r.samples.map(s=>s.execution.returnCode),[2,2,2]);assert.equal(r.elapsedMs,260);
});

// Additive paired-number controls: real owner, in-memory callbacks only. No child process.
// Expected numbers/transitions below are literal fixtures, never copied from the request under test.
import {createInputOwner} from '../scripts/accessibility-presentation/input.mjs';

function pointerClock(t){
  const clock={now:0n};t.mock.method(process.hrtime,'bigint',()=>clock.now);
  clock.advance=ms=>{clock.now+=BigInt(ms)*1000000n;};return clock;
}
function pointerFixture(clock,steps,{firstSerial=1,foreignCleanup=false}={}){
  let nextSerial=firstSerial;
  const f={calls:[],guards:[],records:[],steps:[...steps]};
  const ownConfig={...config,format:'osr66-accessibility-http-broker/1'};
  const viewport={width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0,pageZoom:1};
  function page(action,cleanup){
    assert.equal(action,'click-strong','Only the original fixed pointer action is allowed');
    const serial=nextSerial++,mount=cleanup&&foreignCleanup?'a66-2':'a66-1';
    const value={nonce,url:config.fixtureUrl,title,id:mount,mountedId:mount,caseId:'presentation-kwdj',action,
      target:'strong',point:{x:40,y:40},viewport:{...viewport},pointerDown:false,editorConnected:true,
      documentFocused:true,allowed:true,serial,zoomEvidence:{dprRatio:1},...(cleanup?{releaseOnly:true}:{})};
    const proof={id:nonce+':'+serial,start:clock.now,value};f.guards.push({cleanup,proof:structuredClone(proof)});return proof;
  }
  // This stub is the ONLY execution seam. No native helper, shell or process is callable.
  function run(command,argv,options){
    assert.equal(command,'/stub/a66-pointer');assert.equal(argv.length,2);assert.equal(argv[0],'--request');
    const request=JSON.parse(argv[1]);
    assert.deepEqual(Object.keys(request).sort(),['format','browser','nonce','title','fixtureUrl','mountedId','requestId','serial','caseId','action','target','point','viewport','pointerDown','cleanupOnly','deadlineMs','mouseEventNumber'].sort());
    assert.deepEqual({format:request.format,browser:request.browser,nonce:request.nonce,title:request.title,fixtureUrl:request.fixtureUrl,mountedId:request.mountedId,caseId:request.caseId,action:request.action,target:request.target,point:request.point,viewport:request.viewport},
      {format:'osr66-native-input/1',browser:'chrome',nonce,title,fixtureUrl:config.fixtureUrl,mountedId:'a66-1',caseId:'presentation-kwdj',action:'click-strong',target:'strong',point:{x:40,y:40},viewport});
    assert.ok(Number.isInteger(request.deadlineMs)&&request.deadlineMs>0&&request.deadlineMs<=1000);
    assert.equal(options.timeout,request.deadlineMs);assert.equal(options.fullStdout,true);assert.equal(options.maxBuffer,32768);
    f.calls.push({command,argv:structuredClone(argv),options:structuredClone(options),request});
    const step=f.steps.shift();assert.equal(typeof step,'function','No extra native call is permitted');
    return step(request,f);
  }
  f.owner=createInputOwner({browser:'chrome',config:ownConfig,inputHelper:'/stub/a66-pointer',keyScriptPath:'/stub/never-key-script',
    run,record:(kind,value)=>f.records.push({kind,value:structuredClone(value)}),
    guard:async action=>page(action,false),cleanupGuard:async action=>page(action,true),mountedId:()=> 'a66-1'});
  return f;
}
function pointerAck(request,{cleanup=false,number=1,numbers=[1,1]}={}){
  return {action:'click-strong',status:'sent',delivery:'sent',cleanupOnly:cleanup,transitions:cleanup?['up']:['down','up'],
    requestId:request.requestId,nonce,mountedId:'a66-1',caseId:'presentation-kwdj',target:'strong',
    frontBundle:'com.google.Chrome',frontPid:4312,expectedAxWindowTitle:title+' - Google Chrome',observedAxWindowTitle:title+' - Google Chrome',
    axWindowCount:1,axWindow:{x:80,y:60,width:1200,height:900},mouseEventNumber:number,constructedMouseEventNumbers:[...numbers]};
}
function pointerExecution(request,actual){return {command:'/stub/a66-pointer',argv:['--request',JSON.stringify(request)],returnCode:0,signal:null,error:null,stdout:JSON.stringify(actual),stderr:''};}
function unknownPointer(request){
  const execution={...pointerExecution(request,{status:'refused',delivery:'unknown/may_have_sent',reason:'Controlled interruption after Down'}),returnCode:2};
  throw Object.assign(Error('Controlled unknown pointer completion'),{execution});
}

test('APR17 pointer pair uses original serial1 and exact independently-authored getter ACK[1,1]',async t=>{
  const f=pointerFixture(pointerClock(t),[(request)=>pointerExecution(request,pointerAck(request))]);
  const result=await f.owner.input('click-strong');
  assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.serial,1);assert.equal(f.calls[0].request.mouseEventNumber,1);
  assert.equal(f.calls[0].request.cleanupOnly,false);assert.equal(f.calls[0].request.pointerDown,false);
  assert.equal(result.actual.mouseEventNumber,1);assert.deepEqual(result.actual.constructedMouseEventNumbers,[1,1]);
  assert.equal(f.owner.disabled,false);assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.keysPending,false);
  await assert.rejects(()=>f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.steps.length,0);
});

test('APR18 bounded pointer serial2048 succeeds while next2049 refuses before any further helper call',async t=>{
  const f=pointerFixture(pointerClock(t),[request=>pointerExecution(request,pointerAck(request,{number:2048,numbers:[2048,2048]}))],{firstSerial:2048});
  const result=await f.owner.input('click-strong');assert.equal(result.actual.mouseEventNumber,2048);
  assert.equal(f.calls[0].request.serial,2048);assert.equal(f.calls[0].request.mouseEventNumber,2048);
  await assert.rejects(()=>f.owner.input('click-strong'));assert.equal(f.guards.length,2);assert.equal(f.guards[1].proof.value.serial,2049);
  assert.equal(f.calls.length,1);assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.keysPending,false);
});

test('APR19 UNKNOWN allows only one owned UP with fresh serial2 and ORIGINAL eventNumber1',async t=>{
  const f=pointerFixture(pointerClock(t),[unknownPointer,request=>pointerExecution(request,pointerAck(request,{cleanup:true,number:1,numbers:[1]}))]);
  await assert.rejects(()=>f.owner.input('click-strong'),/Controlled unknown pointer completion/);
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.pointerState,'unknown');
  const result=await f.owner.releaseOwnedPointer();
  assert.equal(f.calls.length,2);assert.deepEqual(f.calls.map(c=>[c.request.serial,c.request.mouseEventNumber,c.request.cleanupOnly,c.request.pointerDown]),[[1,1,false,false],[2,1,true,true]]);
  assert.equal(result.request.requestId,nonce+':2');assert.equal(result.actual.mouseEventNumber,1);assert.deepEqual(result.actual.constructedMouseEventNumbers,[1]);
  assert.deepEqual(result.actual.transitions,['up']);assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);
  await assert.rejects(()=>f.owner.releaseOwnedPointer());await assert.rejects(()=>f.owner.input('click-strong'));
  assert.equal(f.calls.length,2);assert.equal(f.guards.length,2);assert.equal(f.steps.length,0);
  assert.equal(f.records.filter(r=>r.kind==='owned-pointer-release').length,1);
});

test('APR20 contextual complete pair clears pending BEFORE a late1001ms failure and never sends UP',async t=>{
  const clock=pointerClock(t),f=pointerFixture(clock,[request=>{const execution=pointerExecution(request,pointerAck(request));clock.advance(1001);return execution;}]);
  await assert.rejects(()=>f.owner.input('click-strong'),/Total66 pointer guard exceeded1s/);
  assert.equal(f.calls.length,1);assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,false);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.keysPending,false);
  const failure=f.records.at(-1);assert.equal(failure.kind,'physical-input-failure');assert.equal(failure.value.delivery,'sent/known_completed');
  assert.equal(failure.value.pointerDown,false);assert.equal(failure.value.maximumGuardAgeMs,1001);
  await assert.rejects(()=>f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.guards.length,1);
});

test('APR21 missing or wrong original/pair metadata never becomes a completed pointer ACK',async t=>{
  const clock=pointerClock(t),vectors=[
    ['missing original number',v=>{delete v.mouseEventNumber;}],['wrong original number',v=>{v.mouseEventNumber=2;}],
    ['missing getter pair',v=>{delete v.constructedMouseEventNumbers;}],['mismatched getter pair',v=>{v.constructedMouseEventNumbers=[1,2];}],
    ['partial getter pair',v=>{v.constructedMouseEventNumbers=[1];}],
  ];
  for(const [label,change]of vectors){
    clock.now=0n;
    const f=pointerFixture(clock,[request=>{const actual=pointerAck(request);change(actual);return pointerExecution(request,actual);},
      request=>pointerExecution(request,pointerAck(request,{cleanup:true,number:1,numbers:[1]}))]);
    await assert.rejects(()=>f.owner.input('click-strong'),undefined,label);
    assert.equal(f.owner.disabled,true,label);assert.equal(f.owner.pointerDown,true,label);
    assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent',label);
    await f.owner.releaseOwnedPointer();
    assert.deepEqual(f.calls.map(c=>[c.request.serial,c.request.mouseEventNumber,c.request.cleanupOnly]),[[1,1,false],[2,1,true]],label);
    assert.equal(f.owner.pointerDown,false,label);await assert.rejects(()=>f.owner.releaseOwnedPointer(),undefined,label);assert.equal(f.calls.length,2,label);
  }
});

test('APR22 a cleanup ACK rebound to fresh serial2 is refused and cannot trigger a second UP or DOWN',async t=>{
  const f=pointerFixture(pointerClock(t),[unknownPointer,request=>pointerExecution(request,pointerAck(request,{cleanup:true,number:2,numbers:[2]}))]);
  await assert.rejects(()=>f.owner.input('click-strong'));await assert.rejects(()=>f.owner.releaseOwnedPointer());
  assert.deepEqual(f.calls.map(c=>[c.request.serial,c.request.mouseEventNumber,c.request.cleanupOnly]),[[1,1,false],[2,1,true]]);
  assert.equal(f.owner.disabled,true);assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.pointerState,'unknown');
  assert.equal(f.records.at(-1).kind,'owned-pointer-release-failure');
  await assert.rejects(()=>f.owner.releaseOwnedPointer());await assert.rejects(()=>f.owner.input('click-strong'));assert.equal(f.calls.length,2);assert.equal(f.guards.length,2);
});

test('APR23 a fresh cleanup proof for a foreign mount never acquires original pointer ownership',async t=>{
  const f=pointerFixture(pointerClock(t),[unknownPointer],{foreignCleanup:true});
  await assert.rejects(()=>f.owner.input('click-strong'));await assert.rejects(()=>f.owner.releaseOwnedPointer());
  assert.equal(f.guards.length,2);assert.equal(f.guards[1].proof.value.id,'a66-2');assert.equal(f.calls.length,1);
  assert.equal(f.owner.pointerDown,true);assert.equal(f.owner.disabled,true);assert.equal(f.records.at(-1).kind,'owned-pointer-release-failure');
  await assert.rejects(()=>f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.guards.length,2);
});
