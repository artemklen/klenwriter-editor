# KlenWriter Editor: identity and version namespaces

Decision: OSR-54, 2026-10-17. The owner explicitly confirmed **KlenWriter Editor**
and the `klenwriter-editor-*` / `@klenwriter/editor*` families in the task discussion.
Original source remains **MIT OR Apache-2.0**, at the recipient's option, under
the accepted D10/D11 ownership/transfer decision. This identity decision does not
publish packages or declare the bootstrap a usable alpha.

## Distribution map

[`package-map.json`](../package-map.json) owns the current names and roles.
The manifest/lock, import, compiler target, CI and packed-consumer migration uses
this map. Generic names carry no mandatory KWDJ storage semantics.

| Directory | Distribution name | Responsibility |
| --- | --- | --- |
| `crates/core` | `klenwriter-editor-core` | Generic semantic primitives |
| `crates/engine` | `klenwriter-editor-engine` | Generic sessions/transactions boundary |
| `crates/kwdj` | `klenwriter-editor-kwdj` | Separate KWDJ profile/codec |
| `crates/wasm` | `klenwriter-editor-wasm` | WASM composition/distribution |
| `packages/wasm` | `@klenwriter/editor-wasm` | Prebuilt artifact and glue |
| `packages/sdk` | `@klenwriter/editor-sdk` | Generic SDK boundary |
| `packages/dom` | `@klenwriter/editor-dom` | Generic DOM/input boundary |
| `packages/vanilla` | `@klenwriter/editor` | Framework-free binding |
| `packages/angular` | `@klenwriter/editor-angular` | Angular binding |
| `packages/kwdj` | `@klenwriter/editor-kwdj` | Optional KWDJ profile boundary |

## Availability and publisher authorization

At `2026-10-17T07:00:09Z`, all ten exact public registry requests returned HTTP404;
the [response fingerprints and URLs](../evidence/osr-54/availability.json) preserve
that observation. Exact-name web searches returned no indexed matches. These are
date-bound public observations, not name reservation or proof of ownership of an
npm scope or private package. GitHub reports the repository public and the current
account ADMIN. npm CLI returned ENEEDAUTH; public npm scope/profile pages returned
403 to the reader. npm scope ownership and crates.io publisher authorization are
unverified. No registry write, account signup, token creation or publish occurred.

Public publishing is OSR-71. It must recheck availability and actual authenticated
publisher rights before a write; the date-bound observation cannot authorize it.
All Rust crates retain `publish = false`, all web packages `private: true`, and
versions remain `0.0.0`. The installed-tarball smoke is a development proof, not a
registry release or the standalone editor alpha of OSR-65.

## Independent version namespaces

- Package SemVer describes a particular distribution's API/artifact release.
  Current packages are unpublished bootstrap `0.0.0`.
- The host/session/extension API and native wire ABI have their own compatibility
  contracts (OSR-33/63/64). This bootstrap exports build identity only; it does not
  claim an implemented public host or wire API revision. Their map values are null.
- `org.klenwriter.kwdj` and stored `klenwriter.document` schema version1 belong to
  the KWDJ codec. A package rename/version bump does not change stored documents.
  The profile package SemVer is separate from that persisted schema version.
- wasm-bindgen's generated JS/WASM ABI is pinned to `0.2.129`; it is not the editor
  wire protocol revision. The library's lifecycle ABI will be versioned explicitly.

## Development-consumer migration

The previous `editor-internal-*` / `@editor-internal/*` identities were private
bootstrap names, with no stable external release. Update package manifests,
lockfiles and imports together using `legacyName` in the map. Vanilla imports use
the root `@klenwriter/editor` name; Rust default crate paths are
`klenwriter_editor_core`, `klenwriter_editor_kwdj`, and their peers. Cargo dependency
aliases such as `editor_kwdj` remain possible when explicitly declared.

The CMS OSR-29 pin remains the immutable historical commit `d0d2d170afbe1e0a47782308a6efad4da5d4c59b`
with its old package identity. It still resolves because that commit is in main's
history. Its next source update must change `package`, revision and lock together;
the Rust alias can remain `editor_kwdj`. Do not relabel the old git pin or claim
that an immutable commit has acquired the new package name. Frozen M0 snapshots
and their hashes remain historical evidence.

Rollback: revert the OSR-54 manifests/imports/tooling/name-map change and lockfiles.
KWDJ bytes and schema1 need no storage migration. Registry publishing is gated,
so this rollback does not require withdrawing a public package.

## License and packaging evidence

Each native/web package carries both license texts, copyright NOTICE and an exact
`SOURCE-PROVENANCE.json` copy of the root transfer record. Manifest metadata points
to that included record. It contains source paths/hashes/grants/exclusions, not
private authored documents. WASM artifacts additionally include actual upstream
third-party license texts generated from the locked dependency closure. The
repository license does not relicense third-party code or design assets.

`npm run check:metadata` checks identities, SPDX, independent version namespaces,
license bytes and provenance copies. After reviewing a root ownership-manifest
change, run `npm run sync:provenance` explicitly before committing. Package checks
inspect real tarball entries and install the six artifacts into an external
project; native smoke compiles the public crate names from an external Cargo
project. The native extraction differential remains a separate source-bound proof.
