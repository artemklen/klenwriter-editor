// SPDX-License-Identifier: MIT OR Apache-2.0
import {limits,validCall,boundedJson} from './protocol.mjs';
const base=new URL('.',import.meta.url),response=await fetch(new URL('config',base),{signal:AbortSignal.timeout(5000)});
if(!response.ok)throw Error('Selection fixture broker config unavailable');
const config=await boundedJson(response,limits.commandBytes);
if(config.format!=='osr40-selection-http-broker/1'||location.href!==config.fixtureUrl||!/^[a-f0-9]{32}$/.test(config.nonce))throw Error('Selection fixture location mismatch');
if(window.__selectionNativeHttpBroker)throw Error('Selection broker already installed');
document.title=config.title;
if(window.selectionHostReady!==true)throw Error('Selection host is not ready');
await import('/selection-native-host.js');
if(!window.selectionNative)throw Error('Closed native selection fixture is unavailable');
let mountedId=null,serial=0,stopped=false,polls=0;const executed=new Set();
window.__selectionNativeHttpBroker={nonce:config.nonce,title:config.title};
async function send(path,value){
  const response=await fetch(new URL(path,base),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nonce:config.nonce,...value}),signal:AbortSignal.timeout(5000)});
  const result=await boundedJson(response,limits.commandBytes);if(!response.ok)throw Error('Selection broker rejected '+path+': '+response.status);return result;
}
function documentGuard(){return {nonce:config.nonce,url:location.href,title:document.title,documentFocused:document.hasFocus(),mountedId};}
await send('page/ready',{url:location.href,title:document.title,userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language});
async function command(call){
  if(!call||typeof call.id!=='string'||!call.id.startsWith(config.nonce+':')||!validCall(call.method,call.args))throw Error('Invalid closed selection command');
  if(executed.has(call.id)||executed.size>=limits.commands||Date.now()>call.deadline)throw Error('Duplicate, expired or excess selection command');
  executed.add(call.id); // Claim before any native method or await; never resubmit mutations.
  let result;
  try{
    let value;
    if(call.method==='documentGuard')value=documentGuard();
    else{
      if(location.href!==config.fixtureUrl||document.title!==config.title)throw Error('Selection fixture left its owned location/title');
      value=await window.selectionNative[call.method](...call.args);
      if(call.method==='prepare'){
        if(typeof value?.id!=='string'||!/^selection-mount-[1-9][0-9]{0,8}$/.test(value.id))throw Error('Invalid prepared selection mount');
        mountedId=value.id;
      }
      if(call.method==='guard'){
        if(value?.id!==mountedId||value?.action!==call.args[0])throw Error('Selection action guard differs from owned mount');
        value={...value,...documentGuard(),serial:++serial};
      }
      if(call.method==='finish')mountedId=null;
    }
    result={id:call.id,ok:true,value};
  }catch(error){result={id:call.id,ok:false,error:String(error?.message??error).slice(0,2048)};}
  if(new TextEncoder().encode(JSON.stringify({nonce:config.nonce,...result})).length>limits.resultBytes)throw Error('Selection result exceeds broker bound');
  await send('page/result',result); // Transport failure stops; executed call is not replayed.
}
(async()=>{while(!stopped&&Date.now()<=config.expiresAt&&++polls<=limits.polls){
  const response=await fetch(new URL('page/poll',base),{signal:AbortSignal.timeout(5000)});
  const value=await boundedJson(response,limits.commandBytes);if(!response.ok)throw Error('Selection poll stopped: '+response.status);
  if(value.command)await command(value.command);await new Promise(resolve=>setTimeout(resolve,50));
}stopped=true;})().catch(error=>{stopped=true;window.__selectionNativeHttpBroker.error=String(error?.message??error).slice(0,2048);});
