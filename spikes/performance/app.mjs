const startupBegin = performance.now();
const fetchBegin = performance.now();
const bytes = await (await fetch('/kernel.wasm')).arrayBuffer();
const fetchedAt = performance.now();
const { instance } = await WebAssembly.instantiate(bytes, {});
const instantiatedAt = performance.now();
const wasm = instance.exports;
const editor = document.querySelector('#editor');
const viewport = document.querySelector('#viewport');
let documentFixture;
let wire;
let checksum = 0;
let typingEpoch = 0;
let pendingTyping = null;
const typingSamples = [];
const typingEvents = [];
let initialTextLength = 0;
const eventTiming = [];
let eventTimingSupported = false;
try {
  if (PerformanceObserver.supportedEntryTypes.includes('event')) {
    const observer = new PerformanceObserver(list => eventTiming.push(...list.getEntries().map(e => ({ name:e.name,startTime:e.startTime,duration:e.duration,processingStart:e.processingStart,processingEnd:e.processingEnd,interactionId:e.interactionId }))));
    observer.observe({ type:'event', buffered:true, durationThreshold:16 }); eventTimingSupported = true;
  }
} catch { /* recorded as unsupported, not a fabricated latency */ }
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const renderOpportunity = async () => { await frame(); await frame(); };
function render() {
  const fragment = document.createDocumentFragment();
  const elements = [];
  for (const node of documentFixture.nodes) {
    const element = document.createElement(node.kind);
    if (node.text) element.append(document.createTextNode(node.text));
    else if (node.kind==='p') element.append(document.createElement('br')); // native caret placeholder, not a model text node
    (node.parent < 0 ? fragment : elements[node.parent]).append(element); elements.push(element);
  }
  editor.replaceChildren(fragment); viewport.scrollTop = 0;
  return editor.getBoundingClientRect().height; // forces layout in this measured phase
}
function stats(values) {
  const sorted = [...values].sort((a,b)=>a-b);
  const quantile = p => sorted[Math.max(0,Math.ceil(sorted.length*p)-1)] ?? null;
  return { n:values.length,p50:quantile(.5),p95:quantile(.95),p99:quantile(.99),min:sorted[0]??null,max:sorted.at(-1)??null, samples:values };
}
function timerResolution() {
  let previous=performance.now(),minimumPositiveMs=Infinity,positiveDeltas=0;
  for(let i=0;i<50000;i++){const now=performance.now();const delta=now-previous;if(delta>0){minimumPositiveMs=Math.min(minimumPositiveMs,delta);positiveDeltas++;}previous=now;}
  return { minimumObservedPositiveMs:Number.isFinite(minimumPositiveMs)?minimumPositiveMs:null,positiveDeltas,reads:50000,limitation:'Observed timer increments, not a guaranteed timer precision.' };
}
function adaptiveSample(batchFn) {
  const targetBatchMs=5,maxBatch=16777216,warmup=10,count=100;
  const elapsed=batch=>{const start=performance.now();checksum ^= batchFn(batch)||0;return performance.now()-start;};
  for(let i=0;i<5;i++)elapsed(1);
  let batch=1;const calibration=[];
  for(;;){const probes=[elapsed(batch),elapsed(batch),elapsed(batch)];calibration.push({batch,elapsedMs:probes});if(Math.min(...probes)>=targetBatchMs||batch>=maxBatch)break;batch*=2;}
  for(let i=0;i<warmup;i++)elapsed(batch);
  const batchElapsedMs=[];
  for(let i=0;i<count;i++)batchElapsedMs.push(elapsed(batch));
  return {...stats(batchElapsedMs.map(value=>value/batch)),operationsPerSample:batch,targetBatchMs,warmup,calibration,batchElapsedMs,zeroBatchSamples:batchElapsedMs.filter(value=>value===0).length};
}
editor.addEventListener('keydown',event=>{typingEvents.push({type:'keydown',key:event.key,target:event.target.tagName,time:performance.now()}); if(event.key==='x') pendingTyping={ epoch:typingEpoch,keyStart:performance.now(),trustedKey:event.isTrusted }; });
editor.addEventListener('input',async event=>{
  typingEvents.push({type:'input',data:event.data,inputType:event.inputType,target:event.target.tagName,time:performance.now()});
  if (!pendingTyping || event.data!=='x') return;
  const started=pendingTyping; pendingTyping=null; const inputAt=performance.now();
  await renderOpportunity();
  if(started.epoch===typingEpoch) typingSamples.push({ keyToSecondRafMs:performance.now()-started.keyStart,inputToSecondRafMs:performance.now()-inputAt,trustedKey:started.trustedKey,trustedInput:event.isTrusted });
});
window.osr61 = {
  ready:true,
  startup:{ moduleStartMs:startupBegin,fetchWasmMs:fetchedAt-fetchBegin,instantiateMs:instantiatedAt-fetchedAt,navigationToWasmReadyMs:instantiatedAt,wasmBytes:bytes.byteLength },
  async load(id) {
    const start=performance.now(); documentFixture=await(await fetch(`/corpus/${id}.json`)).json(); const parsedAt=performance.now();
    wire=new Uint8Array(await(await fetch(`/corpus/${id}.bin`)).arrayBuffer());const wireFetchedAt=performance.now();
    const pointer=wasm.prepare_input(wire.length);new Uint8Array(wasm.memory.buffer,pointer,wire.length).set(wire);const copiedAt=performance.now();
    const result=wasm.load_document();if(result!==0)throw new Error(`Calibration load rejected: ${result}`);const loadedAt=performance.now();
    const outputLength=wasm.export_document();const out=new Uint8Array(wasm.memory.buffer,wasm.output_pointer(),outputLength);
    if(out.length!==wire.length||!out.every((v,i)=>v===wire[i]))throw new Error('Kernel roundtrip differs');
    const renderStart=performance.now();render();const layoutAt=performance.now();await renderOpportunity();
    return { fetchParseJsonMs:parsedAt-start,fetchWireMs:wireFetchedAt-parsedAt,inputCopyMs:copiedAt-wireFetchedAt,kernelLoadMs:loadedAt-copiedAt,initialBuildLayoutMs:layoutAt-renderStart,initialBuildToSecondRafMs:performance.now()-renderStart,wasmLinearBytes:wasm.memory.buffer.byteLength,nodeCount:wasm.node_count(),textBytes:wasm.text_bytes(),roundtripExact:true };
  },
  async measure() {
    let index=documentFixture.nodes.findIndex(n=>n.text.length>0);if(index<0)index=0;
    const timer=timerResolution();
    const crossing=adaptiveSample(batch=>{let sum=0;for(let i=0;i<batch;i++)sum^=wasm.crossing_counter(i);return sum});
    const coreEditPair=adaptiveSample(batch=>wasm.edit_pair_batch(index,batch));
    const exportKernel=adaptiveSample(batch=>{let sum=0;for(let i=0;i<batch;i++)sum^=wasm.export_document();return sum});
    const outputLength=wasm.export_document();
    const crossingPayloadCopy=adaptiveSample(batch=>{let sum=0;for(let i=0;i<batch;i++){const copy=new Uint8Array(wasm.memory.buffer,wasm.output_pointer(),outputLength).slice();sum^=copy[copy.length-1]}return sum});
    for(let i=0;i<3;i++){render();await frame();}
    const renderSamples=[];
    for(let i=0;i<20;i++){const start=performance.now();render();renderSamples.push(performance.now()-start);await frame();}
    const domBuildLayout=stats(renderSamples);
    await renderOpportunity();
    const length=wasm.export_document();const output=new Uint8Array(wasm.memory.buffer,wasm.output_pointer(),length);
    if(output.length!==wire.length||!output.every((v,i)=>v===wire[i]))throw new Error('Edit-pair/export changed content');
    return { timer,crossingCallMs:crossing,coreEditPairMs:coreEditPair,exportKernelMs:exportKernel,crossingPayloadCopyMs:crossingPayloadCopy,domBuildLayoutMs:domBuildLayout,wasmLinearHighWaterBytes:wasm.memory.buffer.byteLength,editPairRoundtripExact:true,checksum };
  },
  prepareTyping() {
    render();typingEpoch++;typingSamples.length=0;typingEvents.length=0;eventTiming.length=0;pendingTyping=null;initialTextLength=editor.textContent.length;
    let target=editor.querySelector('p,td')??editor.firstElementChild;
    target.focus();editor.focus();const range=document.createRange();range.selectNodeContents(target);range.collapse(false);const selection=getSelection();selection.removeAllRanges();selection.addRange(range);target.scrollIntoView({block:'center'});
    return { actualActive:document.activeElement.id,initialTargetText:target.textContent };
  },
  typingCount:()=>typingSamples.length,
  typingDebug(){return {events:typingEvents,sampleCount:typingSamples.length,active:document.activeElement.id,selection:getSelection()?.toString(),initialTextLength,finalTextLength:editor.textContent.length};},
  typingResult(warmup) {return { warmupExcluded:warmup,samples:typingSamples.slice(warmup),keyToSecondRafMs:stats(typingSamples.slice(warmup).map(s=>s.keyToSecondRafMs)),inputToSecondRafMs:stats(typingSamples.slice(warmup).map(s=>s.inputToSecondRafMs)),eventTimingSupported,eventTiming,insertedUtf16Units:editor.textContent.length-initialTextLength,wasmLinearBytes:wasm.memory.buffer.byteLength,limitation:'Native DOM typing only: this path does not call the calibration kernel. Second rAF is a rendering-opportunity proxy, not a physical display/paint measurement.' };},
};
