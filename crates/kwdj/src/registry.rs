// SPDX-License-Identifier: MIT OR Apache-2.0
//! Public schema registration complements the normative KWDJ validator. Context,
//! identity services, normalization, URL policy and seven domain limits remain
//! in that validator; schema admission cannot grant those capabilities.

use std::collections::BTreeMap;
use std::sync::{Arc, OnceLock};

use editor_core::cache::{CacheUpdate, CandidateCache};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_registry::{
    CompilerLimits, ExtensionDescriptor, ExtensionIdentity, FrozenRegistry, Grammar,
    ProfileDescriptor, RegistryDescriptor, SchemaCache, compile_descriptor,
};

/// Trusted module registration. Supplying this value as an ordinary raw host
/// extension never confers permission to replace the mandatory KWDJ module.
pub fn base_registration() -> ExtensionDescriptor {
    let mut registration: ExtensionDescriptor =
        serde_json::from_slice(include_bytes!("registry-base-v1.json"))
            .expect("shipped KWDJ registration is a closed descriptor");
    registration.commands = crate::commands::KWDJ_COMMANDS
        .iter()
        .map(|command| editor_registry::CommandDescriptor::Compiled {
            id: command.id.into(),
        })
        .collect();
    registration
}

/// The ABI2 clipboard command is absent from the legacy static catalog.
pub fn base_registration_v2() -> ExtensionDescriptor {
    let mut registration = base_registration();
    registration
        .commands
        .push(editor_registry::CommandDescriptor::Compiled {
            id: crate::commands::CLIPBOARD_COMMAND_ID.into(),
        });
    registration
}

/// The codec accepts prose and poetry; the contextual domain validator owns
/// their distinct root policies. This common schema describes their union.
pub fn registry_descriptor() -> RegistryDescriptor {
    let blocks = [
        "paragraph",
        "heading",
        "blockquote",
        "bullet_list",
        "ordered_list",
        "task_list",
        "code_block",
        "scene_break",
        "table",
        "media_image",
        "literary_block",
        "warning",
        "spoiler",
        "disclosure",
        "verse",
    ];
    RegistryDescriptor {
        format: "editor-registry/1".into(),
        profile: ProfileDescriptor {
            id: crate::PROFILE_ID.into(),
            version: crate::KWDJ_PROFILE_VERSION.into(),
            codec_id: crate::KWDJ_CODEC_ID.into(),
            wire_version: 1,
        },
        selected_extensions: vec![ExtensionIdentity {
            id: crate::KWDJ_BASE_EXTENSION_ID.into(),
            version: crate::KWDJ_BASE_EXTENSION_VERSION.into(),
        }],
        root: Grammar::Repeat {
            item: Box::new(Grammar::Choice {
                items: blocks
                    .into_iter()
                    .map(|name| Grammar::Type {
                        id: format!("{}/{name}", crate::PROFILE_ID),
                    })
                    .collect(),
            }),
            min: 1,
            max: crate::MAX_NODE_COUNT,
        },
        mark_policy: BTreeMap::new(),
        extensions: vec![],
    }
}

pub(crate) fn default_registry() -> Arc<FrozenRegistry> {
    static REGISTRY: OnceLock<Arc<FrozenRegistry>> = OnceLock::new();
    Arc::clone(REGISTRY.get_or_init(|| {
        let mut work = WorkMeter::new(WorkLimits::default());
        Arc::new(
            compile_descriptor(
                &registry_descriptor(),
                &[base_registration()],
                CompilerLimits::default(),
                &mut work,
            )
            .expect("shipped KWDJ registration fits the distribution compiler"),
        )
    }))
}

impl editor_registry::RegistryProfile for crate::KwdjProfile<'_> {
    fn registry(&self) -> &FrozenRegistry {
        crate::KwdjProfile::registry(self)
    }
}

/// Both proofs are prepared under one budget and published together, after the
/// domain and schema validators succeed. Empty Default provides no reuse proof.
pub struct KwdjProfileCache<I: Copy + Eq + Ord> {
    pub(crate) domain: crate::KwdjCache<I>,
    pub(crate) schema: SchemaCache<I>,
}
impl<I: Copy + Eq + Ord> Default for KwdjProfileCache<I> {
    fn default() -> Self {
        Self {
            domain: Default::default(),
            schema: Default::default(),
        }
    }
}
pub struct KwdjProfileCachePatch<I: Copy + Eq + Ord> {
    pub(crate) domain: CacheUpdate<crate::KwdjCache<I>>,
    pub(crate) schema: CacheUpdate<SchemaCache<I>>,
}
impl<I: Copy + Eq + Ord> CandidateCache for KwdjProfileCache<I> {
    type Patch = KwdjProfileCachePatch<I>;
    fn publish(&mut self, patch: Self::Patch) {
        patch.domain.publish(&mut self.domain);
        patch.schema.publish(&mut self.schema);
    }
}
