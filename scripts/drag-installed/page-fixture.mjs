// SPDX-License-Identifier: MIT OR Apache-2.0
import {installDragNativeHost} from '/drag-native-host.js';
import {boundedJson} from './protocol.mjs';
const base=new URL('.',import.meta.url);
const configResponse=await fetch(new URL('config',base));if(!configResponse.ok)throw Error('Closed44 broker config missing');
const config=await boundedJson(configResponse,4096);
const programsResponse=await fetch(new URL('oracles.json',base));if(!programsResponse.ok)throw Error('Frozen44 programs missing');
const programs=await boundedJson(programsResponse,1048576);
installDragNativeHost(config,programs);
