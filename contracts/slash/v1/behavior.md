# Trigger, filtering, keys and authority

Normative pre-candidate decisions. The original source-preparation reports are
preserved separately and are not themselves runtime evidence.

## Lexical presentation policy

The mounted ordinary-input observer may notify only after a genuine
InputOwner ordinary path (`ownedPermit=false`) has successfully completed a
fresh changed native mutation and all DOM correspondence checks. Composition
owner fallback (`ownedPermit=true`) never certifies ordinary input, including
`insertText`. Noncancelable pending input retains and propagates that provenance.
Queued/refused/fatal/unchanged/recovered/stale/reentrant submissions cannot open
or update a frame. Event trust is preserved as an observation, not promoted into
hardware evidence. Event data/key never supplies authoritative query text.

The private mounted input path captures a pure bounded native text-window
witness before dispatch when observers exist; it is not a host callback or a
DOM text read. The public observation carries that witness (or null on a read
refusal), before/after full stamps and directed selections, full context,
inputType, unchanged isTrusted and a data hint capped at256 UTF-16 units. Null
witness/hint cannot certify a new opening. Initial opening is deliberately
narrow: ordinary insertText with hint exactly `/`, fresh native before/after
windows proving that suffix insertion in the same block, and actual after
literal `/` at an eligible boundary. The hint alone never opens a menu. A
multi-character paste/replacement does not implicitly trigger a new picker.
Both windows retain explicit clipping/barriers; verify their aligned native
suffix and exact caret context, including empty native block to its actual
new text leaf. No full State/Node/command payload is exposed for this witness.

On the next finite UI frame, exact observed after-stamp and full session context
must still match the current editor. Read the native bounded window at the
collapsed native caret. Only declared text-block type IDs from the optional
profile are eligible. The text before the caret is scanned backward for its
last `/`; it starts a query only at block start or immediately after ASCII
space or tab. Every query character after `/` must be a Unicode scalar and
must not be ASCII space, tab, LF, CR, form-feed or vertical-tab. There is no
Unicode normalization, semantic tokenization or trimming of document text.
Midword `word/x`, URL `https://x`, atom/hard-break crossing, noncollapsed
selection, root gap, unknown context and incomplete left boundary do not open.
At most256 UTF-16 units including `/` are accepted. A clipped window is never
mistaken for block start; an otherwise unresolved boundary closes/refuses.

A fresh ordinary insertion may open only when its verified inserted suffix
introduces the slash at the eligible boundary. Once open, genuine ordinary
insert/delete query edits may refresh the same slash anchor. Escape, Tab or
refusal suppress that anchor until a new eligible slash is actually inserted;
typing more characters cannot reopen the dismissed query. Foreign selection,
history, marks, publication, mode, replacement, composition, recovery, fatal or
disposal closes the frame. An ambiguous origin is conservatively suppressed.

Catalog order is stable provider order, at most32 distinct nonempty IDs of at
most128 UTF-16 units. Labels are paired nonempty RU/EN strings <=256 units;
keywords are paired arrays of at most16 nonempty strings <=64 units. Eligible
text types are at most32 distinct IDs <=128 units. Plain closed data shapes,
no accessors, extra keys, sparse arrays or duplicate IDs. Optional profile
callbacks remain trusted host callbacks; exceptions/refusals remain explicit.

Filter presentation only: remove the single initial `/`, ASCII-case-fold
`A..Z`, Cyrillic `А..Я` and `Ё` using fixed code-point rules, then substring
match against candidate ID, current-locale label and keywords. Empty query
shows all candidates. No locale-dependent sorting, accent stripping or fuzzy
matching. Literal/range remain exact native bytes/UTF-16 coordinates. A known
unavailable candidate stays discoverable with localized reason and cannot be
accepted. No-results is a labelled non-option status. Search never proves
native availability: query every exact constructed command at the full stamp.

## Keyboard, presentation and lifecycle

One labelled listbox lives outside the single editing root. Slash focus stays
in the editor. There is exactly one active option when results exist; disabled
options remain navigable/discoverable. Up/Down wrap provider/filter order;
Home/End remain native editing keys. Enter accepts only an available active
option. A valid owned unmodified Up/Down/Enter/Escape is handled in capture
phase before mounted input and document selection listeners; prevent default
and stop propagation only for that admitted gesture. Shift/Alt/Ctrl/Meta keys
and native Find remain native. Repeated Enter is consumed without acceptance;
it cannot activate the same frame twice. Escape closes with zero dispatch.
Tab closes and follows actual page order; existing42 entry capture remains.
Composition-owned keys are never intercepted by slash.

The editor textbox exposes haspopup/controls/active-descendant through a mounted
presentation owner with genuine connected outside listbox/option references.
The shared Add button exposes expanded/controls for that same picker, including
when slash opened it. Preserve the editing root's textbox/multiline semantics;
do not apply aria-expanded to a textbox or temporarily change it to combobox.
It owns only those presentation attributes, restores originals on release and
never supplies selection/mutation authority. Filtering/navigation do not write
focus, selection, scroll, document nodes or native state. Optional geometry is
a fresh public read; use a finite viewport-clamped floating placement when
supported and the original accessible entry position otherwise. Do not infer
pixel goldens or scroll a document to move the menu. Scroll the active option
within the picker only. RU/EN, zoom200 and strict CSP apply.

A presentation frame is not a bookmark. For keyboard acceptance, claim the
frame before any host callback, capture a genuine42 host request against its
exact full stamp/context/caret, and complete once with focus:none while editor
focus is owned. Pointer-down captures before focus departure, binds pointer ID,
frame identity and request; click consumes that original gesture without
recapture. Use native_result only for the still-owned outside scope. Recheck
all tokens and exact literal after factory/query reentry. Original completed
or queued SDK Submission and eventual response are preserved. No restore-then-
submit, second pump, hidden retry or late/fatal/duplicate replay is permitted.

Add opens the same catalog/list presentation without a fabricated slash range.
Its pre-focus request and focus/cancel contract remain42's. Without optional
slash it keeps the old insertion list. Shared presentation does not erase these
different capture origins. Every listener, subscription, RAF, DOM node,
presentation handle, request and continuation has one disposal owner, finite
counts and exactly-once release. Missing focus restoration is reported apart
from semantic completion; it never authorizes command replay.
