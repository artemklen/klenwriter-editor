# Changelog

## Unreleased

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
