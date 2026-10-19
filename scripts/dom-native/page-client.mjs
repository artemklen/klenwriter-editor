// SPDX-License-Identifier: MIT OR Apache-2.0
// Fresh owned fixture only. No arbitrary evaluation or synthetic editor input.
import {limits,validCall,boundedJson} from './protocol.mjs';
const moduleBase = new URL('.',import.meta.url);
const configResponse = await fetch(new URL('config',moduleBase),{signal:AbortSignal.timeout(5000)});
if (!configResponse.ok) throw new Error('Fixture broker config unavailable');
const config = await boundedJson(configResponse,limits.commandBytes);
if (location.href !== config.fixtureUrl || !/^[a-f0-9]{32}$/.test(config.nonce)) throw new Error('Fixture broker location mismatch');
if (window.__domNativeHttpBroker) throw new Error('A page broker is already installed');
document.title = config.title;
if (window.domHostReady !== true) throw new Error('Mounted fixture is not ready');
await import('/dom-native-host.js');
let mountedId = null, guardSerial = 0, stopped = false, polls = 0;
const executed = new Set();
window.__domNativeHttpBroker = {nonce:config.nonce,title:config.title};
async function send(path,value) {
  const response = await fetch(new URL(path,moduleBase),{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({nonce:config.nonce,...value}),signal:AbortSignal.timeout(5000)});
  const result = await boundedJson(response,limits.commandBytes);
  if (!response.ok) throw new Error('Fixture broker rejected '+path+': '+response.status);
  return result;
}
function documentGuard() {
  return {nonce:config.nonce,url:location.href,title:document.title,documentFocused:document.hasFocus(),mountedId};
}
function guard() {
  const result = {...documentGuard(),serial:++guardSerial};
  const editor = mountedId ? document.getElementById(mountedId) : null;
  const control = document.getElementById('host-recovery-control'), active = document.activeElement;
  const owned = !!editor?.isConnected && editor.parentElement === document.getElementById('mounts');
  const exactEditor = owned && (active === editor || editor.contains(active));
  const exactControl = active === control && !!control?.isConnected;
  return {...result,editorConnected:owned,activeElementId:active?.id??null,
    target:exactEditor?'editor':exactControl?'host-control':'blocked',
    allowed:result.url===config.fixtureUrl && result.title===config.title && result.documentFocused && owned && (exactEditor||exactControl)};
}
await send('page/ready',{url:location.href,title:document.title,userAgent:navigator.userAgent,platform:navigator.platform,language:navigator.language});
async function runCommand(command) {
  if (!command || typeof command.id !== 'string' || !command.id.startsWith(config.nonce+':') || !validCall(command.method,command.args)) throw new Error('Invalid closed page command');
  if (executed.has(command.id) || executed.size >= limits.commands || Date.now() > command.deadline) throw new Error('Duplicate, expired or excess page command');
  executed.add(command.id); // At-most-once, before any native operation or await.
  let result;
  try {
    let value;
    if (command.method === 'documentGuard') value = documentGuard();
    else if (command.method === 'guard') value = guard();
    else {
      if (location.href !== config.fixtureUrl || document.title !== config.title) throw new Error('Owned fixture left its fixed location/title');
      value = await window.domNative[command.method](...command.args);
      if (command.method === 'prepare') {
        if (typeof value?.id !== 'string' || !/^mount-[1-9][0-9]{0,8}$/.test(value.id)) throw new Error('Prepared mount identity is invalid');
        mountedId = value.id;
      }
      if (command.method === 'finish') mountedId = null;
    }
    result = {id:command.id,ok:true,value};
  } catch (error) { result = {id:command.id,ok:false,error:String(error?.message??error).slice(0,2048)}; }
  const json = JSON.stringify({nonce:config.nonce,...result});
  if (new TextEncoder().encode(json).length > limits.resultBytes) throw new Error('Native result exceeds broker bound');
  await send('page/result',result); // No replay/resend if execution or transport fails.
}
(async()=>{
  while (!stopped && Date.now() <= config.expiresAt && ++polls <= limits.polls) {
    const response = await fetch(new URL('page/poll',moduleBase),{signal:AbortSignal.timeout(5000)});
    const result = await boundedJson(response,limits.commandBytes);
    if (!response.ok) throw new Error('Fixture broker poll stopped: '+response.status);
    if (result.command) await runCommand(result.command);
    await new Promise(resolve=>setTimeout(resolve,100));
  }
  stopped = true;
})().catch(error=>{
  stopped = true;
  window.__domNativeHttpBroker.error = String(error?.message??error).slice(0,2048);
});
