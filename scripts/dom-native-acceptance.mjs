// SPDX-License-Identifier: MIT OR Apache-2.0
// One ordinary installed-browser RU/EN run. No retry, settings or authentication flow.
import {chromium} from '@playwright/test';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const browserName=option('--browser'),output=option('--output');
if(args.length!==4||new Set([args[0],args[2]]).size!==2||![args[0],args[2]].every(name=>['--browser','--output'].includes(name))||!['chrome','safari'].includes(browserName)||!output?.startsWith('/'))throw new Error('Usage: node scripts/dom-native-acceptance.mjs --browser chrome|safari --output /absolute/outside-checkout/report.json');
const outputPath=resolve(output);if(outputPath===root||outputPath.startsWith(root+'/'))throw new Error('Native evidence output must be outside checkout');
if(existsSync(outputPath))throw new Error('Evidence output already exists; use a fresh path to retain the first result');
mkdirSync(dirname(outputPath),{recursive:true});
const startedAt=new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={format:'klenwriter-editor-installed-dom-native/1',startedAt,browser:browserName,status:'NOT_RUN',locales:[],physicalActions:[],setup:[],restoration:null,
  scope:'Installed macOS browser, actual System Events ANSI key-code input and trusted UA event trace against mounted public SDK2/WASM. Public host undo/redo is labelled separately. No IME settlement, OSR40 drag/edge scrolling, screen-reader, clipboard or release claim.'};
const save=()=>writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
function run(command,argv,{fullStdout=false,timeout=30000,maxBuffer=1024*1024}={}){const result=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout,maxBuffer});
  const row={command,argv,returnCode:result.status,signal:result.signal,stdout:fullStdout?(result.stdout??''):(result.stdout??'').slice(0,16384),stderr:(result.stderr??'').slice(0,4096),error:result.error?.message??null};
  if(result.status!==0)throw Object.assign(new Error(`${command} failed: ${row.stderr||row.error||row.stdout}`),{execution:row});return row;}
function pin(path){const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function script(script){return run('/usr/bin/osascript',['-e',script]);}
let helper=null,originalSource=null,selectedSource=null,adapter=null;
const source=()=>JSON.parse(run(helper,['status']).stdout);
async function selectSource(id){const action=JSON.parse(run(helper,['select',id]).stdout);report.setup.push({action:'select-existing-input-source',...action});await wait(250);const actual=source();if(actual.current.id!==id)throw new Error('Input source changed asynchronously; no physical key batch was sent');selectedSource=id;return actual;}
async function physical(codes,phase){
  const application=browserName==='chrome'?'Google Chrome':'Safari';
  if(browserName==='safari')await adapter.focus();
  else {script(`tell application "${application}" to activate`);await wait(200);}
  const before=source();if(before.current.id!==selectedSource)throw new Error('Browser activation changed the selected input source; no keys sent');
  const action={phase,codes,inputSourceBefore:before.current,startedAt:new Date().toISOString(),status:'attempted',method:'System Events key code; platform input, not hardware-device evidence'};
  report.physicalActions.push(action);
  const body=`tell application "System Events"\nif (name of first application process whose frontmost is true) is not "${application}" then error "Browser activation failed"\n${codes.map(code=>`key code ${code}\ndelay 0.12`).join('\n')}\nend tell`;
  try{
    if(browserName==='safari'){
      action.perKey=[];
      for(const code of codes){
        const key={code,status:'attempted',startedAt:new Date().toISOString()};action.perKey.push(key);
        try{const guard=adapter.key(code);Object.assign(key,{status:'completed',finishedAt:new Date().toISOString(),guard});}
        catch(error){Object.assign(key,{status:'failed',finishedAt:new Date().toISOString(),error:error.message});throw error;}
      }
    }else script(body);
  }catch(error){Object.assign(action,{status:'failed',finishedAt:new Date().toISOString(),error:error.message});save();throw error;}
  await wait(250);const after=source();Object.assign(action,{status:'completed',finishedAt:new Date().toISOString(),inputSourceAfter:after.current});
  if(after.current.id!==before.current.id)throw new Error('Input source changed during physical key batch');save();}

async function chrome(){
  const childHome=mkdtempSync(resolve(dirname(outputPath),'chrome-appdata-'));
  report.setup.push({action:'isolate-chrome-child-app-data',variable:'CFFIXED_USER_HOME',directory:childHome,scope:'Chrome child only; Carbon/System Events retain the real user environment'});
  const browser=await chromium.launch({channel:'chrome',headless:false,env:{...process.env,CFFIXED_USER_HOME:childHome}});const page=await browser.newPage();report.browserVersion=browser.version();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  return {async navigate(){const response=await page.goto('http://127.0.0.1:4174/dom');if(!response?.ok())throw new Error('Mounted fixture unavailable');await page.waitForFunction(()=>window.domHostReady===true);await page.evaluate(()=>import('/dom-native-host.js'));},
    async focus(){await page.bringToFront();await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});},
    call:(method,...args)=>page.evaluate(({method,args})=>window.domNative[method](...args),{method,args}),
    errors,async close(){await browser.close();}};}
