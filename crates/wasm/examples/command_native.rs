// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/command_observer.rs"]
mod observer;
fn main() {
    println!("{}", observer::observe());
}
