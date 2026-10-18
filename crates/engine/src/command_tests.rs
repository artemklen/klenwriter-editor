// SPDX-License-Identifier: MIT OR Apache-2.0
//! Compiled non-KWDJ provider witnesses. This fixture is not a registry/SDK claim.

use super::super::{AccessMode, SessionState};
use super::*;
use crate::mapping::{MapResult, StepMap};
use crate::transaction::{CommitEvent, JournalEntrySummary, JournalSummary};
use crate::tree::{EditOrigin, TreeError};
use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandCatalog, CommandDescriptor, LocalRef, SelectionIntent, StoredMarksUpdate,
};
use editor_core::document::{Attributes, Document, Mark, Node, Primitive};
use editor_core::positions::{Affinity, Position, PositionError, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats};
use std::cell::Cell;
use std::rc::Rc;

#[derive(Debug, Clone)]
enum Intent<I> {
    Split {
        leaf: I,
        at: usize,
        post_user: bool,
    },
    Insert {
        parent: I,
        index: usize,
        text: String,
    },
    Duplicate {
        node: I,
        parent: I,
        index: usize,
    },
    InsertEmptyWithInvalidCaret {
        parent: I,
        child_position: bool,
    },
    MarkOverride(Option<Vec<Mark>>),
    Type(String),
    RuntimeType {
        id: String,
        text: String,
    },
    Noop,
    Unknown,
}

