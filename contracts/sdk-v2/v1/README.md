# SDK V2 factory dispatch literals

Original MIT OR Apache-2.0 synthetic expectations authored before the generic
V2 distribution dispatcher. These thirteen cases exercise the envelope and
compiled profile/codec capability lookup before any document decoder. The one
exact-envelope case deliberately reaches a recording fixture factory, which
returns fixture.factory_reached; it does not claim document/schema admission.
All other cases require zero factory calls. Empty and conflicting factory
compositions have separate native constructor tests.

V2 is explicitly negotiated as editor-sdk/2 and retains the exact SDK1 DTOs.
The required closed options are abi,build_id,profile,admission,access,
registry_json,profile_options_json. The last two are original JSON strings;
profile module decoders enforce their own closed contracts before document
decode. Registry JSON must never pass through a JS Number roundtrip. Profile
bindings retain the u32 wire-version transport capability; wider native profile
bindings refuse before decode.

A public SessionFactory supplies compiled capability metadata and constructs
a fully typed bridge before erasing its endpoint. Generic distribution code
contains no KWDJ/notes branch. It checks exact ABI/build/profile/version/codec/
wire identity before invoking a factory. Selected extension/schema validation
belongs to that factory's mandatory public registry composition, also before
document decode. Metadata arrays have at most sixteen compiled profiles.

SessionContextV2 is obtained from a separate context() method, preserving all
36 SDK1 declarations and the closed SdkResponse. It exposes actual build_id,
profile, registry_digest and capability_digest. The latter is a domain-separated
SHA256 of build/registry identity and the effective immutable host capability
configuration, separate from semantic registry digest. A refused admission has
null context. These identifiers convey no mutation or save authority.
