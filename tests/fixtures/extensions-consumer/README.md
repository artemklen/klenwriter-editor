# External compiled-module consumer

This separate workspace uses public generic bridge/protocol and optional concrete
profile crates. It has its own lockfile and no dependency on the production WASM
composition root. No profile codec or Session behavior is implemented here.

Select exactly `--no-default-features --features notes` or `--no-default-features
--features kwdj` for the two conformance variants. Both expose `editor-sdk/2`;
an absent concrete profile must fail capability negotiation before document decode.
The builder must supply `KLENWRITER_EDITOR_SDK_BUILD_ID` for the exact variant
source/features. The fixture has no fallback build ID. Proof that these values bind
the real binaries, seals, and module set belongs to the external build runner.

From the repository root, with the real variant identity in that environment:

```sh
cargo build --locked --offline --manifest-path tests/fixtures/extensions-consumer/Cargo.toml --no-default-features --features notes --target-dir /tmp/editor-external-notes
cargo build --locked --offline --manifest-path tests/fixtures/extensions-consumer/Cargo.toml --no-default-features --features notes --target wasm32-unknown-unknown --lib --target-dir /tmp/editor-external-notes
cargo tree --locked --offline --manifest-path tests/fixtures/extensions-consumer/Cargo.toml --no-default-features --features notes -e normal
```

Repeat with `kwdj` and a separate target directory/build identity. Use the pinned
wasm-bindgen tool on the resulting cdylib. Target directories are outside this
fixture and are not part of its committed source or lockfile.

The native `extensions-consumer` reads one closed JSON request per stdin line and
writes one JSON response per stdout line. Requests are `{"op":"manifest"}`,
`{"op":"resources"}`, `{"op":"open","input":"original document JSON",
"options_json":"original V2 options JSON"}`, `{"op":"initialization"}`,
`{"op":"context"}`, `{"op":"call","request_json":"original request JSON"}`,
`{"op":"own_resources"}`, and `{"op":"destroy"}`. The three nested JSON strings
are passed unchanged to the actual SDK. An additional open replaces the owned
endpoint after destroying its predecessor. Invalid harness envelopes exit nonzero;
SDK refusals remain the actual typed responses.

The cdylib exports `SdkSessionV2`, `sdkManifestV2`, and `sdkResourceCountsV2`.
The class has the same constructor, initialization/context/call/destroy methods as
the packaged V2 bridge, plus `ownResourceCounts` for resource observations. The
caller invokes `destroy()` and the generated bindgen `free()` when finished.