struct FixtureProfile {
    binding: ProfileBinding,
    initial: Document,
    join: bool,
    retire_empty: bool,
    reject_validation: bool,
    reject_finalizer: bool,
    snapshot_calls: Rc<Cell<usize>>,
    validation_calls: Rc<Cell<usize>>,
    finalizer_calls: Rc<Cell<usize>>,
    runtime_catalog: Option<Vec<String>>,
    profile_work: Option<editor_core::transaction::WorkLimits>,
}
fn mark() -> Mark {
    Mark {
        type_id: "org.example.commands/ink".into(),
        attributes: Attributes::new(),
    }
}
fn leaf_node(value: &str, marks: Vec<Mark>) -> Node {
    Node {
        type_id: "org.example.commands/text".into(),
        primitive: Primitive::Text,
        attributes: Attributes::new(),
        marks,
        text: Some(value.into()),
        children: vec![],
    }
}
impl FixtureProfile {
    fn new(value: &str, styled: bool) -> Self {
        Self {
            binding: ProfileBinding::new(
                "org.example.commands",
                "1.0.0",
                "org.example.commands/json",
                1,
                &[],
            )
            .unwrap(),
            initial: Document {
                children: vec![Node {
                    type_id: "org.example.commands/paragraph".into(),
                    primitive: Primitive::TextBlock,
                    attributes: Attributes::new(),
                    marks: vec![],
                    text: None,
                    children: vec![leaf_node(value, if styled { vec![mark()] } else { vec![] })],
                }],
            },
            join: false,
            retire_empty: false,
            reject_validation: false,
            reject_finalizer: false,
            snapshot_calls: Rc::new(Cell::new(0)),
            validation_calls: Rc::new(Cell::new(0)),
            finalizer_calls: Rc::new(Cell::new(0)),
            runtime_catalog: None,
            profile_work: None,
        }
    }
}
impl FrozenProfile for FixtureProfile {
    type Context = ();
    type Admitted = Document;
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn transaction_work_limits(&self) -> Option<editor_core::transaction::WorkLimits> {
        self.profile_work
    }
    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        _: &[u8],
        _: AdmissionMode,
    ) -> Result<Document, Self::Error> {
        self.binding
            .ensure_matches(requested)
            .map_err(|_| "fixture.binding")?;
        Ok(self.initial.clone())
    }
    fn context(&self, _: &Document) {}
    fn to_document(&self, document: &Document) -> Document {
        document.clone()
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<Document, Self::Error> {
        self.snapshot_calls.set(self.snapshot_calls.get() + 1);
        Ok(document.clone())
    }
    fn canonical<'a>(&self, _: &'a Document) -> &'a [u8] {
        b"explicit fixture snapshot"
    }
}
impl TransactionProfile for FixtureProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        if self.retire_empty {
            for root in view.roots() {
                work.charge_units(1).map_err(|_| "fixture.work")?;
                let block = view.node(*root).ok_or("fixture.missing")?;
                for child in block.children {
                    work.charge_units(1).map_err(|_| "fixture.work")?;
                    let node = view.node(*child).ok_or("fixture.missing")?;
                    if node.primitive == Primitive::Text && node.text == Some("") {
                        work.charge_bytes(std::mem::size_of::<Operation<V::Id>>() as u64)
                            .map_err(|_| "fixture.work")?;
                        return Ok(vec![Operation::Remove { node: *child }]);
                    }
                }
            }
        }
        if self.join {
            for root in view.roots() {
                work.charge_units(1).map_err(|_| "fixture.work")?;
                let block = view.node(*root).ok_or("fixture.missing")?;
                for pair in block.children.windows(2) {
                    work.charge_units(1).map_err(|_| "fixture.work")?;
                    let left = view.node(pair[0]).ok_or("fixture.missing")?;
                    let right = view.node(pair[1]).ok_or("fixture.missing")?;
                    if left.primitive == Primitive::Text
                        && right.primitive == Primitive::Text
                        && left.marks == right.marks
                    {
                        work.charge_bytes(std::mem::size_of::<Operation<V::Id>>() as u64)
                            .map_err(|_| "fixture.work")?;
                        return Ok(vec![Operation::JoinText {
                            left: pair[0],
                            right: pair[1],
                        }]);
                    }
                }
            }
        }
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.validation_calls.set(self.validation_calls.get() + 1);
        fn walk<V: CandidateRead>(
            view: &V,
            id: V::Id,
            work: &mut WorkMeter,
            count: &mut u64,
        ) -> Result<(), &'static str> {
            work.charge_units(1).map_err(|_| "fixture.work")?;
            let node = view.node(id).ok_or("fixture.missing")?;
            if !node.type_id.starts_with("org.example.commands/") {
                return Err("fixture.namespace");
            }
            *count += 1;
            for child in node.children {
                walk(view, *child, work, count)?;
            }
            Ok(())
        }
        let mut count = 0;
        for root in view.roots() {
            walk(view, *root, work, &mut count)?;
        }
        if self.reject_validation {
            return Err("fixture.validate");
        }
        Ok(ValidationStats {
            nodes: count,
            canonical_bytes: 0,
        })
    }
}
impl CommandProvider for FixtureProfile {
    type Intent<I: Copy + Eq + Ord> = Intent<I>;
    const COMMANDS: &'static [CommandDescriptor] = &[
        CommandDescriptor {
            id: "org.example.commands/split",
        },
        CommandDescriptor {
            id: "org.example.commands/insert",
        },
        CommandDescriptor {
            id: "org.example.commands/duplicate",
        },
        CommandDescriptor {
            id: "org.example.commands/marks",
        },
        CommandDescriptor {
            id: "org.example.commands/type",
        },
        CommandDescriptor {
            id: "org.example.commands/noop",
        },
    ];
    fn command_catalog(&self) -> CommandCatalog<'_> {
        match &self.runtime_catalog {
            Some(ids) => CommandCatalog::Runtime(ids),
            None => CommandCatalog::Static(Self::COMMANDS),
        }
    }
    fn command_id<I: Copy + Eq + Ord>(intent: &Intent<I>) -> &str {
        match intent {
            Intent::Split { .. } => Self::COMMANDS[0].id,
            Intent::Insert { .. } | Intent::InsertEmptyWithInvalidCaret { .. } => {
                Self::COMMANDS[1].id
            }
            Intent::Duplicate { .. } => Self::COMMANDS[2].id,
            Intent::MarkOverride(_) => Self::COMMANDS[3].id,
            Intent::Type(_) => Self::COMMANDS[4].id,
            Intent::RuntimeType { id, .. } => id,
            Intent::Noop => Self::COMMANDS[5].id,
            Intent::Unknown => "org.example.commands/unregistered",
        }
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        state: CommandState<'_, V::Id>,
        intent: &Intent<V::Id>,
        plan: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        let budget = |_| "fixture.work";
        match intent {
            Intent::Split {
                leaf,
                at,
                post_user,
            } => {
                let operation = plan
                    .push(Operation::SplitText {
                        leaf: (*leaf).into(),
                        at: Utf16Offset::new(*at),
                    })
                    .map_err(budget)?;
                plan.work()
                    .charge_bytes((std::mem::size_of::<usize>() * 2) as u64)
                    .map_err(budget)?;
                let selected = Some(Selection {
                    anchor: Position::Text {
                        leaf: LocalRef::Created {
                            operation,
                            path: vec![0],
                        },
                        utf16: Utf16Offset::new(0),
                        affinity: Affinity::After,
                    },
                    focus: Position::Text {
                        leaf: LocalRef::Created {
                            operation,
                            path: vec![0],
                        },
                        utf16: Utf16Offset::new(0),
                        affinity: Affinity::After,
                    },
                });
                plan.set_selection(if *post_user {
                    SelectionIntent::MapFromUserResult(selected)
                } else {
                    SelectionIntent::Set(selected)
                })
                .map_err(budget)?;
            }
            Intent::Insert {
                parent,
                index,
                text,
            } => {
                let text = plan.charged_copy_text(text).map_err(budget)?;
                plan.work()
                    .charge_bytes(std::mem::size_of::<Node>() as u64 + 32)
                    .map_err(budget)?;
                plan.push(Operation::InsertFragment {
                    parent: (*parent).into(),
                    index: *index,
                    fragment: Document {
                        children: vec![Node {
                            type_id: "org.example.commands/text".into(),
                            primitive: Primitive::Text,
                            attributes: Attributes::new(),
                            marks: vec![],
                            text: Some(text),
                            children: vec![],
                        }],
                    },
                })
                .map_err(budget)?;
            }
            Intent::Duplicate {
                node,
                parent,
                index,
            } => {
                plan.push(Operation::Duplicate {
                    node: (*node).into(),
                    parent: (*parent).into(),
                    index: *index,
                })
                .map_err(budget)?;
            }
            Intent::InsertEmptyWithInvalidCaret {
                parent,
                child_position,
            } => {
                plan.work()
                    .charge_bytes(std::mem::size_of::<Node>() as u64 + 32)
                    .map_err(budget)?;
                let operation = plan
                    .push(Operation::InsertFragment {
                        parent: (*parent).into(),
                        index: 1,
                        fragment: Document {
                            children: vec![leaf_node("", vec![])],
                        },
                    })
                    .map_err(budget)?;
                plan.work()
                    .charge_bytes((std::mem::size_of::<usize>() * 2) as u64)
                    .map_err(budget)?;
                let caret = || {
                    let created = LocalRef::Created {
                        operation,
                        path: vec![0],
                    };
                    if *child_position {
                        Position::Child {
                            parent: created,
                            index: 0,
                            affinity: Affinity::After,
                        }
                    } else {
                        Position::Text {
                            leaf: created,
                            utf16: Utf16Offset::new(1),
                            affinity: Affinity::After,
                        }
                    }
                };
                plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
                    anchor: caret(),
                    focus: caret(),
                })))
                .map_err(budget)?;
            }
            Intent::MarkOverride(marks) => {
                let update = match marks {
                    None => StoredMarksUpdate::Inherit,
                    Some(marks) => {
                        StoredMarksUpdate::Set(plan.charged_copy_marks(marks).map_err(budget)?)
                    }
                };
                plan.set_stored_marks(update).map_err(budget)?;
            }
            Intent::Type(text) | Intent::RuntimeType { text, .. } => {
                let caret = state.selection.ok_or("fixture.selection")?.focus;
                let Position::Text { leaf, utf16, .. } = caret else {
                    return Err("fixture.selection");
                };
                let source = view.node(leaf).ok_or("fixture.missing")?;
                let marks = plan
                    .charged_copy_marks(state.stored_marks.unwrap_or(source.marks))
                    .map_err(budget)?;
                let text = plan.charged_copy_text(text).map_err(budget)?;
                plan.work()
                    .charge_bytes(text.len() as u64 + std::mem::size_of::<Node>() as u64 + 64)
                    .map_err(budget)?;
                let length = text.encode_utf16().count();
                let prototype = Node {
                    type_id: "org.example.commands/text".into(),
                    primitive: Primitive::Text,
                    attributes: Attributes::new(),
                    marks,
                    text: Some(text),
                    children: vec![],
                };
                let operation = plan
                    .push(Operation::ReplaceInlineRange {
                        range: Selection {
                            anchor: Position::Text {
                                leaf: leaf.into(),
                                utf16,
                                affinity: Affinity::After,
                            },
                            focus: Position::Text {
                                leaf: leaf.into(),
                                utf16,
                                affinity: Affinity::After,
                            },
                        },
                        inserted: Some(prototype),
                    })
                    .map_err(budget)?;
                plan.set_selection(SelectionIntent::MapFromUserResult(Some(Selection {
                    anchor: Position::Text {
                        leaf: LocalRef::Created {
                            operation,
                            path: vec![0],
                        },
                        utf16: Utf16Offset::new(length),
                        affinity: Affinity::After,
                    },
                    focus: Position::Text {
                        leaf: LocalRef::Created {
                            operation,
                            path: vec![0],
                        },
                        utf16: Utf16Offset::new(length),
                        affinity: Affinity::After,
                    },
                })))
                .map_err(budget)?;
            }
            Intent::Noop => {}
            Intent::Unknown => return Err("fixture.unreachable"),
        }
        Ok(CommandPresentation::default())
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        selection: Option<Selection<V::Id>>,
        proposed: Option<&[Mark]>,
        work: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.finalizer_calls.set(self.finalizer_calls.get() + 1);
        work.charge_units(1).map_err(|_| "fixture.work")?;
        if let Some(selection) = selection {
            view.node(selection.focus.node())
                .ok_or("fixture.final_selection")?;
        }
        if self.reject_finalizer {
            return Err("fixture.finalize");
        }
        let Some(marks) = proposed else {
            return Ok(None);
        };
        work.charge_units(marks.len() as u64 + 1)
            .map_err(|_| "fixture.work")?;
        if marks
            .iter()
            .any(|mark| mark.type_id != "org.example.commands/ink")
        {
            return Err("fixture.mark");
        }
        work.charge_bytes((std::mem::size_of_val(marks) + 64) as u64)
            .map_err(|_| "fixture.work")?;
        Ok(Some(marks.to_vec()))
    }
    fn error_code(error: &Self::Error) -> &'static str {
        error
    }
}

