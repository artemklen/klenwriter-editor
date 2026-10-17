// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/transaction_observer.rs"]
mod transaction_observer;
fn main() {
    println!("{}", transaction_observer::observe());
}
