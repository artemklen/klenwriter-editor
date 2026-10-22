// SPDX-License-Identifier: MIT OR Apache-2.0
// SOURCE-FIRST, IN-MEMORY CONTROLS ONLY. Exercise the real Slash input owner.
// No helper, shell, AppleScript, browser, native input, permissions or product RPC.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner} from '../scripts/slash-native/input.mjs';

const nonce = 'b'.repeat(32);
const title = 'KlenWriter Slash native ' + nonce;
const fixtureUrl = 'http://127.0.0.1:4174/ui';
const mount = 'ui42-1';
const config = {nonce, title, fixtureUrl};
const frame = {x:22, y:52, width:1026, height:855};
const viewport = {width:1024, height:768, scale:1, offsetLeft:0, offsetTop:0, pageZoom:1};
const point = {x:140, y:340};
const screenPoint = {x:162, y:479};
const baseKeys = ['format','browser','nonce','title','fixtureUrl','mountedId','requestId','serial',
  'caseId','action','target','point','viewport','pointerDown','cleanupOnly','deadlineMs'];
// Independent literals from the accepted closed43 action/case contract, not implementation tables.
const pointerCases = {
  'click-quote': {target:'quote', caseId:'I43-N02-en'},
  'click-add': {target:'add', caseId:'I43-N09-en'},
  'click-recovery': {target:'recovery', caseId:'I43-N06-en'}
};

function clockFor(t) {
  const clock = {now:0n, advance(ms) { this.now += BigInt(ms) * 1000000n; }};
  t.mock.method(process.hrtime, 'bigint', () => clock.now);
  return clock;
}

function fixture(t, steps, {browser='safari', action='click-add', firstSerial=1,
  safariKeyGuardAgeMs=1000, pageChange=null}={}) {
  const clock = clockFor(t), row = pointerCases[action];
  assert.ok(row, 'One declared pointer action only');
  let nextSerial = firstSerial;
  const f = {clock, calls:[], guards:[], records:[], steps:[...steps]};
  function guard(cleanup, requestedAction) {
    assert.equal(requestedAction, action);
    const serial = nextSerial++;
    const proof = {id:nonce + ':' + serial, start:clock.now, value:{
      nonce, url:fixtureUrl, title, id:mount, mountedId:mount, serial,
      caseId:row.caseId, action, target:row.target, allowed:true, editorConnected:true,
      documentFocused:true, point:{...point}, pointerDown:false, viewport:{...viewport},
      zoomEvidence:{dprRatio:1}, ...(cleanup ? {releaseOnly:true} : {})
    }};
    if (pageChange) pageChange(proof, cleanup, f);
    f.guards.push({cleanup, proof:structuredClone(proof)});
    return proof;
  }
  // The sole execution seam: a synchronous in-memory function; no process APIs.
  function run(command, argv, options) {
    assert.equal(command, '/stub/slash43-pointer');
    assert.deepEqual(argv.slice(0,1), ['--request']);
    assert.equal(argv.length, 2);
    const request = JSON.parse(argv[1]);
    assert.deepEqual(Object.keys(request).sort(), [...baseKeys, browser === 'safari' ? 'mouseEventNumber' : 'pid'].sort());
    assert.deepEqual({
      format:request.format, browser:request.browser, nonce:request.nonce, title:request.title,
      fixtureUrl:request.fixtureUrl, mountedId:request.mountedId, caseId:request.caseId,
      action:request.action, target:request.target, point:request.point, viewport:request.viewport
    }, {
      format:'osr43-native-input/1', browser, nonce, title, fixtureUrl, mountedId:mount,
      caseId:row.caseId, action, target:row.target, point, viewport
    });
    assert.ok(Number.isInteger(request.deadlineMs) && request.deadlineMs >= 1 && request.deadlineMs <= 1000);
    assert.deepEqual(options, {timeout:request.deadlineMs, fullStdout:true, maxBuffer:32768});
    if (browser === 'chrome') assert.equal(request.pid, 73);
    const call = {command, argv:[...argv], options:{...options}, request};
    f.calls.push(call);
    assert.ok(f.calls.length <= 2, 'At most one pair and one release-only cleanup');
    const step = f.steps.shift();
    assert.equal(typeof step, 'function', 'No unplanned helper dispatch');
    return step(request, f);
  }
  f.owner = createInputOwner({
    browser, config, inputHelper:'/stub/slash43-pointer', keyScriptPath:'/stub/never-key-script',
    run, record:(kind,value) => f.records.push({kind, value:structuredClone(value)}),
    guard:action => guard(false,action), cleanupGuard:action => guard(true,action),
    mountedId:() => mount, ...(browser === 'chrome' ? {ownedPointerPid:() => 73} : {}),
    safariKeyGuardAgeMs
  });
  return f;
}

