# Versioning KlenWriter Editor

The first coordinated release candidate uses distribution SemVer `1.0.0` for
the publishable crates and npm packages in the [package map](../package-map.json).
The candidate manifest identifies the exact source commit and the bytes tested
by consumers. A local candidate, including one with final version numbers,
becomes a published release only after authorized publication and registry
readback. Existing local bootstrap and alpha artifacts keep their own versions
and hashes.

## Five versioned surfaces

| Surface | Version and identity | When to advance it |
| --- | --- | --- |
| Rust API | Distribution SemVer for each public `klenwriter-editor-*` crate in the package map. The candidate uses `1.0.0`. | Patch for a compatible implementation fix, minor for a compatible addition such as a new opt-in command, major for removing or changing a supported public type, trait requirement, feature contract or documented behavior incompatibly. Adding a variant to an exhaustive public enum is a breaking change. |
| JavaScript and TypeScript API | Distribution SemVer for `@klenwriter/editor` and its public bindings, SDK and helpers. The candidate uses `1.0.0`. | Patch for a compatible fix, minor for a compatible new export or optional capability, major for removing an export or tightening a supported call, event, type or peer dependency incompatibly. Renaming an exported revision event requires a major release. |
| Prebuilt WASM and glue | Distribution SemVer for `@klenwriter/editor-wasm` and its exact sealed runtime. The candidate uses `1.0.0`. Record the SDK build ID, ABI offers, wasm-bindgen tool/ABI and checksums for the paired WASM and glue. | Patch when distributing a compatible runtime fix or changed artifact bytes with the same public contract. Additive negotiated capability can ship in a minor. Removing an ABI offer or changing the public host contract incompatibly requires a major package release and, for a new incompatible wire contract, a distinct ABI identifier with a migration path. |
| Profile and document contract | KWDJ profile `org.klenwriter.kwdj` at `1.0.0`, codec `org.klenwriter.kwdj/json` at wire `1` and persisted schema `klenwriter.document` at `schema_version: 1`. The registry format is `editor-registry/1` and the base extension carries its own version. | Patch for a compatible correction, minor for a compatible opt-in capability, major for an incompatible normative profile change. An incompatible codec encoding requires a new wire revision. An incompatible persisted format requires a new schema revision, explicit migration and tests with existing documents. A new node in a closed vocabulary needs its own compatibility decision because an older reader may refuse it. |
| Corpus | The `klenwriter-kwdj-contract` data package currently uses corpus version `1.0.1`. Pin the version, canonical content digest and compressed artifact checksum. | Patch for editorial or provenance corrections that preserve fixture meaning and expected outcomes, minor for additive fixtures or assertions that preserve existing IDs and expectations, major for incompatible changes to corpus format or established fixture expectations. Keep the linked schema version explicit. |

The first WASM distribution exposes the existing `editor-sdk/1` and
`editor-sdk/2` host ABI offers. The prebuilt glue uses wasm-bindgen `0.2.129`.
The native server RPC slot `nativeWireProtocolRevision` is unset in the package
map. These identifiers do not advance when package SemVer advances. Profile
SemVer, codec wire revision, persisted schema and corpus version also advance
independently. Negotiation matches the ABI and build identity with the exact
profile, codec, wire and extension versions. [Host API](sdk-v1.md),
[compiled profile negotiation](extensions.md), [KWDJ contract](../contracts/kwdj/v1/README.md).

## Coordinate a release

1. Classify API changes in Rust, TypeScript and WASM using
   [Semantic Versioning](https://semver.org/). For a coordinated family release,
   use the largest required SemVer advance across those supported distribution
   surfaces. Align the Rust and npm members, their internal dependency pins and
   lockfiles to the chosen family version. Scope profile and corpus changes to
   their own contracts and record their selected versions separately.
2. Record the source SHA and reproducible package checksums. Include the paired
   WASM and glue, ABI/build identity, registry and profile tuple, and corpus
   digest. Update the changelog and migration instructions against the same
   source. Validate that clean native, vanilla and Angular consumers install
   the pinned artifacts and can save and reopen a document. Match
   [compatibility claims](support.md) to that evidence.
3. Rebuild and review a candidate if its sources, metadata or bytes change.
   Once a package name and version has been published, release changed bytes
   under a new version. Preserve earlier checksums and tags for audit and
   recovery. A compatible Rust or JavaScript fix can advance the family patch
   while preserving KWDJ schema `1`, the ABI offers and corpus `1.0.1`.
4. The release owner authorizes a specific version for publication after the
   candidate has been reviewed and merged. The authorized publisher checks
   current namespace permissions and name/version availability, then verifies
   the versions and checksums returned by the public registries against that
   manifest. A partial publication follows the
   [release recovery procedure](release-rollback.md).
