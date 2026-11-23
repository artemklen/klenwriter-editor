// SPDX-License-Identifier: MIT OR Apache-2.0
//! The KWDJ compiled module's V2 factory; common distribution has no KWDJ policy.
use crate::convert::{diagnostic, profile_error, profile_in};
use crate::wire::{IdentityFactsDto, ProfileLimitsDto, SdkRequest};
use crate::{KwdjAdapter, dispatch_kwdj};
use editor_bridge::recipes::{RecipeAdapter, registry_diagnostic};
use editor_bridge::{
    Bridge, BridgeOpen, CreatedEndpoint, Endpoint, SessionFactory, capability_digest, decode,
};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_engine::AccessMode;
use editor_extensions::Recipes;
use editor_kwdj::KwdjProfile;
use editor_protocol::v2::{CompiledProfileV2, OpenOptionsV2};
use editor_protocol::{
    AccessDto, AdmissionDto, DiagnosticDto, ExtensionDto, ResourceCountsDto, SdkResponse,
};
use editor_registry::CompilerLimits;
use serde::{Deserialize, Deserializer, Serialize};

#[cfg_attr(
    all(feature = "sdk-types", not(target_arch = "wasm32")),
    derive(ts_rs::TS)
)]
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KwdjOptionsV2 {
    pub identities: IdentityFactsDto,
    #[serde(deserialize_with = "required_option")]
    pub limits: Option<ProfileLimitsDto>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[cfg_attr(all(feature = "sdk-types", not(target_arch = "wasm32")), ts(optional = nullable))]
    pub typing_rules: Option<crate::wire_v2::KwdjTypingRulesV2>,
}
fn required_option<'de, T: Deserialize<'de>, D: Deserializer<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::<T>::deserialize(d)
}

#[derive(Debug, Clone, Copy, Default)]
pub struct KwdjFactory;
impl SessionFactory for KwdjFactory {
    fn capability(&self) -> CompiledProfileV2 {
        CompiledProfileV2 {
            profile_id: editor_kwdj::PROFILE_ID.into(),
            profile_version: editor_kwdj::KWDJ_PROFILE_VERSION.into(),
            codec_id: editor_kwdj::KWDJ_CODEC_ID.into(),
            wire_version: 1,
            compiled_extensions: vec![
                ExtensionDto {
                    id: editor_kwdj::KWDJ_BASE_EXTENSION_ID.into(),
                    version: editor_kwdj::KWDJ_BASE_EXTENSION_VERSION.into(),
                },
                ExtensionDto {
                    id: editor_kwdj::registry::TYPING_EXTENSION_ID.into(),
                    version: editor_kwdj::registry::TYPING_EXTENSION_VERSION.into(),
                },
            ],
        }
    }
    fn open(
        &self,
        input: &[u8],
        options: &OpenOptionsV2,
    ) -> Result<CreatedEndpoint, DiagnosticDto> {
        let profile_options: KwdjOptionsV2 = decode(&options.profile_options_json)?;
        let (adapter, profile) =
            KwdjAdapter::prepare_owned(profile_options.identities, profile_options.limits)?;
        let mut work = WorkMeter::new(WorkLimits::default());
        let typing = profile_options
            .typing_rules
            .map(typing_config)
            .transpose()?;
        let profile = if let Some(typing) = typing {
            profile.with_typing_registry_json(
                typing,
                options.registry_json.as_bytes(),
                CompilerLimits::default(),
                &mut work,
            )
        } else {
            profile.with_clipboard_registry_json(
                options.registry_json.as_bytes(),
                CompilerLimits::default(),
                &mut work,
            )
        }
        .map_err(|error| profile_error(&error))?;
        let binding = profile_in(&options.profile)?;
        profile
            .binding()
            .ensure_matches(&binding)
            .map_err(|error| diagnostic(error.as_str(), "profile"))?;
        let registry_digest = profile.registry().digest().to_hex();
        let capability_digest = capability_digest(
            &options.build_id,
            &registry_digest,
            &capability_bytes(&profile)?,
        )?;
        let adapter = RecipeAdapter::new(
            crate::clipboard_v2::ClipboardAdapterV2(adapter),
            profile.registry_handle(),
        );
        let profile =
            Recipes::new(profile, &mut work).map_err(|error| registry_diagnostic(&error))?;
        let inner = Bridge::new(
            input,
            BridgeOpen {
                profile,
                binding,
                admission: match options.admission {
                    AdmissionDto::Validate => AdmissionMode::Strict,
                    AdmissionDto::Normalize => AdmissionMode::Import,
                },
                access: match options.access {
                    AccessDto::Editable => AccessMode::Editable,
                    AccessDto::ReadOnly => AccessMode::ReadOnly,
                },
            },
            adapter,
        );
        Ok(CreatedEndpoint {
            endpoint: Box::new(KwdjEndpoint { inner }),
            registry_digest,
            capability_digest,
        })
    }
}
fn capability_bytes(profile: &KwdjProfile<'_>) -> Result<Vec<u8>, DiagnosticDto> {
    let limits = profile.limits();
    let budget = profile.budget();
    // Fixed-order field names and exact decimal strings; aliases/oversized host
    // reductions produce the same effective capability, never a raw-input hash.
    let mut fields = vec![
        ("document_bytes", limits.document_bytes.to_string()),
        ("tree_depth", limits.tree_depth.to_string()),
        ("node_count", limits.node_count.to_string()),
        ("text_leaf_bytes", limits.text_leaf_bytes.to_string()),
        ("table_rows", limits.table_rows.to_string()),
        (
            "table_effective_columns",
            limits.table_effective_columns.to_string(),
        ),
        (
            "authored_attribute_bytes",
            limits.authored_attribute_bytes.to_string(),
        ),
        ("raw_input_bytes", budget.raw_input_bytes.to_string()),
        (
            "preflight_payload_bytes",
            budget.preflight.payload_bytes.to_string(),
        ),
        ("preflight_values", budget.preflight.values.to_string()),
        ("preflight_depth", budget.preflight.depth.to_string()),
        (
            "admission_cache_work_units",
            profile.admission_cache_work_limits().units.to_string(),
        ),
        (
            "admission_cache_work_bytes",
            profile.admission_cache_work_limits().bytes.to_string(),
        ),
    ];
    if let Some(typing) = profile.typing_rules() {
        fields.push(("typing_rules_version", "1".into()));
        fields.push((
            "typing_locale",
            match typing.locale() {
                editor_kwdj::typing::Locale::Ru => "ru",
                editor_kwdj::typing::Locale::En => "en",
            }
            .into(),
        ));
        fields.push(("typing_features", typing.feature_names().join(",")));
        fields.extend(
            typing
                .limits()
                .values()
                .map(|(name, value)| (name, value.to_string())),
        );
    }
    serde_json::to_vec(&fields).map_err(|_| diagnostic("sdk.transport_failed", "capabilities"))
}

