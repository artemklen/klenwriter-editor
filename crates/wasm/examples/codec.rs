// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test transport for identical raw inputs in native and Node/WASM runners.
use klenwriter_editor_wasm::codec::{Operation, execute};
use serde::Deserialize;
use std::io::{self, BufRead};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Request {
    operation: Operation,
    input: String,
    options: String,
}
fn main() {
    for line in io::stdin().lock().lines() {
        let request: Request =
            serde_json::from_str(&line.expect("fixture line")).expect("fixture request");
        println!(
            "{}",
            execute(
                request.operation,
                request.input.as_bytes(),
                &request.options
            )
            .json()
        );
    }
}
