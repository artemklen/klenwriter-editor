// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { captureActualMemory, ownedResourcesZero } from './perf-memory.mjs';

export function ok(response) {
  if (response.status !== 'ok') assert.equal(response.status, 'ok', JSON.stringify(response));
  return response.value;
}
const ticket = async result => result.status === 'completed' ? result.response : await result.completion;
export function sdkOptions(manifest, request) {
  const descriptor = JSON.parse(request.registry);
  return { abi: 'editor-sdk/2', build_id: manifest.build_id,
    profile: { profile_id: descriptor.profile.id, profile_version: descriptor.profile.version, codec_id: descriptor.profile.codec_id, wire_version: descriptor.profile.wire_version, extensions: descriptor.selected_extensions },
    admission: 'validate', access: 'editable', registry_json: request.registry,
    profile_options_json: JSON.stringify(request.profile === 'notes' ? { root_blocks: request.root_blocks, limits: null } : { identities: { media: [], references: [] }, limits: null }) };
}
function timerIncrement() {
  let previous = performance.now(), minimum = Infinity;
  for (let i = 0; i < 20000; i++) { const now = performance.now(); if (now > previous) minimum = Math.min(minimum, now - previous); previous = now; }
  return minimum * 1e6;
}
export async function runSdk(request) {
  const startup=performance.now();
  const sdk = await import(pathToFileURL(`${request.root}/packages/sdk/dist/index.js`).href);
  const capture = await captureActualMemory(() => sdk.loadSdkV2({ wasm: readFileSync(`${request.root}/packages/wasm/dist/editor_wasm_bg.wasm`) }));
  const startup_ns=(performance.now()-startup)*1e6;
  const module = capture.value, options = sdkOptions(module.manifest, request);
  const globalBefore = JSON.parse(module.resourceCounts());
  if(request.workload==='capacity') {
    const raw=new module.Session(new TextEncoder().encode(request.input),JSON.stringify(options));
    const response=JSON.parse(raw.initialization());
    let exportProbe=null,commands=[],commandFeasible=false;
    if(response.status==='ok'){
      const call=operation=>JSON.parse(raw.call(JSON.stringify(operation)));
      let state=ok(call({kind:'state'})).state;
      const snapshot=call({kind:'snapshot',stamp:state.stamp,max_bytes:16777216});
      exportProbe={feasible:snapshot.status==='ok',response:snapshot.status==='ok'?null:snapshot};
      if(snapshot.status==='ok'){assert.equal(snapshot.value.canonical_json,request.input);ok(call({kind:'release_snapshot',handle:snapshot.value.handle}));}
      for(let index=0;index<2;index++){
        let leaf=state.root;for(const part of request.first_text_path)leaf=ok(call({kind:'node',stamp:state.stamp,node:leaf})).node.children[part];
        ok(call({kind:'set_selection',stamp:state.stamp,selection:{anchor:{kind:'text',node:leaf,offset:0,affinity:'after'},focus:{kind:'text',node:leaf,offset:1,affinity:'before'}}}));
        state=ok(call({kind:'state'})).state;
        const command={id:'org.example.notes/command/insert-text',payload_json:JSON.stringify({text:index===0?'z':'x'})};
        const query=ok(call({kind:'query_command',stamp:state.stamp,command}));
        const executed=call({kind:'command',stamp:state.stamp,command,history_hint:{kind:'isolated'}});
        const feasible=executed.status==='ok'&&executed.value.effect==='changed';assert.equal(query.available,feasible,'actual same-request feasibility agreement');
        commands.push({feasible,query,response:executed});if(!feasible)break;
        state=ok(call({kind:'state'})).state;
        const events=ok(call({kind:'events'}));assert.equal(events.gap,false);if(events.events.length)ok(call({kind:'acknowledge_events',cursor:events.cursor}));
      }
      commandFeasible=commands.length===2&&commands.every(value=>value.feasible);
    }
    raw.destroy();raw.free();
    assert.deepEqual(JSON.parse(module.resourceCounts()),globalBefore);
    assert.ok(response.status==='ok'||response.status==='refused','capacity outcome must be typed');
    return {format:'editor-reliability-capacity/1',status:response.status==='ok'?'accepted':'refused',command_feasible:commandFeasible,commands,export:exportProbe,response,resources_after:JSON.parse(module.resourceCounts()),same_actual_instance_count:capture.instanceCount,build_id:module.manifest.build_id,
      codec_admission_work:'not exposed by public Notes API',default_work_units:1000000,default_work_bytes:67108864};
  }
  if (request.workload === 'lifecycle') {
    const samples = [], capacity_samples = [], sampled_process_rss = [], checkpoints = [];
    for (let index = 0; index < request.samples + request.warmup; index++) {
      const start = performance.now(); let resources;
      if (request.layer === 'sdk') {
        const controller = sdk.createEditor({ input: new TextEncoder().encode(request.input), options, loader: async () => module });
        ok(await controller.ready); ok(await ticket(controller.destroy())); resources = controller.resources(); ownedResourcesZero(resources);
      } else {
        assert.equal(request.layer, 'wasm-bridge');
        const raw = new module.Session(new TextEncoder().encode(request.input), JSON.stringify(options)); ok(JSON.parse(raw.initialization())); raw.destroy(); raw.free();
      }
      const elapsed = (performance.now() - start) * 1e6;
      assert.deepEqual(JSON.parse(module.resourceCounts()), globalBefore);
      if (index >= request.warmup) { samples.push(elapsed); capacity_samples.push(capture.memory.buffer.byteLength); sampled_process_rss.push(process.memoryUsage().rss); }
      if (index % 64 === 0) checkpoints.push({ cycle: index + 1, native_resources: JSON.parse(module.resourceCounts()), controller_resources: resources ?? null, capacity: capture.memory.buffer.byteLength });
    }
    return { format: 'editor-reliability-sdk-capture/1', samples, capacity_samples, sampled_process_rss, startup_ns, timerIncrement: timerIncrement(),
      same_actual_instance_count: capture.instanceCount, checkpoints, resources_after: JSON.parse(module.resourceCounts()), build_id: module.manifest.build_id,
      lifecycle_cycles: request.samples + request.warmup, scope: 'strict admit/destroy through declared public layer, packaged module initialized once outside lifecycle samples' };
  }
  let handle, editor;
  const admission = performance.now();
  if (request.layer === 'sdk') {
    editor = sdk.createEditor({ input: new TextEncoder().encode(request.input), options, loader: async () => module }); ok(await editor.ready);
    handle = { call: async operation => ['state', 'node', 'resources', 'catalog', 'map_position'].includes(operation.kind) ? editor.read(operation)
      : operation.kind.startsWith('query_') ? editor.query(operation) : ticket(editor.submit(operation)), destroy: async () => { ok(await ticket(editor.destroy())); } };
  } else {
    assert.equal(request.layer, 'wasm-bridge');
    const raw = new module.Session(new TextEncoder().encode(request.input), JSON.stringify(options)); ok(JSON.parse(raw.initialization()));
    handle = { call: async operation => JSON.parse(raw.call(JSON.stringify(operation))), destroy: async () => { raw.destroy(); raw.free(); } };
  }
  const admission_ns = (performance.now() - admission) * 1e6;
  let state = ok(await handle.call({ kind: 'state' })).state;
  const initialCapacity = capture.memory.buffer.byteLength;
  const samples = [], checkpoints = [], liveCapacities = [], rssSamples = [];
  const increment = timerIncrement();
  const total = ['long-session', 'recurrence'].includes(request.workload) ? request.steps : request.samples + request.warmup;
  assert.ok(total <= 16384 && request.samples <= 4096 && request.warmup <= 4096);
  async function drain() {
    if (editor) return; // controller's actual mutation fence drains and acknowledges
    const events = ok(await handle.call({ kind: 'events' })); assert.equal(events.gap, false);
    if (events.events.length) ok(await handle.call({ kind: 'acknowledge_events', cursor: events.cursor }));
  }
  async function snapshot() {
    const value = ok(await handle.call({ kind: 'snapshot', stamp: state.stamp, max_bytes: 16777216 }));
    ok(await handle.call({ kind: 'release_snapshot', handle: value.handle })); return value.canonical_json;
  }
  assert.equal(await snapshot(), request.input, 'independently authored initial canonical bytes');
  for (let index = 0; index < total; index++) {
    let leaf = state.root;
    for (const part of request.first_text_path) leaf = ok(await handle.call({ kind: 'node', stamp: state.stamp, node: leaf })).node.children[part];
    if (request.workload !== 'export') {
      ok(await handle.call({ kind: 'set_selection', stamp: state.stamp, selection: { anchor: { kind: 'text', node: leaf, offset: 0, affinity: 'after' }, focus: { kind: 'text', node: leaf, offset: 1, affinity: 'before' } } }));
      state = ok(await handle.call({ kind: 'state' })).state;
    }
    const text = index % 2 === 0 ? 'z' : 'x';
    const command = { id: request.profile === 'kwdj' ? 'org.klenwriter.kwdj/command/insert-text' : 'org.example.notes/command/insert-text',
      payload_json: JSON.stringify(request.profile === 'kwdj' ? { kind: 'insert_text', text } : { text }) };
    const start = performance.now();
    const reply = request.workload === 'export' ? ok(await handle.call({ kind: 'snapshot', stamp: state.stamp, max_bytes: 16777216 }))
      : ok(await handle.call({ kind: 'command', stamp: state.stamp, command, history_hint: { kind: 'isolated' } }));
    const elapsed = (performance.now() - start) * 1e6;
    if (request.workload !== 'export') assert.equal(reply.effect, 'changed');
    else ok(await handle.call({ kind: 'release_snapshot', handle: reply.handle }));
    if (index >= request.warmup) { samples.push(elapsed); liveCapacities.push(capture.memory.buffer.byteLength); rssSamples.push(process.memoryUsage().rss); }
    state = ok(await handle.call({ kind: 'state' })).state; await drain();
    if ([0, 63, 511, 1023, 2047, 4095].includes(index) || index + 1 === total) checkpoints.push({ step: index + 1, state, wasm_capacity: capture.memory.buffer.byteLength, js_resources: editor?.resources() ?? null, native_resources: JSON.parse(module.resourceCounts()), sampled_process_rss: process.memoryUsage().rss });
  }
  assert.equal(total % 2, 0); assert.equal(await snapshot(), request.input, 'even replacement count restores exact original bytes');
  await handle.destroy();
  if (editor) ownedResourcesZero(editor.resources());
  assert.deepEqual(JSON.parse(module.resourceCounts()), globalBefore, 'actual native ownership restored');
  return { format: 'editor-reliability-sdk-capture/1', samples, timerIncrement: increment, startup_ns, admission_ns, literal_bytes_restored: true,
    same_actual_instance_count: capture.instanceCount, initial_wasm_capacity: initialCapacity, final_wasm_capacity: capture.memory.buffer.byteLength,
    capacity_samples: liveCapacities, sampled_process_rss: rssSamples, checkpoints, resources_after: JSON.parse(module.resourceCounts()), controller_after: editor?.resources() ?? null,
    build_id: module.manifest.build_id, qualifications: ['Node process RSS includes V8/JS harness/WASM; sampled, not allocator peak', 'host instantiate forwarder restored after single actual production initialization', 'latency includes the declared layer and awaited mutation delivery; no quantile subtraction'] };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  try { console.log(JSON.stringify(await runSdk(request))); } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
