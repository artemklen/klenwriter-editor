# OSR-38: native public consumer API map

Read-only proposal,18.10.2026; not implementation/start/Ready or review verdict. OSR64 delivery/archive is owned by root; refresh its actual Done/source before38 starts. No repo/Git/Linear/config/network/test/build/install/CI actions. Paths below are repository-relative.

## Consumer boundary

Standalone `[workspace]`/own lock as `tests/fixtures/extensions-consumer`. Native crates: core/engine/kwdj/notes/registry/extensions; wire adds bridge/protocol/notes-sdk/kwdj-sdk. No main wasm crate. Current path versions0.0.0, serde_json1.0.150/uuid1.23.3; fetch this lock before offline builds. Nothing created.

## Construct actual profiles

| Public entry | Exact shape |
| --- | --- |
| KWDJ (`crates/kwdj/src/session_profile.rs:47,148`) | `KwdjProfile::new(&dyn IdentityResolver,Limits,AdmissionBudget)`; `new_owned(Rc<dyn IdentityResolver>,Limits,AdmissionBudget)->KwdjProfile<'static>`. Defaults first. |
| KWDJ registry (`:96,111`; `registry.rs:18,33`) | `with_registry_json(self,&[u8],CompilerLimits,&mut WorkMeter)->Result<Self,KwdjProfileError>` or typed with_registry_descriptor. Public registry_descriptor()/base_registration(); envelope extensions=[] and trusted mandatory base are separate. |
| Notes (`crates/notes/src/profile.rs:86,108`) | `NotesProfile::compile_json(&[u8],&[String],NotesLimits,CompilerLimits,&mut WorkMeter)->Result<Self,NotesError>`; typed compile(&RegistryDescriptor,...) also public. D0 root_blocks=[notes::PARAGRAPH.to_owned()]. Keep original examples/notes-extension/d0.json,d1.json. |
| Runtime recipes (`crates/extensions/src/lib.rs:110`) | `Recipes<P>::new(profile,&mut WorkMeter)->Result<Self,RegistryDiagnostic>`, P:CommandProvider+RegistryProfile. Public Intent<I,C>::Compiled(C) or Recipe(RecipeIntent{id,nodes:BTreeMap<String,I>,values:Attributes}). Registry verifies actual compiled catalog. |

Before moving profile, retain binding().clone() and frozen registry()/registry_handle()/limits() for expected context. No prefix-inferred ownership, fake codec or private-field access.

## Independent model and encoders

Use a pure one-paragraph text model plus directed caret/marks and saved prior/after states. Author inputs and expected bytes BEFORE execution. KWDJ prose uses schema/schema_version/profile/content; paragraph contains text nodes or canonical empty[]. Notes uses `{schema_version:1,root:document}`; root attrs require title/tags; every node explicitly has type/attrs/marks/text/children. Document/paragraph text=null; leaf children=[]; types are notes::{DOCUMENT,PARAGRAPH,TEXT}. KWDJ engine root is synthetic; notes has an authored document below that root.

