// SPDX-License-Identifier: MIT OR Apache-2.0
use klenwriter_editor_kwdj_sdk as kwdj_sdk;
#[path = "support/typography_witness.rs"]
mod witness;

#[test]
fn frozen_typography_native_oracles_and_source_fixture_translations() {
    let report = witness::run();
    assert_eq!(report["native_oracle_count"], 16);
    assert_eq!(report["cms_source_bodies"], 17);
    assert_eq!(report["status"], "passed");
}
