// SPDX-License-Identifier: MIT OR Apache-2.0
import assert from 'node:assert/strict';

/** Test-host forwarding only. Neither module bytes nor production loader change. */
export async function captureActualMemory(initialize) {
  const instantiate = WebAssembly.instantiate, streaming = WebAssembly.instantiateStreaming;
  const instances = new Set();
  const record = result => { const instance = result.instance ?? result; if (instance instanceof WebAssembly.Instance) instances.add(instance); return result; };
  WebAssembly.instantiate = async function (...args) { return record(await Reflect.apply(instantiate, WebAssembly, args)); };
  if (streaming) WebAssembly.instantiateStreaming = async function (...args) { return record(await Reflect.apply(streaming, WebAssembly, args)); };
  try {
    const value = await initialize();
    assert.equal(instances.size, 1, 'the actual production loader must instantiate exactly once');
    const [instance] = instances;
    assert.ok(instance.exports.memory instanceof WebAssembly.Memory, 'same actual instance must export Memory');
    return { value, memory: instance.exports.memory, instanceCount: instances.size };
  } finally { WebAssembly.instantiate = instantiate; if (streaming) WebAssembly.instantiateStreaming = streaming; }
}

export function ownedResourcesZero(value) {
  for (const [key, count] of Object.entries(value)) {
    if (key === 'lifecycle') { assert.equal(count, 'destroyed'); continue; }
    assert.ok(count === 0 || count === '0', `resource ${key} remains ${count}`);
  }
}
