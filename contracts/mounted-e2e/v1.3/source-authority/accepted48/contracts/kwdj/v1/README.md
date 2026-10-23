# KWDJ v1 contract package

## Documentation metadata

| Field | Value |
| --- | --- |
| Kind | contract |
| Status | accepted |
| Authority | authoritative |
| Applies to | KWDJ v1 contract package entry (schema/fixtures/corpus); not an implementation |

Status: accepted contract-only package. This directory adds no Rust or TypeScript implementation, runtime dependency, database object, API route/DTO, editor component, migration, or export capability.

The inherited CMS decisions are KWC-11, KWC-1, KWC-2 and KWC-39, with the accepted KWDJ operational policy. Their original paths and revision are recorded in source provenance. This package preserves those v1 rules. The current library profile and accepted canonical ADR are public in KlenWriter Editor; a disagreement requires architecture review, never a silent consumer-specific choice.

## Authority, version and consumer pins (OSR-30)

The canonical versioned corpus lives in `artemklen/klenwriter-editor` under
`contracts/kwdj/v1`. CMS consumes an immutable verified artifact; its local
files are generated consumer data, not an independently editable expected matrix.
A consumer pins the source Git revision, package version, content digest and
SHA-256 of `corpus-package.json`. Package version alone is insufficient.

The initial transfer preserves the eight source contract/data files from CMS
baseline `a7f8a081b7827dd31097ad6c9104654366ae6e04`, with ownership/current-runtime
clarifications in this README. All 34 DOC IDs / 59 cases and literal expected
values are retained. `source-provenance.json`, both license texts and NOTICE
record the owner's MIT OR Apache-2.0 grant and per-file privacy review.

Native Rust validation already exists in KlenWriter Editor; KWDJ is its first
profile. The custom canonical rule is `klenwriter-canonical-json-v1` (ADR-004),
not JCS. The three codec exports use unstable ABI `kwdj-codec/1`; editing,
session and extension runtime remain separate implementation gates.

A change is additive only when existing IDs, case names, inputs and expected
values stay unchanged. Never remove/rename a case or silently adjust an expected
value to match an implementation. New cases require a new package version and
content digest, provenance and explicit consumer pin updates. A semantic change
requires a versioned compatibility decision. The original 34/59 baseline is
checked independently; a skipped or non-owned stage is never a pass.

The source CMS decisions KWC-11/KWC-1/KWC-2/KWC-39 remain host-history references.
Counting rules below and the current Rust profile preserve the accepted v1
semantics; no storage/API migration accompanies the authority transfer.

## Package contents

| Path | Role |
| --- | --- |
| `kwdj.schema.json` | Normative JSON Schema 2020-12 structural grammar for normalized KWDJ v1. |
| `fixture.schema.json` | Normative shape for corpus files, including typed inputs, expected results, diagnostics, and pipeline stages. |
| `manifest.json` | Normative DOC-001–034 index, exact JSON Pointers, classifications, files, count, and known contract gaps. |
| `fixtures/positive.json` | Cases whose primary KWDJ/adapter path succeeds. |
| `fixtures/negative.json` | Fail-closed, audit, or explicitly diagnosed clipboard cases. |
| `fixtures/mixed.json` | Mixed accepted/rejected cases, including the executable DOC-026 resource boundaries. |
| `fixtures/deferred.json` | DOC-024, which cannot be executable until a real later KWDJ version and upconverter exist. |

All files are UTF-8 JSON/Markdown with LF endings. JSON object member order is not semantic. Array order is semantic unless a rule below explicitly defines sorting.

## Contract boundary

KWDJ is the sole canonical structured-content value inside one immutable Content Model v2 revision. The schema does not describe:

- Tiptap/ProseMirror selection, transactions, history, decorations, node-view state, preview URLs, DOM, or clipboard source;
- API resources, routes, DTO wrappers, ETags, commands, or persistence columns;
- generated public HTML or plain text as an input format;
- Markdown as anything other than controlled legacy migration input;
- any supported export contract.

The complete acceptance pipeline is:

