// SPDX-License-Identifier: MIT OR Apache-2.0
// OSR-43 namespace adaptation of the existing guarded OSR-41 transport; separate evidence.
import assert from 'node:assert/strict';
// Bootstrap only. These readbacks never authorize a later physical action.
export async function prepareChromeWindow({config,pageState,inspectWindow,getBrowserPid,getTargetInfo,windowCommand,record,
  clock=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
  assert.match(config.nonce,/^[a-f0-9]{32}$/);
  assert.equal(config.nonce.length,32);
  assert.equal(config.title,'KlenWriter Slash native '+config.nonce);
  assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');
  const began=clock(),maximumMs=15000;let sequence=0;
  const remaining=()=>maximumMs-(clock()-began);
  async function step(operation,callback,cap=5000){
    const timeout=Math.floor(Math.min(cap,remaining()));assert.ok(timeout>0,'Chrome bootstrap deadline expired');
    const row={sequence:++sequence,operation,timeoutMs:timeout,status:'pending'};record('chrome-bootstrap',row);
    let timer;
    try{
      const value=await Promise.race([Promise.resolve().then(()=>callback(timeout)),new Promise((_,reject)=>{
        timer=setTimeout(()=>reject(Error('Unknown Chrome bootstrap completion; no further commands permitted')),timeout);
      })]);
      assert.ok(remaining()>0,'Chrome bootstrap deadline expired after operation');
      record('chrome-bootstrap',{...row,status:'completed',result:value});return value;
    }catch(error){record('chrome-bootstrap',{...row,status:'failed',error:String(error?.message??error),execution:error.execution??null});throw error;}
    finally{clearTimeout(timer);}
  }
  function page(value){
    assert.equal(value.nonce,config.nonce,'Bootstrap page nonce changed');
    assert.equal(value.url,config.fixtureUrl,'Bootstrap page URL changed');assert.equal(value.title,config.title,'Bootstrap page title changed');
    assert.equal(value.documentFocused,true,'Bootstrap page lost focus');
    assert.deepEqual(value.viewport,{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0},'Frozen bootstrap viewport');
    assert.deepEqual(value.scroll,{x:0,y:0},'Bootstrap must not change document scroll');
    assert.ok(value.selection&&typeof value.selection==='object','Actual raw selection readback required');return value;
  }
  function rectangle(value){
    assert.ok(value&&['x','y','width','height'].every(key=>typeof value[key]==='number'&&Number.isFinite(value[key])),'Finite measured AX rectangle');
    assert.ok(value.width>0&&value.height>0&&Number.isFinite(value.x+value.width)&&Number.isFinite(value.y+value.height),'Finite positive measured AX edges');return value;
  }
  function bounds(value){
    assert.ok(value&&['left','top','width','height'].every(key=>Number.isSafeInteger(value[key])),'Exact own-window CDP bounds');
    assert.ok(value.width>0&&value.height>0);assert.equal(value.windowState,'normal');return value;
  }
  const ownPid=await step('own-browser-pid',getBrowserPid);assert.ok(Number.isSafeInteger(ownPid)&&ownPid>0);
  let baselinePage=null;
  async function snapshot(index){
    const before=page(await step('page-before-inspection',pageState));
    baselinePage??=before;
    assert.deepEqual(before.selection,baselinePage.selection,'Bootstrap changed actual raw selection');
    let request;
    const result=await step('read-only-window-inspection',timeout=>{
      request={format:'osr43-native-window-inspection/1',browser:'chrome',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:timeout};
      return inspectWindow(request);
    },1000);
    assert.equal(result.execution.returnCode,0,'Inspector must complete successfully');
    const actual=result.actual;
    assert.equal(actual.format,'osr43-native-window-inspection/1');assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');
    assert.equal(actual.browser,'chrome');assert.equal(actual.nonce,config.nonce);assert.equal(actual.title,config.title);assert.equal(actual.fixtureUrl,config.fixtureUrl);
    assert.equal(actual.frontBundle,'com.google.Chrome');assert.equal(actual.frontPid,ownPid,'AX foreground PID differs from own CDP browser');
    assert.equal(actual.expectedAxWindowTitle,config.title+' - Google Chrome');assert.equal(actual.observedAxWindowTitle,actual.expectedAxWindowTitle);
    assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);assert.equal(actual.axMatchCount,1);
    assert.ok(Number.isSafeInteger(actual.visitedNodes)&&actual.visitedNodes>=1&&actual.visitedNodes<=512);
    assert.ok(Number.isSafeInteger(actual.maximumDepth)&&actual.maximumDepth>=0&&actual.maximumDepth<=32);
    assert.ok(typeof actual.elapsedMs==='number'&&Number.isFinite(actual.elapsedMs)&&actual.elapsedMs>=0&&actual.elapsedMs<=request.deadlineMs);
    const frame=rectangle(actual.axWindow),view=rectangle(actual.axViewport);
    assert.ok(Math.abs(view.width-1024)<=.5&&Math.abs(view.height-768)<=.5,'Exact frozen AXWebArea size');
    const contained=view.x>=frame.x-.5&&view.x+view.width<=frame.x+frame.width+.5&&view.y>=frame.y-.5&&view.y+view.height<=frame.y+frame.height+.5;
    assert.equal(actual.contained,contained,'Inspection containment contradicts measured rectangles');
    const after=page(await step('page-after-inspection',pageState));
    assert.deepEqual(after.selection,baselinePage.selection,'Bootstrap changed actual raw selection');
    const value={index,before,request,execution:result.execution,actual,after};
    record('chrome-bootstrap-inspection',value);return actual;
  }
  let measured=await snapshot(0);
  const target=await step('own-page-target',getTargetInfo);assert.equal(target.type,'page');assert.equal(target.url,config.fixtureUrl);assert.equal(target.title,config.title);
  assert.ok(typeof target.targetId==='string'&&target.targetId.length>0);
  const ownWindow=await step('own-target-window',()=>windowCommand('Browser.getWindowForTarget',{targetId:target.targetId}));
  assert.ok(Number.isSafeInteger(ownWindow.windowId)&&ownWindow.windowId>0);bounds(ownWindow.bounds);
  let adjustments=0;
  while(!measured.contained&&adjustments<3){
    const frame=measured.axWindow,view=measured.axViewport;
    assert.ok(view.x>=frame.x-.5&&view.y>=frame.y-.5,'Left/top AX spill cannot use size-only bootstrap');
    const right=Math.max(0,view.x+view.width-frame.x-frame.width),bottom=Math.max(0,view.y+view.height-frame.y-frame.height);
    const widthIncrement=Math.ceil(right),heightIncrement=Math.ceil(bottom);assert.ok(widthIncrement>0||heightIncrement>0,'No measured positive spill; no blind resize');
    const before=bounds((await step('own-window-bounds-before',()=>windowCommand('Browser.getWindowBounds',{windowId:ownWindow.windowId}))).bounds);
    const requested={width:before.width+widthIncrement,height:before.height+heightIncrement};
    assert.ok(Number.isSafeInteger(requested.width)&&Number.isSafeInteger(requested.height),'Measured resize overflows bounds');
    const currentTarget=await step('own-page-target-before-resize',getTargetInfo);
    assert.equal(currentTarget.type,'page');assert.equal(currentTarget.targetId,target.targetId,'Own page target changed before resize');
    assert.equal(currentTarget.url,config.fixtureUrl);assert.equal(currentTarget.title,config.title);
    const currentWindow=await step('own-target-window-before-resize',()=>windowCommand('Browser.getWindowForTarget',{targetId:currentTarget.targetId}));
    assert.equal(currentWindow.windowId,ownWindow.windowId,'Own page moved to a different window before resize');
    assert.deepEqual(bounds(currentWindow.bounds),before,'Own window bounds changed before measured resize');
    const currentPage=page(await step('page-before-resize',pageState));
    assert.deepEqual(currentPage.selection,baselinePage.selection,'Bootstrap changed actual raw selection before resize');
    await step('own-window-measured-resize',()=>windowCommand('Browser.setWindowBounds',{windowId:ownWindow.windowId,bounds:requested}));
    await step('passive-window-settlement',()=>delay(100));
    const after=bounds((await step('own-window-bounds-after',()=>windowCommand('Browser.getWindowBounds',{windowId:ownWindow.windowId}))).bounds);
    assert.equal(after.left,before.left,'Bootstrap moved own window origin');assert.equal(after.top,before.top,'Bootstrap moved own window origin');
    record('chrome-bootstrap-resize',{round:++adjustments,measuredRightSpill:right,measuredBottomSpill:bottom,widthIncrement,heightIncrement,before,requested,after});
    measured=await snapshot(adjustments);
  }
  assert.equal(measured.contained,true,'Strict AX viewport guard still refuses after at most3 measured adjustments');
  const result={status:'prepared',ownBrowserPid:ownPid,windowId:ownWindow.windowId,adjustments,maximumMs,elapsedMs:clock()-began,
    authority:'Bootstrap geometry only; later input requires a new page and strict AX guard',measurement:measured};
  record('chrome-bootstrap-completed',result);return result;
}
