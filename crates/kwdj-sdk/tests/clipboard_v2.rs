// SPDX-License-Identifier: MIT OR Apache-2.0
//! Source-authored clipboard oracles. Compile-only until root freezes this file.
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use editor_kwdj_sdk::KwdjFactory;
use klenwriter_editor_kwdj_sdk as editor_kwdj_sdk;
use serde_json::{Value, json};
const BUILD: &str = "clipboard-native-oracle-v1";
const COMMAND: &str = "org.klenwriter.kwdj/command/insert-fragment";
fn p(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}
fn doc(mode: &str, content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":mode,"content":content})
}
fn fragment(mode: &str, kind: &str, content: Value, open_start: bool, open_end: bool) -> Value {
    json!({"format_id":"org.klenwriter.kwdj/clipboard-fragment/1","source_profile":{"profile_id":"org.klenwriter.kwdj","profile_version":"1.0.0","codec_id":"org.klenwriter.kwdj/json","wire_version":1},"mode":mode,"kind":kind,"content":content,"open_start":open_start,"open_end":open_end})
}
fn open(source: &Value) -> DistributionSession {
    open_with_limits(source, Value::Null)
}
fn open_with_limits(source: &Value, limits: Value) -> DistributionSession {
    let options = json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":editor_kwdj_sdk::manifest().profiles[0],"admission":"validate","access":"editable","registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":limits}).to_string()});
    let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
    let session = distribution.open(source.to_string().as_bytes(), &options.to_string());
    assert!(matches!(
        session.initialization(),
        editor_protocol::SdkResponse::Ok { .. }
    ));
    session
}
fn call(s: &mut DistributionSession, r: Value) -> Value {
    serde_json::from_str(&s.call_json(&r.to_string())).unwrap()
}
fn state(s: &mut DistributionSession) -> Value {
    call(s, json!({"kind":"state"}))["value"]["state"].clone()
}
fn node(s: &mut DistributionSession, id: &Value) -> Value {
    let stamp = state(s)["stamp"].clone();
    call(s, json!({"kind":"node","stamp":stamp,"node":id}))["value"]["node"].clone()
}
fn role(s: &mut DistributionSession, path: &[usize]) -> Value {
    let mut id = state(s)["root"].clone();
    for index in path {
        id = node(s, &id)["children"][*index].clone();
    }
    id
}
fn text(id: Value, offset: usize) -> Value {
    json!({"kind":"text","node":id,"offset":offset,"affinity":"after"})
}
fn gap(id: Value, index: usize) -> Value {
    json!({"kind":"child","parent":id,"index":index,"affinity":"after"})
}
fn select(s: &mut DistributionSession, a: Value, b: Value) {
    let stamp = state(s)["stamp"].clone();
    let response = call(
        s,
        json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":a,"focus":b}}),
    );
    assert_eq!(response["status"], "ok", "{response}");
}
fn paste(s: &mut DistributionSession, f: &Value) -> Value {
    let stamp = state(s)["stamp"].clone();
    call(
        s,
        json!({"kind":"command","stamp":stamp,"command":{"id":COMMAND,"payload_json":json!({"kind":"insert_fragment","fragment_json":f.to_string()}).to_string()},"history_hint":{"kind":"isolated"}}),
    )
}
fn snapshot(s: &mut DistributionSession) -> Value {
    let stamp = state(s)["stamp"].clone();
    let r = call(
        s,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":2097152}),
    );
    assert_eq!(r["status"], "ok", "{r}");
    let value = serde_json::from_str(r["value"]["canonical_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        call(
            s,
            json!({"kind":"release_snapshot","handle":r["value"]["handle"]})
        )["status"],
        "ok"
    );
    value
}
fn undo(s: &mut DistributionSession) {
    let stamp = state(s)["stamp"].clone();
    let r = call(
        s,
        json!({"kind":"history","stamp":stamp,"direction":"undo"}),
    );
    assert_eq!(r["status"], "ok", "{r}");
}
fn rich() -> Value {
    json!([{"type":"text","text":"X","marks":[{"type":"strong"}]},{"type":"hard_break"},{"type":"text","text":"Y","marks":[{"type":"emphasis"}]}])
}

