// SPDX-License-Identifier: MIT OR Apache-2.0
//! Family: raw admission/options. Original payload bytes reach both real
//! admission modes before any harness JSON parse; typed refusal is expected,
//! and a panic/trap is never converted into a pass.
#![no_main]
use editor_reliability_fuzz::family_input;
use editor_reliability_native::fuzz_admission;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|raw: &[u8]| {
    if let Some((context, payload)) = family_input(raw) {
        let _ = fuzz_admission(context, payload);
    }
});
