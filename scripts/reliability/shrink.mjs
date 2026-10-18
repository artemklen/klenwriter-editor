// SPDX-License-Identifier: MIT OR Apache-2.0
// Test-only bounded reduction. Runtime probes must own an external watchdog.
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { isDeepStrictEqual } from 'node:util';
import { makeScenario, tokens, contexts } from './scenarios.mjs';

export const shrinkLimits = Object.freeze({ maxProbes: 128, maxElapsedMs: 30000, maxProbeMs: 2000, maxEvidenceBytes: 67108864 });
const signatureKeys = ['invariant', 'phase', 'class', 'target', 'context'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value) + '\n');

export function failureSignature(value) {
  if (!value || typeof value !== 'object') throw new TypeError('failure signature required');
  return Object.fromEntries(signatureKeys.map(key => {
    if (typeof value[key] !== 'string' || value[key].length === 0 || Buffer.byteLength(value[key]) > 512) throw new TypeError(`bounded signature ${key} required`);
    return [key, value[key]];
  }));
}

export function sameFailure(left, right) {
  return isDeepStrictEqual(failureSignature(left), failureSignature(right));
}

function bounded(options) {
  const limits = { ...shrinkLimits, ...options };
  for (const [key, maximum] of Object.entries(shrinkLimits)) {
    if (!Number.isSafeInteger(limits[key]) || limits[key] < 0 || limits[key] > maximum) throw new RangeError(`limits may only tighten ${key}`);
  }
  return limits;
}

function session(original, options) {
  const limits = bounded(options.limits), signature = failureSignature(options.signature), started = performance.now();
  if (typeof options.probe !== 'function') throw new TypeError('probe callback required');
  if (original.length > limits.maxEvidenceBytes) throw new RangeError('original evidence exceeds bound');
  const trace = [], cache = new Map(); let probes = 0, stopped = null;
  const exhausted = () => {
    if (probes >= limits.maxProbes) stopped ??= 'probe_budget';
    if (performance.now() - started >= limits.maxElapsedMs) stopped ??= 'time_budget';
    return stopped !== null;
  };
  async function test(bytes, value, stage) {
    const sha256 = hash(bytes);
    if (cache.has(sha256)) return cache.get(sha256);
    if (exhausted()) return false;
    const start = performance.now(); probes++;
    let observed = null, matches = false, error = null;
    try {
      const remainingMs = Math.max(0, Math.floor(limits.maxElapsedMs - (start - started)));
      // Probes cannot mutate the retained original or the candidate/oracle receipt.
      const probeInput = value instanceof Uint8Array ? new Uint8Array(value) : structuredClone(value);
      const actual = await options.probe(probeInput, { timeoutMs: Math.min(limits.maxProbeMs, remainingMs), probe: probes });
      if (actual?.failed === true) { observed = failureSignature(actual.signature); matches = sameFailure(signature, observed); }
      else if (actual?.failed !== false) throw new TypeError('probe must return {failed:boolean,signature?}');
    } catch (failure) {
      // A thrown parser/transport exception is not the requested semantic fault.
      error = String(failure?.message ?? failure).slice(0, 1024); stopped = 'probe_error';
    }
    const elapsedMs = performance.now() - start;
    // The callback enforces the actual hard timeout; this also rejects late results.
    if (elapsedMs > limits.maxProbeMs || performance.now() - started > limits.maxElapsedMs) { matches = false; stopped = 'time_budget'; }
    trace.push({ probe: probes, stage, bytes: bytes.length, sha256, matches, signature: observed, elapsedMs, error });
    cache.set(sha256, matches); return matches;
  }
  function finish(minimized, detail = {}) {
    const reduced = !original.equals(minimized);
    return { format: 'editor-reliability-reduction/1', status: reduced ? 'reduced' : 'not_minimized',
      reason: stopped ?? (reduced ? 'bounded_fixed_point' : 'no_smaller_reproducer'), signature,
      original: new Uint8Array(original), minimized: new Uint8Array(minimized), probes, elapsedMs: performance.now() - started,
      limits, trace, ...detail,
      qualification: 'Bounded reduction, not proof of global minimality. Runtime callbacks must supervise an external child; this module does not interrupt synchronous WASM.' };
  }
  return { test, exhausted, finish, stop: reason => { stopped ??= reason; } };
}

async function ddmin(sequence, accepts, exhausted) {
  let current = sequence, divisions = 2;
  while (current.length && !exhausted()) {
    const width = Math.ceil(current.length / divisions); let accepted = false;
    for (let start = 0; start < current.length && !exhausted(); start += width) {
      const candidate = current.slice(0, start).concat(current.slice(start + width));
      if (await accepts(candidate)) { current = candidate; divisions = Math.max(2, divisions - 1); accepted = true; break; }
    }
    if (!accepted) { if (divisions >= current.length) break; divisions = Math.min(current.length, divisions * 2); }
  }
  return current;
}