#[test]
fn rich_inline_and_sibling_replacements_are_one_native_history_action() {
    for cross in [false, true] {
        let source = if cross {
            doc("prose", json!([p("abc"), p("def")]))
        } else {
            doc("prose", json!([p("abcdef")]))
        };
        let mut s = open(&source);
        let left = role(&mut s, &[0]);
        let a = role(&mut s, &[0, 0]);
        let b = if cross {
            role(&mut s, &[1, 0])
        } else {
            a.clone()
        };
        select(
            &mut s,
            text(a.clone(), 1),
            text(b, if cross { 2 } else { 5 }),
        );
        let before = state(&mut s);
        let r = paste(&mut s, &fragment("prose", "inline", rich(), false, false));
        assert_eq!(r["status"], "ok", "{r}");
        assert_eq!(
            snapshot(&mut s),
            doc(
                "prose",
                json!([{"type":"paragraph","content":[{"type":"text","text":"a"},{"type":"text","text":"X","marks":[{"type":"strong"}]},{"type":"hard_break"},{"type":"text","text":"Y","marks":[{"type":"emphasis"}]},{"type":"text","text":"f"}]}])
            )
        );
        assert_eq!(role(&mut s, &[0]), left);
        let after = state(&mut s);
        assert_eq!(after["history"]["undo_entries"], "1");
        let selected = after["selection"].clone();
        assert_eq!(selected["anchor"], selected["focus"]);
        assert_eq!(selected["focus"]["offset"], 1);
        let caret = node(&mut s, &selected["focus"]["node"]);
        assert_eq!(caret["text"], "Y");
        undo(&mut s);
        assert_eq!(snapshot(&mut s), source);
        assert_eq!(state(&mut s)["selection"], before["selection"]);
        assert_eq!(role(&mut s, &[0, 0]), a);
    }
}

#[test]
fn open_paragraph_edges_reconstruct_cross_block_copy_and_cut_join() {
    for joined in [false, true] {
        let source = if joined {
            doc("prose", json!([p("af")]))
        } else {
            doc("prose", json!([p("abc"), p("def")]))
        };
        let mut s = open(&source);
        let first = role(&mut s, &[0]);
        let a = role(&mut s, &[0, 0]);
        let b = if joined {
            a.clone()
        } else {
            role(&mut s, &[1, 0])
        };
        let old_second = (!joined).then(|| role(&mut s, &[1]));
        select(&mut s, text(a, 1), text(b, if joined { 1 } else { 2 }));
        let r = paste(
            &mut s,
            &fragment("prose", "blocks", json!([p("bc"), p("de")]), true, true),
        );
        assert_eq!(r["status"], "ok", "{r}");
        assert_eq!(snapshot(&mut s), doc("prose", json!([p("abc"), p("def")])));
        assert_eq!(role(&mut s, &[0]), first);
        if let Some(id) = old_second {
            assert_eq!(role(&mut s, &[1]), id);
        }
        let st = state(&mut s);
        let caret = node(&mut s, &st["selection"]["focus"]["node"]);
        assert_eq!(caret["text"], "def");
        assert_eq!(st["selection"]["focus"]["offset"], 2);
        assert_eq!(st["history"]["undo_entries"], "1");
        undo(&mut s);
        assert_eq!(snapshot(&mut s), source);
    }
}

#[test]
fn closed_blocks_keep_outside_paragraphs_and_explicit_empty_payload() {
    let source = doc("prose", json!([p("abcd")]));
    let mut s = open(&source);
    let a = role(&mut s, &[0, 0]);
    select(&mut s, text(a.clone(), 2), text(a, 2));
    let quote = json!({"type":"blockquote","content":[p("q")]});
    let empty = json!({"type":"paragraph","content":[]});
    let r = paste(
        &mut s,
        &fragment("prose", "blocks", json!([quote, empty]), false, false),
    );
    assert_eq!(r["status"], "ok", "{r}");
    assert_eq!(
        snapshot(&mut s),
        doc(
            "prose",
            json!([p("ab"),{"type":"blockquote","content":[p("q")]},{"type":"paragraph","content":[]},p("cd")])
        )
    );
    undo(&mut s);
    assert_eq!(snapshot(&mut s), source);
}

