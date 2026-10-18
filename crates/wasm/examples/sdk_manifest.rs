//! Actual compiled manifest used to bind packaged WASM metadata to native source identity.
#[cfg(not(target_arch = "wasm32"))]
fn main() {
    serde_json::to_writer(std::io::stdout(), &klenwriter_editor_wasm::sdk::manifest()).unwrap();
}
#[cfg(target_arch = "wasm32")]
fn main() {}
