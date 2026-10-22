// SPDX-License-Identifier: MIT OR Apache-2.0
//! Independent frozen-data witness. No production result constructs an expectation.
use crate::kwdj_sdk;
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use serde_json::{Value, json};
use std::collections::{BTreeMap, BTreeSet};

const BUILD: &str = "typography-source-oracles-v1";
const INSERT: &str = "org.klenwriter.kwdj/command/insert-typed-text";
const RESTORE: &str = "org.klenwriter.kwdj/command/restore-typed-text";
const NATIVE: &str = include_str!("../../../../contracts/typography/v1/native-oracles.json");
const MATRIX: &str = include_str!("../../../../contracts/typography/v1/golden-matrix.json");
const CMS: &str = include_str!("../../../../contracts/typography/v1/source-cms-inventory.json");
const ADDITIONAL: &str = include_str!("typography_additional_oracles.json");

fn canonical_literal(path: &str) -> &'static str {
    CANONICAL
        .iter()
        .find(|(p, _)| *p == path)
        .unwrap_or_else(|| panic!("undeclared canonical {path}"))
        .1
}
fn parse(s: &str) -> Value {
    serde_json::from_str(s).expect("closed authored JSON")
}
fn cfg(locale: &str) -> Value {
    json!({"version":1,"locale":locale,"rules":null,"limits":null})
}
fn call(s: &mut DistributionSession, r: Value) -> Value {
    parse(&s.call_json(&r.to_string()))
}
fn ok(r: Value) -> Value {
    assert_eq!(r["status"], "ok", "{r}");
    r["value"].clone()
}
fn state(s: &mut DistributionSession) -> Value {
    ok(call(s, json!({"kind":"state"})))["state"].clone()
}
fn stamp(s: &mut DistributionSession) -> Value {
    state(s)["stamp"].clone()
}
fn node(s: &mut DistributionSession, id: &Value) -> Value {
    let t = stamp(s);
    ok(call(s, json!({"kind":"node","stamp":t,"node":id})))["node"].clone()
}
fn role(s: &mut DistributionSession, path: &str) -> Value {
    let indices: Vec<usize> = path
        .split('/')
        .filter(|v| !v.is_empty() && *v != "content")
        .map(|v| v.parse().expect("authored node path"))
        .collect();
    let mut id = state(s)["root"].clone();
    for i in indices {
        id = node(s, &id)["children"][i].clone();
        assert!(id.is_string(), "missing role {path}");
    }
    id
}
fn point(id: Value, offset: usize) -> Value {
    json!({"kind":"text","node":id,"offset":offset,"affinity":"after"})
}
fn select(s: &mut DistributionSession, a: Value, b: Value) {
    let t = stamp(s);
    ok(call(
        s,
        json!({"kind":"set_selection","stamp":t,"selection":{"anchor":a,"focus":b}}),
    ));
}
fn attr(v: &Value) -> Value {
    match v {
        Value::Null => json!({"kind":"null"}),
        Value::Bool(x) => json!({"kind":"boolean","value":x}),
        Value::String(x) => json!({"kind":"string","value":x}),
        Value::Number(x) => json!({"kind":"number","value":x.to_string()}),
        Value::Array(xs) => json!({"kind":"list","value":xs.iter().map(attr).collect::<Vec<_>>()}),
        Value::Object(xs) => {
            json!({"kind":"object","value":xs.iter().map(|(k,v)|(k.clone(),attr(v))).collect::<BTreeMap<_,_>>()})
        }
    }
}
fn marks(v: &Value) -> Value {
    if v.is_null() {
        return Value::Null;
    }
    Value::Array(v.as_array().unwrap().iter().map(|m|{let attrs=m.get("attrs").and_then(Value::as_object).map(|a|a.iter().map(|(k,v)|(k.clone(),attr(v))).collect::<BTreeMap<_,_>>()).unwrap_or_default();json!({"type_id":format!("org.klenwriter.kwdj/{}",m["type"].as_str().unwrap()),"attributes":attrs})}).collect())
}
fn stored(s: &mut DistributionSession, m: &Value) {
    if m.is_null() {
        return;
    }
    let t = stamp(s);
    ok(call(
        s,
        json!({"kind":"set_stored_marks","stamp":t,"marks":marks(m)}),
    ));
}
fn open_raw(source: &str, typing: Value, identities: Value) -> DistributionSession {
    let descriptor = if typing.is_null() {
        editor_kwdj::registry::registry_descriptor()
    } else {
        editor_kwdj::registry::typing_registry_descriptor()
    };
    let mut profile = serde_json::to_value(&kwdj_sdk::manifest().profiles[0]).unwrap();
    profile["extensions"] = serde_json::to_value(&descriptor.selected_extensions).unwrap();
    let options = json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":profile,"admission":"validate","access":"editable","registry_json":serde_json::to_string(&descriptor).unwrap(),"profile_options_json":json!({"identities":identities,"limits":null,"typing_rules":typing}).to_string()});
    let distribution = Distribution::new(BUILD, vec![Box::new(kwdj_sdk::KwdjFactory)]).unwrap();
    distribution.open(source.as_bytes(), &options.to_string())
}
fn open(source: &str, typing: Value) -> DistributionSession {
    let s = open_raw(source, typing, json!({"media":[],"references":[]}));
    assert!(
        matches!(s.initialization(), editor_protocol::SdkResponse::Ok { .. }),
        "open {:?}",
        s.initialization()
    );
    s
}
fn snapshot(s: &mut DistributionSession) -> String {
    let t = stamp(s);
    let v = ok(call(
        s,
        json!({"kind":"snapshot","stamp":t,"max_bytes":2097152}),
    ));
    let text = v["canonical_json"].as_str().unwrap().to_owned();
    ok(call(
        s,
        json!({"kind":"release_snapshot","handle":v["handle"]}),
    ));
    text
}
fn clean(s: &mut DistributionSession) {
    let r = s.own_resource_counts();
    assert_eq!(r.sessions, 1);
    assert_eq!(r.snapshot_handles, 0);
    assert_eq!(r.snapshot_bytes, "0");
    // DistributionSession owns one event-protection cursor until destroy.
    assert_eq!(r.protected_cursors, 1);
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
}
fn command(s: &mut DistributionSession, text: &str, origin: &str) -> Value {
    let t = stamp(s);
    call(
        s,
        json!({"kind":"input_command","stamp":t,"command":{"id":INSERT,"payload_json":json!({"kind":"insert_typed_text","text":text,"origin":origin}).to_string()}}),
    )
}
fn literal(s: &mut DistributionSession, text: &str) -> Value {
    let t = stamp(s);
    call(
        s,
        json!({"kind":"command","stamp":t,"command":{"id":"org.klenwriter.kwdj/command/insert-text","payload_json":json!({"kind":"insert_text","text":text}).to_string()},"history_hint":{"kind":"isolated"}}),
    )
}
fn restore(s: &mut DistributionSession, descriptor: &Value) -> Value {
    let t = stamp(s);
    call(
        s,
        json!({"kind":"input_command","stamp":t,"command":{"id":RESTORE,"payload_json":json!({"kind":"restore_typed_text","restore":descriptor}).to_string()}}),
    )
}
fn history(s: &mut DistributionSession, direction: &str) -> Value {
    let t = stamp(s);
    call(s, json!({"kind":"history","stamp":t,"direction":direction}))
}
fn raw_restore(response: &Value) -> Value {
    let result = &response["value"]["result"];
    assert_eq!(result["kind"], "text_replacement", "{response}");
    let r = result["raw_restore"].clone();
    assert!(r.is_object(), "missing raw restoration {response}");
    r
}
fn basic(text: &str) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":if text.is_empty(){json!([])}else{json!([{"type":"text","text":text}])}}]})
}
fn caret_end(s: &mut DistributionSession) {
    let root = state(s)["root"].clone();
    let block = node(s, &root)["children"][0].clone();
    let ns = node(s, &block)["children"].as_array().unwrap().clone();
    if let Some(id) = ns.last() {
        let n = node(s, id);
        let len = n["text"].as_str().map(|s| s.encode_utf16().count());
        let p = if let Some(n) = len {
            point(id.clone(), n)
        } else {
            json!({"kind":"child","parent":block,"index":ns.len(),"affinity":"after"})
        };
        select(s, p.clone(), p);
    } else {
        let p = json!({"kind":"child","parent":block,"index":0,"affinity":"after"});
        select(s, p.clone(), p);
    }
}
fn type_scalars(s: &mut DistributionSession, text: &str) -> Value {
    let mut r = Value::Null;
    for ch in text.chars() {
        r = command(s, &ch.to_string(), "ordinary_insert_text");
        ok(r.clone());
    }
    r
}
fn all_text(v: &Value) -> String {
    if v["type"] == "text" {
        return v["text"].as_str().unwrap().to_owned();
    }
    v.get("content")
        .and_then(Value::as_array)
        .map(|xs| xs.iter().map(all_text).collect())
        .unwrap_or_default()
}

