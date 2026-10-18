// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::convert::{decimal, diagnostic};
use editor_notes::NotesLimits;
use editor_protocol::DiagnosticDto;
use serde::{Deserialize, Deserializer, Serialize};

fn required_nullable<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    deserializer: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(deserializer)
}

/// Every key is required; null requests the distribution default. Decimal
/// strings avoid JavaScript numeric conversion and can only tighten limits.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotesLimitsV2 {
    #[serde(deserialize_with = "required_nullable")]
    pub document_bytes: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub node_count: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub tree_depth: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub text_leaf_bytes: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub work_units: Option<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub work_bytes: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NotesOptionsV2 {
    pub root_blocks: Vec<String>,
    #[serde(deserialize_with = "required_nullable")]
    pub limits: Option<NotesLimitsV2>,
}
impl NotesOptionsV2 {
    pub fn effective_limits(&self) -> Result<NotesLimits, DiagnosticDto> {
        let mut result = NotesLimits::default();
        if let Some(limits) = &self.limits {
            for (source, target, path) in [
                (
                    &limits.document_bytes,
                    &mut result.document_bytes,
                    "/limits/document_bytes",
                ),
                (
                    &limits.node_count,
                    &mut result.node_count,
                    "/limits/node_count",
                ),
                (
                    &limits.tree_depth,
                    &mut result.tree_depth,
                    "/limits/tree_depth",
                ),
                (
                    &limits.text_leaf_bytes,
                    &mut result.text_leaf_bytes,
                    "/limits/text_leaf_bytes",
                ),
                (
                    &limits.work_units,
                    &mut result.work.units,
                    "/limits/work_units",
                ),
                (
                    &limits.work_bytes,
                    &mut result.work.bytes,
                    "/limits/work_bytes",
                ),
            ] {
                if let Some(source) = source {
                    *target = (*target).min(decimal(source, path)?);
                }
            }
        }
        Ok(result.effective())
    }
}

/// Internal canonical capability data contains the actual effective values,
/// independent of nullable/raw host spelling and root policy already in registry.
pub(crate) fn capability_bytes(limits: NotesLimits) -> Result<Vec<u8>, DiagnosticDto> {
    #[derive(Serialize)]
    struct Effective {
        document_bytes: u64,
        node_count: u64,
        tree_depth: u64,
        text_leaf_bytes: u64,
        work_units: u64,
        work_bytes: u64,
    }
    serde_json::to_vec(&Effective {
        document_bytes: limits.document_bytes,
        node_count: limits.node_count,
        tree_depth: limits.tree_depth,
        text_leaf_bytes: limits.text_leaf_bytes,
        work_units: limits.work.units,
        work_bytes: limits.work.bytes,
    })
    .map_err(|_| diagnostic("sdk.invalid_factory_context", ""))
}
