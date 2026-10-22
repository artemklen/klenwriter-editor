// SPDX-License-Identifier: MIT OR Apache-2.0
//! Source-first metric witness. Charged work is not process heap/RSS, and
//! public retained capacities are not temporary query/allocation high water.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use editor_core::document::{Attributes, Mark};
use editor_core::input::InputTextRun;
use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{WorkLimits, WorkMeter, WorkUsage};
use editor_engine::transaction::DispatchOutcome;
use editor_engine::{
    AccessMode, CommandAvailability, CommandRequest, InputCommandOutcome, InputFinalRegion,
    RawInputRestore, Session, SessionState, TextReplacementResult,
};
use editor_kwdj::commands::KwdjIntent;
use editor_kwdj::typing::{Locale, TypingLimits, TypingRules};
use serde_json::{Value, json};
use std::fs::OpenOptions;
use std::io::Write;
use std::mem::{size_of, size_of_val};

const INSERT: &str = "org.klenwriter.kwdj/command/insert-typed-text";
const BUILD: &str = "typography-source-metric-witness-v1";
// These six complete expected canonicals were independently frozen before the
// candidate. No metric result populates or rewrites an expectation.
macro_rules! canonical {
    ($case:literal, $step:literal) => {
        include_str!(concat!(
            "../../../contracts/typography/v1/native-oracles/canonical/",
            $case,
            "/",
            $step,
            ".kwdj.json"
        ))
    };
}
struct Case<'a> {
    id: &'a str,
    before: &'a str,
    after: &'a str,
    text: &'a str,
    leaf_index: usize,
    offset: usize,
    emphasis: bool,
    local: bool,
    global: bool,
    result: bool,
    raw: bool,
}
fn cases() -> [Case<'static>; 6] {
    [
        Case {
            id: "N01-ru-quote",
            before: canonical!("N01-ru-quote", "before"),
            after: canonical!("N01-ru-quote", "apply"),
            text: "\"",
            leaf_index: 0,
            offset: 2,
            emphasis: false,
            local: false,
            global: false,
            result: true,
            raw: true,
        },
        Case {
            id: "N03-dash",
            before: canonical!("N03-dash", "before"),
            after: canonical!("N03-dash", "apply"),
            text: " ",
            leaf_index: 0,
            offset: 4,
            emphasis: false,
            local: false,
            global: false,
            result: true,
            raw: true,
        },
        Case {
            id: "N06-dash-mixed-marks",
            before: canonical!("N06-dash-mixed-marks", "before"),
            after: canonical!("N06-dash-mixed-marks", "apply"),
            text: " ",
            leaf_index: 1,
            offset: 1,
            emphasis: true,
            local: false,
            global: false,
            result: true,
            raw: true,
        },
        Case {
            id: "N04-nbsp",
            before: canonical!("N04-nbsp", "before"),
            after: canonical!("N04-nbsp", "apply"),
            text: "л",
            leaf_index: 0,
            offset: 2,
            emphasis: false,
            local: false,
            global: false,
            result: true,
            raw: false,
        },
        Case {
            id: "N10-local-lexical-zero",
            before: canonical!("N10-local-lexical-zero", "before"),
            after: canonical!("N10-local-lexical-zero", "apply"),
            text: "\"",
            leaf_index: 0,
            offset: 2,
            emphasis: false,
            local: true,
            global: false,
            result: false,
            raw: false,
        },
        Case {
            id: "N09-global-work-zero",
            before: canonical!("N09-global-work-zero", "before"),
            after: canonical!("N09-global-work-zero", "apply"),
            text: "\"",
            leaf_index: 0,
            offset: 2,
            emphasis: false,
            local: false,
            global: true,
            result: false,
            raw: false,
        },
    ]
}
struct Facts;
static FACTS: Facts = Facts;
impl editor_kwdj::IdentityResolver for Facts {
    fn resolve_media(
        &self,
        _: &uuid::Uuid,
    ) -> Result<editor_kwdj::IdentityStatus, editor_kwdj::IdentityResolverError> {
        Err(editor_kwdj::IdentityResolverError::Unavailable)
    }
    fn resolve_reference(
        &self,
        _: &uuid::Uuid,
    ) -> Result<editor_kwdj::IdentityStatus, editor_kwdj::IdentityResolverError> {
        Err(editor_kwdj::IdentityResolverError::Unavailable)
    }
}
fn native_session(c: &Case, empty_features: bool) -> Session<editor_kwdj::KwdjProfile<'static>> {
    let mut limits = TypingLimits::default();
    if c.local && !empty_features {
        limits.lookbehind_scalars = 0;
    }
    let rules = TypingRules::new(Locale::Ru, empty_features.then_some(&[][..]), limits).unwrap();
    let descriptor =
        serde_json::to_vec(&editor_kwdj::registry::typing_registry_descriptor()).unwrap();
    let profile = editor_kwdj::KwdjProfile::new(&FACTS, Default::default(), Default::default())
        .with_typing_registry_json(
            rules,
            &descriptor,
            Default::default(),
            &mut WorkMeter::new(WorkLimits::default()),
        )
        .unwrap();
    let binding = profile.binding().clone();
    let mut s = Session::open(
        profile,
        &binding,
        c.before.as_bytes(),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let key = s.key();
    let root = s.root(key).unwrap();
    let block = s.node(key, root).unwrap().children()[0];
    let leaf = s.node(key, block).unwrap().children()[c.leaf_index];
    let p = Position::Text {
        leaf,
        utf16: Utf16Offset::new(c.offset),
        affinity: Affinity::After,
    };
    s.set_selection(
        key,
        0,
        Selection {
            anchor: p,
            focus: p,
        },
    )
    .unwrap();
    if c.emphasis {
        assert!(matches!(
            s.set_typing_marks(
                key,
                s.revision(),
                s.selection_epoch(),
                s.history_summary().epoch,
                Some(vec![Mark {
                    type_id: "org.klenwriter.kwdj/emphasis".into(),
                    attributes: Attributes::new()
                }])
            ),
            DispatchOutcome::Unchanged { .. }
        ));
    }
    s
}
fn request(
    c: &Case,
    s: &Session<editor_kwdj::KwdjProfile<'_>>,
) -> CommandRequest<KwdjIntent<editor_engine::NodeId>> {
    let mut r = CommandRequest::new(
        s.key(),
        s.revision(),
        s.selection_epoch(),
        KwdjIntent::InsertTypedText {
            text: c.text.into(),
            origin: editor_core::input::InputOrigin::OrdinaryInsertText,
        },
    );
    r.history_epoch = Some(s.history_summary().epoch);
    if c.global {
        r.limits.work = WorkLimits { units: 0, bytes: 0 };
    }
    r
}
fn work(w: WorkUsage) -> Value {
    json!({"chargedUnits":w.units,"chargedWorkBytes":w.bytes})
}
fn within_work(w: WorkUsage, limit: WorkLimits, positive: bool) {
    assert!(w.units <= limit.units && w.bytes <= limit.bytes);
    if positive {
        assert!(w.units > 0 && w.bytes > 0);
    }
}
// All six authored fixtures have empty node/mark attribute maps. Empty BTreeMap
// owns no nodes. For these cases public Vec/String capacities therefore expose
// the complete reachable capacity, excluding allocator bookkeeping/alignment.
fn attrs_empty(a: &Attributes) {
    assert!(
        a.is_empty(),
        "Metric fixture must not imply a public BTreeMap capacity API"
    );
}
fn marks_heap(m: &Vec<Mark>) -> usize {
    m.capacity() * size_of::<Mark>()
        + m.iter()
            .map(|m| {
                attrs_empty(&m.attributes);
                m.type_id.capacity()
            })
            .sum::<usize>()
}
fn optional_marks_heap(m: &Option<Vec<Mark>>) -> usize {
    m.as_ref().map_or(0, marks_heap)
}
fn region_heap(r: &InputFinalRegion) -> usize {
    r.spans.capacity() * size_of::<editor_engine::InputTextSpan>()
        + r.spans
            .iter()
            .map(|s| {
                attrs_empty(&s.attributes);
                s.type_id.capacity() + s.text.capacity() + marks_heap(&s.marks)
            })
            .sum::<usize>()
}
fn run_heap(r: &InputTextRun) -> usize {
    attrs_empty(&r.attributes);
    r.type_id.capacity() + r.text.capacity() + marks_heap(&r.marks)
}
fn raw_heap(r: &RawInputRestore) -> usize {
    optional_marks_heap(&r.stored_marks)
        + optional_marks_heap(&r.raw_stored_marks)
        + region_heap(&r.cooked)
        + r.raw.capacity() * size_of::<InputTextRun>()
        + r.raw.iter().map(run_heap).sum::<usize>()
}
fn result_metrics(r: &TextReplacementResult) -> Value {
    let capacity = size_of_val(r)
        + r.original.text.capacity()
        + region_heap(&r.after)
        + optional_marks_heap(&r.after_stored_marks)
        + r.raw_restore.as_ref().map_or(0, raw_heap);
    assert!(capacity <= 16384);
    let cooked_bytes = r.after.spans.iter().map(|s| s.text.len()).sum::<usize>();
    assert!(cooked_bytes <= 12 && r.after.spans.len() <= 12);
    let raw=r.raw_restore.as_ref().map(|raw|{
        let bytes=raw.raw.iter().map(|r|r.text.len()).sum::<usize>();assert!(bytes<=12 && raw.raw.len()<=12);
        json!({"rawUtf8Bytes":bytes,"rawRuns":raw.raw.len(),"inlinePlusOwnedCapacityBytes":size_of_val(raw)+raw_heap(raw)})
    });
    json!({"inlinePlusOwnedCapacityBytes":capacity,"cookedUtf8Bytes":cooked_bytes,"finalSpans":r.after.spans.len(),"rawRestore":raw})
}
fn native(c: &Case, empty_features: bool) -> (Value, WorkUsage) {
    let mut s = native_session(c, empty_features);
    let key = s.key();
    let before = s.stamp();
    let history = s.history_summary();
    let selection = s.selection(key).unwrap();
    let marks = s.stored_marks(key).unwrap().map(<[Mark]>::to_vec);
    let dirty = s.dirty();
    let r = request(c, &s);
    let query = s.query_input_command(&r);
    let query_work = match query {
        CommandAvailability::Available { work, .. } => {
            assert!(!c.global);
            work
        }
        CommandAvailability::Unavailable { work, .. } => {
            assert!(c.global);
            work
        }
    };
    within_work(query_work, r.limits.work, !c.global);
    assert_eq!(s.stamp(), before);
    assert_eq!(s.history_summary(), history);
    assert_eq!(s.selection(key).unwrap(), selection);
    assert_eq!(s.stored_marks(key).unwrap(), marks.as_deref());
    assert_eq!(s.dirty(), dirty);
    assert_eq!(s.export_snapshot(key, 0).unwrap(), c.before.as_bytes());
    let (execution_work, metrics, status) = match s.execute_input_command(&r) {
        InputCommandOutcome::Completed {
            outcome: DispatchOutcome::Changed(event),
            result,
            ..
        } => {
            assert!(!c.global);
            assert_eq!(result.is_some(), c.result && !empty_features);
            assert_eq!(s.revision(), before.revision + 1);
            assert_eq!(s.history_summary().undo_units, 1);
            let metrics = result.as_ref().map(|result| {
                assert_eq!(result.raw_restore.is_some(), c.raw);
                assert_eq!(result.before_stamp, before);
                assert_eq!(result.after_stamp, s.stamp());
                result_metrics(result)
            });
            (event.work, metrics, "changed")
        }
        InputCommandOutcome::Refused { work, .. } => {
            assert!(c.global);
            assert_eq!(s.stamp(), before);
            assert_eq!(s.history_summary(), history);
            assert_eq!(s.selection(key).unwrap(), selection);
            assert_eq!(s.stored_marks(key).unwrap(), marks.as_deref());
            assert_eq!(s.dirty(), dirty);
            (work, None, "refused")
        }
        other => panic!("unexpected metric outcome {other:?}"),
    };
    within_work(execution_work, r.limits.work, !c.global);
    assert_eq!(
        s.export_snapshot(key, s.revision()).unwrap(),
        c.after.as_bytes()
    );
    s.close(key).unwrap();
    assert_eq!(s.state(), SessionState::Closed);
    (
        json!({"id":c.id,"emptyFeatureControl":empty_features,"query":work(query_work),"execution":work(execution_work),"status":status,"result":metrics,"queryPure":true,"exactFrozenCanonical":true,"nativeSessionClosed":true}),
        execution_work,
    )
}

