// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled protocol/dispatch boundaries only. No OS, browser, helper or network calls.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createInputOwner,prepareChromeWindow} from '../scripts/selection-native/input.mjs';
import {validCall,limits} from '../scripts/selection-native/protocol.mjs';
const expectedKeys={'shift-left':{code:123,modifier:'shift'},'select-all':{code:0,modifier:'command'},copy:{code:8,modifier:'command'},
  cut:{code:7,modifier:'command'},'shift-tab':{code:48,modifier:'shift'},tab:{code:48,modifier:'none'}};
function fixture(browser='safari'){
  const nonce='a'.repeat(32),config={nonce,origin:'http://127.0.0.1:4174',fixtureUrl:'http://127.0.0.1:4174/selection',title:'KlenWriter Selection native '+nonce};
  let serial=0,reply=null,execute=null,keyExecute=null,keyProof=null,pageDown=false;
  const records=[],calls=[];
  function proof(action){
      return {id:nonce+':'+String(++serial),start:process.hrtime.bigint(),value:{nonce,url:config.fixtureUrl,title:config.title,
        id:'selection-mount-1',mountedId:'selection-mount-1',serial,caseId:'scroll-down-terminal',action,
        target:action==='tab'?'host-control':'editor',allowed:true,editorConnected:true,documentFocused:true,pointerDown:pageDown,
        viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},point:['move-start','down','move-end','up'].includes(action)?{x:140,y:340}:null,
        lastTrustedPointerMove:{x:140,y:340,buttons:0,pointerId:1,pointerType:'mouse',isPrimary:true,isTrusted:true,time:25}}};
  }
  const owner=createInputOwner({browser,config,inputHelper:'/controlled/no-helper-is-executed',mountedId:()=> 'selection-mount-1',
    record:(kind,value)=>records.push({kind,value}),
    async guard(action){return reply?reply(action,proof):proof(action);},
    run(command,argv,options){
      if(command==='/usr/bin/osascript'){
        const action=argv.at(-1),call={command,argv,options,action};calls.push(call);if(keyExecute)return keyExecute(call);
        return {returnCode:0,stdout:JSON.stringify({status:'key-sent',action,keyCode:expectedKeys[action].code,modifier:expectedKeys[action].modifier,frontPid:31}),stderr:''};
      }
      const request=JSON.parse(argv[1]);calls.push({command,argv,options,request});if(execute)return execute(request);
      if(argv[0]==='--guard-key'){
        const value={status:'guarded',delivery:'not_sent',action:request.action,requestId:request.requestId,nonce,mountedId:request.mountedId,caseId:request.caseId,
          target:request.target,cleanupOnly:false,frontBundle:browser==='chrome'?'com.google.Chrome':'com.apple.Safari',frontPid:31,
          expectedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),observedAxWindowTitle:config.title+(browser==='chrome'?' - Google Chrome':''),
          axWindowCount:1,axViewport:{x:22,y:139,width:1024,height:768},elapsedMs:20};
        return {returnCode:0,stdout:JSON.stringify(keyProof?keyProof(value):value),stderr:''};
      }
      if(request.action==='down')pageDown=true;if(request.action==='up')pageDown=false;
      return {returnCode:0,stdout:JSON.stringify({status:'sent',action:request.action,requestId:request.requestId,nonce}),stderr:''};},
  });
  return {owner,config,records,calls,set reply(value){reply=value;},set execute(value){execute=value;},set keyExecute(value){keyExecute=value;},set keyProof(value){keyProof=value;}};
}
test('controlled selection transport has finite closed cases/actions, no eval/coordinates/key RPC',()=>{
  assert.equal(limits.commands,1024);assert.equal(limits.runMs,600000);
  assert(validCall('prepare',['en','key-comb']));assert(validCall('guard',['move-end']));assert(validCall('checkpoint',[]));
  for(const pair of [['eval',['1+1']],['guard',['key-42']],['prepare',['en','invented']],['guard',['down',{x:1,y:1}]],['inspect',['extra']]])assert.equal(validCall(...pair),false);
});
test('controlled stale guard never starts physical dispatch and disables later input',async()=>{
  const f=fixture();f.reply=(action,proof)=>({...proof(action),start:process.hrtime.bigint()-2_000_000_000n});
  await assert.rejects(f.owner.input('down'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');await assert.rejects(f.owner.input('select-all'));assert.equal(f.calls.length,0);
});
test('controlled foreign mount guard refuses before any physical helper call',async()=>{
  const f=fixture();f.reply=(action,proof)=>{const result=proof(action);result.value.mountedId='selection-mount-2';return result;};
  await assert.rejects(f.owner.input('down'));assert.equal(f.calls.length,0);assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
for(const [name,alter] of [
  ['missing observed move',()=>null],
  ['wrong actual client x',move=>({...move,x:140.6})],
  ['wrong actual client y',move=>({...move,y:339.4})],
  ['already held button',move=>({...move,buttons:1})],
  ['untrusted move',move=>({...move,isTrusted:false})],
  ['nonmouse pointer',move=>({...move,pointerType:'pen'})],
  ['nonprimary pointer',move=>({...move,isPrimary:false})],
  ['missing pointer identity',move=>({...move,pointerId:null})],
])test(`controlled ${name} stops before physical down despite matching intended coordinates`,async()=>{
  const f=fixture();f.reply=(action,proof)=>{const result=proof(action);result.value.lastTrustedPointerMove=alter(result.value.lastTrustedPointerMove);return result;};
  await assert.rejects(f.owner.input('down'),/Actual trusted mousemove/);
  assert.equal(f.calls.length,0,'The Swift input helper must never be invoked');assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'not_sent');assert.equal(f.records.at(-1).value.dispatchStarted,false);
});
test('controlled actual trusted mouse point within the frozen tolerance permits one down and retains proof',async()=>{
  const f=fixture();f.reply=(action,proof)=>{const result=proof(action);result.value.lastTrustedPointerMove.x=140.49;result.value.lastTrustedPointerMove.y=339.51;return result;};
  const receipt=await f.owner.input('down');assert.equal(f.calls.length,1);assert.equal(f.calls[0].request.action,'down');
  assert.deepEqual(f.calls[0].request.point,{x:140,y:340},'Actual observation never retargets the fixed fixture point');
  assert.equal(receipt.lastTrustedPointerMove.x,140.49);assert.equal(receipt.lastTrustedPointerMove.y,339.51);
});
test('controlled unknown down allows one fresh owned cleanup release without restoring acceptance',async()=>{
  const f=fixture();f.execute=()=>{throw Object.assign(Error('controlled timeout'),{execution:{returnCode:null,error:'timeout'}});};
  await assert.rejects(f.owner.input('down'));assert.equal(f.owner.pointerState,'may-have-down');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');assert.equal(f.calls.length,1);
  f.execute=null;const cleanup=await f.owner.releaseOwnedPointer();assert.equal(cleanup.cleanupOnly,true);assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,true);
  assert.equal(f.calls[1].request.action,'up');assert.equal(f.calls[1].request.cleanupOnly,true);
  await assert.rejects(f.owner.input('select-all'));await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,2);
});
test('controlled lost broker cannot be bypassed for pointer cleanup',async()=>{
  const f=fixture();await f.owner.input('down');assert.equal(f.owner.pointerState,'down');
  f.reply=()=>{throw Error('unknown broker completion; pending command retained');};
  await assert.rejects(f.owner.releaseOwnedPointer());assert.equal(f.calls.length,1);assert.equal(f.owner.pointerState,'down');assert.equal(f.owner.disabled,true);
  assert.equal(f.records.at(-1).kind,'cleanup-pointer-release-failure');assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('controlled ordinary pointer phases preserve one owned button and actual returned receipts',async()=>{
  const f=fixture();await f.owner.input('move-start');await f.owner.input('down');await f.owner.input('move-end');await f.owner.input('up');
  assert.equal(f.owner.pointerState,'up');assert.equal(f.owner.disabled,false);assert.deepEqual(f.calls.map(r=>r.request.action),['move-start','down','move-end','up']);
  assert(f.records.every(row=>row.value.delivery==='sent'));assert(f.calls.every(row=>row.request.deadlineMs>0&&row.request.deadlineMs<=1000));
});
for(const[action,expected]of Object.entries(expectedKeys))test(`controlled ${action} uses one fixed System Events key after a separate strict read-only preflight`,async()=>{
  const f=fixture(),receipt=await f.owner.input(action);assert.equal(f.calls.length,2);
  assert.equal(f.calls[0].argv[0],'--guard-key');assert.equal(f.calls[0].request.action,action);assert.equal(f.calls[0].request.point,null);
  const sent=f.calls[1];assert.equal(sent.command,'/usr/bin/osascript');assert.equal(sent.argv[0],'-e');
  assert.deepEqual(sent.argv.slice(2),['safari',f.config.title,'31',action],'No arbitrary keycode, modifier or script argument');
  assert.ok(sent.options.timeout<=f.calls[0].options.timeout&&sent.options.timeout>0,'One total page guard deadline');
  assert.equal(receipt.keyGuard.status,'guarded');assert.equal(receipt.keyGuard.delivery,'not_sent');
  assert.equal(receipt.keyGuardExecution.returnCode,0);assert.equal(receipt.systemEventsExecution.returnCode,0);
  assert.deepEqual(receipt.actual,{status:'key-sent',action,keyCode:expected.code,modifier:expected.modifier,frontPid:31});
  assert.equal(receipt.delivery,'sent');assert.equal(f.owner.disabled,false);
});
test('controlled Chrome key passes only the exact decorated AX title and own guarded PID to System Events',async()=>{
  const f=fixture('chrome');await f.owner.input('copy');assert.deepEqual(f.calls[1].argv.slice(2),['chrome',f.config.title+' - Google Chrome','31','copy']);
});
test('controlled refused read-only key preflight never invokes System Events and stays not_sent',async()=>{
  const f=fixture();f.execute=()=>{throw Object.assign(Error('Strict AX refused'),{execution:{returnCode:2,stdout:'refused',stderr:''}});};
  await assert.rejects(f.owner.input('copy'));assert.equal(f.calls.length,1);assert.equal(f.records.at(-1).value.delivery,'not_sent');
  assert.equal(f.records.at(-1).value.dispatchStarted,false);assert.equal(f.records.at(-1).value.keyGuardExecution.returnCode,2);
  await assert.rejects(f.owner.input('tab'));assert.equal(f.calls.length,1);
});
test('controlled guard expiring after read-only preflight sends no key and retains its actual preflight',async()=>{
  const f=fixture();let proof;
  f.reply=(action,make)=>{proof=make(action);return proof;};f.keyProof=value=>{proof.start=process.hrtime.bigint()-2_000_000_000n;return value;};
  await assert.rejects(f.owner.input('shift-left'),/expired after read-only/);assert.equal(f.calls.length,1);
  const failure=f.records.at(-1).value;assert.equal(failure.delivery,'not_sent');assert.equal(failure.keyGuard.status,'guarded');assert.equal(failure.systemEventsExecution,null);
});
test('controlled malformed key preflight identity refuses before System Events',async()=>{
  const f=fixture();f.keyProof=value=>({...value,expectedAxWindowTitle:value.expectedAxWindowTitle+' other'});
  await assert.rejects(f.owner.input('copy'),/preflight differs/);assert.equal(f.calls.length,1);assert.equal(f.records.at(-1).value.delivery,'not_sent');
});
test('controlled unknown System Events completion disables later keys and preserves both raw executions',async()=>{
  const f=fixture();f.keyExecute=()=>{throw Object.assign(Error('Controlled post-key ownership/timeout failure'),{execution:{returnCode:null,error:'unknown'}});};
  await assert.rejects(f.owner.input('cut'));assert.equal(f.calls.length,2);const failed=f.records.at(-1).value;
  assert.equal(failed.delivery,'unknown/may_have_sent');assert.equal(failed.dispatchStarted,true);assert.equal(failed.keyGuardExecution.returnCode,0);
  assert.equal(failed.systemEventsExecution.error,'unknown');await assert.rejects(f.owner.input('copy'));assert.equal(f.calls.length,2);
});
test('controlled wrong System Events modifier receipt cannot prove key delivery',async()=>{
  const f=fixture();f.keyExecute=()=>({returnCode:0,stdout:JSON.stringify({status:'key-sent',action:'copy',keyCode:8,modifier:'none',frontPid:31}),stderr:''});
  await assert.rejects(f.owner.input('copy'),/closed key receipt differs/);assert.equal(f.calls.length,2);assert.equal(f.records.at(-1).value.delivery,'unknown/may_have_sent');
  assert.equal(f.owner.disabled,true);
});
test('controlled ShiftTab key preserves owned held pointer for a separately guarded mouse release',async()=>{
  const f=fixture();await f.owner.input('down');await f.owner.input('shift-tab');assert.equal(f.owner.pointerState,'down');
  assert.equal(f.calls[1].argv[0],'--guard-key');assert.equal(f.calls[1].request.pointerDown,true);
  await f.owner.input('up');assert.equal(f.owner.pointerState,'up');assert.equal(f.calls[3].argv[0],'--request');
});

function bootstrapFixture(){
  const nonce='b'.repeat(32),config={nonce,title:'KlenWriter Selection native '+nonce,fixtureUrl:'http://127.0.0.1:4174/selection'};
  let current={left:22,top:52,width:1026,height:848,windowState:'normal'},time=0,pageReads=0;
  const records=[],commands=[],inspections=[];
  const control={page:null,inspection:null,command:null,target:null,frame:null,viewY:139};
  const callbacks={config,record:(kind,value)=>records.push({kind,value}),clock:()=>time,delay:async ms=>{time+=ms;},
    getBrowserPid:async()=>31,
    getTargetInfo:async()=>{const value={targetId:'own-page',type:'page',url:config.fixtureUrl,title:config.title};return control.target?control.target(value):value;},
    pageState:async()=>{
      const value={nonce,url:config.fixtureUrl,title:config.title,documentFocused:true,
        viewport:{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},scroll:{x:0,y:0},selection:{rangeCount:0,anchor:null,focus:null}};
      return control.page?control.page(value,++pageReads):value;
    },
    inspectWindow:async request=>{
      assert.deepEqual(Object.keys(request).sort(),['browser','deadlineMs','fixtureUrl','format','nonce','title']);
      assert.equal(request.format,'osr40-native-window-inspection/1');assert.equal(request.browser,'chrome');
      assert.equal(request.nonce,nonce);assert.equal(request.title,config.title);assert.equal(request.fixtureUrl,config.fixtureUrl);
      assert.ok(Number.isInteger(request.deadlineMs)&&request.deadlineMs>0&&request.deadlineMs<=1000);
      const frame=control.frame??{x:current.left,y:current.top,width:current.width,height:current.height},view={x:22,y:control.viewY,width:1024,height:768};
      let actual={format:request.format,status:'inspected',delivery:'not_sent',browser:'chrome',nonce,title:config.title,fixtureUrl:config.fixtureUrl,
        frontBundle:'com.google.Chrome',frontPid:31,expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',
        axWindowCount:1,axMatchCount:1,visitedNodes:44,maximumDepth:13,axWindow:frame,axViewport:view,
        contained:view.x>=frame.x-.5&&view.x+view.width<=frame.x+frame.width+.5&&view.y>=frame.y-.5&&view.y+view.height<=frame.y+frame.height+.5,elapsedMs:20};
      if(control.inspection)actual=control.inspection(actual,request);
      inspections.push({request,actual});return {execution:{returnCode:0,stdout:JSON.stringify(actual),stderr:''},actual};
    },
    windowCommand:async(method,params)=>{
      commands.push({method,params:structuredClone(params)});
      if(control.command){const result=control.command(method,params);if(result!==undefined)return result;}
      if(method==='Browser.getWindowForTarget'){assert.deepEqual(params,{targetId:'own-page'});return {windowId:9,bounds:{...current}};}
      assert.equal(params.windowId,9,'No other browser window may be addressed');
      if(method==='Browser.getWindowBounds')return {bounds:{...current}};
      assert.equal(method,'Browser.setWindowBounds');assert.deepEqual(Object.keys(params.bounds).sort(),['height','width']);
      current={...current,...params.bounds};return {};
    }};
  return {callbacks,control,records,commands,inspections,advance:ms=>{time+=ms;},resizes:()=>commands.filter(row=>row.method==='Browser.setWindowBounds')};
}
test('controlled Chrome bootstrap preserves failed baseline and fixes only measured own-window spill',async()=>{
  const f=bootstrapFixture(),result=await prepareChromeWindow(f.callbacks);
  assert.equal(result.status,'prepared');assert.equal(result.adjustments,1);assert.equal(result.measurement.contained,true);
  assert.deepEqual(f.resizes(),[{method:'Browser.setWindowBounds',params:{windowId:9,bounds:{width:1026,height:855}}}]);
  assert.deepEqual(f.inspections.map(row=>row.actual.contained),[false,true]);
  const saved=f.records.filter(row=>row.kind==='chrome-bootstrap-inspection');assert.equal(saved.length,2);
  assert.equal(saved[0].value.actual.axWindow.height,848);assert.equal(saved[1].value.actual.axWindow.height,855);
  assert.equal(saved[0].value.execution.returnCode,0);assert.equal(saved[0].value.actual.delivery,'not_sent');
  assert.deepEqual(saved[0].value.before,saved[1].value.after,'Bootstrap does not write page viewport, scroll or selection');
});
test('controlled Chrome bootstrap rejects a nonce with a trailing newline before any callback',async()=>{
  const f=bootstrapFixture();f.callbacks.config={...f.callbacks.config,nonce:f.callbacks.config.nonce+'\n',title:f.callbacks.config.title+'\n'};
  await assert.rejects(prepareChromeWindow(f.callbacks));assert.equal(f.records.length,0);assert.equal(f.commands.length,0);assert.equal(f.inspections.length,0);
});
test('controlled Chrome bootstrap uses fractional measured spill and keeps existing half-pixel containment tolerance',async()=>{
  const exact=bootstrapFixture();exact.control.frame={x:22,y:52,width:1026,height:854.5};
  assert.equal((await prepareChromeWindow(exact.callbacks)).adjustments,0);assert.equal(exact.resizes().length,0);
  const outside=bootstrapFixture();outside.control.viewY=139.2;
  const result=await prepareChromeWindow(outside.callbacks);assert.equal(result.adjustments,1);
  assert.deepEqual(outside.resizes()[0].params.bounds,{width:1026,height:856},'ceil actual7.2px spill is8; no constant toolbar correction');
});
for(const [name,alter]of[
  ['foreign foreground PID',value=>({...value,frontPid:32})],
  ['contradictory contained flag',value=>({...value,contained:true})],
  ['ambiguous WebArea',value=>({...value,axMatchCount:2})],
  ['node budget exceeded',value=>({...value,visitedNodes:513})],
  ['nonfinite rectangle edge',value=>({...value,axWindow:{x:1e308,y:52,width:1e308,height:848}})],
  ['late inspection receipt',value=>({...value,elapsedMs:1001})],
])test(`controlled Chrome bootstrap ${name} refuses before any resize`,async()=>{
  const f=bootstrapFixture();f.control.inspection=alter;
  await assert.rejects(prepareChromeWindow(f.callbacks));assert.equal(f.resizes().length,0);assert.equal(f.commands.length,0);
});
test('controlled Chrome bootstrap rechecks actual page ownership after inspection before any resize',async()=>{
  const f=bootstrapFixture();f.control.page=(value,count)=>count===2?{...value,url:'http://127.0.0.1:4174/other'}:value;
  await assert.rejects(prepareChromeWindow(f.callbacks),/Bootstrap page URL changed/);assert.equal(f.resizes().length,0);assert.equal(f.commands.length,0);
});
for(const change of ['URL','target','window'])test(`controlled Chrome bootstrap ${change} change during bounds read refuses before resize`,async()=>{
  const f=bootstrapFixture();let boundsRead=false;
  f.control.command=method=>{
    if(method==='Browser.getWindowBounds')boundsRead=true;
    if(method==='Browser.getWindowForTarget'&&boundsRead&&change==='window')return {windowId:10,bounds:{left:22,top:52,width:1026,height:848,windowState:'normal'}};
  };
  f.control.page=value=>boundsRead&&change==='URL'?{...value,url:'http://127.0.0.1:4174/other'}:value;
  f.control.target=value=>boundsRead&&change==='target'?{...value,targetId:'different-page'}:value;
  await assert.rejects(prepareChromeWindow(f.callbacks));assert.equal(f.resizes().length,0);assert.equal(f.inspections.length,1);
  assert.equal(f.records.some(row=>row.kind==='chrome-bootstrap-completed'),false);
});
test('controlled Chrome bootstrap refuses changed raw selection and scroll instead of repairing the page',async()=>{
  for(const altered of [{selection:{rangeCount:1,anchor:{path:[0],offset:0},focus:{path:[0],offset:1}}},{scroll:{x:0,y:1}}]){
    const f=bootstrapFixture();f.control.page=(value,count)=>count===2?{...value,...altered}:value;
    await assert.rejects(prepareChromeWindow(f.callbacks));assert.equal(f.commands.length,0);
  }
});
test('controlled Chrome bootstrap unknown CDP resize completion stops without another inspection or command',async()=>{
  const f=bootstrapFixture();f.control.command=method=>{if(method==='Browser.setWindowBounds')throw Object.assign(Error('Unknown CDP completion'),{execution:{status:'unknown'}});};
  await assert.rejects(prepareChromeWindow(f.callbacks),/Unknown CDP completion/);assert.equal(f.resizes().length,1);assert.equal(f.inspections.length,1);
  assert.equal(f.commands.at(-1).method,'Browser.setWindowBounds');assert.equal(f.records.at(-1).value.execution.status,'unknown');
});
test('controlled Chrome bootstrap maximum3 adjustments retains all strict refusals',async()=>{
  const f=bootstrapFixture();f.control.frame={x:22,y:52,width:1026,height:848};
  await assert.rejects(prepareChromeWindow(f.callbacks),/at most3/);assert.equal(f.resizes().length,3);assert.equal(f.inspections.length,4);
  assert(f.inspections.every(row=>row.actual.contained===false));assert.equal(f.records.some(row=>row.kind==='chrome-bootstrap-completed'),false);
});
test('controlled Chrome bootstrap does not move a window or continue after overall deadline',async()=>{
  const moved=bootstrapFixture();let resized=false;
  moved.control.command=(method,params)=>{
    if(method==='Browser.setWindowBounds')resized=true;
    if(method==='Browser.getWindowBounds'&&resized)return {bounds:{left:23,top:52,width:params.width??1026,height:855,windowState:'normal'}};
  };
  await assert.rejects(prepareChromeWindow(moved.callbacks),/window origin/);assert.equal(moved.resizes().length,1);assert.equal(moved.inspections.length,1);
  const expired=bootstrapFixture();expired.control.inspection=value=>{expired.advance(15001);return value;};
  await assert.rejects(prepareChromeWindow(expired.callbacks),/deadline/);assert.equal(expired.commands.length,0);
});
