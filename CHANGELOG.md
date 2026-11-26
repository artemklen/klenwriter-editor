# Changelog

## 1.0.0 release candidate

This is the first coordinated release candidate. The release manifest identifies
the source revision, SDK build and archive checksums. The historical comparison
starts at the [local vanilla 0.1.0-alpha.1 source revision](https://github.com/artemklen/klenwriter-editor/commit/a6a9eb17bcdb89ea67785a45384e8091d8f95567).

| Distribution or contract | Version |
| --- | --- |
| Rust crates `klenwriter-editor-*` and npm packages `@klenwriter/editor*` in the [package map](package-map.json) | `1.0.0` |
| Session SDK ABIs | `editor-sdk/1` and `editor-sdk/2` |
| KWDJ codec and hosted tools ABIs | `kwdj-codec/1` and `kwdj-tools/1` |
| KWDJ `org.klenwriter.kwdj` profile and its base extension | `1.0.0`, profile wire version `1` |
| Stored KWDJ document schema and canonical JSON | `klenwriter.document` schema `1`, `klenwriter-canonical-json-v1` |
| KWDJ corpus package | `1.0.1` |
| Generated JavaScript/WASM bindings | wasm-bindgen `0.2.129` |

### Added

- The standalone Angular directive mounts the editor, forwards native document
  revisions and releases the session when Angular destroys the directive. The
  binding targets `@angular/core` `22.3.0` and supports zoneless applications.
- The mounted KWDJ catalog adds literary blocks, warnings, labeled containers,
  verse and table cells. Table authoring supports row and column operations and
  cell alignment within the admitted geometry. The vanilla mount retains its
  bounded block set and adds `media_image` to that set.
- The KWDJ host helpers cover media picking, link dialogs and container labels.
  The standalone playground runs the Generic Notes and KWDJ profiles and
  demonstrates local canonical import and export.
- `@klenwriter/editor-kwdj/registry.json` exposes the base registry descriptor.
  `loadSdkV2WithKwdjTools` adds structural admission, normalization and text
  statistics to the verified WASM distribution.

### Changed

- KWDJ admission refuses explicit `null` in document JSON. Omit absent optional
  fields. Previously exported canonical documents remain the migration input.
- `verse_line` accepts optional positive indent. Earlier readers refuse
  that representation. Rust's `Node::VerseLine` adds an `attrs` field, and
  `KwdjIntent`, `KwdjErrorCode` and `NormalizationEvent` have new cases.
- The SDK build and compiled registry digests change. Update JS wrappers, WASM,
  glue, snippets and renderer catalogs together.
- Complete prose scene breaks round-trip as `<hr>` through HTML clipboard.
  Mounted ordinary text input handles the supported edge of a hard break.

See the [migration guide](docs/migrate-to-1.0.md) for consumer changes and the
[compatibility matrix](docs/support.md) for browser tiers and limitations.

## Bootstrap history

- OSR-30: one licensed versioned KWDJ corpus with verified CMS artifact pins,
  strict schema/integrity/additive guards and explicit native/WASM stage results;
  projections, resource refusals and extension reference evidence stay distinct
  from unimplemented editing, rendering and extension runtime stages.

- OSR-76: bounded borrowed-Uint8Array validate/normalize/canonical WASM exports,
  explicit identity facts and lossless u64 transport; native/Node-WASM parity on
  an immutable licensed synthetic snapshot, stage dispositions and boundary tests.

- OSR-77: закреплено custom canonical JSON v1 без смены valid bytes; независимые
  lossless JS/native vectors; неизвестные поля пустых node/mark variants теперь
  отказывают, вместо молчаливого удаления.

- OSR-75: raw JSON и borrowed snapshots проверяются по отдельным operational
  бюджетам до parser/copies; типизированный отказ сохраняет данные и v1 semantics.

- OSR-74: ограничена работа текстовых проекций KWDJ; превышение бюджета возвращает типизированный отказ без изменения документа.

- OSR-54: owner-confirmed KlenWriter Editor identity, `klenwriter-editor-*` Rust
  crates and `@klenwriter/editor*` web packages; development imports/metadata/locks
  migrated before public release. Package/API/storage versions stay separate;
  source provenance, both license texts and notices are included in distributions.
  Bootstrap remains unpublished `0.0.0`; registry observations do not reserve names.

- OSR-28: standalone Rust/native/WASM and TypeScript workspace, pinned build tools,
  static CSS, private artifact packaging, dependency inventory and clean CI checks.
  No production editor API or package publication yet.