fn call(s: &mut DistributionSession, r: Value) -> Value {
    serde_json::from_str(&s.call_json(&r.to_string())).unwrap()
}
fn ok(r: Value) -> Value {
    assert_eq!(r["status"], "ok", "{r}");
    r["value"].clone()
}
fn state(s: &mut DistributionSession) -> Value {
    ok(call(s, json!({"kind":"state"})))["state"].clone()
}
fn bridge(c: &Case) -> Value {
    assert!(!c.global, "No public work-limit field is invented for ABI2");
    let descriptor = editor_kwdj::registry::typing_registry_descriptor();
    let mut profile =
        serde_json::to_value(&klenwriter_editor_kwdj_sdk::manifest().profiles[0]).unwrap();
    profile["extensions"] = serde_json::to_value(&descriptor.selected_extensions).unwrap();
    let options = json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":profile,"admission":"validate","access":"editable","registry_json":serde_json::to_string(&descriptor).unwrap(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null,"typing_rules":{"version":1,"locale":"ru","rules":null,"limits":if c.local{json!({"lookbehind_scalars":0})}else{Value::Null}}}).to_string()});
    let distribution = Distribution::new(
        BUILD,
        vec![Box::new(klenwriter_editor_kwdj_sdk::KwdjFactory)],
    )
    .unwrap();
    let mut s = distribution.open(c.before.as_bytes(), &options.to_string());
    assert!(matches!(
        s.initialization(),
        editor_protocol::SdkResponse::Ok { .. }
    ));
    let stamp = state(&mut s)["stamp"].clone();
    let root = state(&mut s)["root"].clone();
    let b = ok(call(
        &mut s,
        json!({"kind":"node","stamp":stamp,"node":root}),
    ))["node"]["children"][0]
        .clone();
    let stamp = state(&mut s)["stamp"].clone();
    let t = ok(call(&mut s, json!({"kind":"node","stamp":stamp,"node":b})))["node"]["children"]
        [c.leaf_index]
        .clone();
    let p = json!({"kind":"text","node":t,"offset":c.offset,"affinity":"after"});
    let stamp = state(&mut s)["stamp"].clone();
    ok(call(
        &mut s,
        json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":p,"focus":p}}),
    ));
    if c.emphasis {
        let stamp = state(&mut s)["stamp"].clone();
        ok(call(
            &mut s,
            json!({"kind":"set_stored_marks","stamp":stamp,"marks":[{"type_id":"org.klenwriter.kwdj/emphasis","attributes":{}}]}),
        ));
    }
    let before = state(&mut s);
    let stamp = before["stamp"].clone();
    let command = json!({"id":INSERT,"payload_json":json!({"kind":"insert_typed_text","text":c.text,"origin":"ordinary_insert_text"}).to_string()});
    let availability = ok(call(
        &mut s,
        json!({"kind":"query_input_command","stamp":stamp,"command":command}),
    ));
    assert_eq!(availability["available"], true);
    assert_eq!(state(&mut s), before);
    let value = ok(call(
        &mut s,
        json!({"kind":"input_command","stamp":stamp,"command":command}),
    ));
    assert_eq!(value["effect"], "changed");
    assert_eq!(!value["result"].is_null(), c.result);
    let (result_bytes, raw_bytes) = if c.result {
        let result = serde_json::to_vec(&value["result"]).unwrap();
        assert!(result.len() <= 16384);
        let raw = &value["result"]["raw_restore"];
        assert_eq!(!raw.is_null(), c.raw);
        let raw_bytes = if raw.is_null() {
            None
        } else {
            let b = serde_json::to_vec(raw).unwrap();
            assert!(b.len() <= 4096);
            Some(b.len())
        };
        (Some(result.len()), raw_bytes)
    } else {
        (None, None)
    };
    let stamp = state(&mut s)["stamp"].clone();
    let snap = ok(call(
        &mut s,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":16384}),
    ));
    assert_eq!(snap["canonical_json"], c.after);
    ok(call(
        &mut s,
        json!({"kind":"release_snapshot","handle":snap["handle"]}),
    ));
    let counts = s.own_resource_counts();
    assert_eq!(
        (
            counts.sessions,
            counts.snapshot_handles,
            counts.snapshot_bytes.as_str(),
            counts.protected_cursors
        ),
        (1, 0, "0", 1)
    );
    s.destroy();
    assert_eq!(
        s.own_resource_counts(),
        editor_protocol::ResourceCountsDto {
            sessions: 0,
            snapshot_handles: 0,
            snapshot_bytes: "0".into(),
            protected_cursors: 0
        }
    );
    json!({"id":c.id,"serializedResultUtf8Bytes":result_bytes,"serializedRawRestoreUtf8Bytes":raw_bytes,"actualBridgeReply":true,"queryPure":true,"exactFrozenCanonical":true,"resourcesAfterDestroy":{"sessions":0,"snapshot_handles":0,"snapshot_bytes":"0","protected_cursors":0}})
}

