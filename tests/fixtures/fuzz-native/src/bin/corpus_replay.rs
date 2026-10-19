// SPDX-License-Identifier: MIT OR Apache-2.0
//! Deterministic regression replay of retained corpus inputs through the same
//! four family entries the fuzz targets drive, with aggregated per-context
//! phase reachability. Any harness panic fails the replay; no outcome is
//! converted into a pass. Original corpus bytes are read unchanged.
#![forbid(unsafe_code)]

use editor_reliability_fuzz::{
    FAMILY_ADMISSION_OPTIONS, FAMILY_BRIDGE_LIFECYCLE_FACTS_STALE_TOKENS,
    FAMILY_POSITIONS_MAPS_STATE_HISTORY_EVENTS, FAMILY_REGISTRY_GRAMMAR_ATTRS_RECIPES,
    family_input,
};
use editor_reliability_native::{
    fuzz_admission, fuzz_bridge, fuzz_registry, fuzz_stateful, model::Reachability,
};
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::path::PathBuf;

const MAX_CORPUS_FILE: u64 = 64 * 1024;

fn merge(target: &mut Value, addition: &Value) {
    match (target, addition) {
        (Value::Object(map), Value::Object(other)) => {
            for (key, value) in other {
                match map.get_mut(key) {
                    Some(existing) => merge(existing, value),
                    None => {
                        map.insert(key.clone(), value.clone());
                    }
                }
            }
        }
        (Value::Array(items), Value::Array(other)) => {
            for (index, value) in other.iter().enumerate() {
                if index == items.len() {
                    items.push(value.clone());
                } else {
                    merge(&mut items[index], value);
                }
            }
        }
        (slot @ (Value::Bool(_) | Value::Number(_) | Value::String(_)), value) => {
            if let (Some(sum), Some(add)) = (slot.as_u64(), value.as_u64()) {
                *slot = json!(sum.wrapping_add(add));
            }
        }
        _ => {}
    }
}

fn reachable(reachability: &Reachability) -> Value {
    serde_json::to_value(reachability).expect("reachability serializes")
}

fn panic_message(error: Box<dyn std::any::Any + Send>) -> String {
    let mut text = String::new();
    if let Some(message) = error.downcast_ref::<String>() {
        let _ = write!(text, "{message}");
    } else if let Some(message) = error.downcast_ref::<&str>() {
        let _ = write!(text, "{message}");
    } else {
        text.push_str("non-string panic payload");
    }
    // Keep the original panic text; the parent hashes and retains it verbatim.
    text.truncate(4096);
    text
}

fn corpus_files(directories: &[PathBuf]) -> Vec<PathBuf> {
    let mut files = vec![];
    for directory in directories {
        let mut entries = std::fs::read_dir(directory)
            .unwrap_or_else(|error| panic!("corpus directory {}: {error}", directory.display()))
            .map(|entry| {
                let entry = entry.expect("corpus directory read");
                let kind = entry.file_type().expect("corpus entry type");
                assert!(
                    kind.is_file(),
                    "corpus entry is not a regular file: {}",
                    entry.path().display()
                );
                let path = entry.path();
                let size = entry.metadata().expect("corpus entry metadata").len();
                assert!(
                    size <= MAX_CORPUS_FILE,
                    "corpus input exceeds bound: {}",
                    path.display()
                );
                path
            })
            .collect::<Vec<_>>();
        entries.sort();
        files.extend(entries);
    }
    files
}

fn main() {
    let mut arguments = std::env::args_os();
    let program = arguments.next();
    let family = arguments
        .next()
        .unwrap_or_else(|| {
            eprintln!(
                "usage: {} <family> <corpus-directory>...",
                program.unwrap_or_default().to_string_lossy()
            );
            std::process::exit(2);
        })
        .to_string_lossy()
        .into_owned();
    let directories: Vec<PathBuf> = arguments.map(PathBuf::from).collect();
    assert!(
        !directories.is_empty(),
        "at least one corpus directory required"
    );

    let mut aggregate: BTreeMap<String, Value> = BTreeMap::new();
    let mut files = vec![];
    let mut failures = vec![];
    for path in corpus_files(&directories) {
        let raw = std::fs::read(&path)
            .unwrap_or_else(|error| panic!("corpus read {}: {error}", path.display()));
        let name = path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into_owned();
        let outcome = catch_unwind(AssertUnwindSafe(|| -> Reachability {
            match family.as_str() {
                FAMILY_ADMISSION_OPTIONS => family_input(&raw)
                    .map(|(context, payload)| fuzz_admission(context, payload))
                    .unwrap_or_default(),
                FAMILY_REGISTRY_GRAMMAR_ATTRS_RECIPES => fuzz_registry(&raw),
                FAMILY_POSITIONS_MAPS_STATE_HISTORY_EVENTS => family_input(&raw)
                    .map(|(context, payload)| fuzz_stateful(context, payload))
                    .unwrap_or_default(),
                FAMILY_BRIDGE_LIFECYCLE_FACTS_STALE_TOKENS => family_input(&raw)
                    .map(|(context, payload)| fuzz_bridge(context, payload))
                    .unwrap_or_default(),
                other => panic!("unknown family: {other}"),
            }
        }));
        // The registry compiler has no context; other families aggregate per
        // envelope-selected context, with malformed envelopes kept separate.
        let scope = if family == FAMILY_REGISTRY_GRAMMAR_ATTRS_RECIPES {
            "registry".to_owned()
        } else {
            match family_input(&raw) {
                Some((context, _)) => context.name().to_owned(),
                None => "envelope".to_owned(),
            }
        };
        let entry = match outcome {
            Ok(reachability) => {
                merge(
                    aggregate.entry(scope).or_insert_with(|| json!({})),
                    &reachable(&reachability),
                );
                json!({ "name": name, "bytes": raw.len(), "ok": true, "admitted": reachability.admitted })
            }
            Err(error) => {
                failures.push(
                    json!({ "name": name, "bytes": raw.len(), "panic": panic_message(error) }),
                );
                json!({ "name": name, "bytes": raw.len(), "ok": false })
            }
        };
        files.push(entry);
    }

    let report = json!({
        "format": "editor-reliability-fuzz-corpus-replay/1",
        "family": family,
        "status": if failures.is_empty() { "passed" } else { "failed" },
        "directories": directories.iter().map(|path| path.display().to_string()).collect::<Vec<_>>(),
        "files": files,
        "aggregate": aggregate,
        "failures": failures,
    });
    println!(
        "{}",
        serde_json::to_string(&report).expect("report serializes")
    );
    if !failures.is_empty() {
        std::process::exit(1);
    }
}