// All expected metadata below is independently literal. No expected scalar, pair,
// program, count, delay or namespace is copied from an outgoing request.
function safariAck({action='click-add', cleanup=false, number=1, numbers=[1,1],
  requestId=nonce + ':1'}={}) {
  const row = pointerCases[action];
  return {
    status:'sent', delivery:'sent', action, requestId, nonce, mountedId:mount,
    caseId:row.caseId, target:row.target, cleanupOnly:cleanup,
    frontBundle:'com.apple.Safari', frontPid:73, expectedAxWindowTitle:title,
    observedAxWindowTitle:title, axWindowCount:1, axWindow:{...frame},
    axViewport:{x:22,y:139,width:1024,height:768}, screenPoint:{...screenPoint},
    elapsedMs:100, transitions:cleanup ? ['up'] : ['down','up'],
    mouseEventNumber:number, constructedMouseEventNumbers:[...numbers],
    ...(!cleanup ? {
      prepMove:{event:'mouseMoved', program:['move','down','up'], screenPoint:{...screenPoint},
        postedCount:1, requestedPauseMs:25, elapsedMs:25},
      pairPause:{after:'down', count:1, requestedPauseMs:25, elapsedMs:25}
    } : {})
  };
}
function chromeAck({cleanup=false, requestId=nonce + ':1'}={}) {
  return {
    status:'sent', delivery:'sent', action:'click-add', requestId, nonce, mountedId:mount,
    caseId:'I43-N09-en', target:'add', cleanupOnly:cleanup,
    frontBundle:'com.google.Chrome', frontPid:73, expectedAxWindowTitle:title + ' - Google Chrome',
    observedAxWindowTitle:title + ' - Google Chrome', axWindowCount:1, axWindow:{...frame},
    axViewport:{x:22,y:139,width:1024,height:768}, screenPoint:{...screenPoint},
    elapsedMs:100, transitions:cleanup ? ['up'] : ['move','down','up'],
    posting:{route:'cghidEventTap', guardedPid:73, preflightAccess:true},
    ...(!cleanup ? {
      prelude:{event:'mouseMoved', screenPoint:{...screenPoint}, requestedPauseMs:25, elapsedMs:25},
      pairTiming:{timestampPolicy:'constructor-default', downEventNumber:'0', upEventNumber:'0',
        moveTimestampNs:'100', downTimestampNs:'101', upTimestampNs:'102',
        movePostUptimeNs:'200', downPostUptimeNs:'201', upPostUptimeNs:'202',
        requestedPauseMs:25, elapsedMs:25}
    } : {})
  };
}
function execution(actual) {
  return {returnCode:0, signal:null, error:null, stdout:JSON.stringify(actual), stderr:'', stubOnly:true};
}
function unknown() {
  throw Object.assign(Error('Controlled unknown completion after the original Down'), {execution:{
    returnCode:2, stdout:'{"status":"refused","delivery":"unknown/may_have_sent","reason":"Controlled interruption"}',
    stderr:'', stubOnly:true
  }});
}
function cleanupStep() { return execution(safariAck({cleanup:true, numbers:[1], requestId:nonce + ':2'})); }
function requestPairs(f) {
  return f.calls.map(call => ({
    serial:call.request.serial, number:call.request.mouseEventNumber,
    cleanup:call.request.cleanupOnly, held:call.request.pointerDown
  }));
}
function pairAndCleanupExpected(f) {
  assert.deepEqual(requestPairs(f), [
    {serial:1,number:1,cleanup:false,held:false},
    {serial:2,number:1,cleanup:true,held:true}
  ]);
  assert.equal(f.owner.disabled, true);
  assert.equal(f.owner.pointerDown, false);
  assert.equal(f.owner.pointerState, 'up');
  assert.equal(f.owner.keysPending, false);
  assert.equal(f.calls.length, 2);
  assert.equal(f.steps.length, 0);
}

