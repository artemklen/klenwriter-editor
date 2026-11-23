# OSR-35 — baseline command/state disposition

Authority: [OSR-60 source inventory](m0/cms-inventory.md), pinned CMS source
`a7f8a081b7827dd31097ad6c9104654366ae6e04`, architecture v2/master plan v3 and the
accepted OSR-35 execution contract. Historical rows are source observations, not
fresh mounted measurements. The table assigns every baseline command/state an
implementation, precise refusal or later owner; source preservation and newly
implemented authoring remain distinct.

| Baseline command/state | Headless OSR-35 disposition | Remaining acceptance owner |
| --- | --- | --- |
| Paragraph, H2/H3; preserve H1–H6/layout | Typed Paragraph/Heading transform; explicit valid heading level, compatible align/indent/inline payload retained | Toolbar/keyboard42/43, mounted45 |
| Strong/emphasis and pressed state | Uniform range toggle, collapsed future typing, On/Off/Mixed presentation | DOM shortcuts/input41, bubble42/43 |
| Strike/code/sub/super/text color/highlight preservation | Closed KWDJ mark validation and generic ToggleMark payload; incompatible code/mark combinations refuse whole action | Optional controls42/43; historical Angular exposed only strong/emphasis |
| Ordinary link set/unset, safe URL/title, reference protection | Typed SetLink/UnsetLink, authoritative validators and protected reference refusal | Stable dialog capture/focus/Mod-k68; reference picker68 is new capability |
| Paragraph Enter selected/start/middle/end/empty | Atomic split with layout/marks and exact resulting caret | Native browser routing41/45 |
| Heading Enter start/middle/end/empty | Empty paragraph before, split heading, terminal paragraph, or empty-heading conversion | Native browser routing41/45 |
| Code Enter/Shift+Enter | Literal LF, language preserved | Native browser routing41/45 |
| Other Shift+Enter | Bare hard_break, selected range replacement and styled suffix preserved | Native browser routing41/45 |
| Flat bullet/ordered Enter split/empty exit | Preserve items/tails/start; checked trailing numbering; overflow stable refusal | Native browser routing41/45 |
| Nested/task round-trip | Schema/payload preservation inherited; actual split/lift/unchecked new task authoring implemented and labelled NEW relative to Angular60 | Indentation/UI42/43/44; no invented historical controls |
| Quote wrap/unwrap; bullet/ordered toggle | Lossless typed recipes; mixed incompatible selected contexts refused as a whole | Block menu42/43 |
| Scene break, code block insertion | Typed InsertBlock/TransformBlock where lossless and admitted | Slash/block chrome42/43 |
| Slash paragraph/H2/H3/quote/bullet/ordered/scene/code | Exact frozen9-candidate catalog (includes new task candidate); atomic literal-query cut/insertion, prefix/suffix/layout/caret | Search/anchors/Russian labels/keyboard/Escape/focus42/43 |
| Slash image/gallery/table/callout/verse | No false success: future media/table/poetry targets refuse; host/callout providers not registered in35 | Containers50, poetry51, tables52, host media68, descriptors64 |
| Root move/duplicate/delete, keyboard reorder | Explicit structural target/destination, pre-op index; move IDs retained, duplicate fresh; remove legal fallback | DnD/keyboard/chrome44 and42/43; native drop ownership41 |
| Markdown prefixes and typography | No implicit text rewriting in command engine | Typography48, clipboard47, input41, legacy72 |
| Verse Enter/stanza/terminal exit/Shift+Enter | Existing payload preserved; specialized verse authoring is unavailable, never flattened | Poetry51, stage parity45 |
| Table cell spans/rectangularity and text | Existing admitted table payload/attrs preserved; basic prose commands inside valid cells use profile grammar | Structural table authoring52, stage parity45 |
| Literary/warning/spoiler/disclosure attrs/containers | Existing payload remains admitted; basic compatible prose editing retained, no guessed property conversion | Domain algorithms50/property UI68 |
| Media UUID/alt/decorative/caption/align | Existing admitted payload preserved; no delivery URL authority or insertion dialog guessed | Host adapters68 |
| Undo/redo/grouping | Journal now retains actual before/after selection and typing state; no user undo success claim | History36 |
| Selection-only capability refresh vs dirty | Exact query pure; state-only typing/selection epoch separate from document revision/dirty/history | Events/save37, host69 |
| Mount identity, reading/disabled/reference lock | Guards and read-only mutation refusal; no UI lock or retained instance claim | SDK63, bindings65/49, CMS69/70 |
| Export failures, dirty/unexported, undo-to-baseline, recovery | Ordinary commands do not serialize whole snapshots; atomic refusal retains committed state | Save/events37, CMS69 and legacy72 |
| Clipboard native/plain/rich/cross-block behavior | Command typing is not a clipboard adapter | Clipboard47 and mounted45 |
| Focus/cancel/stale dialogs, auth/upload uncertainty | Captured tokens and whole refusal are headless foundations | Host68, bindings49/69/70 |
| Keyboard/focus/labels/semantic roles/axe | No mounted claim from a headless observer | Input/chrome41–43, host QA45/70; real screen reader deferred per M0 |
| Angular9 routes + legacy5 forms + Tiptap deletion | No CMS runtime changed in35 |49/69/70 +72; deletion53 after full closure |

