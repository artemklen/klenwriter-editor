// SPDX-License-Identifier: MIT OR Apache-2.0
//! A transport capability refusal must precede every profile decoder callback.
use editor_core::candidate::CandidateRead;
use editor_core::commands::{
    CommandDescriptor, CommandPresentation, CommandProvider, CommandState, PlanBuilder,
};
use editor_core::document::{Document, Mark};
use editor_core::positions::Selection;
use editor_core::profile::{AdmissionMode, FrozenProfile, ProfileBinding};
use editor_core::transaction::{Operation, TransactionProfile, ValidationStats, WorkMeter};
use editor_engine::{AccessMode, SessionKey};
use editor_protocol::{CommandDto, DiagnosticDto, SdkResponse};
use klenwriter_editor_bridge::{Bridge, BridgeAdapter, BridgeOpen, resource_counts};

struct PoisonProfile(ProfileBinding);
impl FrozenProfile for PoisonProfile {
    type Context = ();
    type Admitted = ();
    type Error = &'static str;
    type Cache<I: Copy + Eq + Ord> = ();
    fn binding(&self) -> &ProfileBinding {
        &self.0
    }
    fn admit_bytes(
        &self,
        _: &ProfileBinding,
        _: &[u8],
        _: AdmissionMode,
    ) -> Result<(), Self::Error> {
        panic!("POISON DECODER CALLED")
    }
    fn context(&self, _: &()) -> Self::Context {
        panic!("context called")
    }
    fn to_document(&self, _: &()) -> Document {
        panic!("snapshot called")
    }
    fn admit_snapshot(&self, _: &(), _: &Document) -> Result<(), Self::Error> {
        panic!("snapshot admission called")
    }
    fn canonical<'a>(&self, _: &'a ()) -> &'a [u8] {
        panic!("canonical called")
    }
}
impl TransactionProfile for PoisonProfile {
    fn normalize_candidate<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: &mut WorkMeter,
    ) -> Result<Vec<Operation<V::Id>>, Self::Error> {
        panic!("normalizer called")
    }
    fn validate_candidate<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: &mut WorkMeter,
    ) -> Result<ValidationStats, Self::Error> {
        panic!("validator called")
    }
}
impl CommandProvider for PoisonProfile {
    type Intent<I: Copy + Eq + Ord> = ();
    const COMMANDS: &'static [CommandDescriptor] = &[];
    fn command_id<I: Copy + Eq + Ord>(_: &()) -> &str {
        "org.example.poison/never"
    }
    fn prepare_command<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: CommandState<'_, V::Id>,
        _: &(),
        _: &mut PlanBuilder<'_, V::Id>,
    ) -> Result<CommandPresentation, Self::Error> {
        panic!("command called")
    }
    fn finalize_typing_override<V: CandidateRead>(
        &self,
        _: &(),
        _: &V,
        _: Option<Selection<V::Id>>,
        _: Option<&[Mark]>,
        _: &mut WorkMeter,
    ) -> Result<Option<Vec<Mark>>, Self::Error> {
        panic!("finalizer called")
    }
    fn error_code(_: &Self::Error) -> &'static str {
        "poison.never"
    }
}
struct PoisonAdapter;
impl BridgeAdapter<PoisonProfile> for PoisonAdapter {
    fn decode_command(&self, _: SessionKey, _: &CommandDto) -> Result<(), DiagnosticDto> {
        panic!("command decoder called")
    }
    fn profile_error(_: &&'static str) -> DiagnosticDto {
        panic!("profile error called")
    }
}
#[test]
fn unsupported_wire_version_refuses_before_poison_decoder_or_resource_acquisition() {
    for version in [u64::from(u32::MAX) + 1, u64::MAX] {
        let binding = ProfileBinding::new(
            "org.example.poison",
            "1.0.0",
            "org.example.poison/json",
            version,
            &[],
        )
        .unwrap();
        let before = resource_counts();
        let bridge = Bridge::new(
            b"not even JSON",
            BridgeOpen {
                profile: PoisonProfile(binding.clone()),
                binding,
                admission: AdmissionMode::Strict,
                access: AccessMode::Editable,
            },
            PoisonAdapter,
        );
        let SdkResponse::Refused { diagnostic } = bridge.initialization() else {
            panic!("unsupported transport width admitted")
        };
        assert_eq!(diagnostic.code, "profile.unsupported_wire_version");
        assert_eq!(diagnostic.path, "profile.wire_version");
        assert!(!diagnostic.may_have_committed);
        assert_eq!(bridge.own_resource_counts().sessions, 0);
        assert_eq!(resource_counts(), before);
    }
}
