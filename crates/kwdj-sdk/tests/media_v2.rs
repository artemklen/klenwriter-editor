// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use klenwriter_editor_kwdj_sdk as editor_kwdj_sdk;
use serde_json::{Value, json};

const MEDIA_COMMAND: &str = "org.klenwriter.kwdj/command/media";
const FIRST_MEDIA: &str = "11111111-1111-4111-8111-111111111111";
const SECOND_MEDIA: &str = "22222222-2222-4222-8222-222222222222";
const UNAVAILABLE_MEDIA: &str = "33333333-3333-4333-8333-333333333333";

fn document(profile: &str, content: Value) -> Value {
    json!({"schema":"klenwriter.document","schema_version":1,"profile":profile,"content":content})
}

fn paragraph(text: &str) -> Value {
    json!({"type":"paragraph","content":[{"type":"text","text":text}]})
}

fn open(document: &Value) -> DistributionSession {
    let build_id = "kwdj-media-v2";
    let options = json!({
        "abi":"editor-sdk/2", "build_id":build_id, "profile":editor_kwdj_sdk::manifest().profiles[0],
        "admission":"validate", "access":"editable",
        "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
        "profile_options_json":json!({"identities":{
            "media":[{"id":FIRST_MEDIA,"status":"exists"},{"id":SECOND_MEDIA,"status":"exists"}],
            "references":[]
        },"limits":null}).to_string()
    });
    let session = Distribution::new(build_id, vec![Box::new(editor_kwdj_sdk::KwdjFactory)])
        .unwrap()
        .open(document.to_string().as_bytes(), &options.to_string());
    assert!(matches!(
        session.initialization(),
        editor_protocol::SdkResponse::Ok { .. }
    ));
    session
}

fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}

fn state(session: &mut DistributionSession) -> Value {
    let result = call(session, json!({"kind":"state"}));
    assert_eq!(result["status"], "ok", "{result}");
    result["value"]["state"].clone()
}

fn node_at(session: &mut DistributionSession, path: &[usize]) -> Value {
    let state = state(session);
    let mut id = state["root"].clone();
    for index in path {
        let node = call(
            session,
            json!({"kind":"node","stamp":state["stamp"],"node":id}),
        );
        assert_eq!(node["status"], "ok", "{node}");
        id = node["value"]["node"]["children"][*index].clone();
    }
    assert!(id.is_string(), "{id}");
    id
}

fn text(node: &Value, offset: u32) -> Value {
    json!({"kind":"text","node":node,"offset":offset,"affinity":"after"})
}

fn root_gap(root: &Value, index: usize) -> Value {
    json!({"kind":"child","parent":root,"index":index,"affinity":"after"})
}

fn collapsed(position: &Value) -> Value {
    json!({"anchor":position,"focus":position})
}

fn select(session: &mut DistributionSession, selection: &Value) {
    let stamp = state(session)["stamp"].clone();
    let reply = call(
        session,
        json!({"kind":"set_selection","stamp":stamp,"selection":selection}),
    );
    assert_eq!(reply["status"], "ok", "{reply}");
}

fn media_command(session: &mut DistributionSession, kind: &str, payload: &Value) -> Value {
    let stamp = state(session)["stamp"].clone();
    let mut request = json!({"kind":kind,"stamp":stamp,"command":{"id":MEDIA_COMMAND,"payload_json":payload.to_string()}});
    if kind == "command" {
        request["history_hint"] = json!({"kind":"isolated"});
    }
    call(session, request)
}

fn snapshot(session: &mut DistributionSession) -> String {
    let stamp = state(session)["stamp"].clone();
    let result = call(
        session,
        json!({"kind":"snapshot","stamp":stamp,"max_bytes":2097152}),
    );
    assert_eq!(result["status"], "ok", "{result}");
    assert_eq!(
        call(
            session,
            json!({"kind":"release_snapshot","handle":result["value"]["handle"]})
        )["status"],
        "ok"
    );
    result["value"]["canonical_json"]
        .as_str()
        .unwrap()
        .to_owned()
}

fn history(
    session: &mut DistributionSession,
    direction: &str,
    selection: &Value,
    document: &Value,
) {
    let stamp = state(session)["stamp"].clone();
    let result = call(
        session,
        json!({"kind":"history","stamp":stamp,"direction":direction}),
    );
    assert_eq!(result["value"]["effect"], "changed", "{result}");
    assert_eq!(state(session)["selection"], *selection);
    assert_eq!(snapshot(session), document.to_string());
}

