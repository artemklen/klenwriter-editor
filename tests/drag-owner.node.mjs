// SPDX-License-Identifier: MIT OR Apache-2.0
// Source expectations: contracts/drag/v1/{api,owner}.md. Finite controlled UI
// ownership, not native Move/history, real capture/layout, or installed input.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture, flush, MOVE, refusal } from './drag-owner-fixture.mjs';

test('D44-O01 optional drag absence keeps a discoverable reason and keyboard Move alternative',async()=>{
  const f=fixture(),before=structuredClone(f.model);f.owner.configure(null,'ru');
  assert.equal(f.owner.handle.dataset.editorUiControl,'drag');assert.equal(f.owner.handle.tabIndex,0);
  assert.equal(f.owner.handle.getAttribute('aria-disabled'),'true');assert.match(f.gutter.textContent,/Перетаскивание недоступно/);
  f.down();f.move();f.frame();f.up();f.click();assert.equal(f.captures.length,0);assert.equal(f.completed.length,0);
  f.handleKey('Enter');assert.equal(f.keyboardCalls,1);f.handleKey('Enter',{repeat:true});assert.equal(f.keyboardCalls,1);
  f.owner.configure(null,'en');assert.match(f.gutter.textContent,/Dragging is unavailable/);
  assert.deepEqual(f.model,before);await f.destroy();
});
test('D44-O02 only a finite unmodified primary left mouse down can allocate a lease',async()=>{
  for(const values of [{button:2,buttons:2},{buttons:0},{pointerType:'touch'},{pointerType:'pen'},{isPrimary:false},{ctrlKey:true},{metaKey:true},{altKey:true},{shiftKey:true},{clientX:NaN},{clientY:Infinity}]){
    const f=fixture();f.down(values);f.move();f.frame();f.up();assert.equal(f.captures.length,0,JSON.stringify(values));assert.equal(f.completed.length,0);await f.destroy();
  }
});
test('D44-O03 below four CSS pixels and its later click have no factory, query or command',async()=>{
  for(const distance of [0,3.99]){
    const f=fixture(),before=structuredClone(f.model),request=f.arm();f.move(30+distance,110);f.frame();f.up(30+distance,110);
    assert.equal(f.click().defaultPrevented,true);assert.equal(f.keyboardCalls,0);assert.equal(f.factoryCalls.length,0);assert.equal(f.queries.length,0);assert.equal(f.completed.length,0);
    assert.deepEqual(f.releases,[request]);assert.deepEqual(f.model,before);f.idle();await f.destroy();
  }
});
test('D44-O04 a genuine allowed drop queries exact bytes and consumes the original lease once with original submission/focus',async()=>{
  const f=fixture(),before=structuredClone(f.model),request=f.arm(),submission=f.submission,focus=f.focus;f.hover();
  assert.equal(f.captures.length,1);assert.equal(f.factoryCalls.length,1);assert.equal(f.queries.length,1);assert.deepEqual(f.model,before,'preview and native query are pure');
  assert.deepEqual(f.queries[0],{kind:'query_command',stamp:request.stamp,command:MOVE});
  assert.ok(Object.isFrozen(f.factoryCalls[0].captured));assert.ok(Object.isFrozen(f.factoryCalls[0].captured.source));assert.deepEqual(Object.keys(f.factoryCalls[0].captured).sort(),['context','source','stamp']);
  f.onComplete=()=>{const r=f.owner.resources();assert.equal(r.pointerCaptures,0);assert.equal(r.animationFrames,0);f.up();};
  f.up();assert.equal(f.completed.length,1);assert.equal(f.completed[0].request,request);assert.deepEqual(f.completed[0].command,MOVE);assert.deepEqual(f.completed[0].options,{focus:'none'});
  assert.equal(f.results[0].submission,submission);assert.equal(f.results[0].focus,focus);f.up();f.click();assert.equal(f.completed.length,1);assert.equal(f.captures.length,1);
  await flush();assert.deepEqual(f.moved,['S']);f.idle();await f.destroy();
});
test('D44-O05 terminal claims and releases capture/RAF before a first drop-time factory callback',async()=>{
  const f=fixture(),request=f.arm();f.move();
  f.factory=(captured,destination)=>{assert.equal(f.owner.resources().pointerCaptures,0);assert.equal(f.owner.resources().animationFrames,0);assert.equal(f.owner.resources().dragGestures,0);f.up();assert.equal(captured.source.id,'S');assert.equal(destination.before_index,1);return MOVE;};
  f.up();assert.equal(f.factoryCalls.length,1);assert.equal(f.completed.length,1);assert.equal(f.completed[0].request,request);assert.equal(f.captures.length,1);await flush();await f.destroy();
});
test('D44-O06 pointerup reentry during a RAF factory callback retires the unfinished gesture without submitting',async()=>{
  const f=fixture();f.arm();let injected=false;
  f.factory=()=>{if(!injected){injected=true;f.up();}return MOVE;};f.hover();
  assert.equal(injected,true);assert.equal(f.completed.length,0);assert.equal(f.queries.length,0);assert.equal(f.captures.length,1);f.up();f.click();f.idle();await f.destroy();
});
test('D44-O07 queued originals are not replayed and destroy suppresses every late DOM-bearing callback',async()=>{
  const f=fixture();let resolve;const completion=new Promise(done=>resolve=done),submission=Object.freeze({status:'queued',completion}),focus=f.focus;
  f.submission=submission;f.arm();f.hover();f.up();assert.equal(f.results[0].submission,submission);assert.equal(f.results[0].focus,focus);assert.equal(f.owner.resources().continuations,1);
  f.down();f.move();f.up();assert.equal(f.captures.length,1);assert.equal(f.completed.length,1);
  const counts={feedback:f.feedback.length,failures:f.failures.length,moved:f.moved.length,schedules:f.schedules};let settled=false;
  const destroyed=f.owner.destroy().then(()=>settled=true);await flush();assert.equal(settled,false);assert.equal(f.owner.resources().listeners,0);assert.equal(f.owner.resources().continuations,1);assert.equal(f.gutter.children.length,0);
  resolve({status:'ok',value:{kind:'mutation',effect:'changed',state:{stamp:f.stamp},presentation:null}});await destroyed;
  assert.deepEqual({feedback:f.feedback.length,failures:f.failures.length,moved:f.moved.length,schedules:f.schedules},counts);assert.equal(f.completed.length,1);await f.destroy();
});
test('D44-O08 original refused/fatal/unchanged completions and host refusals remain distinguishable',async()=>{
  for(const status of ['refused','fatal','unchanged','host-refused']){
    const f=fixture(),response=status==='unchanged'?{status:'ok',value:{kind:'mutation',effect:'unchanged',state:{stamp:f.stamp},presentation:null}}:{status,diagnostic:{code:'example.native_refusal',details:{literal:'preserved'},may_have_committed:status==='fatal'}};
    const submission=Object.freeze({status:'completed',response});f.submission=submission;if(status==='host-refused')f.completionFailure=refusal('dom.stale_host_request');
    f.arm();f.hover();f.up();await flush();assert.equal(f.completed.length,1);assert.equal(f.captures.length,1);
    if(status==='host-refused'){assert.equal(f.results.length,0);assert.equal(f.failures.at(-1),f.completionFailure);}
    else{assert.equal(f.results[0].submission,submission);if(status==='unchanged')assert.match(f.feedback.at(-1),/did not change/);else assert.equal(f.failures.at(-1).response,response);}
    f.idle();await f.destroy();
  }
});
test('D44-O09 full-token, native publication, private intent and lifecycle invalidation never recapture',async()=>{
  const variants=[
    f=>f.bump('generation'),f=>f.bump('revision'),f=>f.bump('selection_epoch'),f=>f.bump('history_epoch'),
    f=>{f.context=Object.freeze({...f.context,capability_digest:'new capability'});},
    f=>f.owner.publication({change:{kind:'document'}}),f=>f.signal('selectionchange'),f=>f.signal('compositionstart'),f=>f.signal('beforeinput'),
    f=>{f.hostFailure=refusal('dom.mode_blocked');},f=>{f.hostFailure=refusal('dom.recovery_required');},f=>{f.hostFailure=refusal('dom.busy');},
    f=>{f.sourceClone=true;},f=>{f.host.connected=false;},f=>{f.doc.activeElement=f.external;f.signal('focusin');},
  ];
  for(const invalidate of variants){const f=fixture(),before=structuredClone(f.model);f.arm();invalidate(f);f.move();f.frame();f.up();f.click();assert.equal(f.captures.length,1);assert.equal(f.completed.length,0);assert.deepEqual(f.model,before);f.idle();await f.destroy();}
});
test('D44-O10 callback-induced stamp/query invalidation and admission reentry cannot revive authority',async()=>{
  for(const phase of ['factory','query','before-open']){
    const f=fixture();if(phase==='factory')f.factory=()=>{f.bump();return MOVE;};if(phase==='query')f.onQuery=()=>f.bump();if(phase==='before-open')f.beforeOpen=()=>f.owner.cancel();
    f.down();f.move();f.frame();f.up();f.click();assert.equal(f.completed.length,0,phase);assert.equal(f.captures.length,phase==='before-open'?0:1);f.idle();await f.destroy();
  }
});
test('D44-O11 outside-handle and exact-root padding gaps preserve only the original lease until genuine reentry',async()=>{
  const f=fixture(),request=f.arm();f.move(70,170);f.frame();assert.equal(f.owner.resources().dragGestures,1);assert.equal(f.queries.length,0);assert.equal(f.geometryReads.at(-1).point,null);
  f.elementAt=()=>f.host;f.move(110,220);f.frame();assert.equal(f.owner.resources().dragGestures,1);assert.equal(f.queries.length,0);assert.equal(f.geometryReads.at(-1).point,null);
  f.elementAt=()=>f.hit;f.hover();f.up();assert.equal(f.completed.length,1);assert.equal(f.completed[0].request,request);assert.equal(f.captures.length,1);await flush();await f.destroy();
  const owned=fixture(),original=owned.arm();owned.elementAt=()=>owned.owner.handle;owned.move(110,220);owned.frame();assert.equal(owned.owner.resources().dragGestures,1);assert.equal(owned.geometryReads.at(-1).point,null);assert.equal(owned.queries.length,0);
  owned.elementAt=()=>owned.hit;owned.hover();owned.up();assert.equal(owned.completed.length,1);assert.equal(owned.completed[0].request,original);assert.equal(owned.captures.length,1);await flush();await owned.destroy();
  const gutterDrop=fixture();gutterDrop.arm();gutterDrop.elementAt=()=>gutterDrop.owner.handle;gutterDrop.move(110,220);gutterDrop.frame();gutterDrop.up(110,220);assert.equal(gutterDrop.completed.length,0);gutterDrop.idle();await gutterDrop.destroy();
  for(const kind of ['outside','padding']){const g=fixture();g.arm();if(kind==='padding')g.elementAt=()=>g.host;g.move(kind==='outside'?70:110,220);g.frame();g.up(kind==='outside'?70:110,220);assert.equal(g.completed.length,0);g.idle();await g.destroy();}
});
test('D44-O12 overlay, unsupported, nonfinite and clipped full endpoints never become a fallback drop',async()=>{
  for(const kind of ['overlay','unsupported','clipped','nan','empty-editor']){
    const f=fixture();f.arm();if(kind==='overlay')f.elementAt=()=>f.external;if(kind==='unsupported')f.geometryFailure=refusal('dom.selection_geometry_unsupported');if(kind==='clipped')f.targetRect={x:90,y:300,width:270,height:40};if(kind==='empty-editor')f.host.clientWidth=0;
    f.move(kind==='nan'?NaN:150,310);f.frame();f.up();assert.equal(f.completed.length,0,kind);assert.equal(f.captures.length,1);f.idle();await f.destroy();
  }
});
test('D44-O13 explicit labelled parent cycling uses genuine inside destinations and never changes focus/selection',async()=>{
  const f=fixture();f.container=true;f.noDestination=true;const request=f.arm();f.hover();assert.equal(f.queries.length,0);
  const parents=f.gutter.children.find(node=>node.className==='kw-ui-drag-parents');assert.equal(parents.hidden,false);assert.match(parents.textContent,/Destination parent/);assert.equal(parents.getAttribute('role'),'listbox');
  assert.equal(f.key('ArrowRight').defaultPrevented,true);f.frame();assert.equal(f.factoryCalls.at(-1).destination.placement,'inside');assert.equal(f.factoryCalls.at(-1).destination.parent,'T');assert.equal(f.factoryCalls.at(-1).destination.before_index,2);
  f.key('ArrowRight');f.frame();assert.equal(f.factoryCalls.at(-1).destination.parent,'R');f.key('ArrowLeft');f.frame();assert.equal(f.factoryCalls.at(-1).destination.parent,'T');
  assert.equal(f.doc.activeElement,f.host);assert.equal(f.captures.length,1);f.up();assert.equal(f.completed.length,1);assert.equal(f.completed[0].request,request);assert.deepEqual(JSON.parse(f.completed[0].command.payload_json),{kind:'move',node:'S',parent:'T',before_index:2});await flush();await f.destroy();
});
test('D44-O14 Escape, loss, foreign pointers, blur and hidden document leave no late RAF or click action',async()=>{
  for(const kind of ['escape','pointercancel','lostpointercapture','foreign-move','new-pointer','blur','hidden','modifier']){
    const f=fixture();f.arm();f.hover();
    if(kind==='escape')f.key('Escape');else if(kind==='foreign-move')f.move(150,310,{pointerId:99});else if(kind==='new-pointer')f.signal('pointerdown',{pointerId:99});else if(kind==='hidden'){f.doc.hidden=true;f.signal('visibilitychange');}else if(kind==='modifier')f.key('Shift',{shiftKey:true});else f.signal(kind);
    const frames=f.geometryReads.length;f.frame();f.up();f.click();assert.equal(f.geometryReads.length,frames,kind);assert.equal(f.completed.length,0,kind);f.idle();await f.destroy();
  }
});
test('D44-O15 failed capture and finite 30s lifetime retire without a delayed drop-time exception',async()=>{
  const capture=fixture();capture.owner.handle.captureAllowed=false;capture.down();capture.move();capture.up();assert.equal(capture.captures.length,1);assert.equal(capture.completed.length,0);capture.idle();await capture.destroy();
  for(const mode of ['frame','paused-frame-up']){const f=fixture();f.arm();f.move();f.advance(30001);if(mode==='frame')f.frame(0);f.up();assert.equal(f.completed.length,0);assert.equal(f.queries.length,0);assert.match(f.feedback.at(-1),/limit/);f.idle();await f.destroy();}
});
test('D44-O16 candidate work is finite128 changes and never truncates to the last accepted destination',async()=>{
  const f=fixture();f.arm();f.move();for(let index=1;index<=129;index++){f.targetIndex=index;f.frame();}
  assert.equal(f.factoryCalls.length,128);assert.equal(f.queries.length,128);assert.equal(f.completed.length,0);assert.match(f.feedback.at(-1),/limit/);f.up();f.idle();await f.destroy();
});
test('D44-O17 actual editor or ancestor scroll owner precedes page; release freezes final offsets',async()=>{
  for(const kind of ['editor','ancestor']){
    const f=fixture(),owner=kind==='editor'?f.host:f.local;owner.styles.overflowY='auto';owner.clientHeight=400;owner.scrollHeight=1000;owner.offset=590;f.page.scrollHeight=2000;f.targetRect={x:120,y:420,width:240,height:30};
    f.arm();f.move(150,440);f.frame(32);assert.equal(owner.scrollTop,600);assert.equal(f.page.scrollTop,0);f.frame(32);assert.ok(f.page.scrollTop>0);assert.ok(f.page.scrollTop<=19.2+1e-8);
    for(const row of [...owner.scrollWrites,...f.page.scrollWrites])assert.ok(Math.abs(row.after-row.before)<=20);
    f.key('Escape');const final=[owner.scrollTop,f.page.scrollTop];f.frame(1000);f.up();assert.deepEqual([owner.scrollTop,f.page.scrollTop],final);assert.equal(f.completed.length,0);f.idle();await f.destroy();
  }
});
test('D44-O18 unsupported/smooth/snap/excess scroll owners and changed owner continuity refuse without fallback',async()=>{
  for(const kind of ['transform','smooth','snap','two-inner','changed-owner','over-128']){
    const f=fixture();f.local.styles.overflowY='auto';f.local.clientHeight=400;f.local.scrollHeight=2000;
    if(kind==='transform')f.local.styles.transform='translateX(1px)';if(kind==='smooth')f.local.styles.scrollBehavior='smooth';if(kind==='snap')f.local.styles.scrollSnapType='y mandatory';if(kind==='two-inner'){f.host.styles.overflowY='auto';f.host.scrollHeight=2000;}
    if(kind==='over-128'){let parent=f.local;for(let i=0;i<130;i++){const next=f.doc.createElement('div');parent.append(next);parent=next;}parent.append(f.host);}
    f.down();if(kind==='changed-owner'){assert.equal(f.captures.length,1);f.local.styles.overflowY='visible';f.host.styles.overflowY='auto';f.host.scrollHeight=2000;f.move(150,440);f.frame();}
    f.up();assert.equal(f.completed.length,0,kind);assert.equal(f.local.scrollWrites.length,0,kind);assert.equal(f.host.scrollWrites.length,0,kind);f.idle();await f.destroy();
  }
});
test('D44-O19 held scrolling has independent tick/time/pixel ceilings and no post-cancel writes',async()=>{
  for(const step of [1,32]){
    const f=fixture();f.host.styles.overflowY='auto';f.host.scrollHeight=20000;f.targetRect={x:120,y:420,width:240,height:30};f.arm();f.move(150,440);
    for(let i=0;i<602&&f.owner.active;i++)f.frame(step);
    assert.equal(f.owner.active,false);assert.ok(f.host.scrollWrites.length<=600);assert.ok(f.host.scrollTop<=6000);assert.ok(f.host.scrollWrites.length*step<=10000);
    assert.equal(f.host.scrollWrites.length,step===1?600:312);const offset=f.host.scrollTop;f.frame(1000);f.up();assert.equal(f.host.scrollTop,offset);assert.equal(f.completed.length,0);f.idle();await f.destroy();
  }
});
test('D44-O20 unavailable native query, typed query refusal and malformed factory results submit nothing',async()=>{
  for(const kind of ['unavailable','query-refused','extra','getter','throw']){
    const f=fixture();let reads=0;
    if(kind==='unavailable'){f.available=false;f.diagnostic={code:'example.wrong_child'};}
    if(kind==='query-refused')f.queryFailure=refusal('dom.stale_selection');
    if(kind==='extra')f.factory=()=>({...MOVE,extra:true});
    if(kind==='getter')f.factory=()=>({id:MOVE.id,get payload_json(){reads++;throw Error('must not read');}});
    if(kind==='throw')f.factory=()=>{throw Error('host callback');};
    f.arm();f.hover();f.up();assert.equal(reads,0);assert.equal(f.completed.length,0,kind);assert.equal(f.captures.length,1);f.idle();await f.destroy();
  }
});
test('D44-O21 destroy during callbacks and late terminal events retire every owned reference once',async()=>{
  for(const phase of ['before-open','factory','query','armed']){
    const f=fixture();let settled;
    if(phase==='before-open')f.beforeOpen=()=>settled=f.owner.destroy();if(phase==='factory')f.factory=()=>{settled=f.owner.destroy();return MOVE;};if(phase==='query')f.onQuery=()=>settled=f.owner.destroy();
    f.down();if(phase==='armed')settled=f.owner.destroy();f.move();f.frame();f.up();f.click();await settled;
    assert.equal(f.completed.length,0,phase);await f.destroy();
  }
});
test('D44-O22 two owners keep independent original request/capture identities and one cannot finish the other',async()=>{
  const a=fixture(),b=fixture(),ar=a.arm(),br=b.arm();a.hover();b.hover();a.key('Escape');a.up();assert.equal(a.completed.length,0);assert.equal(b.owner.resources().hostRequests,1);b.up();assert.equal(b.completed.length,1);assert.equal(b.completed[0].request,br);assert.notEqual(ar,br);assert.equal(a.captures.length,1);assert.equal(b.captures.length,1);await flush();await a.destroy();await b.destroy();
});

