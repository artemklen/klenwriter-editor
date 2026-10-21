// SPDX-License-Identifier: MIT OR Apache-2.0
import {installDragNativeHost} from '/drag-native-host.js';
import {boundedJson} from './protocol.mjs';
const base=new URL('.',import.meta.url);
const configResponse=await fetch(new URL('config',base));if(!configResponse.ok)throw Error('Closed44 broker config missing');
const config=await boundedJson(configResponse,4096);
const programsResponse=await fetch(new URL('oracles.json',base));if(!programsResponse.ok)throw Error('Frozen44 programs missing');
const programs=await boundedJson(programsResponse,1048576);
// Installed-only static framing is ready before the first mount/baseline/input.
const stylesheet=document.createElement('link');stylesheet.rel='stylesheet';stylesheet.href=new URL('fixture.css',base).href;
await new Promise((resolve,reject)=>{
  const done=error=>{clearTimeout(timer);stylesheet.onload=stylesheet.onerror=null;if(error){stylesheet.remove();reject(error);}else resolve();};
  const timer=setTimeout(()=>done(Error('Closed44 fixture stylesheet load timed out')),5000);
  stylesheet.onload=()=>done();stylesheet.onerror=()=>done(Error('Closed44 fixture stylesheet load failed'));
  document.head.append(stylesheet);
});
installDragNativeHost(config,programs);