export async function shrinkRaw(originalBytes, options) {
  if (!(originalBytes instanceof Uint8Array)) throw new TypeError('raw original must be bytes');
  const original = Buffer.from(originalBytes), run = session(original, options);
  if (!(await run.test(original, new Uint8Array(original), 'original'))) { run.stop('original_not_reproduced'); return run.finish(original); }
  let current = await ddmin([...original], candidate => {
    const bytes = Buffer.from(candidate); return run.test(bytes, new Uint8Array(bytes), 'remove_bytes');
  }, run.exhausted);
  for (let index = 0; index < current.length && !run.exhausted(); index++) {
    for (const value of [0, 32, 48, 65]) {
      if (value >= current[index] || run.exhausted()) continue;
      const candidate = current.slice(); candidate[index] = value;
      const bytes = Buffer.from(candidate);
      if (await run.test(bytes, new Uint8Array(bytes), 'simplify_byte')) { current = candidate; break; }
    }
  }
  return run.finish(Buffer.from(current), { kind: 'raw-bytes' });
}

const alphabet = [...new Set([...tokens, 'L', 'R', 'a', 'b'])].sort((a, b) => b.length - a.length);
function units(text) {
  if (typeof text !== 'string') return null;
  const found = []; let offset = 0;
  while (offset < text.length) {
    const token = alphabet.find(item => text.startsWith(item, offset));
    if (!token) return null;
    found.push(token); offset += token.length;
  }
  return found;
}
function validEdits(initialText, edits) {
  let text = initialText;
  if (!units(text)?.length || Buffer.byteLength(text) > 16384 || edits.length === 0 || edits.length > 16) return false;
  for (const edit of edits) {
    const parts = units(text), inserted = units(edit.inserted);
    const boundaries = new Set([0]); let at = 0; for (const part of parts) { at += part.length; boundaries.add(at); }
    if (!inserted?.length || !boundaries.has(edit.from) || !boundaries.has(edit.to) || edit.from > edit.to) return false;
    const next = text.slice(0, edit.from) + edit.inserted + text.slice(edit.to);
    if (!next.length || next === text || Buffer.byteLength(next) > 16384) return false;
    text = next;
  }
  return true;
}

/** Closed finite-model recognition; never reinterpret a general operation trace. */
export function finiteScenarioParameters(scenario) {
  try {
    if (scenario?.format !== 'editor-reliability-scenario/1' || scenario.model !== 'finite-token-paragraph/1'
      || !contexts.includes(scenario.context) || typeof scenario.id !== 'string' || scenario.id.length > 256
      || !Number.isSafeInteger(scenario.seed) || scenario.seed < 0 || scenario.seed > 0xffffffff
      || !Array.isArray(scenario.actions) || scenario.actions.length > 64) return null;
    const doc = JSON.parse(scenario.input_json), initialText = scenario.context.startsWith('kwdj-') ? doc.content[0].content[0].text : doc.root.children[0].children[0].text;
    const edits = []; let index = 0;
    while (scenario.actions[index]?.op === 'select' && scenario.actions[index + 1]?.op === 'insert_text') {
      const select = scenario.actions[index], insert = scenario.actions[index + 1];
      if (insert.isolated !== true) return null;
      edits.push({ from: select.from, to: select.to, inserted: insert.text }); index += 2;
    }
    if (!validEdits(initialText, edits)) return null;
    const parameters = { id: scenario.id, seed: scenario.seed, context: scenario.context, initialText, edits };
    // This checks complete independent expectations, metadata and exact raw input.
    if (!isDeepStrictEqual(makeScenario(parameters), scenario)) return null;
    return parameters;
  } catch { return null; }
}

export async function shrinkScenario(scenario, options) {
  const original = options.originalBytes ? Buffer.from(options.originalBytes) : encode(scenario);
  const run = session(original, options), parameters = finiteScenarioParameters(scenario);
  let sameOriginal = false;
  try { sameOriginal = isDeepStrictEqual(JSON.parse(original.toString('utf8')), scenario); } catch { /* preserve unsupported raw bytes */ }
  if (!parameters || !sameOriginal) { run.stop('unsupported_model'); return run.finish(original, { kind: 'finite-model' }); }
  if (!(await run.test(original, scenario, 'original'))) { run.stop('original_not_reproduced'); return run.finish(original, { kind: 'finite-model' }); }
  let current = parameters.edits, minimizedBytes = original, minimizedScenario = scenario;
  async function accepts(edits, stage = 'remove_edit_pairs') {
    if (!validEdits(parameters.initialText, edits)) return false;
    const candidate = makeScenario({ ...parameters, edits }), bytes = encode(candidate);
    if (!(await run.test(bytes, candidate, stage))) return false;
    minimizedBytes = bytes; minimizedScenario = candidate; return true;
  }
  current = await ddmin(current, accepts, run.exhausted);
  for (let index = 0; index < current.length && !run.exhausted(); index++) {
    const parts = await ddmin(units(current[index].inserted), async candidate => {
      const edits = current.map(edit => ({ ...edit })); edits[index].inserted = candidate.join('');
      if (await accepts(edits, 'simplify_inserted_tokens')) { current = edits; return true; } return false;
    }, run.exhausted);
    current[index] = { ...current[index], inserted: parts.join('') };
  }
  return run.finish(minimizedBytes, { kind: 'finite-model', scenario: minimizedScenario,
    originalActionCount: scenario.actions.length, minimizedActionCount: minimizedScenario.actions.length });
}
