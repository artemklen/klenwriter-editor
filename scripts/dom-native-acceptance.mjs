// SPDX-License-Identifier: MIT OR Apache-2.0
// One ordinary installed-browser RU/EN run. No retry, settings or authentication flow.
import {chromium} from '@playwright/test';
import {createSafariAdapter} from './dom-native/safari-adapter.mjs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const args=process.argv.slice(2), option=name=>{const at=args.indexOf(name);return at<0?null:args[at+1];};
const browserName=option('--browser'),output=option('--output'),brokerPath=option('--broker');
const usage='Usage: node scripts/dom-native-acceptance.mjs --browser chrome --output /absolute/outside-checkout/report.json OR --browser safari --output /absolute/outside-checkout/report.json --broker /absolute/fresh/broker/config.json';
const brokerPrecondition='Safari requires a fresh running fixture broker: start node scripts/dom-native/server.mjs --directory /absolute/fresh/outside-checkout/directory, then pass its config.json with --broker';
if(browserName==='safari'&&!brokerPath)throw new Error(brokerPrecondition);
const expected=browserName==='chrome'?['--browser','--output']:browserName==='safari'?['--browser','--output','--broker']:[];
const names=args.filter((_,index)=>index%2===0);
if(args.length!==expected.length*2||new Set(names).size!==expected.length||!names.every(name=>expected.includes(name))||!['chrome','safari'].includes(browserName)||!output?.startsWith('/'))throw new Error(usage);
let brokerConfig=null,brokerFile=null,brokerConfigSha256=null;
if(browserName==='safari'){
  if(!brokerPath.startsWith('/'))throw new Error(brokerPrecondition);
  brokerFile=resolve(brokerPath);
  if(brokerFile===root||brokerFile.startsWith(root+'/'))throw new Error('Safari broker config must be outside checkout');
  try{const bytes=readFileSync(brokerFile);if(bytes.length>4096)throw new Error('Broker config exceeds bound');brokerConfig=JSON.parse(bytes.toString('utf8'));brokerConfigSha256=createHash('sha256').update(bytes).digest('hex');}
  catch(error){throw new Error(brokerPrecondition+': '+error.message);}
}
const outputPath=resolve(output);if(outputPath===root||outputPath.startsWith(root+'/'))throw new Error('Native evidence output must be outside checkout');
if(existsSync(outputPath))throw new Error('Evidence output already exists; use a fresh path to retain the first result');
mkdirSync(dirname(outputPath),{recursive:true});
const startedAt=new Date().toISOString(),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const report={format:'klenwriter-editor-installed-dom-native/2',startedAt,browser:browserName,status:'NOT_RUN',locales:[],physicalActions:[],setup:[],restoration:null,
  scope:'Installed macOS browser, actual System Events ANSI key-code input and trusted UA event trace against mounted public SDK2/WASM. Public host undo/redo is labelled separately. No IME settlement, OSR40 drag/edge scrolling, screen-reader, clipboard or release claim.'};
if(brokerConfig)report.broker={configPath:brokerFile,configSha256:brokerConfigSha256,nonce:brokerConfig.nonce};
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
  if(browserName==='chrome'){script(`tell application "${application}" to activate`);await wait(200);}
  const before=source();if(before.current.id!==selectedSource)throw new Error('Browser activation changed the selected input source; no keys sent');
  const action={phase,codes,inputSourceBefore:before.current,startedAt:new Date().toISOString(),status:'attempted',method:'System Events key code; platform input, not hardware-device evidence'};
  report.physicalActions.push(action);
  const body=`tell application "System Events"\nif (name of first application process whose frontmost is true) is not "${application}" then error "Browser activation failed"\n${codes.map(code=>`key code ${code}\ndelay 0.12`).join('\n')}\nend tell`;
  try{
    if(browserName==='safari'){
      action.perKey=[];
      for(const code of codes){
        const key={code,status:'attempted',startedAt:new Date().toISOString()};action.perKey.push(key);
        try{const guard=await adapter.key(code);Object.assign(key,{status:'completed',finishedAt:new Date().toISOString(),guard});}
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
async function safari(){return createSafariAdapter({config:brokerConfig,report,run,outputPath});}

try{
  if(process.platform!=='darwin')throw new Error('Installed macOS native lane requires Darwin');
  if(process.version!=='v24.22.0')throw new Error(`Acceptance Node pin is v24.22.0, actual ${process.version}`);
  report.nodeVersion=process.version;report.os={productVersion:run('/usr/bin/sw_vers',['-productVersion']).stdout.trim(),buildVersion:run('/usr/bin/sw_vers',['-buildVersion']).stdout.trim()};
  report.source={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:[
    'scripts/dom-native-acceptance.mjs','scripts/dom-native-input-source.swift','spikes/workspace/dom-native-host.js','spikes/workspace/dom-host.js',
    'contracts/dom/v1/inputs/D0.json','contracts/dom/v1/inputs/D1-after-end-split.json','packages/wasm/dist/editor_wasm_bg.wasm',
    'packages/dom/dist/input.js','packages/dom/dist/mounted.js','packages/dom/dist/view.js',
    'scripts/dom-native/protocol.mjs','scripts/dom-native/server.mjs','scripts/dom-native/page-client.mjs','scripts/dom-native/safari-adapter.mjs'].map(pin)};
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
      if(browserName==='chrome'){script('tell application "Google Chrome" to activate');await wait(200);}
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
  try{
    if(report.source){
      report.sourceAfter={head:run('git',['rev-parse','HEAD']).stdout.trim(),trackedDirty:run('git',['status','--porcelain','--untracked-files=no']).stdout.trim(),pins:report.source.pins.map(value=>pin(value.path))};
      report.sourceUnchanged=JSON.stringify(report.source)===JSON.stringify(report.sourceAfter);
      report.sourceClean=report.source.trackedDirty===''&&report.sourceAfter.trackedDirty==='';
      if(report.broker){report.broker.configSha256After=createHash('sha256').update(readFileSync(brokerFile)).digest('hex');report.sourceUnchanged&&=report.broker.configSha256After===report.broker.configSha256;}
    }else{report.sourceUnchanged=false;report.sourceClean=false;}
    if((!report.sourceUnchanged||!report.sourceClean)&&report.status==='PASSED')report.status='FAILED';
  }catch(error){report.sourceUnchanged=false;report.sourceIdentityError=error.message;if(report.status==='PASSED')report.status='FAILED';}
  report.finishedAt=new Date().toISOString();save();
}
console.log(JSON.stringify({output:outputPath,status:report.status,locales:report.locales.map(lane=>({locale:lane.locale,status:lane.status}))}));
process.exitCode=report.status==='PASSED'?0:report.status==='NOT_RUN'?2:1;
