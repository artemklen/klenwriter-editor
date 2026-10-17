// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_kwdj as profile;
#[path = "support/admission_budget_cases.rs"]
mod cases;

macro_rules! case {
    ($name:ident) => {
        #[test]
        fn $name() {
            cases::$name();
        }
    };
}
case!(raw_failure_precedes_parser);
case!(raw_and_canonical_limits_are_distinct);
case!(json_preflight_precedes_shape_and_copy);
case!(generic_counts_each_payload);
case!(nested_metadata_and_numbers_are_bounded);
case!(generic_admission_is_atomic);
case!(identity_resolution_waits_for_admission);
case!(host_settings_only_tighten);
case!(within_budget_codec_results_are_equal);