fn open(value: &str, styled: bool) -> Session<FixtureProfile> {
    open_profile(FixtureProfile::new(value, styled))
}
fn open_profile(profile: FixtureProfile) -> Session<FixtureProfile> {
    let binding = profile.binding.clone();
    let mut session = Session::open(
        profile,
        &binding,
        b"trusted fixture",
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let leaf = first_leaf(&session);
    let caret = position(leaf, 0);
    session
        .set_selection(
            session.key(),
            0,
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
    session
}
fn first_block(s: &Session<FixtureProfile>) -> NodeId {
    s.tree.node(s.tree.root()).unwrap().children()[0]
}
fn first_leaf(s: &Session<FixtureProfile>) -> NodeId {
    s.tree.node(first_block(s)).unwrap().children()[0]
}
fn position(id: NodeId, offset: usize) -> Position<NodeId> {
    Position::Text {
        leaf: id,
        utf16: Utf16Offset::new(offset),
        affinity: Affinity::After,
    }
}
fn request(s: &Session<FixtureProfile>, intent: Intent<NodeId>) -> CommandRequest<Intent<NodeId>> {
    CommandRequest::new(s.key(), s.revision(), s.selection_epoch(), intent)
}
fn completed(
    s: &mut Session<FixtureProfile>,
    request: &CommandRequest<Intent<NodeId>>,
) -> DispatchOutcome<&'static str> {
    match s.execute_command(request) {
        CommandOutcome::Completed { outcome, .. } => outcome,
        other => panic!("expected completed {other:?}"),
    }
}
fn changed(
    s: &mut Session<FixtureProfile>,
    request: &CommandRequest<Intent<NodeId>>,
) -> CommitEvent {
    match completed(s, request) {
        DispatchOutcome::Changed(event) => event,
        other => panic!("expected document change {other:?}"),
    }
}
#[derive(Debug, PartialEq, Eq)]
struct Facets {
    document: Document,
    identities: Vec<(NodeId, Option<NodeId>, Vec<NodeId>)>,
    key: SessionKey,
    state: SessionState,
    revision: u64,
    epoch: u64,
    selection: Option<Selection<NodeId>>,
    marks: Option<Vec<Mark>>,
    dirty: bool,
    journal: JournalSummary,
    entries: Vec<JournalEntrySummary>,
    maps: Vec<MapResult<NodeId>>,
}
fn facets(s: &Session<FixtureProfile>, probe: NodeId) -> Facets {
    fn walk(
        s: &Session<FixtureProfile>,
        id: NodeId,
        out: &mut Vec<(NodeId, Option<NodeId>, Vec<NodeId>)>,
    ) {
        let node = s.tree.node(id).unwrap();
        out.push((id, node.parent(), node.children().to_vec()));
        for child in node.children() {
            walk(s, *child, out);
        }
    }
    let mut identities = vec![];
    walk(s, s.tree.root(), &mut identities);
    Facets {
        document: s.tree.document(),
        identities,
        key: s.key(),
        state: s.state(),
        revision: s.revision(),
        epoch: s.selection_epoch(),
        selection: s.selection,
        marks: s.stored_marks.clone(),
        dirty: s.dirty(),
        journal: s.journal_summary(),
        entries: s.journal_entries(),
        maps: (0..=s.revision().min(8))
            .map(|from| s.journal.map(from, s.revision(), position(probe, 0)))
            .collect(),
    }
}
fn available(
    s: &Session<FixtureProfile>,
    request: &CommandRequest<Intent<NodeId>>,
) -> (CommandEffect, bool, bool, WorkUsage) {
    match s.query_command(request) {
        CommandAvailability::Available {
            effect,
            selection_changed,
            stored_marks_changed,
            work,
            ..
        } => (effect, selection_changed, stored_marks_changed, work),
        other => panic!("expected available {other:?}"),
    }
}
fn same_refusal(
    s: &mut Session<FixtureProfile>,
    request: &CommandRequest<Intent<NodeId>>,
    probe: NodeId,
) -> &'static str {
    let before = facets(s, probe);
    let (reason, error, work) = match s.query_command(request) {
        CommandAvailability::Unavailable {
            reason,
            error,
            work,
        } => (reason, error, work),
        other => panic!("expected unavailable {other:?}"),
    };
    assert_eq!(
        facets(s, probe),
        before,
        "query refusal mutated committed facets"
    );
    match s.execute_command(request) {
        CommandOutcome::Refused {
            reason: actual,
            error: actual_error,
            work: actual_work,
        } => {
            assert_eq!(actual, reason);
            assert_eq!(actual_error, error);
            assert_eq!(actual_work, work);
        }
        other => panic!("query/execute refusal mismatch {other:?}"),
    }
    assert_eq!(
        facets(s, probe),
        before,
        "execute refusal mutated committed facets"
    );
    reason
}

