// SPDX-License-Identifier: MIT OR Apache-2.0
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import init,{observeCommands} from '../artifacts/commands/probe.js';
await init({module_or_path:readFileSync('artifacts/commands/probe_bg.wasm')});
test('actual KWDJ command availability and execution match literal expectations on native and WASM',()=>{
  const run=spawnSync('cargo',['run','--quiet','--locked','-p','klenwriter-editor-wasm','--example','command_native'],{encoding:'utf8',maxBuffer:4*1024*1024});
  assert.equal(run.status,0,run.stderr);
  const native=JSON.parse(run.stdout),wasm=JSON.parse(observeCommands());
  assert.deepEqual(wasm,native);assert.deepEqual(JSON.parse(observeCommands()),wasm);
  assert.equal(wasm.status,'passed',JSON.stringify(wasm));
  assert.equal(wasm.literal_total,24);assert.equal(wasm.literal_passed,24);
  assert.equal(wasm.literal_cases.length,24);
  assert.deepEqual(wasm.generated,{status:'passed',enter_cases:64,interior_refusals:4,oracle:'parameterized literal split/text/layout/mark and original EGC boundaries',query_execute_equal:true,snapshot_codec_calls:0});
  assert.equal(wasm.future_typing.status,'passed');
  assert.equal(wasm.future_typing.state_only_toggles,2);assert.equal(wasm.future_typing.typing_commits,2);
  assert.ok(wasm.future_typing.explicit_plain_distinguished_from_inherit&&wasm.future_typing.actual_journal_mark_before_after&&wasm.future_typing.navigation_clears_override);
  assert.equal(wasm.future_typing.ordinary_snapshot_codec_calls,0);
  assert.equal(wasm.structural.status,'passed');assert.equal(wasm.structural.group_total,7);
  for(const group of wasm.structural.groups)assert.equal(group.status,'passed');
  assert.equal(wasm.inline.status,'passed');assert.equal(Object.keys(wasm.inline.groups).length,8);
  for(const group of Object.values(wasm.inline.groups))assert.equal(group.status,'passed');
  for(const c of wasm.literal_cases){
    assert.equal(c.status,'passed');assert.equal(c.query_repetitions,4);
    assert.ok(c.full_query_execute_equal&&c.query_preserves_all_facets&&c.literal_caret_matches&&c.work_bounded);
    assert.equal(c.ordinary_snapshot_codec_calls,0);
    assert.equal(typeof c.canonical_json,'string');
  }
  assert.match(wasm.literal_cases[23].canonical_json,/18446744073709551615/);
  const paths=['Cargo.lock','crates/wasm/Cargo.toml','contracts/commands/v1/vectors.json',
    'crates/core/src/commands.rs','crates/core/src/transaction.rs','crates/core/src/positions.rs',
    'crates/engine/src/commands.rs','crates/engine/src/dispatch.rs','crates/engine/src/session.rs','crates/engine/src/tree.rs','crates/engine/src/transaction.rs',
    'crates/kwdj/src/commands/mod.rs','crates/kwdj/src/commands/block.rs','crates/kwdj/src/commands/inline.rs',
    'crates/kwdj/src/candidate_validate.rs','crates/kwdj/src/edit_normalize.rs','crates/kwdj/src/session_profile.rs','crates/kwdj/src/validate.rs',
    'crates/wasm/examples/support/command_inline.rs','crates/wasm/tests/command_inline.rs',
    'crates/wasm/examples/support/command_structural.rs','crates/wasm/tests/command_structural.rs',
    'crates/wasm/examples/support/command_observer.rs','crates/wasm/examples/command_native.rs','crates/wasm/examples/command_probe.rs',
    'crates/wasm/tests/commands.rs','tests/commands.node.mjs','scripts/build-workspace.mjs','package.json','artifacts/commands/probe_bg.wasm'];
  const sourceHashes=Object.fromEntries(paths.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
  writeFileSync('artifacts/command-report.json',JSON.stringify({nativeWasmEqual:true,sourceHashes,...wasm},null,2)+'\n');
});