for (const action of ['click-quote','click-add','click-recovery']) {
  test('SPC01 ' + action + ' retains pair[down,up] plus exact finite prepMove full program', t => {
    return (async () => {
      const f = fixture(t, [() => execution(safariAck({action}))], {action});
      const value = await f.owner.input(action);
      assert.deepEqual(requestPairs(f), [{serial:1,number:1,cleanup:false,held:false}]);
      assert.deepEqual(value.actual, safariAck({action}));
      assert.deepEqual(value.actual.transitions, ['down','up']);
      assert.deepEqual(value.actual.prepMove.program, ['move','down','up']);
      assert.equal(value.guardAgeLimitMs, 1000);
      assert.equal(f.owner.disabled, false); assert.equal(f.owner.pointerDown, false);
      assert.equal(f.owner.keysPending, false); assert.equal(f.steps.length, 0);
      await assert.rejects(() => f.owner.releaseOwnedPointer());
      assert.equal(f.calls.length, 1);
    })();
  });
}

test('SPC02 serial2048 is exact; next2049 refuses before a second helper dispatch', async t => {
  const f = fixture(t, [() => execution(safariAck({
    number:2048, numbers:[2048,2048], requestId:nonce + ':2048'
  }))], {firstSerial:2048});
  await f.owner.input('click-add');
  assert.deepEqual(requestPairs(f), [{serial:2048,number:2048,cleanup:false,held:false}]);
  await assert.rejects(() => f.owner.input('click-add'));
  assert.equal(f.guards.length, 2); assert.equal(f.guards[1].proof.value.serial, 2049);
  assert.equal(f.calls.length, 1); assert.equal(f.owner.disabled, true);
  assert.equal(f.owner.pointerDown, false); assert.equal(f.owner.keysPending, false);
});
for (const serial of [0,1.5,2049]) {
  test('SPC03 invalid original serial ' + serial + ' cannot reach the helper', async t => {
    const f = fixture(t, [], {firstSerial:serial});
    await assert.rejects(() => f.owner.input('click-add'));
    assert.equal(f.calls.length, 0); assert.equal(f.guards.length, 1);
    assert.equal(f.owner.disabled, true); assert.equal(f.owner.pointerDown, false);
  });
}
test('SPC04 expired1001ms initial authority refuses before any dispatch', async t => {
  const f = fixture(t, [], {pageChange:(proof,cleanup,self) => { self.clock.advance(1001); }});
  await assert.rejects(() => f.owner.input('click-add'), /Fresh43 page guard expired/);
  assert.equal(f.calls.length, 0); assert.equal(f.owner.pointerDown, false);
});
test('SPC05 one unknown pair permits only one fresh UP retaining ORIGINAL number1 under serial2', async t => {
  const f = fixture(t, [unknown, cleanupStep]);
  await assert.rejects(() => f.owner.input('click-add'), /Controlled unknown/);
  assert.equal(f.owner.disabled, true); assert.equal(f.owner.pointerDown, true);
  assert.equal(f.owner.pointerState, 'unknown');
  const value = await f.owner.releaseOwnedPointer();
  pairAndCleanupExpected(f);
  assert.deepEqual(value.actual.transitions, ['up']);
  assert.deepEqual(value.actual.constructedMouseEventNumbers, [1]);
  assert.equal(Object.hasOwn(value.actual,'prepMove'), false);
  assert.equal(Object.hasOwn(value.actual,'pairPause'), false);
  await assert.rejects(() => f.owner.releaseOwnedPointer());
  await assert.rejects(() => f.owner.input('click-add'));
  assert.equal(f.calls.length, 2); assert.equal(f.guards.length, 2);
});
test('SPC06 complete at1000ms succeeds without widening the pointer deadline', async t => {
  const f = fixture(t, [(request,self) => {
    const actual = safariAck(); actual.elapsedMs = 1000;
    self.clock.advance(1000); return execution(actual);
  }]);
  const value = await f.owner.input('click-add');
  assert.equal(value.maximumGuardAgeMs,1000); assert.equal(value.guardAgeLimitMs,1000);
  assert.equal(f.calls[0].request.deadlineMs,1000); assert.equal(f.owner.pointerDown,false);
});
test('SPC07 contextual complete pair at1001ms remains FAILED/known-completed with no redundant UP', async t => {
  const f = fixture(t, [(request,self) => {
    const result = execution(safariAck()); self.clock.advance(1001); return result;
  }]);
  await assert.rejects(() => f.owner.input('click-add'), /Total43 pointer guard exceeded1s/);
  assert.equal(f.owner.disabled,true); assert.equal(f.owner.pointerDown,false);
  assert.equal(f.records.at(-1).value.delivery,'sent/known_completed');
  assert.equal(f.records.at(-1).value.maximumGuardAgeMs,1001);
  await assert.rejects(() => f.owner.releaseOwnedPointer());
  assert.equal(f.calls.length,1); assert.equal(f.guards.length,1);
});
test('SPC08 approved Safari key1500 option still leaves pointer authority at1000', async t => {
  const f = fixture(t, [(request,self) => {
    assert.equal(request.deadlineMs,1000);
    const result = execution(safariAck()); self.clock.advance(1001); return result;
  }], {safariKeyGuardAgeMs:1500});
  await assert.rejects(() => f.owner.input('click-add'), /Total43 pointer guard exceeded1s/);
  assert.equal(f.records.at(-1).value.guardAgeLimitMs,1000);
  assert.equal(f.owner.pointerDown,false); assert.equal(f.calls.length,1);
  await assert.rejects(() => f.owner.releaseOwnedPointer());
});

