// SPDX-License-Identifier: MIT OR Apache-2.0
import {isProxy} from 'node:util/types';
import {loadMountedResourceProfile67 as loadPrevious, assertResourceProfileBinding67 as checkPrevious,
  RESOURCE_PROFILE67_ID} from './resource-profile67.mjs';
import {descriptorPin,descriptorPath,selfPath,hash,exact,decodeDescriptor,previousBytes,requireSource} from './renderer-source-data.mjs';
export * from './resource-profile67.mjs';
const maxFile=1048576, maxTotal=8388608, sidecar='renderer-source-runtime-before.json';
async function descriptor(read){return decodeDescriptor(await read(descriptorPath,descriptorPin.bytes));}
const pin=(path,bytes)=>({path,bytes:bytes.length,sha256:hash(bytes)});
async function readExact(read,p){return exact(await read(p.path,p.bytes),p);}
function baseReader(read,d) {
  const changes=new Map(d.changes.map(entry=>[entry.previous.path,entry]));
  return async(path,max)=>{
    const entry=changes.get(path);
    if(!entry) return read(path,max);
    requireSource(Number.isSafeInteger(max)&&max>=entry.previous.bytes && max<=268435456,'historical bound '+path);
    return previousBytes(entry,await read(entry.current.path,entry.current.bytes));
  };
}
async function inventory(read,d,sourceSHA){
  requireSource(typeof sourceSHA==='string' && /^[a-f0-9]{40}$/.test(sourceSHA)&&sourceSHA.length===40,'source SHA');
  const prior=JSON.parse(Buffer.from(await readExact(read,d.profile)).toString('utf8'));
  const known=new Map([...prior.source.rawKnownPins,d.profile,...d.changes.map(r=>r.current),...d.extra].map(p=>[p.path,p]));
  const paths=[...new Set([...prior.source.rawPaths,...d.extra.map(p=>p.path),descriptorPath,selfPath])].sort();
  const pins=[];let total=0;
  for(const path of paths){
    const expected=path===descriptorPath?descriptorPin:known.get(path);
    requireSource(expected||[selfPath,'scripts/mounted-corpus/resource-profile67.mjs'].includes(path),'unbound '+path);
    const bytes=expected?await readExact(read,expected):await read(path,maxFile);
    requireSource(bytes instanceof Uint8Array && bytes.length>0 && bytes.length<=maxFile,path);
    total+=bytes.length;requireSource(total<=maxTotal,'inventory byte limit');
    pins.push(pin(path,bytes));
  }
  const emitted = [];
  let emittedBytes = 0;
  for (const expected of d.emitted) {
    const bytes = await readExact(read,expected);
    emittedBytes += bytes.length;
    requireSource(bytes.length <= maxFile && emittedBytes <= maxTotal,'emitted byte limit');
    emitted.push(pin(expected.path,bytes));
  }
  const lookup=path=>pins.find(p=>p.path===path);
  return {format:'mounted-corpus-renderer-source-inventory/2',sourceSHA,base:d.base,pins,emitted,
    resourceProfile:{id:RESOURCE_PROFILE67_ID,selectedProfile:RESOURCE_PROFILE67_ID,descriptor:d.profile,
      policyModule:lookup('scripts/mounted-corpus/resource-profile67.mjs'),control:lookup('tests/mounted-corpus-resource-profile67.node.mjs'),baseSchema:prior.baseSchema.pin}};
}
export async function captureRendererInventory(read,sourceSHA){return inventory(read,await descriptor(read),sourceSHA);}
export async function loadMountedResourceProfile67({readArtifact,resourceProfile}){
  requireSource(resourceProfile===RESOURCE_PROFILE67_ID,'explicit resource profile required');
  const d=await descriptor(readArtifact);
  const verifyCurrent = async () => {
    await readExact(readArtifact,descriptorPin);
    for (const p of [...d.changes.map(change => change.current),...d.extra]) {
      await readExact(readArtifact,p);
    }
  };
  await verifyCurrent();
  const prior = await loadPrevious({readArtifact:baseReader(readArtifact,d),resourceProfile});
  const profile = JSON.parse(Buffer.from(await readExact(readArtifact,d.profile)).toString('utf8'));
  const authorityPath = 'contracts/mounted-e2e/v1.1/source-continuation47.json';
  const authorityPin = profile.source.rawKnownPins.find(p => p.path === authorityPath);
  const {authorities} = JSON.parse(Buffer.from(await readExact(readArtifact,authorityPin)).toString('utf8'));
  const bounds = new Map(authorities.map(item => [item.path,item.historical.bytes]));
  return {
    async verifyAll() {
      await verifyCurrent();
      return {format:'mounted-corpus-renderer-source-proof/1',base:d.base,descriptor:Object.freeze({...descriptorPin}),previous:await prior.verifyAll()};
    },
    captureRuntimeInventory:sourceSHA=>captureRendererInventory(readArtifact,sourceSHA),
    historicalAuthorityReader(fallback) {
      const next = prior.historicalAuthorityReader(fallback);
      return async (path,max) => {
        if (bounds.has(path)) {
          requireSource(Number.isSafeInteger(max) && max >= bounds.get(path) && max <= 268435456,'historical bound '+path);
          await verifyCurrent();
        }
        return next(path,max);
      };
    },
  };
}

