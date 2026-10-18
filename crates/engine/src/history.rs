// SPDX-License-Identifier: MIT OR Apache-2.0
//! Bounded action history. Plans own all cursor/retention changes before publish.
//!
//! Chronological maps remain in the commit journal. A projection borrows its
//! retained handles, including the new transition; this module returns any
//! additional oldest-prefix eviction needed by the shared ownership budget.

use std::collections::BTreeMap;
use std::fmt::{self, Write};
use std::mem::size_of;
use std::sync::Arc;

use editor_core::document::{Attribute, Attributes, Mark};
use editor_core::limits::LimitExceeded;
use editor_core::positions::Selection;
use editor_core::transaction::{WorkLimits, WorkMeter};

use crate::identity::NodeId;
use crate::tree::{CommitMaterial, MAX_PREPARED_COPY_BYTES, ReplayDirection};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryDirection {
    Undo,
    Redo,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TypingClass {
    Insert,
    DeleteBackward,
    DeleteForward,
}

/// A host equality token is a hint. Only an engine-verified footprint can make
/// an edit append to the current unit; no engine clock is involved.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum HistoryHint {
    #[default]
    Isolated,
    Typing {
        token: u64,
        class: TypingClass,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct HistoryLimits {
    pub actions: usize,
    pub members_per_unit: usize,
    pub maps_per_unit: usize,
    pub unit_bytes: usize,
    pub aggregate_bytes: usize,
    pub chronological_entries: usize,
    pub replay_work: WorkLimits,
}

impl Default for HistoryLimits {
    fn default() -> Self {
        Self {
            actions: 64,
            members_per_unit: 32,
            maps_per_unit: 4096,
            unit_bytes: 16 * 1024 * 1024,
            aggregate_bytes: 32 * 1024 * 1024,
            chronological_entries: 64,
            replay_work: WorkLimits::default(),
        }
    }
}

impl HistoryLimits {
    pub(crate) fn effective(self) -> Self {
        let hard = Self::default();
        Self {
            actions: self.actions.min(hard.actions),
            members_per_unit: self.members_per_unit.min(hard.members_per_unit),
            maps_per_unit: self.maps_per_unit.min(hard.maps_per_unit),
            unit_bytes: self.unit_bytes.min(hard.unit_bytes),
            aggregate_bytes: self.aggregate_bytes.min(hard.aggregate_bytes),
            chronological_entries: self.chronological_entries.min(hard.chronological_entries),
            replay_work: WorkLimits {
                units: self.replay_work.units.min(hard.replay_work.units),
                bytes: self.replay_work.bytes.min(hard.replay_work.bytes),
            },
        }
    }
}

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct HistorySummary {
    pub epoch: u64,
    pub undo_units: usize,
    pub redo_units: usize,
    pub undo_members: usize,
    pub redo_members: usize,
    /// Unique chronological/action payload plus all retained metadata. This is
    /// a native ownership estimate, not a portable serialization byte count.
    pub retained_bytes: usize,
    pub evicted_undo_units: u64,
    pub evicted_redo_units: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HistoryError {
    Empty,
    CounterExhausted,
    InvalidProjection,
    Limit(LimitExceeded),
    NotNormal,
    TypingMismatch,
}

impl HistoryError {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Empty => "history.empty",
            Self::CounterExhausted => "session.counter_exhausted",
            Self::InvalidProjection => "history.invalid_projection",
            Self::Limit(_) => "resource_limit_exceeded",
            Self::NotNormal => "history.not_normal",
            Self::TypingMismatch => "history.typing_mismatch",
        }
    }
}

impl From<LimitExceeded> for HistoryError {
    fn from(value: LimitExceeded) -> Self {
        Self::Limit(value)
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct HistoryBoundary {
    pub(crate) selection: Option<Selection<NodeId>>,
    pub(crate) stored_marks: Option<Vec<Mark>>,
}

/// Exact, already metered context supplied by the engine's actual-edit proof.
/// Inherit (`None`) and explicit plain (`Some([])`) remain distinct.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TypingContext {
    pub(crate) block_type: String,
    pub(crate) block_attributes: Attributes,
    pub(crate) leaf_type: String,
    pub(crate) leaf_attributes: Attributes,
    pub(crate) marks: Vec<Mark>,
    pub(crate) stored_marks: Option<Vec<Mark>>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct GroupingFootprint {
    pub(crate) block: NodeId,
    pub(crate) before_caret: usize,
    pub(crate) after_caret: usize,
    pub(crate) context: TypingContext,
}

pub(crate) struct PreparedHistoryChange {
    pub(crate) material: Arc<CommitMaterial>,
    pub(crate) before: HistoryBoundary,
    pub(crate) after: HistoryBoundary,
    pub(crate) footprint: Option<GroupingFootprint>,
}

/// Ordered oldest to newest. Metadata excludes the shared material, including
/// its Arc header; CommitMaterial::estimated_bytes owns that cost exactly once.
pub(crate) struct ProjectedMap<'a> {
    pub(crate) material: &'a Arc<CommitMaterial>,
    pub(crate) metadata_bytes: usize,
}

#[derive(Debug, Clone)]
struct OpenGroup {
    hint: HistoryHint,
    footprint: GroupingFootprint,
}

#[derive(Debug, Clone)]
pub(crate) struct HistoryUnit {
    pub(crate) members: Vec<Arc<CommitMaterial>>,
    pub(crate) before: HistoryBoundary,
    pub(crate) after: HistoryBoundary,
    group: Option<OpenGroup>,
}

impl HistoryUnit {
    pub(crate) fn members(&self) -> &[Arc<CommitMaterial>] {
        &self.members
    }

    pub(crate) fn before(&self) -> &HistoryBoundary {
        &self.before
    }

    pub(crate) fn after(&self) -> &HistoryBoundary {
        &self.after
    }
}

/// Undo is oldest to newest; redo is furthest future to immediate next. No
/// live stack is touched until the caller has passed every other commit gate.
#[derive(Debug, Clone, Default)]
pub(crate) struct HistoryStore {
    undo: Vec<HistoryUnit>,
    redo: Vec<HistoryUnit>,
    epoch: u64,
    retained_bytes: usize,
    evicted_undo_units: u64,
    evicted_redo_units: u64,
}

#[derive(Debug)]
pub(crate) struct HistoryPlan {
    store: HistoryStore,
    chronological_evictions: usize,
}

impl HistoryPlan {
    pub(crate) fn summary(&self) -> HistorySummary {
        self.store.summary()
    }

    pub(crate) fn chronological_evictions(&self) -> usize {
        self.chronological_evictions
    }
}

impl HistoryStore {
    pub(crate) fn summary(&self) -> HistorySummary {
        HistorySummary {
            epoch: self.epoch,
            undo_units: self.undo.len(),
            redo_units: self.redo.len(),
            undo_members: self.undo.iter().map(|unit| unit.members.len()).sum(),
            redo_members: self.redo.iter().map(|unit| unit.members.len()).sum(),
            retained_bytes: self.retained_bytes,
            evicted_undo_units: self.evicted_undo_units,
            evicted_redo_units: self.evicted_redo_units,
        }
    }

    pub(crate) fn replay_unit(&self, direction: HistoryDirection) -> Option<&HistoryUnit> {
        match direction {
            HistoryDirection::Undo => self.undo.last(),
            HistoryDirection::Redo => self.redo.last(),
        }
    }

    pub(crate) fn plan_record(
        &self,
        change: PreparedHistoryChange,
        hint: HistoryHint,
        maps: &[ProjectedMap<'_>],
        limits: HistoryLimits,
        work: &mut WorkMeter,
    ) -> Result<HistoryPlan, HistoryError> {
        let limits = limits.effective();
        validate_projection(maps, limits)?;
        if !Arc::ptr_eq(maps.last().unwrap().material, &change.material) {
            return Err(HistoryError::InvalidProjection);
        }
        let mut store = self.copy_for_plan(1, 0, work)?;
        store.epoch = next_epoch(self.epoch)?;
        let group = match (hint, change.footprint) {
            (HistoryHint::Typing { .. }, Some(footprint)) => Some(OpenGroup { hint, footprint }),
            _ => None,
        };
        charge_allocation(work, size_of::<Arc<CommitMaterial>>())?;
        let mut new = HistoryUnit {
            members: vec![change.material],
            before: change.before,
            after: change.after,
            group,
        };
        check_unit(&new, limits, work)?;
        let append = self.redo.is_empty()
            && store
                .undo
                .last()
                .map(|last| compatible(last, &new, work))
                .transpose()?
                .unwrap_or(false);
        if append {
            let last = store.undo.last_mut().unwrap();
            if combined_fits(last, &new, limits, work)? {
                charge_allocation(
                    work,
                    bytes_for::<Arc<CommitMaterial>>(last.members.len() + 1)?,
                )?;
                let mut members = Vec::with_capacity(last.members.len() + 1);
                members.extend(last.members.iter().cloned());
                members.append(&mut new.members);
                last.members = members;
                last.after = new.after;
                last.group = new.group;
            } else {
                last.group = None;
                store.undo.push(new);
            }
        } else {
            if let Some(last) = store.undo.last_mut() {
                last.group = None;
            }
            store.undo.push(new);
        }
        // A new successful document branch discards redo; refused/noop/state
        // changes never call this planner. Branch discard is not an eviction.
        store.redo = Vec::new();
        let evictions = retain(&mut store, maps, limits, Protected::Undo, work)?;
        Ok(HistoryPlan {
            store,
            chronological_evictions: evictions,
        })
    }

    /// The caller first stages every member and final validation with the same
    /// work meter. `maps` includes the newly prepared chronological replay map.
    pub(crate) fn plan_replay(
        &self,
        direction: HistoryDirection,
        maps: &[ProjectedMap<'_>],
        limits: HistoryLimits,
        work: &mut WorkMeter,
    ) -> Result<HistoryPlan, HistoryError> {
        let unit = self.replay_unit(direction).ok_or(HistoryError::Empty)?;
        let limits = limits.effective();
        validate_projection(maps, limits)?;
        check_unit(unit, limits, work)?;
        let (undo_extra, redo_extra) = match direction {
            HistoryDirection::Undo => (0, 1),
            HistoryDirection::Redo => (1, 0),
        };
        let mut store = self.copy_for_plan(undo_extra, redo_extra, work)?;
        store.epoch = next_epoch(self.epoch)?;
        let protected = match direction {
            HistoryDirection::Undo => {
                let mut unit = store.undo.pop().unwrap();
                unit.group = None;
                store.redo.push(unit);
                Protected::Redo
            }
            HistoryDirection::Redo => {
                let mut unit = store.redo.pop().unwrap();
                unit.group = None;
                store.undo.push(unit);
                Protected::Undo
            }
        };
        if let Some(last) = store.undo.last_mut() {
            last.group = None;
        }
        let evictions = retain(&mut store, maps, limits, protected, work)?;
        Ok(HistoryPlan {
            store,
            chronological_evictions: evictions,
        })
    }

    /// Repeated barriers after the group is sealed are true noops, including
    /// when the epoch is exhausted. Navigation's own epoch remains separate.
    pub(crate) fn plan_barrier(
        &self,
        work: &mut WorkMeter,
    ) -> Result<Option<HistoryPlan>, HistoryError> {
        if self.undo.last().is_none_or(|unit| unit.group.is_none()) {
            return Ok(None);
        }
        let epoch = next_epoch(self.epoch)?;
        let old_metadata = store_metadata(self, work)?;
        // A barrier allocates no new action slot. Its compact metadata can only
        // shrink, so sealing cannot exceed an already admitted aggregate cap.
        let mut store = self.copy_for_plan(0, 0, work)?;
        store.undo.last_mut().unwrap().group = None;
        store.epoch = epoch;
        let new_metadata = store_metadata(&store, work)?;
        store.retained_bytes = self
            .retained_bytes
            .checked_sub(old_metadata)
            .and_then(|bytes| bytes.checked_add(new_metadata))
            .ok_or(HistoryError::InvalidProjection)?;
        Ok(Some(HistoryPlan {
            store,
            chronological_evictions: 0,
        }))
    }

    /// No allocation, accounting, validation or counter arithmetic occurs here.
    pub(crate) fn publish(&mut self, plan: HistoryPlan) {
        *self = plan.store;
    }

    #[cfg(test)]
    pub(crate) fn set_epoch_for_test(&mut self, epoch: u64) {
        self.epoch = epoch;
    }

    fn copy_for_plan(
        &self,
        undo_extra: usize,
        redo_extra: usize,
        work: &mut WorkMeter,
    ) -> Result<Self, HistoryError> {
        // Allocate every required destination slot before replay/record. A
        // source side and a barrier need no spare retained capacity.
        let undo_capacity = add(self.undo.len(), undo_extra)?;
        let redo_capacity = add(self.redo.len(), redo_extra)?;
        let bytes = add(
            bytes_for::<HistoryUnit>(undo_capacity)?,
            bytes_for::<HistoryUnit>(redo_capacity)?,
        )?;
        charge_allocation(work, add(size_of::<Self>(), bytes)?)?;
        for unit in self.undo.iter().chain(&self.redo) {
            let heap_bytes = unit_heap_bytes(unit, work)?;
            charge_allocation(work, heap_bytes)?;
        }
        let mut undo = Vec::with_capacity(undo_capacity);
        let mut redo = Vec::with_capacity(redo_capacity);
        undo.extend(self.undo.iter().cloned());
        redo.extend(self.redo.iter().cloned());
        Ok(Self {
            undo,
            redo,
            epoch: self.epoch,
            retained_bytes: self.retained_bytes,
            evicted_undo_units: self.evicted_undo_units,
            evicted_redo_units: self.evicted_redo_units,
        })
    }
}

fn next_epoch(epoch: u64) -> Result<u64, HistoryError> {
    epoch.checked_add(1).ok_or(HistoryError::CounterExhausted)
}

fn compatible(
    last: &HistoryUnit,
    new: &HistoryUnit,
    work: &mut WorkMeter,
) -> Result<bool, HistoryError> {
    let (Some(a), Some(b)) = (&last.group, &new.group) else {
        return Ok(false);
    };
    // Charge exact-context scans before comparisons, including string payloads.
    context_heap_bytes(&a.footprint.context, work)?;
    context_heap_bytes(&b.footprint.context, work)?;
    marks_heap_bytes(last.after.stored_marks.as_deref(), work)?;
    marks_heap_bytes(new.before.stored_marks.as_deref(), work)?;
    Ok(a.hint == b.hint
        && a.footprint.block == b.footprint.block
        && a.footprint.after_caret == b.footprint.before_caret
        && a.footprint.context == b.footprint.context
        && last.after.stored_marks == new.before.stored_marks)
}

fn combined_fits(
    last: &HistoryUnit,
    new: &HistoryUnit,
    limits: HistoryLimits,
    work: &mut WorkMeter,
) -> Result<bool, HistoryError> {
    if last.members.len() >= limits.members_per_unit {
        return Ok(false);
    }
    // A bounded temporary view owns only cheap Arc handles. The old first
    // boundary and the new final boundary are copied only after precharging.
    let last_bytes = unit_heap_bytes(last, work)?;
    let new_bytes = unit_heap_bytes(new, work)?;
    charge_allocation(work, add(last_bytes, new_bytes)?)?;
    charge_allocation(
        work,
        bytes_for::<Arc<CommitMaterial>>(last.members.len() + new.members.len())?,
    )?;
    let mut members = Vec::with_capacity(last.members.len() + new.members.len());
    members.extend(last.members.iter().cloned());
    members.extend(new.members.iter().cloned());
    let combined = HistoryUnit {
        members,
        before: last.before.clone(),
        after: new.after.clone(),
        group: new.group.clone(),
    };
    match check_unit(&combined, limits, work) {
        Ok(()) => Ok(true),
        Err(HistoryError::Limit(error)) if error.name.starts_with("history_") => Ok(false),
        Err(error) => Err(error),
    }
}

fn validate_projection(
    maps: &[ProjectedMap<'_>],
    limits: HistoryLimits,
) -> Result<(), HistoryError> {
    if maps.is_empty() || maps.len() > HistoryLimits::default().chronological_entries + 1 {
        return Err(HistoryError::InvalidProjection);
    }
    check_bound("history_actions", limits.actions, 1)?;
    check_bound(
        "history_chronological_entries",
        limits.chronological_entries,
        1,
    )
}

fn check_unit(
    unit: &HistoryUnit,
    limits: HistoryLimits,
    work: &mut WorkMeter,
) -> Result<(), HistoryError> {
    check_bound(
        "history_members",
        limits.members_per_unit,
        unit.members.len(),
    )?;
    let mut maps = 0usize;
    let mut undo_units = 0u64;
    let mut undo_bytes = 0u64;
    let mut redo_units = 0u64;
    let mut redo_bytes = 0u64;
    let mut replay_copy_bytes = 0usize;
    let mut unique = OwnershipLedger::default();
    for material in &unit.members {
        work.charge_units(1)?;
        maps = add(maps, material.map_count(ReplayDirection::Undo))?;
        maps = add(maps, material.map_count(ReplayDirection::Redo))?;
        let undo = material.replay_cost(ReplayDirection::Undo);
        let redo = material.replay_cost(ReplayDirection::Redo);
        undo_units = add_u64(undo_units, undo.units)?;
        undo_bytes = add_u64(undo_bytes, undo.bytes)?;
        redo_units = add_u64(redo_units, redo.units)?;
        redo_bytes = add_u64(redo_bytes, redo.bytes)?;
        replay_copy_bytes = add(replay_copy_bytes, material.replay_copy_bound())?;
        unique.retain(material, work)?;
    }
    check_bound("history_maps", limits.maps_per_unit, maps)?;
    check_u64("history_replay_units", limits.replay_work.units, undo_units)?;
    check_u64("history_replay_units", limits.replay_work.units, redo_units)?;
    check_u64("history_replay_bytes", limits.replay_work.bytes, undo_bytes)?;
    check_u64("history_replay_bytes", limits.replay_work.bytes, redo_bytes)?;
    // Stage copies and final patch/material/changed-ID ownership share the
    // draft's one hard budget. Per-member bounds deliberately overestimate the
    // final sparse union, so a large group seals before it becomes unreplayable.
    check_bound(
        "history_replay_copy_bytes",
        MAX_PREPARED_COPY_BYTES,
        replay_copy_bytes,
    )?;
    let bytes = add(
        add(size_of::<HistoryUnit>(), unit_heap_bytes(unit, work)?)?,
        unique.bytes,
    )?;
    check_bound("history_unit_bytes", limits.unit_bytes, bytes)
}

#[derive(Clone, Copy)]
enum Protected {
    Undo,
    Redo,
}

fn retain(
    store: &mut HistoryStore,
    maps: &[ProjectedMap<'_>],
    limits: HistoryLimits,
    protected: Protected,
    work: &mut WorkMeter,
) -> Result<usize, HistoryError> {
    let mut ledger = OwnershipLedger::default();
    let mut bytes = store_metadata(store, work)?;
    for unit in store.undo.iter().chain(&store.redo) {
        for material in &unit.members {
            ledger.retain(material, work)?;
        }
    }
    for map in maps {
        work.charge_units(1)?;
        bytes = add(bytes, map.metadata_bytes)?;
        ledger.retain(map.material, work)?;
    }
    bytes = add(bytes, ledger.bytes)?;
    let mut evicted_maps = 0;
    while maps.len() - evicted_maps > limits.chronological_entries {
        evict_map(maps, &mut evicted_maps, &mut ledger, &mut bytes, work)?;
    }
    // New caps can tighten previously retained units. Only whole oldest units
    // may leave; never skip an interior action or the newly protected unit.
    loop {
        let mut invalid_unit = None;
        for unit in store.undo.iter().chain(&store.redo) {
            match check_unit(unit, limits, work) {
                Ok(()) => {}
                Err(HistoryError::Limit(error)) if error.name.starts_with("history_") => {
                    invalid_unit = Some(HistoryError::Limit(error));
                    break;
                }
                Err(error) => return Err(error),
            }
        }
        let count = store.undo.len() + store.redo.len();
        if count <= limits.actions && invalid_unit.is_none() {
            break;
        }
        if !evict_action(store, protected, &mut ledger, &mut bytes, work)? {
            return Err(
                invalid_unit.unwrap_or_else(|| limit("history_actions", limits.actions, count))
            );
        }
    }
    // Aggregate pressure first drops dispensable chronological prefixes, then
    // complete oldest undo/furthest redo actions. The newest map always stays.
    while bytes > limits.aggregate_bytes && maps.len() - evicted_maps > 1 {
        evict_map(maps, &mut evicted_maps, &mut ledger, &mut bytes, work)?;
    }
    while bytes > limits.aggregate_bytes {
        if !evict_action(store, protected, &mut ledger, &mut bytes, work)? {
            return Err(limit(
                "history_aggregate_bytes",
                limits.aggregate_bytes,
                bytes,
            ));
        }
    }
    store.retained_bytes = bytes;
    Ok(evicted_maps)
}

fn evict_map(
    maps: &[ProjectedMap<'_>],
    evicted: &mut usize,
    ledger: &mut OwnershipLedger,
    bytes: &mut usize,
    work: &mut WorkMeter,
) -> Result<(), HistoryError> {
    if maps.len() - *evicted <= 1 {
        return Err(HistoryError::InvalidProjection);
    }
    let map = &maps[*evicted];
    let freed = add(map.metadata_bytes, ledger.release(map.material, work)?)?;
    *bytes = bytes
        .checked_sub(freed)
        .ok_or(HistoryError::InvalidProjection)?;
    *evicted += 1;
    Ok(())
}

fn evict_action(
    store: &mut HistoryStore,
    protected: Protected,
    ledger: &mut OwnershipLedger,
    bytes: &mut usize,
    work: &mut WorkMeter,
) -> Result<bool, HistoryError> {
    let undo_available =
        !store.undo.is_empty() && !(matches!(protected, Protected::Undo) && store.undo.len() == 1);
    let redo_available =
        !store.redo.is_empty() && !(matches!(protected, Protected::Redo) && store.redo.len() == 1);
    let unit = if undo_available {
        work.charge_units(store.undo.len() as u64)?;
        store.evicted_undo_units = next_epoch(store.evicted_undo_units)?;
        store.undo.remove(0)
    } else if redo_available {
        work.charge_units(store.redo.len() as u64)?;
        store.evicted_redo_units = next_epoch(store.evicted_redo_units)?;
        store.redo.remove(0)
    } else {
        return Ok(false);
    };
    let mut freed = unit_heap_bytes(&unit, work)?;
    for material in &unit.members {
        freed = add(freed, ledger.release(material, work)?)?;
    }
    // Vec capacity remains allocated and remains counted in store metadata.
    *bytes = bytes
        .checked_sub(freed)
        .ok_or(HistoryError::InvalidProjection)?;
    Ok(true)
}

struct Ownership {
    material: Arc<CommitMaterial>,
    owners: usize,
}

#[derive(Default)]
struct OwnershipLedger {
    entries: BTreeMap<usize, Ownership>,
    bytes: usize,
}

impl OwnershipLedger {
    fn retain(
        &mut self,
        material: &Arc<CommitMaterial>,
        work: &mut WorkMeter,
    ) -> Result<(), HistoryError> {
        work.charge_units((self.entries.len() + 1).ilog2() as u64 + 1)?;
        let key = Arc::as_ptr(material) as usize;
        if let Some(entry) = self.entries.get_mut(&key) {
            if !Arc::ptr_eq(&entry.material, material) {
                return Err(HistoryError::InvalidProjection);
            }
            entry.owners = add(entry.owners, 1)?;
        } else {
            charge_allocation(work, btree_entry_bytes::<usize, Ownership>())?;
            self.bytes = add(self.bytes, material.estimated_bytes())?;
            self.entries.insert(
                key,
                Ownership {
                    material: Arc::clone(material),
                    owners: 1,
                },
            );
        }
        Ok(())
    }

    fn release(
        &mut self,
        material: &Arc<CommitMaterial>,
        work: &mut WorkMeter,
    ) -> Result<usize, HistoryError> {
        work.charge_units((self.entries.len() + 1).ilog2() as u64 + 1)?;
        let entry = self
            .entries
            .get_mut(&(Arc::as_ptr(material) as usize))
            .ok_or(HistoryError::InvalidProjection)?;
        if entry.owners == 0 || !Arc::ptr_eq(&entry.material, material) {
            return Err(HistoryError::InvalidProjection);
        }
        entry.owners -= 1;
        if entry.owners == 0 {
            self.bytes = self
                .bytes
                .checked_sub(material.estimated_bytes())
                .ok_or(HistoryError::InvalidProjection)?;
            Ok(material.estimated_bytes())
        } else {
            Ok(0)
        }
    }
}

fn store_metadata(store: &HistoryStore, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    work.charge_units(1)?;
    let mut bytes = add(
        size_of::<HistoryStore>(),
        bytes_for::<HistoryUnit>(add(store.undo.capacity(), store.redo.capacity())?)?,
    )?;
    for unit in store.undo.iter().chain(&store.redo) {
        bytes = add(bytes, unit_heap_bytes(unit, work)?)?;
    }
    Ok(bytes)
}

fn unit_heap_bytes(unit: &HistoryUnit, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    work.charge_units(unit.members.len() as u64 + 1)?;
    let mut bytes = bytes_for::<Arc<CommitMaterial>>(unit.members.capacity())?;
    bytes = add(
        bytes,
        owned_marks_bytes(unit.before.stored_marks.as_ref(), work)?,
    )?;
    bytes = add(
        bytes,
        owned_marks_bytes(unit.after.stored_marks.as_ref(), work)?,
    )?;
    if let Some(group) = &unit.group {
        bytes = add(bytes, context_heap_bytes(&group.footprint.context, work)?)?;
    }
    Ok(bytes)
}

fn context_heap_bytes(
    context: &TypingContext,
    work: &mut WorkMeter,
) -> Result<usize, HistoryError> {
    work.charge_units(1)?;
    let mut bytes = string_bytes(&context.block_type, work)?;
    bytes = add(
        bytes,
        attributes_heap_bytes(&context.block_attributes, work)?,
    )?;
    bytes = add(bytes, string_bytes(&context.leaf_type, work)?)?;
    bytes = add(
        bytes,
        attributes_heap_bytes(&context.leaf_attributes, work)?,
    )?;
    bytes = add(bytes, owned_marks_bytes(Some(&context.marks), work)?)?;
    add(
        bytes,
        owned_marks_bytes(context.stored_marks.as_ref(), work)?,
    )
}

fn owned_marks_bytes(
    marks: Option<&Vec<Mark>>,
    work: &mut WorkMeter,
) -> Result<usize, HistoryError> {
    let Some(marks) = marks else { return Ok(0) };
    let heap = marks_heap_bytes(Some(marks), work)?;
    add(heap, bytes_for::<Mark>(marks.capacity() - marks.len())?)
}

fn marks_heap_bytes(marks: Option<&[Mark]>, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    let Some(marks) = marks else { return Ok(0) };
    let mut bytes = bytes_for::<Mark>(marks.len())?;
    for mark in marks {
        work.charge_units(1)?;
        bytes = add(bytes, string_bytes(&mark.type_id, work)?)?;
        bytes = add(bytes, attributes_heap_bytes(&mark.attributes, work)?)?;
    }
    Ok(bytes)
}

fn attributes_heap_bytes(
    attributes: &Attributes,
    work: &mut WorkMeter,
) -> Result<usize, HistoryError> {
    let mut bytes = 0;
    for (key, value) in attributes {
        work.charge_units(1)?;
        bytes = add(bytes, btree_entry_bytes::<String, Attribute>())?;
        bytes = add(bytes, string_bytes(key, work)?)?;
        bytes = add(bytes, attribute_heap_bytes(value, work)?)?;
    }
    Ok(bytes)
}

fn attribute_heap_bytes(value: &Attribute, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    work.charge_units(1)?;
    match value {
        Attribute::String(value) => string_bytes(value, work),
        Attribute::List(values) => {
            let mut bytes = bytes_for::<Attribute>(values.capacity())?;
            for value in values {
                bytes = add(bytes, attribute_heap_bytes(value, work)?)?;
            }
            Ok(bytes)
        }
        Attribute::Object(values) => attributes_heap_bytes(values, work),
        // This conservative decimal payload cost also covers downstream
        // serde_json arbitrary_precision feature unification. No temporary
        // String is allocated to measure its borrowed representation.
        Attribute::Number(value) => number_bytes(value, work),
        Attribute::Null | Attribute::Boolean(_) => Ok(0),
    }
}

fn number_bytes(value: &impl fmt::Display, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    struct Counter<'a> {
        work: &'a mut WorkMeter,
        bytes: usize,
        error: Option<HistoryError>,
    }
    impl Write for Counter<'_> {
        fn write_str(&mut self, value: &str) -> fmt::Result {
            let result = (|| {
                self.work.charge_units(value.len() as u64)?;
                self.bytes = add(self.bytes, value.len())?;
                Ok::<_, HistoryError>(())
            })();
            if let Err(error) = result {
                self.error = Some(error);
                return Err(fmt::Error);
            }
            Ok(())
        }
    }
    let mut counter = Counter {
        work,
        bytes: 0,
        error: None,
    };
    if write!(&mut counter, "{value}").is_err() {
        return Err(counter.error.unwrap_or(HistoryError::InvalidProjection));
    }
    Ok(counter.bytes)
}

fn string_bytes(value: &String, work: &mut WorkMeter) -> Result<usize, HistoryError> {
    work.charge_units(value.len() as u64)?;
    Ok(value.capacity())
}

fn btree_entry_bytes<K, V>() -> usize {
    // A conservative full B-tree node per entry includes otherwise invisible
    // spare key/value slots, node header and child edges. A nonempty node owns
    // at least one entry, so this also bounds small/root maps and clone buffers.
    11 * size_of::<(K, V)>() + 14 * size_of::<usize>()
}

fn charge_allocation(work: &mut WorkMeter, bytes: usize) -> Result<(), HistoryError> {
    work.charge_bytes(bytes as u64)?;
    Ok(())
}

fn bytes_for<T>(count: usize) -> Result<usize, HistoryError> {
    count
        .checked_mul(size_of::<T>())
        .ok_or(HistoryError::CounterExhausted)
}

fn add(a: usize, b: usize) -> Result<usize, HistoryError> {
    a.checked_add(b).ok_or(HistoryError::CounterExhausted)
}

fn add_u64(a: u64, b: u64) -> Result<u64, HistoryError> {
    a.checked_add(b).ok_or(HistoryError::CounterExhausted)
}

fn check_bound(name: &'static str, maximum: usize, observed: usize) -> Result<(), HistoryError> {
    check_u64(name, maximum as u64, observed as u64)
}

fn check_u64(name: &'static str, maximum: u64, observed: u64) -> Result<(), HistoryError> {
    if observed > maximum {
        Err(HistoryError::Limit(LimitExceeded {
            name,
            maximum,
            observed,
        }))
    } else {
        Ok(())
    }
}

fn limit(name: &'static str, maximum: usize, observed: usize) -> HistoryError {
    HistoryError::Limit(LimitExceeded {
        name,
        maximum: maximum as u64,
        observed: observed as u64,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::identity::SessionKey;
    use crate::tree::AddressTree;
    use editor_core::document::{Document, Node, Primitive};
    use editor_core::positions::{Affinity, Position, Utf16Offset};

    const MAP_METADATA: usize = 128;

    struct Fixture {
        tree: AddressTree,
        block: NodeId,
        leaf: NodeId,
        caret: usize,
    }

    impl Fixture {
        fn new() -> Self {
            let tree = AddressTree::from_document(
                SessionKey::allocate().unwrap(),
                Document {
                    children: vec![Node {
                        type_id: "org.test/paragraph".into(),
                        primitive: Primitive::TextBlock,
                        attributes: Attributes::new(),
                        marks: vec![],
                        text: None,
                        children: vec![Node {
                            type_id: "org.test/text".into(),
                            primitive: Primitive::Text,
                            attributes: Attributes::new(),
                            marks: vec![],
                            text: Some(String::new()),
                            children: vec![],
                        }],
                    }],
                },
            )
            .unwrap();
            let block = tree.node(tree.root()).unwrap().children()[0];
            let leaf = tree.node(block).unwrap().children()[0];
            Self {
                tree,
                block,
                leaf,
                caret: 0,
            }
        }

        fn material(&mut self) -> Arc<CommitMaterial> {
            let mut draft = self.tree.prepare();
            draft
                .replace_text(
                    self.leaf,
                    Utf16Offset::new(self.caret),
                    Utf16Offset::new(self.caret),
                    "a",
                )
                .unwrap();
            self.caret += 1;
            self.tree
                .publish(draft.prepare_patch().unwrap(), self.caret as u64)
        }

        fn boundary(&self, caret: usize) -> HistoryBoundary {
            let position = Position::Text {
                leaf: self.leaf,
                utf16: Utf16Offset::new(caret),
                affinity: Affinity::After,
            };
            HistoryBoundary {
                selection: Some(Selection {
                    anchor: position,
                    focus: position,
                }),
                stored_marks: None,
            }
        }

        fn change(&self, material: &Arc<CommitMaterial>, before: usize) -> PreparedHistoryChange {
            PreparedHistoryChange {
                material: Arc::clone(material),
                before: self.boundary(before),
                after: self.boundary(before + 1),
                footprint: Some(GroupingFootprint {
                    block: self.block,
                    before_caret: before,
                    after_caret: before + 1,
                    context: TypingContext {
                        block_type: "org.test/paragraph".into(),
                        block_attributes: Attributes::new(),
                        leaf_type: "org.test/text".into(),
                        leaf_attributes: Attributes::new(),
                        marks: vec![],
                        stored_marks: None,
                    },
                }),
            }
        }
    }

    fn work() -> WorkMeter {
        WorkMeter::new(WorkLimits::default())
    }

    fn typing(token: u64, class: TypingClass) -> HistoryHint {
        HistoryHint::Typing { token, class }
    }

    fn projection(materials: &[Arc<CommitMaterial>]) -> Vec<ProjectedMap<'_>> {
        materials
            .iter()
            .map(|material| ProjectedMap {
                material,
                metadata_bytes: MAP_METADATA,
            })
            .collect()
    }

    fn record(
        store: &mut HistoryStore,
        fixture: &mut Fixture,
        materials: &mut Vec<Arc<CommitMaterial>>,
        hint: HistoryHint,
        limits: HistoryLimits,
    ) {
        let material = fixture.material();
        materials.push(Arc::clone(&material));
        let plan = store
            .plan_record(
                fixture.change(&material, fixture.caret - 1),
                hint,
                &projection(materials),
                limits,
                &mut work(),
            )
            .unwrap();
        let evicted = plan.chronological_evictions();
        store.publish(plan);
        materials.drain(..evicted);
    }

    fn replay(
        store: &mut HistoryStore,
        fixture: &mut Fixture,
        materials: &mut Vec<Arc<CommitMaterial>>,
        direction: HistoryDirection,
        limits: HistoryLimits,
    ) {
        let unit = store.replay_unit(direction).unwrap();
        let mut draft = fixture.tree.prepare();
        let mut meter = work();
        match direction {
            HistoryDirection::Undo => {
                for material in unit.members().iter().rev() {
                    draft
                        .stage_replay(material, ReplayDirection::Undo, &mut meter)
                        .unwrap();
                }
            }
            HistoryDirection::Redo => {
                for material in unit.members() {
                    draft
                        .stage_replay(material, ReplayDirection::Redo, &mut meter)
                        .unwrap();
                }
            }
        }
        let patch = draft.prepare_patch().unwrap();
        materials.push(Arc::clone(patch.material()));
        let plan = store
            .plan_replay(direction, &projection(materials), limits, &mut meter)
            .unwrap();
        let evicted = plan.chronological_evictions();
        let revision = fixture.tree.changed_revision(fixture.tree.root()).unwrap() + 1;
        fixture.tree.publish(patch, revision);
        store.publish(plan);
        materials.drain(..evicted);
    }

    #[test]
    fn typing_member_cap_starts_a_complete_new_unit() {
        let mut fixture = Fixture::new();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        for _ in 0..35 {
            record(
                &mut store,
                &mut fixture,
                &mut maps,
                typing(7, TypingClass::Insert),
                HistoryLimits::default(),
            );
        }
        assert_eq!(store.summary().undo_units, 2);
        assert_eq!(store.undo[0].members.len(), 32);
        assert_eq!(store.undo[1].members.len(), 3);
        assert_eq!(store.undo[0].before, fixture.boundary(0));
        assert_eq!(store.undo[0].after, fixture.boundary(32));
        replay(
            &mut store,
            &mut fixture,
            &mut maps,
            HistoryDirection::Undo,
            HistoryLimits::default(),
        );
        assert_eq!(
            fixture.tree.node(fixture.leaf).unwrap().text(),
            Some("a".repeat(32).as_str())
        );
        replay(
            &mut store,
            &mut fixture,
            &mut maps,
            HistoryDirection::Redo,
            HistoryLimits::default(),
        );
        assert_eq!(
            fixture.tree.node(fixture.leaf).unwrap().text(),
            Some("a".repeat(35).as_str())
        );
    }

    #[test]
    fn exact_context_token_direction_and_barriers_separate_groups() {
        let mut fixture = Fixture::new();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        for hint in [
            typing(1, TypingClass::Insert),
            typing(2, TypingClass::Insert),
            typing(2, TypingClass::DeleteBackward),
            typing(2, TypingClass::DeleteForward),
        ] {
            record(
                &mut store,
                &mut fixture,
                &mut maps,
                hint,
                HistoryLimits::default(),
            );
        }
        assert_eq!(store.summary().undo_units, 4);
        let retained_before_barrier = store.summary().retained_bytes;
        let plan = store.plan_barrier(&mut work()).unwrap().unwrap();
        store.publish(plan);
        assert!(store.summary().retained_bytes <= retained_before_barrier);
        let epoch = store.summary().epoch;
        assert!(store.plan_barrier(&mut work()).unwrap().is_none());
        assert_eq!(store.summary().epoch, epoch);
        record(
            &mut store,
            &mut fixture,
            &mut maps,
            typing(2, TypingClass::DeleteForward),
            HistoryLimits::default(),
        );
        assert_eq!(store.summary().undo_units, 5);
        let material = fixture.material();
        maps.push(Arc::clone(&material));
        let mut change = fixture.change(&material, fixture.caret - 1);
        change.before.stored_marks = Some(vec![]);
        change.after.stored_marks = Some(vec![]);
        change.footprint.as_mut().unwrap().context.stored_marks = Some(vec![]);
        let plan = store
            .plan_record(
                change,
                typing(2, TypingClass::DeleteForward),
                &projection(&maps),
                HistoryLimits::default(),
                &mut work(),
            )
            .unwrap();
        store.publish(plan);
        assert_eq!(store.summary().undo_units, 6);
    }

    #[test]
    fn action_cursor_preserves_complete_units_and_furthest_redo_is_evicted_first() {
        let mut fixture = Fixture::new();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        for _ in 0..3 {
            record(
                &mut store,
                &mut fixture,
                &mut maps,
                HistoryHint::Isolated,
                HistoryLimits::default(),
            );
        }
        let last_material = Arc::clone(&store.undo[2].members[0]);
        replay(
            &mut store,
            &mut fixture,
            &mut maps,
            HistoryDirection::Undo,
            HistoryLimits::default(),
        );
        let tight = HistoryLimits {
            actions: 1,
            ..HistoryLimits::default()
        };
        replay(
            &mut store,
            &mut fixture,
            &mut maps,
            HistoryDirection::Undo,
            tight,
        );
        assert_eq!(store.summary().undo_units, 0);
        assert_eq!(store.summary().redo_units, 1);
        assert_eq!(store.summary().evicted_undo_units, 1);
        assert_eq!(store.summary().evicted_redo_units, 1);
        assert!(!Arc::ptr_eq(&last_material, &store.redo[0].members[0]));
        assert_eq!(store.redo[0].before, fixture.boundary(1));
        replay(
            &mut store,
            &mut fixture,
            &mut maps,
            HistoryDirection::Redo,
            tight,
        );
        assert_eq!(fixture.tree.node(fixture.leaf).unwrap().text(), Some("aa"));
    }

    #[test]
    fn ownership_is_unique_by_actual_arc_and_independent_of_temporary_clones() {
        let mut fixture = Fixture::new();
        let material = fixture.material();
        let store = HistoryStore::default();
        let one = [Arc::clone(&material)];
        let plan1 = store
            .plan_record(
                fixture.change(&material, 0),
                HistoryHint::Isolated,
                &projection(&one),
                HistoryLimits::default(),
                &mut work(),
            )
            .unwrap();
        let temporary: Vec<_> = (0..100).map(|_| Arc::clone(&material)).collect();
        let two = [Arc::clone(&material), Arc::clone(&material)];
        let plan2 = store
            .plan_record(
                fixture.change(&material, 0),
                HistoryHint::Isolated,
                &projection(&two),
                HistoryLimits::default(),
                &mut work(),
            )
            .unwrap();
        assert_eq!(
            plan2.store.retained_bytes - plan1.store.retained_bytes,
            MAP_METADATA
        );
        drop(temporary);
        let plan3 = store
            .plan_record(
                fixture.change(&material, 0),
                HistoryHint::Isolated,
                &projection(&one),
                HistoryLimits::default(),
                &mut work(),
            )
            .unwrap();
        assert_eq!(plan1.store.summary(), plan3.store.summary());
        let mut ledger = OwnershipLedger::default();
        ledger.retain(&material, &mut work()).unwrap();
        ledger.retain(&material, &mut work()).unwrap();
        assert_eq!(ledger.bytes, material.estimated_bytes());
        assert_eq!(ledger.release(&material, &mut work()).unwrap(), 0);
        assert_eq!(
            ledger.release(&material, &mut work()).unwrap(),
            material.estimated_bytes()
        );
    }

    #[test]
    fn aggregate_pressure_drops_maps_before_complete_actions_and_protects_new() {
        let mut fixture = Fixture::new();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        for _ in 0..2 {
            record(
                &mut store,
                &mut fixture,
                &mut maps,
                HistoryHint::Isolated,
                HistoryLimits::default(),
            );
        }
        let material = fixture.material();
        maps.push(Arc::clone(&material));
        let baseline = store
            .plan_record(
                fixture.change(&material, 2),
                HistoryHint::Isolated,
                &projection(&maps),
                HistoryLimits::default(),
                &mut work(),
            )
            .unwrap();
        let mut tight = HistoryLimits {
            aggregate_bytes: baseline.store.retained_bytes - MAP_METADATA,
            ..HistoryLimits::default()
        };
        let plan = store
            .plan_record(
                fixture.change(&material, 2),
                HistoryHint::Isolated,
                &projection(&maps),
                tight,
                &mut work(),
            )
            .unwrap();
        assert_eq!(plan.chronological_evictions(), 1);
        assert_eq!(plan.store.summary().undo_units, 3);
        tight.aggregate_bytes = 1;
        let before = store.summary();
        assert!(matches!(
            store.plan_record(
                fixture.change(&material, 2),
                HistoryHint::Isolated,
                &projection(&maps),
                tight,
                &mut work()
            ),
            Err(HistoryError::Limit(_))
        ));
        assert_eq!(store.summary(), before);
    }

    #[test]
    fn known_recipe_and_staging_caps_prevent_unbounded_coalescing() {
        let mut fixture = Fixture::new();
        let first = fixture.material();
        let maps_per_member =
            first.map_count(ReplayDirection::Undo) + first.map_count(ReplayDirection::Redo);
        let mut limits = HistoryLimits {
            maps_per_unit: maps_per_member,
            ..HistoryLimits::default()
        };
        let mut store = HistoryStore::default();
        let mut maps = vec![first.clone()];
        let plan = store
            .plan_record(
                fixture.change(&first, 0),
                typing(1, TypingClass::Insert),
                &projection(&maps),
                limits,
                &mut work(),
            )
            .unwrap();
        store.publish(plan);
        record(
            &mut store,
            &mut fixture,
            &mut maps,
            typing(1, TypingClass::Insert),
            limits,
        );
        assert_eq!(store.summary().undo_units, 2);
        let material = fixture.material();
        maps.push(Arc::clone(&material));
        limits.replay_work.units = material.replay_cost(ReplayDirection::Undo).units - 1;
        let before = store.summary();
        assert!(matches!(
            store.plan_record(
                fixture.change(&material, 2),
                HistoryHint::Isolated,
                &projection(&maps),
                limits,
                &mut work()
            ),
            Err(HistoryError::Limit(LimitExceeded {
                name: "history_replay_units",
                ..
            }))
        ));
        assert_eq!(store.summary(), before);
    }

    #[test]
    fn counter_work_and_zero_caps_refuse_without_publishing_and_sealed_barrier_is_noop() {
        let mut fixture = Fixture::new();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        record(
            &mut store,
            &mut fixture,
            &mut maps,
            typing(1, TypingClass::Insert),
            HistoryLimits::default(),
        );
        store.set_epoch_for_test(u64::MAX);
        let before = store.summary();
        assert_eq!(
            store.plan_barrier(&mut work()).unwrap_err(),
            HistoryError::CounterExhausted
        );
        let material = fixture.material();
        maps.push(Arc::clone(&material));
        assert_eq!(
            store
                .plan_record(
                    fixture.change(&material, 1),
                    HistoryHint::Isolated,
                    &projection(&maps),
                    HistoryLimits::default(),
                    &mut work()
                )
                .unwrap_err(),
            HistoryError::CounterExhausted
        );
        assert_eq!(
            store
                .plan_replay(
                    HistoryDirection::Undo,
                    &projection(&maps),
                    HistoryLimits::default(),
                    &mut work()
                )
                .unwrap_err(),
            HistoryError::CounterExhausted
        );
        assert_eq!(store.summary(), before);
        store.undo.last_mut().unwrap().group = None;
        assert!(store.plan_barrier(&mut work()).unwrap().is_none());
        store.set_epoch_for_test(1);
        let before = store.summary();
        let mut no_copy = WorkMeter::new(WorkLimits {
            units: 1_000_000,
            bytes: 0,
        });
        assert!(matches!(
            store.plan_record(
                fixture.change(&material, 1),
                HistoryHint::Isolated,
                &projection(&maps),
                HistoryLimits::default(),
                &mut no_copy
            ),
            Err(HistoryError::Limit(LimitExceeded {
                name: "transaction_bytes",
                ..
            }))
        ));
        assert_eq!(store.summary(), before);
        for limits in [
            HistoryLimits {
                actions: 0,
                ..HistoryLimits::default()
            },
            HistoryLimits {
                chronological_entries: 0,
                ..HistoryLimits::default()
            },
        ] {
            assert!(matches!(
                store.plan_record(
                    fixture.change(&material, 1),
                    HistoryHint::Isolated,
                    &projection(&maps),
                    limits,
                    &mut work()
                ),
                Err(HistoryError::Limit(_))
            ));
        }
        assert_eq!(store.summary(), before);
    }

    #[test]
    fn limits_only_tighten_and_number_payload_measurement_is_streamed() {
        let generous = HistoryLimits {
            actions: usize::MAX,
            members_per_unit: usize::MAX,
            maps_per_unit: usize::MAX,
            unit_bytes: usize::MAX,
            aggregate_bytes: usize::MAX,
            chronological_entries: usize::MAX,
            replay_work: WorkLimits {
                units: u64::MAX,
                bytes: u64::MAX,
            },
        };
        assert_eq!(generous.effective(), HistoryLimits::default());
        assert_eq!(number_bytes(&123456789i64, &mut work()).unwrap(), 9);
        let mut tiny = WorkMeter::new(WorkLimits {
            units: 8,
            bytes: 100,
        });
        assert!(matches!(
            number_bytes(&123456789i64, &mut tiny),
            Err(HistoryError::Limit(_))
        ));
    }

    #[test]
    fn final_patch_copy_bound_rejects_a_known_unreplayable_large_unit() {
        let leaf = Node {
            type_id: "org.test/text".into(),
            primitive: Primitive::Text,
            attributes: Attributes::new(),
            marks: vec![],
            text: Some("a".repeat(256 * 1024)),
            children: vec![],
        };
        let mut tree = AddressTree::from_document(
            SessionKey::allocate().unwrap(),
            Document {
                children: vec![Node {
                    type_id: "org.test/paragraph".into(),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![leaf; 31],
                }],
            },
        )
        .unwrap();
        let block = tree.node(tree.root()).unwrap().children()[0];
        let leaves = tree.node(block).unwrap().children().to_vec();
        let mut members = vec![];
        for (index, leaf) in leaves.into_iter().enumerate() {
            let mut draft = tree.prepare();
            draft
                .replace_text(leaf, Utf16Offset::new(0), Utf16Offset::new(1), "b")
                .unwrap();
            members.push(tree.publish(draft.prepare_patch().unwrap(), index as u64 + 1));
        }
        let unit = HistoryUnit {
            members,
            before: HistoryBoundary {
                selection: None,
                stored_marks: None,
            },
            after: HistoryBoundary {
                selection: None,
                stored_marks: None,
            },
            group: None,
        };
        // Retained payload and stage-only work fit; preparing its final sparse
        // patch would exceed the same draft copy budget without the new guard.
        let payload: usize = unit
            .members
            .iter()
            .map(|material| material.estimated_bytes())
            .sum();
        assert!(
            payload + size_of::<HistoryUnit>() + unit_heap_bytes(&unit, &mut work()).unwrap()
                < HistoryLimits::default().unit_bytes
        );
        assert!(matches!(
            check_unit(&unit, HistoryLimits::default(), &mut work()),
            Err(HistoryError::Limit(LimitExceeded {
                name: "history_replay_copy_bytes",
                ..
            }))
        ));
        let mut draft = tree.prepare();
        let mut meter = work();
        for member in unit.members.iter().rev() {
            draft
                .stage_replay(member, ReplayDirection::Undo, &mut meter)
                .unwrap();
        }
        assert!(matches!(
            draft.prepare_patch(),
            Err(crate::tree::TreeError::ResourceLimit)
        ));
    }

    #[test]
    fn fixed_payload_retention_and_planning_cost_stabilize_across_repeated_changes() {
        let mut fixture = Fixture::new();
        fixture.material();
        let mut store = HistoryStore::default();
        let mut maps = vec![];
        let limits = HistoryLimits {
            actions: 1,
            chronological_entries: 1,
            ..HistoryLimits::default()
        };
        let mut stable = None;
        for index in 0..256 {
            let mut draft = fixture.tree.prepare();
            draft
                .replace_text(
                    fixture.leaf,
                    Utf16Offset::new(0),
                    Utf16Offset::new(1),
                    if index % 2 == 0 { "b" } else { "a" },
                )
                .unwrap();
            let material = fixture
                .tree
                .publish(draft.prepare_patch().unwrap(), index as u64 + 1);
            maps.push(Arc::clone(&material));
            let mut meter = work();
            let plan = store
                .plan_record(
                    fixture.change(&material, 0),
                    HistoryHint::Isolated,
                    &projection(&maps),
                    limits,
                    &mut meter,
                )
                .unwrap();
            let evicted = plan.chronological_evictions();
            store.publish(plan);
            maps.drain(..evicted);
            assert_eq!(store.summary().undo_units, 1);
            assert_eq!(store.summary().undo_members, 1);
            assert_eq!(maps.len(), 1);
            if index > 1 {
                let observed = (store.summary().retained_bytes, meter.usage());
                if let Some(expected) = stable {
                    assert_eq!(observed, expected);
                } else {
                    stable = Some(observed);
                }
            }
        }
    }
}
