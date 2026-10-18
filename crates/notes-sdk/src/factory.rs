// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_bridge::convert::profile_in;
use editor_bridge::recipes::RecipeAdapter;
use editor_bridge::{
    Bridge, BridgeOpen, CreatedEndpoint, SessionFactory, capability_digest, decode,
};
use editor_core::profile::{AdmissionMode, FrozenProfile};
use editor_core::transaction::{WorkLimits, WorkMeter};
use editor_engine::AccessMode;
use editor_extensions::Recipes;
use editor_notes::{BASE_EXTENSION, CODEC_ID, NotesProfile, PROFILE_ID, VERSION};
use editor_protocol::v2::{CompiledProfileV2, OpenOptionsV2};
use editor_protocol::{AccessDto, AdmissionDto, DiagnosticDto, ExtensionDto};
use editor_registry::CompilerLimits;

use crate::adapter::profile_error;
use crate::options::capability_bytes;
use crate::{NotesAdapter, NotesOptionsV2};

/// A trusted compiled module, not a runtime descriptor or profile-name switch
/// in the generic distribution. Runtime extensions remain registry data.
#[derive(Debug, Clone, Copy, Default)]
pub struct NotesFactory;
impl SessionFactory for NotesFactory {
    fn capability(&self) -> CompiledProfileV2 {
        CompiledProfileV2 {
            profile_id: PROFILE_ID.into(),
            profile_version: VERSION.into(),
            codec_id: CODEC_ID.into(),
            wire_version: 1,
            compiled_extensions: vec![ExtensionDto {
                id: BASE_EXTENSION.into(),
                version: VERSION.into(),
            }],
        }
    }

    fn open(
        &self,
        input: &[u8],
        options: &OpenOptionsV2,
    ) -> Result<CreatedEndpoint, DiagnosticDto> {
        let profile_options: NotesOptionsV2 = decode(&options.profile_options_json)?;
        let limits = profile_options.effective_limits()?;
        let mut work = WorkMeter::new(WorkLimits::default());
        let profile = NotesProfile::compile_json(
            options.registry_json.as_bytes(),
            &profile_options.root_blocks,
            limits,
            CompilerLimits::default(),
            &mut work,
        )
        .map_err(|error| profile_error(&error))?;
        let binding = profile_in(&options.profile)?;
        profile
            .binding()
            .ensure_matches(&binding)
            .map_err(|error| editor_bridge::convert::diagnostic(error.as_str(), "profile"))?;
        let registry_digest = profile.registry().digest().to_hex();
        let capability_digest = capability_digest(
            &options.build_id,
            &registry_digest,
            &capability_bytes(profile.limits())?,
        )?;
        let adapter = RecipeAdapter::new(NotesAdapter, profile.registry_handle());
        let profile = Recipes::new(profile, &mut work).map_err(|error| {
            let mut result = editor_bridge::convert::diagnostic(error.code.as_str(), &error.path);
            result.category = "registry".into();
            result
        })?;
        let endpoint = Bridge::new(
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
            endpoint: Box::new(endpoint),
            registry_digest,
            capability_digest,
        })
    }
}
