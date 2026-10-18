// SPDX-License-Identifier: MIT OR Apache-2.0
#[path = "support/delta_observer.rs"]
mod observer;
fn main() {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    let benchmark = args.iter().any(|arg| arg == "--benchmark");
    let round = args
        .iter()
        .position(|arg| arg == "--benchmark-round")
        .map(|index| args[index + 1].parse::<usize>().unwrap());
    println!(
        "{}",
        if let Some(round) = round {
            observer::observe_benchmark_round(round)
        } else if benchmark {
            observer::observe_benchmark()
        } else {
            observer::observe()
        }
    );
}
