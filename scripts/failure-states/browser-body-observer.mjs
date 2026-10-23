// SPDX-License-Identifier: MIT OR Apache-2.0
// Observation only: no request replay, response replacement or source-byte fallback.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

const root=new URL('../../',import.meta.url);
const contractPath='contracts/failure-states/v1/browser-body-observer.json';
const read=path=>readFileSync(new URL(path,root));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const browserBodyObserverContract=JSON.parse(read(contractPath));
export const browserBodyObserverPins={contract:sha(read(contractPath)),helper:sha(read('scripts/failure-states/browser-body-observer.mjs'))};
assert.equal(browserBodyObserverContract.format,'editor-failure-states/browser-body-observer/1');
assert.deepEqual(browserBodyObserverContract.limits,{maxBodyBytes:16777216,maxDocumentBytes:67108864,maxFetchRecords:128,maxErrorRecords:32,maxCheckpoints:32,maxMetadataStringUnits:2048});

// Serialized by addInitScript; keep this function self-contained.
function installFetchBodyObserver({limits}){
  const nativeFetch=globalThis.fetch,promiseThen=Promise.prototype.then,responseClone=Response.prototype.clone;
  const responseUrl=Object.getOwnPropertyDescriptor(Response.prototype,'url').get;
  const responseStatus=Object.getOwnPropertyDescriptor(Response.prototype,'status').get;
  const responseHeaders=Object.getOwnPropertyDescriptor(Response.prototype,'headers').get;
  const responseBody=Object.getOwnPropertyDescriptor(Response.prototype,'body').get;
  const headersGet=Headers.prototype.get,streamReader=ReadableStream.prototype.getReader;
  const readerRead=ReadableStreamDefaultReader.prototype.read,readerCancel=ReadableStreamDefaultReader.prototype.cancel;
  const readerRelease=ReadableStreamDefaultReader.prototype.releaseLock;
  const records=[],errors=[],pending=new Set();let overflow=false,totalBytes=0,sequence=0;
  const timeOrigin=performance.timeOrigin;
  const fail=(message)=>{if(errors.length<limits.maxErrorRecords)errors.push(String(message).slice(0,limits.maxMetadataStringUnits));else overflow=true;};
  const string=value=>{if(value.length>limits.maxMetadataStringUnits){overflow=true;throw Error('Fetch metadata string budget');}return value;};
  const observe=async(response,record)=>{
    let reader;const chunks=[];
    try{
      record.responseUrl=string(Reflect.apply(responseUrl,response,[]));
      record.status=Reflect.apply(responseStatus,response,[]);
      record.contentType=string(Reflect.apply(headersGet,Reflect.apply(responseHeaders,response,[]),['content-type'])??'');
      const clone=Reflect.apply(responseClone,response,[]),body=Reflect.apply(responseBody,clone,[]);
      if(body){
        reader=Reflect.apply(streamReader,body,[]);
        while(true){
          const item=await Reflect.apply(readerRead,reader,[]);if(item.done)break;
          if(!(item.value instanceof Uint8Array))throw Error('Fetch clone did not yield byte chunks');
          const nextBody=record.bytes+item.value.byteLength,nextDocument=totalBytes+item.value.byteLength;
          if(nextBody>limits.maxBodyBytes||nextDocument>limits.maxDocumentBytes){overflow=true;throw Error('Fetch body observation byte budget');}
          record.bytes=nextBody;totalBytes=nextDocument;chunks.push(new Uint8Array(item.value));
        }
      }
      const bytes=new Uint8Array(record.bytes);let offset=0;
      for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      record.sha256=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),byte=>byte.toString(16).padStart(2,'0')).join('');
      record.bodyStatus='complete';
    }catch(error){
      record.bodyStatus='error';record.error=String(error?.message??error).slice(0,limits.maxMetadataStringUnits);fail(record.error);
      if(reader)try{void Reflect.apply(promiseThen,Reflect.apply(readerCancel,reader,[]),[undefined,()=>{}]);}catch{}
    }finally{
      chunks.length=0;
      if(reader)try{Reflect.apply(readerRelease,reader,[]);}catch(error){fail(error?.message??error);record.bodyStatus='error';}
      record.finished=performance.now();
    }
  };
  function fetch(...args){
    // Calling native first preserves synchronous validation and never rereads args/getters.
    const original=Reflect.apply(nativeFetch,this,args);
    if(records.length>=limits.maxFetchRecords){overflow=true;return original;}
    const record={sequence:++sequence,source:'browser-native-fetch-response-clone',responseUrl:null,status:null,contentType:null,bytes:0,sha256:null,timeOrigin,
      started:performance.now(),finished:null,bodyStatus:'pending',methodProvenance:'unique-actual-network-ledger-join'};
    records.push(record);
    const observed=Reflect.apply(promiseThen,original,[response=>{
      const work=observe(response,record);pending.add(work);
      void Reflect.apply(promiseThen,work,[()=>pending.delete(work),error=>{pending.delete(work);fail(error?.message??error);record.bodyStatus='error';}]);
    },error=>{record.bodyStatus='error';record.finished=performance.now();record.error=String(error?.message??error).slice(0,limits.maxMetadataStringUnits);fail(`Native fetch rejected: ${record.error}`);}]);
    void Reflect.apply(promiseThen,observed,[undefined,error=>{fail(error?.message??error);record.bodyStatus='error';}]);
    return original;
  }
  let fetchOwner=globalThis,fetchDescriptor;
  while(fetchOwner&&!fetchDescriptor){fetchDescriptor=Object.getOwnPropertyDescriptor(fetchOwner,'fetch');fetchOwner=Object.getPrototypeOf(fetchOwner);}
  Object.defineProperty(globalThis,'fetch',{value:fetch,writable:fetchDescriptor?.writable??true,
    enumerable:fetchDescriptor?.enumerable??true,configurable:fetchDescriptor?.configurable??true});
  Object.defineProperty(globalThis,'__failureFetchBodyObserver',{value:Object.freeze({
    async read(){
      await Promise.all([...pending]);
      return{format:'editor-failure-states/browser-fetch-bodies/1',timeOrigin,totalBytes,pending:pending.size,overflow,
        errors:errors.slice(),records:records.map(record=>({...record}))};
    }
  })});
}