fn typing_config(
    value: crate::wire_v2::KwdjTypingRulesV2,
) -> Result<editor_kwdj::typing::TypingRules, DiagnosticDto> {
    use crate::wire_v2::{KwdjTypingFeatureV2 as F, KwdjTypingLocaleV2 as L};
    use editor_kwdj::typing::{Feature, Locale, TypingLimits, TypingRules};
    let invalid = || diagnostic("kwdj.typing_invalid_configuration", "typing_rules");
    if value.version != 1 {
        return Err(invalid());
    }
    let mut limits = TypingLimits::default();
    if let Some(v) = value.limits {
        macro_rules! reduce { ($($field:ident),*) => { $(if let Some(value) = v.$field { limits.$field = value; })* }; }
        reduce!(
            lookbehind_scalars,
            inline_slots,
            ancestor_depth,
            selected_scalars,
            selected_utf8,
            selected_nodes,
            mark_records,
            work_units,
            work_bytes,
            restoration_bytes
        );
    }
    let features = value.rules.map(|values| {
        values
            .into_iter()
            .map(|v| match v {
                F::SpacedEmDash => Feature::SpacedEmDash,
                F::DoubleQuotes => Feature::DoubleQuotes,
                F::CyrillicNbsp => Feature::CyrillicNbsp,
            })
            .collect::<Vec<_>>()
    });
    TypingRules::new(
        match value.locale {
            L::Ru => Locale::Ru,
            L::En => Locale::En,
        },
        features.as_deref(),
        limits,
    )
    .ok_or_else(invalid)
}
struct KwdjEndpoint {
    inner: Bridge<
        Recipes<KwdjProfile<'static>>,
        RecipeAdapter<crate::clipboard_v2::ClipboardAdapterV2>,
    >,
}
impl Endpoint for KwdjEndpoint {
    fn initialization(&self) -> SdkResponse {
        self.inner.initialization()
    }
    fn call_json(&mut self, json: &str) -> String {
        if let Some(response) = self.inner.retained_fatal_response() {
            return self.inner.encode_response(response);
        }
        if let Ok(request) = decode::<editor_protocol::v2::InputCommandRequestV2>(json) {
            return self
                .inner
                .call_json_v2(&serde_json::to_string(&request).expect("closed input serializes"));
        }
        if let Ok(request) = decode::<editor_protocol::v2::QueryInputCommandRequestV2>(json) {
            return self.inner.call_json_v2(
                &serde_json::to_string(&request).expect("closed input query serializes"),
            );
        }
        if let Ok(request) = decode::<editor_protocol::v2::ClipboardContextRequestV2>(json) {
            return self.inner.call_json_v2(
                &serde_json::to_string(&request).expect("closed clipboard read serializes"),
            );
        }
        if let Ok(request) = decode::<editor_protocol::v2::SelectionFragmentRequestV2>(json) {
            return self.inner.call_json_v2(
                &serde_json::to_string(&request).expect("closed clipboard read serializes"),
            );
        }
        if let Ok(request) = decode::<editor_protocol::v2::TextWindowRequestV2>(json) {
            return self
                .inner
                .call_json_v2(&serde_json::to_string(&request).expect("closed read serializes"));
        }
        if let Ok(request) = decode::<editor_protocol::v2::SelectionTextRequestV2>(json) {
            return self
                .inner
                .call_json_v2(&serde_json::to_string(&request).expect("closed read serializes"));
        }
        let response = match decode::<SdkRequest>(json) {
            Ok(request) => dispatch_kwdj(&mut self.inner, request),
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        self.inner.encode_response(response)
    }
    fn destroy(&mut self) {
        self.inner.destroy();
    }
    fn own_resource_counts(&self) -> ResourceCountsDto {
        self.inner.own_resource_counts()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use editor_bridge::{Distribution, DistributionSession};
    use serde_json::{Value, json};
    const INPUT:&[u8]=br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}"#;
    const EXPECT_X: &str = r#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"x"}]}]}"#;
    const BUILD: &str = "kwdj-factory-focused-native";
    fn options(runtime_recipe: bool) -> Value {
        let mut descriptor =
            serde_json::to_value(editor_kwdj::registry::registry_descriptor()).unwrap();
        let mut profile = serde_json::to_value(crate::manifest().profiles.remove(0)).unwrap();
        if runtime_recipe {
            let extension = json!({"id":"org.example.kwdj/replace","version":"1.0.0"});
            descriptor["selected_extensions"]
                .as_array_mut()
                .unwrap()
                .push(extension.clone());
            profile["extensions"]
                .as_array_mut()
                .unwrap()
                .push(extension);
            descriptor["extensions"].as_array_mut().unwrap().push(json!({"id":"org.example.kwdj/replace","version":"1.0.0","dependencies":[],"nodes":[],"marks":[],"commands":[{"kind":"recipe","id":"org.example.kwdj/command/replace-first","parameters":{"leaf":{"kind":"node"}},"operations":[{"op":"replace_text","leaf":{"kind":"argument","name":"leaf"},"from":{"kind":"literal","value":0},"to":{"kind":"literal","value":1},"text":{"kind":"literal","value":"x"}}],"selection":{"kind":"map_current"},"stored_marks":{"kind":"keep"}}]}));
        }
        json!({"abi":"editor-sdk/2","build_id":BUILD,"profile":profile,"admission":"validate","access":"editable","registry_json":descriptor.to_string(),"profile_options_json":json!({"identities":{"media":[],"references":[]},"limits":null}).to_string()})
    }
    fn call(session: &mut DistributionSession, request: Value) -> Value {
        serde_json::from_str(&session.call_json(&request.to_string())).unwrap()
    }
    fn state(session: &mut DistributionSession) -> Value {
        let response = call(session, json!({"kind":"state"}));
        assert_eq!(response["status"], "ok", "{response}");
        response["value"]["state"].clone()
    }
    fn snapshot(session: &mut DistributionSession) -> String {
        let stamp = state(session)["stamp"].clone();
        let response = call(
            session,
            json!({"kind":"snapshot","stamp":stamp,"max_bytes":16777216}),
        );
        assert_eq!(response["status"], "ok", "{response}");
        let canonical = response["value"]["canonical_json"]
            .as_str()
            .unwrap()
            .to_owned();
        assert_eq!(
            call(
                session,
                json!({"kind":"release_snapshot","handle":response["value"]["handle"]})
            )["status"],
            "ok"
        );
        canonical
    }
    #[test]
    fn real_kwdj_compiled_and_runtime_catalog_commands_history_and_fact_guard() {
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut session = distribution.open(INPUT, &options(true).to_string());
        assert!(matches!(session.initialization(), SdkResponse::Ok { .. }));
        assert!(session.context().is_some());
        let catalog = call(&mut session, json!({"kind":"catalog"}));
        assert_eq!(catalog["value"]["commands"].as_array().unwrap().len(), 28);
        assert!(
            catalog["value"]["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|v| v == "org.klenwriter.kwdj/command/delete-selection")
        );
        assert!(
            catalog["value"]["commands"]
                .as_array()
                .unwrap()
                .iter()
                .any(|x| x == "org.klenwriter.kwdj/command/insert-text")
        );
        let before = state(&mut session);
        let root = before["root"].clone();
        let rootnode = call(
            &mut session,
            json!({"kind":"node","stamp":before["stamp"],"node":root}),
        );
        let paragraph = rootnode["value"]["node"]["children"][0].clone();
        let p = call(
            &mut session,
            json!({"kind":"node","stamp":before["stamp"],"node":paragraph}),
        );
        let leaf = p["value"]["node"]["children"][0].clone();
        let command = json!({"id":"org.example.kwdj/command/replace-first","payload_json":json!({"kind":"recipe","arguments":{"nodes":{"leaf":leaf},"values":{}}}).to_string()});
        let query = call(
            &mut session,
            json!({"kind":"query_command","stamp":before["stamp"],"command":command}),
        );
        assert_eq!(query["value"]["available"], true, "{query}");
        assert_eq!(state(&mut session), before);
        let applied = call(
            &mut session,
            json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}}),
        );
        assert_eq!(applied["value"]["effect"], "changed", "{applied}");
        assert_eq!(
            serde_json::from_str::<Value>(&snapshot(&mut session)).unwrap(),
            serde_json::from_str::<Value>(EXPECT_X).unwrap()
        );
        for (direction, expected) in [
            ("undo", std::str::from_utf8(INPUT).unwrap()),
            ("redo", EXPECT_X),
        ] {
            let stamp = state(&mut session)["stamp"].clone();
            let response = call(
                &mut session,
                json!({"kind":"history","stamp":stamp,"direction":direction}),
            );
            assert_eq!(response["value"]["effect"], "changed", "{response}");
            assert_eq!(
                serde_json::from_str::<Value>(&snapshot(&mut session)).unwrap(),
                serde_json::from_str::<Value>(expected).unwrap()
            );
        }
        let current = state(&mut session);
        let response = call(
            &mut session,
            json!({"kind":"node","stamp":current["stamp"],"node":leaf}),
        );
        assert_eq!(response["value"]["node"]["text"], "x");
        let failed = call(
            &mut session,
            json!({"kind":"update_facts","stamp":before["stamp"],"identities":{"media":[],"references":[]}}),
        );
        assert_eq!(failed["status"], "refused");
        assert_eq!(failed["diagnostic"]["code"], "session.stale_revision");
        assert_eq!(state(&mut session), current);
        let updated = call(
            &mut session,
            json!({"kind":"update_facts","stamp":current["stamp"],"identities":{"media":[],"references":[]}}),
        );
        assert_eq!(updated["status"], "ok", "{updated}");
        session.destroy();
        assert_eq!(session.own_resource_counts().sessions, 0);
        assert_eq!(session.own_resource_counts().protected_cursors, 0);
    }
    #[test]
    fn closed_options_and_effective_capability_digest_precede_document_decode() {
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let original = options(false);
        let normal = distribution.open(INPUT, &original.to_string());
        let base = normal.context().unwrap().capability_digest.clone();
        let mut explicit_default = original.clone();
        let limits = json!({"document_bytes":"18446744073709551615","tree_depth":null,"node_count":null,"text_leaf_bytes":null,"table_rows":null,"table_effective_columns":null,"authored_attribute_bytes":null});
        explicit_default["profile_options_json"] = Value::String(
            json!({"identities":{"media":[],"references":[]},"limits":limits}).to_string(),
        );
        assert_eq!(
            distribution
                .open(INPUT, &explicit_default.to_string())
                .context()
                .unwrap()
                .capability_digest,
            base
        );
        for (key, value) in [
            ("document_bytes", "1024"),
            ("tree_depth", "4"),
            ("node_count", "10"),
            ("text_leaf_bytes", "16"),
            ("table_rows", "10"),
            ("table_effective_columns", "10"),
            ("authored_attribute_bytes", "128"),
        ] {
            let mut lowered = explicit_default.clone();
            let mut profile_options: Value =
                serde_json::from_str(lowered["profile_options_json"].as_str().unwrap()).unwrap();
            profile_options["limits"][key] = value.into();
            lowered["profile_options_json"] = Value::String(profile_options.to_string());
            let lowered_session = distribution.open(INPUT, &lowered.to_string());
            assert!(
                matches!(lowered_session.initialization(), SdkResponse::Ok { .. }),
                "{key}"
            );
            assert_ne!(
                lowered_session.context().unwrap().capability_digest,
                base,
                "{key}: effective limit is bound"
            );
        }
        for profile_options in [
            json!({"identities":{"media":[],"references":[]}}),
            json!({"identities":{"media":[],"references":[]},"limits":null,"extra":true}),
        ] {
            let mut options = original.clone();
            options["profile_options_json"] = Value::String(profile_options.to_string());
            let refused = distribution.open(b"bad document", &options.to_string());
            assert!(
                matches!(refused.initialization(),SdkResponse::Refused{diagnostic} if diagnostic.code=="sdk.invalid_dto")
            );
            assert!(refused.context().is_none());
            assert_eq!(refused.own_resource_counts().sessions, 0);
        }
        let mut invalid_registry = original;
        invalid_registry["registry_json"] = "{}".into();
        let refused = distribution.open(b"bad document", &invalid_registry.to_string());
        assert!(
            matches!(refused.initialization(),SdkResponse::Refused{diagnostic} if diagnostic.code=="registry.invalid_descriptor")
        );
        assert_eq!(refused.own_resource_counts().sessions, 0);
    }
    #[test]
    fn independent_kwdj_corpus_39_document_candidates_through_v2_factory() {
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut executed = 0;
        let mut accepted = 0;
        let mut refused = 0;
        let mut failures = vec![];
        for raw in [
            include_str!("../../../contracts/kwdj/v1/fixtures/positive.json"),
            include_str!("../../../contracts/kwdj/v1/fixtures/mixed.json"),
            include_str!("../../../contracts/kwdj/v1/fixtures/negative.json"),
            include_str!("../../../contracts/kwdj/v1/fixtures/deferred.json"),
        ] {
            let corpus: Value = serde_json::from_str(raw).unwrap();
            for fixture in corpus["fixtures"].as_array().unwrap() {
                for case in fixture["cases"].as_array().unwrap() {
                    if case["kwdj"].is_null() {
                        continue;
                    }
                    let id = format!(
                        "{}/{}",
                        fixture["id"].as_str().unwrap(),
                        case["name"].as_str().unwrap()
                    );
                    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        let mut options = options(false);
                        let facts = &case["input"]["identity_state"];
                        let entries = |key: &str| -> Vec<Value> {
                            facts[key]
                                .as_array()
                                .map(|ids| {
                                    ids.iter()
                                        .map(|id| json!({"id":id,"status":"exists"}))
                                        .collect()
                                })
                                .unwrap_or_default()
                        };
                        options["profile_options_json"]=Value::String(json!({"identities":{"media":entries("existing_media_ids"),"references":entries("existing_reference_ids")},"limits":null}).to_string());
                        let prenormalized =
                            case["input"]["kind"] == "kwdj" && case["input"].get("value").is_some();
                        if prenormalized {
                            options["admission"] = "normalize".into();
                        }
                        let input = if prenormalized {
                            &case["input"]["value"]
                        } else {
                            &case["kwdj"]
                        };
                        let mut session =
                            distribution.open(input.to_string().as_bytes(), &options.to_string());
                        match session.initialization() {
                            SdkResponse::Ok { .. } => {
                                assert_eq!(case["expected"]["outcome"], "accepted", "{id}");
                                assert_eq!(
                                    snapshot(&mut session),
                                    case["kwdj"].to_string(),
                                    "{id}: independent authored canonical document"
                                );
                                let catalog = call(&mut session, json!({"kind":"catalog"}));
                                let expected: Vec<_> = editor_kwdj::commands::KWDJ_COMMANDS
                                    .iter()
                                    .map(|command| command.id)
                                    .collect();
                                let actual: Vec<_> = catalog["value"]["commands"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .map(|id| id.as_str().unwrap())
                                    .collect();
                                let mut sorted = expected.clone();
                                sorted.push(editor_kwdj::commands::CLIPBOARD_COMMAND_ID);
                                sorted.push(editor_kwdj::commands::SET_LITERARY_KIND_COMMAND_ID);
                                sorted.push(editor_kwdj::commands::WRAP_LITERARY_BLOCK_COMMAND_ID);
                                sorted
                                    .push(editor_kwdj::commands::UNWRAP_LITERARY_BLOCK_COMMAND_ID);
                                sorted.push(editor_kwdj::commands::SET_CONTAINER_LABEL_COMMAND_ID);
                                sorted
                                    .push(editor_kwdj::commands::WRAP_LABELED_CONTAINER_COMMAND_ID);
                                sorted.push(
                                    editor_kwdj::commands::UNWRAP_LABELED_CONTAINER_COMMAND_ID,
                                );
                                sorted.push(editor_kwdj::commands::SET_WARNING_KIND_COMMAND_ID);
                                sorted.push(editor_kwdj::commands::WRAP_WARNING_COMMAND_ID);
                                sorted.push(editor_kwdj::commands::UNWRAP_WARNING_COMMAND_ID);
                                sorted.sort_unstable();
                                assert_eq!(actual, sorted, "{id}: frozenV2catalog IDs");
                                // ABI1 catalog order remains the original compiled order.
                                let legacy_options = crate::wire::OpenOptions {
                                    abi: crate::wire::SDK_ABI.into(),
                                    build_id: crate::BUILD_ID.into(),
                                    profile: crate::manifest().profiles.remove(0),
                                    admission: if prenormalized {
                                        AdmissionDto::Normalize
                                    } else {
                                        AdmissionDto::Validate
                                    },
                                    access: AccessDto::Editable,
                                    identities: decode::<KwdjOptionsV2>(
                                        options["profile_options_json"].as_str().unwrap(),
                                    )
                                    .unwrap()
                                    .identities,
                                    limits: None,
                                };
                                let mut legacy = crate::BridgeSession::new(
                                    input.to_string().as_bytes(),
                                    &serde_json::to_string(&legacy_options).unwrap(),
                                );
                                let SdkResponse::Ok { value } =
                                    legacy.call(crate::wire::SdkRequest::Catalog {})
                                else {
                                    panic!("{id}: legacy catalog")
                                };
                                let editor_protocol::SdkReply::Catalog { commands } = *value else {
                                    panic!("catalog reply")
                                };
                                assert_eq!(commands, expected);
                                accepted += 1;
                            }
                            SdkResponse::Refused { diagnostic } => {
                                assert_ne!(
                                    case["expected"]["outcome"], "accepted",
                                    "{id}: {diagnostic:?}"
                                );
                                assert!(
                                    case["expected"]["diagnostic_codes"]
                                        .as_array()
                                        .unwrap()
                                        .iter()
                                        .any(|code| code == &diagnostic.code),
                                    "{id}: {diagnostic:?}"
                                );
                                assert!(session.context().is_none());
                                assert_eq!(session.own_resource_counts().sessions, 0);
                                refused += 1;
                            }
                            other => panic!("{id}: {other:?}"),
                        }
                        session.destroy();
                    }));
                    if result.is_err() {
                        failures.push(id);
                    }
                    executed += 1;
                }
            }
        }
        assert_eq!(executed, 39);
        assert!(
            failures.is_empty(),
            "independent KWDJ corpus failures: {failures:?}"
        );
        assert!(accepted > 0 && refused > 0);
        println!(
            "KWDJ V2 independent corpus: {accepted} accepted/exported, {refused} typed refused; 39 candidates. Resource recipes and non-codec stages are separate."
        );
    }
    #[test]
    fn runtime_extra_declarations_do_not_bypass_kwdj_wire_invariants() {
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut options = options(true);
        let mut descriptor: Value =
            serde_json::from_str(options["registry_json"].as_str().unwrap()).unwrap();
        let extension = &mut descriptor["extensions"][0];
        extension["nodes"] = json!([{"id":"org.example.kwdj/atom","primitive":"block_atom","attrs":{},"children":{"op":"empty"},"marks":[]}]);
        extension["marks"] = json!([{"id":"org.example.kwdj/highlight","attrs":{},"excludes":[]}]);
        options["registry_json"] = Value::String(descriptor.to_string());
        assert!(matches!(
            distribution
                .open(INPUT, &options.to_string())
                .initialization(),
            SdkResponse::Ok { .. }
        ));
        for (input, code) in [
            (
                json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"org.example.kwdj/atom"}]}),
                "kwdj.unknown_node",
            ),
            (
                json!({"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a","marks":[{"type":"org.example.kwdj/highlight"}]}]}]}),
                "kwdj.unknown_mark",
            ),
        ] {
            let session = distribution.open(input.to_string().as_bytes(), &options.to_string());
            assert!(
                matches!(session.initialization(),SdkResponse::Refused{diagnostic} if diagnostic.code==code)
            );
            assert!(session.context().is_none());
            assert_eq!(session.own_resource_counts().sessions, 0);
        }
    }
    #[test]
    fn module_fact_updates_recheck_command_and_history_with_same_captured_requests() {
        const REFERENCE: &str = "550e8400-e29b-41d4-a716-446655440006";
        let corpus: Value = serde_json::from_str(include_str!(
            "../../../contracts/kwdj/v1/fixtures/positive.json"
        ))
        .unwrap();
        let input = corpus["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|fixture| fixture["id"] == "DOC-006")
            .unwrap()["cases"][0]["kwdj"]
            .clone();
        assert_eq!(input["content"][0]["content"][0]["text"], "Имя");
        let facts =
            |status: &str| json!({"media":[],"references":[{"id":REFERENCE,"status":status}]});
        let mut options = options(true);
        options["profile_options_json"] =
            Value::String(json!({"identities":facts("exists"),"limits":null}).to_string());
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut session = distribution.open(input.to_string().as_bytes(), &options.to_string());
        assert!(matches!(session.initialization(), SdkResponse::Ok { .. }));
        let before = state(&mut session);
        let root = call(
            &mut session,
            json!({"kind":"node","stamp":before["stamp"],"node":before["root"]}),
        );
        let paragraph = call(
            &mut session,
            json!({"kind":"node","stamp":before["stamp"],"node":root["value"]["node"]["children"][0]}),
        );
        let leaf = paragraph["value"]["node"]["children"][0].clone();
        let command = json!({"id":"org.example.kwdj/command/replace-first","payload_json":json!({"kind":"recipe","arguments":{"nodes":{"leaf":leaf},"values":{}}}).to_string()});
        let query = json!({"kind":"query_command","stamp":before["stamp"],"command":command});
        let execute = json!({"kind":"command","stamp":before["stamp"],"command":command,"history_hint":{"kind":"isolated"}});
        for (status, code) in [
            ("missing", "kwdj.reference_identity_unresolved"),
            ("unavailable", "kwdj.identity_resolution_failed"),
        ] {
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"update_facts","stamp":before["stamp"],"identities":facts(status)})
                )["status"],
                "ok"
            );
            let unavailable = call(&mut session, query.clone());
            assert_eq!(unavailable["value"]["available"], false);
            assert_eq!(unavailable["value"]["diagnostic"]["code"], code);
            let refusal = call(&mut session, execute.clone());
            assert_eq!(refusal["status"], "refused");
            assert_eq!(refusal["diagnostic"]["code"], code);
            assert_eq!(state(&mut session), before);
        }
        assert_eq!(
            call(
                &mut session,
                json!({"kind":"update_facts","stamp":before["stamp"],"identities":facts("exists")})
            )["status"],
            "ok"
        );
        assert_eq!(call(&mut session, query)["value"]["available"], true);
        assert_eq!(call(&mut session, execute)["value"]["effect"], "changed");
        let mut changed = input.clone();
        changed["content"][0]["content"][0]["text"] = "xмя".into();
        assert_eq!(snapshot(&mut session), changed.to_string());
        for (direction, expected) in [("undo", &input), ("redo", &changed)] {
            let before = state(&mut session);
            let captured = json!({"kind":"history","stamp":before["stamp"],"direction":direction});
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"update_facts","stamp":before["stamp"],"identities":facts("missing")})
                )["status"],
                "ok"
            );
            let query = call(
                &mut session,
                json!({"kind":"query_history","stamp":before["stamp"],"direction":direction}),
            );
            assert_eq!(query["value"]["available"], false);
            assert_eq!(
                query["value"]["diagnostic"]["code"],
                "kwdj.reference_identity_unresolved"
            );
            assert_eq!(
                call(&mut session, captured.clone())["diagnostic"]["code"],
                "kwdj.reference_identity_unresolved"
            );
            assert_eq!(state(&mut session), before);
            assert_eq!(
                call(
                    &mut session,
                    json!({"kind":"update_facts","stamp":before["stamp"],"identities":facts("exists")})
                )["status"],
                "ok"
            );
            assert_eq!(call(&mut session, captured)["value"]["effect"], "changed");
            assert_eq!(snapshot(&mut session), expected.to_string());
            let current = state(&mut session);
            let live = call(
                &mut session,
                json!({"kind":"node","stamp":current["stamp"],"node":leaf}),
            );
            assert_eq!(live["status"], "ok");
        }
        session.destroy();
        assert_eq!(session.own_resource_counts().sessions, 0);
    }
    #[test]
    fn v2_post_commit_transport_failure_is_terminal_before_any_json_decode() {
        use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};
        let (adapter, profile) =
            KwdjAdapter::prepare_owned(crate::wire::IdentityFactsDto::default(), None).unwrap();
        let mut work = WorkMeter::new(WorkLimits::default());
        let profile = profile
            .with_clipboard_registry_json(
                serde_json::to_string(&editor_kwdj::registry::registry_descriptor())
                    .unwrap()
                    .as_bytes(),
                CompilerLimits::default(),
                &mut work,
            )
            .unwrap();
        let binding = profile.binding().clone();
        let adapter = RecipeAdapter::new(
            crate::clipboard_v2::ClipboardAdapterV2(adapter),
            profile.registry_handle(),
        );
        let profile = Recipes::new(profile, &mut work).unwrap();
        let mut endpoint = KwdjEndpoint {
            inner: Bridge::new(
                INPUT,
                BridgeOpen {
                    profile,
                    binding,
                    admission: AdmissionMode::Strict,
                    access: AccessMode::Editable,
                },
                adapter,
            ),
        };
        let session = endpoint.inner.session_mut().unwrap();
        let root = session.root(session.key()).unwrap();
        let paragraph = session.node(session.key(), root).unwrap().children()[0];
        let leaf = session.node(session.key(), paragraph).unwrap().children()[0];
        let caret = Position::Text {
            leaf,
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        };
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
        let stamp = endpoint.inner.state().unwrap().stamp;
        let applied:Value=serde_json::from_str(&endpoint.call_json(&json!({"kind":"command","stamp":stamp,"command":{"id":"org.klenwriter.kwdj/command/insert-text","payload_json":json!({"kind":"insert_text","text":"X"}).to_string()},"history_hint":{"kind":"isolated"}}).to_string())).unwrap();
        assert_eq!(applied["value"]["effect"], "changed");
        let session = endpoint.inner.session().unwrap();
        assert_eq!(session.revision(), 1);
        assert_eq!(
            session.node(session.key(), leaf).unwrap().text(),
            Some("aX")
        );
        let fatal: SdkResponse = serde_json::from_str(&endpoint.inner.transport_failure()).unwrap();
        let SdkResponse::Fatal { diagnostic } = &fatal else {
            panic!("expected actual forced postpublication fatal")
        };
        assert!(diagnostic.may_have_committed);
        assert_eq!(diagnostic.stamp.as_ref().unwrap().revision, "1");
        for raw in [
            "{",
            r#"{"kind":"state","extra":true}"#,
            r#"{"kind":"state"}"#,
        ] {
            let actual: SdkResponse = serde_json::from_str(&endpoint.call_json(raw)).unwrap();
            assert_eq!(
                actual, fatal,
                "V2 module wrapper terminal Fatal before decode"
            );
            assert_eq!(endpoint.own_resource_counts().sessions, 0);
            assert_eq!(endpoint.own_resource_counts().protected_cursors, 0);
        }
        endpoint.destroy();
        endpoint.destroy();
    }

    const OSR192_SET_LABEL: &str = "org.klenwriter.kwdj/command/set-container-label";
    const OSR192_LABEL_INPUT: &str =
        include_str!("../../../tests/fixtures/osr-192-label-entry.input.json");
    const OSR192_LABEL_ENTRY: &str =
        include_str!("../../../tests/fixtures/osr-192-label-entry.canonical.json");
    const OSR192_EDITS: [(&str, &str); 2] = [("Финал!", "Фина!"), ("Подробнее?", "Подробне?")];

    #[test]
    fn osr192_label_insert_delete_empty_refusal_and_undo() {
        let mut expected: Value = serde_json::from_str(OSR192_LABEL_INPUT).unwrap();
        let mut session = osr183_open(OSR192_LABEL_INPUT);
        let root = state(&mut session)["root"].clone();
        let blocks = osr183_node(&mut session, &root)["children"].clone();
        for (index, (inserted, deleted)) in OSR192_EDITS.into_iter().enumerate() {
            let block = &blocks[index];
            let initial = osr183_node(&mut session, block);
            let prior = expected.to_string();
            for label in [inserted, deleted] {
                let before = state(&mut session);
                let result = osr183_command(
                    &mut session,
                    OSR192_SET_LABEL,
                    &json!({"kind":"set_container_label","node":block,"label":label}),
                    false,
                );
                assert_eq!(result["value"]["effect"], "changed", "{result}");
                let after = state(&mut session);
                for (old, new) in [
                    (&before["stamp"]["revision"], &after["stamp"]["revision"]),
                    (
                        &before["history"]["undo_entries"],
                        &after["history"]["undo_entries"],
                    ),
                ] {
                    assert_eq!(
                        new,
                        &(old.as_str().unwrap().parse::<u64>().unwrap() + 1).to_string()
                    );
                }
                let updated = osr183_node(&mut session, block);
                assert_eq!(updated["attributes"]["label"]["value"], label);
                assert_eq!(updated["children"], initial["children"]);
                assert_eq!(osr183_node(&mut session, &root)["children"], blocks);
                expected["content"][index]["attrs"]["label"] = json!(label);
                assert_eq!(snapshot(&mut session), expected.to_string());
            }
            let before_empty = state(&mut session);
            let refusal = osr183_command(
                &mut session,
                OSR192_SET_LABEL,
                &json!({"kind":"set_container_label","node":block,"label":""}),
                false,
            );
            assert_eq!(refusal["status"], "refused", "{refusal}");
            assert_eq!(
                refusal["diagnostic"]["code"], "kwdj.invalid_structure",
                "{refusal}"
            );
            assert_eq!(
                refusal["diagnostic"]["path"],
                format!("/content/{index}/attrs/label")
            );
            assert_eq!(refusal["diagnostic"]["may_have_committed"], false);
            assert_eq!(state(&mut session), before_empty);
            assert_eq!(snapshot(&mut session), expected.to_string());

            expected["content"][index]["attrs"]["label"] = json!(inserted);
            osr183_history(&mut session, "undo", &expected.to_string());
            osr183_history(&mut session, "undo", &prior);
            let restored = osr183_node(&mut session, block);
            assert_eq!(restored["attributes"], initial["attributes"]);
            assert_eq!(restored["children"], initial["children"]);
            osr183_history(&mut session, "redo", &expected.to_string());
        }
        assert_eq!(snapshot(&mut session), OSR192_LABEL_ENTRY);
        assert_eq!(state(&mut session)["history"]["undo_entries"], "2");
        for id in [&blocks[2], &root] {
            osr183_denied(
                &mut session,
                OSR192_SET_LABEL,
                json!({"kind":"set_container_label","node":id,"label":"Метка"}),
                OSR192_LABEL_ENTRY,
                "kwdj.command_invalid_target",
            );
        }
    }

    #[test]
    fn osr192_body_edit_preserves_authored_labels() {
        let mut session = osr183_open(OSR192_LABEL_ENTRY);
        let root = state(&mut session)["root"].clone();
        let blocks = osr183_node(&mut session, &root)["children"].clone();
        for index in 0..OSR192_EDITS.len() {
            let before = osr183_node(&mut session, &blocks[index]);
            let paragraph = osr183_node(&mut session, &before["children"][0]);
            let leaf = &paragraph["children"][0];
            let mut expected: Value = serde_json::from_str(OSR192_LABEL_ENTRY).unwrap();
            let text = &mut expected["content"][index]["content"][0]["content"][0]["text"];
            let body = text.as_str().unwrap();
            let point = json!({"kind":"text","node":leaf,"offset":body.encode_utf16().count(),"affinity":"after"});
            let stamp = state(&mut session)["stamp"].clone();
            let selection = call(
                &mut session,
                json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":point,"focus":point}}),
            );
            assert_eq!(selection["status"], "ok", "{selection}");
            *text = json!(format!("{body}."));
            let result = osr183_command(
                &mut session,
                "org.klenwriter.kwdj/command/insert-text",
                &json!({"kind":"insert_text","text":"."}),
                false,
            );
            assert_eq!(result["value"]["effect"], "changed", "{result}");
            assert_eq!(snapshot(&mut session), expected.to_string());
            let after = osr183_node(&mut session, &blocks[index]);
            assert_eq!(after["attributes"], before["attributes"]);
            assert_eq!(after["children"], before["children"]);
            osr183_history(&mut session, "undo", OSR192_LABEL_ENTRY);
        }
    }

    const OSR183_INSERT: &str = "org.klenwriter.kwdj/command/insert-block";
    const OSR183_SET_KIND: &str = "org.klenwriter.kwdj/command/set-literary-kind";

    fn osr183_open(input: &str) -> DistributionSession {
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let session = distribution.open(input.as_bytes(), &options(false).to_string());
        assert!(matches!(session.initialization(), SdkResponse::Ok { .. }));
        session
    }

    fn osr183_literal(contents: Value) -> String {
        json!({
            "content": contents, "profile": "prose",
            "schema": "klenwriter.document", "schema_version": 1
        })
        .to_string()
    }

    fn osr183_node(session: &mut DistributionSession, id: &Value) -> Value {
        let stamp = state(session)["stamp"].clone();
        let response = call(session, json!({"kind":"node","stamp":stamp,"node":id}));
        assert_eq!(response["status"], "ok", "{response}");
        response["value"]["node"].clone()
    }

    fn osr183_command(
        session: &mut DistributionSession,
        id: &str,
        payload: &Value,
        query: bool,
    ) -> Value {
        let stamp = state(session)["stamp"].clone();
        let command = json!({"id":id,"payload_json":payload.to_string()});
        let request = if query {
            json!({"kind":"query_command","stamp":stamp,"command":command})
        } else {
            json!({"kind":"command","stamp":stamp,"command":command,"history_hint":{"kind":"isolated"}})
        };
        call(session, request)
    }

    fn osr183_history(session: &mut DistributionSession, direction: &str, expected: &str) {
        let stamp = state(session)["stamp"].clone();
        let reply = call(
            session,
            json!({"kind":"history","stamp":stamp,"direction":direction}),
        );
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(session), expected);
    }

    fn osr183_denied(
        session: &mut DistributionSession,
        command_id: &str,
        payload: Value,
        canonical: &str,
        code: &str,
    ) {
        let before = state(session);
        let reply = osr183_command(session, command_id, &payload, false);
        assert_eq!(reply["status"], "refused", "{reply}");
        assert_eq!(reply["diagnostic"]["code"], code, "{reply}");
        assert_eq!(state(session), before);
        assert_eq!(snapshot(session), canonical);
    }

    const OSR188_SET_KIND: &str = "org.klenwriter.kwdj/command/set-warning-kind";

    fn osr188_case() -> Value {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../contracts/kwdj/v1/fixtures/positive.json"
        ))
        .unwrap();
        fixtures["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|fixture| fixture["id"] == "DOC-016")
            .unwrap()["cases"][0]
            .clone()
    }

    #[test]
    fn osr188_doc016_reads_projects_and_reopens_both_warning_kinds() {
        let case = osr188_case();
        let document = &case["kwdj"];
        let canonical = document.to_string();
        let mut session = osr183_open(&canonical);
        let root = state(&mut session)["root"].clone();
        let warnings = osr183_node(&mut session, &root)["children"].clone();
        assert_eq!(warnings.as_array().unwrap().len(), 2);
        for index in 0..2 {
            let expected = &document["content"][index];
            let actual = osr183_node(&mut session, &warnings[index]);
            assert_eq!(actual["type_id"], "org.klenwriter.kwdj/warning");
            assert_eq!(actual["primitive"], "container");
            assert_eq!(
                actual["attributes"]["kind"]["value"],
                expected["attrs"]["kind"]
            );
            assert_eq!(
                actual["attributes"]["label"]["value"],
                expected["attrs"]["label"]
            );
            let child = osr183_node(&mut session, &actual["children"][0]);
            let leaf = osr183_node(&mut session, &child["children"][0]);
            assert_eq!(leaf["text"], expected["content"][0]["content"][0]["text"]);
        }
        let saved = snapshot(&mut session);
        assert_eq!(saved, canonical);
        let mut reopened = osr183_open(&saved);
        assert_eq!(snapshot(&mut reopened), canonical);
        let facts = crate::FactStore(Default::default());
        let parsed = editor_kwdj::validate_normalized_json(saved.as_bytes(), &facts).unwrap();
        let projection = parsed.project_text().unwrap();
        assert_eq!(
            projection.full_text,
            case["expected"]["full_text"].as_str().unwrap()
        );
        assert_eq!(
            projection.search_index_text,
            case["expected"]["search_index_text"].as_str().unwrap()
        );
        assert_eq!(
            projection.public_snippet_text,
            case["expected"]["public_snippet_text"].as_str().unwrap()
        );
    }

    #[test]
    fn osr188_root_gap_create_uses_both_legacy_warning_defaults() {
        let left = json!({"type":"paragraph","content":[{"type":"text","text":"Before"}]});
        let right = json!({"type":"paragraph","content":[{"type":"text","text":"After"}]});
        let initial = osr183_literal(json!([left, right]));
        for kind in ["general", "content"] {
            let expected = osr183_literal(json!([
                left,
                {"type":"warning","attrs":{"kind":kind},"content":[{"type":"paragraph","content":[]}]},
                right
            ]));
            let mut session = osr183_open(&initial);
            let root = state(&mut session)["root"].clone();
            let sides = osr183_node(&mut session, &root)["children"].clone();
            let point = json!({"kind":"child","parent":root,"index":1,"affinity":"after"});
            let stamp = state(&mut session)["stamp"].clone();
            let selected = call(
                &mut session,
                json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":point,"focus":point}}),
            );
            assert_eq!(selected["status"], "ok", "{selected}");
            let payload =
                json!({"kind":"insert_block","target":{"kind":"warning","warning_kind":kind}});
            let result = osr183_command(&mut session, OSR183_INSERT, &payload, false);
            assert_eq!(result["value"]["effect"], "changed", "{kind}: {result}");
            assert_eq!(snapshot(&mut session), expected);
            let roots = osr183_node(&mut session, &root)["children"].clone();
            assert_eq!(roots[0], sides[0]);
            assert_eq!(roots[2], sides[1]);
            let warning = osr183_node(&mut session, &roots[1]);
            let caret = json!({"kind":"child","parent":warning["children"][0],"index":0,"affinity":"after"});
            assert_eq!(
                state(&mut session)["selection"],
                json!({"anchor":caret,"focus":caret})
            );
            osr183_history(&mut session, "undo", &initial);
            osr183_history(&mut session, "redo", &expected);
        }
    }

    #[test]
    fn osr188_set_warning_kind_keeps_warning_label_children_and_undo() {
        let initial = osr188_case()["kwdj"].clone();
        let original = initial.to_string();
        for (index, kind) in [(0, "content"), (1, "general")] {
            let mut expected = initial.clone();
            expected["content"][index]["attrs"]["kind"] = json!(kind);
            let expected = expected.to_string();
            let mut session = osr183_open(&original);
            let root = state(&mut session)["root"].clone();
            let roots = osr183_node(&mut session, &root)["children"].clone();
            let id = &roots[index];
            let before = osr183_node(&mut session, id);
            let payload = json!({"kind":"set_warning_kind","node":id,"warning_kind":kind});
            let result = osr183_command(&mut session, OSR188_SET_KIND, &payload, false);
            assert_eq!(result["value"]["effect"], "changed", "{kind}: {result}");
            assert_eq!(snapshot(&mut session), expected);
            let after = osr183_node(&mut session, id);
            assert_eq!(after["children"], before["children"]);
            assert_eq!(after["attributes"]["label"], before["attributes"]["label"]);
            assert_eq!(osr183_node(&mut session, &root)["children"], roots);
            let settled = state(&mut session);
            let same = osr183_command(&mut session, OSR188_SET_KIND, &payload, false);
            assert_eq!(same["value"]["effect"], "unchanged", "{same}");
            assert_eq!(state(&mut session), settled);
            assert_eq!(snapshot(&mut session), expected);
            osr183_history(&mut session, "undo", &original);
            osr183_history(&mut session, "redo", &expected);
        }
    }

    #[test]
    fn osr183_create_author_note_at_root_gap_seeds_one_empty_paragraph() {
        let left = json!({"type":"paragraph","content":[{"type":"text","text":"Before"}]});
        let right = json!({"type":"paragraph","content":[{"type":"text","text":"After"}]});
        let input = osr183_literal(json!([left, right]));
        let expected = osr183_literal(json!([
            left,
            {"type":"literary_block","attrs":{"kind":"author_note"},"content":[{"type":"paragraph","content":[]}]},
            right
        ]));
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let sides = osr183_node(&mut session, &root)["children"].clone();
        let gap = json!({"kind":"child","parent":root,"index":1,"affinity":"after"});
        let stamp = state(&mut session)["stamp"].clone();
        let set_selection = call(
            &mut session,
            json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":gap,"focus":gap}}),
        );
        assert_eq!(set_selection["status"], "ok", "{set_selection}");
        let before = state(&mut session);
        let request = json!({"kind":"insert_block","target":{"kind":"literary_block","literary_kind":"author_note"}});
        let query = osr183_command(&mut session, OSR183_INSERT, &request, true);
        assert_eq!(query["value"]["available"], true, "{query}");
        assert_eq!(query["value"]["effect"], "changed", "{query}");
        assert_eq!(state(&mut session), before);
        assert_eq!(snapshot(&mut session), input);
        osr183_denied(
            &mut session,
            OSR183_INSERT,
            json!({"kind":"insert_block","target":{"kind":"literary_block","literary_kind":"letter"}}),
            &input,
            "sdk.invalid_dto",
        );

        let reply = osr183_command(&mut session, OSR183_INSERT, &request, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), expected);
        let roots = osr183_node(&mut session, &root)["children"].clone();
        assert_eq!(roots[0], sides[0]);
        assert_eq!(roots[2], sides[1]);
        let note = osr183_node(&mut session, &roots[1]);
        assert_eq!(note["type_id"], "org.klenwriter.kwdj/literary_block");
        assert_eq!(
            note["attributes"]["kind"],
            json!({"kind":"string","value":"author_note"})
        );
        assert_eq!(note["children"].as_array().unwrap().len(), 1);
        let paragraph = osr183_node(&mut session, &note["children"][0]);
        assert_eq!(paragraph["type_id"], "org.klenwriter.kwdj/paragraph");
        assert_eq!(paragraph["children"], json!([]));
        let caret = json!({"kind":"child","parent":paragraph["id"],"index":0,"affinity":"after"});
        let after = state(&mut session);
        assert_eq!(after["selection"], json!({"anchor":caret,"focus":caret}));
        assert_eq!(after["stamp"]["revision"], "1");
        assert_eq!(after["history"]["undo_entries"], "1");
        osr183_history(&mut session, "undo", &input);
        osr183_history(&mut session, "redo", &expected);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);
    }

    fn osr191_case() -> Value {
        let fixtures: Value = serde_json::from_str(include_str!(
            "../../../contracts/kwdj/v1/fixtures/positive.json"
        ))
        .unwrap();
        fixtures["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|fixture| fixture["id"] == "DOC-017")
            .unwrap()["cases"][0]
            .clone()
    }

    fn osr191_read_reopen(document: &Value) {
        let canonical = document.to_string();
        let mut session = osr183_open(&canonical);
        let root = state(&mut session)["root"].clone();
        let nodes = osr183_node(&mut session, &root)["children"].clone();
        assert_eq!(nodes.as_array().unwrap().len(), 2);
        for index in 0..2 {
            let expected = &document["content"][index];
            let actual = osr183_node(&mut session, &nodes[index]);
            assert_eq!(
                actual["type_id"],
                format!("org.klenwriter.kwdj/{}", expected["type"].as_str().unwrap())
            );
            assert_eq!(actual["primitive"], "container");
            assert_eq!(
                actual["attributes"]["label"]["value"],
                expected["attrs"]["label"]
            );
            let paragraph = osr183_node(&mut session, &actual["children"][0]);
            let leaf = osr183_node(&mut session, &paragraph["children"][0]);
            assert_eq!(leaf["text"], expected["content"][0]["content"][0]["text"]);
        }
        let saved = snapshot(&mut session);
        assert_eq!(saved, canonical);
        assert_eq!(snapshot(&mut osr183_open(&saved)), canonical);
    }

    #[test]
    fn osr191_doc017_reads_projects_and_reopens_spoiler_and_disclosure() {
        let case = osr191_case();
        let document = &case["kwdj"];
        osr191_read_reopen(document);
        let facts = crate::FactStore(Default::default());
        let admitted =
            editor_kwdj::validate_normalized_json(document.to_string().as_bytes(), &facts).unwrap();
        let projection = admitted.project_text().unwrap();
        assert_eq!(
            projection.full_text,
            case["expected"]["full_text"].as_str().unwrap()
        );
        assert_eq!(
            projection.search_index_text,
            case["expected"]["search_index_text"].as_str().unwrap()
        );
        assert_eq!(
            projection.public_snippet_text,
            case["expected"]["public_snippet_text"].as_str().unwrap()
        );
    }

    #[test]
    fn osr191_empty_labels_refuse_and_authored_whitespace_round_trips() {
        let document = &osr191_case()["kwdj"];
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        for block in document["content"].as_array().unwrap() {
            let mut empty = block.clone();
            empty["attrs"]["label"] = json!("");
            let input = osr183_literal(json!([empty]));
            let session = distribution.open(input.as_bytes(), &options(false).to_string());
            let response = serde_json::to_value(session.initialization()).unwrap();
            assert_eq!(response["status"], "refused", "{response}");
            assert_eq!(
                response["diagnostic"]["code"], "kwdj.invalid_structure",
                "{response}"
            );
            assert_eq!(
                response["diagnostic"]["path"], "/content/0/attrs/label",
                "{response}"
            );
            assert_eq!(response["diagnostic"]["may_have_committed"], false);
        }
        let mut spaces = document.clone();
        for block in spaces["content"].as_array_mut().unwrap() {
            block["attrs"]["label"] = json!("  ");
        }
        osr191_read_reopen(&spaces);
    }

    #[test]
    fn osr183_set_author_note_changes_only_kind_and_preserves_exact_history() {
        // DOC-015 preserves letter. A fresh rich child payload detects any
        // copying, flattening or normalization of the existing children.
        let input = osr183_literal(json!([
            {"type":"paragraph","content":[]},
            {"type":"literary_block","attrs":{"kind":"letter"},"content":[
                {"type":"paragraph","attrs":{"align":"right"},"content":[
                    {"type":"text","text":"Letter 😀","marks":[{"type":"strong"}]},
                    {"type":"hard_break"},
                    {"type":"text","text":"Continuation"}
                ]},
                {"type":"paragraph","content":[{"type":"text","text":"Tail"}]}
            ]}
        ]));
        let expected = input.replacen("\"kind\":\"letter\"", "\"kind\":\"author_note\"", 1);
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let roots = osr183_node(&mut session, &root)["children"].clone();
        let note_id = roots[1].clone();
        let before_children = osr183_node(&mut session, &note_id)["children"].clone();
        let before_inline = osr183_node(&mut session, &before_children[0])["children"].clone();
        let request =
            json!({"kind":"set_literary_kind","node":note_id,"literary_kind":"author_note"});
        let before = state(&mut session);
        let query = osr183_command(&mut session, OSR183_SET_KIND, &request, true);
        assert_eq!(query["value"]["available"], true, "{query}");
        assert_eq!(query["value"]["effect"], "changed", "{query}");
        assert_eq!(state(&mut session), before);
        assert_eq!(snapshot(&mut session), input);
        let reply = osr183_command(&mut session, OSR183_SET_KIND, &request, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), expected);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);
        assert_eq!(
            osr183_node(&mut session, &note_id)["children"],
            before_children
        );
        assert_eq!(
            osr183_node(&mut session, &before_children[0])["children"],
            before_inline
        );
        let after = state(&mut session);
        assert_eq!(after["stamp"]["revision"], "1");
        assert_eq!(after["history"]["undo_entries"], "1");
        osr183_history(&mut session, "undo", &input);
        osr183_history(&mut session, "redo", &expected);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);
        assert_eq!(
            osr183_node(&mut session, &note_id)["children"],
            before_children
        );

        let settled = state(&mut session);
        let same = osr183_command(&mut session, OSR183_SET_KIND, &request, false);
        assert_eq!(same["value"]["effect"], "unchanged", "{same}");
        assert_eq!(state(&mut session), settled);
        assert_eq!(snapshot(&mut session), expected);
        for (payload, code) in [
            (
                json!({"kind":"set_literary_kind","node":note_id,"literary_kind":"letter"}),
                "sdk.invalid_dto",
            ),
            (
                json!({"kind":"set_literary_kind","node":roots[0],"literary_kind":"author_note"}),
                "kwdj.command_invalid_target",
            ),
        ] {
            osr183_denied(&mut session, OSR183_SET_KIND, payload, &expected, code);
        }
    }

    const OSR184_WRAP: &str = "org.klenwriter.kwdj/command/wrap-literary-block";
    const OSR184_UNWRAP: &str = "org.klenwriter.kwdj/command/unwrap-literary-block";

    fn osr194_run_cases(key: &str, command: &str, intent: &str) {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/osr-194-verse-keys.json"
        ))
        .unwrap();
        let input = fixture["input"].to_string();
        let cases: Vec<_> = fixture["cases"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|case| case["key"] == key)
            .collect();
        assert_eq!(cases.len(), 3);
        for case in cases {
            let label = case["position"].as_str().unwrap();
            let mut session = osr183_open(&input);
            let root = state(&mut session)["root"].clone();
            let verse = osr183_node(&mut session, &root)["children"][0].clone();
            let line = osr183_node(&mut session, &verse)["children"][0].clone();
            let text = osr183_node(&mut session, &line)["children"][0].clone();
            let point =
                json!({"kind":"text","node":text,"offset":case["offset"],"affinity":"after"});
            let stamp = state(&mut session)["stamp"].clone();
            let selected = call(
                &mut session,
                json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":point,"focus":point}}),
            );
            assert_eq!(selected["status"], "ok", "{key} {label}: {selected}");
            let result = osr183_command(&mut session, command, &json!({"kind":intent}), false);
            assert_eq!(
                result["value"]["effect"], "changed",
                "{key} {label}: {result}"
            );
            assert_eq!(
                snapshot(&mut session),
                case["expected"].to_string(),
                "{key} {label}"
            );
            assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
            osr183_history(&mut session, "undo", &input);
        }
    }

    #[test]
    fn osr194_enter_uses_the_three_pinned_cms_verse_splits() {
        osr194_run_cases("Enter", "org.klenwriter.kwdj/command/enter", "enter");
    }

    #[test]
    fn osr194_shift_enter_uses_the_three_pinned_cms_hard_breaks() {
        osr194_run_cases(
            "Shift+Enter",
            "org.klenwriter.kwdj/command/shift-enter",
            "shift_enter",
        );
    }

    fn osr184_blocks() -> Value {
        json!([
            {"type":"paragraph","content":[{"type":"text","text":"Before"}]},
            {"type":"paragraph","attrs":{"align":"right"},"content":[
                {"type":"text","text":"Note 😀","marks":[{"type":"strong"}]},
                {"type":"hard_break"},
                {"type":"text","text":"Continuation"}
            ]},
            {"type":"scene_break"},
            {"type":"blockquote","content":[{"type":"paragraph","content":[
                {"type":"text","text":"Quotation","marks":[{"type":"emphasis"}]}
            ]}]},
            {"type":"literary_block","attrs":{"kind":"letter"},"content":[
                {"type":"paragraph","content":[{"type":"text","text":"Preserved"}]}
            ]}
        ])
    }

    const OSR279_WRAP: &str = "org.klenwriter.kwdj/command/wrap-labeled-container";
    const OSR279_UNWRAP: &str = "org.klenwriter.kwdj/command/unwrap-labeled-container";

    fn osr279_fixture() -> (Value, Vec<Value>) {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../tests/fixtures/osr-279-spoiler-disclosure.json"
        ))
        .unwrap();
        let mut roots = vec![fixture["before"].clone()];
        roots.extend(fixture["selected"].as_array().unwrap().iter().cloned());
        roots.push(fixture["after"].clone());
        (fixture, roots)
    }

    #[test]
    fn osr279_labeled_create_uses_legacy_titles_and_one_empty_paragraph() {
        let (fixture, roots) = osr279_fixture();
        let initial = osr183_literal(json!(roots));
        for case in fixture["containers"].as_array().unwrap() {
            let created = &case["created"];
            let mut expected = roots.clone();
            expected.insert(1, created.clone());
            let expected = osr183_literal(json!(expected));
            let mut session = osr183_open(&initial);
            let root = state(&mut session)["root"].clone();
            let original = osr183_node(&mut session, &root)["children"].clone();
            osr184_select(&mut session, &root, 1, &root, 1);
            let result = osr183_command(
                &mut session,
                OSR183_INSERT,
                &json!({"kind":"insert_block","target":{"kind":created["type"]}}),
                false,
            );
            assert_eq!(result["value"]["effect"], "changed", "{result}");
            assert_eq!(snapshot(&mut session), expected);
            assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
            let wrapper = osr183_node(&mut session, &root)["children"][1].clone();
            let block = osr183_node(&mut session, &wrapper);
            let caret =
                json!({"kind":"child","parent":block["children"][0],"index":0,"affinity":"after"});
            assert_eq!(
                state(&mut session)["selection"],
                json!({"anchor":caret,"focus":caret})
            );
            osr183_history(&mut session, "undo", &initial);
            assert_eq!(osr183_node(&mut session, &root)["children"], original);
        }
    }

    #[test]
    fn osr279_labeled_wrap_and_unwrap_preserve_children_and_undo_exactly() {
        let (fixture, roots) = osr279_fixture();
        let initial = osr183_literal(json!(roots));
        for case in fixture["containers"].as_array().unwrap() {
            let kind = &case["created"]["type"];
            let label = &case["wrap_label"];
            let wrapped = osr183_literal(json!([
                fixture["before"],
                {"type":kind,"attrs":{"label":label},"content":fixture["selected"]},
                fixture["after"],
            ]));
            let mut session = osr183_open(&initial);
            let root = state(&mut session)["root"].clone();
            let original = osr183_node(&mut session, &root)["children"].clone();
            let children = json!(original.as_array().unwrap()[1..3]);
            osr184_select(&mut session, &root, 3, &root, 1);
            let wrap = json!({"kind":"wrap_labeled_container","container_kind":kind,"label":label});
            let result = osr183_command(&mut session, OSR279_WRAP, &wrap, false);
            assert_eq!(result["value"]["effect"], "changed", "{result}");
            assert_eq!(snapshot(&mut session), wrapped);
            assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
            let wrapper = osr183_node(&mut session, &root)["children"][1].clone();
            assert_eq!(osr183_node(&mut session, &wrapper)["children"], children);
            osr183_history(&mut session, "undo", &initial);
            assert_eq!(osr183_node(&mut session, &root)["children"], original);
            osr183_history(&mut session, "redo", &wrapped);

            for target in [&original[0], &original[3]] {
                osr183_denied(
                    &mut session,
                    OSR279_UNWRAP,
                    json!({"kind":"unwrap_labeled_container","node":target}),
                    &wrapped,
                    "kwdj.command_invalid_target",
                );
            }
            osr184_select(&mut session, &wrapper, 0, &wrapper, 2);
            let before = state(&mut session);
            let refusal = osr183_command(&mut session, OSR279_WRAP, &wrap, false);
            assert_eq!(refusal["status"], "refused", "{refusal}");
            assert_eq!(
                refusal["diagnostic"]["code"], case["recursion"],
                "{refusal}"
            );
            assert_eq!(refusal["diagnostic"]["path"], "/content/1/content/0");
            assert_eq!(state(&mut session), before);
            assert_eq!(snapshot(&mut session), wrapped);

            let unwrap = json!({"kind":"unwrap_labeled_container","node":wrapper});
            let result = osr183_command(&mut session, OSR279_UNWRAP, &unwrap, false);
            assert_eq!(result["value"]["effect"], "changed", "{result}");
            assert_eq!(snapshot(&mut session), initial);
            assert_eq!(state(&mut session)["history"]["undo_entries"], "2");
            assert_eq!(osr183_node(&mut session, &root)["children"], original);
            osr183_history(&mut session, "undo", &wrapped);
            assert_eq!(osr183_node(&mut session, &wrapper)["children"], children);
        }
    }

    #[test]
    fn sdk2_deletes_selected_text_wholly_inside_literary_warning_and_labeled_bodies() {
        let paragraph =
            |text: &str| json!({"type":"paragraph","content":[{"type":"text","text":text}]});
        let cases = [
            ("literary_block", json!({"kind":"author_note"})),
            ("warning", json!({"kind":"general"})),
            ("warning", json!({"kind":"content","label":"Темы"})),
            ("spoiler", json!({"label":"Финал"})),
            ("disclosure", json!({"label":"Подробнее"})),
        ];
        let command = "org.klenwriter.kwdj/command/delete-selection";
        let intent = json!({"kind":"delete_selection","scope":"profile_body"});
        let refusal = json!({"code":"kwdj.command_unsupported_context","path":"/command"});
        for (kind, attrs) in cases {
            let blocks = |text: &str| {
                json!([paragraph("Outside"), {
                    "type":kind,
                    "attrs":attrs,
                    "content":[paragraph(text),paragraph("Second")],
                }])
            };
            let initial = osr183_literal(blocks("A😀BC"));
            let expected = osr183_literal(blocks("ABC"));
            let mut session = osr183_open(&initial);
            let root = state(&mut session)["root"].clone();
            let roots = osr183_node(&mut session, &root)["children"].clone();
            let wrapper = &roots[1];
            let body = osr183_node(&mut session, wrapper)["children"].clone();
            let outside = osr183_node(&mut session, &roots[0])["children"][0].clone();
            let first = osr183_node(&mut session, &body[0])["children"][0].clone();
            let second = osr183_node(&mut session, &body[1])["children"][0].clone();
            let point = |node: &Value, offset| json!({"kind":"text","node":node,"offset":offset,"affinity":"after"});
            let select = |session: &mut DistributionSession, anchor: Value, focus: Value| {
                let stamp = state(session)["stamp"].clone();
                let reply = call(
                    session,
                    json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":anchor,"focus":focus}}),
                );
                assert_eq!(reply["status"], "ok", "{reply}");
            };

            for anchor in [point(&outside, 7), point(&second, 1)] {
                select(&mut session, anchor, point(&first, 1));
                osr189_refused(&mut session, command, intent.clone(), &refusal, &initial);
            }

            select(&mut session, point(&first, 3), point(&first, 1));
            osr189_refused(
                &mut session,
                command,
                json!({"kind":"delete_selection"}),
                &refusal,
                &initial,
            );
            let result = osr183_command(&mut session, command, &intent, false);
            assert_eq!(
                result["value"]["effect"], "changed",
                "{kind} {attrs}: {result}"
            );
            assert_eq!(snapshot(&mut session), expected);
            assert_eq!(osr183_node(&mut session, &root)["children"], roots);
            assert_eq!(osr183_node(&mut session, wrapper)["children"], body);
            assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
            osr183_history(&mut session, "undo", &initial);
            assert_eq!(osr183_node(&mut session, wrapper)["children"], body);
        }
    }

    #[test]
    fn osr279_labeled_boundaries_refuse_and_explicit_remove_preserves_the_shell() {
        let (fixture, _) = osr279_fixture();
        let refusals = &osr189_fixture()["refusals"];
        for case in fixture["containers"].as_array().unwrap() {
            let input =
                osr183_literal(json!([fixture["before"], case["copied"], fixture["after"]]));
            let empty = osr183_literal(json!([
                fixture["before"],
                case["empty_shell"],
                fixture["after"]
            ]));
            let mut session = osr183_open(&input);
            let root = state(&mut session)["root"].clone();
            let roots = osr183_node(&mut session, &root)["children"].clone();
            let outside = osr183_node(&mut session, &roots[0])["children"][0].clone();
            let wrapper = &roots[1];
            let before = osr183_node(&mut session, wrapper);
            let child = &before["children"][0];
            let first = osr183_node(&mut session, child)["children"][0].clone();
            let point = |node: &Value, offset| json!({"kind":"text","node":node,"offset":offset,"affinity":"after"});
            for (command, intent, anchor, focus, oracle) in [
                (
                    "delete-backward",
                    "delete_backward",
                    point(&first, 0),
                    point(&first, 0),
                    "first_child_backspace",
                ),
                (
                    "delete-selection",
                    "delete_selection",
                    point(&outside, 2),
                    point(&first, 1),
                    "cross_boundary_delete",
                ),
            ] {
                let stamp = state(&mut session)["stamp"].clone();
                let reply = call(
                    &mut session,
                    json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":anchor,"focus":focus}}),
                );
                assert_eq!(reply["status"], "ok", "{reply}");
                osr189_refused(
                    &mut session,
                    &format!("org.klenwriter.kwdj/command/{command}"),
                    json!({"kind":intent}),
                    &refusals[oracle],
                    &input,
                );
            }

            let reply = osr183_command(
                &mut session,
                "org.klenwriter.kwdj/command/remove",
                &json!({"kind":"remove","node":child}),
                false,
            );
            assert_eq!(reply["value"]["effect"], "changed", "{reply}");
            assert_eq!(snapshot(&mut session), empty);
            assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
            assert_eq!(osr183_node(&mut session, &root)["children"], roots);
            let after = osr183_node(&mut session, wrapper);
            assert_eq!(after["attributes"], before["attributes"]);
            assert_eq!(after["children"].as_array().unwrap().len(), 1);
            assert_ne!(&after["children"][0], child);
            assert_eq!(
                osr183_node(&mut session, &after["children"][0])["children"],
                json!([])
            );
            osr183_history(&mut session, "undo", &input);
            assert_eq!(
                osr183_node(&mut session, wrapper)["children"],
                before["children"]
            );
        }
    }

    fn osr184_select(
        session: &mut DistributionSession,
        anchor_parent: &Value,
        anchor_index: usize,
        focus_parent: &Value,
        focus_index: usize,
    ) {
        let range = json!({
            "anchor":{"kind":"child","parent":anchor_parent,"index":anchor_index,"affinity":"after"},
            "focus":{"kind":"child","parent":focus_parent,"index":focus_index,"affinity":"after"}
        });
        let stamp = state(session)["stamp"].clone();
        let reply = call(
            session,
            json!({"kind":"set_selection","stamp":stamp,"selection":range}),
        );
        assert_eq!(reply["status"], "ok", "{reply}");
        assert_eq!(state(session)["selection"], range);
    }

    #[test]
    fn osr184_structural_wrap_and_explicit_unwrap_preserve_subtrees_and_history() {
        let blocks = osr184_blocks();
        let input = osr183_literal(blocks.clone());
        let wrapped = osr183_literal(json!([
            blocks[0],
            {"type":"literary_block","attrs":{"kind":"author_note"},"content":blocks.as_array().unwrap()[1..4]},
            blocks[4]
        ]));
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let original_ids = osr183_node(&mut session, &root)["children"].clone();
        let body_ids = json!(original_ids.as_array().unwrap()[1..4]);
        let paragraph_inline = osr183_node(&mut session, &body_ids[0])["children"].clone();
        let quote_children = osr183_node(&mut session, &body_ids[2])["children"].clone();

        osr184_select(&mut session, &root, 4, &root, 1);
        let before = state(&mut session);
        let wrap = json!({"kind":"wrap_literary_block","literary_kind":"author_note"});
        let query = osr183_command(&mut session, OSR184_WRAP, &wrap, true);
        assert_eq!(query["value"]["available"], true, "{query}");
        assert_eq!(query["value"]["effect"], "changed");
        assert_eq!(state(&mut session), before);
        assert_eq!(snapshot(&mut session), input);

        let reply = osr183_command(&mut session, OSR184_WRAP, &wrap, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), wrapped);
        assert_eq!(state(&mut session)["history"]["undo_entries"], "1");
        let wrapped_ids = osr183_node(&mut session, &root)["children"].clone();
        let wrapper = wrapped_ids[1].clone();
        assert_eq!(
            wrapped_ids,
            json!([original_ids[0], wrapper, original_ids[4]])
        );
        let note = osr183_node(&mut session, &wrapper);
        assert_eq!(note["type_id"], "org.klenwriter.kwdj/literary_block");
        assert_eq!(
            note["attributes"]["kind"],
            json!({"kind":"string","value":"author_note"})
        );
        assert_eq!(note["children"], body_ids);
        assert_eq!(
            osr183_node(&mut session, &body_ids[0])["children"],
            paragraph_inline
        );
        assert_eq!(
            osr183_node(&mut session, &body_ids[2])["children"],
            quote_children
        );

        osr183_history(&mut session, "undo", &input);
        assert_eq!(osr183_node(&mut session, &root)["children"], original_ids);
        osr183_history(&mut session, "redo", &wrapped);
        assert_eq!(osr183_node(&mut session, &root)["children"], wrapped_ids);
        assert_eq!(osr183_node(&mut session, &wrapper)["children"], body_ids);

        let before = state(&mut session);
        let unwrap = json!({"kind":"unwrap_literary_block","node":wrapper});
        let query = osr183_command(&mut session, OSR184_UNWRAP, &unwrap, true);
        assert_eq!(query["value"]["available"], true, "{query}");
        assert_eq!(query["value"]["effect"], "changed");
        assert_eq!(state(&mut session), before);
        assert_eq!(snapshot(&mut session), wrapped);

        let reply = osr183_command(&mut session, OSR184_UNWRAP, &unwrap, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), input);
        assert_eq!(state(&mut session)["history"]["undo_entries"], "2");
        assert_eq!(osr183_node(&mut session, &root)["children"], original_ids);
        assert_eq!(
            osr183_node(&mut session, &body_ids[0])["children"],
            paragraph_inline
        );
        assert_eq!(
            osr183_node(&mut session, &body_ids[2])["children"],
            quote_children
        );
        osr183_history(&mut session, "undo", &wrapped);
        assert_eq!(osr183_node(&mut session, &root)["children"], wrapped_ids);
        assert_eq!(osr183_node(&mut session, &wrapper)["children"], body_ids);
        osr183_history(&mut session, "redo", &input);
        assert_eq!(osr183_node(&mut session, &root)["children"], original_ids);
    }

    #[test]
    fn osr184_refuses_mixed_parent_wrap_and_non_author_note_unwrap_atomically() {
        let input = osr183_literal(osr184_blocks());
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let ids = osr183_node(&mut session, &root)["children"].clone();
        osr184_select(&mut session, &root, 1, &ids[3], 1);
        osr183_denied(
            &mut session,
            OSR184_WRAP,
            json!({"kind":"wrap_literary_block","literary_kind":"author_note"}),
            &input,
            "kwdj.command_unsupported_context",
        );
        for target in [&ids[3], &ids[4]] {
            osr183_denied(
                &mut session,
                OSR184_UNWRAP,
                json!({"kind":"unwrap_literary_block","node":target}),
                &input,
                "kwdj.command_invalid_target",
            );
        }
    }

    const OSR189_WRAP: &str = "org.klenwriter.kwdj/command/wrap-warning";
    const OSR189_UNWRAP: &str = "org.klenwriter.kwdj/command/unwrap-warning";

    fn osr195_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/osr-195-empty-verse-and-stanzas.json"
        ))
        .unwrap()
    }

    #[test]
    fn osr195_admission_and_reopen_preserve_empty_verse_and_stanza_counts() {
        let fixture = osr195_fixture();
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        for case in fixture["candidates"].as_array().unwrap() {
            let input = case["input"].to_string();
            for (mode, expectation) in [("validate", "strict"), ("normalize", "normalize")] {
                let mut settings = options(false);
                settings["admission"] = json!(mode);
                let mut session = distribution.open(input.as_bytes(), &settings.to_string());
                let reply = serde_json::to_value(session.initialization()).unwrap();
                let expected = &case[expectation];
                let id = case["id"].as_str().unwrap();
                if expected["status"] == "refused" {
                    assert_eq!(reply["status"], "refused", "{id}/{mode}: {reply}");
                    assert_eq!(
                        reply["diagnostic"]["code"], expected["code"],
                        "{id}/{mode}: {reply}"
                    );
                    assert_eq!(
                        reply["diagnostic"]["path"], expected["path"],
                        "{id}/{mode}: {reply}"
                    );
                } else {
                    assert_eq!(reply["status"], "ok", "{id}/{mode}: {reply}");
                    let saved = snapshot(&mut session);
                    assert_eq!(saved, expected["exported"].to_string(), "{id}/{mode}");
                    assert_eq!(snapshot(&mut osr183_open(&saved)), saved, "{id}/{mode}");
                }
            }
        }
    }

    #[test]
    fn osr195_empty_verse_key_transitions_match_canonical_and_undo() {
        let fixture = osr195_fixture();
        let node_at = |session: &mut DistributionSession, path: &[Value]| {
            let mut node = state(session)["root"].clone();
            for index in path {
                node = osr183_node(session, &node)["children"][index.as_u64().unwrap() as usize]
                    .clone();
            }
            node
        };
        for case in fixture["keys"].as_array().unwrap() {
            let id = case["id"].as_str().unwrap();
            let input = case["input"].to_string();
            let mut session = osr183_open(&input);
            let line_path = case["enter_at"].as_array().unwrap();
            let verse_path = &line_path[..line_path.len() - 1];
            let verse = node_at(&mut session, verse_path);
            let line = node_at(&mut session, line_path);
            osr184_select(&mut session, &line, 0, &line, 0);
            let before = state(&mut session);
            let reply = osr183_command(
                &mut session,
                "org.klenwriter.kwdj/command/enter",
                &json!({"kind":"enter"}),
                false,
            );
            let changed = case["changed"].as_bool().unwrap();
            let effect = if changed { "changed" } else { "unchanged" };
            assert_eq!(reply["value"]["effect"], effect, "{id}: {reply}");
            assert_eq!(snapshot(&mut session), case["expected"].to_string(), "{id}");
            assert_eq!(node_at(&mut session, verse_path), verse, "{id}");
            let caret = &case["caret"];
            let block = node_at(&mut session, caret["path"].as_array().unwrap());
            let header = osr183_node(&mut session, &block);
            let text = header["children"]
                .get(0)
                .filter(|child| osr183_node(&mut session, child)["primitive"] == "text");
            let point = if let Some(node) = text {
                json!({"kind":"text","node":node,"offset":caret["offset"],"affinity":"after"})
            } else {
                json!({"kind":"child","parent":block,"index":caret["offset"],"affinity":"after"})
            };
            let after = state(&mut session);
            assert_eq!(
                after["selection"],
                json!({"anchor":point,"focus":point}),
                "{id}"
            );
            if changed {
                assert_eq!(after["history"]["undo_entries"], "1");
                osr183_history(&mut session, "undo", &input);
                assert_eq!(
                    state(&mut session)["selection"],
                    before["selection"],
                    "{id}"
                );
            } else {
                assert_eq!(after, before, "{id}");
            }
        }
    }

    fn osr189_fixture() -> Value {
        serde_json::from_str(include_str!("../../../tests/fixtures/osr-189-warning.json")).unwrap()
    }

    fn osr189_refused(
        session: &mut DistributionSession,
        command: &str,
        payload: Value,
        expected: &Value,
        bytes: &str,
    ) {
        let before = state(session);
        let reply = osr183_command(session, command, &payload, false);
        assert_eq!(reply["status"], "refused", "{reply}");
        assert_eq!(reply["diagnostic"]["code"], expected["code"], "{reply}");
        assert_eq!(reply["diagnostic"]["path"], expected["path"], "{reply}");
        assert_eq!(state(session), before);
        assert_eq!(snapshot(session), bytes);
    }

    #[test]
    fn osr189_wrap_unwrap_warning_preserves_direct_children_and_exact_history() {
        let fixture = osr189_fixture();
        let input = osr183_literal(fixture["initial"].clone());
        let wrapped = osr183_literal(fixture["wrapped"].clone());
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let original = osr183_node(&mut session, &root)["children"].clone();
        let body = json!(original.as_array().unwrap()[1..4]);
        let inline = osr183_node(&mut session, &body[0])["children"].clone();
        osr184_select(&mut session, &root, 4, &root, 1);
        let wrap = json!({"kind":"wrap_warning","warning_kind":"general"});
        let reply = osr183_command(&mut session, OSR189_WRAP, &wrap, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), wrapped);
        let roots = osr183_node(&mut session, &root)["children"].clone();
        let warning = roots[1].clone();
        assert_eq!(roots, json!([original[0], warning, original[4]]));
        assert_eq!(osr183_node(&mut session, &warning)["children"], body);
        assert_eq!(osr183_node(&mut session, &body[0])["children"], inline);
        osr183_history(&mut session, "undo", &input);
        assert_eq!(osr183_node(&mut session, &root)["children"], original);
        osr183_history(&mut session, "redo", &wrapped);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);

        let unwrap = json!({"kind":"unwrap_warning","node":warning});
        let reply = osr183_command(&mut session, OSR189_UNWRAP, &unwrap, false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), input);
        assert_eq!(osr183_node(&mut session, &root)["children"], original);
        assert_eq!(osr183_node(&mut session, &body[0])["children"], inline);
        osr183_history(&mut session, "undo", &wrapped);
        assert_eq!(osr183_node(&mut session, &warning)["children"], body);
        osr183_history(&mut session, "redo", &input);

        let labeled = osr183_literal(fixture["labeled"].clone());
        let mut session = osr183_open(&labeled);
        let root = state(&mut session)["root"].clone();
        let warning = osr183_node(&mut session, &root)["children"][1].clone();
        osr184_select(&mut session, &warning, 0, &warning, 1);
        osr189_refused(
            &mut session,
            OSR189_WRAP,
            wrap,
            &fixture["refusals"]["cross_kind_wrap"],
            &labeled,
        );
        let blocks = fixture["labeled"].as_array().unwrap();
        let unwrapped = osr183_literal(json!([blocks[0], blocks[1]["content"][0], blocks[2]]));
        let reply = osr183_command(
            &mut session,
            OSR189_UNWRAP,
            &json!({"kind":"unwrap_warning","node":warning}),
            false,
        );
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), unwrapped);
        osr183_history(&mut session, "undo", &labeled);
        assert_eq!(osr183_node(&mut session, &root)["children"][1], warning);
    }

    #[test]
    fn osr189_warning_boundary_refusals_and_empty_shell_preserve_label() {
        let fixture = osr189_fixture();
        let input = osr183_literal(fixture["labeled"].clone());
        let empty = osr183_literal(fixture["labeled_empty"].clone());
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let roots = osr183_node(&mut session, &root)["children"].clone();
        let outside = osr183_node(&mut session, &roots[0])["children"][0].clone();
        let child = osr183_node(&mut session, &roots[1])["children"][0].clone();
        let first = osr183_node(&mut session, &child)["children"][0].clone();
        let point = |node: &Value, offset: usize| json!({"kind":"text","node":node,"offset":offset,"affinity":"after"});
        for (command, intent, anchor, focus, oracle) in [
            (
                "delete-backward",
                "delete_backward",
                point(&first, 0),
                point(&first, 0),
                "first_child_backspace",
            ),
            (
                "delete-selection",
                "delete_selection",
                point(&outside, 6),
                point(&first, 1),
                "cross_boundary_delete",
            ),
        ] {
            let stamp = state(&mut session)["stamp"].clone();
            let reply = call(
                &mut session,
                json!({"kind":"set_selection","stamp":stamp,"selection":{"anchor":anchor,"focus":focus}}),
            );
            assert_eq!(reply["status"], "ok", "{reply}");
            osr189_refused(
                &mut session,
                &format!("org.klenwriter.kwdj/command/{command}"),
                json!({"kind":intent}),
                &fixture["refusals"][oracle],
                &input,
            );
        }

        let reply = osr183_command(
            &mut session,
            "org.klenwriter.kwdj/command/remove",
            &json!({"kind":"remove","node":child}),
            false,
        );
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), empty);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);
        let children = osr183_node(&mut session, &roots[1])["children"].clone();
        assert_eq!(children.as_array().unwrap().len(), 1);
        assert_ne!(children[0], child);
        assert_eq!(
            osr183_node(&mut session, &children[0])["children"],
            json!([])
        );
        osr183_history(&mut session, "undo", &input);
        assert_eq!(osr183_node(&mut session, &roots[1])["children"][0], child);
        osr183_history(&mut session, "redo", &empty);
    }

    #[test]
    fn osr189_warning_nesting_respects_family_through_literary_container() {
        let fixture = osr189_fixture();
        let input = osr183_literal(fixture["nesting"].clone());
        let nested = osr183_literal(fixture["nested"].clone());
        let mut session = osr183_open(&input);
        let root = state(&mut session)["root"].clone();
        let roots = osr183_node(&mut session, &root)["children"].clone();
        let forbidden = osr183_node(&mut session, &roots[0])["children"][0].clone();
        let moved = &roots[1];
        let allowed = &roots[2];
        let payload =
            |parent: &Value| json!({"kind":"move","node":moved,"parent":parent,"before_index":1});
        let command = "org.klenwriter.kwdj/command/move";
        osr189_refused(
            &mut session,
            command,
            payload(&forbidden),
            &fixture["refusals"]["cross_kind_move"],
            &input,
        );
        let reply = osr183_command(&mut session, command, &payload(allowed), false);
        assert_eq!(reply["value"]["effect"], "changed", "{reply}");
        assert_eq!(snapshot(&mut session), nested);
        assert_eq!(osr183_node(&mut session, allowed)["children"][1], *moved);
        osr183_history(&mut session, "undo", &input);
        assert_eq!(osr183_node(&mut session, &root)["children"], roots);
    }

    fn osr144_fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../tests/fixtures/osr-144-verse-indent.json"
        ))
        .unwrap()
    }

    fn osr144_corpus() -> Value {
        serde_json::from_str(include_str!(
            "../../../contracts/kwdj/v1/fixtures/positive.json"
        ))
        .unwrap()
    }

    fn osr144_document(profile: &str, content: Value) -> String {
        json!({
            "schema":"klenwriter.document", "schema_version":1, "profile":profile, "content":content,
        })
        .to_string()
    }

    fn osr144_poem(lines: Value) -> String {
        osr144_document("poetry", json!([{"type":"verse","content":lines}]))
    }

    fn osr144_diagnostic(reply: &Value, expected: &Value) {
        assert_eq!(reply["status"], "refused", "{reply}");
        assert_eq!(reply["diagnostic"]["code"], expected["code"], "{reply}");
        assert_eq!(reply["diagnostic"]["path"], expected["path"], "{reply}");
        assert_eq!(reply["diagnostic"]["may_have_committed"], false, "{reply}");
    }

    #[test]
    fn osr144_poetry_corpus_admits_exports_and_reopens_unchanged() {
        let fixture = osr144_fixture();
        let corpus = osr144_corpus();
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        for row in fixture["corpus"].as_array().unwrap() {
            let document = corpus["fixtures"]
                .as_array()
                .unwrap()
                .iter()
                .find(|document| document["id"] == row[0])
                .unwrap();
            let case = document["cases"]
                .as_array()
                .unwrap()
                .iter()
                .find(|case| case["name"] == row[1])
                .unwrap();
            let media: Vec<_> = case["input"]["identity_state"]["existing_media_ids"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|id| json!({"id":id,"status":"exists"}))
                .collect();
            let mut opts = options(false);
            opts["profile_options_json"] = json!({
                "identities":{"media":media,"references":[]},"limits":null,
            })
            .to_string()
            .into();
            let expected = case["kwdj"].to_string();
            let mut session = distribution.open(expected.as_bytes(), &opts.to_string());
            assert!(
                matches!(session.initialization(), SdkResponse::Ok { .. }),
                "{row}: {:?}",
                session.initialization()
            );
            let saved = snapshot(&mut session);
            assert_eq!(saved, expected, "{row}");
            session.destroy();
            let mut reopened = distribution.open(saved.as_bytes(), &opts.to_string());
            assert!(
                matches!(reopened.initialization(), SdkResponse::Ok { .. }),
                "{row}: {:?}",
                reopened.initialization()
            );
            assert_eq!(snapshot(&mut reopened), expected, "{row}");
        }
    }

    #[test]
    fn osr144_verse_indents_one_through_eight_and_leading_space_round_trip() {
        let fixture = osr144_fixture();
        let expected = osr144_poem(fixture["indented_lines"].clone());
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        for mode in ["validate", "normalize"] {
            let mut opts = options(false);
            opts["admission"] = mode.into();
            let mut session = distribution.open(expected.as_bytes(), &opts.to_string());
            assert!(
                matches!(session.initialization(), SdkResponse::Ok { .. }),
                "{mode}: {:?}",
                session.initialization()
            );
            assert_eq!(snapshot(&mut session), expected);
            let root = state(&mut session)["root"].clone();
            let verse = osr183_node(&mut session, &root)["children"][0].clone();
            let lines = osr183_node(&mut session, &verse)["children"].clone();
            for (index, line) in lines.as_array().unwrap().iter().enumerate() {
                let line = osr183_node(&mut session, line);
                assert_eq!(
                    line["attributes"]["indent"],
                    json!({"kind":"number","value":(index + 1).to_string()})
                );
            }
            let leaf = osr183_node(&mut session, &lines[0])["children"][0].clone();
            assert_eq!(
                osr183_node(&mut session, &leaf)["text"],
                "  Leading and indented"
            );
        }
    }

    #[test]
    fn osr144_verse_indent_zero_normalizes_only_at_import_and_bad_tokens_refuse() {
        let fixture = osr144_fixture();
        let expected = osr144_poem(json!([fixture["plain_line"]]));
        let mut raw_line = fixture["plain_line"].clone();
        raw_line["attrs"] = json!({"indent":"OSR144-indent"});
        let raw = osr144_poem(json!([raw_line]));
        let insert = |token: &str| raw.replacen("\"OSR144-indent\"", token, 1);
        let distribution = Distribution::new(BUILD, vec![Box::new(KwdjFactory)]).unwrap();
        let mut opts = options(false);
        let strict = distribution.open(insert("0").as_bytes(), &opts.to_string());
        osr144_diagnostic(
            &serde_json::to_value(strict.initialization()).unwrap(),
            &fixture["refusals"]["zero_validate"],
        );
        for mode in ["validate", "normalize"] {
            opts["admission"] = mode.into();
            for token in fixture["invalid_indent_tokens"].as_array().unwrap() {
                let refused = distribution.open(
                    insert(token.as_str().unwrap()).as_bytes(),
                    &opts.to_string(),
                );
                osr144_diagnostic(
                    &serde_json::to_value(refused.initialization()).unwrap(),
                    &fixture["refusals"]["invalid_indent"],
                );
                assert!(refused.context().is_none());
                assert_eq!(refused.own_resource_counts().sessions, 0);
            }
        }
        let mut imported = distribution.open(insert("0").as_bytes(), &opts.to_string());
        assert!(
            matches!(imported.initialization(), SdkResponse::Ok { .. }),
            "{:?}",
            imported.initialization()
        );
        let saved = snapshot(&mut imported);
        assert_eq!(saved, expected);
        imported.destroy();
        opts["admission"] = "validate".into();
        let mut reopened = distribution.open(saved.as_bytes(), &opts.to_string());
        assert!(matches!(reopened.initialization(), SdkResponse::Ok { .. }));
        assert_eq!(snapshot(&mut reopened), expected);
    }

    #[test]
    fn osr144_poetry_only_admission_and_paste_leave_live_prose_atomic() {
        let fixture = osr144_fixture();
        let corpus = osr144_corpus();
        let doc019 = corpus["fixtures"]
            .as_array()
            .unwrap()
            .iter()
            .find(|document| document["id"] == "DOC-019")
            .unwrap();
        let verse = &doc019["cases"][0]["kwdj"]["content"][0];
        let source = osr144_document(
            "prose",
            json!([{"type":"paragraph","content":[{"type":"text","text":"Prose"}]}]),
        );
        let mut session = osr183_open(&source);
        let root = state(&mut session)["root"].clone();
        osr184_select(&mut session, &root, 1, &root, 1);
        let initial = state(&mut session);
        let cfg = options(false);
        let mut source_profile = cfg["profile"].clone();
        source_profile.as_object_mut().unwrap().remove("extensions");
        for node in [verse, &verse["content"][0], &verse["content"][2]] {
            let raw = osr144_document("prose", json!([node]));
            let reply = call(
                &mut session,
                json!({
                    "kind":"remount","stamp":initial["stamp"],"input_json":raw,"admission":"validate",
                }),
            );
            osr144_diagnostic(&reply, &fixture["refusals"]["prose_grammar"]);
            assert_eq!(state(&mut session), initial);
            assert_eq!(snapshot(&mut session), source);
            for (mode, oracle) in [
                ("poetry", "clipboard_poetry_mode"),
                ("prose", "prose_grammar"),
            ] {
                let fragment = json!({
                    "format_id":"org.klenwriter.kwdj/clipboard-fragment/1","source_profile":source_profile,
                    "mode":mode,"kind":"blocks","open_start":false,"open_end":false,"content":[node],
                });
                let reply = osr183_command(
                    &mut session,
                    "org.klenwriter.kwdj/command/insert-fragment",
                    &json!({"kind":"insert_fragment","fragment_json":fragment.to_string()}),
                    false,
                );
                osr144_diagnostic(&reply, &fixture["refusals"][oracle]);
                assert_eq!(state(&mut session), initial);
                assert_eq!(snapshot(&mut session), source);
            }
        }
    }
}
