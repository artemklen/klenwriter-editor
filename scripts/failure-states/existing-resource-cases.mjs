// SPDX-License-Identifier: MIT OR Apache-2.0
// Names identify original meaningful cases; importing this table runs no test.
export const nodeResourceCases = [
  { row: 'A4-07', file: 'tests/sdk-controller.node.mjs', name: 'controller-only: queue/listener/request byte caps tighten and refusals never enqueue' },
  { row: 'A4-07', file: 'tests/sdk-integration.node.mjs', name: 'packaged SDK: pending hard cap128 and64-turn yielding settle actual stale native requests exactly once' },
  { row: 'A4-08', file: 'tests/sdk-integration.node.mjs', name: 'packaged SDK:32 engine-issued receipts are bounded, release/retry works and forged/old handles refuse' },
  ...['PCAP02', 'PCAP03', 'PCAP04', 'PCAP05', 'PCAP06'].map(prefix => ({ row: 'A4-09', file: 'tests/clipboard-capture.node.mjs', prefix: `${prefix} ` })),
  { row: 'A4-10', file: 'tests/composition-owner.node.mjs', name: 'oversize active key identity retains the original event before adding state [controlled]' },
  { row: 'A4-10', file: 'tests/composition-owner.node.mjs', name: 'aggregate held and closing identity payload admits the exact existing cap then refuses overflow [controlled]' },
];
const budgetNames = [
  'raw_failure_precedes_parser', 'raw_and_canonical_limits_are_distinct', 'json_preflight_precedes_shape_and_copy',
  'generic_counts_each_payload', 'nested_metadata_and_numbers_are_bounded', 'generic_admission_is_atomic',
  'identity_resolution_waits_for_admission', 'host_settings_only_tighten', 'within_budget_codec_results_are_equal',
];
export const rustResourceCases = [
  ...budgetNames.map(name => ({ row: ['generic_counts_each_payload', 'nested_metadata_and_numbers_are_bounded'].includes(name) ? 'A4-02'
    : ['raw_failure_precedes_parser', 'raw_and_canonical_limits_are_distinct'].includes(name) ? 'A4-01' : 'A4-11',
    name, sources: ['crates/kwdj/tests/admission_budget.rs', 'crates/kwdj/tests/support/admission_budget_cases.rs'] })),
  { row: 'A4-04', name: 'admission_cache_ceiling_is_separate_bounded_and_keeps_nested_accounting', sources: ['crates/core/tests/admission_meter.rs'] },
  { row: 'A4-03', name: 'normative_node_ceiling_survives_both_admitted_proofs_and_exact_export', sources: ['crates/kwdj-sdk/tests/admission_cache_budget.rs'] },
  { row: 'A4-11', name: 'typed_descriptor_huge_string_refuses_before_serde_scan_or_copy', sources: ['crates/registry/tests/limits.rs'] },
  { row: 'A4-11', name: 'independent_dispatch_literals_guard_factories_before_document_decode', sources: ['crates/bridge/tests/distribution.rs', 'contracts/sdk-v2/v1/factory-vectors.json'] },
];
export const existingSourceFiles = [...new Set([
  ...nodeResourceCases.map(row => row.file), ...rustResourceCases.flatMap(row => row.sources),
  'tests/workspace-browser.spec.js', 'crates/wasm/examples/admission_budget_probe.rs',
  'tests/codec.node.mjs', 'tests/support/codec-fixtures.mjs', 'contracts/kwdj/v1/fixtures/mixed.json',
  'contracts/kwdj/v1/baseline-cases.json', 'scripts/failure-states/existing-resource-cases.mjs',
])].sort();
export const compiledAdmissionTitle = 'compiled Rust admission refuses before parse and snapshot copies';
export const localCaseIds = [
  'A4-01/public-input-over', 'A4-01/public-input-exact',
  'A4-07/request-exact', 'A4-07/request-over', 'A4-07/queue-exact', 'A4-07/queue-over',
  'A4-08/caller-max-exact-and-over', 'A4-10/event-payload-exact', 'A4-10/event-payload-over',
];
