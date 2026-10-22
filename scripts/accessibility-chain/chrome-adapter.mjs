// SPDX-License-Identifier: MIT OR Apache-2.0
// Dedicated66 namespace copy of the guarded42 Chrome bootstrap; ownership/proofs retained.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {limits,validCall} from './protocol.mjs';
import {createInputOwner,prepareChromeWindow} from './input.mjs';
export async function createChromeAdapter({config,report,inputHelper,keyScriptPath,findKeyHelper,run,save,outputPath}){
  const script=text=>run('/usr/bin/osascript',['-e',text]);
  const childHome=mkdtempSync(resolve(dirname(outputPath),'chrome-a66-chain-appdata-'));
  report.setup.push({action:'isolate-chrome-child-app-data',variable:'CFFIXED_USER_HOME',directory:childHome,scope:'Only Chrome child; Carbon and scoped CGEvent helper use the real user environment'});
  const launchArguments=['--force-renderer-accessibility=complete'];
  const browser=await chromium.launch({channel:'chrome',headless:false,args:launchArguments,env:{...process.env,CFFIXED_USER_HOME:childHome}});
  const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];
  let mountedId=null,serial=0,guardSerial=0,busy=false,navigationStarted=false,bootstrapReady=false,physicalStarted=false,focusEntryFailed=false,browserCdp=null,pageCdp=null;
  page.on('pageerror',error=>errors.push(error.message));report.browserVersion=browser.version();
  const record=(kind,value)=>{report.controlLog??=[];if(report.controlLog.length>=4096)throw Error('Chrome control receipt bound');report.controlLog.push({kind,...value});};
  const call=async(method,...args)=>{
    if(busy||++serial>limits.commands||!validCall(method,args))throw Error('Concurrent, excessive or unknown Chrome fixture call');
    if(method==='adoptReopened'){assert.equal(inputOwner.disabled,false);assert.equal(inputOwner.keysPending,false);assert.equal(inputOwner.pointerDown,false); }
    busy=true;

    try{const value=await page.evaluate(async({method,args,nonce,url,title})=>{
      if(method==='documentGuard')return {url:location.href,title:document.title,documentFocused:document.hasFocus()};
      if(location.href!==url||document.title!==title)throw Error('Selection fixture left its exact owned URL/title');
      const value=await window.accessibilityChainNative[method](...args);
      return ['guard','cleanupGuard'].includes(method)?{...value,nonce,url:location.href,title:document.title,documentFocused:document.hasFocus()}:value;
    },{method,args,nonce:config.nonce,url:config.fixtureUrl,title:config.title});
      if(method==='prepare'){assert.match(value.id,/^a66-[1-9][0-9]{0,8}$/);mountedId=value.id;}
      if(method==='adoptReopened'){
        assert.equal(inputOwner.disabled,false);assert.equal(inputOwner.keysPending,false);assert.equal(inputOwner.pointerDown,false);
        assert.equal(value.oldId,mountedId);assert.match(value.id,/^a66-[1-9][0-9]{0,8}$/);assert.notEqual(value.id,mountedId);mountedId=value.id;
      }
      if(method==='finish')mountedId=null;return value;
    }finally{busy=false;}
  };
  const pageGuard=method=>async action=>{
    const start=process.hrtime.bigint(),value=await call(method,action);
    assert.equal(value.url,config.fixtureUrl);assert.equal(value.title,config.title);
    return {id:config.nonce+':'+String(serial),start,value:{...value,mountedId,serial:++guardSerial}};
  };
  const inputOwner=createInputOwner({browser:'chrome',config,inputHelper,keyScriptPath,findKeyHelper,run,record,mountedId:()=>mountedId,guard:pageGuard('guard'),cleanupGuard:pageGuard('cleanupGuard')});
  report.control={method:'Installed headed Chrome; closed Playwright page setup/read RPC, strict AX preflight and fixed System Events keyboard programs only',webDriver:false,
    uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,fixtureOnly:true,childOnlyEnvironment:true,launchArguments};
  return {errors,input:action=>{assert.equal(bootstrapReady,true,'Strict Chrome window bootstrap required before input');physicalStarted=true;return inputOwner.input(action);},releaseOwnedPointer:()=>inputOwner.releaseOwnedPointer(),
    releaseOwnedKeys:()=>inputOwner.releaseOwnedKeys(),get keysPending(){return inputOwner.keysPending;},
    get pointerDown(){return inputOwner.pointerDown;},get pointerState(){return inputOwner.pointerState;},get inputDisabled(){return inputOwner.disabled;},
    async navigate(){
      assert.equal(navigationStarted,false,'Chrome bootstrap cannot be retried');assert.equal(physicalStarted,false);navigationStarted=true;
      const response=await page.goto(config.fixtureUrl);assert.ok(response?.ok(),'Selection fixture server unavailable');
      await page.waitForFunction(()=>!!window.accessibilityHost,null,{timeout:15000});
      await page.evaluate(async({title,modulePath})=>{document.title=title;await import(modulePath);},{title:config.title,modulePath:config.base+'/page-fixture.mjs'});
      const focusEmulation={action:'disable-original-playwright-focus-emulation',method:'Emulation.setFocusEmulationEnabled',params:{enabled:false},status:'attempted',provenance:'Pinned Playwright1.64.1 original main FrameSession; not a newly attached CDP session',scope:'Owned Chrome setup before first mount/physical input; actual focus and independent native AX assertions remain mandatory'};
      report.setup.push(focusEmulation);save();
      try{
        assert.equal(mountedId,null);assert.equal(physicalStarted,false);assert.equal(page.url(),config.fixtureUrl);assert.equal(await page.title(),config.title);
        const require=createRequire(import.meta.url),packagePath=require.resolve('playwright-core/package.json'),corePath=resolve(dirname(packagePath),'lib/coreBundle.js');
        const packageBytes=readFileSync(packagePath),coreBytes=readFileSync(corePath),version=JSON.parse(packageBytes).version;
        const libraryPin=(path,bytes)=>({path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
        focusEmulation.library={version,files:[libraryPin(packagePath,packageBytes),libraryPin(corePath,coreBytes)]};
        assert.equal(version,'1.64.1');assert.equal(packageBytes.length,876);assert.equal(focusEmulation.library.files[0].sha256,'8aa1c9863fa8dea324e674254158cdc79440f4124ef2d84d38053013541cb7d6');
        assert.equal(coreBytes.length,3585406);assert.equal(focusEmulation.library.files[1].sha256,'829521b67ed7be90c7d6d6098ff39f2241562d47e4ad7ccab13710924a56001d');
        // PF01: private access starts only AFTER the exact installed-library pins.
        assert.equal(typeof page._connection?.toImpl,'function');const serverPage=page._connection.toImpl(page),delegate=serverPage?.delegate,frameSession=delegate?._mainFrameSession,client=frameSession?._client;
        assert.ok(serverPage&&delegate&&frameSession&&client);assert.equal(delegate._page,serverPage);assert.equal(frameSession._crPage,delegate);assert.equal(frameSession._page,serverPage);
        assert.equal(typeof frameSession._targetId,'string');assert.ok(frameSession._targetId.length>0&&frameSession._targetId.length<=256);assert.equal(frameSession._targetId,delegate._targetId);
        assert.ok(delegate._sessions instanceof Map);assert.equal(delegate._sessions.get(delegate._targetId),frameSession);assert.equal(frameSession._parentSession,null);
        assert.equal(typeof client.send,'function');assert.equal(client._connection,delegate._browserContext?._browser?._connection);
        assert.equal(typeof client._sessionId,'string');assert.ok(client._sessionId.length>0&&client._sessionId.length<=256);assert.ok(client._connection?._sessions instanceof Map);assert.equal(client._connection._sessions.get(client._sessionId),client);
        assert.equal(client._closed,false);assert.equal(client._crashed,false);
        focusEmulation.context={fixtureUrl:page.url(),title:config.title,mountedId,targetId:frameSession._targetId,originalSessionId:client._sessionId};
        focusEmulation.response=await client.send('Emulation.setFocusEmulationEnabled',{enabled:false});focusEmulation.status='completed';
      }catch(error){focusEmulation.status='failed';focusEmulation.error=String(error.message).slice(0,1024);throw error;}
      finally{save();}
      await page.bringToFront();script('tell application "Google Chrome" to activate');await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});
      report.control.bootstrap=await prepareChromeWindow({config,record,
        pageState:()=>page.evaluate(()=>{
          const prefix='KlenWriter Accessibility Chain native ',v=visualViewport,selection=getSelection();
          const point=(node,offset)=>{if(!node)return null;const path=[];let current=node;
            while(current.parentNode){if(path.length>=64)throw Error('Bounded bootstrap raw selection path');path.unshift(Array.prototype.indexOf.call(current.parentNode.childNodes,current));current=current.parentNode;}
            return {nodeType:node.nodeType,path,offset};};
          return {url:location.href,title:document.title,nonce:document.title.startsWith(prefix)?document.title.slice(prefix.length):null,documentFocused:document.hasFocus(),
            viewport:{width:innerWidth,height:innerHeight,scale:v?.scale,offsetLeft:v?.offsetLeft,offsetTop:v?.offsetTop},scroll:{x:scrollX,y:scrollY},
            selection:{rangeCount:selection?.rangeCount??0,anchor:point(selection?.anchorNode,selection?.anchorOffset),focus:point(selection?.focusNode,selection?.focusOffset)}};
        }),
        inspectWindow:request=>{
          const json=JSON.stringify(request);assert.ok(Buffer.byteLength(json)<=4096);
          const execution=run(inputHelper,['--inspect-window',json],{timeout:request.deadlineMs,fullStdout:true,maxBuffer:32768});
          return {execution,actual:JSON.parse(execution.stdout)};
        },
        async getBrowserPid(){
          browserCdp=await browser.newBrowserCDPSession();const result=await browserCdp.send('SystemInfo.getProcessInfo');
          const owned=result.processInfo.filter(value=>value.type==='browser');assert.equal(owned.length,1);return Number(owned[0].id);
        },
        async getTargetInfo(){pageCdp??=await page.context().newCDPSession(page);return (await pageCdp.send('Target.getTargetInfo')).targetInfo;},
        windowCommand:(method,params)=>{assert.ok(browserCdp);return browserCdp.send(method,params);},
      });
      bootstrapReady=true;save();
    },
    async focus(){
      assert.equal(bootstrapReady,true,'Completed Chrome bootstrap required before normal case entry');assert.equal(focusEntryFailed,false,'Failed case entry cannot reactivate or retry');
      assert.equal(inputOwner.disabled,false,'Disabled input cannot reactivate Chrome');assert.equal(inputOwner.keysPending,false,'Owned uncertain keys prohibit case entry');assert.equal(inputOwner.pointerDown,false,'Owned uncertain pointer prohibits case entry');assert.equal(mountedId,null,'Case entry requires the previous mount to be finished');
      const setup={action:'activate-chrome-at-normal-case-entry',status:'attempted',scope:'Preparation before a fresh mount only; never failed/unknown input recovery'};report.setup.push(setup);save();
      try{await page.bringToFront();setup.execution=script('tell application "Google Chrome" to activate');await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});setup.status='completed';}
      catch(error){focusEntryFailed=true;setup.status='failed';setup.error=error.message;throw error;}
      finally{save();}
    },call,
    async close(){await browser.close();report.control.cleanup={status:'owned-chrome-browser-closed',scope:'Only isolated browser instance launched for this fixture'};},
  };
}