```text
input adapter -> candidate KWDJ -> closed-shape decode/preflight -> normalization
-> structural validation -> semantic validation -> identity resolution
-> canonical revision value -> derived editor/public/plain/manifests
```

No stage may repair an unsupported or ambiguous semantic construct by dropping it. A typed rejection or migration audit/block is preferable to a lossy success.

## Structural schema

`kwdj.schema.json` closes every document, node, mark, and attribute object with `additionalProperties: false` and compiles under AJV 8 Draft 2020-12 strict mode. The envelope is exactly:

- `schema = "klenwriter.document"`;
- `schema_version = 1`;
- `profile = "prose" | "poetry"`;
- non-empty ordered `content`.

An authored empty prose document is one empty `paragraph`, not an empty root array. Empty `text` leaves are invalid and normalize away; required empty paragraph and `verse_line` content arrays remain.

The schema describes the normalized canonical value. A fixture adapter input may be pre-normalized and therefore fail this schema before the defined normalization step; its `kwdj` and resolved `expected.normalized_kwdj` must pass. A value already presented as normalized KWDJ does not get this adapter allowance.

Consequently:

- an optional `marks` member, when present, contains at least one mark; `marks: []` is pre-normalized input only and normalizes to an absent member;
- an ordered list starting at `1` omits `attrs.start`; a present `start` is `2` or greater;
- a table cell/header with unit span omits `rowspan`/`colspan`; a present span is `2` or greater.

The schema deliberately expresses only rules that JSON Schema can decide locally. Passing JSON Schema is necessary, never sufficient.

## Semantic validator requirements

The Rust profile validator is authoritative. A TypeScript validator must use the same schema and rules for early feedback but cannot weaken them.

### Profiles and ancestry

- A `prose` document forbids `verse`, `verse_line`, and `stanza_break` at any depth, including inside container blocks.
- A `poetry` root may interleave `verse` and common prose blocks. Common blocks never become children of `verse` and never split a `verse_line`.
- `verse` contains only `verse_line` and `stanza_break`. A normalized verse neither starts nor ends with `stanza_break`, and adjacent breaks merge by summing `blank_lines`.
- A `stanza_break` represents one or more deliberate blank source lines. An intentionally empty non-separator line is an empty `verse_line`.
- A spoiler cannot contain another spoiler at any descendant depth.
- A warning cannot recursively contain another warning, and a disclosure cannot recursively contain another disclosure, including through an intermediate container.
- A table cannot contain another table. Table cells contain one or more schema-supported prose blocks other than a table.
- A media caption contains one or more paragraphs when present. Media cannot appear inline or inside `verse`.

These profile and ancestor checks are semantic because a recursive JSON Schema cannot reliably express the root profile at every descendant without duplicating the full grammar.

### Marks

Marks are a set keyed by `type`; two marks of the same type are invalid even when their attributes differ. `uniqueItems` catches exact duplicate objects, while the semantic validator catches duplicate types.

Canonical mark precedence is:

```text
code, strong, emphasis, strike, subscript, superscript,
text_color, highlight, link, reference_link
```

Normalization sorts marks by this precedence. It never changes text or a mark target.

- `subscript` and `superscript` are mutually exclusive.
- `link` and `reference_link` are mutually exclusive on the same text leaf.
- `code` cannot combine with `strong`, `emphasis`, `strike`, `subscript`, `superscript`, `text_color`, or `highlight` in v1.
- `text_color` and `highlight` use only the tokens closed in the schema. `default` and `none` mean absence of the mark and are not canonical token values.
- Adjacent text leaves merge only when their normalized mark arrays are identical.

### URLs and identities

The schema regex is only an early shape filter. Semantic URL validation must parse the entire value and accept only:

- an absolute `http` or `https` URL with a non-empty host and no embedded credentials; or
- an origin-relative path beginning with exactly one `/`, with no control characters, backslashes, scheme-relative prefix, or dot-segment traversal.

Validation does not rewrite or guess a link target. Unsafe or invalid canonical links reject the document. Clipboard handling may instead preserve visible text as unlinked text only with the explicit diagnostic required by KWC-11.

