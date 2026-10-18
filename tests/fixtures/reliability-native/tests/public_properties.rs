// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_reliability_native::{
    fuzz_admission, fuzz_stateful,
    model::{Context, Scenario},
    replay_scenario,
};
use proptest::prelude::*;
use proptest::test_runner::{Config, RngSeed};
use std::sync::OnceLock;

fn scenarios() -> &'static [Scenario] {
    static CASES: OnceLock<Vec<Scenario>> = OnceLock::new();
    CASES.get_or_init(|| {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let bytes = std::fs::read(root.join("artifacts/reliability/scenarios.jsonl"))
            .expect("generate frozen scenarios before native properties");
        let rows = bytes
            .split(|b| *b == b'\n')
            .filter(|line| !line.is_empty())
            .map(|line| serde_json::from_slice(line).unwrap())
            .collect::<Vec<Scenario>>();
        assert_eq!(rows.len(), 1036);
        rows
    })
}

proptest! {
    #![proptest_config(Config{cases:128,rng_seed:RngSeed::Fixed(0x38c0ffee),failure_persistence:None,max_shrink_iters:4096,..Config::default()})]
    #[test]
    fn actual_public_session_frozen_prefixes_shrink(index in 0usize..1036,prefix in 1usize..65){
        // Both the index and valid action-prefix shrink. Every kept checkpoint
        // remains the independently frozen oracle; no expected is regenerated.
        let mut scenario=scenarios()[index].clone();scenario.actions.truncate(prefix);
        let report=replay_scenario(&scenario).map_err(|e|TestCaseError::fail(e.to_string()))?;
        prop_assert_eq!(report.actions,scenario.actions.len());
        prop_assert!(report.all_query_facets_pure && report.query_execute_work_equal && report.all_original_identity_restoration);
    }
}
#[test]
fn raw13_public_algebra_and_late_atomicity() {
    let report = editor_reliability_native::properties::operation_literals().unwrap();
    assert_eq!(report["variant_total"], 13);
}
#[test]
fn four_context_deep_stateful_fuzz_seed() {
    for context in [
        Context::KwdjProse,
        Context::KwdjPoetry,
        Context::NotesD0,
        Context::NotesD1,
    ] {
        let r = fuzz_stateful(context, &[0, 3, 1, 2, 4, 5, 6, 7]);
        assert_eq!(r.command_publications, 1);
        assert_eq!(r.history_publications, 2);
        assert_eq!(r.late_refusals, 1);
        assert_eq!(r.closed, 1);
        assert!(r.work_units > 0 && r.phase_visits.iter().sum::<u64>() > 0);
    }
}
#[test]
fn admitted_raw_bytes_reach_canonical_remount_and_close() {
    let s = &scenarios()[0];
    let r = fuzz_admission(Context::KwdjProse, s.input_json.as_bytes());
    assert_eq!(r.admitted, 6);
    assert_eq!(r.closed, 2);
    assert_eq!(r.snapshot_exports, 6);
}
#[test]
fn actual_bridge_seed_reaches_command_history_and_owned_cleanup() {
    for context in [
        Context::KwdjProse,
        Context::KwdjPoetry,
        Context::NotesD0,
        Context::NotesD1,
    ] {
        let s = scenarios().iter().find(|s| s.context == context).unwrap();
        let options = serde_json::json!({"abi":"editor-sdk/2","build_id":editor_reliability_native::FUZZ_BUILD_ID,"profile":s.profile,"admission":"validate","access":"editable","registry_json":s.registry_json,"profile_options_json":s.profile_options_json});
        let seed = serde_json::json!({"input_json":s.input_json,"options_json":options.to_string(),"requests":["{\"kind\":\"state\"}","{\"kind\":\"catalog\"}","{\"kind\":\"destroy\"}","{\"kind\":\"state\",\"unknown\":true}"]});
        let r = editor_reliability_native::fuzz_bridge(context, seed.to_string().as_bytes());
        assert_eq!(r.admitted, 1);
        assert_eq!(r.command_publications, 1);
        assert_eq!(r.history_publications, 2);
        assert_eq!(r.snapshot_exports, 1);
        assert_eq!(r.closed, 1);
    }
}
#[test]
fn actual_notes_recipe_d1_and_d0_refusal_use_frozen_public_oracle() {
    let report = editor_reliability_native::properties::notes_recipe_and_d0_refusal();
    assert_eq!(report["status"], "passed");
}