Expected canonical formatting follows independently authored ADR004 literals, not observed export or production canonical_value. The initial text-only model avoids floating attrs. Keep exact numeric/duplicate raw-string fixtures for later properties. Do not trim/NFC/replace SPACE or NBSP. Sources: contracts/kwdj/v1/corpus-package.json; contracts/notes/v1/{vectors.json,expected/*,commands/vectors.json}; docs/adr/004-canonical-json-v1.md.

## Session reads, positions, context

`Session<P>::open(profile,&ProfileBinding,&[u8],AdmissionMode,AccessMode)->Result<Self,SessionError<P::Error>>` (`engine/src/session.rs:140`). Import core::profile::FrozenProfile and clone binding before moving profile. Strict/Import map to wire validate/normalize; access is Editable/ReadOnly. open_with_event_limits adds EventLimits reductions.

Public reads (`session.rs:204-296,330-403,434-485`): key/stamp/state/revision/selection_epoch/binding/dirty/saved_revision; root(key)->NodeId; node(key,id)->&tree::TreeNode; node_at(key,r,id)->NodeRead{stamp,changed_revision,stats,node}. TreeNode has parent/children/primitive/type_id/attributes/marks/text getters; synthetic root lacks authored primitive/type/attrs. selection(key) returns Option<Selection<NodeId>>, stored_marks(key) Option<&[Mark]>. None differs from Some(empty). history_summary/journal_summary/journal_entries expose epochs, units, retention and chronological maps; overlapping ownership bytes are not additive.

`events::SessionStamp{session,revision,selection_epoch,history_epoch}` captures full context. `core::positions` exports Selection{anchor,focus}, Affinity/Edge::{Before,After}, Position::Text{leaf,utf16:Utf16Offset,affinity}|Child{parent,index,affinity}|Edge{node,side}. Utf16Offset::new(usize) only wraps: validate_position(key,r,position) checks validity. Portable offsets/indices are u32. set_selection(key,r,Selection) is checked state navigation; clear None via empty Transaction+SelectionIntent::Set(None) or wire set_selection:null. IDs come from guarded reads; public token codecs do not expose unchecked constructors or a stable serial layout.

## Commands, transactions and isolated restore

`CommandRequest::new(key,r,selection_epoch,intent)` has public history_epoch/hint/limits. Set history_epoch=Some(captured.history_epoch), HistoryHint::Isolated. query_command(&request)->CommandAvailability<P::Error>; execute_command(&request)->CommandOutcome<P::Error> (`engine/src/commands.rs:25-108,247,272`). Availability includes effect, selection/stored-marks flags, WorkUsage; refusal includes stable reason/typed error/work. Both share full preparation. Query grants no later permission after facts/state change.

Actual text intent/payload pairs:

- KWDJ: kwdj::commands::KwdjIntent::<NodeId>::InsertText{text}; ID org.klenwriter.kwdj/command/insert-text, wire `{kind:"insert_text",text:"..."}` (commands/mod.rs:41,103; kwdj-sdk/src/wire.rs).
- Notes: NativeNotesIntent::InsertText{text}; constant INSERT_TEXT, ID org.example.notes/command/insert-text, wire `{text:"..."}` (notes-sdk/src/adapter.rs:48). SetTitle/SetTags also exist; no invented Notes Enter.
- Recipes<P> uses extensions::Intent::Compiled(native_intent) or Recipe. Counted wrappers must forward instance command_catalog(), not only const COMMANDS.

`Transaction::new(key,r,Vec<Operation<NodeRef>>)` exposes optional captured selection/history epochs, hint, limits and selection intent. NodeRef aliases LocalRef<NodeId>::Existing(id)|Created{operation,path}. SelectionUpdate aliases SelectionIntent::{MapCurrent,Set(Option<Selection<LocalRef<I>>>),MapFromUserResult(...)}. Set resolves final addresses; MapFromUserResult resolves after user ops and maps normalization only. dispatch(Transaction)->DispatchOutcome::{Changed(CommitEvent),Unchanged{state flags,map,work},Refused{error,map,work}}. There is NO public raw-transaction query; raw atomicity and command/history query properties are separate.

CommitEvent (`transaction.rs:207`) exposes r/context, selection/marks before+after, map/changed_nodes/journal, normalization_operations, validation stats, WorkUsage/WorkTrace and immutable notification. Public transaction::error_code(&TransactionError<E>,profile_fn) and CommandProvider::error_code avoid Debug parsing. set_typing_marks(key,r,selection_epoch,history_epoch,Option<Vec<Mark>>)->DispatchOutcome uses final typing authority (`commands.rs:128`).

HistoryRequest::new(key,r,selection_epoch,history_epoch,HistoryDirection::{Undo,Redo}) has public limits; query_history/execute_history return HistoryAvailability/HistoryOutcome (`history_dispatch.rs:18-74,239,255`). seal_history(key,r,selection_epoch,history_epoch,WorkLimits) is explicit barrier. Replay advances r and restores saved direction/marks/actual IDs. Model retention before undo-all assertions.

##13 native Operation variants

Exact public taxonomy from core/src/transaction.rs:20-83; I becomes NodeRef for Session::dispatch:

```rust
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
```

All13 reach public native dispatch and final profile validation. Node/Document prototypes are untrusted core::document values, never admission authority. BridgeRequest exposes commands/history/read/state, not generic raw dispatch. Only ReplaceText/SetAttribute/SetMarks/InsertFragment have finite recipe equivalents. KWDJ typed commands additionally reach formatting/ranges/structural/move/duplicate/remove behavior; normalizers can plan joins. Report native-all13 separately from real compiled/recipe wire coverage. Notes may allow native operations under frozen grammar despite only3 compiled commands.

Counted wrappers forward FrozenProfile GAT Cache<I>, seed_cache/admission_cache_work_limits, TransactionProfile normalize_scoped/validate_scoped and CommandProvider catalog. Default fallback otherwise changes the measured path. External Rc<Cell> counters prove ordinary codec hooks unused; cache-private bytes stay sealed.

## Facts/events/snapshots and public atomicity

Public KWDJ IdentityResolver::resolve_media/resolve_reference(&uuid::Uuid)->Result<IdentityStatus::{Exists,Missing},IdentityResolverError::Unavailable> (`kwdj/src/lib.rs:157-175`). Retain test-owned Rc+Cell/RefCell passed to new_owned; change synchronous facts between query/replay calls, holding no RefCell borrow through execution. Refused target facts preserve history for same-request retry. Notes has no KWDJ facts.

Events (`events.rs:27-195`, session.rs:248-293): minted event_status(key).head; protect_events(key,ProtectionStart::{Now,After(cursor)}); events_after(key,cursor,EventReadLimits,WorkLimits)->EventBatch(iter/through/head/work); acknowledge_events(key,protection,through); release_events. Drain/ack selection-setup events before capturing command deltas. Query/refusal/noop emits none; state events need not advance document r. Default retention differs from deliberately capped/drained recurrence.

Snapshot public methods (`session.rs:557-709`, snapshot.rs:38-98): export_snapshot(key,r)->Vec<u8>, export_snapshot_receipt(key,r)->Snapshot, receipt getters document/stamp/event_cursor/binding/trace/matches_saved_baseline; acknowledge_snapshot(&Snapshot)->SaveAcknowledgement; reconcile_saved_snapshot(&Snapshot)->bool. Old-r save at r+1 stays dirty. Export is explicit full checkpoint, outside ordinary/timed input. remount(key,&binding,input,mode,access)->SessionKey prepares admission first; failure preserves facets, success changes generation. close/poison are public lifecycle methods.

Public Facets owns guarded traversal IDs/parent/children/type/primitive/attrs/marks/text, stamp, selection/marks, dirty/saved r, history/journal summaries and event status. Compare around query/refusal; keep frozen registry/limits externally and exports explicitly separate. Real refused preparation may burn IDs for ABA, so allocator rollback is not promised. Cache-private bytes/high-water are not public observations.

## Actual SDK2 bridge and portable scenario

bridge::Distribution::new(&str,Vec<Box<dyn SessionFactory>>)->Result<Distribution,DiagnosticDto> (`distribution.rs:62`) accepts public notes_sdk::NotesFactory/kwdj_sdk::KwdjFactory. manifest() reports actual compiled offer; open(input:&[u8],options_json:&str)->DistributionSession. Import bridge::Endpoint for initialization/call_json/destroy/own_resource_counts; context() is inherent (:215-240). bridge::resource_counts() measures shared real Rust ownership.

protocol::v2::OpenOptionsV2 requires abi/build_id/profile/admission/access and original registry_json/profile_options_json strings. Notes options `{root_blocks:[...],limits:null}`; KWDJ `{identities:{media:[],references:[]},limits:null}`. Common BridgeRequest (`protocol/src/lib.rs:457`) covers state/catalog/node, command/history query+execute, selection/stored marks/barrier, snapshot/ack/reconcile/release, map_position, events/ack, remount/resources/destroy. Profile-owned kwdj_sdk::wire::SdkRequest::UpdateFacts{stamp,identities} is intercepted by its V2 endpoint (`kwdj-sdk/src/lib.rs:333`), not generic Notes.

CommandDto{id,payload_json} uses native payload pairs above. Runtime payload `{kind:"recipe",arguments:{nodes:{name:opaque_token},values:{name:AttributeDto}}}`; Number is `{kind:"number",value:"canonical decimal"}` (`bridge/src/recipes.rs`). Offsets/indices are u32; authored integer attrs retain i64/u64. Keep original raw strings for hostile duplicate/numeric spellings.

Proposed test schema, NOT SDK ABI: `{format,profile,registry_raw,input_raw,actions,expected}`. Initial actions select{logical label,text/child/edge,offset/index,affinity}, insert_text{text,history:isolated}, query_insert_text,undo/redo/barrier/snapshot/ack_snapshot/remount; facts is KWDJ-only. Prebuild pure expected text/caret/marks. Independent example: ab, caret1, insertNBSP -> aNBSPb, caret2, one r/unit/document event; undo initial thenredo after. Resolve labels by actual reads: KWDJ paragraph[0] under synthetic root; notes paragraph[0,0] under synthetic->semantic document. Fresh capture per action; stale tests retain old captures. Never persist opaque handles/cursors/tokens as expected data. native_raw remains a distinct native-only lane.

## Public patterns and sealed invariants

Reuse wasm/examples/support/history_generated.rs (prebuilt independent string model); wasm/tests/delta_equivalence.rs:383 (full/scoped1312 checkpoints); notes/tests/native_commands.rs (18 literals); notes/tests/session_transactions.rs:46 (Created caret through normalization); wasm/examples/support/history_facts.rs (facts retry). extensions/tests/runtime.rs demonstrates public recipe preparation but explicitly uses a synthetic codec, not Notes/KWDJ serialization authority.

Private-only proofs stay in existing fixtures, NO new setter: engine/src/tree.rs:2595 preview allocator; :4971,5030,5184 scalar inverse/expected-side/generation tampering; command_tests.rs:811,1043,1214,1219,1224 query allocation/phase/counters; history_tests.rs:159,169,231 revision/selection/history MAX; delta_tests.rs:465,504 event MAX/late baseline refusal. CommitMaterial/stage_replay, counter/allocator/cache fields, cursor/protection/Snapshot constructors and unpublished commit authority remain private. External consumers cannot synthesize them. Keep exact-source unit gates; prepare_tree's unadmitted draft is not committed profile-validity evidence.
