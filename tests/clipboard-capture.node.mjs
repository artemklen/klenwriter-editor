// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled DataTransfer-like capture only: no parser, editor, browser, OS or clipboard access.
import test from 'node:test';
import assert from 'node:assert/strict';
import {captureClipboard,clipboardCaptureLimits,unsupportedClipboardFragmentMime} from '../packages/dom/dist/clipboard-capture.js';
const P='text/plain',H='text/html';
function fixture({types=[P,H],items=[],files=0,values={[P]:'plain',[H]:'<p>rich</p>'},read}={}){
  const calls=[];
  const source={types,items,files:{length:files},getData(format){calls.push(format);return read?read(format):values[format];}};
  return{source,calls};
}
const receipt=(result,format)=>result.representations[format];
const frozen=value=>{if(value&&typeof value==='object'){assert.equal(Object.isFrozen(value),true);for(const v of Object.values(value))frozen(v);}};

test('PCAP01 exact exposed CRLF combining astral NBSP and unpaired UTF16 strings survive immutable capture',()=>{
  const plain='A\r\ne\u0301\u00a0😀\ud800Z',html='<p>e\u0301\udfff</p>',f=fixture({values:{[P]:plain,[H]:html}}),result=captureClipboard(f.source);
  assert.equal(result.status,'captured');assert.equal(result.reason,null);assert.equal(result.scope,'selected_exposed_strings');assert.deepEqual(f.calls,[P,H]);
  assert.deepEqual(receipt(result,P),{status:'complete_local',availability:'declared',readAttempted:true,text:plain,utf16Units:plain.length});
  assert.equal(receipt(result,H).text,html);assert.equal(result.retainedUtf16Units,plain.length+html.length);frozen(result);
  f.source.types[0]='foreign';f.source.items.push({kind:'file',type:'image/png'});f.source.getData=()=>{throw Error('late source must not be consulted');};
  assert.deepEqual(result.metadata.types,[P,H]);assert.deepEqual(result.metadata.items,[]);assert.equal(receipt(result,P).text,plain);
  const checkData=value=>{if(value&&typeof value==='object'){assert.notEqual(value,f.source);for(const v of Object.values(value))checkData(v);}else assert.ok(['string','number','boolean'].includes(typeof value)||value===null);};checkData(result);
});
test('PCAP02 sixteen total metadata entries succeed and cap+1 refuses before any indexed reads or source strings',()=>{
  const f=fixture({types:[P,H,...Array.from({length:6},(_,i)=>'application/x-'+i)],items:Array.from({length:8},()=>({kind:'string',type:''}))});
  const exact=captureClipboard(f.source);assert.equal(exact.status,'captured');assert.deepEqual(exact.metadata.counts,{types:8,items:8,files:0});assert.deepEqual(f.calls,[P,H]);
  let indexed=0,read=0;const types={length:9,get 0(){indexed++;throw Error('not within total budget');}};
  const over=captureClipboard({types,items:{length:8},files:{length:0},getData(){read++;return'not read';}});
  assert.equal(over.reason,'metadata_limit');assert.equal(over.metadata.status,'limit');assert.equal(indexed,0);assert.equal(read,0);assert.equal(over.metadata.media,'unknown');
  for(const format of[P,H])assert.equal(receipt(over,format).status,'unread_due_limit');
});
test('PCAP03 MIME length128 is retained exactly while129 refuses before text capture',()=>{
  const f=fixture({types:['x'.repeat(128),P]});assert.equal(captureClipboard(f.source).status,'captured');assert.deepEqual(f.calls,[P]);
  const g=fixture({types:['x'.repeat(129),P]});const result=captureClipboard(g.source);assert.equal(result.reason,'metadata_limit');assert.deepEqual(g.calls,[]);assert.equal(result.retainedUtf16Units,0);
});
test('PCAP04 complete representation and aggregate exact maxima remain complete with no truncation',()=>{
  assert.deepEqual(clipboardCaptureLimits,{metadataEntries:16,mimeUtf16:128,representationUtf16:524288,aggregateUtf16:1048576});
  const plain='a'.repeat(524288),html='b'.repeat(524288),f=fixture({values:{[P]:plain,[H]:html}}),result=captureClipboard(f.source);
  assert.equal(result.status,'captured');assert.equal(result.retainedUtf16Units,1048576);assert.equal(receipt(result,P).text,plain);assert.equal(receipt(result,H).text,html);assert.deepEqual(f.calls,[P,H]);
});
test('PCAP05 oversize plain is not retained and prevents a later rich read instead of a prefix or hash backup',()=>{
  const f=fixture({values:{[P]:'a'.repeat(524289),[H]:'<p>not read</p>'}}),result=captureClipboard(f.source);
  assert.equal(result.status,'refused');assert.equal(result.reason,'representation_limit');assert.deepEqual(f.calls,[P]);assert.equal(result.retainedUtf16Units,0);
  assert.deepEqual(receipt(result,P),{status:'oversize_not_retained',availability:'declared',readAttempted:true,text:null,utf16Units:524289});
  assert.deepEqual(receipt(result,H),{status:'unread_due_limit',availability:'declared',readAttempted:false,text:null,utf16Units:null});
});
test('PCAP06 oversize rich preserves the earlier exact complete plain without granting fallback eligibility',()=>{
  const plain='e\u0301\r\n\ud800',f=fixture({values:{[P]:plain,[H]:'x'.repeat(524289)}}),result=captureClipboard(f.source);
  assert.equal(result.status,'refused');assert.equal(result.reason,'representation_limit');assert.equal(receipt(result,P).status,'complete_local');assert.equal(receipt(result,P).text,plain);
  assert.equal(receipt(result,H).status,'oversize_not_retained');assert.equal(result.retainedUtf16Units,plain.length);assert.deepEqual(f.calls,[P,H]);
});
test('PCAP07 late getData failure keeps complete plain and cannot become an empty successful capture',()=>{
  const f=fixture({read:format=>{if(format===H)throw Error('controlled late read failure');return 'original\r\nplain';}}),result=captureClipboard(f.source);
  assert.equal(result.status,'refused');assert.equal(result.reason,'representation_read_failed');assert.equal(receipt(result,P).text,'original\r\nplain');
  assert.deepEqual(receipt(result,H),{status:'read_failed',availability:'declared',readAttempted:true,text:null,utf16Units:null});assert.deepEqual(f.calls,[P,H]);assert.equal(result.retainedUtf16Units,15);
});
test('PCAP08 late metadata exception preserves bounded evidence and makes no source-string reads',()=>{
  let calls=0;const source={types:[P],items:[{kind:'string',get type(){throw Error('controlled metadata failure');}}],files:{length:0},getData(){calls++;return 'must not read';}};
  const result=captureClipboard(source);assert.equal(result.status,'refused');assert.equal(result.reason,'metadata_read_failed');assert.deepEqual(result.metadata.types,[P]);assert.equal(result.metadata.status,'read_failed');
  assert.equal(calls,0);assert.equal(receipt(result,P).status,'read_failed');assert.equal(receipt(result,P).availability,'declared');assert.equal(receipt(result,P).readAttempted,false);assert.equal(result.retainedUtf16Units,0);
});
test('PCAP09 known internal MIME in bounded types or items is explicit unsupported and never read or silently downgraded',()=>{
  for(const f of[fixture({types:[P,H,unsupportedClipboardFragmentMime.toUpperCase()]}),fixture({items:[{kind:'string',type:unsupportedClipboardFragmentMime}]})]){
    const result=captureClipboard(f.source);assert.equal(result.status,'refused');assert.equal(result.reason,'unsupported_internal');assert.equal(result.metadata.internalFragment,'present');assert.deepEqual(f.calls,[]);assert.equal(result.retainedUtf16Units,0);
    for(const format of[P,H]){assert.equal(receipt(result,format).text,null);assert.equal(receipt(result,format).readAttempted,false);}
  }
});
test('PCAP10 file and image evidence is retained without reading a binary or deciding semantic admission',()=>{
  let binaryReads=0;const item={kind:'file',type:'image/png',get getAsFile(){binaryReads++;throw Error('binary forbidden');},get getAsString(){binaryReads++;throw Error('callback forbidden');}};
  const f=fixture({types:[P,'Files'],items:[item],files:1});Object.defineProperty(f.source.files,'0',{get(){binaryReads++;throw Error('file body forbidden');}});
  const result=captureClipboard(f.source);assert.equal(binaryReads,0);assert.equal(result.metadata.media,'present');assert.deepEqual(result.metadata.items,[{kind:'file',type:'image/png'}]);assert.equal(result.metadata.counts.files,1);
  assert.equal(result.status,'captured','Raw capture completeness is separate from media admission');assert.equal(receipt(result,P).text,'plain');assert.deepEqual(f.calls,[P]);
  for(const type of['AUDIO/WAV','video/mp4']){const f=fixture({types:[P,type]});assert.equal(captureClipboard(f.source).metadata.media,'present');assert.deepEqual(f.calls,[P]);}
  const partial=fixture({items:[{kind:'file',get type(){throw Error('metadata unavailable after file evidence');}}]});const failed=captureClipboard(partial.source);
  assert.equal(failed.reason,'metadata_read_failed');assert.equal(failed.metadata.media,'present');assert.deepEqual(partial.calls,[]);
});
test('PCAP11 missing source absent selected formats and exposed empty string have distinct truthful receipts',()=>{
  const missing=captureClipboard(null);assert.equal(missing.reason,'metadata_unavailable');assert.equal(receipt(missing,P).availability,'unknown');
  const absent=fixture({types:[]}),noFormats=captureClipboard(absent.source);assert.equal(noFormats.reason,'no_selected_format');assert.equal(receipt(noFormats,P).availability,'not_declared');assert.deepEqual(absent.calls,[]);
  const empty=fixture({types:[P],values:{[P]:''}}),result=captureClipboard(empty.source);assert.equal(result.status,'captured');assert.equal(result.scope,'selected_exposed_strings');assert.equal(receipt(result,P).status,'complete_local');assert.equal(receipt(result,P).text,'');assert.equal(receipt(result,P).utf16Units,0);assert.equal(receipt(result,H).status,'unavailable');assert.deepEqual(empty.calls,[P]);
});
test('PCAP12 nonprimitive reads and inaccessible reader fail without coercion or replacing earlier values',()=>{
  let coerced=0;const f=fixture({types:[P],read:()=>({toString(){coerced++;throw Error('coercion forbidden');}})}),result=captureClipboard(f.source);
  assert.equal(result.reason,'representation_read_failed');assert.equal(receipt(result,P).text,null);assert.equal(coerced,0);assert.deepEqual(f.calls,[P]);
  let accesses=0;const source={types:[P,H],items:[],files:{length:0},get getData(){accesses++;throw Error('reader unavailable');}};
  const inaccessible=captureClipboard(source);assert.equal(inaccessible.reason,'representation_read_failed');assert.equal(accesses,1);assert.equal(receipt(inaccessible,P).readAttempted,false);assert.equal(receipt(inaccessible,H).readAttempted,false);
});
test('PCAP13 a failed first representation does not erase a later complete one or authorize fallback',()=>{
  const f=fixture({types:['TEXT/PLAIN','text/html'],read:format=>{if(format===P)throw Error('first failure');return'<p>complete exposed</p>';}}),result=captureClipboard(f.source);
  assert.equal(result.status,'refused');assert.equal(result.reason,'representation_read_failed');assert.deepEqual(result.metadata.types,['TEXT/PLAIN',H]);assert.deepEqual(f.calls,[P,H]);
  assert.equal(receipt(result,P).status,'read_failed');assert.equal(receipt(result,H).status,'complete_local');assert.equal(receipt(result,H).text,'<p>complete exposed</p>');assert.equal(result.retainedUtf16Units,23);
});