const badPairReceipts = [
  ['missing original number', v => { delete v.mouseEventNumber; }],
  ['wrong original number', v => { v.mouseEventNumber = 2; }],
  ['boolean original number', v => { v.mouseEventNumber = true; }],
  ['string original number', v => { v.mouseEventNumber = '1'; }],
  ['missing getters', v => { delete v.constructedMouseEventNumbers; }],
  ['null getters', v => { v.constructedMouseEventNumbers = null; }],
  ['partial getters', v => { v.constructedMouseEventNumbers = [1]; }],
  ['extra getter', v => { v.constructedMouseEventNumbers = [1,1,1]; }],
  ['mismatched pair', v => { v.constructedMouseEventNumbers = [1,2]; }],
  ['string getter', v => { v.constructedMouseEventNumbers = [1,'1']; }]
];
for (const [name,change] of badPairReceipts) {
  test('SPC09 corrupt pair receipt: ' + name + ' is unknown and never replays a Down', async t => {
    const f = fixture(t, [() => { const actual = safariAck(); change(actual); return execution(actual); },cleanupStep]);
    await assert.rejects(() => f.owner.input('click-add'));
    assert.equal(f.owner.pointerDown,true); assert.equal(f.owner.disabled,true);
    assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
    await f.owner.releaseOwnedPointer(); pairAndCleanupExpected(f);
    await assert.rejects(() => f.owner.releaseOwnedPointer());
    await assert.rejects(() => f.owner.input('click-add')); assert.equal(f.calls.length,2);
  });
}

