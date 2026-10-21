// SPDX-License-Identifier: MIT OR Apache-2.0
// Observation limits invalidate evidence; they must not change native transport behavior.
const encoder = new TextEncoder();

export function observeNativeModule(module, record, limits) {
  const append = (method, requestJson, responseJson, error) => {
    // Preserve a contiguous prefix after the first lost observation.
    if (record.nativeTraceOverflow) return;
    const bytes = encoder.encode(requestJson ?? '').length + encoder.encode(responseJson ?? '').length;
    if (record.nativeTrace.length >= limits.nativeCalls || record.nativeTraceBytes + bytes > limits.nativeBytes) {
      record.nativeTraceOverflow = true;
      return;
    }
    record.nativeTraceBytes += bytes;
    record.nativeTrace.push({ ordinal: record.nativeTrace.length, method, requestJson, responseJson, error });
  };
  class ObservedSession {
    constructor(input, options) { this.actual = new module.Session(input, options); }
    initialization() { const raw = this.actual.initialization(); append('initialization', null, raw, null); return raw; }
    context() { return this.actual.context(); }
    call(raw) {
      let result;
      try { result = this.actual.call(raw); }
      catch (error) { append('call', raw, null, { name: typeof error?.name === 'string' ? error.name : null, message: typeof error?.message === 'string' ? error.message : null }); throw error; }
      append('call', raw, result, null); return result;
    }
    destroy() { this.actual.destroy(); }
    free() { this.actual.free(); }
  }
  return { manifest: module.manifest, Session: ObservedSession, resourceCounts: () => module.resourceCounts() };
}
