// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import init, { observeSessionFoundation } from '../artifacts/session-foundation/probe.js';

await init({ module_or_path: readFileSync('artifacts/session-foundation/probe_bg.wasm') });

test('bounded real-profile Session foundation is identical on native and compiled WASM', () => {
  const run = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'klenwriter-editor-wasm', '--example', 'session_native'], {
    encoding: 'utf8', maxBuffer: 1024 * 1024,
  });
  assert.equal(run.status, 0, run.stderr);
  const native = JSON.parse(run.stdout), wasm = JSON.parse(observeSessionFoundation());
  assert.deepEqual(wasm, native);
  assert.deepEqual(JSON.parse(observeSessionFoundation()), wasm);
  assert.equal(wasm.task, 'OSR-33');
  assert.equal(wasm.production_profile, 'org.klenwriter.kwdj');
  assert.deepEqual(Object.keys(wasm.groups).sort(), [
    'binding_refusals', 'cross_mark_graphemes', 'lifecycle_selection', 'retained_maps', 'snapshots', 'structural_drafts', 'text_drafts',
  ]);
  for (const group of Object.values(wasm.groups)) assert.equal(group.status, 'passed');
  assert.deepEqual(wasm.groups.text_drafts.split_text, ['ab', 'Яz']);
  assert.deepEqual(wasm.groups.text_drafts.boundary_after, ['right', 0]);
  assert.equal(wasm.groups.text_drafts.committed, 'abЯz');
  assert.equal(wasm.groups.text_drafts.candidate, 'abXz');
  assert.equal(wasm.groups.text_drafts.abandoned_id_reused, false);
  assert.equal(wasm.groups.text_drafts.restored_join_right_identity, true);
  assert.deepEqual(wasm.groups.text_drafts.restored_join_text, ['ab', 'Яz']);
  assert.equal(wasm.groups.lifecycle_selection.readonly_scalar_focus, 6);
  assert.equal(wasm.groups.lifecycle_selection.reverse_anchor, 10);
  assert.equal(wasm.groups.structural_drafts.atom_deleted_fallback, 3);
  assert.equal(wasm.groups.structural_drafts.session_changed, false);
  assert.deepEqual(wasm.groups.retained_maps, {
    status: 'passed', after_delete: 'abf', after_insert: 'aЖbf', endpoint_offset: 2,
    endpoint_deleted: false, interior_deleted: true, composed_offset: 3, evicted_chain: 'stale', session_revision: 0,
  });
  assert.equal(wasm.groups.binding_refusals.cases.length, 10);
  for (const row of wasm.groups.snapshots.cases) {
    const document = JSON.parse(row.canonical);
    assert.deepEqual(Object.keys(document).sort(), ['content', 'profile', 'schema', 'schema_version']);
    assert.equal(row.runtime_metadata_exported, false);
    assert.equal(row.generation_advanced, true);
    if (row.case === 'poetry-root-context') assert.equal(document.profile, 'poetry');
    if (row.case === 'prose-unicode') assert.equal(document.content[0].content[0].text, 'Яe\u0301👩🏽‍💻 שלום');
  }
  assert.deepEqual(wasm.deferred, { transactions: 'OSR-34', user_history: 'OSR-36', second_production_profile: 'OSR-64' });
  const paths = [
    'crates/core/src/history.rs', 'crates/core/src/transaction.rs',
    'crates/engine/src/history.rs', 'crates/engine/src/grouping.rs',
    'crates/engine/src/history_dispatch.rs', 'crates/engine/src/dispatch.rs', 'crates/engine/src/transaction.rs',
    'Cargo.lock', 'crates/core/src/admission.rs', 'crates/core/src/positions.rs', 'crates/core/src/profile.rs',
    'crates/engine/src/identity.rs', 'crates/engine/src/session.rs',
    'crates/engine/src/tree.rs', 'crates/engine/src/mapping.rs',
    'crates/kwdj/src/session_profile.rs', 'crates/wasm/examples/session_native.rs',
    'crates/wasm/examples/session_probe.rs', 'crates/wasm/examples/support/session_observer.rs',
    'artifacts/session-foundation/probe_bg.wasm', 'tests/session.node.mjs',
  ];
  const sourceHashes = Object.fromEntries(paths.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/session-foundation-report.json', JSON.stringify({ nativeWasmEqual: true, sourceHashes, ...wasm }, null, 2) + '\n');
});
