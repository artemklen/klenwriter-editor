// SPDX-License-Identifier: MIT OR Apache-2.0
//! Generic operation algebra and trusted profile phases, independent of engine.

use crate::candidate::CandidateRead;
use crate::document::{Attribute, Document, Mark, Primitive};
use crate::limits::{LimitExceeded, check};
use crate::positions::Utf16Offset;
use crate::profile::FrozenProfile;

/// All variants prepare candidates; only the engine owns publication. Transform
/// preserves text/marks/children; incompatible final shapes refuse atomically.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Operation<I> {
    ReplaceText {
        leaf: I,
        from: Utf16Offset,
        to: Utf16Offset,
        inserted: String,
    },
    SplitText {
        leaf: I,
        at: Utf16Offset,
    },
    JoinText {
        left: I,
        right: I,
    },
    SetAttribute {
        node: I,
        key: String,
        value: Option<Attribute>,
    },
    SetMarks {
        leaf: I,
        marks: Vec<Mark>,
    },
    Transform {
        node: I,
        type_id: String,
        primitive: Primitive,
    },
    InsertFragment {
        parent: I,
        index: usize,
        fragment: Document,
    },
    Move {
        node: I,
        parent: I,
        before_index: usize,
    },
    Duplicate {
        node: I,
        parent: I,
        index: usize,
    },
    Remove {
        node: I,
    },
}

impl<I> Operation<I> {
    /// Resolve addresses without copying text, marks, attributes or fragments.
    pub fn try_map_ids<J, E>(
        self,
        mut resolve: impl FnMut(I) -> Result<J, E>,
    ) -> Result<Operation<J>, E> {
        Ok(match self {
            Self::ReplaceText {
                leaf,
                from,
                to,
                inserted,
            } => Operation::ReplaceText {
                leaf: resolve(leaf)?,
                from,
                to,
                inserted,
            },
            Self::SplitText { leaf, at } => Operation::SplitText {
                leaf: resolve(leaf)?,
                at,
            },
            Self::JoinText { left, right } => Operation::JoinText {
                left: resolve(left)?,
                right: resolve(right)?,
            },
            Self::SetAttribute { node, key, value } => Operation::SetAttribute {
                node: resolve(node)?,
                key,
                value,
            },
            Self::SetMarks { leaf, marks } => Operation::SetMarks {
                leaf: resolve(leaf)?,
                marks,
            },
            Self::Transform {
                node,
                type_id,
                primitive,
            } => Operation::Transform {
                node: resolve(node)?,
                type_id,
                primitive,
            },
            Self::InsertFragment {
                parent,
                index,
                fragment,
            } => Operation::InsertFragment {
                parent: resolve(parent)?,
                index,
                fragment,
            },
            Self::Move {
                node,
                parent,
                before_index,
            } => Operation::Move {
                node: resolve(node)?,
                parent: resolve(parent)?,
                before_index,
            },
            Self::Duplicate {
                node,
                parent,
                index,
            } => Operation::Duplicate {
                node: resolve(node)?,
                parent: resolve(parent)?,
                index,
            },
            Self::Remove { node } => Operation::Remove {
                node: resolve(node)?,
            },
        })
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkLimits {
    pub units: u64,
    pub bytes: u64,
}

impl Default for WorkLimits {
    fn default() -> Self {
        Self {
            units: 1_000_000,
            bytes: 64 * 1024 * 1024,
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WorkUsage {
    pub units: u64,
    pub bytes: u64,
}

#[derive(Debug)]
pub struct WorkMeter {
    limits: WorkLimits,
    usage: WorkUsage,
}

impl WorkMeter {
    pub fn new(requested: WorkLimits) -> Self {
        let hard = WorkLimits::default();
        Self {
            limits: WorkLimits {
                units: requested.units.min(hard.units),
                bytes: requested.bytes.min(hard.bytes),
            },
            usage: WorkUsage::default(),
        }
    }
    pub fn usage(&self) -> WorkUsage {
        self.usage
    }
    pub fn limits(&self) -> WorkLimits {
        self.limits
    }
    pub fn charge_units(&mut self, amount: u64) -> Result<(), LimitExceeded> {
        let observed = self.usage.units.saturating_add(amount);
        check("transaction_work", self.limits.units, observed)?;
        self.usage.units = observed;
        Ok(())
    }
    pub fn charge_bytes(&mut self, amount: u64) -> Result<(), LimitExceeded> {
        let observed = self.usage.bytes.saturating_add(amount);
        check("transaction_bytes", self.limits.bytes, observed)?;
        self.usage.bytes = observed;
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct ValidationStats {
    pub canonical_bytes: u64,
    pub nodes: u64,
}

/// Trusted compiled profile rules. Normalization proposes explicit operations;
/// validators only read the final candidate. Neither phase publishes or invokes
/// host subscribers. Implementations must meter work before allocation/scanning.
pub trait TransactionProfile: FrozenProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        candidate: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error>;
    fn validate_candidate<V: CandidateRead>(
        &self,
        context: &Self::Context,
        candidate: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error>;
}