// These literal effects/refusals precede the OSR-64 instance catalog implementation.
#[test]
fn runtime_catalog_query_and_execute_use_the_instance_id_without_publication_on_query() {
    let id = ["org.example.external", "type"].join("/");
    let mut profile = FixtureProfile::new("ab", false);
    profile.runtime_catalog = Some(vec![id.clone()]);
    let mut s = open_profile(profile);
    assert_eq!(
        s.command_catalog(s.key())
            .unwrap()
            .ids()
            .collect::<Vec<_>>(),
        vec!["org.example.external/type"]
    );
    let leaf = first_leaf(&s);
    let before = facets(&s, leaf);
    let runtime = request(
        &s,
        Intent::RuntimeType {
            id: id.clone(),
            text: "X".into(),
        },
    );
    assert_eq!(available(&s, &runtime).0, CommandEffect::Changed);
    assert_eq!(facets(&s, leaf), before);
    let legacy = request(&s, Intent::Type("X".into()));
    assert_eq!(same_refusal(&mut s, &legacy, leaf), "command.unknown");
    let case_mismatch = request(
        &s,
        Intent::RuntimeType {
            id: "org.example.external/Type".into(),
            text: "X".into(),
        },
    );
    assert_eq!(
        same_refusal(&mut s, &case_mismatch, leaf),
        "command.unknown"
    );
    changed(&mut s, &runtime);
    assert_eq!(
        s.tree.document().children[0]
            .children
            .iter()
            .map(|node| node.text.as_deref().unwrap())
            .collect::<String>(),
        "Xab"
    );
    assert_eq!(s.revision(), 1);
    assert_eq!(s.journal_entries().len(), 1);

    let mut other = open("ab", false);
    assert!(matches!(
        s.command_catalog(other.key()),
        Err(crate::session::SessionError::State(
            StateError::StaleSession
        ))
    ));
    let other_leaf = first_leaf(&other);
    let unregistered = request(
        &other,
        Intent::RuntimeType {
            id,
            text: "X".into(),
        },
    );
    assert_eq!(
        same_refusal(&mut other, &unregistered, other_leaf),
        "command.unknown"
    );
    other.close(other.key()).unwrap();
    assert!(matches!(
        other.command_catalog(other.key()),
        Err(crate::session::SessionError::State(StateError::Closed))
    ));
}

