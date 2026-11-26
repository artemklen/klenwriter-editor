# Migrate to KlenWriter Editor 1.0

This guide covers the move from the unpublished vanilla `0.1.0-alpha.1` bundle
to the coordinated Rust and npm `1.0.0` candidate. The previous bundle was
accepted from source `a6a9eb17bcdb89ea67785a45384e8091d8f95567` without a public
prerelease tag. The runtime comparison ends at
`dcaa280931e700d42f6c79b1edf6ae5f5ed82071`. Use the release manifest for the
candidate's exact source revision, package hashes and SDK build ID. [Alpha source](https://github.com/artemklen/klenwriter-editor/commit/a6a9eb17bcdb89ea67785a45384e8091d8f95567), [comparison runtime](https://github.com/artemklen/klenwriter-editor/commit/dcaa280931e700d42f6c79b1edf6ae5f5ed82071)

## Upgrade the artifact set

1. Start with the verified `1.0.0` artifact set for your integration. Replace
   the complete set of local npm `file:` tarball pins or Cargo archive pins.
   The alpha already uses the `@klenwriter/editor*` names. Cargo and npm
   package names are listed in the [package map](../package-map.json).
2. Refresh the lockfile and check the resolved editor packages. Verify each
   archive against the release manifest. For deployments that copy static
   assets, update the prebuilt WASM, its JavaScript glue and snippets alongside
   the loader, renderer and styles. Invalidate cached asset URLs as needed.
   A loader paired with the other build's WASM refuses with `sdk.build_mismatch`
   during the seal check, even when both implement the same SDK ABI.
3. Rebuild custom renderer catalogs and compiled extension inventories against
   the matching runtime. Replace pinned build IDs and compiled registry or
   capability digests. The base KWDJ descriptor shipped with the old example
   has the same value as `@klenwriter/editor-kwdj/registry.json` in the new
   runtime. Both inputs select the matching new compiled registry. Use the
   installed descriptor export for new integrations and inspect the advertised
   command catalog before opting in to new commands.
4. In a clean consumer, reopen a saved canonical document, edit it, export it
   and reopen those bytes. Keep the original documents and the complete previous
   artifact set available through verification.

Session ABIs `editor-sdk/1` and `editor-sdk/2`, `kwdj-codec/1`, wasm-bindgen
`0.2.129`, the KWDJ profile `1.0.0` and profile wire version `1` remain the
same. The stored schema remains `klenwriter.document` version `1`. Corpus
consumers should update their pin from `kwdj-corpus-1.0.0.json.gz` to
`kwdj-corpus-1.0.1.json.gz` and verify the corpus digest. Package SemVer, transport
versions, the persisted schema and the corpus pin can be checked independently.
[Versioning policy](versioning.md), [KWDJ corpus](../contracts/kwdj/v1/README.md)

## Omit absent optional fields in KWDJ documents

Alpha accepted explicit `null` for some optional document fields and returned
canonical JSON with those fields omitted. The newer runtime refuses this input
in both strict admission and normalization with `kwdj.invalid_structure` and
a JSON pointer. Update the producer to omit a missing paragraph `attrs`, text
`marks` or link `attrs.title`. Preserve non-null values. For example, emit
`{"type":"link","attrs":{"href":"/sample"}}` when the title is absent.

For old raw imports, retain the original bytes and remove explicit `null` only
from fields the schema declares optional. Validate the resulting document before
replacing the record. Previously exported canonical documents already omit those
fields. The rule applies to KWDJ document JSON. The `set_link` command can still
use `title: null`, and `profile_options_json` can still use `limits: null`.

## Upgrade Rust code that matches KWDJ types

`klenwriter_editor_kwdj::model::Node::VerseLine` now contains
`attrs: Option<VerseLineAttrs>`. Construct a plain line with
`Node::VerseLine { attrs: None, content }`. For a match that only needs the
contents, use `Node::VerseLine { content, .. }`.

Update exhaustive matches on `KwdjIntent<I>`, `KwdjErrorCode` and
`NormalizationEvent`. For example, handle `ClipboardInvalidContext` and
`TableCellOperationUnsupported` when matching errors and
`VerseIndentDefaultRemoved` when matching normalization events. Update exhaustive
TypeScript handling of `AlphaBlockType`, `DomTag`, `DomAttribute` and inferred
`kwdjCommand` payloads to cover the expanded unions.

## Keep poetry readable during rollback

Plain verse lines have the same canonical representation in both runtimes.
The new runtime accepts `verse_line.attrs.indent` from `1` through `8` and
normalizes explicit `0` by omitting it. The alpha reader refuses the new
positive indent even with schema version `1`. Upgrade all readers before
storing a positive indent. If you need to return to alpha, retain the newer
original and explicitly choose an unindented copy where losing that formatting
is acceptable.

## Choose the binding and renderer

Vanilla retains `mount`, `update`, `subscribe`, `export` and `destroy`. Its
standalone block allowlist adds `media_image`. Use the corresponding mounted
KWDJ catalog for tables, verse and the new domain containers. The default
mounted clipboard still refuses rich table fragments and preserves the capture
for recovery. Existing `defineUiHostAction` callbacks can continue using the
same interface. The newer KWDJ media and link host helpers are optional.

The Angular binding was delivered separately as an unpublished `0.0.0`
bootstrap package. For a zoneless app, pin its matching editor archives and
`@angular/core` `22.3.0`, use `KlenwriterEditorDirective` and wait for the
`editorReady` result before accessing the SDK handle. Follow the release
manifest for the packaged versions. The linked walkthroughs show the public
API and identify their respective archive inputs. [Rust quickstart](quickstart-rust.md), [Vanilla quickstart](quickstart-vanilla.md), [Angular quickstart](quickstart-angular.md), [Extension tutorial](extension-tutorial.md), [Compatibility matrix](support.md)