#[test]
fn frozen_native_work_and_owned_result_metrics() {
    let cases = cases();
    let mut native_rows = Vec::new();
    let mut wire_rows = Vec::new();
    let mut local_control = None;
    for c in &cases {
        let (row, spent) = native(c, false);
        native_rows.push(row);
        if c.local {
            let (control, control_spent) = native(c, true);
            assert!(
                spent.units > control_spent.units && spent.bytes > control_spent.bytes,
                "Attempted optional work must remain charged before the one literal plan"
            );
            local_control = Some(
                json!({"literalControl":control,"actualFallbackChargedWork":work(spent),"spentWorkNotReset":true}),
            );
        }
        if !c.global {
            wire_rows.push(bridge(c));
        }
    }
    let matrix: Value = serde_json::from_str(include_str!(
        "../../../contracts/typography/v1/golden-matrix.json"
    ))
    .unwrap();
    let scalar_cases: Vec<_> = matrix["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["group"] == "PURE_LEXICAL_CLASS")
        .collect();
    assert_eq!(scalar_cases.len(), 31);
    assert_eq!(
        scalar_cases
            .iter()
            .filter(|row| row["expectedWhitespace"] == true)
            .count(),
        25
    );
    let mut dash_rows = Vec::new();
    for row in scalar_cases {
        let scalar =
            char::from_u32(u32::from_str_radix(row["codepointHex"].as_str().unwrap(), 16).unwrap())
                .unwrap();
        let trigger = scalar.to_string();
        let initial = format!("X{scalar}--");
        let admitted = row["expectedWhitespace"].as_bool().unwrap();
        // This oracle is derived only from the independently frozen class,
        // before observing either native result. CR/FEFF stay exact scalars.
        let expected = if admitted {
            format!("X{scalar}—{scalar}")
        } else {
            format!("X{scalar}--{scalar}")
        };
        let document = |text: &str| {
            serde_json::to_string(&json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":text}]}]})).unwrap()
        };
        let before = document(&initial);
        let after = document(&expected);
        let c = Case {
            id: row["id"].as_str().unwrap(),
            before: &before,
            after: &after,
            text: &trigger,
            leaf_index: 0,
            offset: initial.encode_utf16().count(),
            emphasis: false,
            local: false,
            global: false,
            result: admitted,
            raw: admitted,
        };
        let (observed, _) = native(&c, false);
        dash_rows.push(observed);
        wire_rows.push(bridge(&c));
    }
    let largest_capacity = native_rows
        .iter()
        .chain(dash_rows.iter())
        .filter_map(|r| r["result"]["inlinePlusOwnedCapacityBytes"].as_u64())
        .max();
    let largest_result = wire_rows
        .iter()
        .filter_map(|r| r["serializedResultUtf8Bytes"].as_u64())
        .max();
    let largest_raw = wire_rows
        .iter()
        .filter_map(|r| r["serializedRawRestoreUtf8Bytes"].as_u64())
        .max();
    let report = json!({"format":"osr48-native-work-capacity-metrics/1","status":"passed","nativeCases":native_rows,"frozenDashClassCases":dash_rows,"bridgeCases":wire_rows,"localFallbackComparison":local_control,"observedMaximaAmongAuthoredCases":{"resultInlinePlusOwnedCapacityBytes":largest_capacity,"serializedResultUtf8Bytes":largest_result,"serializedRawRestoreUtf8Bytes":largest_raw},"sourceBounds":{"resultSerializedUtf8Bytes":16384,"resultInlinePlusOwnedCapacityBytes":16384,"rawRestoreSerializedUtf8Bytes":4096,"rawCookedUtf8BytesEach":12},"qualifications":{"chargedWorkIsNotHeapOrRss":true,"publicCapacityIsRetainedNotTemporaryHighWater":true,"allAttributeMapsEmptyForCapacityMeasurement":true,"allocatorBookkeepingNotMeasured":true,"queryPreparationAndAdmissionAndVerificationAreSeparate":true,"globalZeroOnlyDirectSession":true,"old69AssertionsUnchanged":true,"noBrowserOrInstalledInput":true}});
    let bytes = serde_json::to_vec_pretty(&report).unwrap();
    if let Some(path) = std::env::var_os("OSR48_NATIVE_METRICS_OUTPUT") {
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(path)
            .unwrap();
        file.write_all(&bytes).unwrap();
        file.write_all(b"\n").unwrap();
        file.sync_all().unwrap();
    }
    println!(
        "OSR48_NATIVE_METRICS {}",
        serde_json::to_string(&report).unwrap()
    );
}