struct Bindings {
    ids: BTreeMap<String, Value>,
    original: BTreeSet<String>,
}
impl Bindings {
    fn bind(s: &mut DistributionSession, map: &Value) -> Self {
        let mut ids = BTreeMap::new();
        let mut original = BTreeSet::new();
        for (path, name) in map.as_object().unwrap() {
            let id = role(s, path);
            assert!(original.insert(id.as_str().unwrap().to_owned()));
            ids.insert(name.as_str().unwrap().into(), id);
        }
        Self { ids, original }
    }
    fn check_roles(&mut self, s: &mut DistributionSession, map: &Value) {
        let mut current = BTreeSet::new();
        for (path, name) in map.as_object().unwrap() {
            let name = name.as_str().unwrap();
            let actual = role(s, path);
            assert!(current.insert(actual.as_str().unwrap().to_owned()));
            if let Some(old) = self.ids.get(name) {
                assert_eq!(actual, *old, "role {name}@{path}");
            } else {
                assert!(
                    !self.original.contains(actual.as_str().unwrap()),
                    "fresh alias reused original {name}"
                );
                assert!(
                    !self.ids.values().any(|id| *id == actual),
                    "aliases share identity"
                );
                self.ids.insert(name.into(), actual);
            }
        }
    }
    fn position(&self, p: &Value) -> Value {
        match p["kind"].as_str().unwrap() {
            "text" => {
                json!({"kind":"text","node":self.ids[p["leaf"].as_str().unwrap()],"offset":p["utf16"],"affinity":p["affinity"]})
            }
            "edge" => {
                json!({"kind":"edge","node":self.ids[p["node"].as_str().unwrap()],"side":if p["side"]=="start"{"before"}else{"after"}})
            }
            _ => panic!("unsupported authored point {p}"),
        }
    }
    fn selection(&self, v: &Value) -> Value {
        json!({"anchor":self.position(&v["anchor"]),"focus":self.position(&v["focus"])})
    }
}
fn epoch(expr: &Value, base: u64, prefix: &str) -> u64 {
    let text = expr.as_str().unwrap();
    if text == prefix {
        return base;
    }
    base + text
        .strip_prefix(&format!("{prefix}+"))
        .unwrap()
        .parse::<u64>()
        .unwrap()
}
fn check_checkpoint(
    s: &mut DistributionSession,
    case: &str,
    cp: &Value,
    ids: &mut Bindings,
    base: &Value,
) {
    assert_eq!(
        snapshot(s),
        canonical_literal(cp["canonical"]["path"].as_str().unwrap()),
        "{case}/{} canonical bytes",
        cp["label"]
    );
    let e = &cp["state"];
    ids.check_roles(s, &e["liveIds"]);
    let a = state(s);
    assert_eq!(a["stamp"]["session"], base["stamp"]["session"]);
    assert_eq!(a["stamp"]["generation"], base["stamp"]["generation"]);
    assert_eq!(
        a["stamp"]["revision"]
            .as_str()
            .unwrap()
            .parse::<u64>()
            .unwrap(),
        e["revision"].as_u64().unwrap(),
        "{case} revision"
    );
    for (key, prefix) in [("selection_epoch", "E0"), ("history_epoch", "H0")] {
        let key_e = if key == "selection_epoch" {
            "selectionEpoch"
        } else {
            "historyEpoch"
        };
        assert_eq!(
            a["stamp"][key].as_str().unwrap().parse::<u64>().unwrap(),
            epoch(
                &e[key_e],
                base["stamp"][key].as_str().unwrap().parse().unwrap(),
                prefix
            ),
            "{case} {key}/{}",
            cp["label"]
        );
    }
    assert_eq!(
        a["selection"],
        ids.selection(&e["selection"]),
        "{case} directed caret/{}",
        cp["label"]
    );
    assert_eq!(a["stored_marks"], marks(&e["storedMarks"]), "{case} marks");
    assert_eq!(a["dirty"], e["dirty"], "{case} dirty");
    for (key, expected) in [("undo_entries", "undoUnits"), ("redo_entries", "redoUnits")] {
        assert_eq!(
            a["history"][key].as_str().unwrap().parse::<u64>().unwrap(),
            e[expected].as_u64().unwrap(),
            "{case} {key}"
        );
    }
}
fn check_maps(s: &mut DistributionSession, case: &Value, ids: &Bindings, from: u64) {
    let expected = &case["expectedMap"];
    let empty = Vec::new();
    let mut probes = expected["probeCases"].as_array().unwrap_or(&empty).clone();
    if let Some(p) = expected.get("unrelatedProbe") {
        probes.push(p.clone());
    }
    for p in probes {
        let t = stamp(s);
        let r = ok(call(
            s,
            json!({"kind":"map_position","stamp":t,"from_revision":from.to_string(),"position":ids.position(&p["from"])}),
        ));
        assert_eq!(r["kind"], "mapped");
        assert_eq!(r["status"], "mapped", "{r}");
        assert_eq!(r["deleted"], false);
        assert_eq!(r["position"], ids.position(&p["expect"]["position"]));
    }
}
fn document_events(s: &mut DistributionSession) -> usize {
    let r = ok(call(s, json!({"kind":"events"})));
    assert_eq!(r["gap"], false);
    r["events"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|e| e["change"]["kind"] == "document")
        .count()
}