function samePin(value,pin){
  if(!value||typeof value!=='object'||isProxy(value)||Reflect.ownKeys(value).length!==3)return false;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype && prototype!==null)return false;
  return ['path','bytes','sha256'].every(key=>{
    const field=Object.getOwnPropertyDescriptor(value,key);
    return field?.enumerable && Object.hasOwn(field,'value') && field.value===pin[key];
  });
}
export async function assertResourceProfileBinding67({resourceProfile,runBinding,readArtifact}){
  const scenarioPins = runBinding?.scenarioPins ?? [];
  const markers = scenarioPins.filter(item => {
    requireSource(item && typeof item === 'object' && !isProxy(item),'scenario pin');
    const field = Object.getOwnPropertyDescriptor(item,'path');
    requireSource(field?.enumerable && typeof field.value === 'string','scenario pin path');
    return field.value.endsWith('/'+sidecar);
  });
  if(!markers.length)return checkPrevious({resourceProfile,runBinding,readArtifact});
  requireSource(markers.length===1&&resourceProfile===RESOURCE_PROFILE67_ID&&typeof readArtifact==='function','renderer binding');
  requireSource(!runBinding.scenarioPins.some(p=>p.path.endsWith('/source-continuation67-runtime-before.json')),'ambiguous runtime source');
  requireSource(typeof runBinding.runId==='string'&&runBinding.runId.length===46&&/^mounted45-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runBinding.runId),'run id');
  const marker = markers[0];
  const markerBytes = Object.getOwnPropertyDescriptor(marker,'bytes')?.value;
  const markerHash = Object.getOwnPropertyDescriptor(marker,'sha256')?.value;
  requireSource(typeof markerHash === 'string' && /^[0-9a-f]{64}$/.test(markerHash) && markerHash.length === 64
    && Number.isSafeInteger(markerBytes) && samePin(marker,{path:marker.path,bytes:markerBytes,sha256:markerHash}),'sidecar pin');
  requireSource(marker.path==='artifacts/mounted-corpus/runs/'+runBinding.runId+'/'+sidecar&&Number.isSafeInteger(marker.bytes)&&marker.bytes>0&&marker.bytes<=4194304,'sidecar');
  const expected=await inventory(readArtifact,await descriptor(readArtifact),runBinding.sourceSHA);
  const payload=Buffer.from(await readExact(readArtifact,marker));
  requireSource(payload.equals(Buffer.from(JSON.stringify(expected,null,2)+'\n')),'runtime inventory disagrees with current bytes');
  for(const p of [expected.resourceProfile.descriptor,expected.resourceProfile.policyModule,expected.resourceProfile.control,expected.resourceProfile.baseSchema]){
    const bound=runBinding.scenarioPins.filter(item=>item.path===p.path);
    requireSource(bound.length===1&&samePin(bound[0],p),'direct pin '+p.path);
  }
  return expected.resourceProfile;
}