export async function observeBrowserFetchBodies(context,{origin,files,fail}){
  const limits=browserBodyObserverContract.limits,epochs=new Map(),checkpoints=[];
  await context.addInitScript(installFetchBodyObserver,{limits});
  const require=(condition,message)=>{if(!condition){fail(message);assert(condition,message);}};
  const epochOf=item=>item.documentEpoch??1;
  const assertJoined=(ledger,number=null)=>{
    for(const item of ledger.filter(value=>value.resourceType==='fetch'&&(number===null||epochOf(value)===number))){
      require(item.fetchBodyObservation!==undefined,`Fetch has no actual delivered-body join: epoch${epochOf(item)} ${item.phase} ${item.url}`);
    }
  };
  return{
    async settle(page,ledger,{documentEpoch=1,phase}){
      if(!page||page.isClosed()){assertJoined(ledger);return;}
      const value=await page.evaluate(()=>{
        if(!globalThis.__failureFetchBodyObserver)throw Error('Fetch-body observer was not installed before document code');
        return globalThis.__failureFetchBodyObserver.read();
      });
      require(value.format==='editor-failure-states/browser-fetch-bodies/1','Fetch-body snapshot format');
      require(Number.isFinite(value.timeOrigin)&&value.timeOrigin>0,'Fetch-body document timeOrigin');
      require(value.overflow===false&&value.pending===0&&value.errors.length===0,'Fetch-body observation overflow/error/incomplete work');
      require(value.totalBytes<=limits.maxDocumentBytes&&value.records.length<=limits.maxFetchRecords,'Fetch-body bounded document observation');
      const previous=epochs.get(documentEpoch);
      require(!previous||previous.timeOrigin===value.timeOrigin,`Unexpected document replacement within epoch${documentEpoch}`);
      require(![...epochs].some(([number,saved])=>number!==documentEpoch&&saved.timeOrigin===value.timeOrigin),'Fresh runtime epoch reused an old document');
      if(previous)require(value.records.length>=previous.records.length,'Fetch-body metadata disappeared before departure');
      const seen=new Set(),joined=[];
      for(const [index,record]of value.records.entries()){
        require(record.sequence===index+1&&!seen.has(record.sequence),'Duplicate/invalid/missing fetch-body record identity');seen.add(record.sequence);
        require(record.timeOrigin===value.timeOrigin&&record.bodyStatus==='complete'&&record.error===undefined,'Fetch body incomplete or failed');
        require(record.source==='browser-native-fetch-response-clone'&&record.methodProvenance==='unique-actual-network-ledger-join','Actual fetch body/method observation provenance');
        require(Number.isFinite(record.started)&&Number.isFinite(record.finished)&&record.finished>=record.started,'Complete monotonic fetch observation metadata');
        require(Number.isSafeInteger(record.bytes)&&record.bytes>=0&&record.bytes<=limits.maxBodyBytes&&/^[a-f0-9]{64}$/.test(record.sha256),'Complete bounded full-body SHA256');
        const matches=ledger.filter(item=>epochOf(item)===documentEpoch&&item.resourceType==='fetch'&&item.url===record.responseUrl);
        require(matches.length===1,`Unmatched/ambiguous fetch body: epoch${documentEpoch} ${record.responseUrl}`);
        const item=matches[0],expected=files.find(file=>origin+file.url===item.url);
        require(item.decision==='allow'&&item.method==='GET'&&expected!==undefined,'Fetch body belongs to a declared allowed actual GET');
        require(item.responseStatusOrFailure?.status===record.status&&record.status===expected.status,'Fetch-body actual network/Response status join');
        require(record.contentType.split(';')[0].trim()===expected.contentType,'Fetch-body actual MIME');
        require(record.bytes===expected.bytes&&record.sha256===expected.sha256,`Delivered bytes differ from reviewed producer: ${item.url}`);
        const observation={...record,method:item.method,phase:item.phase,documentEpoch,requestSequence:item.monotonicSequence};
        if(item.fetchBodyObservation)require(JSON.stringify(item.fetchBodyObservation)===JSON.stringify(observation),'Changed/duplicate fetch-body join');
        item.fetchBodyObservation=observation;
        item.responseStatusOrFailure.bytes=record.bytes;item.responseStatusOrFailure.sha256=record.sha256;
        item.responseStatusOrFailure.bodyObservation='browser-native-fetch-response-clone';joined.push(observation);
      }
      require(joined.reduce((sum,record)=>sum+record.bytes,0)===value.totalBytes,'Every observed fetch byte has exactly one full-body record');
      assertJoined(ledger,documentEpoch);
      if(previous)for(const record of previous.records)require(joined.some(current=>JSON.stringify(current)===JSON.stringify(record)),'Prior completed fetch record changed');
      const point={documentEpoch,phase,timeOrigin:value.timeOrigin,totalBytes:value.totalBytes,pending:value.pending,overflow:value.overflow,errors:value.errors,records:joined};
      require(checkpoints.length<limits.maxCheckpoints,'Fetch-body checkpoint metadata budget');
      checkpoints.push(point);epochs.set(documentEpoch,point);return point;
    },
    beforeDeparture(documentEpoch,ledger){
      const point=epochs.get(documentEpoch);
      require(point?.phase==='operation',`Epoch${documentEpoch} has no terminal operation body checkpoint before departure`);
      assertJoined(ledger,documentEpoch);
    },
    assertJoined,
    snapshot(){return{contractPins:browserBodyObserverPins,qualification:browserBodyObserverContract.qualification,
      checkpoints:structuredClone(checkpoints)};}
  };
}
