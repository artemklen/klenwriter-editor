fn main() {
    let json = serde_json::to_string(&editor_internal_wasm::build_info()).unwrap();
    std::fs::create_dir_all("artifacts").unwrap();
    std::fs::write("artifacts/native-build-info.json", json).unwrap();
}
