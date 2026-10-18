# Notes native commands — independent literal packet

This is a separate MIT OR Apache-2.0 synthetic oracle, authored before the
notes `CommandProvider` implementation. The original codec53 corpus and its
manifest remain unchanged. No native/WASM passing result is claimed here.

The three exact compiled commands are:

- `org.example.notes/command/insert-text`: closed payload `{text:string}`.
- `org.example.notes/command/set-title`: closed payload `{title:string}`.
- `org.example.notes/command/set-tags`: closed payload `{tags:string[]}`.

Metadata commands target the actual sole semantic document-root attrs through
ordinary operations. Query and execution run the same final schema validation.
They preserve the exact selection and stored marks; repeated identical values
are no-ops. Limits and closed attrs are the original notes registry authority.

InsertText replaces the current range in one inline parent using the closed
engine range primitive and original outer EGC validation. Text/Child/Edge,
reverse ranges and semantic-equivalent collapsed endpoints are supported.
Cross-parent ranges explicitly refuse `notes.command_unsupported_context` at
`/selection`; no selection refuses `notes.command_selection_required` there.
This is the small notes command capability, not a claim to the KWDJ command
surface. The inserted prototype is base `org.example.notes/text`; an unrelated
context whose schema excludes that type safely refuses through normal validation.

A nonempty inserted string inherits actual focus-leaf marks when stored marks
are None; explicit empty/nonempty override takes precedence. A child gap uses
its affinity side, falling back only at the block outer edge. Hard-break/atom
edges reset inheritance to plain. Final typing validation uses the actual final
selection/context and the shared registry mark validator, including attributes,
allowed marks, duplicates and exclusions. No second mark business validator.
Empty insertion over an equivalent collapsed range is an actual no-op; over a
nonempty range it deletes content. Result caret is after the inserted text or at
the deletion start and maps across explicit normalization joins. Existing
metadata and unselected text/mark payloads remain intact.

Each vector contains complete raw input bytes and complete expected canonical
bytes as JSON strings, independently authored from fixed literal node fragments,
not produced by the notes codec/engine. `storedMarks:null` means inherit, while
`[]` means explicit plain. Selection paths are relative to the semantic root;
opaque IDs are bound per run and tested by equality/survival/revival relations.
Expected counter deltas start after test setup selection/typing state; setup
events are drained separately. For generic core errors, path null means no
notes-profile pointer is asserted; the typed EGC error is additionally checked.

Native/compiled-WASM witnesses must compare every expected byte and caret,
query purity/actual work, one-publication counts, exact undo/redo and late-failure
atomicity. The descriptor recipe language and runtime command testkit have
their own independent fixture packet; these three compiled commands do not
pretend to implement a recipe interpreter.
