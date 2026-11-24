// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::{Distribution, DistributionSession, Endpoint};
use klenwriter_editor_kwdj_sdk as editor_kwdj_sdk;
use serde_json::{Value, json};

const BUILD: &str = "osr203-table-admission";

fn call(session: &mut DistributionSession, request: Value) -> Value {
    serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
}

fn assert_export(session: &mut DistributionSession, expected: &str, name: &str) -> String {
    let before = call(session, json!({"kind":"state"}));
    assert_eq!(before["status"], "ok", "{name}: {before}");
    let state = &before["value"]["state"];
    assert_eq!(state["stamp"]["revision"], "0", "{name}");
    assert_eq!(state["history"]["undo_entries"], "0", "{name}");
    assert_eq!(state["dirty"], false, "{name}");
    let snapshot = call(
        session,
        json!({"kind":"snapshot","stamp":state["stamp"],"max_bytes":8192}),
    );
    assert_eq!(snapshot["status"], "ok", "{name}: {snapshot}");
    let exported = snapshot["value"]["canonical_json"].as_str().unwrap();
    assert_eq!(exported, expected, "{name}");
    let released = call(
        session,
        json!({"kind":"release_snapshot","handle":snapshot["value"]["handle"]}),
    );
    assert_eq!(released["status"], "ok", "{name}: {released}");
    assert_eq!(call(session, json!({"kind":"state"})), before, "{name}");
    exported.to_owned()
}

#[test]
fn osr203_retained_tables_admit_reopen_or_refuse_without_publication() {
    let corpus = [
        include_str!("../../../contracts/kwdj/v1/fixtures/positive.json"),
        include_str!("../../../contracts/kwdj/v1/fixtures/mixed.json"),
    ]
    .map(|source| serde_json::from_str::<Value>(source).unwrap());
    let distribution =
        Distribution::new(BUILD, vec![Box::new(editor_kwdj_sdk::KwdjFactory)]).unwrap();
    let options = |admission| {
        json!({
            "abi":"editor-sdk/2","build_id":BUILD,"profile":editor_kwdj_sdk::manifest().profiles[0],
            "admission":admission,"access":"read_only",
            "registry_json":serde_json::to_string(&editor_kwdj::registry::registry_descriptor()).unwrap(),
            "profile_options_json":"{\"identities\":{\"media\":[],\"references\":[]},\"limits\":null}"
        })
        .to_string()
    };
    let mut seen = 0;
    for case in corpus
        .iter()
        .flat_map(|file| file["fixtures"].as_array().unwrap())
        .filter(|fixture| {
            matches!(
                fixture["id"].as_str(),
                Some("DOC-010" | "DOC-011" | "DOC-012")
            )
        })
        .flat_map(|fixture| fixture["cases"].as_array().unwrap())
    {
        let name = case["name"].as_str().unwrap();
        let (input, admission) = match name {
            "pre_normalized_unit_spans_removed" => (&case["input"]["value"], "normalize"),
            _ => (&case["kwdj"], "validate"),
        };
        let source = serde_json::to_vec_pretty(input).unwrap();
        let original = source.clone();
        let mut session = distribution.open(&source, &options(admission));
        let ready = serde_json::to_value(session.initialization()).unwrap();
        let refusal_path = match name {
            "normalized_unit_spans_rejected" => {
                Some("/content/0/content/0/content/0/attrs/rowspan")
            }
            "malformed_effective_grid" => Some("/content/0"),
            _ => None,
        };
        if let Some(path) = refusal_path {
            assert_eq!(ready["status"], "refused", "{name}: {ready}");
            assert_eq!(
                ready["diagnostic"]["code"], case["expected"]["diagnostic_codes"][0],
                "{name}"
            );
            assert_eq!(ready["diagnostic"]["path"], path, "{name}");
            assert_eq!(ready["diagnostic"]["may_have_committed"], false, "{name}");
            assert!(session.context().is_none(), "{name}");
            assert_eq!(session.own_resource_counts().sessions, 0, "{name}");
            let state = call(&mut session, json!({"kind":"state"}));
            assert_eq!(state["status"], "refused", "{name}: {state}");
            assert_eq!(state["diagnostic"]["code"], "sdk.disposed", "{name}");
            assert_eq!(state["diagnostic"]["stamp"], Value::Null, "{name}");
            eprintln!("{name}: {admission} refused at {path}");
        } else {
            assert_eq!(ready["status"], "ok", "{name}: {ready}");
            let canonical = case["kwdj"].to_string();
            let exported = assert_export(&mut session, &canonical, name);
            let mut reopened = distribution.open(exported.as_bytes(), &options("validate"));
            assert_export(&mut reopened, &canonical, name);
            reopened.destroy();
            eprintln!("{name}: {admission}, exact export and strict reopen");
        }
        assert_eq!(source, original, "{name}");
        session.destroy();
        seen += 1;
    }
    assert_eq!(seen, 6);
}