#[test]
fn immutable_profile_work_reductions_precede_catalog_or_raw_operation_preparation() {
    use editor_core::transaction::WorkLimits;
    for cap in [
        WorkLimits {
            units: 0,
            bytes: u64::MAX,
        },
        WorkLimits {
            units: u64::MAX,
            bytes: 0,
        },
    ] {
        let mut profile = FixtureProfile::new("ab", false);
        profile.profile_work = Some(cap);
        let binding = profile.binding.clone();
        let mut s = Session::open(
            profile,
            &binding,
            b"fixture",
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap();
        let leaf = first_leaf(&s);
        let before = facets(&s, leaf);
        let mut command = request(&s, Intent::Noop);
        command.limits.work = WorkLimits {
            units: u64::MAX,
            bytes: u64::MAX,
        };
        assert_eq!(
            same_refusal(&mut s, &command, leaf),
            "resource_limit_exceeded"
        );
        assert_eq!(s.profile.validation_calls.get(), 0);
        let mut raw = Transaction::new(
            s.key(),
            s.revision(),
            vec![Operation::ReplaceText {
                leaf: leaf.into(),
                from: Utf16Offset::new(0),
                to: Utf16Offset::new(0),
                inserted: "X".into(),
            }],
        );
        raw.limits.work = WorkLimits {
            units: u64::MAX,
            bytes: u64::MAX,
        };
        assert!(matches!(
            s.dispatch(raw),
            DispatchOutcome::Refused {
                error: TransactionError::Limit(_),
                ..
            }
        ));
        assert_eq!(facets(&s, leaf), before);
    }
}

#[test]
fn repeated_query_matches_real_work_without_consuming_any_of_three_allocator_paths() {
    for kind in 0..3 {
        let mut s = open("ab", false);
        let leaf = first_leaf(&s);
        let block = first_block(&s);
        let (intent, control_operation) = match kind {
            0 => (
                Intent::Split {
                    leaf,
                    at: 1,
                    post_user: true,
                },
                Operation::SplitText {
                    leaf,
                    at: Utf16Offset::new(1),
                },
            ),
            1 => (
                Intent::Insert {
                    parent: block,
                    index: 1,
                    text: "X".into(),
                },
                Operation::InsertFragment {
                    parent: block,
                    index: 1,
                    fragment: Document {
                        children: vec![leaf_node("X", vec![])],
                    },
                },
            ),
            _ => (
                Intent::Duplicate {
                    node: leaf,
                    parent: block,
                    index: 1,
                },
                Operation::Duplicate {
                    node: leaf,
                    parent: block,
                    index: 1,
                },
            ),
        };
        let expected = {
            let mut preview = s.tree.prepare_preview();
            preview
                .apply_operation(&control_operation, EditOrigin::User)
                .unwrap()[0]
        };
        let captured = request(&s, intent);
        let before = facets(&s, leaf);
        let mut queried_work = None;
        for _ in 0..16 {
            let (effect, _, _, work) = available(&s, &captured);
            assert_eq!(effect, CommandEffect::Changed);
            assert_eq!(*queried_work.get_or_insert(work), work);
            assert_eq!(facets(&s, leaf), before);
        }
        let after_queries = {
            let mut preview = s.tree.prepare_preview();
            preview
                .apply_operation(&control_operation, EditOrigin::User)
                .unwrap()[0]
        };
        assert_eq!(
            after_queries, expected,
            "query consumed real allocation cursor"
        );
        let event = changed(&mut s, &captured);
        assert_eq!(Some(event.work), queried_work);
        assert!(event.changed_nodes.contains(&expected));
        if kind == 0 {
            assert!(
                event
                    .map
                    .steps()
                    .iter()
                    .any(|step| matches!(step,StepMap::SplitText{right,..} if *right==expected))
            );
        }
        assert_eq!(
            s.profile.snapshot_calls.get(),
            0,
            "ordinary commands called snapshot admission"
        );
    }
}

#[test]
fn explicit_plain_marks_are_state_only_then_consumed_by_real_typing_and_owned_history() {
    let mut s = open("ab", true);
    let original = first_leaf(&s);
    let epoch = s.selection_epoch();
    let plain = request(&s, Intent::MarkOverride(Some(vec![])));
    assert_eq!(available(&s, &plain).0, CommandEffect::Unchanged);
    assert!(available(&s, &plain).2);
    assert!(matches!(
        completed(&mut s, &plain),
        DispatchOutcome::Unchanged {
            stored_marks_changed: true,
            selection_changed: false,
            ..
        }
    ));
    assert_eq!(s.stored_marks, Some(vec![]));
    assert_eq!(s.revision(), 0);
    assert!(!s.dirty());
    assert_eq!(s.journal_summary().entries, 0);
    assert_eq!(s.selection_epoch(), epoch + 1);
    assert_eq!(
        same_refusal(&mut s, &plain, original),
        "session.stale_selection_epoch"
    );
    let typing = request(&s, Intent::Type("X".into()));
    let query = available(&s, &typing);
    let event = changed(&mut s, &typing);
    assert_eq!(query.0, CommandEffect::Changed);
    assert_eq!(query.3, event.work);
    let doc = s.tree.document();
    assert_eq!(
        doc.children[0]
            .children
            .iter()
            .map(|n| n.text.as_deref().unwrap())
            .collect::<String>(),
        "Xab"
    );
    assert!(doc.children[0].children[0].marks.is_empty());
    assert_eq!(doc.children[0].children[1].marks, vec![mark()]);
    let journal = s.journal_entries();
    assert_eq!(journal.len(), 1);
    assert_eq!(journal[0].stored_marks_before, Some(vec![]));
    assert_eq!(journal[0].stored_marks_after, Some(vec![]));
    assert_eq!(event.stored_marks_before, Some(vec![]));
    assert_eq!(event.stored_marks_after, Some(vec![]));
    assert_eq!(s.profile.snapshot_calls.get(), 0);
}

#[test]
fn raw_dispatch_and_navigation_clear_overrides_only_on_actual_state_changes() {
    let mut s = open("ab", false);
    let leaf = first_leaf(&s);
    let marks = request(&s, Intent::MarkOverride(Some(vec![mark()])));
    completed(&mut s, &marks);
    let epoch = s.selection_epoch();
    let empty = Transaction::new(s.key(), s.revision(), vec![]);
    assert!(matches!(
        s.dispatch(empty),
        DispatchOutcome::Unchanged {
            stored_marks_changed: false,
            ..
        }
    ));
    assert_eq!(s.stored_marks, Some(vec![mark()]));
    assert_eq!(s.selection_epoch(), epoch);
    let mut navigation = Transaction::new(s.key(), s.revision(), vec![]);
    navigation.selection = SelectionIntent::Set(Some(Selection {
        anchor: Position::Text {
            leaf: leaf.into(),
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        },
        focus: Position::Text {
            leaf: leaf.into(),
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        },
    }));
    assert!(matches!(
        s.dispatch(navigation),
        DispatchOutcome::Unchanged {
            selection_changed: true,
            stored_marks_changed: true,
            ..
        }
    ));
    assert_eq!(s.stored_marks, None);
    assert_eq!(s.revision(), 0);
    assert_eq!(s.selection_epoch(), epoch + 1);
    let marks = request(&s, Intent::MarkOverride(Some(vec![mark()])));
    completed(&mut s, &marks);
    let raw = Transaction::new(
        s.key(),
        s.revision(),
        vec![Operation::ReplaceText {
            leaf: leaf.into(),
            from: Utf16Offset::new(2),
            to: Utf16Offset::new(2),
            inserted: "!".into(),
        }],
    );
    let event = match s.dispatch(raw) {
        DispatchOutcome::Changed(event) => event,
        other => panic!("{other:?}"),
    };
    assert_eq!(
        s.tree.document().children[0].children[0].text.as_deref(),
        Some("ab!")
    );
    assert_eq!(s.stored_marks, None);
    assert_eq!(event.stored_marks_before, Some(vec![mark()]));
    assert_eq!(event.stored_marks_after, None);
    assert_eq!(
        s.journal_entries()[0].stored_marks_before,
        Some(vec![mark()])
    );
    assert_eq!(s.journal_entries()[0].stored_marks_after, None);
    let marks = request(&s, Intent::MarkOverride(Some(vec![])));
    completed(&mut s, &marks);
    let epoch = s.selection_epoch();
    let selected = Selection {
        anchor: position(leaf, 0),
        focus: position(leaf, 0),
    };
    s.set_selection(s.key(), s.revision(), selected).unwrap();
    assert_eq!(s.stored_marks, None);
    assert_eq!(s.selection_epoch(), epoch + 1);
}

#[test]
fn read_only_refuses_zero_operation_typing_mutations_and_unknown_intents_are_stable() {
    let mut s = open("ab", false);
    let leaf = first_leaf(&s);
    s.state = SessionState::Open(AccessMode::ReadOnly);
    let marks = request(&s, Intent::MarkOverride(Some(vec![])));
    assert_eq!(same_refusal(&mut s, &marks, leaf), "session.read_only");
    let unknown = request(&s, Intent::Unknown);
    assert_eq!(same_refusal(&mut s, &unknown, leaf), "command.unknown");
}

#[test]
fn late_refusals_preserve_selection_typing_history_maps_and_every_committed_facet() {
    for case in 0..6 {
        let mut s = open("abcd", false);
        let leaf = first_leaf(&s);
        let initial = request(&s, Intent::Type("P".into()));
        changed(&mut s, &initial);
        let marks = request(&s, Intent::MarkOverride(Some(vec![mark()])));
        completed(&mut s, &marks);
        let current = s.selection.unwrap().focus.node();
        let mut captured = request(
            &s,
            Intent::Split {
                leaf: current,
                at: 1,
                post_user: true,
            },
        );
        match case {
            0 => s.profile.reject_validation = true,
            1 => s.profile.reject_finalizer = true,
            2 => captured.limits.journal_entries = 0,
            3 => {
                let full = available(&s, &captured).3;
                captured.limits.work.bytes = full.bytes - 1;
            }
            4 => {
                s.revision = u64::MAX;
                captured.revision = u64::MAX;
            }
            _ => {
                s.selection_epoch = u64::MAX;
                captured.selection_epoch = u64::MAX;
            }
        }
        let reason = same_refusal(&mut s, &captured, leaf);
        assert_eq!(
            reason,
            match case {
                0 => "fixture.validate",
                1 => "fixture.finalize",
                2 => "transaction.journal_limit",
                3 => "resource_limit_exceeded",
                _ => "session.counter_exhausted",
            }
        );
        assert_eq!(s.journal_summary().entries, 1);
        assert_eq!(s.stored_marks, Some(vec![mark()]));
        assert_eq!(s.profile.snapshot_calls.get(), 0);
    }
}

#[test]
fn post_user_created_caret_maps_through_retiring_join_but_raw_set_remains_final_addressing() {
    let mut s = open("abcd", false);
    s.profile.join = true;
    let leaf = first_leaf(&s);
    let captured = request(
        &s,
        Intent::Split {
            leaf,
            at: 2,
            post_user: true,
        },
    );
    let before = s.tree.document();
    let epoch = s.selection_epoch();
    let query = available(&s, &captured);
    assert_eq!(query.0, CommandEffect::Unchanged);
    assert!(query.1);
    match completed(&mut s, &captured) {
        DispatchOutcome::Unchanged { work, .. } => assert_eq!(work, query.3),
        other => panic!("{other:?}"),
    };
    assert_eq!(s.tree.document(), before);
    assert_eq!(
        s.selection,
        Some(Selection {
            anchor: position(leaf, 2),
            focus: position(leaf, 2)
        })
    );
    assert_eq!(s.selection_epoch(), epoch + 1);
    assert_eq!(s.revision(), 0);
    assert_eq!(s.journal_summary().entries, 0);
    let final_addressed = request(
        &s,
        Intent::Split {
            leaf,
            at: 2,
            post_user: false,
        },
    );
    assert_eq!(
        same_refusal(&mut s, &final_addressed, leaf),
        "tree.missing_node"
    );
}

fn invalid_created_caret_refuses_before_empty_leaf_retirement(child_position: bool) {
    let mut s = open("ab", false);
    let probe = first_leaf(&s);
    let initial = request(&s, Intent::Type("P".into()));
    changed(&mut s, &initial);
    let override_request = request(&s, Intent::MarkOverride(Some(vec![mark()])));
    completed(&mut s, &override_request);
    s.profile.retire_empty = true;
    let parent = first_block(&s);
    let operation = Operation::InsertFragment {
        parent,
        index: 1,
        fragment: Document {
            children: vec![leaf_node("", vec![])],
        },
    };
    let (first_reserved, second_reserved) = {
        let mut preview = s.tree.prepare_preview();
        let first = preview
            .apply_operation(&operation, EditOrigin::User)
            .unwrap()[0];
        let second = preview
            .apply_operation(&operation, EditOrigin::User)
            .unwrap()[0];
        (first, second)
    };
    let captured = request(
        &s,
        Intent::InsertEmptyWithInvalidCaret {
            parent,
            child_position,
        },
    );
    let expected = CommandError::Transaction(TransactionError::Tree(if child_position {
        TreeError::InvalidStructure
    } else {
        TreeError::Position(PositionError::OutOfBounds)
    }));
    let before = facets(&s, probe);
    match s.query_command(&captured) {
        CommandAvailability::Unavailable { error, .. } => assert_eq!(error, expected),
        other => panic!("invalid user-frame caret became available: {other:?}"),
    }
    assert_eq!(facets(&s, probe), before);
    assert_eq!(
        s.tree
            .prepare_preview()
            .apply_operation(&operation, EditOrigin::User)
            .unwrap()[0],
        first_reserved,
        "refused query consumed a real identity"
    );
    assert_eq!(
        same_refusal(&mut s, &captured, probe),
        if child_position {
            "tree.invalid_structure"
        } else {
            "position.invalid"
        }
    );
    assert_eq!(facets(&s, probe), before);
    assert_eq!(
        s.tree
            .prepare_preview()
            .apply_operation(&operation, EditOrigin::User)
            .unwrap()[0],
        second_reserved,
        "a failed real preparation consumes exactly its reserved identity"
    );
    assert_eq!(s.profile.snapshot_calls.get(), 0);
}

#[test]
fn post_user_invalid_created_text_offset_cannot_be_laundered_by_retirement() {
    invalid_created_caret_refuses_before_empty_leaf_retirement(false);
}

#[test]
fn post_user_child_position_on_created_text_cannot_be_laundered_by_retirement() {
    invalid_created_caret_refuses_before_empty_leaf_retirement(true);
}

#[test]
fn true_noop_does_not_need_a_next_revision_or_context_epoch() {
    let mut s = open("e\u{301}😀", false);
    let leaf = first_leaf(&s);
    s.revision = u64::MAX;
    s.selection_epoch = u64::MAX;
    let captured = request(&s, Intent::Noop);
    let before = facets(&s, leaf);
    let query = available(&s, &captured);
    assert_eq!(query.0, CommandEffect::Unchanged);
    assert!(!query.1 && !query.2);
    match completed(&mut s, &captured) {
        DispatchOutcome::Unchanged {
            revision,
            selection_epoch,
            work,
            ..
        } => {
            assert_eq!(revision, u64::MAX);
            assert_eq!(selection_epoch, u64::MAX);
            assert_eq!(work, query.3);
        }
        other => panic!("{other:?}"),
    };
    assert_eq!(facets(&s, leaf), before);
}

fn set_typing(
    s: &mut Session<FixtureProfile>,
    marks: Option<Vec<Mark>>,
) -> DispatchOutcome<&'static str> {
    let stamp = s.stamp();
    s.set_typing_marks(
        stamp.session,
        stamp.revision,
        stamp.selection_epoch,
        stamp.history_epoch,
        marks,
    )
}

