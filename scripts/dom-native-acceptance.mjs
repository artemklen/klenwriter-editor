// SPDX-License-Identifier: MIT OR Apache-2.0
// One ordinary installed-browser RU/EN run. No retry, settings or authentication flow.
import {chromium} from '@playwright/test';
import {spawn,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const browserName=option('--browser'),output=option('--output');
if(!['chrome','safari'].includes(browserName)||!output?.startsWith('/'))throw new Error('Usage: node scripts/dom-native-acceptance.mjs --browser chrome|safari --output /absolute/outside-checkout/report.json [--safari-url http://127.0.0.1:PORT]');
const outputPath=resolve(output);if(outputPath===root||outputPath.startsWith(root+'/'))throw new Error('Native evidence output must be outside checkout');
if(existsSync(outputPath))throw new Error('Evidence output already exists; use a fresh path to retain the first result');
mkdirSync(dirname(outputPath),{recursive:true});
const startedAt=new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={format:'klenwriter-editor-installed-dom-native/1',startedAt,browser:browserName,status:'NOT_RUN',locales:[],physicalActions:[],setup:[],restoration:null,
  scope:'Installed macOS browser, actual System Events ANSI key-code input and trusted UA event trace against mounted public SDK2/WASM. Public host undo/redo is labelled separately. No IME settlement, OSR40 drag/edge scrolling, screen-reader, clipboard or release claim.'};
const save=()=>writeFileSync(outputPath,JSON.stringify(report,null,2)+'\n');
function run(command,argv){const result=spawnSync(command,argv,{cwd:root,encoding:'utf8',timeout:30000,maxBuffer:1024*1024});
  const row={command,argv,returnCode:result.status,signal:result.signal,stdout:(result.stdout??'').slice(0,16384),stderr:(result.stderr??'').slice(0,4096),error:result.error?.message??null};
  if(result.status!==0)throw Object.assign(new Error(`${command} failed: ${row.stderr||row.error||row.stdout}`),{execution:row});return row;}
function pin(path){const bytes=readFileSync(resolve(root,path));return {path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};}
function script(script){return run('/usr/bin/osascript',['-e',script]);}
let helper=null,originalSource=null,selectedSource=null,adapter=null,safariChild=null;
const source=()=>JSON.parse(run(helper,['status']).stdout);
async function selectSource(id){const action=JSON.parse(run(helper,['select',id]).stdout);report.setup.push({action:'select-existing-input-source',...action});await wait(250);const actual=source();if(actual.current.id!==id)throw new Error('Input source changed asynchronously; no physical key batch was sent');selectedSource=id;return actual;}
async function physical(codes,phase){
  const application=browserName==='chrome'?'Google Chrome':'Safari';
  script(`tell application "${application}" to activate`);await wait(200);
  const before=source();if(before.current.id!==selectedSource)throw new Error('Browser activation changed the selected input source; no keys sent');
  report.physicalActions.push({phase,codes,inputSourceBefore:before.current,startedAt:new Date().toISOString(),method:'System Events key code; platform input, not hardware-device evidence'});
  const body=`tell application "System Events"\nif name of first application process whose frontmost is true is not "${application}" then error "Browser activation failed"\n${codes.map(code=>`key code ${code}\ndelay 0.12`).join('\n')}\nend tell`;
  script(body);await wait(250);const after=source();Object.assign(report.physicalActions.at(-1),{finishedAt:new Date().toISOString(),inputSourceAfter:after.current});
  if(after.current.id!==before.current.id)throw new Error('Input source changed during physical key batch');save();}

async function chrome(){const browser=await chromium.launch({channel:'chrome',headless:false});const page=await browser.newPage();report.browserVersion=browser.version();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  return {async navigate(){const response=await page.goto('http://127.0.0.1:4174/dom');if(!response?.ok())throw new Error('Mounted fixture unavailable');await page.waitForFunction(()=>window.domHostReady===true);await page.evaluate(()=>import('/dom-native-host.js'));},
    call:(method,...args)=>page.evaluate(({method,args})=>window.domNative[method](...args),{method,args}),
    errors,async close(){await browser.close();}};}
async function safari(){let endpoint=option('--safari-url');if(!endpoint){endpoint='http://127.0.0.1:4726';safariChild=spawn('/usr/bin/safaridriver',['--port','4726'],{stdio:['ignore','pipe','pipe']});
    let stderr='',spawnError=null;safariChild.on('error',error=>{spawnError=error;});safariChild.stderr.on('data',bytes=>{stderr=(stderr+bytes.toString()).slice(-4096);});await wait(800);report.setup.push({action:'start-existing-enabled-safaridriver',stderr});if(spawnError)throw spawnError;if(safariChild.exitCode!==null)throw new Error('Owned safaridriver exited before session creation; existing local driver is not reused implicitly');}
  const url=new URL(endpoint);if(url.hostname!=='127.0.0.1'||url.protocol!=='http:')throw new Error('Safari endpoint must be local HTTP127.0.0.1');
  async function request(path,method='GET',body){const response=await fetch(new URL(path,url),{method,headers:{'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});const result=await response.json();if(!response.ok||result.value?.error)throw Object.assign(new Error(`Safari WebDriver: ${result.value?.message??response.status}`),{webDriver:result});return result.value;}
  const opened=await request('/session','POST',{capabilities:{alwaysMatch:{browserName:'safari','safari:automaticInspection':false,'safari:automaticProfiling':false}}});
  const session=opened.sessionId;report.capabilities=opened.capabilities;report.browserVersion=opened.capabilities.browserVersion;
  const prefix=`/session/${session}`;let errors=[];
  return {async navigate(){await request(prefix+'/url','POST',{url:'http://127.0.0.1:4174/dom'});
      await request(prefix+'/timeouts','POST',{script:15000});
      await request(prefix+'/execute/async','POST',{script:'const done=arguments[arguments.length-1]; let polls=0; const timer=setInterval(()=>{if(window.domHostReady){clearInterval(timer);import("/dom-native-host.js").then(()=>done({ok:true})).catch(error=>done({error:String(error)}));}else if(++polls===100){clearInterval(timer);done({error:"domHostReady timeout"});}},100);',args:[]}).then(value=>{if(value?.error)throw new Error(value.error);});},
    async call(method,...args){const result=await request(prefix+'/execute/async','POST',{script:'const method=arguments[0],args=arguments[1],done=arguments[arguments.length-1];Promise.resolve().then(()=>window.domNative[method](...args)).then(value=>done({ok:true,value})).catch(error=>done({error:String(error)}));',args:[method,args]});if(result.error)throw new Error(result.error);return result.value;},errors,
    async close(){await request(prefix,'DELETE');}};}
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
    }catch(error){lane.status=typingStarted?'FAILED':'NOT_RUN';lane.error={message:error.message,execution:error.execution??null,webDriver:error.webDriver??null};}
    finally{try{lane.observations=await adapter.call('finish');if(!lane.observations.resourcesReleased){lane.cleanupError='Fixture teardown retained resources';lane.status='FAILED';}if(lane.observations.pageErrors.length||lane.observations.policyViolations.length){lane.status='FAILED';}}catch(error){lane.cleanupError=error.message;if(lane.status==='PASSED')lane.status='FAILED';}lane.finishedAt=new Date().toISOString();save();}
  }
  report.pageErrors=adapter.errors;report.status=report.locales.length===2&&report.locales.every(lane=>lane.status==='PASSED')&&report.pageErrors.length===0?'PASSED':report.locales.some(lane=>lane.status==='FAILED')?'FAILED':'NOT_RUN';
}catch(error){report.error={message:error.message,execution:error.execution??null,webDriver:error.webDriver??null};}
finally{
  if(adapter)try{await adapter.close();}catch(error){report.browserCleanupError=error.message;report.status='FAILED';}
  if(originalSource&&helper){try{report.restoration=await selectSource(originalSource);if(report.restoration.current.id!==originalSource)throw new Error('Original source not restored');}catch(error){report.restoration={status:'FAILED',error:error.message};report.status='FAILED';}}
  if(safariChild)safariChild.kill();report.finishedAt=new Date().toISOString();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status,locales:report.locales.map(lane=>({locale:lane.locale,status:lane.status}))}));
process.exitCode=report.status==='PASSED'?0:report.status==='NOT_RUN'?2:1;
