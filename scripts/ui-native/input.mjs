// SPDX-License-Identifier: MIT OR Apache-2.0
// Same strict AX/System Events ownership model as composition41, separate42 API.
import assert from 'node:assert/strict';
import {caseIds,caseActions,keySpecs,pointerTargets,limits} from './protocol.mjs';
export {prepareChromeWindow} from './chrome-bootstrap.mjs';
const requireFixture=`on requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
 tell application "System Events"
  set ownedProcesses to (application processes whose unix id is expectedPID)
  if (count of ownedProcesses) is not 1 then error "Exact fixture PID unavailable"
  tell item 1 of ownedProcesses
   if name is not expectedName or bundle identifier is not expectedBundle then error "Fixture identity changed"
   if frontmost is not true then error "Fixture is not frontmost"
   if (count of windows) is greater than 32 then error "Fixture window bound"
   if (count of (windows whose name is expectedTitle)) is not 1 then error "Fixture title not unique"
   if (name of front window) is not expectedTitle then error "Fixture title not frontmost"
   if (value of attribute "AXTitle" of (value of attribute "AXFocusedWindow")) is not expectedTitle then error "Fixture title not focused"
  end tell
 end tell
end requireFixture
`;
const findPostGuardDiagnostic=`on boundedDiagnosticText(observedValue, characterLimit)
 set observedText to observedValue as text
 if (length of observedText) is greater than characterLimit then return (text 1 thru characterLimit of observedText) & "...[truncated]"
 return observedText
end boundedDiagnosticText
on logFindPostGuardWindows(expectedPID, expectedName, expectedBundle)
 tell application "System Events"
  set ownedProcesses to (application processes whose unix id is expectedPID)
  if (count of ownedProcesses) is not 1 then error "Diagnostic exact fixture PID unavailable"
  tell item 1 of ownedProcesses
   if name is not expectedName or bundle identifier is not expectedBundle then error "Diagnostic fixture identity changed"
   set ownedCount to count of windows
   log {"UI42 find POST guard diagnostic", expectedPID, expectedName, expectedBundle, "frontmost", frontmost, "windowCount", ownedCount, "windowCap", 32, "titleCap", 96}
   if ownedCount is greater than 32 then error "Diagnostic fixture window bound"
   try
    set focusedTitle to my boundedDiagnosticText(value of attribute "AXTitle" of (value of attribute "AXFocusedWindow"), 96)
    log {"focusedWindowTitle", focusedTitle}
   on error
    log {"focusedWindowTitle", "[unavailable]"}
   end try
   repeat with ownedIndex from 1 to ownedCount
    set ownedWindow to window ownedIndex
    set observedName to "[unavailable]"
    set observedPosition to "[unavailable]"
    set observedSize to "[unavailable]"
    set observedRole to "[unavailable]"
    set observedSubrole to "[unavailable]"
    try
     set observedName to my boundedDiagnosticText(name of ownedWindow, 96)
    end try
    try
     set observedPosition to position of ownedWindow
    end try
    try
     set observedSize to size of ownedWindow
    end try
    try
     set observedRole to my boundedDiagnosticText(value of attribute "AXRole" of ownedWindow, 48)
    end try
    try
     set observedSubrole to my boundedDiagnosticText(value of attribute "AXSubrole" of ownedWindow, 48)
    end try
    log {"window", ownedIndex, "name", observedName, "position", observedPosition, "size", observedSize, "role", observedRole, "subrole", observedSubrole}
   end repeat
  end tell
 end tell
end logFindPostGuardWindows
`;
const chromeFindPresentation=`on requireFindRootTitle(expectedTitle)
 set rootPrefix to "KlenWriter UI native "
 set rootSuffix to " - Google Chrome"
 if (length of expectedTitle) is not ((length of rootPrefix) + 32 + (length of rootSuffix)) then error "Closed Chrome Find title length differs"
 if expectedTitle does not start with rootPrefix or expectedTitle does not end with rootSuffix then error "Closed Chrome Find title differs"
 set nonceText to text ((length of rootPrefix) + 1) thru ((length of rootPrefix) + 32) of expectedTitle
 repeat with nonceCharacter in characters of nonceText
  if "0123456789abcdef" does not contain (nonceCharacter as text) then error "Closed Chrome Find nonce differs"
 end repeat
 return text 1 thru ((length of expectedTitle) - (length of rootSuffix)) of expectedTitle
end requireFindRootTitle
on requireFiniteFindFrame(frameValues)
 if (count of frameValues) is not 4 then error "Closed Chrome Find frame differs"
 repeat with frameValue in frameValues
  set finiteValue to frameValue as real
  if (finiteValue - finiteValue) is not 0 then error "Nonfinite Chrome Find frame"
 end repeat
 if (item 3 of frameValues) is less than or equal to 0 or (item 4 of frameValues) is less than or equal to 0 then error "Nonpositive Chrome Find frame"
 set rightEdge to (item 1 of frameValues) + (item 3 of frameValues)
 set bottomEdge to (item 2 of frameValues) + (item 4 of frameValues)
 if (rightEdge - rightEdge) is not 0 or (bottomEdge - bottomEdge) is not 0 then error "Nonfinite Chrome Find edges"
 return frameValues
end requireFiniteFindFrame
on findFrameOf(ownedWindow)
 tell application "System Events"
  set observedPosition to position of ownedWindow
  set observedSize to size of ownedWindow
 end tell
 if (count of observedPosition) is not 2 or (count of observedSize) is not 2 then error "Chrome Find frame pair differs"
 return my requireFiniteFindFrame({(item 1 of observedPosition) as real, (item 2 of observedPosition) as real, (item 1 of observedSize) as real, (item 2 of observedSize) as real})
end findFrameOf
on requireChromeFindFixture(expectedPID, expectedName, expectedBundle, expectedTitle, expectedFrame, auxiliaryTitle, allowClosed)
 log "OSR42-AS8 GUARD begin"
 tell application "System Events"
  set ownedProcesses to (application processes whose unix id is expectedPID)
  if (count of ownedProcesses) is not 1 then error "Exact Chrome Find PID unavailable"
  tell item 1 of ownedProcesses
   if name is not expectedName or bundle identifier is not expectedBundle or expectedName is not "Google Chrome" or expectedBundle is not "com.google.Chrome" then error "Original Chrome Find identity changed"
   if frontmost is not true then error "Original Chrome Find is not frontmost"
   log "OSR42-AS8 GUARD identity ok"
   set ownedCount to count of windows
   if ownedCount is not 2 and (allowClosed is not true or ownedCount is not 1) then error "Closed Chrome Find window count differs"
   set matchingRoots to (windows whose name is expectedTitle)
   if (count of matchingRoots) is not 1 then error "Original Chrome Find root is not unique"
   set rootWindow to item 1 of matchingRoots
   log "OSR42-AS8 GUARD root located"
   if (role of rootWindow) is not "AXWindow" or (subrole of rootWindow) is not "AXStandardWindow" then error "Original Chrome Find root role differs"
   if (my findFrameOf(rootWindow)) is not expectedFrame then error "Original Chrome Find root frame changed"
   log "OSR42-AS8 GUARD root frame ok"
   set focusedRoot to value of attribute "AXFocusedWindow"
   if focusedRoot is not rootWindow then error "Original Chrome Find focused object differs"
   if (value of attribute "AXTitle" of focusedRoot) is not expectedTitle then error "Fixture title not focused"
   log "OSR42-AS8 GUARD focus ok"
   if ownedCount is 1 then
    set frontRoot to front window
    if frontRoot is not rootWindow or (name of frontRoot) is not expectedTitle then error "Closed Chrome Find root is not frontmost"
    set measuredPhase to "closed"
   else
    set matchingAuxiliaries to (windows whose name is auxiliaryTitle)
    if (count of matchingAuxiliaries) is not 1 then error "Exact Chrome Find auxiliary is not unique"
    set auxiliaryWindow to item 1 of matchingAuxiliaries
    if auxiliaryWindow is rootWindow then error "Chrome Find auxiliary is not distinct"
    if (front window) is not auxiliaryWindow then error "Exact Chrome Find auxiliary is not frontmost"
    if (role of auxiliaryWindow) is not "AXWindow" or (subrole of auxiliaryWindow) is not "AXUnknown" then error "Exact Chrome Find auxiliary role differs"
    set auxiliaryFrame to my findFrameOf(auxiliaryWindow)
    if (item 1 of auxiliaryFrame) is less than (item 1 of expectedFrame) or (item 2 of auxiliaryFrame) is less than (item 2 of expectedFrame) or ((item 1 of auxiliaryFrame) + (item 3 of auxiliaryFrame)) is greater than ((item 1 of expectedFrame) + (item 3 of expectedFrame)) or ((item 2 of auxiliaryFrame) + (item 4 of auxiliaryFrame)) is greater than ((item 2 of expectedFrame) + (item 4 of expectedFrame)) then error "Exact Chrome Find auxiliary is outside original root"
    set measuredPhase to "open"
   end if
   log "OSR42-AS8 GUARD topology ok"
   log "OSR42-AS8 GUARD final begin"
   if (count of windows) is not ownedCount or frontmost is not true then error "Chrome Find topology changed during guard"
   if (value of attribute "AXFocusedWindow") is not rootWindow or (name of rootWindow) is not expectedTitle or (my findFrameOf(rootWindow)) is not expectedFrame then error "Original Chrome Find root changed during guard"
   log "OSR42-AS8 GUARD final end"
  end tell
 end tell
 return measuredPhase
end requireChromeFindFixture
`;
const appleString=value=>'"'+value.replaceAll('\\','\\\\').replaceAll('"','\\"')+'"';
const branches=Object.entries(keySpecs).flatMap(([action,spec])=>[false,true].map(cleanup=>{
  const actual=(cleanup?'release-':'')+action;
  const transitions=cleanup?[...spec.modifiers.map(m=>m+'-up'),`key${spec.code}-up`]:[...spec.modifiers.map(m=>m+'-down'),`key${spec.code}-down`,`key${spec.code}-up`,...spec.modifiers.toReversed().map(m=>m+'-up')];
  const lines=cleanup?[...spec.modifiers.map(m=>`key up ${m}`),`key up ${spec.code}`]:[...spec.modifiers.map(m=>`key down ${m}`),`key down ${spec.code}`,`key up ${spec.code}`,...spec.modifiers.toReversed().map(m=>`key up ${m}`)];
  const prefix=JSON.stringify({status:cleanup?'keys-released':'key-sent',action:actual,keyCode:spec.code,modifiers:spec.modifiers,keyTransitions:transitions}).slice(0,-1)+',"frontPid":';
  const postGuard=actual==='find'?`try
  my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
 on error originalMessage number originalNumber
  try
   my logFindPostGuardWindows(expectedPID, expectedName, expectedBundle)
  on error diagnosticMessage number diagnosticNumber
   set ignoredDiagnosticNumber to diagnosticNumber
  end try
  error originalMessage number originalNumber
 end try`:'my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)';
  const isFindAction=['find','close-find','release-find','release-close-find'].includes(actual);
  const phaseCheck=actual==='find'?'if nativeFindPhase is not "open" then error "Native Find did not open"':actual==='close-find'?'if nativeFindPhase is not "closed" then error "Native Find did not close"':'';
  const findPost=isFindAction?`if findPresentationEnabled then
  log "OSR42-AS8 POST begin"
  set nativeFindPhase to my requireChromeFindFixture(expectedPID, expectedName, expectedBundle, expectedTitle, originalFindFrame, originalFindAuxiliaryTitle, ${actual==='find'?'false':'true'})
  ${phaseCheck}
  log "OSR42-AS8 POST end"
  return ${appleString(prefix)} & expectedPID & ${appleString(',"nativeFindPhase":"')} & nativeFindPhase & ${appleString('"}')}
 end if
 `:'';
  // Allow Safari's Tab presentation to settle after the single complete key
  // program. The original final ownership check and total1s deadline still apply.
  const safariTabSettle=actual==='tab'?'if expectedBrowser is "safari" then delay 0.2\n ':'';
  return `if fixtureAction is "${actual}" then\n if findPresentationEnabled then log "OSR42-AS8 KEYS begin"\n tell application "System Events"\n  ${lines.join('\n  ')}\n end tell\n if findPresentationEnabled then log "OSR42-AS8 KEYS end"\n ${findPost}${safariTabSettle}${postGuard}\n return "${prefix.replaceAll('\\','\\\\').replaceAll('"','\\"')}" & expectedPID & "}"\nend if`;
})).join('\n');
export const fixedKeyScript=requireFixture+findPostGuardDiagnostic+chromeFindPresentation+`on run argv
 if (count of argv) is not 4 and (count of argv) is not 8 then error "Closed UI42 key arguments required"
 set findPresentationEnabled to ((count of argv) is 8)
 set expectedBrowser to item 1 of argv
 set expectedTitle to item 2 of argv
 set expectedPID to (item 3 of argv) as integer
 set fixtureAction to item 4 of argv
 if expectedPID is less than 1 then error "Invalid fixture PID"
 if expectedBrowser is "chrome" then
  set expectedName to "Google Chrome"
  set expectedBundle to "com.google.Chrome"
 else if expectedBrowser is "safari" then
  set expectedName to "Safari"
  set expectedBundle to "com.apple.Safari"
 else
  error "Unknown closed fixture browser"
 end if
 if findPresentationEnabled then
  if expectedBrowser is not "chrome" or fixtureAction is not in {"find", "close-find", "release-find", "release-close-find"} then error "Closed Chrome Find arguments required"
  set originalFindFrame to my requireFiniteFindFrame({(item 5 of argv) as real, (item 6 of argv) as real, (item 7 of argv) as real, (item 8 of argv) as real})
  set originalFindPageTitle to my requireFindRootTitle(expectedTitle)
  set originalFindAuxiliaryTitle to "Find in page" & linefeed & "    " & originalFindPageTitle
  log "OSR42-AS8 PRE begin"
  if fixtureAction is "find" then
   if (my requireChromeFindFixture(expectedPID, expectedName, expectedBundle, expectedTitle, originalFindFrame, originalFindAuxiliaryTitle, true)) is not "closed" then error "Native Find precondition is not closed"
  else if fixtureAction is "close-find" then
   if (my requireChromeFindFixture(expectedPID, expectedName, expectedBundle, expectedTitle, originalFindFrame, originalFindAuxiliaryTitle, false)) is not "open" then error "Native Find close precondition is not open"
  else
   set cleanupFindPhase to my requireChromeFindFixture(expectedPID, expectedName, expectedBundle, expectedTitle, originalFindFrame, originalFindAuxiliaryTitle, true)
  end if
  log "OSR42-AS8 PRE end"
 else
  my requireFixture(expectedPID, expectedName, expectedBundle, expectedTitle)
 end if
 ${branches}
 error "Unknown closed UI42 key"
end run
`;
export function createInputOwner({browser,config,inputHelper,keyScriptPath,run,record,guard,cleanupGuard,mountedId,nativeFindEpisode,nativeFindKeyTransport,findKeyHelper,nativeZoomKeyTransport}){
  assert.ok(['chrome','safari'].includes(browser));assert.match(config.nonce,/^[a-f0-9]{32}$/);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');assert.equal(config.title,'KlenWriter UI native '+config.nonce);
  let disabled=false,serial=0,pending=null,cleanupUsed=false,baselineWindow=null;
  const nativeFind=nativeFindEpisode==='chrome-fd01';
  assert.ok(nativeFindEpisode===undefined||nativeFind&&browser==='chrome','Closed Chrome Find option only');
  if(nativeFind){assert.equal(config.nonce.length,32);assert.equal(Buffer.byteLength(config.nonce,'utf8'),32);assert.ok(!/[^a-f0-9]/.test(config.nonce));}
  const nativeFindCg=nativeFindKeyTransport==='cg-fd02';
  assert.ok(nativeFindKeyTransport===undefined||nativeFindCg&&nativeFind&&browser==='chrome','Closed Chrome Find CG transport only');
  const nativeZoomCg=nativeZoomKeyTransport==='cg-zoom01';
  assert.ok(nativeZoomKeyTransport===undefined||nativeZoomCg&&browser==='chrome','Closed Chrome Zoom CG transport only');
  if(nativeZoomCg){assert.equal(config.nonce.length,32);assert.equal(Buffer.byteLength(config.nonce,'utf8'),32);assert.ok(!/[^a-f0-9]/.test(config.nonce));}
  assert.ok((nativeFindCg||nativeZoomCg)?typeof findKeyHelper==='string'&&findKeyHelper.startsWith('/')&&findKeyHelper.length<=4096&&!findKeyHelper.includes('\0'):findKeyHelper===undefined,'CG transport requires its fixed helper path');
  let findEpisode=null,findBusy=false,findEpoch=0;
  function whole(value,pattern){assert.equal(typeof value,'string');const match=pattern.exec(value);assert.ok(match&&match[0]===value,'Exact private Find identifier required');}
  const findKeys=['format','status','delivery','measurement','purpose','browser','nonce','title','fixtureUrl','mountedId','caseId','findRequestId','requestId','serial','frontPid','frontBundle','expectedAxWindowTitle','observedAxWindowTitle','axWindowCount','axWindow','rootFocused','rootRole','rootSubrole','findAux','contained','elapsedMs','nativeFindPhase'];
  function exactKeys(value,keys){assert.ok(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),[...keys].sort());}
  function frame(value){exactKeys(value,['x','y','width','height']);assert.ok(Object.values(value).every(Number.isFinite)&&value.width>0&&value.height>0&&Number.isFinite(value.x+value.width)&&Number.isFinite(value.y+value.height));return {...value};}
  function retireFind(reason){const old=findEpisode;findEpisode=null;findEpoch++;if(old)record('owned-find-retired',{reason,findRequestId:old.findRequestId,mountedId:old.mountedId,caseId:old.caseId,state:old.state});}
  function syncFindMount(){if(findEpisode&&findEpisode.mountedId!==mountedId())retireFind('mount-changed');}
  function sameFind(ep){assert.ok(ep&&ep===findEpisode,'Genuine private Find episode required');assert.equal(ep.mountedId,mountedId(),'Original Find mount changed');assert.equal(ep.caseId,'modes-zoom');assert.equal(ep.nonce,config.nonce);assert.equal(ep.title,config.title);}
  function pageFind(proof,action,cleanup=false,ep=null){
    const v=proof.value;assert.equal(typeof proof.start,'bigint');whole(proof.id,new RegExp('^'+config.nonce+':[1-9][0-9]{0,3}$'));whole(mountedId(),/^ui42-[1-9][0-9]{0,8}$/);
    for(const [name,value]of Object.entries({nonce:config.nonce,url:config.fixtureUrl,title:config.title,id:mountedId(),mountedId:mountedId(),caseId:'modes-zoom',action,target:'focused',allowed:true,editorConnected:true,pointerDown:false}))assert.equal(v[name],value);
    assert.equal(v.point,null);assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial&&v.serial<=2048);serial=v.serial;
    assert.ok(cleanup?v.releaseOnly===true:v.documentFocused===true||action==='close-find'&&v.documentFocused===false);
    assert.ok(Math.abs(v.zoomEvidence.dprRatio-1)<.01||Math.abs(v.zoomEvidence.dprRatio-v.viewport.pageZoom)<.01);
    exactKeys(v.viewport,['width','height','scale','offsetLeft','offsetTop','pageZoom']);const z=v.viewport;
    assert.ok(Number.isFinite(z.width)&&Number.isFinite(z.height)&&Number.isFinite(z.pageZoom)&&z.width>0&&z.width<=1024&&z.height>0&&z.height<=768&&z.pageZoom>=1&&z.pageZoom<=2&&Math.abs(z.width*z.pageZoom-1024)<=2&&z.height*z.pageZoom>=480&&z.height*z.pageZoom<=770&&z.scale===1&&z.offsetLeft===0&&z.offsetTop===0);
    if(ep){sameFind(ep);assert.equal(v.id,ep.mountedId);assert.equal(v.caseId,ep.caseId);}return v;
  }
  function remainingFind(proof){const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0,'Find guard deadline exhausted');return remaining;}
  function findWindow(ep,proof,purpose){
    sameFind(ep);const remaining=remainingFind(proof),mode=['post-find','screenshot'].includes(purpose)?'--inspect-find-window':'--guard-find-key';
    const request={format:'osr42-chrome-find-window/1',browser:'chrome',nonce:ep.nonce,title:ep.title,fixtureUrl:config.fixtureUrl,mountedId:ep.mountedId,caseId:ep.caseId,findRequestId:ep.findRequestId,requestId:proof.id,serial:proof.value.serial,pid:ep.pid,rootFrame:{...ep.rootFrame},purpose,deadlineMs:remaining};
    assert.ok(Buffer.byteLength(JSON.stringify(request))<=4096);const execution=run(inputHelper,[mode,JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768}),actual=JSON.parse(execution.stdout);
    exactKeys(actual,findKeys);
    for(const [name,value]of Object.entries({format:request.format,status:mode==='--inspect-find-window'?'inspected':'guarded',delivery:'not_sent',measurement:'native-find-window-only',purpose,browser:'chrome',nonce:ep.nonce,title:ep.title,fixtureUrl:config.fixtureUrl,mountedId:ep.mountedId,caseId:ep.caseId,findRequestId:ep.findRequestId,requestId:proof.id,serial:proof.value.serial,frontPid:ep.pid,frontBundle:'com.google.Chrome',expectedAxWindowTitle:ep.title+' - Google Chrome',observedAxWindowTitle:ep.title+' - Google Chrome',rootFocused:true,rootRole:'AXWindow',rootSubrole:'AXStandardWindow',contained:true}))assert.equal(actual[name],value,'Find proof '+name);
    assert.deepEqual(frame(actual.axWindow),ep.rootFrame,'Original Find root frame changed');assert.ok(Number.isFinite(actual.elapsedMs)&&actual.elapsedMs>=0&&actual.elapsedMs<=remaining);
    if(actual.nativeFindPhase==='open'){
      assert.equal(actual.axWindowCount,2);exactKeys(actual.findAux,['title','role','subrole','frame']);assert.equal(actual.findAux.title,'Find in page\n    '+ep.title);assert.equal(actual.findAux.role,'AXWindow');assert.equal(actual.findAux.subrole,'AXUnknown');const a=frame(actual.findAux.frame),r=ep.rootFrame;assert.ok(a.x>=r.x&&a.y>=r.y&&a.x+a.width<=r.x+r.width&&a.y+a.height<=r.y+r.height,'Find aux must be entirely contained');
    }else{assert.ok(['release-find','release-close-find'].includes(purpose));assert.equal(actual.nativeFindPhase,'closed');assert.equal(actual.axWindowCount,1);assert.equal(actual.findAux,null);}
    sameFind(ep);remainingFind(proof);return {request,actual,execution};
  }
  function coreFindAck(actual,action,cleanup,ep){
    const key=keySpecs[action];assert.equal(actual.action,(cleanup?'release-':'')+action);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,key.code);assert.deepEqual(actual.modifiers,key.modifiers);assert.equal(actual.frontPid,ep.pid);
    assert.deepEqual(actual.keyTransitions,cleanup?[...key.modifiers.map(m=>m+'-up'),`key${key.code}-up`]:[...key.modifiers.map(m=>m+'-down'),`key${key.code}-down`,`key${key.code}-up`,...key.modifiers.toReversed().map(m=>m+'-up')]);
  }
  const cgPrograms={
    find:[{keyCode:55,down:true,flags:'command'},{keyCode:3,down:true,flags:'command'},{keyCode:3,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
    'close-find':[{keyCode:53,down:true,flags:'none'},{keyCode:53,down:false,flags:'none'}],
    'release-find':[{keyCode:55,down:false,flags:'none'},{keyCode:3,down:false,flags:'none'}],
    'release-close-find':[{keyCode:53,down:false,flags:'none'}],
  };
  function cgDiagnostic(value){if(value===null)return;exactKeys(value,['code','reason']);assert.equal(typeof value.code,'string');assert.ok(value.code.length>0&&Buffer.byteLength(value.code)<=128);assert.equal(typeof value.reason,'string');assert.ok(Buffer.byteLength(value.reason)<=512);}
  function cgWindowProof(value,ep){
    exactKeys(value,['frontPid','frontName','frontBundle','rootTitle','rootRole','rootSubrole','rootFrame','rootFocused','phase','windowCount','findAux','contained']);
    for(const [k,v]of Object.entries({frontPid:ep.pid,frontName:'Google Chrome',frontBundle:'com.google.Chrome',rootTitle:ep.title+' - Google Chrome',rootRole:'AXWindow',rootSubrole:'AXStandardWindow',rootFocused:true,contained:true}))assert.equal(value[k],v,'CG ownership '+k);
    assert.deepEqual(frame(value.rootFrame),ep.rootFrame);assert.ok(['open','closed'].includes(value.phase));
    if(value.phase==='closed'){assert.equal(value.windowCount,1);assert.equal(value.findAux,null);}
    else{assert.equal(value.windowCount,2);exactKeys(value.findAux,['title','role','subrole','frame']);assert.equal(value.findAux.title,'Find in page\n    '+ep.title);assert.equal(value.findAux.role,'AXWindow');assert.equal(value.findAux.subrole,'AXUnknown');const a=frame(value.findAux.frame),r=ep.rootFrame;assert.ok(a.x>=r.x&&a.y>=r.y&&a.x+a.width<=r.x+r.width&&a.y+a.height<=r.y+r.height);}
    return value.phase;
  }
  function cgEnvelope(value,request,ep){
    exactKeys(value,['format','status','delivery','method','request','programId','program','postedTransitions','postedCount','preflightProofs','core','postcondition','diagnostic','elapsedMs']);
    assert.equal(value.format,'osr42-chrome-find-key-result/1');assert.equal(value.method,'CGEvent/cghidEventTap');assert.deepEqual(value.request,request);
    const id=(request.cleanupOnly?'release-':'')+request.action,program=cgPrograms[id];assert.equal(value.programId,id);assert.deepEqual(value.program,program);
    assert.ok(Number.isSafeInteger(value.postedCount)&&value.postedCount>=0&&value.postedCount<=program.length);assert.deepEqual(value.postedTransitions,program.slice(0,value.postedCount));
    assert.ok(Array.isArray(value.preflightProofs));assert.equal(value.preflightProofs.length,value.postedCount);
    for(const [index,proof]of value.preflightProofs.entries()){const phase=cgWindowProof(proof,ep);if(index===0&&!request.cleanupOnly)assert.equal(phase,request.action==='find'?'closed':'open');}
    assert.ok(Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0);cgDiagnostic(value.diagnostic);return program;
  }
  function cgPostcondition(value,request,ep){
    exactKeys(value,['status','expectedPhase','observedPhase','reads','proof','diagnostic']);cgDiagnostic(value.diagnostic);
    const expected=request.cleanupOnly?'either':request.action==='find'?'open':'closed';assert.equal(value.expectedPhase,expected);
    assert.ok(['verified','unobserved','refused','not_attempted'].includes(value.status));assert.ok(['open','closed',null].includes(value.observedPhase));assert.ok(Number.isSafeInteger(value.reads)&&value.reads>=0&&value.reads<=12);
    if(value.proof!==null){const phase=cgWindowProof(value.proof,ep);assert.equal(phase,value.observedPhase);assert.ok(value.reads>0);}
    if(value.status==='not_attempted'){assert.equal(value.reads,0);assert.equal(value.proof,null);assert.equal(value.observedPhase,null);return null;}
    assert.equal(value.status,'verified','CG Find final phase '+value.status);assert.ok(value.reads>0);assert.ok(value.proof);assert.ok(expected==='either'||value.observedPhase===expected);return value.observedPhase;
  }
  const zoomPrograms={
    'zoom-in':[{keyCode:55,down:true,flags:'command'},{keyCode:56,down:true,flags:'command+shift'},{keyCode:24,down:true,flags:'command+shift'},{keyCode:24,down:false,flags:'command+shift'},{keyCode:56,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
    'zoom-reset':[{keyCode:55,down:true,flags:'command'},{keyCode:29,down:true,flags:'command'},{keyCode:29,down:false,flags:'command'},{keyCode:55,down:false,flags:'none'}],
    'release-zoom-in':[{keyCode:55,down:false,flags:'none'},{keyCode:56,down:false,flags:'none'},{keyCode:24,down:false,flags:'none'}],
    'release-zoom-reset':[{keyCode:55,down:false,flags:'none'},{keyCode:29,down:false,flags:'none'}],
  };
  function zoomGeometry(actual,request){
    const r=frame(actual.axWindow),v=frame(actual.axViewport);assert.deepEqual(r,request.originalRootFrame);
    assert.ok(v.x>=r.x-.5&&v.y>=r.y-.5&&v.x+v.width<=r.x+r.width+.5&&v.y+v.height<=r.y+r.height+.5);
    assert.ok(Math.abs(v.width-request.viewport.width*request.viewport.pageZoom)<=2&&Math.abs(v.height-request.viewport.height*request.viewport.pageZoom)<=2);
    assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);
  }
  function zoomOrdinaryProof(actual,request,pid,rootFrame){
    for(const [name,value]of Object.entries({status:'guarded',delivery:'not_sent',cleanupOnly:request.cleanupOnly,frontBundle:'com.google.Chrome',frontPid:pid,expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',action:request.action,requestId:request.requestId,nonce:config.nonce,mountedId:request.mountedId,caseId:'modes-zoom',target:'focused'}))assert.equal(actual[name],value,'Zoom ordinary proof '+name);
    zoomGeometry(actual,{...request,originalRootFrame:rootFrame});fixedWindow(actual.axWindow);
  }
  function zoomEnvelope(value,request){
    exactKeys(value,['format','status','delivery','method','request','programId','program','postedTransitions','postedCount','preflightProofs','core','diagnostic','elapsedMs']);
    assert.equal(value.format,'osr42-chrome-zoom-key-result/1');assert.equal(value.method,'CGEvent/cghidEventTap');assert.deepEqual(value.request,request);
    const id=(request.cleanupOnly?'release-':'')+request.action,program=zoomPrograms[id];assert.equal(value.programId,id);assert.deepEqual(value.program,program);
    assert.ok(Number.isSafeInteger(value.postedCount)&&value.postedCount>=0&&value.postedCount<=program.length);assert.deepEqual(value.postedTransitions,program.slice(0,value.postedCount));assert.ok(Array.isArray(value.preflightProofs));assert.equal(value.preflightProofs.length,value.postedCount);
    for(const p of value.preflightProofs){
      exactKeys(p,['frontPid','frontName','frontBundle','expectedAxWindowTitle','observedAxWindowTitle','axWindowCount','axMatchCount','axWindow','axViewport','contained','visitedNodes','maximumDepth','rootFocused']);
      for(const [k,v]of Object.entries({frontPid:request.originalPid,frontName:'Google Chrome',frontBundle:'com.google.Chrome',expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome',axMatchCount:1,contained:true,rootFocused:true}))assert.equal(p[k],v,'Zoom per-post proof '+k);
      assert.ok(Number.isSafeInteger(p.visitedNodes)&&p.visitedNodes>=1&&p.visitedNodes<=512);assert.ok(Number.isSafeInteger(p.maximumDepth)&&p.maximumDepth>=0&&p.maximumDepth<=32);zoomGeometry(p,request);
    }
    cgDiagnostic(value.diagnostic);assert.ok(Number.isFinite(value.elapsedMs)&&value.elapsedMs>=0);return program;
  }
  async function performZoom(action,cleanup){
    assert.equal(findBusy,false,'One private key operation at a time');if(!cleanup){assert.equal(disabled,false);assert.equal(findEpisode,null,'Zoom cannot use an active Find episode');}
    findBusy=true;let proof=null,preflight=null,execution=null,postflight=null,nativeZoomKeyResult=null,dispatched=false,completed=false,knownNotSent=false;
    try{
      const saved=cleanup?pending:null;if(cleanup){assert.ok(saved&&!saved.pointer&&!cleanupUsed);assert.equal(saved.action,action);cleanupUsed=true;}
      syncFindMount();const epoch=findEpoch;proof=await(cleanup?cleanupGuard(action):guard(action));assert.equal(findEpoch,epoch,'Zoom owner retired during page guard');const v=pageFind(proof,action,cleanup);
      if(cleanup){assert.equal(mountedId(),saved.mount);assert.equal(v.caseId,saved.caseId);}
      const original={format:'osr42-native-input/1',browser:'chrome',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial:v.serial,caseId:v.caseId,action,target:'focused',point:null,viewport:v.viewport,pointerDown:false,cleanupOnly:cleanup,deadlineMs:remainingFind(proof)};
      preflight=run(inputHelper,['--guard-key',JSON.stringify(original)],{timeout:original.deadlineMs,fullStdout:true,maxBuffer:32768});const strict=JSON.parse(preflight.stdout),pid=cleanup?saved.pid:strict.frontPid,rootFrame=cleanup?saved.rootFrame:frame(strict.axWindow);
      assert.ok(Number.isSafeInteger(pid)&&pid>0&&pid<=2147483647);zoomOrdinaryProof(strict,original,pid,rootFrame);assert.equal(findEpoch,epoch);assert.equal(original.mountedId,mountedId());
      const left=remainingFind(proof),request={...original,format:'osr42-chrome-zoom-key/1',deadlineMs:left,originalPid:pid,originalRootFrame:{...rootFrame}};assert.ok(Buffer.byteLength(JSON.stringify(request))<=4096);
      pending={action,pointer:false,pid,mount:mountedId(),caseId:v.caseId,rootFrame:{...rootFrame}};dispatched=true;
      try{execution=run(findKeyHelper,['--zoom-request',JSON.stringify(request)],{timeout:left,fullStdout:true,maxBuffer:32768});}catch(error){execution=error.execution??null;if(!execution?.stdout)throw error;}
      nativeZoomKeyResult=JSON.parse(execution.stdout);const program=zoomEnvelope(nativeZoomKeyResult,request);
      if(nativeZoomKeyResult.status==='completed'){
        assert.equal(nativeZoomKeyResult.delivery,'sent');assert.equal(nativeZoomKeyResult.postedCount,program.length);exactKeys(nativeZoomKeyResult.core,['status','action','keyCode','modifiers','keyTransitions','frontPid']);coreFindAck(nativeZoomKeyResult.core,action,cleanup,{pid});
        completed=true;pending=null; // Complete contextual core is known BEFORE time and fresh ordinary postproof.
        assert.equal(execution.returnCode,0);assert.ok(nativeZoomKeyResult.elapsedMs<=left);assert.equal(findEpoch,epoch);assert.equal(original.mountedId,mountedId());
        const postRequest={...original,deadlineMs:remainingFind(proof)};
        try{postflight=run(inputHelper,['--guard-key',JSON.stringify(postRequest)],{timeout:postRequest.deadlineMs,fullStdout:true,maxBuffer:32768});}catch(error){postflight=error.execution??null;throw error;}
        zoomOrdinaryProof(JSON.parse(postflight.stdout),postRequest,pid,rootFrame);assert.equal(findEpoch,epoch);assert.equal(original.mountedId,mountedId());remainingFind(proof);
        const value={action,delivery:'sent',actual:nativeZoomKeyResult.core,execution,pageGuard:v,keyGuard:strict,keyGuardExecution:preflight,postKeyGuardExecution:postflight,nativeZoomKeyResult,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
      }
      assert.equal(nativeZoomKeyResult.core,null);
      if(nativeZoomKeyResult.status==='refused'){assert.equal(nativeZoomKeyResult.delivery,'not_sent');assert.equal(nativeZoomKeyResult.postedCount,0);assert.equal(execution.returnCode,2);knownNotSent=true;if(!cleanup)pending=null;}
      else{assert.equal(nativeZoomKeyResult.status,'unknown');assert.equal(nativeZoomKeyResult.delivery,'unknown/may_have_sent');assert.ok(nativeZoomKeyResult.postedCount>0&&nativeZoomKeyResult.postedCount<program.length);}
      throw Error('CG Zoom program '+nativeZoomKeyResult.status+': '+(nativeZoomKeyResult.diagnostic?.code??'no diagnostic'));
    }catch(error){disabled=true;record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:false,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,postKeyGuardExecution:postflight,nativeZoomKeyResult,maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
    finally{findBusy=false;}
  }
  async function performFind(action,cleanup){
    assert.equal(findBusy,false,'One private Find operation at a time');
    // Merely denied normal use must not consume a prospective unknown key's UP.
    if(!cleanup){syncFindMount();assert.equal(disabled,false);if(action==='find')assert.equal(findEpisode,null,'Only one live Find episode');else assert.ok(findEpisode&&findEpisode.state==='accepted','Accepted Find episode required');}
    findBusy=true;let epoch=null,proof=null,preflight=null,execution=null,postflight=null,nativeFindKeyResult=null,dispatched=false,completed=false,knownNotSent=false;
    try{
      if(cleanup){assert.ok(pending&&!cleanupUsed&&!pending.pointer);assert.equal(action,pending.action);cleanupUsed=true;}
      syncFindMount();epoch=findEpoch;assert.ok(mountedId());
      if(cleanup)assert.ok(findEpisode,'Original prospective Find episode required');
      else if(action==='find')assert.equal(findEpisode,null,'Only one live Find episode');
      else assert.ok(findEpisode&&findEpisode.state==='accepted','Accepted Find episode required');
      let ep=findEpisode;proof=await(cleanup?cleanupGuard(action):guard(action));assert.equal(findEpoch,epoch,'Find owner retired during page guard');const v=pageFind(proof,action,cleanup,ep);
      if(action==='find'&&!cleanup){
        const request={format:'osr42-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial:v.serial,caseId:v.caseId,action,target:v.target,point:null,viewport:v.viewport,pointerDown:false,cleanupOnly:false,deadlineMs:remainingFind(proof)};
        const execution=run(inputHelper,['--guard-key',JSON.stringify(request)],{timeout:request.deadlineMs,fullStdout:true,maxBuffer:32768}),actual=JSON.parse(execution.stdout);preflight={request,execution,actual};
        for(const [name,value]of Object.entries({status:'guarded',delivery:'not_sent',cleanupOnly:false,frontBundle:'com.google.Chrome',action,requestId:proof.id,nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:'focused',expectedAxWindowTitle:config.title+' - Google Chrome',observedAxWindowTitle:config.title+' - Google Chrome'}))assert.equal(actual[name],value);
        assert.ok(Number.isSafeInteger(actual.frontPid)&&actual.frontPid>0);fixedWindow(actual.axWindow);assert.equal(findEpoch,epoch);assert.equal(findEpisode,null);
        ep={state:'prospective',pid:actual.frontPid,rootFrame:frame(actual.axWindow),nonce:config.nonce,title:config.title,mountedId:mountedId(),caseId:v.caseId,findRequestId:proof.id};findEpisode=ep;
        record('owned-find-prospective',{pid:ep.pid,rootFrame:ep.rootFrame,nonce:ep.nonce,title:ep.title,mountedId:ep.mountedId,caseId:ep.caseId,findRequestId:ep.findRequestId});
      }else{sameFind(ep);if(cleanup){assert.equal(ep.pid,pending.pid);assert.equal(ep.mountedId,pending.mount);assert.equal(ep.caseId,pending.caseId);}preflight=findWindow(ep,proof,cleanup?'release-'+action:'pre-close-find');}
      sameFind(ep);assert.equal(findEpoch,epoch);assert.ok(cleanup||!disabled);const left=remainingFind(proof);pending={action,pointer:false,pid:ep.pid,mount:ep.mountedId,caseId:ep.caseId};ep.state='prospective';dispatched=true;
      let actual;
      if(nativeFindCg){
        const request={format:'osr42-chrome-find-key/1',browser:'chrome',nonce:ep.nonce,title:ep.title,fixtureUrl:config.fixtureUrl,mountedId:ep.mountedId,caseId:ep.caseId,findRequestId:ep.findRequestId,requestId:proof.id,serial:proof.value.serial,pid:ep.pid,rootFrame:{...ep.rootFrame},purpose:'key',deadlineMs:left,action,cleanupOnly:cleanup};
        assert.ok(Buffer.byteLength(JSON.stringify(request))<=4096);
        try{execution=run(findKeyHelper,['--request',JSON.stringify(request)],{timeout:left,fullStdout:true,maxBuffer:32768});}
        catch(error){execution=error.execution??null;if(!execution?.stdout)throw error;}
        nativeFindKeyResult=JSON.parse(execution.stdout);const program=cgEnvelope(nativeFindKeyResult,request,ep);
        if(nativeFindKeyResult.status==='completed'){
          assert.equal(nativeFindKeyResult.delivery,'sent');assert.equal(nativeFindKeyResult.postedCount,program.length);exactKeys(nativeFindKeyResult.core,['status','action','keyCode','modifiers','keyTransitions','frontPid']);coreFindAck(nativeFindKeyResult.core,action,cleanup,ep);
          completed=true;pending=null; // Genuine full program/core is known complete BEFORE final phase/deadline checks.
          assert.equal(execution.returnCode,0);assert.ok(nativeFindKeyResult.elapsedMs<=left);sameFind(ep);assert.equal(findEpoch,epoch);remainingFind(proof);
          actual={...nativeFindKeyResult.core,nativeFindPhase:cgPostcondition(nativeFindKeyResult.postcondition,request,ep)};
        }else{
          assert.equal(nativeFindKeyResult.core,null);
          if(nativeFindKeyResult.status==='refused'){
            assert.equal(nativeFindKeyResult.delivery,'not_sent');assert.equal(nativeFindKeyResult.postedCount,0);assert.equal(execution.returnCode,2);knownNotSent=true;if(!cleanup)pending=null;
          }else{assert.equal(nativeFindKeyResult.status,'unknown');assert.equal(nativeFindKeyResult.delivery,'unknown/may_have_sent');assert.ok(nativeFindKeyResult.postedCount>0&&nativeFindKeyResult.postedCount<program.length);}
          assert.equal(nativeFindKeyResult.postcondition.status,'not_attempted');cgPostcondition(nativeFindKeyResult.postcondition,request,ep);
          throw Error('CG Find program '+nativeFindKeyResult.status+': '+(nativeFindKeyResult.diagnostic?.code??'no diagnostic'));
        }
      }else{
        execution=run('/usr/bin/osascript',[keyScriptPath,'chrome',ep.title+' - Google Chrome',String(ep.pid),(cleanup?'release-':'')+action,...['x','y','width','height'].map(k=>String(ep.rootFrame[k]))],{timeout:left,fullStdout:true,maxBuffer:32768});
        actual=JSON.parse(execution.stdout);coreFindAck(actual,action,cleanup,ep);completed=true;pending=null; // Actual original transitions are known complete before any new postcondition.
      }
      sameFind(ep);assert.equal(findEpoch,epoch);
      if(cleanup){assert.ok(['open','closed'].includes(actual.nativeFindPhase));remainingFind(proof);retireFind('owned-up-completed');}
      else if(action==='find'){assert.equal(actual.nativeFindPhase,'open');postflight=findWindow(ep,proof,'post-find');remainingFind(proof);ep.state='accepted';record('owned-find-accepted',{findRequestId:ep.findRequestId,mountedId:ep.mountedId,pid:ep.pid,proof:postflight.actual});}
      else{assert.equal(actual.nativeFindPhase,'closed');remainingFind(proof);retireFind('verified-close');}
      const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,keyGuard:preflight.actual,keyGuardExecution:preflight.execution,nativeFindWindow:postflight,...(nativeFindCg?{nativeFindKeyResult}:{}),maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
    }catch(error){disabled=true;if(completed||cleanup||!dispatched||knownNotSent)retireFind(completed?'known-completed-postcondition-failed':'find-proof-failed');record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:false,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight?.execution??error.execution??null,nativeFindWindow:postflight,...(nativeFindCg?{nativeFindKeyResult}:{}),maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
    finally{findBusy=false;}
  }
  async function captureFindWindow(path){
    assert.equal(nativeFind,true,'Chrome Find opt-in required');assert.equal(findBusy,false,'One private Find operation at a time');syncFindMount();assert.equal(disabled,false);assert.equal(pending,null);const ep=findEpisode;assert.ok(ep&&ep.state==='accepted','Accepted private Find episode required');assert.equal(typeof path,'string');assert.ok(path.length>0&&path.length<=4096&&!path.includes('\0'));
    findBusy=true;const epoch=findEpoch;let proof=null,inspection=null;
    try{
      proof=await guard('close-find');assert.equal(findEpoch,epoch);pageFind(proof,'close-find',false,ep);inspection=findWindow(ep,proof,'screenshot');sameFind(ep);const r=inspection.actual.axWindow,rect=[Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width),Math.ceil(r.height)];assert.ok(rect[2]>0&&rect[3]>0&&rect[2]<=4096&&rect[3]<=4096);
      const execution=run('/usr/sbin/screencapture',['-x','-R'+rect.join(','),path],{timeout:remainingFind(proof),fullStdout:true});sameFind(ep);assert.equal(findEpoch,epoch);remainingFind(proof);const value={path,scope:'Exact original owned root AX window rectangle containing the validated native Find auxiliary; window-only proof, no current viewport claim',measurement:'native-find-window-only',guardExecution:inspection.execution,actual:inspection.actual,execution,pageGuard:proof.value};record('owned-find-screenshot',value);return value;
    }catch(error){disabled=true;retireFind('screenshot-refused');record('owned-find-screenshot-failure',{error:error.message,inspection,requestId:proof?.id??null});throw error;}finally{findBusy=false;}
  }

  function fixedWindow(frame){assert.ok(frame&&['x','y','width','height'].every(key=>Number.isFinite(frame[key])));if(baselineWindow)assert.deepEqual(frame,baselineWindow,'Owned AX window changed during installed proof');else baselineWindow={...frame};}
  const clock=()=>process.hrtime.bigint(),age=start=>Number(clock()-start)/1e6;
  async function perform(action,cleanup=false){
    if(nativeZoomCg&&['zoom-in','zoom-reset'].includes(action))return performZoom(action,cleanup);
    if(nativeFind&&['find','close-find'].includes(action))return performFind(action,cleanup);
    if(nativeFind||nativeZoomCg)assert.equal(findBusy,false,'One private Find operation at a time');syncFindMount();let proof=null,preflight=null,execution=null,dispatched=false,completed=false;
    try {
      const key=keySpecs[action],pointer=pointerTargets[action];assert.ok(key||pointer);assert.ok(mountedId());
      assert.ok(cleanup?pending&&!cleanupUsed&&!pending.pointer:!disabled);if(cleanup){assert.equal(action,pending.action);cleanupUsed=true;}
      proof=await (cleanup?cleanupGuard(action):guard(action));const v=proof.value;
      assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.equal(v.nonce,config.nonce);assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);
      assert.equal(v.id,mountedId());assert.equal(v.mountedId,mountedId());assert.equal(v.action,action);assert.ok(caseIds.includes(v.caseId)&&caseActions[v.caseId].includes(action));assert.equal(v.allowed,true);
      if(cleanup){assert.equal(v.id,pending.mount);assert.equal(v.caseId,pending.caseId);}
      assert.ok(Math.abs(v.zoomEvidence.dprRatio-1)<.01||Math.abs(v.zoomEvidence.dprRatio-v.viewport.pageZoom)<.01,'Unexpected hardware/DPR transition during fixed-window zoom');
      assert.ok(cleanup?v.releaseOnly===true:v.documentFocused===true||action==='close-find'&&v.documentFocused===false);assert.equal(v.editorConnected,true);assert.equal(v.target,pointer??'focused');assert.equal(v.pointerDown,false);
      assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0,'Fresh42 page guard expired');
      const request={format:'osr42-native-input/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,mountedId:mountedId(),requestId:proof.id,serial,caseId:v.caseId,action,target:v.target,point:v.point,viewport:v.viewport,pointerDown:false,cleanupOnly:cleanup,deadlineMs:remaining};
      if(key){
        preflight=run(inputHelper,['--guard-key',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const strict=JSON.parse(preflight.stdout);
        assert.equal(strict.status,'guarded');assert.equal(strict.delivery,'not_sent');assert.equal(strict.cleanupOnly,cleanup);assert.equal(strict.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');
        fixedWindow(strict.axWindow);
        if(cleanup)assert.equal(strict.frontPid,pending.pid);
        for(const [name,value]of Object.entries({action,requestId:proof.id,nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(strict[name],value);
        const left=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(left>0,'AX guard consumed deadline');pending={action,pointer:false,pid:strict.frontPid,mount:mountedId(),caseId:v.caseId};dispatched=true;
        execution=run('/usr/bin/osascript',[keyScriptPath,browser,strict.expectedAxWindowTitle,String(strict.frontPid),(cleanup?'release-':'')+action],{timeout:left,fullStdout:true,maxBuffer:32768});
        const actual=JSON.parse(execution.stdout);assert.equal(actual.action,(cleanup?'release-':'')+action);assert.equal(actual.status,cleanup?'keys-released':'key-sent');assert.equal(actual.keyCode,key.code);assert.deepEqual(actual.modifiers,key.modifiers);assert.equal(actual.frontPid,strict.frontPid);
        assert.deepEqual(actual.keyTransitions,cleanup?[...key.modifiers.map(m=>m+'-up'),`key${key.code}-up`]:[...key.modifiers.map(m=>m+'-down'),`key${key.code}-down`,`key${key.code}-up`,...key.modifiers.toReversed().map(m=>m+'-up')]);
        completed=true;pending=null;assert.ok(age(proof.start)<=limits.guardAgeMs,'Total42 key guard exceeded1s');
        const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,keyGuard:strict,keyGuardExecution:preflight,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:cleanup,keysPending:false,requestId:proof.id};record(cleanup?'owned-key-release':'physical-input',value);return value;
      }
      assert.equal(cleanup,false);pending={action,pointer:true,request};dispatched=true;
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});const actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.deepEqual(actual.transitions,['down','up']);assert.equal(actual.action,action);assert.equal(actual.requestId,proof.id);
      fixedWindow(actual.axWindow);
      for(const [name,value]of Object.entries({nonce:config.nonce,mountedId:mountedId(),caseId:v.caseId,target:v.target}))assert.equal(actual[name],value);
      completed=true;pending=null;assert.ok(age(proof.start)<=limits.guardAgeMs,'Total42 pointer guard exceeded1s');
      const value={action,delivery:'sent',actual,execution,pageGuard:proof.value,maximumGuardAgeMs:age(proof.start),guardAgeLimitMs:limits.guardAgeMs,cleanupOnly:false,keysPending:false,pointerDown:false,requestId:proof.id};record('physical-input',value);return value;
    } catch(error){let knownNotSent=false;if(pointerTargets[action]&&error.execution?.stdout)try{knownNotSent=JSON.parse(error.execution.stdout).delivery==='not_sent';}catch{}if(knownNotSent)pending=null;disabled=true;if(nativeFind&&findEpisode?.state==='accepted')retireFind('ordinary-input-failed');record('physical-input-failure',{action,delivery:completed?'sent/known_completed':knownNotSent?'not_sent':dispatched?'unknown/may_have_sent':'not_sent',keysPending:!!pending&&!pending.pointer,pointerDown:!!pending?.pointer,cleanupOnly:cleanup,error:error.message,execution:execution??error.execution??null,keyGuardExecution:preflight,maximumGuardAgeMs:proof?age(proof.start):null});throw error;}
  }
  return {input:action=>perform(action),captureFindWindow,retireFindEpisode:()=>retireFind('finish'),get disabled(){return disabled;},get keysPending(){return !!pending&&!pending.pointer;},get pointerDown(){return !!pending?.pointer;},get pointerState(){return pending?.pointer?'unknown':'up';},
    releaseOwnedKeys:()=>{assert.ok(pending&&!pending.pointer);return perform(pending.action,true);},async releaseOwnedPointer(){
      assert.ok(pending?.pointer&&!cleanupUsed);cleanupUsed=true;const saved=pending;let execution=null,actual=null,request=null;
      try {
      const proof=await cleanupGuard(saved.action),v=proof.value;assert.equal(typeof proof.start,'bigint');assert.ok(proof.id.startsWith(config.nonce+':'));assert.ok(Number.isSafeInteger(v.serial)&&v.serial>serial);serial=v.serial;
      assert.equal(v.nonce,config.nonce);assert.equal(v.id,mountedId());assert.equal(v.id,saved.request.mountedId);assert.equal(v.mountedId,saved.request.mountedId);assert.equal(v.action,saved.action);assert.equal(v.target,saved.request.target);assert.equal(v.releaseOnly,true);assert.equal(v.allowed,true);assert.equal(v.editorConnected,true);
      assert.equal(v.url,config.fixtureUrl);assert.equal(v.title,config.title);assert.equal(v.caseId,saved.request.caseId);assert.deepEqual(v.viewport,saved.request.viewport);
      const remaining=Math.floor(limits.guardAgeMs-age(proof.start));assert.ok(remaining>0);
      request={...saved.request,requestId:proof.id,serial:v.serial,cleanupOnly:true,pointerDown:true,deadlineMs:remaining};
      execution=run(inputHelper,['--request',JSON.stringify(request)],{timeout:remaining,fullStdout:true,maxBuffer:32768});actual=JSON.parse(execution.stdout);
      assert.equal(actual.status,'sent');assert.equal(actual.delivery,'sent');assert.equal(actual.cleanupOnly,true);assert.deepEqual(actual.transitions,['up']);
      for(const name of ['action','requestId','nonce','mountedId','caseId','target'])assert.equal(actual[name],request[name]);
      assert.equal(actual.frontBundle,browser==='chrome'?'com.google.Chrome':'com.apple.Safari');assert.ok(Number.isSafeInteger(actual.frontPid)&&actual.frontPid>0);
      const expectedTitle=config.title+(browser==='chrome'?' - Google Chrome':'');assert.equal(actual.expectedAxWindowTitle,expectedTitle);assert.equal(actual.observedAxWindowTitle,expectedTitle);
      assert.ok(Number.isSafeInteger(actual.axWindowCount)&&actual.axWindowCount>=1&&actual.axWindowCount<=32);
      assert.ok(actual.axWindow&&['x','y','width','height'].every(key=>Number.isFinite(actual.axWindow[key])));assert.ok(actual.axWindow.width>0&&actual.axWindow.height>0);
      // Compare only an actually validated earlier measurement. An opaque first
      // pointer failure supplies no original window rectangle to invent here.
      if(baselineWindow)assert.deepEqual(actual.axWindow,baselineWindow,'Owned AX window changed during release-only cleanup');
      assert.ok(age(proof.start)<=limits.guardAgeMs);
      pending=null;const value={delivery:'sent',scope:'One release-only transition for this owner’s uncertain click; no down/replay',request,actual,execution};record('owned-pointer-release',value);return value;
      }catch(error){record('owned-pointer-release-failure',{action:saved.action,error:error.message,request,actual,execution:execution??error.execution??null,delivery:'unknown release completion; original action remains FAILED'});throw error;}
    }};
}
export function captureOwnedWindow({browser,config,inputHelper,run,path,viewport}){
  const request={format:'osr42-native-window-inspection/1',browser,nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:1000,viewport};
  const guardExecution=run(inputHelper,['--inspect-window',JSON.stringify(request)],{timeout:1000,fullStdout:true,maxBuffer:32768}),actual=JSON.parse(guardExecution.stdout);
  assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');assert.equal(actual.nonce,config.nonce);assert.equal(actual.fixtureUrl,config.fixtureUrl);assert.equal(actual.contained,true);
  const r=actual.axWindow;for(const n of Object.values(r))assert.ok(Number.isFinite(n));
  const rect=[Math.floor(r.x),Math.floor(r.y),Math.ceil(r.width),Math.ceil(r.height)];assert.ok(rect[2]>0&&rect[3]>0&&rect[2]<=4096&&rect[3]<=4096);
  const execution=run('/usr/sbin/screencapture',['-x','-R'+rect.join(','),path],{timeout:5000,fullStdout:true});return {path,scope:'Exact owned foreground fixture AX window rectangle; screenshot only, no input',guardExecution,actual,execution};
}
