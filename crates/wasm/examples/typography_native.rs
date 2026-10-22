// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_kwdj_sdk as kwdj_sdk;
#[path = "../../kwdj-sdk/tests/support/typography_witness.rs"]
mod witness;
fn main() {
    println!("{}", witness::run());
}
