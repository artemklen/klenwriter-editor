# Roadmap

## Available in local packages

- Generic Rust session core with a versioned, declarative extension boundary.
  KWDJ v1 and Generic Notes are independent profiles.
- Prebuilt browser WASM, a framework-free DOM editor and an Angular binding.
  Hosts supply saving, reference resolution, media and dialog behavior.
- Local installer examples, canonical JSON import/export and a public
  [corpus contribution path](corpus-contributor.md).

See the [compatibility matrix](support.md) for browser tiers and the limitations
of the current preview.

## Planned for 1.0

- Coordinated native and web packages, with an external clean-install check and
  versioned provenance.
- Release-specific operating-system and browser results, a changelog, and
  migration, support and deprecation guidance.
- An independent walkthrough that adds an extension, saves a document and
  opens it again.

## Deferred

- Promotion of Firefox from experimental compatibility after the installed
  production-adapter checks described in the [support matrix](support.md).
- Mobile authoring, CJK composition acceptance, collaborative editing and
  real screen-reader acceptance.