#[test]
fn native_poetry_context_inserts_canonical_verse_lines_without_guessing() {
    let line = |t: &str| json!({"type":"verse_line","content":[{"type":"text","text":t}]});
    let source = doc("poetry", json!([{"type":"verse","content":[line("ab")]}]));
    let mut s = open(&source);
    let a = role(&mut s, &[0, 0, 0]);
    select(&mut s, text(a.clone(), 1), text(a, 1));
    let before = state(&mut s);
    let r = call(
        &mut s,
        json!({"kind":"clipboard_context","stamp":before["stamp"]}),
    );
    assert_eq!(r["status"], "ok", "{r}");
    let c: Value = serde_json::from_str(r["value"]["context_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        c,
        json!({"mode":"poetry","insertion_context":"verse","allowed_fragment_kinds":["inline","blocks"]})
    );
    assert_eq!(state(&mut s), before);
    let r = paste(
        &mut s,
        &fragment(
            "poetry",
            "blocks",
            json!([{"type":"verse","content":[line("X"),{"type":"stanza_break","attrs":{"blank_lines":1}},line("Y")]}]),
            false,
            false,
        ),
    );
    assert_eq!(r["status"], "ok", "{r}");
    assert_eq!(
        snapshot(&mut s),
        doc(
            "poetry",
            json!([{"type":"verse","content":[line("aX"),{"type":"stanza_break","attrs":{"blank_lines":1}},line("Yb")]}])
        )
    );
    undo(&mut s);
    assert_eq!(snapshot(&mut s), source);
}

#[test]
fn fragment_extraction_preserves_native_directed_selection_and_open_edges() {
    let source = doc("prose", json!([p("abc"), p("def")]));
    let mut s = open(&source);
    let a = role(&mut s, &[0, 0]);
    let b = role(&mut s, &[1, 0]);
    select(&mut s, text(b, 2), text(a, 1));
    let before = state(&mut s);
    let r = call(
        &mut s,
        json!({"kind":"selection_fragment","stamp":before["stamp"],"max_bytes":2097152}),
    );
    assert_eq!(r["status"], "ok", "{r}");
    assert_eq!(r["value"]["selection"], before["selection"]);
    assert_eq!(r["value"]["stamp"], before["stamp"]);
    let f: Value = serde_json::from_str(r["value"]["fragment_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        f,
        fragment("prose", "blocks", json!([p("bc"), p("de")]), true, true)
    );
    assert_eq!(state(&mut s), before);
    let limited = call(
        &mut s,
        json!({"kind":"selection_fragment","stamp":before["stamp"],"max_bytes":1}),
    );
    assert_eq!(limited["status"], "refused");
    assert_eq!(state(&mut s), before);
}

#[test]
fn invalid_source_mode_shape_and_stale_target_refuse_atomically() {
    let source = doc("prose", json!([p("e\u{301}x")]));
    let mut s = open(&source);
    let a = role(&mut s, &[0, 0]);
    select(&mut s, text(a.clone(), 0), text(a.clone(), 0));
    for mut f in [
        fragment("poetry", "inline", rich(), false, false),
        fragment("prose", "inline", rich(), true, false),
        fragment("prose", "inline", rich(), false, false),
    ] {
        if f["mode"] == "prose" && f["open_start"] == false {
            f["source_profile"]["codec_id"] = "org.other/json".into();
        }
        let before = state(&mut s);
        let r = paste(&mut s, &f);
        assert_eq!(r["status"], "refused", "{r}");
        assert_eq!(state(&mut s), before);
        assert_eq!(snapshot(&mut s), source);
    }
    let mut foreign = fragment("prose", "inline", rich(), false, false);
    foreign["source_profile"]["profile_id"] = "org.example.notes".into();
    let before = state(&mut s);
    let refused = paste(&mut s, &foreign);
    assert_eq!(refused["status"], "refused");
    assert_eq!(state(&mut s), before);
    assert_eq!(snapshot(&mut s), source);
    let captured = state(&mut s)["stamp"].clone();
    select(&mut s, text(a.clone(), 2), text(a.clone(), 2));
    let current = state(&mut s);
    let stale = call(
        &mut s,
        json!({"kind":"command","stamp":captured,"command":{"id":COMMAND,"payload_json":json!({"kind":"insert_fragment","fragment_json":fragment("prose","inline",rich(),false,false).to_string()}).to_string()},"history_hint":{"kind":"isolated"}}),
    );
    assert_eq!(stale["status"], "refused");
    assert_eq!(state(&mut s), current);
    assert_eq!(snapshot(&mut s), source);
    select(&mut s, text(a.clone(), 1), text(a, 1));
    let before = state(&mut s);
    let r = paste(&mut s, &fragment("prose", "inline", rich(), false, false));
    assert_eq!(r["status"], "refused", "EGC endpoint: {r}");
    assert_eq!(state(&mut s), before);
    assert_eq!(snapshot(&mut s), source);
}

#[test]
fn additive_reads_and_intent_never_open_legacy_wire() {
    let stamp = json!({"session":"1","generation":"1","revision":"0","selection_epoch":"0","history_epoch":"0"});
    for request in [
        json!({"kind":"clipboard_context","stamp":stamp}),
        json!({"kind":"selection_fragment","stamp":stamp,"max_bytes":1024}),
    ] {
        assert!(
            serde_json::from_value::<editor_protocol::v2::BridgeRequestV2>(request.clone()).is_ok()
        );
        assert!(serde_json::from_value::<editor_kwdj_sdk::wire::SdkRequest>(request).is_err());
    }
    assert!(
        serde_json::from_value::<editor_kwdj_sdk::wire::KwdjIntentDto>(
            json!({"kind":"insert_fragment","fragment_json":"{}"})
        )
        .is_err()
    );
    assert_eq!(editor_kwdj::commands::KWDJ_COMMANDS.len(), 17);
    assert!(
        !editor_kwdj::commands::KWDJ_COMMANDS
            .iter()
            .any(|entry| entry.id == COMMAND)
    );
}

#[test]
fn whole_nested_fragment_source_is_bounded_before_typed_decode() {
    use editor_kwdj::commands::clipboard::{FRAGMENT_BYTES, decode_fragment};
    let f = fragment("prose", "inline", rich(), false, false);
    let mut exact = f.to_string();
    exact.push_str(&" ".repeat(FRAGMENT_BYTES - exact.len()));
    assert!(decode_fragment(&exact).is_ok());
    exact.push(' ');
    assert_eq!(
        decode_fragment(&exact).unwrap_err().code,
        editor_kwdj::KwdjErrorCode::ResourceLimitExceeded
    );
    let deep = format!("{}0{}", "[".repeat(97), "]".repeat(97));
    assert_eq!(
        decode_fragment(&deep).unwrap_err().code,
        editor_kwdj::KwdjErrorCode::ResourceLimitExceeded
    );
    let mut unknown = f;
    unknown["node_id"] = "n1:foreign".into();
    assert!(decode_fragment(&unknown.to_string()).is_err());
    assert!(
        serde_json::from_value::<editor_kwdj_sdk::wire_v2::KwdjClipboardIntentV2>(
            json!({"kind":"insert_fragment","fragment_json":"{}","origin":"normalization"})
        )
        .is_err()
    );
}

#[test]
fn full_verse_at_root_gap_preserves_literal_poetry_structure() {
    let source = doc("poetry", json!([p("before")]));
    let mut s = open(&source);
    let root = state(&mut s)["root"].clone();
    select(&mut s, gap(root.clone(), 1), gap(root, 1));
    let before = state(&mut s);
    let context = call(
        &mut s,
        json!({"kind":"clipboard_context","stamp":before["stamp"]}),
    );
    assert_eq!(context["status"], "ok");
    let c: Value =
        serde_json::from_str(context["value"]["context_json"].as_str().unwrap()).unwrap();
    assert_eq!(
        c,
        json!({"mode":"poetry","insertion_context":"root","allowed_fragment_kinds":["blocks"]})
    );
    assert_eq!(state(&mut s), before);
    let verse = json!({"type":"verse","content":[{"type":"verse_line","content":[{"type":"text","text":"one"}]},{"type":"stanza_break","attrs":{"blank_lines":2}},{"type":"verse_line","content":[{"type":"text","text":"two"}]}]});
    let result = paste(
        &mut s,
        &fragment("poetry", "blocks", json!([verse.clone()]), false, false),
    );
    assert_eq!(result["status"], "ok", "{result}");
    assert_eq!(snapshot(&mut s), doc("poetry", json!([p("before"), verse])));
    undo(&mut s);
    assert_eq!(snapshot(&mut s), source);
}

#[test]
fn empty_clipboard_forests_refuse_without_moving_caret_or_splitting_blocks() {
    for kind in ["inline", "blocks"] {
        for collapsed in [false, true] {
            let source = doc("prose", json!([p("abcd")]));
            let mut s = open(&source);
            let leaf = role(&mut s, &[0, 0]);
            select(
                &mut s,
                text(leaf.clone(), 1),
                text(leaf, if collapsed { 1 } else { 3 }),
            );
            let before = state(&mut s);
            let result = paste(&mut s, &fragment("prose", kind, json!([]), false, false));
            assert_eq!(result["status"], "refused", "{kind}/{collapsed}: {result}");
            assert_eq!(state(&mut s), before);
            assert_eq!(snapshot(&mut s), source);
        }
    }
}

#[test]
fn each_open_edge_pair_places_caret_after_the_actual_inserted_payload() {
    for (open_start, open_end) in [(false, false), (true, false), (false, true), (true, true)] {
        let source = doc("prose", json!([p("abcd")]));
        let mut s = open(&source);
        let leaf = role(&mut s, &[0, 0]);
        select(&mut s, text(leaf.clone(), 2), text(leaf, 2));
        let result = paste(
            &mut s,
            &fragment(
                "prose",
                "blocks",
                json!([p("X"), p("Y")]),
                open_start,
                open_end,
            ),
        );
        assert_eq!(result["status"], "ok", "{open_start}/{open_end}: {result}");
        let expected = match (open_start, open_end) {
            (false, false) => json!([p("ab"), p("X"), p("Y"), p("cd")]),
            (true, false) => json!([p("abX"), p("Y"), p("cd")]),
            (false, true) => json!([p("ab"), p("X"), p("Ycd")]),
            (true, true) => json!([p("abX"), p("Ycd")]),
        };
        assert_eq!(snapshot(&mut s), doc("prose", expected));
        let after = state(&mut s);
        let focus = &after["selection"]["focus"];
        assert_eq!(after["selection"]["anchor"], *focus);
        assert_eq!(focus["offset"], 1);
        assert_eq!(
            node(&mut s, &focus["node"])["text"],
            if open_end { "Ycd" } else { "Y" }
        );
        assert_eq!(after["history"]["undo_entries"], "1");
        undo(&mut s);
        assert_eq!(snapshot(&mut s), source);
    }
}

#[test]
fn clipboard_payload_at_exact_configured_depth_is_admitted_and_one_deeper_refuses() {
    let source = doc("prose", json!([p("before")]));
    let limits = json!({"document_bytes":null,"tree_depth":"2","node_count":null,"text_leaf_bytes":null,"table_rows":null,"table_effective_columns":null,"authored_attribute_bytes":null});
    let mut s = open_with_limits(&source, limits);
    let root = state(&mut s)["root"].clone();
    let original_block = role(&mut s, &[0]);
    let original_text = role(&mut s, &[0, 0]);
    select(&mut s, gap(root.clone(), 1), gap(root.clone(), 1));
    let before = state(&mut s);

    // Independent node-depth literals: Paragraph(1) -> Text(2) is admitted.
    let inserted = paste(
        &mut s,
        &fragment("prose", "blocks", json!([p("X")]), false, false),
    );
    assert_eq!(inserted["status"], "ok", "{inserted}");
    assert_eq!(snapshot(&mut s), doc("prose", json!([p("before"), p("X")])));
    assert_eq!(state(&mut s)["root"], root);
    assert_eq!(role(&mut s, &[0]), original_block);
    assert_eq!(role(&mut s, &[0, 0]), original_text);
    let after = state(&mut s);
    assert_eq!(after["selection"]["anchor"], after["selection"]["focus"]);
    assert_eq!(after["selection"]["focus"]["offset"], 1);
    assert_eq!(
        node(&mut s, &after["selection"]["focus"]["node"])["text"],
        "X"
    );
    assert_eq!(after["history"]["undo_entries"], "1");
    undo(&mut s);
    assert_eq!(snapshot(&mut s), source);
    assert_eq!(state(&mut s)["selection"], before["selection"]);
    assert_eq!(role(&mut s, &[0]), original_block);
    assert_eq!(role(&mut s, &[0, 0]), original_text);

    // Blockquote(1) -> Paragraph(2) -> Text(3) exceeds the same depth 2.
    let before_refusal = state(&mut s);
    let refused = paste(
        &mut s,
        &fragment(
            "prose",
            "blocks",
            json!([{"type":"blockquote","content":[p("X")]}]),
            false,
            false,
        ),
    );
    assert_eq!(refused["status"], "refused", "{refused}");
    assert_eq!(
        refused["diagnostic"]["code"],
        "kwdj.resource_limit_exceeded"
    );
    assert_eq!(state(&mut s), before_refusal);
    assert_eq!(snapshot(&mut s), source);
}

#[test]
fn empty_open_paragraph_at_collapsed_caret_is_an_exact_internal_splice_noop() {
    let source = doc("prose", json!([p("abcd")]));
    let mut s = open(&source);
    let block = role(&mut s, &[0]);
    let leaf = role(&mut s, &[0, 0]);
    select(&mut s, text(leaf.clone(), 2), text(leaf.clone(), 2));
    let before = state(&mut s);
    // The fragment is a real paragraph node. Both open edges merge into the
    // existing host; its empty inline forest inserts no node or boundary.
    let result = paste(
        &mut s,
        &fragment(
            "prose",
            "blocks",
            json!([{"type":"paragraph","content":[]}]),
            true,
            true,
        ),
    );
    assert_eq!(result["status"], "ok", "{result}");
    assert_eq!(state(&mut s), before);
    assert_eq!(snapshot(&mut s), source);
    assert_eq!(role(&mut s, &[0]), block);
    assert_eq!(role(&mut s, &[0, 0]), leaf);
}
