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
    open_bytes(source.to_string().as_bytes(), limits)
}
fn open_bytes(source: &[u8], limits: Value) -> DistributionSession {
    open_bytes_with_media(source, limits, json!([]))
}
fn open_bytes_with_media(source: &[u8], limits: Value, media: Value) -> DistributionSession {
    open_bytes_with_access(source, limits, media, "editable")
}
fn open_bytes_with_access(
    source: &[u8],
    limits: Value,
    media: Value,
    access: &str,
) -> DistributionSession {
    let options = json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":editor_kwdj_sdk::manifest().profiles[0],"admission":"validate","access":access,"registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),"profile_options_json":json!({"identities":{"media":media,"references":[]},"limits":limits}).to_string()});
    let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
    let session = distribution.open(source, &options.to_string());
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
    command(
        s,
        COMMAND,
        json!({"kind":"insert_fragment","fragment_json":f.to_string()}),
    )
}
fn command(s: &mut DistributionSession, id: &str, payload: Value) -> Value {
    let stamp = state(s)["stamp"].clone();
    call(
        s,
        json!({"kind":"command","stamp":stamp,"command":{"id":id,"payload_json":payload.to_string()},"history_hint":{"kind":"isolated"}}),
    )
}
fn snapshot(s: &mut DistributionSession) -> Value {
    serde_json::from_str(&canonical_snapshot(s)).unwrap()
}
fn canonical_snapshot(s: &mut DistributionSession) -> String {
    let stamp = state(s)["stamp"].clone();
    let r = call(
        s,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":2097152}),
    );
    assert_eq!(r["status"], "ok", "{r}");
    let canonical = r["value"]["canonical_json"].as_str().unwrap().to_owned();
    assert_eq!(
        call(
            s,
            json!({"kind":"release_snapshot","handle":r["value"]["handle"]})
        )["status"],
        "ok"
    );
    canonical
}
fn undo(s: &mut DistributionSession) {
    history(s, "undo");
}
fn history(s: &mut DistributionSession, direction: &str) {
    let stamp = state(s)["stamp"].clone();
    let r = call(
        s,
        json!({"kind":"history","stamp":stamp,"direction":direction}),
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
fn prose_scene_break_survives_commands_clipboard_history_and_reopen() {
    const SOURCE: &str = r#"{"content":[{"content":[{"text":"До сцены","type":"text"}],"type":"paragraph"},{"content":[{"text":"После сцены","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;
    const WITH_SCENE: &str = r#"{"content":[{"content":[{"text":"До сцены","type":"text"}],"type":"paragraph"},{"type":"scene_break"},{"content":[{"text":"После сцены","type":"text"}],"type":"paragraph"}],"profile":"prose","schema":"klenwriter.document","schema_version":1}"#;

    let assert_history_round_trip = |session: &mut DistributionSession, before, after| {
        assert_eq!(canonical_snapshot(session), after);
        undo(session);
        assert_eq!(canonical_snapshot(session), before);
        history(session, "redo");
        assert_eq!(canonical_snapshot(session), after);
    };

    let mut s = open_bytes(SOURCE.as_bytes(), Value::Null);
    let root = state(&mut s)["root"].clone();
    let insertion_gap = gap(root, 1);
    select(&mut s, insertion_gap.clone(), insertion_gap.clone());
    let inserted = command(
        &mut s,
        "org.klenwriter.kwdj/command/insert-block",
        json!({"kind":"insert_block","target":{"kind":"scene_break"}}),
    );
    assert_eq!(inserted["status"], "ok", "{inserted}");
    assert_history_round_trip(&mut s, SOURCE, WITH_SCENE);

    let scene = role(&mut s, &[1]);
    let view = node(&mut s, &scene);
    assert_eq!(view["type_id"], "org.klenwriter.kwdj/scene_break");
    assert_eq!(view["primitive"], "block_atom");
    assert_eq!(view["attributes"], json!({}));
    assert_eq!(view["children"], json!([]));
    assert_eq!(view["text"], Value::Null);

    select(
        &mut s,
        json!({"kind":"edge","node":scene,"side":"before"}),
        json!({"kind":"edge","node":scene,"side":"after"}),
    );
    let selected = state(&mut s);
    let extracted = call(
        &mut s,
        json!({"kind":"selection_fragment","stamp":selected["stamp"],"max_bytes":2097152}),
    );
    assert_eq!(extracted["status"], "ok", "{extracted}");
    let clipboard = extracted["value"]["fragment_json"].as_str().unwrap();
    assert_eq!(
        serde_json::from_str::<Value>(clipboard).unwrap(),
        fragment(
            "prose",
            "blocks",
            json!([{"type":"scene_break"}]),
            false,
            false
        )
    );
    assert_eq!(state(&mut s), selected);

    let removed = command(
        &mut s,
        "org.klenwriter.kwdj/command/remove",
        json!({"kind":"remove","node":scene}),
    );
    assert_eq!(removed["status"], "ok", "{removed}");
    assert_history_round_trip(&mut s, WITH_SCENE, SOURCE);

    select(&mut s, insertion_gap.clone(), insertion_gap);
    let pasted = command(
        &mut s,
        COMMAND,
        json!({"kind":"insert_fragment","fragment_json":clipboard}),
    );
    assert_eq!(pasted["status"], "ok", "{pasted}");
    assert_history_round_trip(&mut s, SOURCE, WITH_SCENE);

    let saved = canonical_snapshot(&mut s);
    s.destroy();
    let mut reopened = open_bytes(saved.as_bytes(), Value::Null);
    assert_eq!(canonical_snapshot(&mut reopened), WITH_SCENE);
    assert_eq!(state(&mut reopened)["history"]["undo_entries"], "0");
}

#[test]
fn backspace_after_scene_break_preserves_a_valid_neighbor_caret() {
    let scene = json!({"type":"scene_break"});
    let command_id = "org.klenwriter.kwdj/command/delete-backward";
    for (content, scene_index, remaining, text_offset) in [
        (
            json!([p("До сцены"), scene, p("После сцены")]),
            1,
            json!([p("До сцены"), p("После сцены")]),
            Some(8),
        ),
        (
            json!([scene, p("После сцены")]),
            0,
            json!([p("После сцены")]),
            Some(0),
        ),
        (
            json!([scene]),
            0,
            json!([{"type":"paragraph","content":[]}]),
            None,
        ),
    ] {
        let source = doc("prose", content);
        let mut session = open(&source);
        let atom = role(&mut session, &[scene_index]);
        let after_atom = json!({"kind":"edge","node":atom,"side":"after"});
        select(&mut session, after_atom.clone(), after_atom.clone());
        let before = state(&mut session);
        let response = command(&mut session, command_id, json!({"kind":"delete_backward"}));
        assert_eq!(response["status"], "ok", "{response}");
        assert_eq!(snapshot(&mut session), doc("prose", remaining));
        let expected = match text_offset {
            Some(offset) => text(role(&mut session, &[0, 0]), offset),
            None => gap(role(&mut session, &[0]), 0),
        };
        assert_eq!(
            state(&mut session)["selection"],
            json!({"anchor":expected,"focus":expected})
        );
        assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
        undo(&mut session);
        assert_eq!(snapshot(&mut session), source);
        assert_eq!(state(&mut session)["selection"], before["selection"]);
    }
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

fn approved_media(case_id: &str) -> (Value, Value) {
    let corpus = if case_id == "DOC-022" {
        include_str!("../../../contracts/kwdj/v1/fixtures/mixed.json")
    } else {
        include_str!("../../../contracts/kwdj/v1/fixtures/positive.json")
    };
    let corpus: Value = serde_json::from_str(corpus).unwrap();
    let case = corpus["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|fixture| fixture["id"] == case_id)
        .unwrap()["cases"][0]
        .clone();
    assert_eq!(case["expected"]["outcome"], "accepted");
    let media = case["kwdj"]["content"]
        .as_array()
        .unwrap()
        .iter()
        .find(|node| node["type"] == "media_image")
        .unwrap()
        .clone();
    let id = &media["attrs"]["media_asset_id"];
    assert!(
        case["input"]["identity_state"]["existing_media_ids"]
            .as_array()
            .unwrap()
            .contains(id)
    );
    (case["kwdj"]["profile"].clone(), media)
}

#[test]
fn osr141_media_fragment_reinsertion_move_and_history_preserve_canonical_bytes() {
    for (case_id, decorative) in [
        ("DOC-013", false),
        ("DOC-027", false),
        ("DOC-022", false),
        ("DOC-027", true),
    ] {
        let (mode, mut media) = approved_media(case_id);
        let mode = mode.as_str().unwrap();
        if decorative {
            let attrs = media["attrs"].as_object_mut().unwrap();
            attrs.remove("alt");
            attrs.insert("decorative".into(), json!(true));
        }
        let left = p("Before");
        let right = p("After");
        let initial = doc(mode, json!([left, media, right])).to_string();
        let without_media = doc(mode, json!([left, right])).to_string();
        let moved = doc(mode, json!([left, right, media])).to_string();
        let facts = json!([{"id":media["attrs"]["media_asset_id"],"status":"exists"}]);
        let mut session = open_bytes_with_media(initial.as_bytes(), Value::Null, facts.clone());
        assert_eq!(canonical_snapshot(&mut session), initial, "{case_id}");
        let root = state(&mut session)["root"].clone();
        let media_id = role(&mut session, &[1]);
        let projection = node(&mut session, &media_id);
        assert_eq!(projection["primitive"], "container", "{case_id}");
        assert_eq!(projection["type_id"], "org.klenwriter.kwdj/media_image");

        select(&mut session, gap(root.clone(), 1), gap(root.clone(), 2));
        let stamp = state(&mut session)["stamp"].clone();
        let extracted = call(
            &mut session,
            json!({"kind":"selection_fragment","stamp":stamp,"max_bytes":8192}),
        );
        assert_eq!(extracted["status"], "ok", "{case_id}: {extracted}");
        assert_eq!(extracted["value"]["empty"], false);
        let clipboard = extracted["value"]["fragment_json"].as_str().unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(clipboard).unwrap(),
            fragment(mode, "blocks", json!([media]), false, false),
            "{case_id}"
        );
        assert_eq!(state(&mut session)["stamp"], stamp);
        assert_eq!(canonical_snapshot(&mut session), initial);

        let move_reply = command(
            &mut session,
            "org.klenwriter.kwdj/command/move",
            json!({"kind":"move","node":media_id,"parent":root,"before_index":3}),
        );
        assert_eq!(move_reply["value"]["effect"], "changed", "{move_reply}");
        assert_eq!(canonical_snapshot(&mut session), moved);
        assert_eq!(role(&mut session, &[2]), media_id);
        undo(&mut session);
        assert_eq!(canonical_snapshot(&mut session), initial);
        history(&mut session, "redo");
        assert_eq!(canonical_snapshot(&mut session), moved);
        undo(&mut session);

        let remove_reply = command(
            &mut session,
            "org.klenwriter.kwdj/command/remove",
            json!({"kind":"remove","node":media_id}),
        );
        assert_eq!(remove_reply["value"]["effect"], "changed", "{remove_reply}");
        assert_eq!(canonical_snapshot(&mut session), without_media);
        select(&mut session, gap(root.clone(), 1), gap(root, 1));
        let paste_reply = command(
            &mut session,
            COMMAND,
            json!({"kind":"insert_fragment","fragment_json":clipboard}),
        );
        assert_eq!(paste_reply["value"]["effect"], "changed", "{paste_reply}");
        assert_ne!(role(&mut session, &[1]), media_id);
        assert_eq!(canonical_snapshot(&mut session), initial);
        undo(&mut session);
        assert_eq!(canonical_snapshot(&mut session), without_media);
        history(&mut session, "redo");
        let exported = canonical_snapshot(&mut session);
        assert_eq!(exported, initial);
        let mut reopened = open_bytes_with_media(exported.as_bytes(), Value::Null, facts);
        assert_eq!(canonical_snapshot(&mut reopened), initial);
    }
}

#[test]
fn osr141_delete_selection_respects_media_and_caption_boundaries() {
    let (_, media) = approved_media("DOC-013");
    let left = p("Before");
    let right = p("After");
    let initial = doc("prose", json!([left, media, right])).to_string();
    let removed = doc("prose", json!([left, right])).to_string();
    let facts = json!([{"id":media["attrs"]["media_asset_id"],"status":"exists"}]);
    let mut session = open_bytes_with_media(initial.as_bytes(), Value::Null, facts);
    let root = state(&mut session)["root"].clone();
    let exact_media = role(&mut session, &[1]);
    let caption_leaf = role(&mut session, &[1, 0, 0]);

    let mut edited_media = media.clone();
    edited_media["content"][0]["content"][0]["text"] = json!("Ппись");
    let edited = doc("prose", json!([left, edited_media, right])).to_string();
    select(
        &mut session,
        text(caption_leaf.clone(), 1),
        text(caption_leaf.clone(), 3),
    );
    let caption_edit = command(
        &mut session,
        "org.klenwriter.kwdj/command/delete-selection",
        json!({"kind":"delete_selection"}),
    );
    assert_eq!(caption_edit["value"]["effect"], "changed", "{caption_edit}");
    assert_eq!(canonical_snapshot(&mut session), edited);
    assert_eq!(role(&mut session, &[1]), exact_media);
    undo(&mut session);
    assert_eq!(canonical_snapshot(&mut session), initial);

    // A range outside the caption and ending inside it cannot remove the media.
    select(&mut session, gap(root.clone(), 1), text(caption_leaf, 1));
    let before_partial = state(&mut session);
    let partial = command(
        &mut session,
        "org.klenwriter.kwdj/command/delete-selection",
        json!({"kind":"delete_selection"}),
    );
    assert_eq!(partial["status"], "refused", "{partial}");
    assert_eq!(state(&mut session), before_partial);
    assert_eq!(canonical_snapshot(&mut session), initial);

    select(&mut session, gap(root.clone(), 1), gap(root, 2));
    let whole = command(
        &mut session,
        "org.klenwriter.kwdj/command/delete-selection",
        json!({"kind":"delete_selection"}),
    );
    assert_eq!(whole["value"]["effect"], "changed", "{whole}");
    assert_eq!(canonical_snapshot(&mut session), removed);
    assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
    undo(&mut session);
    assert_eq!(canonical_snapshot(&mut session), initial);
    assert_eq!(role(&mut session, &[1]), exact_media);
    history(&mut session, "redo");
    assert_eq!(canonical_snapshot(&mut session), removed);
}

const OSR185_INSERT: &str = "org.klenwriter.kwdj/command/insert-block";
const OSR185_BACKSPACE: &str = "org.klenwriter.kwdj/command/delete-backward";

fn osr185_fixture() -> Value {
    serde_json::from_str(include_str!(
        "../../../tests/fixtures/osr-185-literary.json"
    ))
    .unwrap()
}

fn osr185_author_note_intent() -> Value {
    json!({"kind":"insert_block","target":{"kind":"literary_block","literary_kind":"author_note"}})
}

#[test]
fn osr185_nested_and_empty_literary_blocks_have_exact_history_and_reopen() {
    let fixture = osr185_fixture();
    let original = fixture["initial"].to_string();
    for result in ["nested", "empty"] {
        let expected = fixture[result].to_string();
        let mut session = open(&fixture["initial"]);
        let wrapper = role(&mut session, &[1]);
        let original_child = role(&mut session, &[1, 0]);
        assert_eq!(canonical_snapshot(&mut session), original);
        let edit = if result == "nested" {
            let point = gap(wrapper.clone(), 1);
            select(&mut session, point.clone(), point);
            command(&mut session, OSR185_INSERT, osr185_author_note_intent())
        } else {
            command(
                &mut session,
                "org.klenwriter.kwdj/command/remove",
                json!({"kind":"remove","node":original_child}),
            )
        };
        assert_eq!(edit["value"]["effect"], "changed", "{result}: {edit}");
        assert_eq!(canonical_snapshot(&mut session), expected, "{result}");
        assert_eq!(role(&mut session, &[1]), wrapper);
        let empty_child = if result == "nested" {
            assert_eq!(role(&mut session, &[1, 0]), original_child);
            role(&mut session, &[1, 1, 0])
        } else {
            let replacement = role(&mut session, &[1, 0]);
            assert_ne!(replacement, original_child);
            replacement
        };
        let point = gap(empty_child, 0);
        let changed = state(&mut session);
        assert_eq!(changed["selection"], json!({"anchor":point,"focus":point}));
        assert_eq!(changed["stamp"]["revision"], "1");
        assert_eq!(changed["history"]["undo_entries"], "1");
        undo(&mut session);
        assert_eq!(canonical_snapshot(&mut session), original, "{result}");
        assert_eq!(role(&mut session, &[1, 0]), original_child);
        history(&mut session, "redo");
        let saved = canonical_snapshot(&mut session);
        assert_eq!(saved, expected, "{result}");
        let mut reopened = open_bytes(saved.as_bytes(), Value::Null);
        assert_eq!(canonical_snapshot(&mut reopened), expected, "{result}");
        assert_eq!(state(&mut reopened)["history"]["undo_entries"], "0");
    }
}

#[test]
fn osr279_closed_labeled_fragments_preserve_both_kinds_and_refuse_self_recursion() {
    let fixture: Value = serde_json::from_str(include_str!(
        "../../../tests/fixtures/osr-279-spoiler-disclosure.json"
    ))
    .unwrap();
    let cases = fixture["containers"].as_array().unwrap();
    let blocks = json!([cases[0]["copied"], cases[1]["copied"]]);
    let original = doc("prose", blocks);
    let bytes = original.to_string();
    let mut session = open(&original);
    let root = role(&mut session, &[]);
    for (index, case) in cases.iter().enumerate() {
        let copied = &case["copied"];
        select(
            &mut session,
            gap(root.clone(), index),
            gap(root.clone(), index + 1),
        );
        let captured = osr186_capture(
            &mut session,
            fragment("prose", "blocks", json!([copied]), false, false),
        );
        let end = gap(root.clone(), 2);
        select(&mut session, end.clone(), end);
        let mut at_root = original.clone();
        at_root["content"]
            .as_array_mut()
            .unwrap()
            .push(copied.clone());
        osr186_paste_and_undo(&mut session, &captured, at_root, &bytes);

        let other = 1 - index;
        let end = gap(role(&mut session, &[other]), 1);
        select(&mut session, end.clone(), end);
        let mut nested = original.clone();
        nested["content"][other]["content"]
            .as_array_mut()
            .unwrap()
            .push(copied.clone());
        osr186_paste_and_undo(&mut session, &captured, nested, &bytes);

        let end = gap(role(&mut session, &[index]), 1);
        select(&mut session, end.clone(), end);
        osr185_refusal(
            &mut session,
            COMMAND,
            json!({"kind":"insert_fragment","fragment_json":captured.to_string()}),
            &bytes,
            &json!({"code":case["recursion"],"path":format!("/content/{index}/content/1")}),
        );
    }
}

fn osr185_refusal(
    session: &mut DistributionSession,
    id: &str,
    payload: Value,
    original: &str,
    expected: &Value,
) {
    let before = state(session);
    let reply = command(session, id, payload);
    assert_eq!(reply["status"], "refused", "{reply}");
    assert_eq!(reply["diagnostic"]["code"], expected["code"], "{reply}");
    assert_eq!(reply["diagnostic"]["path"], expected["path"], "{reply}");
    assert_eq!(state(session), before);
    assert_eq!(canonical_snapshot(session), original);
}

#[test]
fn osr185_literary_boundaries_and_restricted_parents_refuse_atomically() {
    let fixture = osr185_fixture();
    let expected = &fixture["refusals"];
    let original = fixture["initial"].to_string();
    let mut session = open(&fixture["initial"]);
    let first_child = role(&mut session, &[1, 0, 0]);
    let point = text(first_child.clone(), 0);
    select(&mut session, point.clone(), point);
    osr185_refusal(
        &mut session,
        OSR185_BACKSPACE,
        json!({"kind":"delete_backward"}),
        &original,
        &expected["first_child_backspace"],
    );
    let previous = role(&mut session, &[0, 0]);
    select(&mut session, text(previous, 6), text(first_child, 1));
    osr185_refusal(
        &mut session,
        "org.klenwriter.kwdj/command/delete-selection",
        json!({"kind":"delete_selection"}),
        &original,
        &expected["crossing_delete"],
    );

    let restricted = fixture["restricted"].to_string();
    let media_id = &fixture["restricted"]["content"][1]["attrs"]["media_asset_id"];
    let mut session = open_bytes_with_media(
        restricted.as_bytes(),
        Value::Null,
        json!([{"id":media_id,"status":"exists"}]),
    );
    for (index, test) in ["verse_target", "media_target"].into_iter().enumerate() {
        let parent = role(&mut session, &[index]);
        let point = gap(parent, 1);
        select(&mut session, point.clone(), point);
        osr185_refusal(
            &mut session,
            OSR185_INSERT,
            osr185_author_note_intent(),
            &restricted,
            &expected[test],
        );
    }
}

fn osr186_capture(session: &mut DistributionSession, expected: Value) -> Value {
    let before = state(session);
    let read = call(
        session,
        json!({"kind":"selection_fragment","stamp":before["stamp"],"max_bytes":8192}),
    );
    assert_eq!(read["status"], "ok", "{read}");
    assert_eq!(read["value"]["empty"], false);
    assert_eq!(state(session), before);
    let captured: Value =
        serde_json::from_str(read["value"]["fragment_json"].as_str().unwrap()).unwrap();
    assert_eq!(captured, expected);
    captured
}

fn osr186_paste_and_undo(
    session: &mut DistributionSession,
    captured: &Value,
    expected: Value,
    original: &str,
) {
    let reply = paste(session, captured);
    assert_eq!(reply["value"]["effect"], "changed", "{reply}");
    assert_eq!(canonical_snapshot(session), expected.to_string());
    assert_eq!(state(session)["history"]["undo_entries"], "1");
    undo(session);
    assert_eq!(canonical_snapshot(session), original);
}

#[test]
fn osr278_warning_clipboard_keeps_whole_blocks_and_selected_children() {
    let corpus: Value = serde_json::from_str(include_str!(
        "../../../contracts/kwdj/v1/fixtures/positive.json"
    ))
    .unwrap();
    let cases = &corpus["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["id"] == "DOC-016")
        .unwrap()["cases"];
    let original = &cases
        .as_array()
        .unwrap()
        .iter()
        .find(|item| item["name"] == "warning_kinds")
        .unwrap()["kwdj"];
    let blocks = original["content"].as_array().unwrap();
    assert_eq!(blocks.len(), 2);
    assert_eq!(blocks[0]["attrs"]["kind"], "general");
    assert_eq!(blocks[1]["attrs"]["kind"], "content");
    let original_bytes = original.to_string();

    let mut session = open(original);
    let root = role(&mut session, &[]);
    for (index, block) in blocks.iter().enumerate() {
        let target_index = 1 - index;
        let target = role(&mut session, &[target_index]);
        select(
            &mut session,
            gap(root.clone(), index),
            gap(root.clone(), index + 1),
        );
        let whole = osr186_capture(
            &mut session,
            fragment("prose", "blocks", json!([block]), false, false),
        );

        let target_gap = gap(target.clone(), 1);
        select(&mut session, target_gap.clone(), target_gap);
        osr185_refusal(
            &mut session,
            COMMAND,
            json!({"kind":"insert_fragment","fragment_json":whole.to_string()}),
            &original_bytes,
            &json!({"code":"kwdj.recursive_warning","path":format!("/content/{target_index}/content/1")}),
        );

        let root_end = gap(root.clone(), blocks.len());
        select(&mut session, root_end.clone(), root_end);
        let mut expected = original.clone();
        expected["content"]
            .as_array_mut()
            .unwrap()
            .push(block.clone());
        osr186_paste_and_undo(&mut session, &whole, expected, &original_bytes);

        let source = role(&mut session, &[index]);
        select(&mut session, gap(source.clone(), 0), gap(source, 1));
        let child = &block["content"][0];
        let children = osr186_capture(
            &mut session,
            fragment("prose", "blocks", json!([child]), false, false),
        );
        let target_gap = gap(target, 1);
        select(&mut session, target_gap.clone(), target_gap);
        let mut expected = original.clone();
        expected["content"][target_index]["content"]
            .as_array_mut()
            .unwrap()
            .push(child.clone());
        osr186_paste_and_undo(&mut session, &children, expected, &original_bytes);
    }
}

#[test]
fn osr186_closed_literary_fragments_retain_all_kinds_and_nested_children() {
    let fixtures: Value = serde_json::from_str(include_str!(
        "../../../contracts/kwdj/v1/fixtures/positive.json"
    ))
    .unwrap();
    let original = &fixtures["fixtures"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "DOC-015")
        .unwrap()["cases"][0]["kwdj"];
    let blocks = original["content"].as_array().unwrap();
    assert_eq!(blocks.len(), 6);
    let mut session = open(original);
    let root = role(&mut session, &[]);
    for (index, block) in blocks.iter().enumerate() {
        select(
            &mut session,
            gap(root.clone(), index),
            gap(root.clone(), index + 1),
        );
        let captured = osr186_capture(
            &mut session,
            fragment("prose", "blocks", json!([block]), false, false),
        );
        let end = gap(root.clone(), blocks.len());
        select(&mut session, end.clone(), end);
        let mut expected = original.clone();
        expected["content"]
            .as_array_mut()
            .unwrap()
            .push(block.clone());
        osr186_paste_and_undo(&mut session, &captured, expected, &original.to_string());
    }

    let original = &osr185_fixture()["nested"];
    let mut session = open(original);
    let root = role(&mut session, &[]);
    let wrapper = role(&mut session, &[1]);
    for (parent, start, block) in [
        (root, 1, &original["content"][1]),
        (wrapper.clone(), 1, &original["content"][1]["content"][1]),
    ] {
        select(
            &mut session,
            gap(parent.clone(), start),
            gap(parent, start + 1),
        );
        let captured = osr186_capture(
            &mut session,
            fragment("prose", "blocks", json!([block]), false, false),
        );
        let target = gap(wrapper.clone(), 2);
        select(&mut session, target.clone(), target);
        let mut expected = original.clone();
        expected["content"][1]["content"]
            .as_array_mut()
            .unwrap()
            .push(block.clone());
        osr186_paste_and_undo(&mut session, &captured, expected, &original.to_string());
    }
}

#[test]
fn osr186_inline_children_paste_exactly_and_invalid_or_read_only_targets_refuse() {
    let mut original = osr185_fixture()["nested"].clone();
    original["content"].as_array_mut().unwrap().push(json!({
        "type":"bullet_list","content":[{"type":"list_item","content":[p("List")]}]
    }));
    let mut session = open(&original);
    let source = role(&mut session, &[1, 0, 0]);
    select(&mut session, text(source.clone(), 1), text(source, 4));
    let inline = json!([{"type":"text","text":"uth","marks":[{"type":"emphasis"}]}]);
    let captured = osr186_capture(
        &mut session,
        fragment("prose", "inline", inline.clone(), false, false),
    );
    let target = gap(role(&mut session, &[1, 1, 0]), 0);
    select(&mut session, target.clone(), target);
    let mut expected = original.clone();
    expected["content"][1]["content"][1]["content"][0]["content"] = inline;
    let original_bytes = original.to_string();
    osr186_paste_and_undo(&mut session, &captured, expected, &original_bytes);

    let target = gap(role(&mut session, &[1]), 1);
    select(&mut session, target.clone(), target);
    osr185_refusal(
        &mut session,
        COMMAND,
        json!({"kind":"insert_fragment","fragment_json":captured.to_string()}),
        &original_bytes,
        &json!({"code":"kwdj.command_unsupported_context","path":"/clipboard"}),
    );
    for access in ["editable", "read_only"] {
        let mut session =
            open_bytes_with_access(original_bytes.as_bytes(), Value::Null, json!([]), access);
        let root = role(&mut session, &[]);
        select(&mut session, gap(root.clone(), 1), gap(root.clone(), 2));
        let captured = osr186_capture(
            &mut session,
            fragment(
                "prose",
                "blocks",
                json!([original["content"][1]]),
                false,
                false,
            ),
        );
        let (target, refusal) = if access == "editable" {
            (
                gap(role(&mut session, &[3]), 1),
                json!({"code":"kwdj.invalid_profile_content","path":"/content/3/content/1"}),
            )
        } else {
            (gap(root, 4), json!({"code":"session.read_only","path":""}))
        };
        select(&mut session, target.clone(), target);
        osr185_refusal(
            &mut session,
            COMMAND,
            json!({"kind":"insert_fragment","fragment_json":captured.to_string()}),
            &original_bytes,
            &refusal,
        );
    }
}
