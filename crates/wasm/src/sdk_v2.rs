// SPDX-License-Identifier: MIT OR Apache-2.0
//! Explicit compiled distribution. Generic dispatch lives in editor_bridge;
//! adding/removing a trusted module changes this composition and its build ID.
use editor_bridge::{Distribution, DistributionSession, Endpoint, SessionFactory};
use editor_protocol::v2::{SdkManifestV2, SessionContextV2};
use editor_protocol::{ResourceCountsDto, SdkResponse};

fn distribution() -> Distribution {
    let factories: Vec<Box<dyn SessionFactory>> = vec![
        Box::new(editor_kwdj_sdk::KwdjFactory),
        #[cfg(feature = "notes")]
        Box::new(editor_notes_sdk::NotesFactory),
    ];
    Distribution::new(editor_bridge::BUILD_ID, factories)
        .expect("compiled composition has unique valid metadata")
}
pub fn manifest() -> SdkManifestV2 {
    distribution().manifest()
}
pub fn resource_counts() -> ResourceCountsDto {
    editor_bridge::resource_counts()
}
pub struct BridgeSession {
    inner: DistributionSession,
}
impl BridgeSession {
    pub fn new(input: &[u8], options_json: &str) -> Self {
        Self {
            inner: distribution().open(input, options_json),
        }
    }
    pub fn initialization(&self) -> SdkResponse {
        self.inner.initialization()
    }
    pub fn context(&self) -> Option<&SessionContextV2> {
        self.inner.context()
    }
    pub fn call_json(&mut self, request: &str) -> String {
        self.inner.call_json(request)
    }
    pub fn destroy(&mut self) {
        self.inner.destroy();
    }
    pub fn own_resource_counts(&self) -> ResourceCountsDto {
        self.inner.own_resource_counts()
    }
}
