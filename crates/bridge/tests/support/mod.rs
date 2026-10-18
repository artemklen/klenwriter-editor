// SPDX-License-Identifier: MIT OR Apache-2.0
//! Narrow empty-document fixture for transport guards, not a registry witness.
use editor_core::{
    candidate::CandidateRead,
    commands::{
        CommandCatalog, CommandDescriptor, CommandPresentation, CommandProvider, CommandState,
        PlanBuilder,
    },
    document::{Document, Mark},
    positions::Selection,
    profile::{AdmissionMode, FrozenProfile, ProfileBinding},
    transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter},
};
use editor_engine::{AccessMode, SessionKey};
use editor_protocol::{CommandDto, DiagnosticDto};
use klenwriter_editor_bridge::{Bridge, BridgeAdapter, BridgeOpen};

pub struct EmptyProfile {
    binding: ProfileBinding,
    ids: Vec<String>,
}
impl FrozenProfile for EmptyProfile {
    type Context = ();
    type Admitted = ();
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        &self.binding
    }
    fn admit_bytes(
        &self,
        requested: &ProfileBinding,
        input: &[u8],
        _: AdmissionMode,
    ) -> Result<(), Self::Error> {
        self.binding
            .ensure_matches(requested)
            .map_err(|_| "fixture.binding")?;
        if input == b"[]" {
            Ok(())
        } else {
            Err("fixture.document")
        }
    }
    fn context(&self, _: &()) {}
    fn to_document(&self, _: &()) -> Document {
        Document { children: vec![] }
    }
    fn admit_snapshot(&self, _: &(), document: &Document) -> Result<(), Self::Error> {
        if document.children.is_empty() {
            Ok(())
        } else {
            Err("fixture.document")
        }
    }
    fn canonical<'a>(&self, _: &'a ()) -> &'a [u8] {
        b"[]"
    }
}
impl TransactionProfile for EmptyProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        self.validate_candidate(&(), view, work)?;
        Ok(vec![])
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        view: &V,
        work: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        work.charge_units(1).map_err(|_| "fixture.work")?;
        if !view.roots().is_empty() {
            return Err("fixture.document");
        }
        Ok(ValidationStats::default())
    }
}
impl CommandProvider for EmptyProfile {
    type Intent<I: Copy + Eq + Ord> = ();
    const COMMANDS: &'static [CommandDescriptor] = &[];
    fn command_catalog(&self) -> CommandCatalog<'_> {
        CommandCatalog::Runtime(&self.ids)
    }
    fn command_id<I: Copy + Eq + Ord>(_: &()) -> &str {
        "org.example.transport/noop"
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: CommandState<'_, V::Id>,
        _: &(),
        _: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        Err("fixture.unused")
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: Option<Selection<V::Id>>,
        _: Option<&[Mark]>,
        _: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        Ok(None)
    }
    fn error_code(error: &Self::Error) -> &'static str {
        error
    }
}
pub struct EmptyAdapter;
impl BridgeAdapter<EmptyProfile> for EmptyAdapter {
    fn decode_command(&self, _: SessionKey, _: &CommandDto) -> Result<(), DiagnosticDto> {
        panic!("transport fixture must never execute")
    }
    fn profile_error(error: &&'static str) -> DiagnosticDto {
        klenwriter_editor_bridge::convert::diagnostic(error, "")
    }
}
pub fn bridge(ids: Vec<String>) -> Bridge<EmptyProfile, EmptyAdapter> {
    let binding = ProfileBinding::new(
        "org.example.transport",
        "1.0.0",
        "org.example.transport/json",
        1,
        &[],
    )
    .unwrap();
    Bridge::new(
        b"[]",
        BridgeOpen {
            profile: EmptyProfile {
                binding: binding.clone(),
                ids,
            },
            binding,
            admission: AdmissionMode::Strict,
            access: AccessMode::Editable,
        },
        EmptyAdapter,
    )
}