fn run_native_oracle(case: &Value) -> Value {
    let id = case["id"].as_str().unwrap();
    if id == "N09-global-work-zero" {
        return direct_global_zero(case);
    }
    let cps = case["checkpoints"].as_array().unwrap();
    let first = &cps[0];
    let before_map = case["bindBeforeIds"]
        .get("bindings")
        .unwrap_or(&case["bindBeforeIds"]);
    let locale = case.get("locale").and_then(Value::as_str).unwrap_or("ru");
    let mut config = cfg(locale);
    if id == "N10-local-lexical-zero" {
        config["limits"] = json!({"lookbehind_scalars":0});
    }
    let mut s = open(
        canonical_literal(first["canonical"]["path"].as_str().unwrap()),
        config,
    );
    let mut ids = Bindings::bind(&mut s, before_map);
    let selection = ids.selection(&first["state"]["selection"]);
    select(
        &mut s,
        selection["anchor"].clone(),
        selection["focus"].clone(),
    );
    stored(&mut s, &first["state"]["storedMarks"]);
    let base = state(&mut s);
    check_checkpoint(&mut s, id, first, &mut ids, &base);
    let mut publications = 0usize;
    let mut restore_descriptor = Value::Null;
    for cp in &cps[1..] {
        let label = cp["label"].as_str().unwrap();
        let before = state(&mut s);
        let response = match label {
            "apply" | "rule" => {
                let text = if id == "N15-backspace-quote" {
                    "\""
                } else if id == "N16-backspace-dash" {
                    " "
                } else {
                    case["intent"]
                        .get("text")
                        .or_else(|| case["intent"].get("replacement"))
                        .unwrap()
                        .as_str()
                        .unwrap()
                };
                let origin = if id == "N11-T15-owned-final" {
                    "composition_commit"
                } else {
                    "ordinary_insert_text"
                };
                if id == "N14-replacement-literal" {
                    literal(&mut s, text)
                } else {
                    let t = stamp(&mut s);
                    let q = call(
                        &mut s,
                        json!({"kind":"query_input_command","stamp":t,"command":{"id":INSERT,"payload_json":json!({"kind":"insert_typed_text","text":text,"origin":origin}).to_string()}}),
                    );
                    assert_eq!(q["status"], "ok", "query {id}: {q}");
                    assert_eq!(
                        q["value"]["available"],
                        cp["outcome"] != "Refused",
                        "query availability {id}"
                    );
                    assert!(
                        q["value"].get("result").is_none(),
                        "query must not mint result"
                    );
                    assert_eq!(state(&mut s), before, "query changed {id}");
                    command(&mut s, text, origin)
                }
            }
            "raw-reversal" => restore(&mut s, &restore_descriptor),
            "undo" | "undo-reversal" | "undo-rule" => history(&mut s, "undo"),
            "redo" | "redo-rule" | "redo-reversal" => history(&mut s, "redo"),
            _ => panic!("unknown authored checkpoint {label}"),
        };
        if cp["outcome"] == "Refused" {
            assert_eq!(response["status"], "refused", "{id}: {response}");
            assert_eq!(state(&mut s), before, "refusal mutated {id}");
        } else {
            let value = ok(response.clone());
            assert_eq!(value["effect"], "changed", "{id}/{label}: {response}");
            publications += 1;
            if label == "rule" {
                restore_descriptor = raw_restore(&response);
            }
            if label == "apply" && case["checkpoints"][1]["rule"].is_string() {
                assert_eq!(value["kind"], "input_mutation");
                assert_eq!(value["result"]["kind"], "text_replacement");
                assert_eq!(value["result"]["original"]["selection"], base["selection"]);
                assert_eq!(value["result"]["before_stamp"], base["stamp"]);
                assert_eq!(value["result"]["after_stamp"], value["state"]["stamp"]);
            }
            if matches!(label, "raw-reversal" | "redo-reversal")
                && value["kind"] == "input_mutation"
            {
                assert_eq!(value["result"], Value::Null);
            }
        }
        check_checkpoint(&mut s, id, cp, &mut ids, &base);
        if response["status"] == "ok" {
            check_maps(
                &mut s,
                case,
                &ids,
                before["stamp"]["revision"]
                    .as_str()
                    .unwrap()
                    .parse()
                    .unwrap(),
            );
        }
        assert_eq!(
            document_events(&mut s),
            publications,
            "{id} document publications"
        );
    }
    clean(&mut s);
    json!({"id":id,"checkpoints":cps.len(),"document_publications":publications,"fixed_canonical":true,"identity_state_history_maps":true,"resources_zero":true})
}

