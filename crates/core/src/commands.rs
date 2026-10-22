// SPDX-License-Identifier: MIT OR Apache-2.0
//! Trusted compiled command providers and metered, publication-free plans.

use crate::admission::{PreflightBudget, preflight_node_fields};
use crate::candidate::CandidateRead;
use crate::document::{Attributes, Mark};
pub use crate::input::{
    InputCommandPolicy, InputOrigin, InputOriginal, InputSourceRegion, InputTextRun,
    RawInputRestorePlan, TextReplacementPlan,
};
use crate::limits::{LimitExceeded, check};
use crate::positions::{Position, Selection};
use crate::transaction::{Operation, TransactionProfile, WorkMeter};

pub const MAX_COMMANDS: usize = 256;
pub const MAX_COMMAND_ID_BYTES: usize = 128;
pub const MAX_COMMAND_OPERATIONS: usize = 256;
pub const MAX_LOCAL_PATH: usize = 128;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalRef<I> {
    Existing(I),
    Created { operation: usize, path: Vec<usize> },
}
impl<I> From<I> for LocalRef<I> {
    fn from(id: I) -> Self {
        Self::Existing(id)
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum SelectionIntent<I> {
    #[default]
    MapCurrent,
    Set(Option<Selection<LocalRef<I>>>),
    MapFromUserResult(Option<Selection<LocalRef<I>>>),
}

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub enum StoredMarksUpdate {
    #[default]
    Keep,
    Inherit,
    Set(Vec<Mark>),
}

#[derive(Debug, Clone, Copy)]
pub struct CommandState<'a, I> {
    pub selection: Option<&'a Selection<I>>,
    pub stored_marks: Option<&'a [Mark]>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActiveState {
    Off,
    On,
    Mixed,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CommandPresentation {
    pub active: Option<ActiveState>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CommandDescriptor {
    pub id: &'static str,
}

/// Immutable instance view. Runtime IDs remain owned by their frozen profile;
/// borrowing the catalog neither leaks strings nor changes session authority.
#[derive(Debug, Clone, Copy)]
pub enum CommandCatalog<'a> {
    Static(&'a [CommandDescriptor]),
    Runtime(&'a [String]),
}
impl<'a> CommandCatalog<'a> {
    pub fn len(self) -> usize {
        match self {
            Self::Static(entries) => entries.len(),
            Self::Runtime(ids) => ids.len(),
        }
    }
    pub fn is_empty(self) -> bool {
        self.len() == 0
    }
    pub fn get(self, index: usize) -> Option<&'a str> {
        match self {
            Self::Static(entries) => entries.get(index).map(|entry| entry.id),
            Self::Runtime(ids) => ids.get(index).map(String::as_str),
        }
    }
    pub fn ids(self) -> impl ExactSizeIterator<Item = &'a str> + Clone {
        (0..self.len()).map(move |index| match self {
            Self::Static(entries) => entries[index].id,
            Self::Runtime(ids) => ids[index].as_str(),
        })
    }
    pub fn validate(self) -> Result<(), CatalogError> {
        if self.len() > MAX_COMMANDS {
            return Err(CatalogError::TooManyCommands);
        }
        for (index, id) in self.ids().enumerate() {
            if id.len() > MAX_COMMAND_ID_BYTES
                || !id
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || b"._-/".contains(&byte))
                || !id
                    .split_once('/')
                    .is_some_and(|(namespace, name)| namespace.contains('.') && !name.is_empty())
            {
                return Err(CatalogError::InvalidId);
            }
            if self.ids().take(index).any(|old| old == id) {
                return Err(CatalogError::DuplicateId);
            }
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CatalogError {
    TooManyCommands,
    InvalidId,
    DuplicateId,
}
impl CatalogError {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::TooManyCommands => "command_catalog_limit",
            Self::InvalidId => "command_id_invalid",
            Self::DuplicateId => "command_id_duplicate",
        }
    }
}

/// Frozen registration uses exact, case-sensitive namespaced ASCII IDs.
pub fn validate_catalog(commands: &[CommandDescriptor]) -> Result<(), CatalogError> {
    CommandCatalog::Static(commands).validate()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandPlan<I> {
    pub operations: Vec<Operation<LocalRef<I>>>,
    pub selection: SelectionIntent<I>,
    pub stored_marks: StoredMarksUpdate,
    pub input_result: Option<TextReplacementPlan<I>>,
}

pub struct PlanBuilder<'a, I> {
    work: &'a mut WorkMeter,
    operation_cap: usize,
    plan: CommandPlan<I>,
}

fn local_ref<I>(
    reference: &LocalRef<I>,
    preceding: usize,
    work: &mut WorkMeter,
) -> Result<(), LimitExceeded> {
    work.charge_units(1)?;
    if let LocalRef::Created { operation, path } = reference {
        check(
            "command_local_reference",
            preceding as u64,
            operation.saturating_add(1) as u64,
        )?;
        check(
            "command_local_path",
            MAX_LOCAL_PATH as u64,
            path.len() as u64,
        )?;
        if path.is_empty() {
            return Err(LimitExceeded {
                name: "command_local_path",
                maximum: MAX_LOCAL_PATH as u64,
                observed: 0,
            });
        }
        work.charge_units(path.len() as u64)?;
        work.charge_bytes(std::mem::size_of_val(path.as_slice()) as u64)?;
    }
    Ok(())
}

fn position<I>(
    position: &Position<LocalRef<I>>,
    preceding: usize,
    work: &mut WorkMeter,
) -> Result<(), LimitExceeded> {
    match position {
        Position::Text { leaf, .. } => local_ref(leaf, preceding, work),
        Position::Child { parent, .. } => local_ref(parent, preceding, work),
        Position::Edge { node, .. } => local_ref(node, preceding, work),
    }
}

fn metadata(attrs: &Attributes, marks: &[Mark], work: &mut WorkMeter) -> Result<(), LimitExceeded> {
    let left = work.limits();
    let spent = work.usage();
    let usage = preflight_node_fields(
        "",
        None,
        attrs,
        marks,
        0,
        PreflightBudget {
            payload_bytes: left.bytes.saturating_sub(spent.bytes),
            values: left.units.saturating_sub(spent.units),
            depth: PreflightBudget::default().depth,
        },
    )?;
    work.charge_units(usage.values)?;
    work.charge_bytes(
        usage
            .payload_bytes
            .saturating_mul(8)
            .saturating_add(usage.values.saturating_mul(128)),
    )
}

impl<'a, I> PlanBuilder<'a, I> {
    pub fn new(work: &'a mut WorkMeter, operation_cap: usize) -> Self {
        Self {
            work,
            operation_cap: operation_cap.min(MAX_COMMAND_OPERATIONS),
            plan: CommandPlan {
                operations: Vec::new(),
                selection: SelectionIntent::MapCurrent,
                stored_marks: StoredMarksUpdate::Keep,
                input_result: None,
            },
        }
    }
    pub fn len(&self) -> usize {
        self.plan.operations.len()
    }
    pub fn is_empty(&self) -> bool {
        self.plan.operations.is_empty()
    }
    pub fn work(&mut self) -> &mut WorkMeter {
        self.work
    }
    pub fn push(&mut self, operation: Operation<LocalRef<I>>) -> Result<usize, LimitExceeded> {
        let index = self.len();
        check(
            "command_operations",
            self.operation_cap as u64,
            index.saturating_add(1) as u64,
        )?;
        self.work.charge_units(1)?;
        self.work
            .charge_bytes((std::mem::size_of::<Operation<LocalRef<I>>>() * 2) as u64)?;
        match &operation {
            Operation::ReplaceText { leaf, .. }
            | Operation::SplitText { leaf, .. }
            | Operation::SetMarks { leaf, .. } => local_ref(leaf, index, self.work)?,
            Operation::JoinText { left, right } => {
                local_ref(left, index, self.work)?;
                local_ref(right, index, self.work)?;
            }
            Operation::PatchMarkRange { range, .. }
            | Operation::ReplaceInlineRange { range, .. }
            | Operation::ReplaceInlineFragment { range, .. } => {
                position(&range.anchor, index, self.work)?;
                position(&range.focus, index, self.work)?;
            }
            Operation::SetAttribute { node, .. }
            | Operation::Transform { node, .. }
            | Operation::Remove { node } => local_ref(node, index, self.work)?,
            Operation::InsertFragment { parent, .. } => local_ref(parent, index, self.work)?,
            Operation::Move { node, parent, .. } | Operation::Duplicate { node, parent, .. } => {
                local_ref(node, index, self.work)?;
                local_ref(parent, index, self.work)?;
            }
            Operation::MoveInlineGroup { nodes, parent, .. } => {
                self.work.charge_units(nodes.len() as u64)?;
                self.work
                    .charge_bytes(std::mem::size_of_val(nodes.as_slice()) as u64)?;
                for node in nodes {
                    local_ref(node, index, self.work)?;
                }
                local_ref(parent, index, self.work)?;
            }
        }
        self.plan.operations.push(operation);
        Ok(index)
    }
    pub fn charged_copy_attrs(&mut self, attrs: &Attributes) -> Result<Attributes, LimitExceeded> {
        metadata(attrs, &[], self.work)?;
        Ok(attrs.clone())
    }
    pub fn charged_copy_marks(&mut self, marks: &[Mark]) -> Result<Vec<Mark>, LimitExceeded> {
        metadata(&Attributes::new(), marks, self.work)?;
        Ok(marks.to_vec())
    }
    pub fn charged_copy_text(&mut self, text: &str) -> Result<String, LimitExceeded> {
        check(
            "preflight_payload_bytes",
            PreflightBudget::default().payload_bytes,
            text.len() as u64,
        )?;
        self.work.charge_units(1)?;
        self.work.charge_bytes(text.len() as u64)?;
        Ok(text.to_owned())
    }
    pub fn set_selection(&mut self, selection: SelectionIntent<I>) -> Result<(), LimitExceeded> {
        if let SelectionIntent::Set(Some(selection))
        | SelectionIntent::MapFromUserResult(Some(selection)) = &selection
        {
            position(&selection.anchor, self.len(), self.work)?;
            position(&selection.focus, self.len(), self.work)?;
        }
        self.plan.selection = selection;
        Ok(())
    }
    pub fn set_stored_marks(&mut self, marks: StoredMarksUpdate) -> Result<(), LimitExceeded> {
        if let StoredMarksUpdate::Set(marks) = &marks {
            metadata(&Attributes::new(), marks, self.work)?;
        }
        self.plan.stored_marks = marks;
        Ok(())
    }
    /// At most one closed input result. All owned payloads must already have
    /// been charged through this builder's meter; the engine checks final
    /// representation and actual frame correspondence before publication.
    pub fn set_input_result(
        &mut self,
        result: TextReplacementPlan<I>,
    ) -> Result<(), LimitExceeded> {
        check(
            "input_result_count",
            1,
            u64::from(self.plan.input_result.is_some()) + 1,
        )?;
        position(&result.after_range.anchor, self.len(), self.work)?;
        position(&result.after_range.focus, self.len(), self.work)?;
        self.plan.input_result = Some(result);
        Ok(())
    }
    pub fn finish(self) -> CommandPlan<I> {
        self.plan
    }
}

/// Trusted compiled hooks; all mutable session authority remains in the engine.
pub trait CommandProvider: TransactionProfile {
    type Intent<I: Copy + Eq + Ord>;
    const COMMANDS: &'static [CommandDescriptor];
    /// Legacy providers keep their exact associated catalog. A runtime profile
    /// overrides this with IDs owned by its immutable admitted configuration.
    fn command_catalog(&self) -> CommandCatalog<'_> {
        CommandCatalog::Static(Self::COMMANDS)
    }
    fn command_id<I: Copy + Eq + Ord>(intent: &Self::Intent<I>) -> &str;
    /// New input transport is explicitly opted in by the immutable profile.
    fn supports_input_command<I: Copy + Eq + Ord>(&self, _intent: &Self::Intent<I>) -> bool {
        false
    }
    /// LiteralOnly is a single fallback preparation after an optional local
    /// result limit; it must not rerun matching or restore a raw descriptor.
    fn prepare_input_command<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &Self::Intent<V::Id>,
        _policy: InputCommandPolicy,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.prepare_command(context, view, state, intent, plan)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        context: &Self::Context,
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &Self::Intent<V::Id>,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error>;
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        context: &Self::Context,
        final_view: &V,
        final_selection: Option<Selection<V::Id>>,
        proposed: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error>;
    fn error_code(error: &Self::Error) -> &'static str;
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::Attribute;
    use crate::positions::{Affinity, Utf16Offset};
    use crate::transaction::{MarkEdit, WorkLimits};

    // OSR-64: literal expectations frozen before the borrowed catalog seam.
    #[test]
    fn runtime_catalog_uses_borrowed_exact_ids_and_the_legacy_bounds() {
        let ids = vec![
            ["org.example.external", "type"].join("/"),
            ["org.example.external", "Type"].join("/"),
        ];
        let catalog = CommandCatalog::Runtime(&ids);
        assert_eq!(
            catalog.ids().collect::<Vec<_>>(),
            vec!["org.example.external/type", "org.example.external/Type"]
        );
        assert_eq!(catalog.validate(), Ok(()));
        assert_eq!(catalog.get(2), None);
        assert_eq!(CommandCatalog::Runtime(&[]).validate(), Ok(()));
        let duplicates = vec!["org.example.external/type".to_owned(); 2];
        assert_eq!(
            CommandCatalog::Runtime(&duplicates).validate(),
            Err(CatalogError::DuplicateId)
        );
        let invalid = vec!["org.example.external/type space".to_owned()];
        assert_eq!(
            CommandCatalog::Runtime(&invalid).validate(),
            Err(CatalogError::InvalidId)
        );
        let too_many = vec!["org.example.external/type".to_owned(); 257];
        assert_eq!(
            CommandCatalog::Runtime(&too_many).validate(),
            Err(CatalogError::TooManyCommands)
        );
    }

    #[test]
    fn catalog_is_bounded_exact_and_case_sensitive() {
        assert_eq!(
            validate_catalog(&[
                CommandDescriptor {
                    id: "org.example/enter"
                },
                CommandDescriptor {
                    id: "org.example/Enter"
                }
            ]),
            Ok(())
        );
        assert_eq!(
            validate_catalog(&[
                CommandDescriptor {
                    id: "org.example/enter"
                },
                CommandDescriptor {
                    id: "org.example/enter"
                }
            ]),
            Err(CatalogError::DuplicateId)
        );
        assert_eq!(
            validate_catalog(&[CommandDescriptor {
                id: "not namespaced"
            }]),
            Err(CatalogError::InvalidId)
        );
        assert_eq!(
            validate_catalog(
                &[CommandDescriptor {
                    id: "org.example/enter"
                }; MAX_COMMANDS + 1]
            ),
            Err(CatalogError::TooManyCommands)
        );
        assert_eq!(CatalogError::DuplicateId.as_str(), "command_id_duplicate");
    }

    #[test]
    fn builder_refuses_forward_paths_and_operation_overflow_without_losing_prior_plan() {
        let mut meter = WorkMeter::new(WorkLimits::default());
        let mut builder = PlanBuilder::<u64>::new(&mut meter, 2);
        let forward = Operation::SetMarks {
            leaf: LocalRef::Created {
                operation: 0,
                path: vec![0],
            },
            marks: vec![],
        };
        assert_eq!(
            builder.push(forward).unwrap_err().name,
            "command_local_reference"
        );
        assert!(builder.is_empty());
        assert_eq!(
            builder
                .push(Operation::SplitText {
                    leaf: 7.into(),
                    at: Utf16Offset::new(1)
                })
                .unwrap(),
            0
        );
        assert_eq!(
            builder
                .push(Operation::SetMarks {
                    leaf: LocalRef::Created {
                        operation: 0,
                        path: vec![0]
                    },
                    marks: vec![]
                })
                .unwrap(),
            1
        );
        assert_eq!(
            builder
                .push(Operation::Remove { node: 7.into() })
                .unwrap_err()
                .name,
            "command_operations"
        );
        assert_eq!(builder.len(), 2);
        let selected = SelectionIntent::MapFromUserResult(Some(Selection {
            anchor: Position::Child {
                parent: 7.into(),
                index: 0,
                affinity: Affinity::After,
            },
            focus: Position::Child {
                parent: 7.into(),
                index: 0,
                affinity: Affinity::After,
            },
        }));
        builder.set_selection(selected.clone()).unwrap();
        let invalid = SelectionIntent::Set(Some(Selection {
            anchor: Position::Child {
                parent: LocalRef::Created {
                    operation: 0,
                    path: vec![],
                },
                index: 0,
                affinity: Affinity::After,
            },
            focus: Position::Child {
                parent: 7.into(),
                index: 0,
                affinity: Affinity::After,
            },
        }));
        assert_eq!(
            builder.set_selection(invalid).unwrap_err().name,
            "command_local_path"
        );
        let plan = builder.finish();
        assert_eq!(plan.operations.len(), 2);
        assert_eq!(plan.selection, selected);
    }

    #[test]
    fn copy_guards_refuse_wide_metadata_before_clone_and_keep_source_unchanged() {
        let attrs = Attributes::from([
            ("a".into(), Attribute::String("kept".into())),
            ("b".into(), Attribute::String("also kept".into())),
        ]);
        let original = attrs.clone();
        let mut meter = WorkMeter::new(WorkLimits {
            units: 1,
            bytes: 1024,
        });
        let mut builder = PlanBuilder::<u64>::new(&mut meter, 1);
        assert!(builder.charged_copy_attrs(&attrs).is_err());
        assert_eq!(attrs, original);
        assert!(builder.is_empty());
        let mut meter = WorkMeter::new(WorkLimits { units: 8, bytes: 1 });
        let mut builder = PlanBuilder::<u64>::new(&mut meter, 1);
        assert!(builder.charged_copy_text("long").is_err());
        assert!(builder.is_empty());
    }

    #[test]
    fn all_closed_range_addresses_map_without_rewriting_payload_or_selection_direction() {
        let range = Selection {
            anchor: Position::Text {
                leaf: 9,
                utf16: Utf16Offset::new(5),
                affinity: Affinity::Before,
            },
            focus: Position::Child {
                parent: 3,
                index: 1,
                affinity: Affinity::After,
            },
        };
        let edits = vec![MarkEdit::Remove {
            type_id: "org.example/strong".into(),
        }];
        let mapped = Operation::PatchMarkRange {
            range,
            edits: edits.clone(),
        }
        .try_map_ids(|id| Ok::<_, ()>(id + 10))
        .unwrap();
        assert_eq!(
            mapped,
            Operation::PatchMarkRange {
                range: Selection {
                    anchor: Position::Text {
                        leaf: 19,
                        utf16: Utf16Offset::new(5),
                        affinity: Affinity::Before
                    },
                    focus: Position::Child {
                        parent: 13,
                        index: 1,
                        affinity: Affinity::After
                    }
                },
                edits
            }
        );
        assert_eq!(
            Operation::MoveInlineGroup {
                nodes: vec![2, 3],
                parent: 4,
                before_index: 7
            }
            .try_map_ids(|id| Ok::<_, ()>(id + 10))
            .unwrap(),
            Operation::MoveInlineGroup {
                nodes: vec![12, 13],
                parent: 14,
                before_index: 7
            }
        );
        let replacement = Operation::ReplaceInlineRange {
            range,
            inserted: None,
        }
        .try_map_ids(|id| Ok::<_, ()>(id + 10))
        .unwrap();
        assert!(matches!(
            replacement,
            Operation::ReplaceInlineRange { inserted: None, .. }
        ));
    }
}
