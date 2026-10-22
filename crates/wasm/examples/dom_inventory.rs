// SPDX-License-Identifier: MIT OR Apache-2.0
//! Native-only trusted witnesses for the two explicitly supported DOM bindings.
//! Candidate IDs come from selected public registrations, then every descriptor
//! and owner is resolved through the same FrozenRegistry used by SDK2 factories.
#[cfg(not(target_arch = "wasm32"))]
fn inventory(
    descriptor: &editor_registry::RegistryDescriptor,
    mandatory: &[editor_registry::ExtensionDescriptor],
) -> serde_json::Value {
    use editor_core::transaction::{WorkLimits, WorkMeter};
    use editor_registry::{CompilerLimits, compile_descriptor};
    use serde_json::json;
    use std::collections::BTreeSet;

    assert!(
        descriptor.extensions.is_empty(),
        "exact base composition only"
    );
    let registry = compile_descriptor(
        descriptor,
        mandatory,
        CompilerLimits::default(),
        &mut WorkMeter::new(WorkLimits::default()),
    )
    .expect("shipped composition must compile");
    let selected: BTreeSet<_> = descriptor
        .selected_extensions
        .iter()
        .map(|value| value.id.as_str())
        .collect();
    let mut nodes = Vec::new();
    let mut marks = Vec::new();
    for extension in mandatory {
        assert!(selected.contains(extension.id.as_str()));
        for candidate in &extension.nodes {
            let actual = registry.node(&candidate.id).expect("compiled node");
            assert_eq!(actual.owner, extension.id);
            assert_eq!(
                serde_json::to_value(actual.descriptor).unwrap(),
                serde_json::to_value(candidate).unwrap()
            );
            nodes.push(json!({
                "id": actual.descriptor.id,
                "owner": actual.owner,
                "primitive": actual.descriptor.primitive,
                "attributes": actual.descriptor.attrs.keys().collect::<Vec<_>>(),
                "attributeSchemas": actual.descriptor.attrs,
                "children": actual.descriptor.children,
                "allowedMarks": actual.allowed_marks(),
            }));
        }
        for candidate in &extension.marks {
            let actual = registry.mark(&candidate.id).expect("compiled mark");
            assert_eq!(actual.owner, extension.id);
            assert_eq!(
                serde_json::to_value(actual.descriptor).unwrap(),
                serde_json::to_value(candidate).unwrap()
            );
            marks.push(json!({
                "id": actual.descriptor.id,
                "owner": actual.owner,
                "attributes": actual.descriptor.attrs.keys().collect::<Vec<_>>(),
                "attributeSchemas": actual.descriptor.attrs,
                "excludes": actual.descriptor.excludes,
            }));
        }
    }
    nodes.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    marks.sort_by(|a, b| a["id"].as_str().cmp(&b["id"].as_str()));
    let command_witnesses: Vec<_> = registry
        .catalog_ids()
        .iter()
        .map(|id| {
            let actual = registry.command(id).expect("compiled command");
            assert!(selected.contains(actual.owner));
            assert!(registry.compiled_catalog_ids().contains(id));
            json!({"id": id, "owner": actual.owner, "descriptor": actual.descriptor})
        })
        .collect();
    json!({
        "profile": editor_bridge::convert::profile_out(registry.binding()),
        "registryDigest": registry.digest().to_hex(),
        "extensions": registry.extension_order().iter().map(|value| json!({
            "id": value.id(), "version": value.version(),
        })).collect::<Vec<_>>(),
        "inventory": {"nodes": nodes, "marks": marks, "commands": registry.catalog_ids()},
        "commandWitnesses": command_witnesses,
    })
}

#[cfg(not(target_arch = "wasm32"))]
fn main() {
    let kwdj = inventory(
        &editor_kwdj::registry::registry_descriptor(),
        &[editor_kwdj::registry::base_registration_v2()],
    );
    let typing_descriptor = editor_kwdj::registry::typing_registry_descriptor();
    let kwdj_typing = inventory(
        &typing_descriptor,
        &[
            editor_kwdj::registry::base_registration_v2(),
            editor_kwdj::registry::typing_registration(),
        ],
    );
    // Static catalog comes from native command targets and the same compiled
    // registration witness; no JavaScript target registry is authored here.
    for id in [
        "org.klenwriter.kwdj/command/insert-block",
        "org.klenwriter.kwdj/command/accept-slash",
    ] {
        assert!(
            kwdj["commandWitnesses"]
                .as_array()
                .unwrap()
                .iter()
                .any(|w| w["id"] == id)
        );
    }
    let insertions: Vec<_> = editor_kwdj::commands::KWDJ_SLASH_CANDIDATES.iter().map(|candidate| {
        serde_json::json!({"id": candidate.id, "target": editor_kwdj_sdk::target_out(&candidate.target)})
    }).collect();
    let text_types: Vec<_> = editor_kwdj::commands::KWDJ_SLASH_TEXT_BLOCK_TYPES
        .iter()
        .map(|id| {
            let actual = kwdj["inventory"]["nodes"]
                .as_array()
                .unwrap()
                .iter()
                .find(|node| node["id"] == *id)
                .expect("eligible native type is compiled");
            assert_eq!(actual["primitive"], "text_block");
            *id
        })
        .collect();
    let notes_descriptor =
        serde_json::from_slice(include_bytes!("../../../examples/notes-extension/d0.json"))
            .expect("shipped Notes D0 descriptor");
    let notes = inventory(
        &notes_descriptor,
        &[editor_notes::base_registration(&[
            editor_notes::PARAGRAPH.into()
        ])],
    );
    serde_json::to_writer_pretty(
        std::io::stdout(),
        &serde_json::json!({"format": "klenwriter-editor-dom-inventory/1", "kwdj": kwdj, "kwdjTyping": kwdj_typing, "kwdjTypingRegistry": typing_descriptor, "notesD0": notes, "kwdjInsertions": {"candidates": insertions, "textBlockTypes": text_types}}),
    )
    .unwrap();
    println!();
}

#[cfg(target_arch = "wasm32")]
fn main() {}
