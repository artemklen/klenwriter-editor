// SPDX-License-Identifier: MIT OR Apache-2.0
//! KWDJ legacy SDK adapter over the same typed generic bridge used by other profiles.
mod clipboard_v2;
mod convert;
mod factory;
pub mod wire_v2;
pub use convert::target_out;
pub use factory::{KwdjFactory, KwdjOptionsV2};
pub mod wire;
use crate::convert::*;
use crate::wire::*;
pub use editor_bridge::{BUILD_ID, decode, resource_counts};
use editor_bridge::{Bridge, BridgeAdapter, BridgeOpen};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_engine::{AccessMode, NodeId, SessionKey};
use editor_kwdj::{
    AdmissionBudget, IdentityResolver, IdentityResolverError, IdentityStatus, KwdjProfile, Limits,
};
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;
use uuid::Uuid;
#[derive(Default)]
struct Facts {
    media: BTreeMap<Uuid, IdentityFactStatusDto>,
    references: BTreeMap<Uuid, IdentityFactStatusDto>,
}
impl Facts {
    fn from_dto(v: IdentityFactsDto) -> Result<Self, DiagnosticDto> {
        fn entries(
            v: Vec<IdentityFactDto>,
        ) -> Result<BTreeMap<Uuid, IdentityFactStatusDto>, DiagnosticDto> {
            if v.len() > 256 {
                return Err(diagnostic("sdk.identity_limit", "identities"));
            }
            let mut result = BTreeMap::new();
            for fact in v {
                let id = Uuid::parse_str(&fact.id)
                    .map_err(|_| diagnostic("sdk.invalid_identity", "identities.id"))?;
                if id.to_string() != fact.id || result.insert(id, fact.status).is_some() {
                    return Err(diagnostic("sdk.invalid_identity", "identities.id"));
                }
            }
            Ok(result)
        }
        Ok(Self {
            media: entries(v.media)?,
            references: entries(v.references)?,
        })
    }
    fn resolve(v: Option<&IdentityFactStatusDto>) -> Result<IdentityStatus, IdentityResolverError> {
        match v {
            Some(IdentityFactStatusDto::Exists) => Ok(IdentityStatus::Exists),
            Some(IdentityFactStatusDto::Missing) => Ok(IdentityStatus::Missing),
            _ => Err(IdentityResolverError::Unavailable),
        }
    }
}
struct FactStore(RefCell<Facts>);
impl IdentityResolver for FactStore {
    fn resolve_media(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Facts::resolve(self.0.borrow().media.get(id))
    }
    fn resolve_reference(&self, id: &Uuid) -> Result<IdentityStatus, IdentityResolverError> {
        Facts::resolve(self.0.borrow().references.get(id))
    }
}

fn profile_limits(value: Option<ProfileLimitsDto>) -> Result<Limits, DiagnosticDto> {
    let mut limits = Limits::default();
    if let Some(value) = value {
        for (incoming, target, path) in [
            (
                value.document_bytes,
                &mut limits.document_bytes,
                "limits.document_bytes",
            ),
            (
                value.tree_depth,
                &mut limits.tree_depth,
                "limits.tree_depth",
            ),
            (
                value.node_count,
                &mut limits.node_count,
                "limits.node_count",
            ),
            (
                value.text_leaf_bytes,
                &mut limits.text_leaf_bytes,
                "limits.text_leaf_bytes",
            ),
            (
                value.table_rows,
                &mut limits.table_rows,
                "limits.table_rows",
            ),
            (
                value.table_effective_columns,
                &mut limits.table_effective_columns,
                "limits.table_effective_columns",
            ),
            (
                value.authored_attribute_bytes,
                &mut limits.authored_attribute_bytes,
                "limits.authored_attribute_bytes",
            ),
        ] {
            if let Some(incoming) = incoming {
                *target = (*target).min(decimal(&incoming, path)?);
            }
        }
    }
    Ok(limits)
}