// Source-authored correction for the original Chromium DL05 failure: a genuine
// cancelled held pointer must not expose its late UP/click to fresh-view native
// selection defaults. These controls test event consumption, not browser/IME.
function windowClick(f,values={}){
  const event=new Event('click',{cancelable:true});
  for(const [key,value]of Object.entries({pointerId:7,pointerType:'mouse',button:0,detail:1,...values}))Object.defineProperty(event,key,{value});
  f.win.dispatchEvent(event);return event;
}
test('D44-O23 cancelled held replacement consumes only its original late mouse UP without retaining authority',async()=>{
  const f=fixture(),before=structuredClone(f.model),request=f.arm();f.hover();f.bump('generation');f.owner.check();f.idle();
  assert.deepEqual(f.releases,[request]);const counts={captures:f.captures.length,queries:f.queries.length,factories:f.factoryCalls.length};
  assert.equal(f.up(150,310,{pointerId:99}).defaultPrevented,false,'another pointer is not quarantined');
  assert.equal(f.up(150,310,{pointerType:'pen'}).defaultPrevented,false,'another pointer type is not quarantined');
  assert.equal(f.up().defaultPrevented,true,'the retired original UP cannot reach the browser selection default');
  assert.equal(f.up().defaultPrevented,false,'the original UP is consumed only once');
  assert.deepEqual({captures:f.captures.length,queries:f.queries.length,factories:f.factoryCalls.length},counts);assert.equal(f.completed.length,0);assert.deepEqual(f.model,before);f.idle();await f.destroy();
});
test('D44-O24 retired mouse compatibility click is consumed once while unrelated pointer and AT activation pass',async()=>{
  const f=fixture();f.arm();f.owner.cancel();assert.equal(f.up().defaultPrevented,true);
  assert.equal(windowClick(f,{pointerId:99}).defaultPrevented,false);
  assert.equal(windowClick(f).defaultPrevented,true);assert.equal(windowClick(f).defaultPrevented,false);assert.equal(f.completed.length,0);f.idle();await f.destroy();
  const at=fixture();at.arm();at.owner.cancel();at.up();assert.equal(windowClick(at,{detail:0}).defaultPrevented,false,'AT/keyboard click is not consumed');
  assert.equal(windowClick(at).defaultPrevented,false,'unrelated fresh activation clears the old click identity');await at.destroy();
});
test('D44-O25 fresh down and keyboard intent retire the old scalar pointer without blocking a new original',async()=>{
  const f=fixture();f.arm();f.owner.cancel();const next=f.arm();f.hover();f.up();assert.equal(f.completed.length,1);assert.equal(f.completed[0].request,next);assert.equal(f.captures.length,2);await flush();await f.destroy();
  const key=fixture();key.arm();key.owner.cancel();assert.equal(key.key('ArrowDown').defaultPrevented,false);assert.equal(key.up().defaultPrevented,false);assert.equal(windowClick(key).defaultPrevented,false);key.handleKey('Enter');assert.equal(key.keyboardCalls,1);await key.destroy();
});
test('D44-O26 an already-UP terminal claim and destroy never create a retired pointer quarantine',async()=>{
  const f=fixture();f.arm();f.move();f.factory=()=>{f.owner.cancel();return MOVE;};f.up();assert.equal(f.completed.length,0);
  assert.equal(f.up().defaultPrevented,false,'claim already owns an UP; it must not await another');assert.equal(windowClick(f).defaultPrevented,false);await f.destroy();
  const destroyed=fixture();destroyed.arm();destroyed.owner.cancel();await destroyed.destroy();assert.equal(destroyed.up().defaultPrevented,false);assert.equal(windowClick(destroyed).defaultPrevented,false);
});
