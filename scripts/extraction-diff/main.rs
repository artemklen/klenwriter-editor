use std::io::{self, BufRead};
use serde_json::{json, Value};
mod baseline { use klenwriter_domain::kwdj as api; include!("probe.rs"); }
mod extracted { use editor_kwdj as api; include!("probe.rs"); }
fn main() {
    std::panic::set_hook(Box::new(|_| {}));
    for line in io::stdin().lock().lines() {
        let case: Value = serde_json::from_str(&line.unwrap()).unwrap();
        let bytes = if let Some(raw) = case.get("raw").and_then(Value::as_str) { raw.as_bytes().to_vec() }
            else { serde_json::to_vec(&case["input"]).unwrap() };
        let normalize = case["normalize"].as_bool().unwrap_or(false);
        let identities = case["identities"].as_bool().unwrap_or(true);
        let project = case["project"].as_bool().unwrap_or(true);
        let old = baseline::run(&bytes, normalize, identities, project);
        let new = extracted::run(&bytes, normalize, identities, project);
        println!("{}",json!({"id":case["id"],"equal":old==new,"baseline":old,"extracted":new}));
    }
}
