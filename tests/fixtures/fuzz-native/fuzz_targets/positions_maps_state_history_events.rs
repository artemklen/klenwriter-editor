// SPDX-License-Identifier: MIT OR Apache-2.0
//! Family: positions/maps/state/history/events. Payload bytes are consumed as
//! bounded opcodes (at most 64) driving insert/undo/redo/late-refusal/save/
//! events/mark-override/stale-revision paths on a frozen admitted baseline.
#![no_main]
use editor_reliability_fuzz::family_input;
use editor_reliability_native::fuzz_stateful;
use libfuzzer_sys::fuzz_target;

fuzz_target!(|raw: &[u8]| {
    if let Some((context, payload)) = family_input(raw) {
        let _ = fuzz_stateful(context, payload);
    }
});
