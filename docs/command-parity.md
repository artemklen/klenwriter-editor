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