#[test]
fn explicit_typing_setter_publishes_one_state_event_and_preserves_document_facets() {
    use crate::events::{EventKind, EventReadLimits};
    use editor_core::transaction::WorkLimits;

    let mut s = open("e\u{301}😀", true);
    let leaf = first_leaf(&s);
    let before = facets(&s, leaf);
    let cursor = s.event_status(s.key()).unwrap().head;
    let finalizer_calls = s.profile.finalizer_calls.get();
    let outcome = set_typing(&mut s, Some(vec![]));
    assert!(matches!(
        outcome,
        DispatchOutcome::Unchanged {
            revision: 0,
            selection_changed: false,
            stored_marks_changed: true,
            ..
        }
    ));
    assert_eq!(s.selection_epoch(), before.epoch + 1);
    assert_eq!(s.stored_marks, Some(vec![]));
    assert_eq!(s.tree.document(), before.document);
    assert_eq!(s.selection, before.selection);
    assert_eq!(s.journal_summary(), before.journal);
    assert_eq!(s.journal_entries(), before.entries);
    assert!(!s.dirty());
    assert_eq!(s.profile.finalizer_calls.get(), finalizer_calls + 1);
    assert_eq!(s.profile.snapshot_calls.get(), 0);
    let batch = s
        .events_after(
            s.key(),
            cursor,
            EventReadLimits::default(),
            WorkLimits::default(),
        )
        .unwrap();
    assert_eq!(batch.len(), 1);
    let event = batch.iter().next().unwrap();
    assert_eq!(event.before().revision, 0);
    assert_eq!(event.after().revision, 0);
    assert_eq!(event.payload().stored_marks_before, None);
    assert_eq!(event.payload().stored_marks_after, Some(vec![]));
    let EventKind::State(change) = event.kind() else {
        panic!("typing state must not publish a document event")
    };
    assert!(change.stored_marks_changed);
    assert!(!change.selection_changed && !change.baseline_changed);
    assert_eq!(event.payload().selection_before, before.selection);
    assert_eq!(event.payload().selection_after, before.selection);
    let after = facets(&s, leaf);
    let history = s.history_summary();
    let events = s.event_status(s.key()).unwrap();
    assert!(matches!(
        set_typing(&mut s, Some(vec![])),
        DispatchOutcome::Unchanged {
            stored_marks_changed: false,
            ..
        }
    ));
    assert_eq!(facets(&s, leaf), after);
    assert_eq!(s.history_summary(), history);
    assert_eq!(s.event_status(s.key()).unwrap(), events);
    assert!(matches!(
        set_typing(&mut s, None),
        DispatchOutcome::Unchanged {
            stored_marks_changed: true,
            ..
        }
    ));
    assert_eq!(s.stored_marks, None);
    assert_eq!(s.revision(), 0);
    assert_eq!(s.selection_epoch(), before.epoch + 2);
}

