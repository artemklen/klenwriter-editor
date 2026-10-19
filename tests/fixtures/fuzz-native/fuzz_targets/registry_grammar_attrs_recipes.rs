// SPDX-License-Identifier: MIT OR Apache-2.0
//! Family: registry/attrs/grammar/recipe descriptors. The whole input is the
//! raw closed-descriptor compiler payload; there is no context envelope.
#![no_main]
use editor_reliability_native::fuzz_registry;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|raw: &[u8]| {
    let _ = fuzz_registry(raw);
});
