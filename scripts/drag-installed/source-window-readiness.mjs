// SPDX-License-Identifier: MIT OR Apache-2.0
// Passive preparation only; never authorizes or submits an input.
import assert from 'node:assert/strict';
const proofKeys=['format','status','delivery','browser','nonce','title','fixtureUrl','frontBundle','frontPid','expectedAxWindowTitle','observedAxWindowTitle','axWindowCount','axMatchCount','visitedNodes','maximumDepth','axWindow','axViewport','contained','elapsedMs'];
const finite=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0;
const exact=(o,keys)=>assert.deepEqual(Object.keys(o).sort(),[...keys].sort());
function rect(r){exact(r,['x','y','width','height']);for(const n of Object.values(r))assert.ok(typeof n==='number'&&Number.isFinite(n));assert.ok(r.width>0&&r.height>0&&Number.isFinite(r.x+r.width)&&Number.isFinite(r.y+r.height));}
export async function awaitSourceWindowReady({config,reference,pageState,inspectWindow,record=()=>{},clock=()=>performance.now(),delay=ms=>new Promise(resolve=>setTimeout(resolve,ms))}){
 const began=clock(),report={status:'preparing',maximumMs:2000,samples:[],waitsMs:[],elapsedMs:0};
 const update=()=>{report.elapsedMs=clock()-began;assert.ok(finite(report.elapsedMs));record('source-window-readiness',report);};
 const remaining=()=>{const n=2000-(clock()-began);assert.ok(Number.isFinite(n)&&n>0,'Source-window preparation deadline expired');return n;};
 async function bounded(operation,cap=2000){
  const timeout=Math.floor(Math.min(cap,remaining()));assert.ok(timeout>=1);let timer;
  try{return await Promise.race([Promise.resolve().then(operation),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Source-window read deadline expired; no further input')),timeout);})]);}
  finally{clearTimeout(timer);}
 }
 let baseline=null;
 function page(p){
  assert.equal(p.url,config.fixtureUrl);assert.equal(p.title,config.title);if(p.nonce!==undefined)assert.equal(p.nonce,config.nonce);assert.equal(p.documentFocused,true);
  assert.deepEqual(p.viewport,{width:1024,height:768,scale:1,offsetLeft:0,offsetTop:0});
  assert.ok(p.selection&&Number.isSafeInteger(p.selection.rangeCount)&&p.selection.rangeCount>=0&&p.selection.rangeCount<=1);
  for(const point of [p.selection.anchor,p.selection.focus])if(point!==null){assert.ok(point&&Number.isSafeInteger(point.nodeType)&&point.nodeType>0&&Array.isArray(point.path)&&point.path.length<=64&&point.path.every(n=>Number.isSafeInteger(n)&&n>=0)&&Number.isSafeInteger(point.offset)&&point.offset>=0);}
  baseline??=structuredClone(p);assert.deepEqual(p,baseline,'Actual own page/selection remains unchanged');
 }
 try{
  assert.ok(typeof config.nonce==='string'&&config.nonce.length===32&&/^[a-f0-9]{32}$/.test(config.nonce));assert.equal(config.title,'KlenWriter Drag native '+config.nonce);assert.equal(config.fixtureUrl,'http://127.0.0.1:4174/ui');
  assert.ok(Number.isSafeInteger(reference.ownBrowserPid)&&reference.ownBrowserPid>0);rect(reference.measurement.axWindow);rect(reference.measurement.axViewport);
  for(let index=0;index<15;index++){
   const row={index,status:'pending',before:null,request:null,execution:null,actual:null,after:null};report.samples.push(row);update();
   remaining();row.before=await bounded(pageState);update();remaining();page(row.before);
   const timeout=Math.floor(Math.min(500,remaining()));assert.ok(timeout>=1);
   const request={format:'osr44-native-window-inspection/1',browser:'chrome',nonce:config.nonce,title:config.title,fixtureUrl:config.fixtureUrl,deadlineMs:timeout};row.request=request;row.inspectionStartedMs=clock()-began;update();
   let result;try{result=await bounded(()=>inspectWindow(request),timeout);row.execution=result?.execution??null;row.actual=result?.actual??null;row.inspectionElapsedMs=clock()-began-row.inspectionStartedMs;update();}catch(error){row.execution=error.execution??null;row.error=String(error.message??error);row.inspectionElapsedMs=clock()-began-row.inspectionStartedMs;update();throw error;}
   remaining();assert.ok(finite(row.inspectionElapsedMs)&&row.inspectionElapsedMs<=timeout,'Inspector exceeded its sample deadline');
   const {execution,actual}=result;assert.equal(execution.returnCode,0);assert.equal(execution.signal,null);assert.equal(execution.error,null);assert.equal(execution.stderr,'');assert.ok(typeof execution.command==='string'&&execution.command.startsWith('/')&&execution.command.length<=4096);assert.deepEqual(execution.argv,['--inspect-window',JSON.stringify(request)]);assert.ok(typeof execution.stdout==='string'&&Buffer.byteLength(execution.stdout)<=32768);assert.deepEqual(JSON.parse(execution.stdout),actual);assert.ok(finite(execution.wallTimeMs)&&execution.wallTimeMs<=timeout);
   exact(actual,proofKeys);assert.equal(actual.format,request.format);assert.equal(actual.status,'inspected');assert.equal(actual.delivery,'not_sent');assert.equal(actual.browser,'chrome');assert.equal(actual.nonce,config.nonce);assert.equal(actual.title,config.title);assert.equal(actual.fixtureUrl,config.fixtureUrl);
   assert.equal(actual.frontBundle,'com.google.Chrome');assert.equal(actual.frontPid,reference.ownBrowserPid);assert.equal(actual.expectedAxWindowTitle,config.title+' - Google Chrome');assert.equal(actual.observedAxWindowTitle,actual.expectedAxWindowTitle);assert.equal(actual.axMatchCount,1);
   assert.ok([1,2].includes(actual.axWindowCount));assert.ok(Number.isSafeInteger(actual.visitedNodes)&&actual.visitedNodes>=1&&actual.visitedNodes<=512);assert.ok(Number.isSafeInteger(actual.maximumDepth)&&actual.maximumDepth>=0&&actual.maximumDepth<=32);assert.ok(finite(actual.elapsedMs)&&actual.elapsedMs<=timeout);
   rect(actual.axWindow);rect(actual.axViewport);assert.deepEqual(actual.axWindow,reference.measurement.axWindow);assert.deepEqual(actual.axViewport,reference.measurement.axViewport);assert.equal(actual.contained,true);
   const w=actual.axWindow,v=actual.axViewport;assert.ok(v.x>=w.x-.5&&v.y>=w.y-.5&&v.x+v.width<=w.x+w.width+.5&&v.y+v.height<=w.y+w.height+.5);assert.ok(Math.abs(v.width-1024)<=.5&&Math.abs(v.height-768)<=.5);
   row.after=await bounded(pageState);update();remaining();page(row.after);row.status='verified';update();
   if(actual.axWindowCount===1){report.status='ready';update();remaining();return report;}
   assert.ok(index<14,'Source-window sample bound exhausted');assert.ok(remaining()>100,'No preparation budget for passive interval');report.waitsMs.push(100);update();await delay(100);update();remaining();
  }
  throw Error('Source-window preparation exhausted');
 }catch(error){report.status='refused';report.error={message:String(error.message??error),execution:error.execution??null};update();error.readiness=report;throw error;}
}
