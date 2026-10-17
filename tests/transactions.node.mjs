// SPDX-License-Identifier: MIT OR Apache-2.0
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync,writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import init,{observeTransactions} from '../artifacts/transactions/probe.js';
await init({module_or_path:readFileSync('artifacts/transactions/probe_bg.wasm')});
test('real KWDJ transaction outputs and typed atomic refusals agree on native and compiled WASM',()=>{
  const run=spawnSync('cargo',['run','--quiet','--locked','-p','klenwriter-editor-wasm','--example','transaction_native'],{encoding:'utf8',maxBuffer:1024*1024});
  assert.equal(run.status,0,run.stderr);
  const native=JSON.parse(run.stdout),wasm=JSON.parse(observeTransactions());
  assert.deepEqual(wasm,native);assert.deepEqual(JSON.parse(observeTransactions()),wasm);
  assert.equal(wasm.task,'OSR-34');assert.equal(Object.keys(wasm.groups).length,5);
  for(const group of Object.values(wasm.groups))assert.equal(group.status,'passed');
  assert.equal(wasm.groups.text_selection_journal.canonical.content[0].content[0].text,'aЖbf!');
  assert.equal(wasm.groups.text_selection_journal.old_bookmark,'stale');
  assert.equal(wasm.groups.normalization_noops.canonical.content[0].content[0].text,'a\nb');
  assert.equal(wasm.groups.normalization_noops.split_join,'net-noop');
  assert.deepEqual(wasm.groups.attributes_marks_spans.repeated_metadata, {
    commits:512,canonical_bytes:159,work_cap_bytes:32768,journal_entry_limit:1,
    canonical_restored:true,all_changed:true,work_and_retained_bytes_stable:true,identities_preserved:true,
  });
  assert.deepEqual(wasm.groups.fragments_local_references.canonical.content.filter(p=>p.type==='paragraph').map(p=>p.content[0].text),['A','A','Z','Y']);
  assert.equal(wasm.groups.fragments_local_references.canonical.content.at(-1).type,'scene_break');
  assert.equal(wasm.groups.atomic_refusals.cases.length,11);
  const guarded = Object.fromEntries(wasm.groups.atomic_refusals.cases.filter(r=>r.case).map(r=>[r.case,r.code]));
  assert.deepEqual(guarded, {
    'empty-text-missing-reference':'kwdj.reference_identity_unresolved',
    'empty-text-active-unsafe-url':'kwdj.unsafe_url',
    'stanza-left-zero-before-merge':'kwdj.invalid_verse',
    'stanza-right-zero-before-merge':'kwdj.invalid_verse',
  });
  assert.ok(wasm.groups.atomic_refusals.cases.every(r=>r.canonical_and_state_preserved&&r.identity_map));
  const paths=['Cargo.lock','crates/wasm/Cargo.toml',
    'crates/core/src/candidate.rs','crates/core/src/transaction.rs','crates/core/src/admission.rs','crates/core/src/positions.rs','crates/core/src/profile.rs',
    'crates/engine/src/tree.rs','crates/engine/src/session.rs','crates/engine/src/dispatch.rs','crates/engine/src/transaction.rs',
    'crates/kwdj/src/candidate_validate.rs','crates/kwdj/src/edit_normalize.rs','crates/kwdj/src/session_profile.rs',
    'crates/kwdj/src/wire_view.rs','crates/kwdj/src/validate.rs','crates/kwdj/src/normalize.rs','crates/kwdj/src/core_bridge.rs',
    'crates/wasm/examples/support/transaction_observer.rs','crates/wasm/examples/transaction_native.rs','crates/wasm/examples/transaction_probe.rs',
    'crates/wasm/tests/transactions.rs','artifacts/transactions/probe_bg.wasm','tests/transactions.node.mjs','scripts/build-workspace.mjs','package.json'];
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync('artifacts/transaction-report.json',JSON.stringify({nativeWasmEqual:true,sourceHashes,...wasm},null,2)+'\n');
});