#[test]
fn osr292_media_after_root_preserves_caret_and_gallery_order() {
    let verse = json!({"type":"verse","content":[
        {"type":"verse_line","attrs":{"indent":3},"content":[{"type":"text","text":"Первая строка"}]},
        {"type":"stanza_break","attrs":{"blank_lines":2}},
        {"type":"verse_line","content":[{"type":"text","text":"Вторая строка"}]}
    ]});
    let heading = json!({"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"A heading"}]});
    for (profile, block, leaf_path) in [
        ("prose", paragraph("Before/after"), &[0, 0][..]),
        ("prose", heading, &[0, 0][..]),
        ("poetry", verse, &[0, 0, 0][..]),
    ] {
        let next = paragraph("Next");
        let original = document(profile, json!([block, next]));
        let first_image = json!({"type":"media_image",
            "attrs":{"media_asset_id":FIRST_MEDIA,"align":"wide","alt":"Рукопись"},
            "content":[paragraph("Подпись\nПродолжение")]});
        let second_image = json!({"type":"media_image","attrs":{"media_asset_id":SECOND_MEDIA,"align":"center","decorative":true}});
        let mut session = open(&original);
        let original_block = node_at(&mut session, &[0]);
        let original_leaf = node_at(&mut session, leaf_path);
        let original_caret = collapsed(&text(&original_leaf, 3));
        select(&mut session, &original_caret);
        let before = state(&mut session);
        let payload = json!({"kind":"insert_media","media_asset_id":FIRST_MEDIA,
            "accessibility":{"kind":"alt","alt":"Рукопись"},
            "placement":{"kind":"after_root_block","node":original_block},
            "align":"wide","caption":"Подпись\r\nПродолжение"});
        let query = media_command(&mut session, "query_command", &payload);
        assert_eq!(query["value"]["available"], true, "{profile}: {query}");
        assert_eq!(state(&mut session), before);
        let inserted = media_command(&mut session, "command", &payload);
        assert_eq!(
            inserted["value"]["effect"], "changed",
            "{profile}: {inserted}"
        );
        let first_gap = collapsed(&root_gap(&before["root"], 2));
        assert_eq!(state(&mut session)["selection"], first_gap);
        assert_eq!(node_at(&mut session, &[0]), original_block);
        assert_eq!(node_at(&mut session, leaf_path), original_leaf);
        let first = document(profile, json!([block, first_image, next]));
        assert_eq!(snapshot(&mut session), first.to_string());
        let first_image_id = node_at(&mut session, &[1]);
        let inserted = media_command(
            &mut session,
            "command",
            &json!({
                "kind":"insert_media","media_asset_id":SECOND_MEDIA,"accessibility":{"kind":"decorative"},
                "placement":{"kind":"after_root_block","node":first_image_id},"align":"center","caption":""
            }),
        );
        assert_eq!(
            inserted["value"]["effect"], "changed",
            "{profile}: {inserted}"
        );
        let second_gap = collapsed(&root_gap(&before["root"], 3));
        let gallery = document(profile, json!([block, first_image, second_image, next]));
        assert_eq!(state(&mut session)["selection"], second_gap);
        assert_eq!(snapshot(&mut session), gallery.to_string());
        history(&mut session, "undo", &first_gap, &first);
        history(&mut session, "undo", &original_caret, &original);
        history(&mut session, "redo", &first_gap, &first);
        history(&mut session, "redo", &second_gap, &gallery);
        assert_eq!(snapshot(&mut open(&gallery)), gallery.to_string());
    }
}

#[test]
fn osr292_media_refusals_preserve_document_selection_and_history() {
    let authored = document(
        "prose",
        json!([paragraph("Before"),{"type":"blockquote","content":[paragraph("Nested")]}]),
    );
    let mut session = open(&authored);
    let paragraph_id = node_at(&mut session, &[0]);
    let quote = node_at(&mut session, &[1]);
    let leaf = node_at(&mut session, &[0, 0]);
    let nested = node_at(&mut session, &[1, 0, 0]);
    let valid = json!({"kind":"insert_media","media_asset_id":FIRST_MEDIA,"accessibility":{"kind":"decorative"},
        "placement":{"kind":"after_root_block","node":paragraph_id}});
    let caret = collapsed(&text(&leaf, 3));
    let mut wrong_anchor = valid.clone();
    wrong_anchor["placement"]["node"] = quote.clone();
    let mut unavailable = valid.clone();
    unavailable["media_asset_id"] = json!(UNAVAILABLE_MEDIA);
    let mut invalid_align = valid.clone();
    invalid_align["align"] = json!("left");
    let mut rich_caption = valid.clone();
    rich_caption["caption"] = json!([paragraph("No")]);
    let mut null_caption = valid.clone();
    null_caption["caption"] = Value::Null;
    let root = state(&mut session)["root"].clone();
    for (selection, payload, code) in [
        (
            caret.clone(),
            wrong_anchor.clone(),
            "kwdj.command_unsupported_context",
        ),
        (
            collapsed(&text(&nested, 3)),
            wrong_anchor,
            "kwdj.command_unsupported_context",
        ),
        (
            json!({"anchor":text(&leaf,1),"focus":text(&leaf,3)}),
            valid.clone(),
            "kwdj.command_unsupported_context",
        ),
        (
            collapsed(&root_gap(&root, 1)),
            valid,
            "kwdj.command_unsupported_context",
        ),
        (
            caret.clone(),
            unavailable,
            "kwdj.identity_resolution_failed",
        ),
        (caret.clone(), invalid_align, "sdk.invalid_dto"),
        (caret.clone(), rich_caption, "sdk.invalid_dto"),
        (caret.clone(), null_caption, "sdk.invalid_dto"),
    ] {
        select(&mut session, &selection);
        let before = state(&mut session);
        let reply = media_command(&mut session, "command", &payload);
        assert_eq!(reply["status"], "refused", "{payload}: {reply}");
        assert_eq!(reply["diagnostic"]["code"], code, "{payload}: {reply}");
        assert_eq!(state(&mut session), before);
        assert_eq!(snapshot(&mut session), authored.to_string());
    }
    select(&mut session, &caret);
    let legacy = media_command(
        &mut session,
        "command",
        &json!({
            "kind":"insert_media","media_asset_id":FIRST_MEDIA,"accessibility":{"kind":"decorative"}
        }),
    );
    assert_eq!(legacy["value"]["effect"], "changed", "{legacy}");
    assert_eq!(snapshot(&mut session), document("prose", json!([
        paragraph("Bef"), {"type":"media_image","attrs":{"media_asset_id":FIRST_MEDIA,"align":"none","decorative":true}},
        paragraph("ore"), {"type":"blockquote","content":[paragraph("Nested")]}
    ])).to_string());
}