`reference_link.reference_entity_id` and `media_image.media_asset_id` are lowercase canonical UUID strings with a valid RFC-style variant and version nibble `1` through `8`; they must resolve in the editing identity context before commit. Authored hrefs, storage paths, variant paths, preview URLs, MIME data, media labels, and processing state are forbidden on those canonical constructs.

Media accessibility is an exclusive choice:

- non-empty `alt` and no `decorative`; or
- `decorative = true` and no `alt`.

`align` is explicit (`none`, `center`, or `wide`) so a later renderer/editor default cannot change an old revision.

### Tables

The semantic validator expands `rowspan` and `colspan` into an effective grid and requires:

- at least one row and one cell;
- positive spans;
- a single rectangular effective width;
- no overlap, overflow, missing effective cells, or repair by deletion/reordering;
- cell/header identity and source order preserved.

Omitted `rowspan`/`colspan` means `1`. A normalized attribute object omits values equal to `1`.

### Resources and denial of service

The accepted domain maxima are:

| Limit name | Inclusive maximum | Unit |
| --- | ---: | --- |
| `document_bytes` | 2,097,152 | deterministic normalized KWDJ UTF-8 bytes |
| `tree_depth` | 32 | node levels, root block = 1 |
| `node_count` | 50,000 | block, inline, and text nodes |
| `text_length` | 262,144 | UTF-8 bytes per normalized text leaf |
| `table_rows` | 500 | rows per table |
| `table_effective_columns` | 50 | span-expanded effective columns per table |
| `attribute_length` | 8,192 | UTF-8 bytes per authored string attribute |

Counting excludes envelope/attrs/marks/scalars from node count; root blocks are depth 1.
Text limits count normalized merged UTF-8 leaf bytes. Authored string attributes
exclude text, fixed tokens/enums and system-resolved URLs. These preserve the
accepted CMS operational policy; the profile implementation remains authoritative. Transport, HTTP, upload, and clipboard-source limits are separate and cannot weaken these domain limits. An over-limit operation returns `kwdj.resource_limit_exceeded` atomically: no canonical value, revision, projection, or manifest is partially created.

DOC-026 contains fourteen named executable cases. Each positive case generates both `limit - 1` and the exact inclusive limit; each negative case generates `limit + 1`. Every generator keeps all non-target limits and KWDJ validity rules satisfied so the measured decision is attributable to the declared limit.

## Normalization and deterministic equality

Normalization is pure, deterministic, idempotent, and semantics-preserving. In order, it:

1. converts CRLF to LF only where KWC-11 permits literal line normalization;
2. lowercases UUID and enum tokens;
3. removes empty text leaves while preserving required empty paragraphs and verse lines;
4. normalizes and sorts marks by the fixed precedence, rejecting incompatible or duplicate types;
5. merges adjacent text leaves with identical normalized marks;
6. merges adjacent `stanza_break` nodes by summing positive `blank_lines`;
7. omits empty optional `marks` and `attrs` members; a normalized `marks` array is non-empty;
8. omits canonical defaults: ordered-list `start = 1`, cell/header `rowspan = 1`, and cell/header `colspan = 1`; present normalized values begin at `2`;
9. keeps authored characters, Unicode form, whitespace, labels, captions, link targets, list order, block order, and table cells unchanged.

An absent paragraph/heading alignment means natural document alignment and emits no alignment class. `first_line_indent` is present only as `true`. Media alignment and stanza blank-line count have no omitted default.

Normalized semantic equality compares parsed values after normalization. For deterministic byte tests, consumers serialize normalized JSON as UTF-8 with:

- object keys sorted by Unicode code point;
- arrays kept in semantic order;
- no insignificant whitespace;
- JSON escaping only as required by JSON syntax;
- integers in base-10 without leading zeroes.

The checked-in fixtures are pretty-printed for review and are not themselves the canonical byte encoding.

Required invariants:

```text
normalize(normalize(x)) == normalize(x)
validate(normalize(x)) == success
decode(encode(normalize(x))) == normalize(x)
```

