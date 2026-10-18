// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_reliability_native::{model::Scenario, replay_scenario};
use std::io::{self, BufRead, Write};
fn main() {
    if std::env::args().any(|s| s == "--operations") {
        let result = editor_reliability_native::properties::operation_literals();
        println!("{}", serde_json::to_string(&result).unwrap());
        if result.is_err() {
            std::process::exit(1);
        }
        return;
    }
    let stdin = io::stdin();
    let mut output = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.expect("read scenario");
        if line.trim().is_empty() {
            continue;
        }
        let scenario: Scenario = serde_json::from_str(&line).expect("closed frozen scenario");
        let report = replay_scenario(&scenario);
        serde_json::to_writer(&mut output, &report).expect("report serialization");
        writeln!(output).expect("report write");
        output.flush().expect("report flush");
        if report.is_err() {
            std::process::exit(1);
        }
    }
}
