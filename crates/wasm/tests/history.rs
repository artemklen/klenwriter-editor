// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/history_observer.rs"]
mod observer;
#[test]
fn actual_adr_history_matches_all16_unchanged_seeds() {
    let r = observer::observe_adr();
    assert_eq!(r["seed_passed"], 16);
    assert_eq!(r["direct"], 15);
    assert_eq!(r["declared_structural_embeddings"], 1);
}
macro_rules! literal {
    ($name:ident,$id:literal) => {
        #[test]
        fn $name() {
            let r = observer::observe_literal($id);
            assert_eq!(r["status"], "passed", "{r:#}");
        }
    };
}
literal!(history_literal_01, "H01");
literal!(history_literal_02, "H02");
literal!(history_literal_03, "H03");
literal!(history_literal_04, "H04");
literal!(history_literal_05, "H05");
literal!(history_literal_06, "H06");
literal!(history_literal_07, "H07");
literal!(history_literal_08, "H08");
literal!(history_literal_09, "H09");
literal!(history_literal_10, "H10");
literal!(history_literal_11, "H11");
literal!(history_literal_12, "H12");
literal!(history_literal_13, "H13");
literal!(history_literal_14, "H14");
literal!(history_literal_15, "H15");
literal!(history_literal_16, "H16");
literal!(history_literal_17, "H17");
literal!(history_literal_18, "H18");
literal!(history_literal_19, "H19");
literal!(history_literal_20, "H20");
literal!(history_literal_21, "H21");
literal!(history_literal_22, "H22");
literal!(history_literal_24, "H24");
literal!(history_literal_25, "H25");
literal!(history_literal_26, "H26");
literal!(history_literal_27, "H27");
literal!(history_literal_28, "H28");
literal!(history_literal_29, "H29");
literal!(history_literal_30, "H30");

#[test]
fn explicit_history_profile_without_command_provider_and_rewrite_refusal() {
    assert_eq!(observer::observe_hp_only()["status"], "passed");
}

#[test]
fn actual_member_epoch_and_budget_supplements() {
    assert_eq!(observer::observe_supplements()["status"], "passed");
}
#[test]
fn actual_closed_poisoned_and_readonly_history_refusals() {
    assert_eq!(observer::observe_lifecycle()["case_total"], 3);
}
#[test]
fn actual_generated_unicode_restore_cycles() {
    assert_eq!(observer::observe_generated()["case_total"], 8);
}
#[test]
fn complete_shared_history_report_is_executed() {
    let r = observer::observe();
    assert_eq!(r["status"], "passed");
    assert_eq!(r["kwdj"]["literal_passed"], 29);
}

#[test]
fn actual_bounded_history_recurrence() {
    let r = observer::observe_recurrence();
    assert_eq!(r["cycles"], 512);
    assert_eq!(r["document_publications"], 1536);
}