pub fn manifest() -> SdkManifest {
    let facts = FactStore(RefCell::new(Facts::default()));
    let p = KwdjProfile::new(&facts, Limits::default(), AdmissionBudget::default());
    SdkManifest {
        abi: SDK_ABI.into(),
        build_id: BUILD_ID.into(),
        profiles: vec![profile_out(p.binding())],
    }
}
pub struct KwdjAdapter {
    facts: Rc<FactStore>,
}
impl Default for KwdjAdapter {
    fn default() -> Self {
        Self {
            facts: Rc::new(FactStore(RefCell::new(Facts::default()))),
        }
    }
}
impl KwdjAdapter {
    /// Prepare owned KWDJ semantics for an outer negotiated distribution factory.
    /// This does not admit a document, publish state, or translate through ABI1.
    pub fn prepare_profile(
        identities: IdentityFactsDto,
        limits: ProfileLimitsDto,
    ) -> Result<(Self, KwdjProfile<'static>), DiagnosticDto> {
        Self::prepare_owned(identities, Some(limits))
    }
    fn prepare_owned(
        identities: IdentityFactsDto,
        limits: Option<ProfileLimitsDto>,
    ) -> Result<(Self, KwdjProfile<'static>), DiagnosticDto> {
        let facts = Rc::new(FactStore(RefCell::new(Facts::from_dto(identities)?)));
        let profile = KwdjProfile::new_owned(
            facts.clone(),
            profile_limits(limits)?,
            AdmissionBudget::default(),
        );
        Ok((Self { facts }, profile))
    }
    fn prepare_open(
        &mut self,
        input: &[u8],
        json: &str,
    ) -> Result<BridgeOpen<KwdjProfile<'static>>, DiagnosticDto> {
        if input.len() > 16 * 1024 * 1024 {
            return Err(diagnostic("sdk.payload_limit", "input"));
        }
        let options: OpenOptions = decode(json)?;
        if options.abi != SDK_ABI {
            return Err(diagnostic("sdk.abi_mismatch", "abi"));
        }
        if options.build_id != BUILD_ID {
            return Err(diagnostic("sdk.build_mismatch", "build_id"));
        }
        let binding = profile_in(&options.profile)?;
        let (adapter, profile) = Self::prepare_owned(options.identities, options.limits)?;
        profile
            .binding()
            .ensure_matches(&binding)
            .map_err(|e| diagnostic(e.as_str(), "profile"))?;
        *self = adapter;
        Ok(BridgeOpen {
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
        })
    }
    fn update_facts(&mut self, identities: IdentityFactsDto) -> Result<(), DiagnosticDto> {
        let facts = Facts::from_dto(identities)?;
        *self.facts.0.borrow_mut() = facts;
        Ok(())
    }
}
impl BridgeAdapter<KwdjProfile<'static>> for KwdjAdapter {
    fn selection_text<V: editor_core::candidate::CandidateRead<Id = NodeId>>(
        &self,
        view: &V,
        selection: editor_core::positions::Selection<NodeId>,
        max_bytes: u32,
        work: &mut editor_core::transaction::WorkMeter,
    ) -> Result<editor_bridge::SelectionTextData, DiagnosticDto> {
        let data = editor_kwdj::commands::selected_text(view, selection, max_bytes, work).map_err(
            |e| match e {
                editor_kwdj::commands::SelectionTextError::Limit(code) => diagnostic(code, ""),
                editor_kwdj::commands::SelectionTextError::Invalid => {
                    diagnostic("position.invalid", "")
                }
                editor_kwdj::commands::SelectionTextError::Work(e) => {
                    let mut d = diagnostic("resource_limit_exceeded", "");
                    d.details.insert("limit".into(), e.name.into());
                    d.details.insert("maximum".into(), e.maximum.to_string());
                    d.details.insert("observed".into(), e.observed.to_string());
                    d
                }
            },
        )?;
        Ok(editor_bridge::SelectionTextData {
            projection_id: "org.klenwriter.kwdj/selection-text/1".into(),
            text: data.text,
            empty: data.empty,
            selected_atoms: data.selected_atoms,
        })
    }
    fn decode_command(
        &self,
        key: SessionKey,
        command: &CommandDto,
    ) -> Result<editor_kwdj::commands::KwdjIntent<NodeId>, DiagnosticDto> {
        intent_in(decode::<KwdjIntentDto>(&command.payload_json)?, key)
    }
    fn profile_error(error: &editor_kwdj::KwdjProfileError) -> DiagnosticDto {
        profile_error(error)
    }
}
pub struct BridgeSession {
    inner: Bridge<KwdjProfile<'static>, KwdjAdapter>,
}
impl BridgeSession {
    pub fn new(input: &[u8], options_json: &str) -> Self {
        let mut adapter = KwdjAdapter::default();
        let inner = match adapter.prepare_open(input, options_json) {
            Ok(open) => Bridge::new(input, open, adapter),
            Err(error) => Bridge::refused(adapter, error),
        };
        Self { inner }
    }
    pub fn initialization(&self) -> SdkResponse {
        self.inner.initialization()
    }
    pub fn call_json(&mut self, json: &str) -> String {
        if let Some(response) = self.inner.retained_fatal_response() {
            return self.inner.encode_response(response);
        }
        let response = match decode(json) {
            Ok(request) => self.call(request),
            Err(diagnostic) => SdkResponse::Refused { diagnostic },
        };
        self.inner.encode_response(response)
    }
    pub fn call(&mut self, request: SdkRequest) -> SdkResponse {
        dispatch_kwdj(&mut self.inner, request)
    }
    pub fn destroy(&mut self) {
        self.inner.destroy();
    }
    pub fn own_resource_counts(&self) -> ResourceCountsDto {
        self.inner.own_resource_counts()
    }
}
impl editor_bridge::Endpoint for BridgeSession {
    fn initialization(&self) -> SdkResponse {
        BridgeSession::initialization(self)
    }
    fn call_json(&mut self, json: &str) -> String {
        BridgeSession::call_json(self, json)
    }
    fn destroy(&mut self) {
        BridgeSession::destroy(self);
    }
    fn own_resource_counts(&self) -> ResourceCountsDto {
        BridgeSession::own_resource_counts(self)
    }
}
trait FactsAdapter {
    fn kwdj_adapter(&mut self) -> &mut KwdjAdapter;
}
impl FactsAdapter for KwdjAdapter {
    fn kwdj_adapter(&mut self) -> &mut KwdjAdapter {
        self
    }
}
impl FactsAdapter for editor_bridge::recipes::RecipeAdapter<KwdjAdapter> {
    fn kwdj_adapter(&mut self) -> &mut KwdjAdapter {
        self.inner_mut()
    }
}
impl FactsAdapter for editor_bridge::recipes::RecipeAdapter<clipboard_v2::ClipboardAdapterV2> {
    fn kwdj_adapter(&mut self) -> &mut KwdjAdapter {
        &mut self.inner_mut().0
    }
}
fn dispatch_kwdj<P, A>(inner: &mut Bridge<P, A>, request: SdkRequest) -> SdkResponse
where
    P: editor_core::commands::CommandProvider,
    A: BridgeAdapter<P> + FactsAdapter,
{
    match request {
        SdkRequest::State {} => inner.call(BridgeRequest::State {}),
        SdkRequest::Catalog {} => inner.call(BridgeRequest::Catalog {}),
        SdkRequest::Node { stamp, node } => inner.call(BridgeRequest::Node { stamp, node }),
        SdkRequest::QueryCommand { stamp, command } => {
            inner.call(BridgeRequest::QueryCommand { stamp, command })
        }
        SdkRequest::Command {
            stamp,
            command,
            history_hint,
        } => inner.call(BridgeRequest::Command {
            stamp,
            command,
            history_hint,
        }),
        SdkRequest::QueryHistory { stamp, direction } => {
            inner.call(BridgeRequest::QueryHistory { stamp, direction })
        }
        SdkRequest::History { stamp, direction } => {
            inner.call(BridgeRequest::History { stamp, direction })
        }
        SdkRequest::SetSelection { stamp, selection } => {
            inner.call(BridgeRequest::SetSelection { stamp, selection })
        }
        SdkRequest::SetStoredMarks { stamp, marks } => {
            inner.call(BridgeRequest::SetStoredMarks { stamp, marks })
        }
        SdkRequest::Barrier { stamp } => inner.call(BridgeRequest::Barrier { stamp }),
        SdkRequest::Snapshot { stamp, max_bytes } => {
            inner.call(BridgeRequest::Snapshot { stamp, max_bytes })
        }
        SdkRequest::AcknowledgeSnapshot { stamp, handle } => {
            inner.call(BridgeRequest::AcknowledgeSnapshot { stamp, handle })
        }
        SdkRequest::ReconcileSnapshot { stamp, handle } => {
            inner.call(BridgeRequest::ReconcileSnapshot { stamp, handle })
        }
        SdkRequest::ReleaseSnapshot { handle } => {
            inner.call(BridgeRequest::ReleaseSnapshot { handle })
        }
        SdkRequest::MapPosition {
            stamp,
            from_revision,
            position,
        } => inner.call(BridgeRequest::MapPosition {
            stamp,
            from_revision,
            position,
        }),
        SdkRequest::Events {} => inner.call(BridgeRequest::Events {}),
        SdkRequest::AcknowledgeEvents { cursor } => {
            inner.call(BridgeRequest::AcknowledgeEvents { cursor })
        }
        SdkRequest::Remount {
            stamp,
            input_json,
            admission,
        } => inner.call(BridgeRequest::Remount {
            stamp,
            input_json,
            admission,
        }),
        SdkRequest::UpdateFacts { stamp, identities } => {
            inner.update_context(stamp, move |a| a.kwdj_adapter().update_facts(identities))
        }
        SdkRequest::Resources {} => inner.call(BridgeRequest::Resources {}),
        SdkRequest::Destroy {} => inner.call(BridgeRequest::Destroy {}),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use editor_core::positions::{Affinity, Position, Selection, Utf16Offset};

    #[test]
    fn post_commit_transport_failure_is_fatal_and_releases_real_resources() {
        let manifest = manifest();
        let options = OpenOptions {
            abi: manifest.abi,
            build_id: manifest.build_id,
            profile: manifest.profiles[0].clone(),
            admission: AdmissionDto::Validate,
            access: AccessDto::Editable,
            identities: IdentityFactsDto::default(),
            limits: None,
        };
        let original = br#"{"schema":"klenwriter.document","schema_version":1,"profile":"prose","content":[{"type":"paragraph","content":[{"type":"text","text":"a"}]}]}"#;
        let mut bridge = BridgeSession::new(original, &serde_json::to_string(&options).unwrap());
        assert!(matches!(bridge.initialization(), SdkResponse::Ok { .. }));
        let s = bridge.inner.session_mut().unwrap();
        let root = s.root(s.key()).unwrap();
        let block = s.node(s.key(), root).unwrap().children()[0];
        let leaf = s.node(s.key(), block).unwrap().children()[0];
        let caret = Position::Text {
            leaf,
            utf16: Utf16Offset::new(1),
            affinity: Affinity::After,
        };
        s.set_selection(
            s.key(),
            s.revision(),
            Selection {
                anchor: caret,
                focus: caret,
            },
        )
        .unwrap();
        let response = bridge.call(SdkRequest::Command {
            stamp: bridge.inner.state().unwrap().stamp,
            command: CommandDto {
                id: "org.klenwriter.kwdj/command/insert-text".into(),
                payload_json: r#"{"kind":"insert_text","text":"X"}"#.into(),
            },
            history_hint: HistoryHintDto::Isolated {},
        });
        assert!(
            matches!(&response, SdkResponse::Ok { value } if matches!(value.as_ref(), SdkReply::Mutation { effect, .. } if effect=="changed"))
        );
        let s = bridge.inner.session().unwrap();
        assert_eq!(s.revision(), 1);
        let actual: serde_json::Value =
            serde_json::from_slice(&s.export_snapshot(s.key(), 1).unwrap()).unwrap();
        assert_eq!(actual["content"][0]["content"][0]["text"], "aX");
        let fatal: SdkResponse = serde_json::from_str(&bridge.inner.transport_failure()).unwrap();
        let SdkResponse::Fatal { diagnostic } = fatal else {
            panic!("post-commit failure is not ordinary Refused");
        };
        assert!(diagnostic.may_have_committed);
        assert_eq!(diagnostic.code, "sdk.transport_failed");
        assert_eq!(diagnostic.stamp.as_ref().unwrap().revision, "1");
        assert_eq!(
            bridge.own_resource_counts(),
            ResourceCountsDto {
                sessions: 0,
                snapshot_handles: 0,
                snapshot_bytes: "0".into(),
                protected_cursors: 0
            }
        );
        let expected = SdkResponse::Fatal {
            diagnostic: diagnostic.clone(),
        };
        for raw in [
            "{",
            r#"{"kind":"state","extra":true}"#,
            r#"{"kind":"state"}"#,
        ] {
            let common: SdkResponse = serde_json::from_str(&bridge.inner.call_json(raw)).unwrap();
            assert_eq!(
                common, expected,
                "common bridge must retain terminal Fatal before decode"
            );
            let wrapper: SdkResponse = serde_json::from_str(&bridge.call_json(raw)).unwrap();
            assert_eq!(
                wrapper, expected,
                "legacy KWDJ wrapper must retain terminal Fatal before decode"
            );
            assert_eq!(bridge.own_resource_counts().sessions, 0);
        }
        assert_eq!(bridge.call(SdkRequest::State {}), expected);
        bridge.destroy();
        bridge.destroy();
    }
}
