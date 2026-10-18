// SPDX-License-Identifier: MIT OR Apache-2.0
//! Generic operation algebra and trusted profile phases, independent of engine.

use crate::candidate::CandidateRead;
use crate::document::{Attribute, Document, Mark, Node, Primitive};
use crate::limits::{LimitExceeded, check};
use crate::positions::{Position, Selection, Utf16Offset};
use crate::profile::FrozenProfile;

/// One exact-key delta applied uniformly to every selected text run.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MarkEdit {
    Upsert(Mark),
    Remove { type_id: String },
}

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
    PatchMarkRange {
        range: Selection<I>,
        edits: Vec<MarkEdit>,
    },
    /// Replace one inline-parent range with an optional single leaf prototype:
    /// Text has text; HardBreak/InlineAtom have none; every prototype is childless.
    /// The profile supplies type/metadata and final semantic validation.
    ReplaceInlineRange {
        range: Selection<I>,
        inserted: Option<Node>,
    },
    MoveInlineGroup {
        nodes: Vec<I>,
        parent: I,
        before_index: usize,
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
        fn position<I, J, E>(
            position: Position<I>,
            resolve: &mut impl FnMut(I) -> Result<J, E>,
        ) -> Result<Position<J>, E> {
            Ok(match position {
                Position::Text {
                    leaf,
                    utf16,
                    affinity,
                } => Position::Text {
                    leaf: resolve(leaf)?,
                    utf16,
                    affinity,
                },
                Position::Child {
                    parent,
                    index,
                    affinity,
                } => Position::Child {
                    parent: resolve(parent)?,
                    index,
                    affinity,
                },
                Position::Edge { node, side } => Position::Edge {
                    node: resolve(node)?,
                    side,
                },
            })
        }
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
            Self::PatchMarkRange { range, edits } => Operation::PatchMarkRange {
                range: Selection {
                    anchor: position(range.anchor, &mut resolve)?,
                    focus: position(range.focus, &mut resolve)?,
                },
                edits,
            },
            Self::ReplaceInlineRange { range, inserted } => Operation::ReplaceInlineRange {
                range: Selection {
                    anchor: position(range.anchor, &mut resolve)?,
                    focus: position(range.focus, &mut resolve)?,
                },
                inserted,
            },
            Self::MoveInlineGroup {
                nodes,
                parent,
                before_index,
            } => Operation::MoveInlineGroup {
                nodes: nodes
                    .into_iter()
                    .map(&mut resolve)
                    .collect::<Result<Vec<_>, _>>()?,
                parent: resolve(parent)?,
                before_index,
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

/// Hard bound for constructing retained immutable proofs at admission/remount.
/// Ordinary transaction/compiler meters retain their separate lower ceilings.
pub const ADMISSION_CACHE_WORK_LIMITS: WorkLimits = WorkLimits {
    units: 4_000_000,
    bytes: 128 * 1024 * 1024,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WorkUsage {
    pub units: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[repr(usize)]
pub enum WorkPhase {
    Structure,
    Header,
    Preflight,
    Normalization,
    Serialization,
    StaticValidation,
    Identity,
    CacheReuse,
    CacheUpdate,
    Impact,
    Event,
    Export,
    FullFallback,
}

pub const WORK_PHASE_COUNT: usize = 13;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct PhaseUsage {
    pub visits: u64,
    pub bytes: u64,
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct WorkTrace {
    pub phases: [PhaseUsage; WORK_PHASE_COUNT],
}

impl WorkTrace {
    pub fn phase(&self, phase: WorkPhase) -> PhaseUsage {
        self.phases[phase as usize]
    }
}

#[derive(Debug)]
pub struct WorkMeter {
    limits: WorkLimits,
    usage: WorkUsage,
    trace: WorkTrace,
}

impl WorkMeter {
    pub fn new(requested: WorkLimits) -> Self {
        Self::bounded(requested, WorkLimits::default())
    }
    /// Only admission/remount cache construction uses this capability. A
    /// profile request can lower, but cannot exceed, its fixed hard ceiling.
    pub fn for_admission_cache(requested: WorkLimits) -> Self {
        Self::bounded(requested, ADMISSION_CACHE_WORK_LIMITS)
    }
    fn bounded(requested: WorkLimits, hard: WorkLimits) -> Self {
        Self {
            limits: WorkLimits {
                units: requested.units.min(hard.units),
                bytes: requested.bytes.min(hard.bytes),
            },
            usage: WorkUsage::default(),
            trace: WorkTrace::default(),
        }
    }
    pub fn usage(&self) -> WorkUsage {
        self.usage
    }
    pub fn limits(&self) -> WorkLimits {
        self.limits
    }
    /// Limit a nested phase relative to its actual entry usage. All callers
    /// share these counters and trace; returning or unwinding restores only
    /// the enclosing ceilings, never spent work. Nested phases cannot raise
    /// an enclosing limit, including when the supplied cap is u64::MAX.
    pub fn with_budget<T>(&mut self, budget: WorkLimits, run: impl FnOnce(&mut Self) -> T) -> T {
        struct Restore<'a> {
            work: &'a mut WorkMeter,
            limits: WorkLimits,
        }
        impl Drop for Restore<'_> {
            fn drop(&mut self) {
                self.work.limits = self.limits;
            }
        }
        let previous = self.limits;
        self.limits = WorkLimits {
            units: previous
                .units
                .min(self.usage.units.saturating_add(budget.units)),
            bytes: previous
                .bytes
                .min(self.usage.bytes.saturating_add(budget.bytes)),
        };
        let restore = Restore {
            work: self,
            limits: previous,
        };
        run(&mut *restore.work)
    }
    pub fn trace(&self) -> WorkTrace {
        self.trace
    }
    /// Instrument actual visits/bytes separately from logical charged work.
    /// Counters are observational and do not confer a resource allowance.
    pub fn note_phase(&mut self, phase: WorkPhase, visits: u64, bytes: u64) {
        let counter = &mut self.trace.phases[phase as usize];
        counter.visits = counter.visits.saturating_add(visits);
        counter.bytes = counter.bytes.saturating_add(bytes);
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

#[cfg(test)]
mod work_budget_tests {
    use super::*;

    #[test]
    fn nested_budget_retains_one_usage_trace_and_restores_only_limits() {
        let mut work = WorkMeter::new(WorkLimits {
            units: 100,
            bytes: 1000,
        });
        work.charge_units(10).unwrap();
        work.charge_bytes(20).unwrap();
        work.note_phase(WorkPhase::Preflight, 1, 20);
        work.with_budget(WorkLimits { units: 2, bytes: 3 }, |work| {
            assert_eq!(
                work.limits(),
                WorkLimits {
                    units: 12,
                    bytes: 23
                }
            );
            work.charge_units(2).unwrap();
            work.charge_bytes(3).unwrap();
            work.note_phase(WorkPhase::Preflight, 2, 3);
            assert!(work.charge_units(1).is_err());
            work.with_budget(
                WorkLimits {
                    units: u64::MAX,
                    bytes: u64::MAX,
                },
                |work| {
                    assert!(work.charge_units(1).is_err());
                    assert!(work.charge_bytes(1).is_err());
                },
            );
        });
        assert_eq!(
            work.limits(),
            WorkLimits {
                units: 100,
                bytes: 1000
            }
        );
        assert_eq!(
            work.usage(),
            WorkUsage {
                units: 12,
                bytes: 23
            }
        );
        assert_eq!(
            work.trace().phase(WorkPhase::Preflight),
            PhaseUsage {
                visits: 3,
                bytes: 23
            }
        );
        work.charge_units(1).unwrap();
        assert_eq!(work.usage().units, 13);
    }

    #[test]
    fn unwinding_restores_budget_without_erasing_work_already_performed() {
        let mut work = WorkMeter::new(WorkLimits {
            units: 100,
            bytes: 1000,
        });
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            work.with_budget(WorkLimits { units: 1, bytes: 0 }, |work| {
                work.charge_units(1).unwrap();
                panic!("synthetic inner phase trap");
            });
        }));
        assert!(result.is_err());
        assert_eq!(
            work.limits(),
            WorkLimits {
                units: 100,
                bytes: 1000
            }
        );
        assert_eq!(work.usage(), WorkUsage { units: 1, bytes: 0 });
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

    fn normalize_scoped<V: crate::candidate::CandidateChanges>(
        &self,
        context: &Self::Context,
        candidate: &V,
        _cache: &Self::Cache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        work.note_phase(WorkPhase::FullFallback, 1, 0);
        self.normalize_candidate(context, candidate, work)
    }

    fn validate_scoped<V: crate::candidate::CandidateChanges>(
        &self,
        context: &Self::Context,
        candidate: &V,
        _cache: &Self::Cache<V::Id>,
        work: &mut WorkMeter,
    ) -> Result<crate::cache::PreparedValidation<Self::Cache<V::Id>>, Self::Error> {
        work.note_phase(WorkPhase::FullFallback, 1, 0);
        let stats = self.validate_candidate(context, candidate, work)?;
        Ok(crate::cache::PreparedValidation {
            stats,
            cache: crate::cache::CacheUpdate::Replace(Self::Cache::<V::Id>::default()),
        })
    }
}
