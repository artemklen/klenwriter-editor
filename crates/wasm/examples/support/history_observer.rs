// SPDX-License-Identifier: MIT OR Apache-2.0
//! Test-only real Session history witnesses; independent literals remain authority.
use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Attributes, Document, Mark};
use editor_core::positions::{Position, Selection};
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_engine::{AccessMode, NodeId, Session};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile,
    KwdjProfileError, Limits,
};
use serde_json::{Value, json};
use std::{cell::Cell, rc::Rc};
use uuid::Uuid;

#[path = "history_adr.rs"]
mod adr;
#[path = "history_facts.rs"]
mod facts;
#[path = "history_generated.rs"]
mod property;
#[path = "history_sequences.rs"]
mod sequences;
pub const PREFIX: &str = "org.klenwriter.kwdj/";
pub const LITERALS: &str = include_str!("../../../../contracts/history/v1/vectors.json");
struct Identities;
impl IdentityResolver for Identities {
    fn resolve_media(&self, _: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(IdentityStatus::Missing)
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Ok(
            if id.to_string() == "550e8400-e29b-41d4-a716-446655440006" {
                IdentityStatus::Exists
            } else {
                IdentityStatus::Missing
            },
        )
    }
}
static IDENTITIES: Identities = Identities;
#[derive(Clone, Default)]
pub struct Calls(pub Rc<Cell<[u64; 4]>>);
impl Calls {
    fn bump(&self, i: usize) {
        let mut v = self.0.get();
        v[i] += 1;
        self.0.set(v);
    }
}
pub struct Counted {
    inner: KwdjProfile<'static>,
    calls: Calls,
}
impl FrozenProfile for Counted {
    type Context = <KwdjProfile<'static> as FrozenProfile>::Context;
    type Admitted = <KwdjProfile<'static> as FrozenProfile>::Admitted;
    type Error = KwdjProfileError;
    fn binding(&self) -> &ProfileBinding {
        self.inner.binding()
    }
    fn admit_bytes(
        &self,
        b: &ProfileBinding,
        input: &[u8],
        m: AdmissionMode,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(0);
        self.inner.admit_bytes(b, input, m)
    }
    fn context(&self, a: &Self::Admitted) -> Self::Context {
        self.inner.context(a)
    }
    fn to_document(&self, a: &Self::Admitted) -> Document {
        self.calls.bump(1);
        self.inner.to_document(a)
    }
    fn admit_snapshot(
        &self,
        c: &Self::Context,
        d: &Document,
    ) -> Result<Self::Admitted, Self::Error> {
        self.calls.bump(2);
        self.inner.admit_snapshot(c, d)
    }
    fn canonical<'a>(&self, a: &'a Self::Admitted) -> &'a [u8] {
        self.calls.bump(3);
        self.inner.canonical(a)
    }
}
impl TransactionProfile for Counted {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.inner.normalize_candidate(c, v, w)
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        w: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        self.inner.validate_candidate(c, v, w)
    }
}
// HistoryProfile is provided by the production blanket CP implementation.
impl CommandProvider for Counted {
    type Intent<I: Copy + Eq + Ord> = KwdjIntent<I>;
    const COMMANDS: &'static [CommandDescriptor] =
        <KwdjProfile<'static> as CommandProvider>::COMMANDS;
    fn command_id<I: Copy + Eq + Ord>(i: &Self::Intent<I>) -> &str {
        <KwdjProfile<'static> as CommandProvider>::command_id(i)
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: CommandState<'_, V::Id>,
        i: &Self::Intent<V::Id>,
        p: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        self.inner.prepare_command(c, v, s, i, p)
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        c: &Self::Context,
        v: &V,
        s: Option<Selection<V::Id>>,
        m: Option<&[Mark]>,
        w: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        self.inner.finalize_typing_override(c, v, s, m, w)
    }
    fn error_code(e: &Self::Error) -> &'static str {
        <KwdjProfile<'static> as CommandProvider>::error_code(e)
    }
}
pub fn profile() -> KwdjProfile<'static> {
    KwdjProfile::new(&IDENTITIES, Limits::default(), AdmissionBudget::default())
}
pub fn open(v: &Value) -> (Session<Counted>, Calls) {
    let calls = Calls::default();
    let p = Counted {
        inner: profile(),
        calls: calls.clone(),
    };
    let binding = p.binding().clone();
    (
        Session::open(
            p,
            &binding,
            &serde_json::to_vec(v).unwrap(),
            AdmissionMode::Strict,
            AccessMode::Editable,
        )
        .unwrap(),
        calls,
    )
}
pub fn expected(v: &Value) -> String {
    let p = profile();
    let admitted = p
        .admit_bytes(
            p.binding(),
            &serde_json::to_vec(v).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    String::from_utf8(p.canonical(&admitted).to_vec()).unwrap()
}
pub fn fragment(v: &Value) -> Document {
    // Explicit trusted fixture boundary, prepared before edit/query instrumentation.
    let p = profile();
    let admitted = p
        .admit_bytes(
            p.binding(),
            &serde_json::to_vec(v).unwrap(),
            AdmissionMode::Import,
        )
        .unwrap();
    p.to_document(&admitted)
}
pub fn canonical(s: &Session<Counted>) -> String {
    String::from_utf8(s.export_snapshot(s.key(), s.revision()).unwrap()).unwrap()
}
pub fn at(s: &Session<Counted>, path: &[usize]) -> NodeId {
    let mut id = s.root(s.key()).unwrap();
    for index in path {
        id = s.node(s.key(), id).unwrap().children()[*index];
    }
    id
}
pub fn mark(kind: &str) -> Mark {
    Mark {
        type_id: format!("{PREFIX}{kind}"),
        attributes: Attributes::new(),
    }
}
pub fn ids(s: &Session<Counted>) -> Vec<NodeId> {
    fn walk(s: &Session<Counted>, id: NodeId, out: &mut Vec<NodeId>) {
        out.push(id);
        for child in s.node(s.key(), id).unwrap().children() {
            walk(s, *child, out);
        }
    }
    let mut out = vec![];
    walk(s, s.root(s.key()).unwrap(), &mut out);
    out.sort();
    out
}
type Record = (
    NodeId,
    Option<NodeId>,
    Vec<NodeId>,
    Option<String>,
    Option<editor_core::document::Primitive>,
    Option<String>,
    Option<Attributes>,
    Vec<Mark>,
);
#[derive(Debug, PartialEq, Eq)]
pub struct Facets {
    pub revision: u64,
    pub context: u64,
    pub history: editor_engine::history::HistorySummary,
    pub journal: editor_engine::JournalSummary,
    pub entries: Vec<editor_engine::JournalEntrySummary>,
    pub selection: Option<Selection<NodeId>>,
    pub marks: Option<Vec<Mark>>,
    pub dirty: bool,
    pub records: Vec<Record>,
}
pub fn facets(s: &Session<Counted>) -> Facets {
    let records = ids(s)
        .into_iter()
        .map(|id| {
            let n = s.node(s.key(), id).unwrap();
            (
                id,
                n.parent(),
                n.children().to_vec(),
                n.type_id().map(str::to_owned),
                n.primitive(),
                n.text().map(str::to_owned),
                n.attributes().cloned(),
                n.marks().to_vec(),
            )
        })
        .collect();
    Facets {
        revision: s.revision(),
        context: s.selection_epoch(),
        history: s.history_summary(),
        journal: s.journal_summary(),
        entries: s.journal_entries(),
        selection: s.selection(s.key()).unwrap(),
        marks: s.stored_marks(s.key()).unwrap().map(<[Mark]>::to_vec),
        dirty: s.dirty(),
        records,
    }
}
#[allow(dead_code)]
pub fn observe() -> Value {
    let generic = adr::observe();
    let kwdj = sequences::observe();
    let hp_only = adr::observe_hp_only();
    let supplements = sequences::observe_supplements();
    let lifecycle = sequences::observe_lifecycle();
    let facts = facts::observe();
    let generated = sequences::observe_generated();
    let recurrence = sequences::observe_recurrence();
    let property_generated = property::observe();
    assert_eq!(generic["status"], "passed");
    assert_eq!(kwdj["status"], "passed");
    json!({"format":"klenwriter-editor-history-observations","version":1,"status":"passed","scope":"Actual production Session with real KWDJ and compiled generic ADR profile on native/WASM; test-only transport, no public SDK or mounted event claim.","generic_adr":generic,"kwdj":kwdj,"hp_only":hp_only,"supplements":supplements,"lifecycle":lifecycle,"generated_unicode":generated,"recurrence":recurrence,"property_generated":property_generated,"identity_facts":facts,"private_engine_cases":[{"id":"H23","scope":"Separate engine private counter tests; never claimed as public native/WASM execution"}],"target_metrics":"Only portable semantics/booleans compared; raw retained/work bytes are target-local bounds."})
}

#[allow(dead_code)]
pub fn observe_literal(id: &str) -> Value {
    sequences::observe_one(id)
}
#[allow(dead_code)]
pub fn observe_adr() -> Value {
    adr::observe()
}

#[allow(dead_code)]
pub fn observe_hp_only() -> Value {
    adr::observe_hp_only()
}

#[allow(dead_code)]
pub fn observe_supplements() -> Value {
    sequences::observe_supplements()
}
#[allow(dead_code)]
pub fn observe_lifecycle() -> Value {
    sequences::observe_lifecycle()
}
#[allow(dead_code)]
pub fn observe_generated() -> Value {
    sequences::observe_generated()
}

#[allow(dead_code)]
pub fn observe_recurrence() -> Value {
    sequences::observe_recurrence()
}
