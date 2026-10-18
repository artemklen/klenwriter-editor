// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_registry::{CompilerLimits, RegistryDescriptor};
use klenwriter_editor_notes::{NotesLimits, NotesProfile, PARAGRAPH};
use serde_json::json;

pub fn descriptor(d1: bool) -> RegistryDescriptor {
    let mut selected = vec![json!({"id":"org.example.notes/base","version":"1.0.0"})];
    let mut extensions = vec![];
    let mut mark_policy = json!({});
    if d1 {
        selected.extend([
            json!({"id":"org.example.notes/callout","version":"1.0.0"}),
            json!({"id":"org.example.notes/highlight","version":"1.0.0"}),
        ]);
        extensions.push(json!({
            "id":"org.example.notes/callout","version":"1.0.0",
            "dependencies":[{"id":"org.example.notes/base","version":"1.0.0"}],
            "nodes":[{"id":"org.example.notes/callout","primitive":"container",
                "attrs":{"kind":{"required":true,"value":{"kind":"enum","values":["info","warning"]}},
                    "title":{"required":true,"value":{"kind":"nullable","inner":{"kind":"string","max_bytes":256}}}},
                "children":{"op":"repeat","item":{"op":"choice","items":[{"op":"type","id":"org.example.notes/paragraph"},{"op":"type","id":"org.example.notes/callout"}]},"min":0,"max":65535},
                "marks":[]}],"marks":[],"commands":[]
        }));
        extensions.push(json!({
            "id":"org.example.notes/highlight","version":"1.0.0",
            "dependencies":[{"id":"org.example.notes/base","version":"1.0.0"}],
            "nodes":[],"marks":[{"id":"org.example.notes/highlight",
                "attrs":{"color":{"required":true,"value":{"kind":"enum","values":["sun","mint"]}}},"excludes":[]}],"commands":[]
        }));
        mark_policy = json!({"org.example.notes/text":["org.example.notes/highlight"]});
    }
    serde_json::from_value(json!({
        "format":"editor-registry/1","profile":{"id":"org.example.notes","version":"1.0.0","codec_id":"org.example.notes/json","wire_version":1},
        "selected_extensions":selected,"root":{"op":"type","id":"org.example.notes/document"},
        "mark_policy":mark_policy,"extensions":extensions,
    })).unwrap()
}

pub fn profile_with_limits(d1: bool, limits: NotesLimits) -> NotesProfile {
    let mut blocks = vec![PARAGRAPH.to_owned()];
    if d1 {
        blocks.push("org.example.notes/callout".into());
    }
    NotesProfile::compile(
        &descriptor(d1),
        &blocks,
        limits,
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .unwrap()
}
pub fn profile(d1: bool) -> NotesProfile {
    profile_with_limits(d1, NotesLimits::default())
}
