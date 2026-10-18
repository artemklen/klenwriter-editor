// SPDX-License-Identifier: MIT OR Apache-2.0
use editor_protocol::v2::{CompiledProfileV2, OpenOptionsV2};
use editor_protocol::{DiagnosticDto, SdkResponse};
use klenwriter_editor_bridge::{
    CreatedEndpoint, Distribution, Endpoint, SessionFactory, capability_digest,
};
use std::{cell::Cell, rc::Rc};

struct RecordingFactory {
    capability: CompiledProfileV2,
    calls: Rc<Cell<usize>>,
}
impl SessionFactory for RecordingFactory {
    fn capability(&self) -> CompiledProfileV2 {
        self.capability.clone()
    }
    fn open(&self, _: &[u8], _: &OpenOptionsV2) -> Result<CreatedEndpoint, DiagnosticDto> {
        self.calls.set(self.calls.get() + 1);
        Err(klenwriter_editor_bridge::convert::diagnostic(
            "fixture.factory_reached",
            "",
        ))
    }
}
fn packet() -> serde_json::Value {
    serde_json::from_str(include_str!(
        "../../../contracts/sdk-v2/v1/factory-vectors.json"
    ))
    .unwrap()
}

#[test]
fn independent_dispatch_literals_guard_factories_before_document_decode() {
    let packet = packet();
    for case in packet["cases"].as_array().unwrap() {
        let calls = Rc::new(Cell::new(0));
        let factory = RecordingFactory {
            capability: serde_json::from_value(packet["capability"].clone()).unwrap(),
            calls: calls.clone(),
        };
        let distribution = Distribution::new(
            packet["build_id"].as_str().unwrap(),
            vec![Box::new(factory)],
        )
        .unwrap();
        let mut session = distribution.open(
            packet["input_utf8"].as_str().unwrap().as_bytes(),
            case["options_json"].as_str().unwrap(),
        );
        let SdkResponse::Refused { diagnostic } = session.initialization() else {
            panic!("fixture must refuse: {}", case["id"]);
        };
        assert_eq!(
            diagnostic.code,
            case["expected"]["code"].as_str().unwrap(),
            "{}",
            case["id"]
        );
        assert_eq!(
            calls.get(),
            case["expected"]["factory_calls"].as_u64().unwrap() as usize,
            "{}",
            case["id"]
        );
        assert!(session.context().is_none());
        assert_eq!(session.own_resource_counts().sessions, 0);
        session.destroy();
    }
}

#[test]
fn composition_conflicts_and_empty_missing_capability_are_explicit() {
    let packet = packet();
    let capability: CompiledProfileV2 =
        serde_json::from_value(packet["capability"].clone()).unwrap();
    let factories = (0..2)
        .map(|_| {
            Box::new(RecordingFactory {
                capability: capability.clone(),
                calls: Rc::new(Cell::new(0)),
            }) as Box<dyn SessionFactory>
        })
        .collect();
    let Err(error) = Distribution::new("fixture", factories) else {
        panic!("duplicate compiled factory accepted")
    };
    assert_eq!(error.code, "sdk.factory_conflict");
    let empty = Distribution::new(packet["build_id"].as_str().unwrap(), vec![]).unwrap();
    assert_eq!(empty.manifest().abi, "editor-sdk/2");
    assert!(empty.manifest().profiles.is_empty());
    let session = empty.open(
        b"invalid document",
        packet["cases"][0]["options_json"].as_str().unwrap(),
    );
    let SdkResponse::Refused { diagnostic } = session.initialization() else {
        panic!("missing module accepted")
    };
    assert_eq!(diagnostic.code, "profile.unsupported_profile");
}

#[test]
fn immutable_capability_context_separates_build_registry_and_effective_reductions() {
    let registry = "0".repeat(64);
    let first = capability_digest("build-a", &registry, br#"{"units":1}"#).unwrap();
    assert_eq!(first.len(), 64);
    assert_ne!(
        first,
        capability_digest("build-b", &registry, br#"{"units":1}"#).unwrap()
    );
    assert_ne!(
        first,
        capability_digest("build-a", &"1".repeat(64), br#"{"units":1}"#).unwrap()
    );
    assert_ne!(
        first,
        capability_digest("build-a", &registry, br#"{"units":2}"#).unwrap()
    );
    assert_eq!(
        first,
        capability_digest("build-a", &registry, br#"{"units":1}"#).unwrap()
    );
    assert!(capability_digest("build-a", &registry, &vec![0; 16385]).is_err());
}