const badPreparationReceipts = [
  ['missing prepMove', v => { delete v.prepMove; }],
  ['extra prepMove authority', v => { v.prepMove.retry = true; }],
  ['wrong move event', v => { v.prepMove.event = 'mouseDragged'; }],
  ['different move point', v => { v.prepMove.screenPoint.x = 163; }],
  ['zero move count', v => { v.prepMove.postedCount = 0; }],
  ['two moves', v => { v.prepMove.postedCount = 2; }],
  ['different move pause', v => { v.prepMove.requestedPauseMs = 24; }],
  ['negative move elapsed', v => { v.prepMove.elapsedMs = -1; }],
  ['string move elapsed', v => { v.prepMove.elapsedMs = '25'; }],
  ['move exceeds helper elapsed', v => { v.prepMove.elapsedMs = 101; }],
  ['missing program', v => { delete v.prepMove.program; }],
  ['wrong program order', v => { v.prepMove.program = ['down','move','up']; }],
  ['extra program step', v => { v.prepMove.program = ['move','down','up','down']; }],
  ['missing pairPause', v => { delete v.pairPause; }],
  ['extra pairPause authority', v => { v.pairPause.retry = true; }],
  ['pause after up', v => { v.pairPause.after = 'up'; }],
  ['zero pair pause count', v => { v.pairPause.count = 0; }],
  ['two pair pauses', v => { v.pairPause.count = 2; }],
  ['different pair pause', v => { v.pairPause.requestedPauseMs = 26; }],
  ['negative pair elapsed', v => { v.pairPause.elapsedMs = -1; }],
  ['pair pause exceeds helper elapsed', v => { v.pairPause.elapsedMs = 101; }],
  ['missing helper elapsed', v => { delete v.elapsedMs; }],
  ['string helper elapsed', v => { v.elapsedMs = '100'; }],
  ['negative helper elapsed', v => { v.elapsedMs = -1; }],
  ['helper exceeds original1000ms', v => { v.elapsedMs = 1001; }]
];
for (const [name,change] of badPreparationReceipts) {
  test('SPC10 corrupt preparation receipt: ' + name + ' cannot become completed', async t => {
    const f = fixture(t, [() => { const actual = safariAck(); change(actual); return execution(actual); },cleanupStep]);
    await assert.rejects(() => f.owner.input('click-add'));
    assert.equal(f.owner.disabled,true); assert.equal(f.owner.pointerDown,true);
    assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
    await f.owner.releaseOwnedPointer(); pairAndCleanupExpected(f);
    await assert.rejects(() => f.owner.releaseOwnedPointer()); assert.equal(f.calls.length,2);
  });
}
const badCleanupReceipts = [
  ['fresh number substituted', v => { v.mouseEventNumber = 2; v.constructedMouseEventNumbers = [2]; }],
  ['fresh getter substituted', v => { v.constructedMouseEventNumbers = [2]; }],
  ['two getters', v => { v.constructedMouseEventNumbers = [1,1]; }],
  ['new preparation move', v => { v.prepMove = safariAck().prepMove; }],
  ['new down pause', v => { v.pairPause = safariAck().pairPause; }],
  ['new down transition', v => { v.transitions = ['down','up']; }]
];
for (const [name,change] of badCleanupReceipts) {
  test('SPC11 corrupt cleanup: ' + name + ' refuses without a second cleanup or Down', async t => {
    const f = fixture(t, [unknown, () => {
      const actual = safariAck({cleanup:true,numbers:[1],requestId:nonce + ':2'});
      change(actual); return execution(actual);
    }]);
    await assert.rejects(() => f.owner.input('click-add'));
    await assert.rejects(() => f.owner.releaseOwnedPointer());
    assert.deepEqual(requestPairs(f), [
      {serial:1,number:1,cleanup:false,held:false},
      {serial:2,number:1,cleanup:true,held:true}
    ]);
    assert.equal(f.owner.disabled,true); assert.equal(f.owner.pointerDown,true);
    await assert.rejects(() => f.owner.releaseOwnedPointer());
    await assert.rejects(() => f.owner.input('click-add'));
    assert.equal(f.calls.length,2); assert.equal(f.guards.length,2);
  });
}
test('SPC12 foreign cleanup mount cannot acquire original pair ownership', async t => {
  const f = fixture(t, [unknown], {pageChange:(proof,cleanup) => {
    if (cleanup) { proof.value.id = 'ui42-2'; proof.value.mountedId = 'ui42-2'; }
  }});
  await assert.rejects(() => f.owner.input('click-add'));
  await assert.rejects(() => f.owner.releaseOwnedPointer());
  assert.equal(f.calls.length,1); assert.equal(f.guards.length,2); assert.equal(f.owner.pointerDown,true);
  await assert.rejects(() => f.owner.releaseOwnedPointer()); assert.equal(f.calls.length,1);
});
test('SPC13 explicit helper not_sent never creates a cleanup authorization', async t => {
  const f = fixture(t, [() => { throw Object.assign(Error('Controlled pre-post refusal'), {execution:{
    returnCode:2,stdout:'{"status":"refused","delivery":"not_sent"}',stderr:'',stubOnly:true
  }}); }]);
  await assert.rejects(() => f.owner.input('click-add'), /Controlled pre-post refusal/);
  assert.equal(f.owner.pointerDown,false); assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');
  await assert.rejects(() => f.owner.releaseOwnedPointer()); assert.equal(f.calls.length,1);
});
test('SPC14 Chrome original PID envelope/prelude/constructor pair receipt is unchanged and needs no Safari fields', async t => {
  const f = fixture(t, [() => execution(chromeAck())], {browser:'chrome'});
  const value = await f.owner.input('click-add');
  assert.deepEqual(value.actual,chromeAck());
  assert.equal(Object.hasOwn(f.calls[0].request,'mouseEventNumber'),false);
  for (const key of ['mouseEventNumber','constructedMouseEventNumbers','prepMove','pairPause']) assert.equal(Object.hasOwn(value.actual,key),false);
  assert.deepEqual(value.actual.transitions,['move','down','up']);
  assert.equal(value.actual.prelude.requestedPauseMs,25); assert.equal(value.actual.pairTiming.requestedPauseMs,25);
  assert.equal(value.actual.pairTiming.downEventNumber,'0'); assert.equal(value.actual.pairTiming.upEventNumber,'0');
  assert.equal(value.guardAgeLimitMs,1000); assert.equal(f.owner.pointerDown,false);
  await assert.rejects(() => f.owner.releaseOwnedPointer()); assert.equal(f.calls.length,1);
});
test('SPC15 Chrome unknown completion keeps its original one-UP cleanup shape with no Safari metadata', async t => {
  const f = fixture(t, [unknown, () => execution(chromeAck({cleanup:true,requestId:nonce + ':2'}))], {browser:'chrome'});
  await assert.rejects(() => f.owner.input('click-add'));
  const value = await f.owner.releaseOwnedPointer();
  assert.equal(Object.hasOwn(f.calls[0].request,'mouseEventNumber'),false);
  assert.equal(Object.hasOwn(f.calls[1].request,'mouseEventNumber'),false);
  assert.deepEqual(f.calls.map(c => [c.request.serial,c.request.cleanupOnly,c.request.pointerDown]),[[1,false,false],[2,true,true]]);
  assert.deepEqual(value.actual.transitions,['up']); assert.equal(f.owner.pointerDown,false);
  assert.equal(Object.hasOwn(value.actual,'prelude'),false); assert.equal(Object.hasOwn(value.actual,'pairTiming'),false);
  await assert.rejects(() => f.owner.releaseOwnedPointer()); assert.equal(f.calls.length,2);
});
test('SPC16 Safari slash key retains original closed request and literal SystemEvents program in memory', async t => {
  const clock = clockFor(t), calls = [];
  const keyGuard = {
    status:'guarded',delivery:'not_sent',cleanupOnly:false,action:'slash',requestId:nonce + ':1',
    nonce,mountedId:mount,caseId:'I43-N01-en',target:'focused',frontBundle:'com.apple.Safari',frontPid:73,
    expectedAxWindowTitle:title,observedAxWindowTitle:title,axWindowCount:1,axWindow:{...frame},
    keyboardTranslation:{sourceId:'com.apple.keylayout.US',layoutId:'com.apple.keylayout.US',
      selected:true,enabled:true,selectable:true,keyCode:44,modifierState:0,keyboardType:40,
      text:'/',deadKeyState:0,osStatus:0}
  };
  const owner = createInputOwner({browser:'safari',config,inputHelper:'/stub/key-guard',
    keyScriptPath:'/stub/keys43.scpt',record:() => {},mountedId:() => mount,
    guard:async () => ({id:nonce + ':1',start:clock.now,value:{
      nonce,url:fixtureUrl,title,id:mount,mountedId:mount,serial:1,caseId:'I43-N01-en',action:'slash',
      target:'focused',allowed:true,documentFocused:true,editorConnected:true,point:null,pointerDown:false,
      viewport:{...viewport},zoomEvidence:{dprRatio:1}
    }}),cleanupGuard:async () => { assert.fail('No cleanup allowed after this complete key'); },
    run(command,argv,options) {
      calls.push({command,argv:[...argv],options:{...options}});
      assert.equal(options.timeout,1000);
      if (calls.length === 1) {
        assert.equal(command,'/stub/key-guard'); assert.equal(argv[0],'--guard-key');
        const request = JSON.parse(argv[1]); assert.deepEqual(Object.keys(request).sort(),[...baseKeys].sort());
        assert.equal(request.action,'slash'); assert.equal(request.point,null); assert.equal(request.deadlineMs,1000);
        return execution(keyGuard);
      }
      assert.equal(calls.length,2); assert.equal(command,'/usr/bin/osascript');
      assert.deepEqual(argv,['/stub/keys43.scpt','safari',title,'73','slash']);
      return execution({action:'slash',status:'key-sent',keyCode:44,modifiers:[],frontPid:73,
        keyTransitions:['key44-down','key44-up']});
    }
  });
  const value = await owner.input('slash');
  assert.equal(value.guardAgeLimitMs,1000); assert.equal(calls.length,2);
  assert.equal(owner.keysPending,false); assert.equal(owner.pointerDown,false);
});
test('SPC17 Safari1500 constructor option remains forbidden for Chrome', t => {
  assert.throws(() => fixture(t, [], {browser:'chrome',safariKeyGuardAgeMs:1500}), /Safari-only/);
});
