//! Distribution boundary: build identity and unstable versioned codec, not an editor.
#![forbid(unsafe_code)]

pub mod codec;
#[cfg(target_arch = "wasm32")]
mod codec_browser;
pub mod sdk;
#[cfg(target_arch = "wasm32")]
mod sdk_browser;
mod sdk_convert;
pub mod sdk_v2;
pub mod sdk_wire;

use serde::{Deserialize, Serialize};

/// Diagnostic identity. These package versions do not claim codec/API compatibility.
#[derive(Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BuildInfo {
    pub core: String,
    pub engine: String,
    pub profile_package: String,
    pub profile_id: String,
    pub bridge: String,
    pub stage: String,
}

pub fn build_info() -> BuildInfo {
    BuildInfo {
        core: editor_core::PACKAGE_VERSION.into(),
        engine: editor_engine::PACKAGE_VERSION.into(),
        profile_package: editor_kwdj::PACKAGE_VERSION.into(),
        profile_id: editor_kwdj::PROFILE_ID.into(),
        bridge: env!("CARGO_PKG_VERSION").into(),
        stage: "workspace-bootstrap".into(),
    }
}

#[cfg(target_arch = "wasm32")]
mod browser {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(js_name = buildInfo)]
    pub fn build_info_js() -> Result<JsValue, JsValue> {
        // JSON-compatible objects/nulls, rather than default Map/undefined DTOs.
        use serde::Serialize;
        super::build_info()
            .serialize(&serde_wasm_bindgen::Serializer::json_compatible())
            .map_err(|error| js_sys::Error::new(&error.to_string()).into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn native_build_identity_round_trips() {
        let info = super::build_info();
        let encoded = serde_json::to_string(&info).unwrap();
        assert_eq!(
            serde_json::from_str::<super::BuildInfo>(&encoded).unwrap(),
            info
        );
        assert_eq!(info.core, editor_engine::CORE_PACKAGE_VERSION);
        assert_eq!(info.core, editor_kwdj::CORE_PACKAGE_VERSION);
    }
}