#[test]
fn explicit_typing_setter_refuses_invalid_marks_and_late_publication_limits_atomically() {
    for case in 0..4 {
        let mut s = open("ab", false);
        let leaf = first_leaf(&s);
        let initial = request(&s, Intent::Type("P".into()));
        changed(&mut s, &initial);
        let mut marks = vec![mark()];
        let expected = match case {
            0 => {
                marks[0].type_id = "org.example.commands/unknown".into();
                "fixture.mark"
            }
            1 => {
                s.profile.reject_finalizer = true;
                "fixture.finalize"
            }
            2 => {
                s.selection_epoch = u64::MAX;
                "session.counter_exhausted"
            }
            _ => {
                s.event_limits.single_bytes = 0;
                "resource_limit_exceeded"
            }
        };
        let before = facets(&s, leaf);
        let history = s.history_summary();
        let events = s.event_status(s.key()).unwrap();
        let DispatchOutcome::Refused { error, map, work } = set_typing(&mut s, Some(marks)) else {
            panic!("typing rejection must preserve all committed state")
        };
        assert_eq!(crate::transaction::error_code(&error, |e| e), expected);
        assert_eq!(map, PositionMap::identity(s.revision()));
        assert!(work.units > 0);
        assert_eq!(facets(&s, leaf), before);
        assert_eq!(s.history_summary(), history);
        assert_eq!(s.event_status(s.key()).unwrap(), events);
        assert_eq!(s.profile.snapshot_calls.get(), 0);
    }
}

