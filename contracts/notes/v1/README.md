# Independent notes JSON v1 literals

These MIT OR Apache-2.0 synthetic literals are authored for OSR-64 before the
notes codec implementation. They contain no CMS/KWDJ fixtures or user data.
The accepted execution contract is `evidence/osr-64/execution-contract.md`, SHA256
`65a842098cb267e2eccb2ba702b9295d6c650d8f05e2521e4d926815f0eda04b`.
This directory freezes codec inputs, semantic values, canonical bytes and
diagnostic paths. It is not evidence that any implementation passed them.

## Identity and selected registries

Profile `org.example.notes@1.0.0`, codec `org.example.notes/json`, wire version
`1`. Registry **D0** selects `org.example.notes/base@1.0.0`; **D1** additionally
selects `org.example.notes/callout@1.0.0` and
`org.example.notes/highlight@1.0.0`. Owners are explicit mappings: the base
extension owns document/paragraph/text/hard_break; the other extensions own
callout and highlight respectively. No ownership is inferred from an ID prefix.
These names describe the two fixture registries, not a codec hardcoded allowlist:
other exact types may be admitted only through their selected frozen registry.

Every node ID below has the prefix `org.example.notes/`. The root must be exactly
`document`. `document` is a BlockContainer, `paragraph` a TextBlock, `text` a Text,
`hard_break` a HardBreak, and D1 `callout` a BlockContainer. The D1 `highlight`
mark is allowed only on text, at most once per text leaf.
The composer explicitly supplies D0's paragraph-only block policy and empty text
mark policy, or D1's paragraph/callout block policy and highlight text mark policy.
These are selected composer policies, not extension overrides of base-owned
declarations or inferred cross-extension dependency edges.

Primary Codex accepted the following concrete notes grammar before codec
implementation: document/callout children are
`Repeat(Choice(paragraph, selected callout),0,65535)`; paragraph children are
`Repeat(Choice(text,hard_break),0,65535)`; leaves have `Empty` child grammar.
Type references are child labels; recursive callout content does not recursively
expand the compiler grammar. Actual document depth/node/work limits additionally
apply. Empty document, paragraph, callout and standalone empty text are valid.
The counts and callout-title bound are accepted delegated technical choices;
they do not change KWDJ limits.

## Closed wire and authored metadata

The envelope has exactly two required fields:
`{"schema_version":1,"root":Node}`. Every node has exactly five required fields:
`{type:string,attrs:object,marks:Mark[],text:string|null,children:Node[]}`.
Every mark has exactly two required fields: `{type:string,attrs:object}`.
There are no omitted defaults, session/opaque node IDs or authored `primitive`.
Non-text nodes require `text:null`; text requires a string and no children.
Non-text nodes have no marks. Hard breaks are childless. Known types in an
invalid parent context refuse rather than flattening or reparenting.

| Type | Exact attrs |
| --- | --- |
| document | Required `title`: string, at most 256 UTF-8 bytes. Required `tags`: list of at most 16 strings, each at most 64 UTF-8 bytes. |
| paragraph, text, hard_break | Empty closed object. |
| callout | Required `kind`: exactly `info` or `warning`. Required `title`: null or string of at most 256 UTF-8 bytes. |
| highlight mark | Required `color`: exactly `sun` or `mint`. |

Empty titles/tags are allowed, duplicate tags and tag order are preserved.
Attribute keys/enum values are case-sensitive. No trim, Unicode normalization,
line-ending normalization, tag sorting or empty-text removal occurs. String
limits count UTF-8 bytes, not scalars, graphemes or UTF-16 code units. No generic
JSON metadata escape is admitted by these fixture schemas. In particular,
unknown numeric attrs are refused, not made valid by canonical-v1 support.

The envelope version must have the exact integer representation `1`; floating
`1.0`, strings, unknown integers and missing/null values are distinct refusals.
Number parsing/canonical output otherwise retain ADR-004; this codec introduces
no float conversion or alternative canonical-number serializer. Duplicate JSON
keys at every depth refuse before owned decoding, including equal decoded keys
written with different JSON escapes. This is an explicit notes codec rule;
ADR-004's existing generic parser last-value-wins behavior is unchanged.

## Strict, import and editing normality

Both modes validate the complete closed shape, selected types, attrs, marks,
primitive shape and child grammar before applying normalization. Unknown data
cannot disappear by normalization. Strict admission refuses adjacent text leaves
with equal exact type, attrs and ordered marks. Import performs only their
lossless concatenation, repeatedly until a fixed point. It preserves SPACE,
NBSP, CRLF, decomposition, supplementary scalars and all metadata/mark payloads.
An intervening hard break or unequal mark payload is a barrier. Empty text is
never independently removed; an empty leaf may participate in the same exact
adjacent join. No other import repair or schema migration is defined.

Editing normalization must propose the corresponding explicit `JoinText`
operations through the ordinary bounded engine path. Maps/history/counters and
one publication include those operations; this directory does not replace their
later independent command/history/identity witnesses with import evidence.

## Cases and independent oracle

`vectors.json` references raw files under `inputs/`. Accepted cases reference an
independently authored compact UTF-8 JSON file under `expected/`: its exact bytes
(no BOM or final LF) are the expected canonical export, and its parsed value is
the complete expected semantic document, including every attr/mark/child. These
files are literals, never captured from the notes codec, normalizer or registry.
Their stable key order is scalar lexical order under canonical-v1: envelope
`root,schema_version`; node `attrs,children,marks,text,type`; mark `attrs,type`.
Input whitespace and key order are deliberately unrelated to that output.

Refusal expectations use JSON Pointer paths. The raw duplicate-key scanner
reports the decoded repeated key path; syntax/encoding failures use the empty
root pointer. Required fields use their missing field's pointer. Each case has
one deliberate failure unless its description explicitly checks validation
before normalization. Multi-invalid diagnostic precedence beyond those literals
is not guessed by this corpus.

| Code | Meaning |
| --- | --- |
| `notes.invalid_json` | Invalid JSON/UTF-8/scalar encoding. |
| `notes.duplicate_key` | A repeated decoded object key. |
| `notes.unknown_field` | Extra envelope/node/mark wire field. |
| `notes.missing_field` | Required envelope/node/mark field absent. |
| `notes.invalid_structure` | Wrong wire value kind, primitive shape, root type or mark placement. |
| `notes.unsupported_version` | An integer schema version other than 1. |
| `notes.unknown_node` | Node type absent from the selected frozen registry. |
| `notes.unknown_mark` | Mark type absent from the selected frozen registry. |
| `notes.invalid_child` | Known child type not permitted by its parent grammar. |
| `notes.invalid_attribute` | Unknown/missing/wrong-kind/out-of-bound authored attr. |
| `notes.duplicate_mark` | A second mark with the same exact type ID. |
| `notes.not_normal` | Strict mode's adjacent mergeable text pair; path points to the right leaf. |

Every refusal preserves the original input bytes with the caller; no fallback
paragraph, shortened document or allegedly supported save is returned. D0 and
D1 cases intentionally reuse the same raw extension document. Later no-rebuild
tests must use the same actual packaged WASM for both registries and preserve a
live D0 Session; these codec literals alone do not prove that distribution claim.

`manifest.json` records provenance and hashes of this authored packet. Static
authoring checks may validate JSON, file references, byte counts and hashes, but
must not generate expected exports by executing the production implementation.
