// SPDX-License-Identifier: MIT OR Apache-2.0
// Pure finite observation classifier. It submits nothing and never treats an
// untrusted terminal as positive native-composition evidence.
import assert from 'node:assert/strict';

const unchanged='RUN_UNCHANGED_PRESERVATION_AND_FIXED_SETTLEMENT_ASSERTIONS';
const finite=value=>typeof value==='number'&&Number.isFinite(value)&&value>=0;
const readKinds=new Set(['state','node','query_command','catalog','events','acknowledge_events','snapshot','release_snapshot']);
const check=(condition,message)=>assert.ok(condition,message);
function clock(value,expected){
  check(value?.kind==='performance.now'&&finite(value.timeOrigin)&&value.timeOrigin>0,'Known document-local monotonic clock');
  assert.deepEqual(value,expected,'Same actual document clock');
}

function classifyCompositionObservationPhase({before,preedit,gesture,action,expectedCommand,verifySettlement},phase){
  const scope={protectedGestureAcceptance:false,nativePositiveFromUntrustedTerminal:false};
  try{
    const mount=before.id,documentClock=before.observation?.clock;
    check(typeof mount==='string'&&mount.length>0,'Genuine captured mount');clock(documentClock,documentClock);
    for(const value of [before,preedit,gesture]){
      assert.equal(value.id,mount,'Original mount');assert.equal(value.caseId,before.caseId);assert.equal(value.locale,before.locale);
      assert.equal(value.observation?.mountId,mount);clock(value.observation.clock,documentClock);check(finite(value.observation.at),'Checkpoint time recorded');
      assert.equal(value.nativeTrace?.mountId,mount);clock(value.nativeTrace.clock,documentClock);
      assert.equal(value.nativeTrace.enabled,true);assert.equal(value.nativeTrace.overflow,false);assert.equal(value.traceOverflow,false);
      check(Array.isArray(value.inputTrace)&&value.inputTrace.length<=16384,'Bounded event trace');
      assert.equal(value.inputTraceCount,value.inputTrace.length);
      check(Array.isArray(value.nativeTrace.calls)&&value.nativeTrace.calls.length<=16384,'Bounded native-call trace');
      assert.deepEqual(value.facts.context,before.facts.context,'Same original profile/context');assert.equal(value.facts.lifecycle,'ready');
      assert.deepEqual(value.facts.stamp,value.native.state.stamp,'Genuine current native checkpoint');
    }
    check(before.observation.at<=preedit.observation.at&&preedit.observation.at<=gesture.observation.at,'Ordered checkpoint times');
    assert.deepEqual(preedit.native.state,before.native.state,'Preedit is still based on the original native state');
    check(preedit.composition?.open===true&&preedit.composition.starts===1&&preedit.composition.ends===0,'One genuine unresolved trusted preedit');
    assert.equal(preedit.composition.observedEnded,false);
    assert.deepEqual(preedit.composition.terminals,[],'No earlier observed terminal');
    assert.deepEqual(gesture.inputTrace.slice(0,preedit.inputTrace.length),preedit.inputTrace,'Original event prefix retained');
    assert.deepEqual(gesture.nativeTrace.calls.slice(0,before.nativeTrace.calls.length),before.nativeTrace.calls,'Original native bytes/prefix retained');
    assert.deepEqual(gesture.nativeTrace.calls.slice(0,preedit.nativeTrace.calls.length),preedit.nativeTrace.calls,'Genuine preedit call prefix retained');
    for(let i=0;i<gesture.inputTrace.length;i++){
      const row=gesture.inputTrace[i];assert.equal(row.ordinal,i+1);assert.equal(row.mountId,mount);clock(row.clock,documentClock);check(finite(row.time),'Actual event time');
      if(i)check(row.time>=gesture.inputTrace[i-1].time,'Monotonic event ordering');
    }
    const starts=preedit.inputTrace.filter(row=>row.event==='compositionstart');
    check(starts.length===1&&starts[0].isTrusted===true&&starts[0].target?.id===`${mount}-editor`,'Trusted start belongs to the actual original editor');
    check(starts[0].time<=preedit.observation.at,'Trusted start observed before current preedit checkpoint');
    check(action?.status==='completed'&&action.caseId===before.caseId&&action.locale===before.locale,'The actual distinct guarded action completed');
    check(action.action?.startsWith('click-'),'Only a distinct pointer gesture');
    check(Number.isSafeInteger(action.inputTraceBefore)&&action.inputTraceBefore>=preedit.inputTrace.length&&action.inputTraceBefore<=gesture.inputTrace.length,'Fresh physical action trace boundary');
    const during=gesture.inputTrace.slice(action.inputTraceBefore),downs=during.filter(row=>row.event==='pointerdown'&&row.isTrusted===true&&row.button===0),ups=during.filter(row=>row.event==='pointerup'&&row.isTrusted===true&&row.button===0);
    check(downs.length===1&&ups.length===1&&downs[0].pointerId===ups[0].pointerId&&downs[0].time<=ups[0].time,'Actual trusted down and matching up');
    const down=downs[0];check(preedit.observation.at<=down.time&&down.time<=gesture.observation.at,'Gesture follows genuine preedit');
    const later=gesture.inputTrace.slice(preedit.inputTrace.length),terminals=later.filter(row=>row.event==='compositionend');
    check(!later.some(row=>row.event==='compositionstart'),'No second generation or ambiguous start');
    const calls=gesture.nativeTrace.calls.slice(before.nativeTrace.calls.length),semantic=[];
    for(let i=0;i<calls.length;i++){
      const row=calls[i];assert.equal(row.ordinal,before.nativeTrace.calls.length+i+1);assert.equal(row.mountId,mount);clock(row.clock,documentClock);
      check(finite(row.startedAt)&&finite(row.finishedAt)&&row.finishedAt>=row.startedAt,'Actual completed call timing');
      check(row.finishedAt<=gesture.observation.at,'Call finished before this readback');
      if(i)check(row.startedAt>=calls[i-1].finishedAt,'No overlapping or reordered native calls');
      check(row.outcome==='returned'&&row.error===null&&typeof row.requestJson==='string'&&typeof row.responseJson==='string','Original returned bytes, no exception or unknown completion');
      check(row.requestJson.length<=8388608&&row.responseJson.length<=8388608,'Bounded retained call bytes');
      const request=JSON.parse(row.requestJson),response=JSON.parse(row.responseJson);
      if(request.kind==='command')semantic.push({row,request,response});
      else check(readKinds.has(request.kind),'No additional semantic mutation or unknown request');
    }
    if(terminals.length===0){
      check(phase==='before-down',`${phase==='after-click'?'AFTER-CLICK':'DURING-POINTER'} requires one explicit terminal`);
      check(gesture.composition.open===true&&gesture.composition.observedEnded===false&&semantic.length===0,'No terminal or semantic completion can be inferred');
      return {classification:unchanged,...scope};
    }
    check(terminals.length===1&&terminals[0].ordinal<down.ordinal&&terminals[0].time<down.time,'Exactly one explicitly recorded terminal STRICTLY before pointerdown');
    const terminal=terminals[0];assert.equal(gesture.composition.observedEnded,true);
    assert.deepEqual(gesture.composition.terminals,[{ordinal:terminal.ordinal,time:terminal.time,isTrusted:terminal.isTrusted,mountId:mount,clock:documentClock}],'All observed terminals retained with original trust');
    check(semantic.length===1,'Exactly one expected native InsertText; no deferred or additional command');
    const {row,request,response}=semantic[0];
    if(phase==='after-click'||phase==='during-pointer'){
      const clickRows=during.filter(event=>event.event==='click'),click=clickRows[0],guard=action.proof?.pageGuard;
      check(during.filter(event=>event.event==='pointerdown').length===1&&during.filter(event=>event.event==='pointerup').length===1&&clickRows.length===1,'Exactly one actual distinct down/up/click');
      check(guard?.allowed===true&&guard.id===mount&&guard.mountedId===mount&&guard.caseId===before.caseId&&guard.action===action.action&&guard.target===action.action.slice(6),'Same original closed target guard');
      check(Number.isSafeInteger(guard.targetObject)&&guard.targetObject>0,'Observed actual closed target object');
      for(const event of [down,ups[0],click]){
        check(event.isTrusted===true&&event.button===0&&event.pointerId===down.pointerId&&event.targetObject===guard.targetObject,'Trusted matching original target/pointer');
        check(event.shift===false&&event.alt===false&&event.meta===false&&event.ctrl===false,'Unmodified distinct pointer gesture');
      }
      check(down.isPrimary===true&&ups[0].isPrimary===true,'Actual primary pointer sequence');
      check(Number.isSafeInteger(click.detail)&&click.detail>0,'Actual positive-detail click');
      check(down.ordinal<ups[0].ordinal&&ups[0].ordinal<click.ordinal&&ups[0].time<=click.time,'Completed matching pointer event order');
      if(phase==='after-click')check(row.startedAt>=click.time&&row.finishedAt<=gesture.observation.at,'InsertText starts AFTER click and finishes before checkpoint');
      else check(row.startedAt>=down.time&&row.finishedAt<=click.time,'InsertText starts and finishes DURING the matching completed pointer gesture');
      for(const key of ['html','rootObject','objects','selection','active','activeObject'])assert.deepEqual(gesture.dom?.[key],preedit.dom?.[key],`Exact provisional DOM ${key}`);
      check(preedit.dom&&gesture.dom&&typeof preedit.dom.html==='string'&&Number.isSafeInteger(preedit.dom.rootObject)&&preedit.dom.rootObject>0&&Array.isArray(preedit.dom.objects)&&preedit.dom.selection&&preedit.dom.active,'Actual full provisional DOM observation');
      check(Number.isSafeInteger(preedit.dom.activeObject)&&preedit.dom.activeObject>0,'Actual focused object observed');
      check(typeof preedit.documentFocused==='boolean'&&preedit.documentFocused===gesture.documentFocused,'Actual document focus retained');
      for(const checkpoint of [preedit,gesture]){
        assert.deepEqual(checkpoint.native.results,[],'No UI action/result');assert.deepEqual(checkpoint.native.focusResults,[],'No UI focus continuation/result');
        assert.equal(checkpoint.native.uiResources?.hostRequests,0);assert.equal(checkpoint.facts.resources?.hostRequests?.pending,0);
        check(checkpoint.native.dialog===null||checkpoint.native.dialog?.hidden===true&&checkpoint.native.dialog.openCount===0,'No host dialog opening');
        assert.deepEqual(checkpoint.native.dialog,preedit.native.dialog,'Original host dialog remains unchanged');
        assert.deepEqual(checkpoint.errors,[]);assert.deepEqual(checkpoint.policyViolations,[]);
        assert.equal(checkpoint.errorOverflow,false);assert.equal(checkpoint.policyOverflow,false);
      }
    }else{
      check(row.startedAt>=preedit.observation.at&&row.finishedAt<=down.time,'InsertText completed within the observed window BEFORE the distinct gesture');
    }
    check(expectedCommand&&typeof expectedCommand.id==='string'&&typeof expectedCommand.payload_json==='string','Predeclared exact profile command binding');
    const expectedRequest={kind:'command',stamp:before.native.state.stamp,command:expectedCommand,history_hint:{kind:'isolated'}};
    assert.deepEqual(request,expectedRequest,'Exact original base, command, payload and isolated hint');
    assert.equal(row.requestJson,JSON.stringify(expectedRequest),'Exact expected original serialized request bytes');
    check(response.status==='ok'&&response.value?.kind==='mutation'&&response.value.effect==='changed','Actual completed native insertion response');
    assert.deepEqual(response.value.state,gesture.native.state,'Original native response matches actual current native state');
    check(typeof verifySettlement==='function','Full unchanged semantic assertions are mandatory');
    const settlement=verifySettlement({row,request,response});
    check(settlement&&typeof settlement==='object','Semantic proof retained');
    return {classification:'UNOBSERVED',reason:phase==='after-click'?'native_terminal_preceded_gesture_insert_settled_after_click':phase==='during-pointer'?'native_terminal_preceded_gesture_insert_settled_during_pointer':'native_window_settled_before_distinct_gesture',...scope,
      mountId:mount,clock:documentClock,trustedStartOrdinal:starts[0].ordinal,preeditCheckpointAt:preedit.observation.at,
      terminal:{ordinal:terminal.ordinal,time:terminal.time,isTrusted:terminal.isTrusted},pointerdown:{ordinal:down.ordinal,time:down.time},
      nativeCall:{ordinal:row.ordinal,startedAt:row.startedAt,finishedAt:row.finishedAt,requestJson:row.requestJson,responseJson:row.responseJson},settlement,...(phase!=='before-down'?{phase:phase==='after-click'?'AFTER_CLICK':'DURING_POINTER',click:{ordinal:during.find(event=>event.event==='click').ordinal,time:during.find(event=>event.event==='click').time}}:{})};
  }catch(error){return {classification:'FAILED',...scope,error:{name:error.name,message:error.message}};}
}