Exact refusal reasons are typed/profile-owned: missing selection, invalid target,
unsupported context, lossy transform, protected reference, ordered overflow, slash
literal mismatch, future provider, invalid mark/URL/identity, stale tokens,
read-only and resource/journal/counter limits. `query_command` executes the same
full preparation as execution; a row's UI owner is not replaced by a static hint.
New public providers/descriptors must preserve this architecture in OSR-64.

## Media block parity

| Surface | Available behavior |
| --- | --- |
| Native and WASM SDK | Move, remove, whole-block KWDJ clipboard, Undo/Redo, and export/reopen preserve the media identity, alignment, accessibility attributes, and caption. |
| Mounted KWDJ DOM | An offline placeholder has the authored accessible name for meaningful media. The caption remains editable. Keyboard deletion of a selected whole block and Undo preserve its attributes. |
| Create media block | Unavailable in the library. Media selection and upload belong to a host picker. |

## Literary block parity

Native and WASM preserve canonical bytes. The DOM renderer exposes a named
container and its authored children.

| Kind | Read and render | Authoring parity |
| --- | --- | --- |
| `author_note` | Supported | CMS slash callout and SDK2 creation. |
| `letter` | Supported | Preserve and read. |
| `epigraph` | Supported | Preserve and read. |
| `world_note` | Supported | Preserve and read. |
| `chronicle_quote` | Supported | Preserve and read. |
| `archive_fragment` | Supported | Preserve and read. |

SDK2 `insert_block` takes the literary target `literary_block` with
`literary_kind` set to `author_note`. The new container begins with an empty
paragraph. `set_literary_kind` takes the existing literary node ID and changes
its kind to `author_note`, preserving the container and its children.
SDK2 `wrap_literary_block` wraps selected contiguous siblings in an
`author_note`. `unwrap_literary_block` takes an `author_note` node ID and moves
its children into the parent in the same order.

## Warning block parity

Both `general` and `content` are readable and render with their authored label
or a name for the kind. Legacy CMS insertion supports both kinds. SDK2
`insert_block` takes the `warning` target and a `warning_kind`. The new block
has one empty paragraph and starts with the label omitted. `set_warning_kind`
changes the kind of an existing warning and preserves any label and children.

SDK2 `wrap_warning` takes a `warning_kind` and wraps selected contiguous
siblings in that kind of warning. `unwrap_warning` takes the warning node ID and
moves its children into its parent in their original order. Undo restores the
warning, its original attributes, and its children.

## Spoiler and disclosure parity

SDK2 `set_container_label` takes an existing `spoiler` or `disclosure` node ID
and the new `label`. The command preserves child IDs and content. An empty
label is refused by the document grammar. Undo restores the previous label
and exact canonical bytes.

SDK2 `insert_block` creates either kind with its default label and an empty
paragraph. `wrap_labeled_container` takes a `container_kind` and an explicit
label, and wraps contiguous siblings in that container. `unwrap_labeled_container`
takes a container ID and keeps the child order and identities. KWDJ clipboard
fragments preserve the label and body. The grammar refuses nesting either kind
inside another of the same kind.

SDK2 accepts `{ kind: 'delete_selection', scope: 'profile_body' }` for text
selected inside one text block in a literary, warning, spoiler, or disclosure
container. KWDJ mounted input uses this scope. Deletion preserves the enclosing
container and its attributes. Selections crossing container boundaries return
a typed refusal. The unscoped command retains its existing selection contract.

## Poetry admission and line editing

The poetry profile admits `verse`, `verse_line`, and `stanza_break`. A
verse line can carry an integer `attrs.indent` from 1 through 8. Import
normalization omits an integer zero indent. Leading spaces in authored text
and the `blank_lines` value on stanza breaks survive export and reopening.
The prose profile refuses these node types at admission and paste.

Enter splits a nonempty verse line at the caret. A split at the start or
middle keeps the indent on both lines. At the end, the new empty line uses
the default indent. Shift+Enter inserts a hard break within the same line.

Enter on the first empty line inserts another empty line. An empty line after
a verse line becomes a stanza break and moves the caret to the following line,
creating one when needed. An empty line after a stanza break is a no-op when
another child follows. At the end of the verse, Enter removes that break and
empty line and opens a new paragraph after the verse in the same parent.