## Derived projections

Public HTML, full text, search-index text, public-snippet text, media manifests, and reference manifests are derived from validated normalized KWDJ.

- HTML snapshots are exact strings for their cases. Text and attributes are contextually escaped, URL/media/reference destinations are resolved, and authored HTML is never interpreted.
- Full text follows KWC-11 section 10: block boundaries become lines, table cells use tabs, table rows use lines, poetry retains stanza spacing, and marks do not add characters.
- `full_text` and `search_index_text` include an authored spoiler label and its body.
- `public_snippet_text` includes the authored spoiler label but recursively excludes the spoiler body. Ordinary disclosure content remains visible.
- For documents without spoilers, `search_index_text` and `public_snippet_text` normally coincide; both remain separately named derived outputs and never mutate KWDJ.
- Manifests are sorted by JSON Pointer locator and then identity. Locators point into normalized KWDJ, never into editor state or source Markdown.
- A missing identity rejects the operation; it does not produce a partial manifest.

Exact HTML element/class decisions in these fixtures form the proposed renderer snapshot contract for review. They do not add a runtime renderer.

## Fixture conventions

Every DOC-ID appears exactly once in `manifest.json` and exactly once as a top-level fixture across the four fixture files. The package contains 34 fixtures and 59 named cases. A fixture may contain multiple named cases when its KWC-11 requirement has positive/negative branches or normalization input/output pairs.

Each case contains:

- `input`: typed source (`kwdj`, legacy Markdown, clipboard, retained revisions, or an executable resource-boundary generator);
- `kwdj`: the candidate/expected inline document, or `null` when conversion is unresolved/blocked or the complete document is generated from a resource-boundary vector;
- optional `edit`: the localized edit future adapter tests must apply;
- `expected`: outcome, stable diagnostic codes, normalized value/reference, projections, exact manifests, and notes;
- `pipeline_stages`: the exact consumers required to run the case.

`"$case.kwdj"` is a fixture-local reference, not a KWDJ value. In `input.value_ref` it supplies the case’s `kwdj` as input. In `expected.normalized_kwdj` it asserts exact parsed equality with that value.

Diagnostics are stable machine codes. Implementations may add localized messages outside the fixture comparison, but must not include authored body text, secrets, storage paths, or internal exception details.

A DOC-026 resource input declares its accepted constant, unit, deterministic generator, target, template, and measured `boundary_points`. A positive case contains `just_below` and `at_limit`; a negative case contains `over_limit` and the `atomic_failure` assertion. The fourteen named cases therefore execute twenty-one exact measurements without adding DOC-IDs or embedding multi-megabyte generated values in Git.

Resource generators have closed semantics:

- `pad_utf8_document` fills a normalized prose document to the exact deterministic serialized byte target, splitting authored padding across separate valid paragraphs/text leaves so every other limit remains satisfied;
- `nest_blockquotes` wraps the target block until the deepest KWDJ node equals the declared node-level measurement;
- `fill_node_count` fills root content with valid minimal block/text structures and, where needed, a single-node block so odd and even exact counts are both reachable;
- `extend_text_leaf` sets one text leaf to the exact UTF-8 byte measurement without splitting or truncation;
- `repeat_table_row` creates the exact number of structurally valid rows in one rectangular table;
- `repeat_table_cell` creates one rectangular row at the exact effective width using unit-span cells;
- `extend_attribute` sets the targeted authored string attribute to the exact UTF-8 byte measurement.

Generated documents are normalized KWDJ candidates and must pass `kwdj.schema.json` plus all non-target semantic/resource rules. Generator output is deterministic; consumers must confirm the measured result equals the declared boundary point before applying the expected outcome.

## Deferred fixtures and known gaps

One gap is explicit in `manifest.json`:

1. **DOC-024:** KWDJ v1 is the first schema. The fixture records the ten-revision/mixed-version obligation but uses clearly non-normative v2 placeholders. It becomes executable only when a real v2 schema and pure v1-to-v2 upconverter exist. A restore must create a new current-version revision, preserve old bytes, and obey KWC-39 pointer-safe pruning without ever committing eleven retained revisions.

