// SPDX-License-Identifier: MIT OR Apache-2.0
//! An external composition of public generic bridge and optional profile crates.
//! No codec, command, registry, or Session implementation is supplied here.

use editor_bridge::{Distribution, DistributionSession, Endpoint, SessionFactory};
use editor_protocol::v2::{SdkManifestV2, SessionContextV2};
use editor_protocol::{ResourceCountsDto, SdkResponse};

// The variant builder must bind the selected features and source closure. There
// is deliberately no development/default build identity in this fixture.
pub const BUILD_ID: &str = env!("KLENWRITER_EDITOR_SDK_BUILD_ID");

#[cfg(not(any(feature = "notes", feature = "kwdj")))]
compile_error!("Select at least one compiled profile explicitly: notes or kwdj");

fn distribution() -> Distribution {
    assert_eq!(BUILD_ID, editor_bridge::BUILD_ID);
    let factories: Vec<Box<dyn SessionFactory>> = vec![
        #[cfg(feature = "notes")]
        Box::new(editor_notes_sdk::NotesFactory),
        #[cfg(feature = "kwdj")]
        Box::new(editor_kwdj_sdk::KwdjFactory),
    ];
    Distribution::new(BUILD_ID, factories)
        .expect("explicit compiled factories have unique valid capabilities")
}

pub fn manifest() -> SdkManifestV2 {
    distribution().manifest()
}

pub fn resource_counts() -> ResourceCountsDto {
    editor_bridge::resource_counts()
}

pub struct ConsumerSession {
    inner: DistributionSession,
}

impl ConsumerSession {
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

    pub fn call_json(&mut self, request_json: &str) -> String {
        self.inner.call_json(request_json)
    }

    pub fn own_resource_counts(&self) -> ResourceCountsDto {
        self.inner.own_resource_counts()
    }

    pub fn destroy(&mut self) {
        self.inner.destroy();
    }
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(js_name = sdkManifestV2)]
    pub fn manifest() -> String {
        serde_json::to_string(&super::manifest()).expect("typed manifest serializes")
    }

    #[wasm_bindgen(js_name = sdkResourceCountsV2)]
    pub fn resource_counts() -> String {
        serde_json::to_string(&super::resource_counts()).expect("shared counts serialize")
    }

    #[wasm_bindgen]
    pub struct SdkSessionV2 {
        inner: super::ConsumerSession,
    }

    #[wasm_bindgen]
    impl SdkSessionV2 {
        #[wasm_bindgen(constructor)]
        pub fn new(input: &[u8], options_json: &str) -> Self {
            Self {
                inner: super::ConsumerSession::new(input, options_json),
            }
        }

        pub fn initialization(&self) -> String {
            serde_json::to_string(&self.inner.initialization())
                .expect("typed initialization serializes")
        }

        pub fn context(&self) -> String {
            serde_json::to_string(&self.inner.context()).expect("nullable context serializes")
        }

        pub fn call(&mut self, request_json: &str) -> String {
            self.inner.call_json(request_json)
        }

        #[wasm_bindgen(js_name = ownResourceCounts)]
        pub fn own_resource_counts(&self) -> String {
            serde_json::to_string(&self.inner.own_resource_counts())
                .expect("owned counts serialize")
        }

        pub fn destroy(&mut self) {
            self.inner.destroy();
        }
    }
}
