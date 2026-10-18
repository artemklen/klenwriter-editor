// SPDX-License-Identifier: MIT OR Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import init,{observeHistory} from '../artifacts/history/probe.js';
await init({module_or_path:readFileSync('artifacts/history/probe_bg.wasm')});
test('actual Session history follows independent literals on native and compiled WASM',()=>{
  const run=spawnSync('cargo',['run','--quiet','--locked','-p','klenwriter-editor-wasm','--example','history_native'],{encoding:'utf8',maxBuffer:8*1024*1024});
  assert.equal(run.status,0,run.stderr);
  const native=JSON.parse(run.stdout),wasm=JSON.parse(observeHistory());
  assert.deepEqual(wasm,native);assert.deepEqual(JSON.parse(observeHistory()),wasm);
  assert.equal(wasm.status,'passed');
  assert.equal(wasm.generic_adr.seed_passed,16);assert.equal(wasm.generic_adr.direct,15);
  assert.equal(wasm.generic_adr.declared_structural_embeddings,1);
  assert.equal(wasm.generic_adr.cases.length,16);
  for(const c of wasm.generic_adr.cases){assert.equal(c.status,'passed');assert.ok(c.exact_document_selection_marks_ids&&c.query_execute_work_equal);assert.equal(c.ordinary_snapshot_codec_calls,0);}
  assert.equal(wasm.kwdj.literal_total,29);assert.equal(wasm.kwdj.literal_passed,29);
  assert.equal(wasm.kwdj.cases.length,29);
  for(const c of wasm.kwdj.cases){assert.equal(c.status,'passed');assert.ok(c.query_execute_work_equal&&c.query_preserves_all_facets&&c.exact_historical_id_sets);assert.equal(c.ordinary_snapshot_codec_calls,0);for(const p of c.checkpoints)assert.match(p.revision,/^\d+$/);}
  assert.equal(wasm.hp_only.status,'passed');assert.equal(wasm.hp_only.variants.length,2);
  for(const v of wasm.hp_only.variants){assert.equal(v.status,'passed');assert.equal(v.implements_command_provider,false);assert.equal(v.ordinary_snapshot_codec_calls,0);}
  assert.equal(wasm.supplements.status,'passed');assert.equal(wasm.supplements.groups.length,3);
  for(const g of wasm.supplements.groups)assert.equal(g.status,'passed');
  assert.equal(wasm.lifecycle.case_total,3);assert.deepEqual(wasm.lifecycle.cases.map(c=>c.reason),['session.closed','session.poisoned','session.read_only']);
  for(const c of wasm.lifecycle.cases)assert.equal(c.status,'passed');
  assert.equal(wasm.generated_unicode.case_total,8);assert.equal(wasm.generated_unicode.replays,32);
  for(const c of wasm.generated_unicode.cases){assert.equal(c.status,'passed');assert.equal(c.final_revision,'6');}
  assert.equal(wasm.property_generated.status,'passed');assert.equal(wasm.property_generated.sequence_total,32);assert.equal(wasm.property_generated.apply_actions,255);assert.equal(wasm.property_generated.undo_actions,255);assert.equal(wasm.property_generated.redo_actions,255);assert.equal(wasm.property_generated.independent_checkpoint_total,797);assert.equal(wasm.property_generated.ordinary_snapshot_codec_calls,0);for(const c of wasm.property_generated.cases){assert.equal(c.status,'passed');assert.ok(c.query_execute_equal&&c.query_preserves_all_facets&&c.exact_historical_records_ids_selection);}
  assert.equal(wasm.recurrence.status,'passed');assert.equal(wasm.recurrence.cycles,512);assert.equal(wasm.recurrence.document_publications,1536);assert.equal(wasm.recurrence.final_revision,'1536');assert.equal(wasm.recurrence.event_record_cap,1);assert.equal(wasm.recurrence.work_byte_cap,32768);assert.ok(wasm.recurrence.steady_phase_work_and_retention_equal&&wasm.recurrence.all_historical_ids_stable);assert.equal(wasm.recurrence.ordinary_snapshot_codec_calls,0);
  assert.equal(wasm.identity_facts.case_total,2);
  assert.deepEqual(wasm.identity_facts.cases.map(c=>c.reason),['kwdj.reference_identity_unresolved','kwdj.identity_resolution_failed']);
  for(const c of wasm.identity_facts.cases){assert.equal(c.status,'passed');assert.deepEqual(c.directions,['undo','redo']);assert.ok(c.same_captured_requests_retry&&c.typed_errors_and_work_equal&&c.all_committed_facets_preserved&&c.exact_historical_records_ids_selection_marks);assert.equal(c.ordinary_snapshot_codec_calls,0);}
  // H23 is private engine evidence, not a fabricated public/WASM counter setter.
  assert.deepEqual(wasm.private_engine_cases.map(c=>c.id),['H23']);
  const manifest=JSON.parse(readFileSync('contracts/history/v1/manifest.json','utf8'));
  const hash=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
  assert.equal(hash('contracts/history/v1/vectors.json'),manifest.literal_sha256);
  assert.equal(hash(manifest.unchanged_adr_seeds.path),manifest.unchanged_adr_seeds.sha256);
  assert.equal(hash(manifest.position_authority.path),manifest.position_authority.sha256);
  assert.equal(hash(`contracts/history/v1/${manifest.adr_embedding.path}`),manifest.adr_embedding.sha256);
  assert.equal(hash(manifest.accepted_contract.path),manifest.accepted_contract.sha256);
  const paths=['Cargo.lock','Cargo.toml','rust-toolchain.toml','crates/core/Cargo.toml','crates/engine/Cargo.toml','crates/kwdj/Cargo.toml','crates/wasm/Cargo.toml','contracts/commands/v1/vectors.json','contracts/history/v1/vectors.json','contracts/history/v1/manifest.json','contracts/history/v1/adr-embedding.json','evidence/osr-36/execution-contract.md','evidence/osr-59/operation-vectors.json','evidence/osr-59/position-vectors.json',
    'crates/core/src/lib.rs','crates/core/src/json.rs','crates/core/src/admission.rs','crates/core/src/candidate.rs','crates/core/src/commands.rs','crates/core/src/document.rs','crates/core/src/history.rs','crates/core/src/limits.rs','crates/core/src/positions.rs','crates/core/src/profile.rs','crates/core/src/transaction.rs',
    'crates/engine/src/lib.rs','crates/engine/src/identity.rs','crates/engine/src/history.rs','crates/engine/src/grouping.rs','crates/engine/src/history_dispatch.rs','crates/engine/src/history_tests.rs','crates/engine/src/history_profile_tests.rs','crates/engine/src/commands.rs','crates/engine/src/dispatch.rs','crates/engine/src/session.rs','crates/engine/src/tree.rs','crates/engine/src/transaction.rs','crates/engine/src/mapping.rs',
    'crates/kwdj/src/lib.rs','crates/kwdj/src/commands/mod.rs','crates/kwdj/src/commands/block.rs','crates/kwdj/src/commands/inline.rs','crates/kwdj/src/admission.rs','crates/kwdj/src/candidate_validate.rs','crates/kwdj/src/edit_normalize.rs','crates/kwdj/src/session_profile.rs','crates/kwdj/src/core_bridge.rs','crates/kwdj/src/model.rs','crates/kwdj/src/project.rs','crates/kwdj/src/normalize.rs','crates/kwdj/src/validate.rs','crates/kwdj/src/wire_view.rs',
    'crates/wasm/examples/support/history_observer.rs','crates/wasm/examples/support/history_adr.rs','crates/wasm/examples/support/history_sequences.rs','crates/wasm/examples/support/history_facts.rs','crates/wasm/examples/support/history_generated.rs','crates/wasm/examples/history_native.rs','crates/wasm/examples/history_probe.rs','crates/wasm/tests/history.rs','tests/history.node.mjs','scripts/build-workspace.mjs','package.json','artifacts/history/probe_bg.wasm'];
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,hash(path)]));
  writeFileSync('artifacts/history-report.json',JSON.stringify({nativeWasmEqual:true,sourceHashes,...wasm},null,2)+'\n');
});