This gap does not block KWDJ v1 validation/projection acceptance. It prevents only a claim that real cross-version upconversion is executable before a later schema exists.

## Rust and TypeScript consumer contract

Consumers load the pinned artifact, verify `corpus-package.json`, then load `manifest.json`, verify each `file` and JSON Pointer, validate each fixture file against `fixture.schema.json`, and then dispatch cases by `pipeline_stages`.

Both languages must:

1. validate `kwdj.schema.json` as a valid JSON Schema 2020-12 schema;
2. decode only known envelope/node/mark/attribute shapes, rejecting unknown data before normalization;
3. apply the permitted lexical/default normalization, then validate the normalized value against `kwdj.schema.json`;
4. run the shared semantic and identity rules above;
5. compare normalized parsed values and deterministic bytes;
6. compare stable diagnostic codes rather than localized messages;
7. resolve fixture-local `$case.kwdj` references before assertions;
8. materialize DOC-026 generators at every declared boundary point and verify the measured unit before asserting acceptance/rejection;
9. reject unknown fixture/schema versions rather than skip them silently;
10. report genuinely deferred cases distinctly from pass/fail.

No Rust crate API, TypeScript module API, package manager, code generator, or third-party validator is selected by this package. Adding one is an implementation/dependency decision for a separate card.

## Review acceptance

This accepted package remains valid when all of the following hold:

- every JSON file parses and every schema passes its draft metaschema check;
- both schemas compile with AJV 8 Draft 2020-12 using `strict: true` and `strictTypes: true`, with no warning or error;
- fixture files validate against `fixture.schema.json`;
- every non-null accepted `kwdj`/resolved normalized document validates structurally;
- every rejected structural fixture fails `kwdj.schema.json` where the diagnostic is structural;
- DOC-001 through DOC-034 exist exactly once with no duplicate or orphan;
- every manifest file/pointer resolves to the declared ID and classification;
- DOC-027 has the exact media manifest entry at `/content/1`;
- DOC-028 distinguishes single newlines, paragraph-boundary blank lines, and repeated blank lines;
- DOC-017 includes spoiler body in `full_text`/`search_index_text` and excludes it from `public_snippet_text` while retaining the label;
- DOC-026 contains fourteen executable cases covering all seven exact inclusive maxima at `limit - 1`, `limit`, and `limit + 1`; every over-limit case asserts typed atomic failure;
- JSON/Markdown files have final LF, no CR, tabs, or trailing whitespace;
- deterministic serialization and generated measurements are stable across repeated runs.

## Changelog

### 2026-07-20 — Accepted operational policy

- Fixed the seven inclusive domain resource maxima and linked their normative counting rules from `docs/contracts/kwdj_operational_policy_v1.md`.
- Materialized DOC-026 as fourteen executable cases containing twenty-one exact boundary measurements; over-limit cases require `kwdj.resource_limit_exceeded` and no partial artifacts.
- Replaced ambiguous `public_search_text` with distinct `search_index_text` and `public_snippet_text` projections across the fixture schema and corpus.
- Resolved DOC-017: the search index includes spoiler body, while the public snippet retains only the spoiler label and continues to include ordinary disclosure content.
- Removed the resolved resource-limit and spoiler-policy entries from known gaps; DOC-024 remains the only deferred contract gap.

### 2026-07-20 — Product Owner strict-schema review

- Added explicit array/object types required by AJV `strictTypes` in profile and media accessibility branches; made the fixture `value`/`value_ref` and media accessibility `oneOf` branches self-contained for `strictRequired`.
- Made the structural schema match normalized KWDJ: empty marks and explicit unit list/span defaults are rejected from canonical values.
- Added paired pre-normalized-to-normalized and structural-negative cases for empty marks, ordered-list `start = 1`, and unit table spans.
- Restricted lowercase canonical UUIDs to valid variant nibbles and version nibbles v1–v8.
- Expanded DOC-026 from one boundary pair to seven symbolic just-below/over-limit pairs and updated the package case count to 59.
