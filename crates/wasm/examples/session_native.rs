// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native counterpart of the test-only WASM session composition witness.
#[path = "support/session_observer.rs"]
mod session_observer;

fn main() {
    println!("{}", session_observer::observe());
}