fn run_cms_fixture(f: &Value) -> Value {
    let id = f["id"].as_str().unwrap();
    if id == "CMS-T14" {
        for a in f["actions"].as_array().unwrap() {
            let mut s = open(&basic(a["before"].as_str().unwrap()).to_string(), cfg("ru"));
            caret_end(&mut s);
            let r = command(&mut s, a["input"].as_str().unwrap(), "ordinary_insert_text");
            assert_eq!(ok(r)["result"], Value::Null);
            assert_eq!(
                all_text(&parse(&snapshot(&mut s))),
                a["expected"].as_str().unwrap()
            );
            clean(&mut s);
        }
        return json!({"id":id,"variants":4,"source_literal_assertions":true});
    }
    let source = match id {
        "CMS-T09" => {
            json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"code_block","content":[{"type":"text","text":"x"}]}]})
        }
        "CMS-T12" => {
            json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"а"},{"type":"hard_break"}]}]})
        }
        "CMS-T15" => basic("а "),
        "CMS-T16" => basic(f["setup"]["paragraphText"].as_str().unwrap()),
        "CMS-T17" => {
            json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"а "},{"type":"text","text":"xy","marks":[{"type":"code"}]}]}]})
        }
        _ => basic(""),
    };
    let mut s = open(&source.to_string(), cfg("ru"));
    caret_end(&mut s);
    if id == "CMS-T10" || id == "CMS-T11" {
        stored(
            &mut s,
            &json!([{"type":if id=="CMS-T10"{"code"}else{"strong"}}]),
        );
    }
    if id == "CMS-T16" {
        let leaf = role(&mut s, "/content/0/content/0");
        select(&mut s, point(leaf.clone(), 2), point(leaf, 7));
    }
    if id == "CMS-T17" {
        let leaf = role(&mut s, "/content/0/content/1");
        select(&mut s, point(leaf.clone(), 0), point(leaf, 1));
    }
    let mut last = Value::Null;
    for a in f["actions"].as_array().unwrap() {
        if let Some(t) = a.get("type") {
            last = type_scalars(&mut s, t.as_str().unwrap());
        } else if a["key"] == "Backspace" {
            let raw = raw_restore(&last);
            let r = restore(&mut s, &raw);
            assert_eq!(ok(r)["result"], Value::Null);
        } else if a.get("syntheticCompositionEvent").is_some() {
            last = command(&mut s, "\"", "composition_commit");
            ok(last.clone());
        }
        if let Some(t) = a.get("expectedText") {
            assert_eq!(
                all_text(&parse(&snapshot(&mut s))),
                t.as_str().unwrap(),
                "{id} action"
            );
        }
    }
    let actual = parse(&snapshot(&mut s));
    let e = &f["expected"];
    if let Some(t) = e.get("text") {
        assert_eq!(all_text(&actual), t.as_str().unwrap(), "{id} source text");
    }
    if let Some(t) = e.get("firstLeafText") {
        assert_eq!(&actual["content"][0]["content"][0]["text"], t);
    }
    if let Some(ms) = e.get("firstLeafMarks") {
        let got = actual["content"][0]["content"][0]["marks"]
            .as_array()
            .unwrap()
            .iter()
            .map(|m| m["type"].clone())
            .collect::<Vec<_>>();
        assert_eq!(Value::Array(got), *ms);
    }
    if let Some(t) = e.get("lastInlineChildText") {
        let ns = actual["content"][0]["content"].as_array().unwrap();
        assert_eq!(&ns.last().unwrap()["text"], t);
    }
    if e["selectionEmpty"] == true {
        let st = state(&mut s);
        assert_eq!(st["selection"]["anchor"], st["selection"]["focus"]);
    }
    if e["undoInputRule"] == false {
        assert_eq!(
            last["value"]["result"]["raw_restore"],
            Value::Null,
            "NBSP has no special raw restoration"
        );
    }
    clean(&mut s);
    json!({"id":id,"source_literal_assertions":true,"composition_translation":id=="CMS-T15","original_synthetic_trace_executed":false})
}
fn run_matrix_case(c: &Value) -> Value {
    let id = c["id"].as_str().unwrap();
    let mut config = cfg(c.get("locale").and_then(Value::as_str).unwrap_or("ru"));
    if let Some(rs) = c.get("enabledRules") {
        config["rules"] = rs.clone();
    }
    let before = c["beforeText"].as_str().unwrap();
    let mut s = open(&basic(before).to_string(), config);
    caret_end(&mut s);
    let packet = &c["packet"];
    let origin = packet["origin"].as_str().unwrap();
    let data = packet["data"].as_str().unwrap();
    let response = if origin == "typed_sequence" {
        type_scalars(&mut s, data)
    } else if origin == "composition_final" {
        command(&mut s, data, "composition_commit")
    } else if origin == "typed_insert_text" {
        command(&mut s, data, "ordinary_insert_text")
    } else if origin == "paste" {
        let t = stamp(&mut s);
        let fragment = json!({"format_id":"org.klenwriter.kwdj/clipboard-fragment/1","source_profile":{"profile_id":"org.klenwriter.kwdj","profile_version":"1.0.0","codec_id":"org.klenwriter.kwdj/json","wire_version":1},"mode":"prose","kind":"inline","content":[{"type":"text","text":data}],"open_start":false,"open_end":false});
        call(
            &mut s,
            json!({"kind":"command","stamp":t,"command":{"id":"org.klenwriter.kwdj/command/insert-fragment","payload_json":json!({"kind":"insert_fragment","fragment_json":fragment.to_string()}).to_string()},"history_hint":{"kind":"isolated"}}),
        )
    } else {
        literal(&mut s, data)
    };
    ok(response);
    let actual = parse(&snapshot(&mut s));
    assert_eq!(
        all_text(&actual),
        c["expectedText"].as_str().unwrap(),
        "matrix {id}"
    );
    clean(&mut s);
    json!({"id":id,"source_expected_text":true,"route":if origin=="paste"{"native_insert_fragment"}else if matches!(origin,"typed_sequence"|"typed_insert_text"|"composition_final"){"native_typed"}else{"native_literal_adapter"},"browser_owner_executed":false})
}
fn whitespace_vectors(matrix: &Value) -> Vec<Value> {
    let mut rows = Vec::new();
    for c in matrix["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| c["group"] == "PURE_LEXICAL_CLASS")
    {
        let ch =
            char::from_u32(u32::from_str_radix(c["codepointHex"].as_str().unwrap(), 16).unwrap())
                .unwrap();
        let before = format!("x{ch}");
        let mut s = open(&basic(&before).to_string(), cfg("ru"));
        caret_end(&mut s);
        let r = command(&mut s, "\"", "ordinary_insert_text");
        ok(r);
        let expected = format!(
            "{before}{}",
            if c["expectedWhitespace"] == true {
                '«'
            } else {
                '»'
            }
        );
        assert_eq!(
            all_text(&parse(&snapshot(&mut s))),
            expected,
            "whitespace {}",
            c["id"]
        );
        clean(&mut s);
        rows.push(json!({"id":c["id"],"classifier_observed_via_native_quote":true,"physical_input_claim":false}));
    }
    assert_eq!(rows.len(), 31);
    rows
}
fn opt_in_and_literal_guards() -> Value {
    for typing in [
        Value::Null,
        json!({"version":1,"locale":"ru","rules":[],"limits":null}),
    ] {
        let mut s = open(&basic("а ").to_string(), typing.clone());
        caret_end(&mut s);
        let catalog = ok(call(&mut s, json!({"kind":"catalog"})))["commands"]
            .as_array()
            .unwrap()
            .clone();
        assert_eq!(catalog.len(), if typing.is_null() { 18 } else { 20 });
        assert_eq!(catalog.iter().any(|id| id == INSERT), !typing.is_null());
        let r = if typing.is_null() {
            literal(&mut s, "\"")
        } else {
            command(&mut s, "\"", "ordinary_insert_text")
        };
        ok(r);
        assert_eq!(all_text(&parse(&snapshot(&mut s))), "а \"");
        clean(&mut s);
    }
    let mut s = open(&basic("а ").to_string(), cfg("ru"));
    caret_end(&mut s);
    let before = state(&mut s);
    let t = stamp(&mut s);
    let r = call(
        &mut s,
        json!({"kind":"command","stamp":t,"command":{"id":INSERT,"payload_json":json!({"kind":"insert_typed_text","text":"\"","origin":"ordinary_insert_text"}).to_string()},"history_hint":{"kind":"isolated"}}),
    );
    assert_eq!(r["status"], "refused");
    assert_eq!(state(&mut s), before);
    assert_eq!(all_text(&parse(&snapshot(&mut s))), "а ");
    clean(&mut s);
    json!({"off_catalog":18,"configured_empty_catalog":20,"off_and_subset_literal":true,"old_entry_typed_id_refused":true})
}

pub fn run() -> Value {
    let native = parse(NATIVE);
    let matrix = parse(MATRIX);
    let cms = parse(CMS);
    assert_eq!(native["caseCount"], 16);
    assert_eq!(matrix["caseCount"], 192);
    assert_eq!(cms["sourceTests"]["testBodies"], 17);
    let native_rows = native["cases"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_native_oracle)
        .collect::<Vec<_>>();
    let cms_rows = cms["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .map(run_cms_fixture)
        .collect::<Vec<_>>();
    let groups = [
        "CONFIG_SUBSET",
        "PRIMITIVE_SINGLE_SCALAR",
        "EN_SCOPE_LITERAL",
        "OUTSIDE_EXACT",
        "ORIGIN_LITERAL",
    ];
    let matrix_rows = matrix["cases"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|c| groups.iter().any(|g| c["group"] == *g))
        .map(run_matrix_case)
        .collect::<Vec<_>>();
    let whitespace = whitespace_vectors(&matrix);
    let guards = opt_in_and_literal_guards();
    let caps = local_cap_and_config_guards();
    let references = reference_context_guard();
    json!({"task":"OSR-48","status":"passed","authority":"contracts/typography/v1; source-frozen before candidate","native_oracle_count":native_rows.len(),"native_oracles":native_rows,"cms_source_bodies":cms_rows.len(),"cms_source_translations":cms_rows,"native_matrix_rows":matrix_rows,"lexical_vectors":whitespace,"opt_in_guards":guards,"lowering_and_config_guards":caps,"reference_protection":references,"qualifications":{"synthetic_old_cms_trace_is_not_native_ime":true,"pure_data_oracles_not_generated_from_output":true,"browser_and_installed_lanes_not_executed":true,"global_zero_is_direct_native_session":true}})
}

// Compile-time frozen literal bytes; never runtime-produced expected data.
const CANONICAL: &[(&str, &str)] = &[
    (
        "native-oracles/canonical/N01-ru-quote/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N01-ru-quote/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N01-ru-quote/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N01-ru-quote/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N01-ru-quote/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N01-ru-quote/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N01-ru-quote/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N01-ru-quote/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N02-en-quote/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N02-en-quote/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N02-en-quote/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N02-en-quote/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N02-en-quote/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N02-en-quote/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N02-en-quote/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N02-en-quote/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N03-dash/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N03-dash/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N03-dash/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N03-dash/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N03-dash/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N03-dash/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N03-dash/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N03-dash/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N04-nbsp/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N04-nbsp/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N04-nbsp/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N04-nbsp/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N04-nbsp/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N04-nbsp/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N04-nbsp/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N04-nbsp/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N05-reverse-selection/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N05-reverse-selection/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N05-reverse-selection/backspace-raw-target.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N05-reverse-selection/backspace-raw-target.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N05-reverse-selection/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N05-reverse-selection/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N05-reverse-selection/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N05-reverse-selection/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N05-reverse-selection/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N05-reverse-selection/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N06-dash-mixed-marks/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N06-dash-mixed-marks/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N06-dash-mixed-marks/backspace-raw-target.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N06-dash-mixed-marks/backspace-raw-target.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N06-dash-mixed-marks/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N06-dash-mixed-marks/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N06-dash-mixed-marks/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N06-dash-mixed-marks/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N06-dash-mixed-marks/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N06-dash-mixed-marks/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N07-nbsp-mixed-marks/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N07-nbsp-mixed-marks/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N07-nbsp-mixed-marks/backspace-target.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N07-nbsp-mixed-marks/backspace-target.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N07-nbsp-mixed-marks/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N07-nbsp-mixed-marks/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N07-nbsp-mixed-marks/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N07-nbsp-mixed-marks/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N07-nbsp-mixed-marks/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N07-nbsp-mixed-marks/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N08-EGC-original-interior/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N08-EGC-original-interior/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N08-EGC-original-interior/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N08-EGC-original-interior/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N09-global-work-zero/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N09-global-work-zero/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N09-global-work-zero/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N09-global-work-zero/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N10-local-lexical-zero/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N10-local-lexical-zero/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N10-local-lexical-zero/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N10-local-lexical-zero/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N10-local-lexical-zero/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N10-local-lexical-zero/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N10-local-lexical-zero/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N10-local-lexical-zero/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N11-T15-owned-final/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N11-T15-owned-final/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N11-T15-owned-final/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N11-T15-owned-final/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N11-T15-owned-final/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N11-T15-owned-final/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N11-T15-owned-final/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N11-T15-owned-final/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N12-code-literal/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N12-code-literal/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N12-code-literal/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N12-code-literal/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N12-code-literal/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N12-code-literal/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N12-code-literal/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N12-code-literal/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N13-link-literal/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N13-link-literal/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N13-link-literal/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N13-link-literal/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N13-link-literal/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N13-link-literal/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N13-link-literal/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N13-link-literal/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N14-replacement-literal/apply.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N14-replacement-literal/apply.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N14-replacement-literal/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N14-replacement-literal/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N14-replacement-literal/redo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N14-replacement-literal/redo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N14-replacement-literal/undo.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N14-replacement-literal/undo.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/raw-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/raw-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/redo-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/redo-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/redo-rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/redo-rule.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/rule.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/undo-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/undo-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N15-backspace-quote/undo-rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N15-backspace-quote/undo-rule.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/before.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/before.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/raw-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/raw-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/redo-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/redo-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/redo-rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/redo-rule.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/rule.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/undo-reversal.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/undo-reversal.kwdj.json"
        ),
    ),
    (
        "native-oracles/canonical/N16-backspace-dash/undo-rule.kwdj.json",
        include_str!(
            "../../../../contracts/typography/v1/native-oracles/canonical/N16-backspace-dash/undo-rule.kwdj.json"
        ),
    ),
];

fn direct_global_zero(case: &Value) -> Value {
    use editor_core::input::InputOrigin;
    use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
    use editor_core::profile::{AdmissionMode, FrozenProfile};
    use editor_core::transaction::{WorkLimits, WorkMeter};
    use editor_engine::{
        AccessMode, CommandAvailability, CommandRequest, InputCommandOutcome, Session, SessionState,
    };
    struct Facts;
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
    let facts = Facts;
    let rules = editor_kwdj::typing::TypingRules::new(
        editor_kwdj::typing::Locale::Ru,
        None,
        Default::default(),
    )
    .unwrap();
    let descriptor =
        serde_json::to_vec(&editor_kwdj::registry::typing_registry_descriptor()).unwrap();
    let mut work = WorkMeter::new(WorkLimits::default());
    let p = editor_kwdj::KwdjProfile::new(
        &facts,
        editor_kwdj::Limits::default(),
        editor_kwdj::AdmissionBudget::default(),
    )
    .with_typing_registry_json(rules, &descriptor, Default::default(), &mut work)
    .unwrap();
    let binding = p.binding().clone();
    let expected = canonical_literal(
        case["checkpoints"][0]["canonical"]["path"]
            .as_str()
            .unwrap(),
    );
    let mut s = Session::open(
        p,
        &binding,
        expected.as_bytes(),
        AdmissionMode::Strict,
        AccessMode::Editable,
    )
    .unwrap();
    let key = s.key();
    let root = s.root(key).unwrap();
    let p0 = s.node(key, root).unwrap().children()[0];
    let t0 = s.node(key, p0).unwrap().children()[0];
    let p1 = s.node(key, root).unwrap().children()[1];
    let tail = s.node(key, p1).unwrap().children()[0];
    let cp = Position::Text {
        leaf: t0,
        utf16: Utf16Offset::new(2),
        affinity: Affinity::After,
    };
    s.set_selection(
        key,
        0,
        Selection {
            anchor: cp,
            focus: cp,
        },
    )
    .unwrap();
    let before = s.stamp();
    let history = s.history_summary();
    let original_selection = s.selection(key).unwrap();
    let tailpoint = Position::Text {
        leaf: tail,
        utf16: Utf16Offset::new(2),
        affinity: Affinity::Before,
    };
    let old_map = s.map_position(key, 0, tailpoint).unwrap();
    let mut request = CommandRequest::new(
        key,
        0,
        s.selection_epoch(),
        editor_kwdj::commands::KwdjIntent::InsertTypedText {
            text: "\"".into(),
            origin: InputOrigin::OrdinaryInsertText,
        },
    );
    request.limits.work = WorkLimits { units: 0, bytes: 0 };
    assert!(matches!(
        s.query_input_command(&request),
        CommandAvailability::Unavailable { .. }
    ));
    assert_eq!(s.stamp(), before);
    assert_eq!(s.history_summary(), history);
    let outcome = s.execute_input_command(&request);
    assert!(
        matches!(outcome, InputCommandOutcome::Refused { .. }),
        "global zero {outcome:?}"
    );
    assert_eq!(s.stamp(), before);
    assert_eq!(s.history_summary(), history);
    assert_eq!(s.selection(key).unwrap(), original_selection);
    assert_eq!(s.stored_marks(key).unwrap(), None);
    assert!(!s.dirty());
    assert_eq!(s.export_snapshot(key, 0).unwrap(), expected.as_bytes());
    assert_eq!(s.map_position(key, 0, tailpoint).unwrap(), old_map);
    assert_eq!(s.node(key, p0).unwrap().children(), &[t0]);
    assert_eq!(s.node(key, p1).unwrap().children(), &[tail]);
    s.close(key).unwrap();
    assert_eq!(s.state(), SessionState::Closed);
    json!({"id":case["id"],"checkpoints":2,"document_publications":0,"fixed_canonical":true,"identity_state_history_maps":true,"resources_zero":true,"lane":"direct_public_native_Session_zero_global_WorkLimits","qualification":"No public ABI2 work-limit field was invented. Explicit Session close; no bridge/snapshot handles were created."})
}

// These additional fixtures were authored and frozen before the first candidate
// execution. Position translation binds opaque handles, never expected content.
fn additional_point(s: &mut DistributionSession, p: &Value) -> Value {
    let id = role(s, p["path"].as_str().unwrap());
    match p["kind"].as_str().unwrap() {
        "text" => json!({"kind":"text","node":id,"offset":p["offset"],"affinity":p["affinity"]}),
        "child" => json!({"kind":"child","parent":id,"index":p["index"],"affinity":p["affinity"]}),
        other => panic!("undeclared source point {other}"),
    }
}
fn additional_setup(s: &mut DistributionSession, c: &Value) {
    let a = additional_point(s, &c["selection"]["anchor"]);
    let b = additional_point(s, &c["selection"]["focus"]);
    select(s, a, b);
    stored(s, &c["storedMarks"]);
}
fn local_cap_and_config_guards() -> Value {
    let source = parse(ADDITIONAL);
    let cases = source["localCaps"].as_array().unwrap();
    assert_eq!(cases.len(), 10);
    let mut literal_rows = Vec::new();
    let mut invalid_rows = Vec::new();
    for c in cases {
        let key = c["limit"].as_str().unwrap();
        let mut config = cfg("ru");
        config["limits"] = json!({});
        config["limits"][key] = json!(0);
        let mut s = open(c["beforeCanonical"].as_str().unwrap(), config);
        additional_setup(&mut s, c);
        let result = command(
            &mut s,
            c["typed"]["text"].as_str().unwrap(),
            c["typed"]["origin"].as_str().unwrap(),
        );
        assert_eq!(
            ok(result)["result"],
            c["expectedResult"],
            "local optional cap {key} must not mint effect"
        );
        assert_eq!(
            snapshot(&mut s),
            c["expectedCanonical"].as_str().unwrap(),
            "fixed full canonical for {}",
            c["id"]
        );
        clean(&mut s);
        literal_rows.push(c["id"].clone());
        let mut too_high = cfg("ru");
        too_high["limits"] = json!({});
        too_high["limits"][key] = json!(c["maximum"].as_u64().unwrap() + 1);
        let mut denied = open_raw(
            &basic("а ").to_string(),
            too_high,
            json!({"media":[],"references":[]}),
        );
        assert!(
            matches!(
                denied.initialization(),
                editor_protocol::SdkResponse::Refused { .. }
            ),
            "over source cap {key}: {:?}",
            denied.initialization()
        );
        assert_eq!(denied.own_resource_counts().sessions, 0);
        denied.destroy();
        invalid_rows.push(key.to_owned());
    }
    let invalid = source["invalidConfigurations"].as_array().unwrap();
    for config in invalid {
        let mut s = open_raw(
            &basic("а ").to_string(),
            config.clone(),
            json!({"media":[],"references":[]}),
        );
        assert!(
            matches!(
                s.initialization(),
                editor_protocol::SdkResponse::Refused { .. }
            ),
            "invalid source config {config}: {:?}",
            s.initialization()
        );
        assert_eq!(s.own_resource_counts().sessions, 0);
        s.destroy();
    }
    json!({"local_zero_literal_rows":literal_rows,"over_ceiling_open_refusals":invalid_rows,"closed_config_refusals":invalid.len(),"qualification":"Wire observes exact literal canonical/result:null, not a synthesized internal bypass reason. Frozen hard global refusal is the separate direct Session N09."})
}
fn reference_context_guard() -> Value {
    let source = parse(ADDITIONAL);
    let c = &source["referenceProtection"];
    let mut s = open_raw(
        c["beforeCanonical"].as_str().unwrap(),
        cfg("ru"),
        c["identities"].clone(),
    );
    assert!(
        matches!(s.initialization(), editor_protocol::SdkResponse::Ok { .. }),
        "reference setup {:?}",
        s.initialization()
    );
    additional_setup(&mut s, c);
    let result = command(
        &mut s,
        c["typed"]["text"].as_str().unwrap(),
        c["typed"]["origin"].as_str().unwrap(),
    );
    assert_eq!(ok(result)["result"], c["expectedResult"]);
    assert_eq!(snapshot(&mut s), c["expectedCanonical"].as_str().unwrap());
    clean(&mut s);
    json!({"reference_link_literal":true,"identity_and_attrs_preserved":true,"qualification":"Frozen PROTECT current/stored reference_link context, existing source identity fixture; no CMS link parity claim."})
}
