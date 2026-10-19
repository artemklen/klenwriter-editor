// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/composition_observer.rs"]
mod observer;
fn main() {
    let report = observer::observe();
    println!("{report}");
    if report["status"] != "passed" {
        std::process::exit(1);
    }
}
