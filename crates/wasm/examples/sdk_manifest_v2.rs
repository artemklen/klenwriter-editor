// SPDX-License-Identifier: MIT OR Apache-2.0
//! Actual selected compiled modules; never substitutes the legacy manifest.
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    serde_json::to_writer(
        std::io::stdout(),
        &klenwriter_editor_wasm::sdk_v2::manifest(),
    )
    .unwrap();
}
#[cfg(target_arch = "wasm32")]
fn main() {}
