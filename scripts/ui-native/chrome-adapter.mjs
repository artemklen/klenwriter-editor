// SPDX-License-Identifier: MIT OR Apache-2.0
// Separate42 adaptation of the guarded installed41 Chrome bootstrap.
import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {mkdtempSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {limits,validCall} from './protocol.mjs';
import {createInputOwner,prepareChromeWindow} from './input.mjs';
export async function createChromeAdapter({config,report,inputHelper,keyScriptPath,run,save,outputPath}){
  const script=text=>run('/usr/bin/osascript',['-e',text]);
  const childHome=mkdtempSync(resolve(dirname(outputPath),'chrome-ui42-appdata-'));
  report.setup.push({action:'isolate-chrome-child-app-data',variable:'CFFIXED_USER_HOME',directory:childHome,scope:'Only Chrome child; Carbon and scoped CGEvent helper use the real user environment'});
  const launchArguments=['--force-renderer-accessibility=complete'];
  const browser=await chromium.launch({channel:'chrome',headless:false,args:launchArguments,env:{...process.env,CFFIXED_USER_HOME:childHome}});
  const page=await browser.newPage({viewport:{width:1024,height:768}});const errors=[];
  let mountedId=null,serial=0,guardSerial=0,busy=false,navigationStarted=false,bootstrapReady=false,physicalStarted=false,focusEntryFailed=false,browserCdp=null,pageCdp=null;
  page.on('pageerror',error=>errors.push(error.message));report.browserVersion=browser.version();
  const record=(kind,value)=>{report.controlLog??=[];if(report.controlLog.length>=4096)throw Error('Chrome control receipt bound');report.controlLog.push({kind,...value});};
  const call=async(method,...args)=>{
    if(busy||++serial>limits.commands||!validCall(method,args))throw Error('Concurrent, excessive or unknown Chrome fixture call');busy=true;
    if(method==='finish')inputOwner.retireFindEpisode();
    try{const value=await page.evaluate(async({method,args,nonce,url,title})=>{
      if(method==='documentGuard')return {url:location.href,title:document.title,documentFocused:document.hasFocus()};
      if(location.href!==url||document.title!==title)throw Error('Selection fixture left its exact owned URL/title');
      const value=await window.ui42Native[method](...args);
      return ['guard','cleanupGuard'].includes(method)?{...value,nonce,url:location.href,title:document.title,documentFocused:document.hasFocus()}:value;
    },{method,args,nonce:config.nonce,url:config.fixtureUrl,title:config.title});
      if(method==='prepare'){assert.match(value.id,/^ui42-[1-9][0-9]{0,8}$/);mountedId=value.id;}
      if(method==='finish')mountedId=null;return value;
    }finally{busy=false;}
  };
  const pageGuard=method=>async action=>{
    const start=process.hrtime.bigint(),value=await call(method,action);
    assert.equal(value.url,config.fixtureUrl);assert.equal(value.title,config.title);
    return {id:config.nonce+':'+String(serial),start,value:{...value,mountedId,serial:++guardSerial}};
  };
  const inputOwner=createInputOwner({browser:'chrome',config,inputHelper,keyScriptPath,run,record,mountedId:()=>mountedId,guard:pageGuard('guard'),cleanupGuard:pageGuard('cleanupGuard'),nativeFindEpisode:'chrome-fd01'});
  report.control={method:'Installed headed Chrome; closed Playwright page setup/read RPC, strict AX preflight, fixed System Events keys and exact-control CGEvent clicks',webDriver:false,
    uniqueTitle:config.title,fixtureUrl:config.fixtureUrl,fixtureOnly:true,childOnlyEnvironment:true,launchArguments};
  return {errors,input:action=>{assert.equal(bootstrapReady,true,'Strict Chrome window bootstrap required before input');physicalStarted=true;return inputOwner.input(action);},releaseOwnedPointer:()=>inputOwner.releaseOwnedPointer(),
    releaseOwnedKeys:()=>inputOwner.releaseOwnedKeys(),captureFindWindow:path=>inputOwner.captureFindWindow(path),get keysPending(){return inputOwner.keysPending;},
    get pointerDown(){return inputOwner.pointerDown;},get pointerState(){return inputOwner.pointerState;},get inputDisabled(){return inputOwner.disabled;},
    async navigate(){
      assert.equal(navigationStarted,false,'Chrome bootstrap cannot be retried');assert.equal(physicalStarted,false);navigationStarted=true;
      const focusEmulation={action:'disable-chromium-focus-emulation-before-mounted-input',method:'Emulation.setFocusEmulationEnabled',params:{enabled:false},status:'attempted',scope:'Actual DOM focus readbacks; OS foreground still requires each fresh independent AX guard'};
      report.setup.push(focusEmulation);save();
      try{pageCdp=await page.context().newCDPSession(page);focusEmulation.response=await pageCdp.send(focusEmulation.method,focusEmulation.params);focusEmulation.status='completed';}
      catch(error){focusEmulation.status='failed';focusEmulation.error=error.message;throw error;}
      finally{save();}
      const response=await page.goto(config.fixtureUrl);assert.ok(response?.ok(),'Selection fixture server unavailable');
      await page.waitForFunction(()=>!!window.ui42,null,{timeout:15000});
      await page.evaluate(async({title,modulePath})=>{document.title=title;await import(modulePath);},{title:config.title,modulePath:config.base+'/page-fixture.mjs'});
      await page.bringToFront();script('tell application "Google Chrome" to activate');await page.waitForFunction(()=>document.hasFocus(),null,{timeout:5000});
      report.control.bootstrap=await prepareChromeWindow({config,record,
        pageState:()=>page.evaluate(()=>{
          const prefix='KlenWriter UI native ',v=visualViewport,selection=getSelection();
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
    async close(){inputOwner.retireFindEpisode();await browser.close();report.control.cleanup={status:'owned-chrome-browser-closed',scope:'Only isolated browser instance launched for this fixture'};},
  };
}