// Original BEFORE-DOWN contract/default semantics are intentionally unchanged.
export function classifyCompositionObservation(input){return classifyCompositionObservationPhase(input,'before-down');}
// Separate frozen additive subset; never a two-command or interleaving waiver.
export function classifyCompositionAfterClickObservation(input){return classifyCompositionObservationPhase(input,'after-click');}
// Separate frozen own-settlement interval; all exact target/preservation checks apply.
export function classifyCompositionDuringPointerObservation(input){return classifyCompositionObservationPhase(input,'during-pointer');}

// This is an observation-only input binding, not a new native-output oracle.
// U+00B4/one-unit/caret identity is already frozen in41 P18/P19. The literal
// output below is authored from42 F and that explicit one-unit input, never
// from a candidate result. Notes keeps its existing42 predeclared é binding.
export const earlySpacingAccentBinding=Object.freeze({
  source:Object.freeze({path:'contracts/composition/v1/native-oracles.json',sha256:'ac17ce35d4dd94f397782ce89fc0567404b3305da1c63a9277309b8c2e16df6c',cases:Object.freeze(['P18-forward','P19-forward'])}),
  command:Object.freeze({id:'org.klenwriter.kwdj/command/insert-text',payload_json:'{"kind":"insert_text","text":"´"}'}),
  afterText:'A´אב',
  afterCanonical:'{"content":[{"content":[{"text":"A´אב","type":"text"}],"type":"paragraph"},{"content":[{"content":[{"text":"cd","type":"text"}],"type":"paragraph"}],"type":"blockquote"},{"type":"scene_break"},{"content":[{"text":"ef","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}',
});

// Authored/frozen before any Notes composition runtime; original é stays intact.
export const notesEarlySpacingAccentBinding=Object.freeze({
  "source": Object.freeze({
    "path": "contracts/ui/v1.1/composition-after-click-observation/notes-early-accent.json",
    "sha256": "49b415b510bd72e0d136ce7c00e44a25aa31f32ed1827d5eb0a9122c647537e2"
  }),
  "command": Object.freeze({
    "id": "org.example.notes/command/insert-text",
    "payload_json": "{\"text\":\"´\"}"
  }),
  "afterText": "a´b",
  "afterCanonical": "{\"root\":{\"attrs\":{\"tags\":[],\"title\":\"\"},\"children\":[{\"attrs\":{},\"children\":[{\"attrs\":{},\"children\":[],\"marks\":[],\"text\":\"a´b\",\"type\":\"org.example.notes/text\"}],\"marks\":[],\"text\":null,\"type\":\"org.example.notes/paragraph\"}],\"marks\":[],\"text\":null,\"type\":\"org.example.notes/document\"},\"schema_version\":1}"
});