const safariFixtureUrl='http://127.0.0.1:4174/dom';
const safariCreateWindow=`tell application "Safari"
  set previousIDs to id of every window
  if (count of previousIDs) is greater than 32 then error "Safari window ownership observation limit"
  make new document with properties {URL:"http://127.0.0.1:4174/dom"}
  set createdIDs to {}
  repeat with candidate in windows
    set candidateID to id of candidate
    if previousIDs does not contain candidateID then set end of createdIDs to candidateID
  end repeat
  if (count of createdIDs) is not 1 then error "Could not identify one newly created Safari window"
  return (item 1 of createdIDs) as text
end tell`;
// Paths are positional osascript arguments, never interpolated AppleScript literals.
const safariEvaluate=`on run argv
  set codePath to item 1 of argv
  set ownedID to (item 2 of argv) as integer
  set javascriptText to read (POSIX file codePath) as «class utf8»
  tell application "Safari"
    if not (exists window id ownedID) then error "Owned Safari window no longer exists"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari window no longer has one fixture tab"
    set ownedTab to current tab of ownedWindow
    if (URL of ownedTab) is not "http://127.0.0.1:4174/dom" then error "Owned Safari tab left the fixture"
    return do JavaScript javascriptText in ownedTab
  end tell
end run`;
const safariFocus=`on run argv
  set ownedID to (item 1 of argv) as integer
  tell application "Safari"
    if not (exists window id ownedID) then error "Owned Safari window no longer exists"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari window no longer has one fixture tab"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/dom" then error "Owned Safari tab left the fixture"
    set index of ownedWindow to 1
    activate
  end tell
  return "owned-window-front"
end run`;
const safariPhysicalKey=`on run argv
  set guardPath to item 1 of argv
  set ownedID to (item 2 of argv) as integer
  set physicalCode to (item 3 of argv) as integer
  if {2,4,5,11,14,17,31,36,37,45,48,51} does not contain physicalCode then error "Key is outside the closed native protocol"
  set focusJavascript to read (POSIX file guardPath) as «class utf8»
  tell application "System Events"
    if (name of first application process whose frontmost is true) is not "Safari" then error "Safari is not frontmost before physical key"
  end tell
  tell application "Safari"
    if not (exists front window) then error "Safari has no front window before physical key"
    if (id of front window) is not ownedID then error "Owned Safari window is not frontmost before physical key"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari window tab count changed before physical key"
    set ownedTab to current tab of ownedWindow
    if (URL of ownedTab) is not "http://127.0.0.1:4174/dom" then error "Owned Safari tab left the fixture before physical key"
    set focusedTarget to do JavaScript focusJavascript in ownedTab
    if focusedTarget is not "host-control" and focusedTarget is not "editor" then error "Owned Safari fixture input target lost document focus before physical key"
    if (id of front window) is not ownedID then error "Owned Safari window lost frontmost ownership during key guard"
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari tab count changed during key guard"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/dom" then error "Owned Safari tab left fixture during key guard"
  end tell
  tell application "System Events"
    if (name of first application process whose frontmost is true) is not "Safari" then error "Safari lost application focus before physical key"
    key code physicalCode
    delay 0.12
  end tell
  return focusedTarget
end run`;
const safariClose=`on run argv
  set ownedID to (item 1 of argv) as integer
  tell application "Safari"
    if not (exists window id ownedID) then error "Owned Safari window missing at cleanup"
    set ownedWindow to window id ownedID
    if (count of tabs of ownedWindow) is not 1 then error "Owned Safari window retained: tab count changed"
    if (URL of current tab of ownedWindow) is not "http://127.0.0.1:4174/dom" then error "Owned Safari window retained: tab left fixture"
    close ownedWindow
  end tell
  return "owned-window-closed"
end run`;
const nativeMethods={
  prepare:args=>args.length===1&&['en','ru'].includes(args[0]),
  phase:args=>args.length===1&&['focused','type','split','join','public-host-undo-join','public-host-redo-join','delete-last','focus-return'].includes(args[0]),
  checkpoint:args=>args.length===1&&['focused','typed','split','joined','undo-join','redo-join','delete-last','focus-return'].includes(args[0]),
  history:args=>args.length===1&&['undo','redo'].includes(args[0]),
  focusControl:args=>args.length===0,verifyTrace:args=>args.length===0,observations:args=>args.length===0,finish:args=>args.length===0,
};
async function safari(){
  const scriptDirectory=mkdtempSync(resolve(dirname(outputPath),'safari-apple-events-'));
  const javascriptPath=resolve(scriptDirectory,'current.js'),keyGuardPath=resolve(scriptDirectory,'key-focus.js');let requestSerial=0,mountedId=null;
  const created=script(safariCreateWindow).stdout.trim();
  const windowId=Number(created);
  if(!/^[0-9]+$/.test(created)||!Number.isSafeInteger(windowId)||windowId<=0)throw new Error('Safari returned an invalid owned window ID');
  const windowIdText=String(windowId);
  report.browserVersion=report.bundleVersion;
  report.control={method:'ordinary Safari window via Apple Events',windowId,fixtureUrl:safariFixtureUrl,
    ownership:'one fresh numeric window ID from make new document; only its single fixture tab is targeted',
    javascriptTransfer:'UTF-8 file outside checkout, passed as osascript argv',asyncProtocol:'generated request ID plus window callback result; bounded polling',
    browserVersionSource:'installed Safari bundle',webDriver:false,scriptDirectory,
    physicalKeyGuard:'Each key checks captured front-window ID, single fixture tab/URL, document focus and exact fixture editor/host-control target before System Events input'};
  const errors=[];
  function evaluate(javascript,deadline=Date.now()+15000){
    const remaining=deadline-Date.now();if(remaining<=0)throw new Error('Safari Apple Events call deadline exceeded');
    writeFileSync(javascriptPath,javascript,'utf8');
    const result=run('/usr/bin/osascript',['-e',safariEvaluate,javascriptPath,windowIdText],{fullStdout:true,timeout:remaining,maxBuffer:2*1024*1024});
    try{return JSON.parse(result.stdout.trim());}catch{throw Object.assign(new Error('Safari Apple Events did not return bounded JSON'),{nativeControl:{windowId,operation:'parse-result'}});}
  }
  async function poll(javascript,accept,deadline,label){
    while(Date.now()<deadline){const value=evaluate(javascript,deadline);if(accept(value))return value;await wait(Math.min(100,Math.max(0,deadline-Date.now())));}
    throw Object.assign(new Error(`Safari ${label} timed out`),{nativeControl:{windowId,operation:label}});
  }
  async function request(kind,method=null,args=[]){
    if(kind!=='bootstrap'&&(kind!=='method'||!Object.hasOwn(nativeMethods,method)||!nativeMethods[method](args)))throw new Error('Safari fixture method/arguments are outside the closed harness API');
    const id=`native-${++requestSerial}`,key=JSON.stringify(id),deadline=Date.now()+15000;
    const operation=kind==='bootstrap'?`import('/dom-native-host.js').then(()=>({ready:window.domNativeReady===true,userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language,location:location.href}))`
      :`window.domNative[${JSON.stringify(method)}](...${JSON.stringify(args)})`;
    const begin=`(()=>{const id=${key};const pending=window.__domNativeAcceptanceRequests??=Object.create(null);if(Object.keys(pending).length>=2)throw new Error('Native callback bound');pending[id]={done:false};Promise.resolve().then(()=>${operation}).then(value=>{pending[id]={done:true,value};},error=>{pending[id]={done:true,error:String(error?.message??error).slice(0,2048)};});return JSON.stringify({accepted:id});})()`;
    const accepted=evaluate(begin,deadline);if(accepted.accepted!==id)throw new Error('Safari request ID acknowledgement differs');
    const read=`(()=>{const pending=window.__domNativeAcceptanceRequests;const value=pending?.[${key}]??{done:false};if(value.done)delete pending[${key}];return JSON.stringify(value);})()`;
    const result=await poll(read,value=>value.done===true,deadline,kind==='bootstrap'?'module import':method);
    if(Object.hasOwn(result,'error'))throw Object.assign(new Error(`Safari fixture callback: ${result.error}`),{nativeControl:{windowId,requestId:id,operation:kind==='bootstrap'?'module import':method}});
    if(kind==='method'&&method==='prepare'){
      const id=result.value?.id;
      if(typeof id!=='string'||!/^mount-[1-9][0-9]{0,8}$/.test(id))throw new Error('Safari fixture returned an invalid mounted editor ID');
      mountedId=id;
      writeFileSync(keyGuardPath,`(()=>{const editor=document.getElementById(${JSON.stringify(id)}),control=document.getElementById('host-recovery-control'),active=document.activeElement;if(location.href!=='http://127.0.0.1:4174/dom'||!document.hasFocus())return 'blocked';if(active===control&&control?.isConnected)return 'host-control';return editor?.isConnected&&editor.parentElement===document.getElementById('mounts')&&(active===editor||editor.contains(active))?'editor':'blocked';})()`,'utf8');
    }
    return result.value;
  }
  return {async navigate(){
      await poll('JSON.stringify({ready:window.domHostReady===true})',value=>value.ready===true,Date.now()+15000,'domHostReady');
      const bootstrap=await request('bootstrap');if(!bootstrap.ready||bootstrap.location!==safariFixtureUrl)throw new Error('Safari fixture module admission failed');
      Object.assign(report.control,{userAgent:bootstrap.userAgent,platform:bootstrap.platform,language:bootstrap.language});
    },
    async focus(){
      const deadline=Date.now()+5000;
      run('/usr/bin/osascript',['-e',safariFocus,windowIdText],{timeout:Math.max(1,deadline-Date.now())});
      await poll('JSON.stringify({focused:document.hasFocus()})',value=>value.focused===true,deadline,'owned document focus');
    },
    call:(method,...args)=>request('method',method,args),errors,
    key(code){
      if(!mountedId||![2,4,5,11,14,17,31,36,37,45,48,51].includes(code))throw new Error('Safari physical key lacks a prepared fixture target');
      const result=run('/usr/bin/osascript',['-e',safariPhysicalKey,keyGuardPath,windowIdText,String(code)],{timeout:5000});
      const target=result.stdout.trim();if(!['host-control','editor'].includes(target))throw new Error('Safari physical key guard returned an invalid target');
      return {windowId,fixtureUrl:safariFixtureUrl,mountedId,target,documentFocused:true,singleFixtureTab:true};
    },
    async close(){
      try{const result=run('/usr/bin/osascript',['-e',safariClose,windowIdText],{timeout:5000});report.control.cleanup={status:'closed',result:result.stdout.trim(),windowId};}
      catch(error){report.control.cleanup={status:'failed',windowId,error:error.message};throw error;}
    }};
}
try{
  if(process.platform!=='darwin')throw new Error('Installed macOS native lane requires Darwin');
  if(process.version!=='v24.22.0')throw new Error(`Acceptance Node pin is v24.22.0, actual ${process.version}`);
  report.nodeVersion=process.version;report.os={productVersion:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),buildVersion:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:[
    'scripts/dom-native-acceptance.mjs','scripts/dom-native-input-source.swift','spikes/workspace/dom-native-host.js','spikes/workspace/dom-host.js',
    'contracts/dom/v1/inputs/D0.json','contracts/dom/v1/inputs/D1-after-end-split.json','packages/wasm/dist/editor_wasm_bg.wasm',
    'packages/dom/dist/input.js','packages/dom/dist/mounted.js','packages/dom/dist/view.js'].map(pin)};
  const bundle=browserName==='chrome'?'/Applications/Google Chrome.app/Contents/Info.plist':'/Applications/Safari.app/Contents/Info.plist';
  report.bundleVersion=existsSync(bundle)?run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleShortVersionString',bundle]).stdout.trim():null;
  report.bundleBuild=existsSync(bundle)?run('/usr/libexec/PlistBuddy',['-c','Print :CFBundleVersion',bundle]).stdout.trim():null;
  const accessibility=script('tell application "System Events" to get UI elements enabled').stdout.trim();report.setup.push({action:'read-existing-ui-automation-availability',value:accessibility});if(accessibility!=='true')throw new Error('Existing UI automation permission is unavailable');
  helper=resolve(dirname(outputPath),'dom-native-input-source');run('/usr/bin/swiftc',[resolve(root,'scripts/dom-native-input-source.swift'),'-o',helper]);
  const initial=source();report.inputSources=initial;originalSource=initial.current.id;
  // These two existing Russian layouts share the letter keys used for привет.
  // Their punctuation differs and is outside this basic functional protocol.
  const russian=['com.apple.keylayout.RussianWin','com.apple.keylayout.Russian'].find(id=>initial.sources.some(row=>row.id===id&&row.enabled&&row.selectable));
  if(!russian)throw new Error('An existing enabled Russian or RussianWin input source is required');
  report.setup.push({action:'choose-existing-russian-letter-layout',inputSourceId:russian,expectedText:'привет'});
  const supported=[['en','com.apple.keylayout.US',[4,14,37,37,31]],['ru',russian,[5,4,11,2,17,45]]];
  adapter=await(browserName==='chrome'?chrome():safari());await adapter.navigate();
  for(const [locale,sourceId,codes]of supported){const lane={locale,inputSourceId:sourceId,status:'NOT_RUN',checkpoints:[],startedAt:new Date().toISOString()};report.locales.push(lane);save();let typingStarted=false;
    try{if(!initial.sources.some(row=>row.id===sourceId&&row.enabled&&row.selectable))throw new Error('Required existing enabled input source is unavailable');
      script(`tell application "${browserName==='chrome'?'Google Chrome':'Safari'}" to activate`);await wait(200);
      if(adapter.focus)await adapter.focus();
      report.setup.push({action:'prepare-browser-page-focus',browser:browserName,locale,chromeDocumentFocusConfirmed:browserName==='chrome',ordinarySafariDocumentFocusConfirmed:browserName==='safari'});
      lane.actualInputSource=await selectSource(sourceId);lane.initial=await adapter.call('prepare',locale);
      await adapter.call('phase','focused');await adapter.call('focusControl');await physical([48],'focused');lane.checkpoints.push(await adapter.call('checkpoint','focused'));
      await adapter.call('phase','type');typingStarted=true;await physical(codes,'type');lane.checkpoints.push(await adapter.call('checkpoint','typed'));
      await adapter.call('phase','split');await physical([36],'split');lane.checkpoints.push(await adapter.call('checkpoint','split'));
      await adapter.call('phase','join');await physical([51],'join');lane.checkpoints.push(await adapter.call('checkpoint','joined'));
      await adapter.call('phase','public-host-undo-join');await adapter.call('history','undo');lane.checkpoints.push(await adapter.call('checkpoint','undo-join'));
      await adapter.call('phase','public-host-redo-join');await adapter.call('history','redo');lane.checkpoints.push(await adapter.call('checkpoint','redo-join'));
      await adapter.call('phase','delete-last');await physical([51],'delete-last');lane.checkpoints.push(await adapter.call('checkpoint','delete-last'));
      await adapter.call('phase','focus-return');await adapter.call('focusControl');await physical([48],'focus-return');lane.checkpoints.push(await adapter.call('checkpoint','focus-return'));
      lane.trust=await adapter.call('verifyTrace');lane.status='PASSED';
    }catch(error){lane.status=typingStarted?'FAILED':'NOT_RUN';lane.error={message:error.message,execution:error.execution??null,nativeControl:error.nativeControl??null};}
    finally{try{lane.observations=await adapter.call('finish');if(!lane.observations.resourcesReleased){lane.cleanupError='Fixture teardown retained resources';lane.status='FAILED';}if(lane.observations.pageErrors.length||lane.observations.policyViolations.length){lane.status='FAILED';}}catch(error){lane.cleanupError=error.message;if(lane.status==='PASSED')lane.status='FAILED';}lane.finishedAt=new Date().toISOString();save();}
  }
  report.pageErrors=adapter.errors;report.status=report.locales.length===2&&report.locales.every(lane=>lane.status==='PASSED')&&report.pageErrors.length===0?'PASSED':report.locales.some(lane=>lane.status==='FAILED')?'FAILED':'NOT_RUN';
}catch(error){report.error={message:error.message,execution:error.execution??null,nativeControl:error.nativeControl??null};}
finally{
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError=error.message;report.status='FAILED';}
  if(originalSource&&helper){try{report.restoration=await selectSource(originalSource);if(report.restoration.current.id!==originalSource)throw new Error('Original source not restored');}catch(error){report.restoration={status:'FAILED',error:error.message};report.status='FAILED';}}
  report.finishedAt=new Date().toISOString();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status,locales:report.locales.map(lane=>({locale:lane.locale,status:lane.status}))}));
process.exitCode=report.status==='PASSED'?0:report.status==='NOT_RUN'?2:1;
