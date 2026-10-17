// SPDX-License-Identifier: MIT OR Apache-2.0
//! JSONL test observer for the versioned corpus; not an installed consumer API.
use std::io::{self, BufRead};
#[path = "support/corpus_observer.rs"]
mod corpus_observer;
fn main() {
    for line in io::stdin().lock().lines() {
        println!("{}", corpus_observer::observe(&line.expect("fixture line")));
    }
}