#[test]
fn explicit_typing_setter_checks_readonly_and_every_captured_context_token() {
    for case in 0..5 {
        let mut s = open("ab", false);
        let leaf = first_leaf(&s);
        let mut stamp = s.stamp();
        let expected = match case {
            0 => {
                s.state = SessionState::Open(AccessMode::ReadOnly);
                "session.read_only"
            }
            1 => {
                stamp.session = stamp.session.next_generation().unwrap();
                "session.stale_session"
            }
            2 => {
                stamp.revision += 1;
                "session.stale_revision"
            }
            3 => {
                stamp.selection_epoch += 1;
                "session.stale_selection_epoch"
            }
            _ => {
                stamp.history_epoch += 1;
                "session.stale_history_epoch"
            }
        };
        let before = facets(&s, leaf);
        let history = s.history_summary();
        let events = s.event_status(s.key()).unwrap();
        let calls = s.profile.finalizer_calls.get();
        let DispatchOutcome::Refused { error, map, .. } = s.set_typing_marks(
            stamp.session,
            stamp.revision,
            stamp.selection_epoch,
            stamp.history_epoch,
            Some(vec![mark()]),
        ) else {
            panic!("stale/readonly typing must refuse")
        };
        assert_eq!(crate::transaction::error_code(&error, |e| e), expected);
        assert_eq!(map, PositionMap::identity(s.revision()));
        assert_eq!(facets(&s, leaf), before);
        assert_eq!(s.history_summary(), history);
        assert_eq!(s.event_status(s.key()).unwrap(), events);
        assert_eq!(s.profile.finalizer_calls.get(), calls);
    }
}
