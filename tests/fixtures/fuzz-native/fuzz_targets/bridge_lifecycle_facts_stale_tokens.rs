// SPDX-License-Identifier: MIT OR Apache-2.0
//! Family: public bridge/lifecycle/facts/stale tokens. Payload is the test
//! envelope JSON; its exact input/options/request strings reach the real
//! distribution bridge unchanged. Bridge Fatal inside bounds fails.
#![no_main]
use editor_reliability_fuzz::family_input;
use editor_reliability_native::fuzz_bridge;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|raw: &[u8]| {
    if let Some((context, payload)) = family_input(raw) {
        let _ = fuzz_bridge(context, payload);
    }
});
