// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "../examples/support/delta_observer.rs"]
mod observer;
macro_rules! literal {
    ($name:ident,$id:literal) => {
        #[test]
        fn $name() {
            assert_eq!(observer::observe_one($id, false)["status"], "passed");
        }
    };
}
literal!(delta_literal_01, "D01");
literal!(delta_literal_02, "D02");
literal!(delta_literal_03, "D03");
literal!(delta_literal_04, "D04");
literal!(delta_literal_05, "D05");
literal!(delta_literal_06, "D06");
literal!(delta_literal_07, "D07");
literal!(delta_literal_08, "D08");
literal!(delta_literal_09, "D09");
literal!(delta_literal_10, "D10");
literal!(delta_literal_11, "D11");
literal!(delta_literal_12, "D12");
literal!(delta_literal_13, "D13");
#[test]
fn literal_results_match_full_authoritative_cohort() {
    assert_eq!(
        observer::observe_literals()["same_literal_and_full_authoritative_results"],
        true
    );
}
#[test]
fn actual_incremental_phase_series_is_bounded() {
    assert_eq!(observer::observe_series()["portable"]["status"], "passed");
}
