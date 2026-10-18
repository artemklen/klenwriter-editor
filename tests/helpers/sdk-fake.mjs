// SPDX-License-Identifier: MIT OR Apache-2.0
// Controlled JS-only transport fixture. This is not native Session evidence.
import { sdkBuildId } from '../../packages/wasm/dist/index.js';

export const profile = { profile_id: 'org.klenwriter.kwdj', profile_version: '1.0.0', codec_id: 'org.klenwriter.kwdj/json', wire_version: 1, extensions: [{ id: 'org.klenwriter.kwdj/base', version: '1.0.0' }] };
export const options = () => ({ abi: 'editor-sdk/1', build_id: sdkBuildId, profile: structuredClone(profile), admission: 'validate', access: 'editable', identities: { media: [], references: [] }, limits: null });
const ok = value => JSON.stringify({ status: 'ok', value });
const clone = value => structuredClone(value);
const equalStamp = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function fakeModule(hooks = {}) {
  const log = [], instances = [];
  let live = 0, destroyed = 0, freed = 0;
  class Session {
    constructor(input, optionsJson) {
      this.input = [...input]; this.options = JSON.parse(optionsJson);
      this.state = { stamp: { session: 'session-1', generation: '1', revision: '0', selection_epoch: '0', history_epoch: '0' }, root: 'root-1', selection: null, stored_marks: null, dirty: false, saved_revision: '0', history: { undo_entries: '0', redo_entries: '0', retained_bytes: '0' } };
      this.events = []; this.sequence = 0; this.closed = false;
      instances.push(this); live++; hooks.open?.(this);
    }
    initialization() { return hooks.initialization?.(this) ?? ok({ kind: 'state', state: this.state }); }
    refused(code) { return JSON.stringify({ status: 'refused', diagnostic: { code, path: '', category: 'fake_fixture', details: {}, stamp: this.state.stamp, may_have_committed: false } }); }
    call(json) {
      const request = JSON.parse(json); log.push(clone(request));
      const override = hooks.call?.(request, this);
      if (override !== undefined) return override;
      if (request.kind === 'events') return ok({ kind: 'events', events: this.events, cursor: `${this.state.stamp.generation}/${this.sequence}`, gap: false });
      if (request.kind === 'acknowledge_events') { this.events = []; return ok({ kind: 'released' }); }
      if (request.stamp && !equalStamp(request.stamp, this.state.stamp)) return this.refused('session.stale_revision');
      if (request.kind === 'state') return ok({ kind: 'state', state: this.state });
      if (request.kind === 'catalog') return ok({ kind: 'catalog', commands: ['fixture.insert'] });
      if (request.kind === 'resources') return ok({ kind: 'resources', resources: { sessions: live, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: live } });
      if (request.kind === 'query_command' || request.kind === 'query_history') return ok({ kind: 'availability', available: true, effect: 'changed', presentation: null, diagnostic: null });
      if (request.kind === 'release_snapshot' || request.kind === 'update_facts') return ok({ kind: 'released' });
      if (request.kind === 'snapshot') return ok({ kind: 'snapshot', handle: 'receipt-1', canonical_json: '{"fixture":true}', stamp: this.state.stamp, profile, event_sequence: String(this.sequence) });
      if (request.kind === 'map_position') return ok({ kind: 'mapped', status: 'mapped', position: request.position, deleted: false, stamp: this.state.stamp });
      if (request.kind === 'remount') {
        if (request.input_json === 'invalid') return this.refused('fixture.invalid_document');
        this.state.stamp = { ...this.state.stamp, generation: String(Number(this.state.stamp.generation) + 1), revision: '0', selection_epoch: '0', history_epoch: '0' };
        this.events = []; this.sequence = 0;
        return ok({ kind: 'mutation', effect: 'changed', state: this.state, presentation: null });
      }
      const id = request.command?.id;
      if (id === 'fixture.refuse') return this.refused('fixture.refused');
      if (id === 'fixture.trap') throw new WebAssembly.RuntimeError('controlled fixture trap');
      if (id === 'fixture.noop') return ok({ kind: 'mutation', effect: 'unchanged', state: this.state, presentation: null });
      const before = clone(this.state);
      const document = request.kind === 'command' || request.kind === 'history';
      if (document) {
        this.state.stamp.revision = String(BigInt(this.state.stamp.revision) + 1n);
        this.state.stamp.selection_epoch = String(BigInt(this.state.stamp.selection_epoch) + 1n);
        this.state.stamp.history_epoch = String(BigInt(this.state.stamp.history_epoch) + 1n);
        this.state.dirty = true;
      } else if (request.kind === 'barrier') this.state.stamp.history_epoch = String(BigInt(this.state.stamp.history_epoch) + 1n);
      else if (request.kind === 'set_selection' || request.kind === 'set_stored_marks') {
        this.state.stamp.selection_epoch = String(BigInt(this.state.stamp.selection_epoch) + 1n);
        if (request.kind === 'set_selection') this.state.selection = request.selection;
        else this.state.stored_marks = request.marks;
      }
      const change = document
        ? { kind: 'document', impact: { upserted: ['leaf-1'], removed: [], ancestors_before: ['root-1'], ancestors_after: ['root-1'], root_order_changed: false }, from_revision: before.stamp.revision, to_revision: this.state.stamp.revision }
        : { kind: 'state', selection_changed: request.kind === 'set_selection', stored_marks_changed: request.kind === 'set_stored_marks', history_changed: request.kind === 'barrier', baseline_changed: request.kind === 'acknowledge_snapshot' || request.kind === 'reconcile_snapshot' };
      this.events.push({ sequence: String(++this.sequence), before: before.stamp, after: clone(this.state.stamp), selection_before: before.selection, selection_after: this.state.selection, stored_marks_before: before.stored_marks, stored_marks_after: this.state.stored_marks, dirty_before: before.dirty, dirty_after: this.state.dirty, history: this.state.history, change });
      if (id === 'fixture.transport_failure') return 'not JSON after controlled fixture commit';
      return ok({ kind: 'mutation', effect: 'changed', state: this.state, presentation: null });
    }
    destroy() { if (!this.closed) { this.closed = true; live--; destroyed++; } }
    free() { freed++; hooks.free?.(this); }
  }
  const module = { manifest: { abi: 'editor-sdk/1', build_id: sdkBuildId, profiles: [clone(profile)] }, Session, resourceCounts: () => JSON.stringify({ sessions: live, snapshot_handles: 0, snapshot_bytes: '0', protected_cursors: live }) };
  return { module, log, instances, counts: () => ({ live, destroyed, freed }) };
}

export const mutation = (controller, id = 'fixture.insert') => ({ kind: 'command', stamp: clone(controller.capture()), command: { id, payload_json: '{}' }, history_hint: { kind: 'isolated' } });
export const result = submission => submission.status === 'queued' ? submission.completion : submission.response;
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
