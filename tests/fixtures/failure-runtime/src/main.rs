fn main() {
    println!(
        "{}",
        serde_json::to_string(&editor_failure_runtime::manifest()).expect("manifest serializes")
    );
}
