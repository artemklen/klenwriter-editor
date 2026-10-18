// SPDX-License-Identifier: MIT OR Apache-2.0
//! Compiled factory selection. All concrete profile policy stays in modules.
use crate::convert::diagnostic;
use crate::{Endpoint, SessionFactory, decode};
use editor_core::profile::{ExtensionBinding, ProfileBinding};
use editor_protocol::v2::{
    CompiledProfileV2, OpenOptionsV2, REGISTRY_FORMAT, SDK_ABI_V2, SdkManifestV2, SessionContextV2,
};
use editor_protocol::{DiagnosticDto, ResourceCountsDto, SdkReply, SdkResponse};
use sha2::{Digest, Sha256};

pub struct CreatedEndpoint {
    pub endpoint: Box<dyn Endpoint>,
    /// Lowercase SHA256 hex, independent of distribution build identity.
    pub registry_digest: String,
    pub capability_digest: String,
}

pub fn capability_digest(
    build_id: &str,
    registry_digest: &str,
    effective_capabilities: &[u8],
) -> Result<String, DiagnosticDto> {
    if build_id.len() > 128
        || !digest_value(registry_digest)
        || effective_capabilities.len() > 16 * 1024
    {
        return Err(diagnostic("sdk.invalid_factory_context", ""));
    }
    let mut hash = Sha256::new();
    hash.update(b"klenwriter-editor-capabilities/1\0");
    for part in [
        build_id.as_bytes(),
        registry_digest.as_bytes(),
        effective_capabilities,
    ] {
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part);
    }
    Ok(hash
        .finalize()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
fn digest_value(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

struct Registration {
    capability: CompiledProfileV2,
    factory: Box<dyn SessionFactory>,
}
pub struct Distribution {
    build_id: String,
    registrations: Vec<Registration>,
}
impl Distribution {
    pub fn new(
        build_id: &str,
        factories: Vec<Box<dyn SessionFactory>>,
    ) -> Result<Self, DiagnosticDto> {
        if build_id.is_empty() || build_id.len() > 128 || factories.len() > 16 {
            return Err(diagnostic("sdk.invalid_factory", "/profiles"));
        }
        let mut registrations = Vec::with_capacity(factories.len());
        for factory in factories {
            let mut capability = factory.capability();
            if capability.compiled_extensions.len() > 64 {
                return Err(diagnostic("sdk.invalid_factory", "/profiles"));
            }
            let extensions = capability
                .compiled_extensions
                .iter()
                .map(|extension| ExtensionBinding::new(&extension.id, &extension.version))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| diagnostic("sdk.invalid_factory", "/profiles"))?;
            ProfileBinding::new(
                &capability.profile_id,
                &capability.profile_version,
                &capability.codec_id,
                u64::from(capability.wire_version),
                &extensions,
            )
            .map_err(|_| diagnostic("sdk.invalid_factory", "/profiles"))?;
            capability
                .compiled_extensions
                .sort_by(|left, right| left.id.cmp(&right.id));
            registrations.push(Registration {
                capability,
                factory,
            });
        }
        registrations.sort_by(|left, right| key(&left.capability).cmp(&key(&right.capability)));
        if registrations
            .windows(2)
            .any(|pair| key(&pair[0].capability) == key(&pair[1].capability))
        {
            return Err(diagnostic("sdk.factory_conflict", "/profiles"));
        }
        Ok(Self {
            build_id: build_id.into(),
            registrations,
        })
    }
    pub fn manifest(&self) -> SdkManifestV2 {
        SdkManifestV2 {
            abi: SDK_ABI_V2.into(),
            build_id: self.build_id.clone(),
            registry_format: REGISTRY_FORMAT.into(),
            profiles: self
                .registrations
                .iter()
                .map(|registration| registration.capability.clone())
                .collect(),
        }
    }
    pub fn open(&self, input: &[u8], options_json: &str) -> DistributionSession {
        match self.prepare_open(input, options_json) {
            Ok(session) => session,
            Err(diagnostic) => DistributionSession {
                endpoint: Box::new(RefusedEndpoint(diagnostic)),
                context: None,
            },
        }
    }
    fn prepare_open(
        &self,
        input: &[u8],
        options_json: &str,
    ) -> Result<DistributionSession, DiagnosticDto> {
        let options: OpenOptionsV2 = decode(options_json)?;
        if options.abi != SDK_ABI_V2 {
            return Err(diagnostic("sdk.abi_mismatch", "/abi"));
        }
        if options.build_id != self.build_id {
            return Err(diagnostic("sdk.build_mismatch", "/build_id"));
        }
        let selected = &options.profile;
        if !self
            .registrations
            .iter()
            .any(|r| r.capability.profile_id == selected.profile_id)
        {
            return Err(diagnostic(
                "profile.unsupported_profile",
                "/profile/profile_id",
            ));
        }
        if !self.registrations.iter().any(|r| {
            r.capability.profile_id == selected.profile_id
                && r.capability.profile_version == selected.profile_version
        }) {
            return Err(diagnostic(
                "profile.unsupported_profile_version",
                "/profile/profile_version",
            ));
        }
        if !self.registrations.iter().any(|r| {
            r.capability.profile_id == selected.profile_id
                && r.capability.profile_version == selected.profile_version
                && r.capability.codec_id == selected.codec_id
        }) {
            return Err(diagnostic("profile.unsupported_codec", "/profile/codec_id"));
        }
        let registration = self
            .registrations
            .iter()
            .find(|r| {
                r.capability.profile_id == selected.profile_id
                    && r.capability.profile_version == selected.profile_version
                    && r.capability.codec_id == selected.codec_id
                    && r.capability.wire_version == selected.wire_version
            })
            .ok_or_else(|| {
                diagnostic("profile.unsupported_wire_version", "/profile/wire_version")
            })?;
        let mut created = registration.factory.open(input, &options)?;
        if !digest_value(&created.registry_digest) || !digest_value(&created.capability_digest) {
            created.endpoint.destroy();
            return Err(diagnostic("sdk.invalid_factory_context", ""));
        }
        let context = if matches!(created.endpoint.initialization(), SdkResponse::Ok { value } if matches!(*value, SdkReply::State { .. }))
        {
            Some(SessionContextV2 {
                build_id: self.build_id.clone(),
                profile: options.profile,
                registry_digest: created.registry_digest,
                capability_digest: created.capability_digest,
            })
        } else {
            None
        };
        Ok(DistributionSession {
            endpoint: created.endpoint,
            context,
        })
    }
}
fn key(capability: &CompiledProfileV2) -> (&str, &str, &str, u32) {
    (
        &capability.profile_id,
        &capability.profile_version,
        &capability.codec_id,
        capability.wire_version,
    )
}

pub struct DistributionSession {
    endpoint: Box<dyn Endpoint>,
    context: Option<SessionContextV2>,
}
impl DistributionSession {
    pub fn context(&self) -> Option<&SessionContextV2> {
        self.context.as_ref()
    }
}
impl Endpoint for DistributionSession {
    fn initialization(&self) -> SdkResponse {
        self.endpoint.initialization()
    }
    fn call_json(&mut self, request: &str) -> String {
        self.endpoint.call_json(request)
    }
    fn destroy(&mut self) {
        self.endpoint.destroy();
    }
    fn own_resource_counts(&self) -> ResourceCountsDto {
        self.endpoint.own_resource_counts()
    }
}
struct RefusedEndpoint(DiagnosticDto);
impl Endpoint for RefusedEndpoint {
    fn initialization(&self) -> SdkResponse {
        SdkResponse::Refused {
            diagnostic: self.0.clone(),
        }
    }
    fn call_json(&mut self, _: &str) -> String {
        serde_json::to_string(&self.initialization()).expect("fixed diagnostic serializes")
    }
    fn destroy(&mut self) {}
    fn own_resource_counts(&self) -> ResourceCountsDto {
        ResourceCountsDto {
            sessions: 0,
            snapshot_handles: 0,
            snapshot_bytes: "0".into(),
            protected_cursors: 0,
        }
    }
}
