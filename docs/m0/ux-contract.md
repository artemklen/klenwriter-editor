# OSR-62 — Desktop editor UX contract

Version: M0, 2026-10-17. This is a specification for implementation, not a claim that the editor UI exists. [Editable Figma](https://www.figma.com/design/4Mkb3kl1RU3wV5H1hNYH7S) and the [frame/evidence index](../../evidence/osr-62/README.md) are the visual counterpart. Architecture authority remains with the project architect; this contract follows the approved M0 architecture and [editing-host decision](editing-host-decision.md).

## Product boundary and rationale

The editor presents one continuous document with a single editing root. Toolbar, slash picker, gutter, move controls and host dialogs sit outside that root. Blocks remain model objects; a block boundary is not a separate text field. This preserves native document selection while allowing Rust to validate every committed transaction. UI previews never become committed content before acceptance.

Chrome and Safari desktop with RU/EN are the v1 release contract. Firefox is experimental. Unicode storage is general. CJK input guarantees, mobile, collaboration and real screen-reader acceptance are deferred. Keyboard-only operation, visible focus, meaningful labels, machine-checkable semantics and contrast are required. The annotated roles below express implementation intent; Figma is neither a DOM accessibility test nor assistive-technology evidence.

The default shell is neutral OSS UI. A host may theme spacing, colours and fonts and provide RU/EN strings, but may not hide refusals, focus indicators or recovery actions. The CMS owns save/publication, authentication, asset selection/upload and product dialog content and lifecycle. The library may supply an optional reusable accessible shell for its own simple UI, but core/SDK do not depend on that shell and CMS product dialogs remain host-owned. There is no editor-owned save button or false “saved” status. The editor reports dirty/change/error states for the host to interpret.

## Visual and interaction foundations

The design uses a light neutral document, restrained green emphasis, blue focus/selection and separate amber/red feedback. Selection, focus and validation are different visuals. Text contrast target is at least 4.5:1, large text 3:1; meaningful boundaries/focus 3:1. Interactive targets are at least 32×32 CSS pixels with spacing. Desktop chrome wraps before overlapping the document; the content scroll area keeps the selection endpoint visible. Reduced motion removes animated movement without hiding the insertion destination.

CSS defaults use the system UI font; the Mac desktop design renders this as SF Pro. Document typography is a theme token, independent from chrome. The Figma component library is design-time scaffolding, not a runtime dependency or mandatory font package. Host themes require the same contrast/focus/overflow checks as defaults.

## Persistent modes and transient states

| State | User sees / can do | Focus and semantics | Exit / refusal rule |
| --- | --- | --- | --- |
| Ready | Editable document, applicable toolbar actions, gutter on active/hover block | Labelled multiline editing surface; one text editing focus; toolbar has a name | Accepted command updates view and selection once |
| Empty | “Начните писать или введите /” / “Start writing or type /” | Placeholder is not document text and not the accessible name; caret can enter the first valid paragraph | First input removes placeholder; slash opens contextual insertion |
| Loading | “Открываем документ…” / “Opening document…”; no editable fake content | Busy labelled region, deterministic height; skeleton is decorative, focus stays with opener | Ready only after validation and first render; failure uses load-error state |
| Read-only | “Только чтение” / “Read-only”; text remains selectable, copy and native Find work | Read-only labelled surface; mutation controls unavailable with reason | Host may restore editing; no implicit reinitialization or lost selection |
| Disabled | “Редактор временно недоступен” / “Editor temporarily unavailable” | Editor commands and editing focus disabled; no trapped focus; host recovery/controls remain reachable; no promise to suppress browser Find or selection of static text | Host explicitly re-enables; retain content internally; do not confuse this with read-only |
| Command refusal | Inline reason near command plus persistent status text; document unchanged | No forced focus jump; current selection retained | Dismiss or choose a valid action; no retry loop |
| Recoverable load failure | “Не удалось открыть редактор” / “Could not open the editor”; retry and original download if available | Error heading, explicit actions; no empty document presented as successful load | Retry preserves original payload; download never claims an edited snapshot exists if initialization failed |
| Fatal runtime failure | “Редактирование остановлено. Сохраните копию перед повторным запуском.” / “Editing stopped. Save a copy before restarting.” | Mutation stops; recovery actions outside failed editing root remain usable | Preserve last committed snapshot and separately any recoverable input; restart is explicit and cannot silently overwrite them |
| Composition active | Normal native text input continues; conflicting format/move/open-dialog actions are temporarily unavailable | Do not disable the editing surface or steal focus | Finalize/reconcile native input before a new explicit command; do not replay a stale command invisibly |
| Dialog pending | Host dialog over editor, original target range visually retained where practical | Modal host focus scope, named dialog, keyboard cancellation | Cancel restores valid bookmark; accept validates request/session/generation/revision; stale response is refused |

“Disabled” blocks editor commands and editing focus. It does not promise to suppress browser Find or browser selection of rendered static text; consumers wanting supported selection/copy interaction should use read-only. Pending composition is a transient command lock, not disabled mode. A mode switch during unresolved composition must follow the architecture's preserve/refuse policy; it cannot discard browser-owned provisional text.

## Continuous selection and toolbar (frame 01)

Collapsed text selection changes future typing marks only when allowed by the profile; range selection applies a single command to the mapped model range. Cross-block selection includes text and atomic nodes according to the selection contract. The selected block outline is not a text selection and does not convert selected text into a block move implicitly.

The toolbar is a labelled `toolbar` outside contenteditable. Arrow Left/Right moves among enabled/discoverable controls, Home/End reaches first/last; Tab exits. Toggle controls expose `aria-pressed=true|false|mixed`; unavailable profile controls expose a reason. A visible toolbar entry path is always reachable using Tab/Shift+Tab. Escape from a toolbar popup closes only that popup and restores the bookmarked document selection when valid. A toolbar action must not operate on a new selection that appeared while focus was away.

Pointer-down may preserve the current model selection, but keyboard users follow the same bookmark contract. After formatting, restore focus to the document range; after opening a popup, focus enters the popup. If the bookmark is invalid, refuse and say “Выделение изменилось. Выберите текст снова.” / “The selection changed. Select the text again.” Never guess a nearby range for a destructive operation.

## Insertion and slash (frame 02)

A slash at an eligible text insertion point opens a filtered command picker only when not composing. Slash and query characters are ordinary committed document text, included in snapshots and recovery. Successful insertion atomically replaces the captured slash/query range; Escape or refusal closes the picker and retains that text. The picker shows only known profile commands; unavailable commands may be visible disabled with their reason, never as successful options. A no-results message includes “Ничего не найдено” / “No results”.

Use a labelled listbox with options and one active option. Keep text input focus in the editor while keyboard Up/Down changes the active option; Enter accepts it, Escape dismisses, Tab dismisses and follows normal page focus order. The trigger has expanded/controls/active-descendant semantics appropriate to the implemented popup. It must not add a second editable field inside the document. Clicking a picker item follows the same insertion transaction as Enter. Only accepted insertion removes the slash query; refusal leaves text intact.

An always reachable “Добавить блок” / “Add block” button opens the same picker without typing slash. This provides discovery and keyboard access without a reserved global shortcut. The position is captured before focus moves. The picker never captures Cmd/Ctrl+F or native application shortcuts.

## Move, drag and nesting (frames 03–04)

Block move always has keyboard equivalents. “Переместить блок” / “Move block” opens explicit “Выше / Move up”, “Ниже / Move down”, “Внутрь / Nest”, “Наружу / Unnest” controls, enabled only for valid destinations. The menu carries the block name/type and current position. After success, keep that block selected and focus its move control or restore its text bookmark according to the initiating action. Position feedback appears visibly, e.g. “Блок перемещён на позицию 3.” / “Block moved to position 3.”

DnD uses a dedicated labelled drag handle, a preview and an insertion line with destination text. Pointer movement does not mutate the model. At viewport edges the adapter scrolls explicitly while maintaining a valid visible destination and endpoint; release performs one validated move. Escape, pointercancel, lost capture or invalid drop cancels the preview and leaves the original order unchanged. The handle is not the only way to move.

Moving into a descendant, exceeding profile depth, placing the wrong child type or moving outside the editor is refused. Show the reason next to the destination, not colour alone. Nesting has an explicit container boundary and breadcrumb such as “Документ / Цитата” / “Document / Quote”. “Наружу” moves to the valid parent context; it must not flatten content silently. Multi-block move requires a profile-defined contiguous structural selection; a text range spanning blocks is insufficient.

## Table and poetry behaviour (frame 04)

These are planned profile capabilities with explicit unavailable states until implemented. A “Table not available in this profile” reason is distinct from a disabled row/column action at a particular edge. The design must not imply these features have shipped.

A table remains within the one editing root. Semantic `table`, row, column/cell headings and selected-cell state are preserved. The implementation task must distinguish text selection inside a cell from structural cell/row selection. Tab/Shift+Tab move between cells when table navigation is active; at the last/first cell, leave the table rather than silently adding data. The forward exit targets the next text block start, the backward exit the previous text block end; if the adjacent block is atomic, target its block-actions control. If there is no adjacent block, target the editor’s Add block control with the before/after table insertion boundary bookmarked. Add row/column is explicit and validated. Escape exits cell/structural selection to its table control, then document focus. Merge/split controls are absent unless the profile promises them. A selected row delete command previews its scope and supports model undo.

Poetry preserves the current KWDJ grammar: a `verse` contains `verse_line` and `stanza_break`; each verse line contains text and optional `hard_break`. Enter at the end of a non-empty line adds another verse line, not a new verse container. Enter on an empty line after a verse line replaces the empty line with a stanza break and continues on the following verse line, creating a fresh line only when needed; Enter on the final empty line following a stanza break exits to a paragraph when the parent permits it and the verse remains non-empty. An empty middle line following a stanza break keeps the caret rather than silently restructuring the remainder. Shift+Enter inserts a hard break within the current verse line. The explicit “Новая строфа / New stanza” action is an additional accessible entry point to the same stanza command, not a replacement for existing Enter behaviour. Mid-line Enter is specified to split the current verse line, preserving both text fragments; this follows the current handler delegating non-empty lines to the base split command and still needs a mounted parity test. Consecutive stanza-break candidates are normalized by the current profile and leading/trailing stanza boundaries are removed by its editing normalization; the generic editor must not substitute a different rejection policy for this profile behaviour. A generic paragraph cannot silently become poetry based on line breaks, and focus loss never trims or reflows poetry.

This parity requirement follows CMS revision `a7f8a081b7827dd31097ad6c9104654366ae6e04`, `frontend/admin-spa/src/app/editor/verse-editing.ts:19–85` and `create-editable-kwdj-editor.ts:49–115`, read at the exact committed revision, cross-checked by the independent CMS contract audit and confirmed by the root architect. The production profile must cover these transitions in fixtures; the UX design does not prove their implementation.

## Host dialog and asynchronous completion (frame 07)

1. Capture document/session identity, generation, revision and selection bookmark before invoking the host request. The host owns content, data fetching and auth.
2. Set a named modal focus scope; focus the dialog title or first appropriate field, trap Tab only while genuinely modal, expose Cancel and Escape.
3. Cancel returns to the original valid document bookmark with no mutation. If invalid, focus the editor's stable entry control and explain that the selection changed; do not fabricate a caret target.
4. Accept returns a typed result, not arbitrary HTML. Validate request identity, session/generation, revision policy and profile capability. If the contract cannot safely map the original bookmark, refuse the stale result without changing the current document. Show “Документ изменился. Откройте окно заново.” / “The document changed. Open the dialog again.”
5. Repeated or late completion cannot apply twice. Replaced/destroyed editors ignore obsolete results and release host resources. Keep recoverable user text; the host may offer reopening, but no automatic overwrite occurs.

Figma shows an abstract “Параметры блока / Block options” dialog. It is a host integration boundary, not a library-owned CMS media/auth workflow.

## Keyboard-only acceptance scripts (frame 08)

| ID | Scenario | Required result and evidence |
| --- | --- | --- |
| UX-K01 | Tab from preceding host control into toolbar and document; Shift+Tab back | Visible focus, no trap, toolbar roving navigation and reachable entry; screenshot + activeElement/event trace |
| UX-K02 | Select text across paragraph/atom/nested boundary; format through keyboard toolbar | Same valid range restored, one accepted transaction, native text preserved; model/DOM selection read-back |
| UX-K03 | Type `/`, filter, choose with arrows/Enter; repeat with Escape and no results | Accepted command replaces query once; Escape/refusal retains text; active option labelled |
| UX-K04 | Move block by menu; attempt impossible nest; cancel pointer drag | Correct single move and focus after success; refusal/cancel leaves exact document unchanged |
| UX-K05 | Edit inside table, traverse edges, select row; repeat without table capability | Explicit exit and scopes; no implicit row creation; disabled reason visible |
| UX-K06 | Compose RU/EN/dead-key text, attempt format/move/dialog, finish and retry | Native input continues; conflicting command cannot destroy range or apply late; exactly-once core commit belongs to OSR-41 |
| UX-K07 | Open host dialog, cancel; open again and change/reload document before late accept | Valid cancel bookmark restored; stale response refused; current document remains exact |
| UX-K08 | Read-only then disabled; load and runtime errors | Read-only copy/Find allowed; disabled no editor commands or editing focus; host recovery reachable; no false saved state |
| UX-K09 | Switch locale/theme and zoom to 200% | RU/EN labels not clipped; focus/status preserved; toolbar wraps; text/selection endpoint not hidden |
| UX-K10 | Repeat native Find and held edge selection in Chrome/Safari | Whole document searchable; both directions across atoms/nesting; fully visible caret and correct endpoint |

These are future implementation acceptance scripts, not executed UI tests in M0. Desktop keyboard/browser acceptance includes Windows/Linux Chrome for the release matrix if advertised; Mac native results alone do not establish those platforms. Real screen-reader announcements remain unverified and cannot be claimed from labels/axe.

## Copy catalogue and semantic labels

| Key | RU | EN | Meaning / semantic use |
| --- | --- | --- | --- |
| editor.label | Документ | Document | Editing surface accessible name |
| toolbar.label | Форматирование текста | Text formatting | Toolbar name |
| block.actions | Действия с блоком | Block actions | Labelled menu button, expanded state |
| block.add | Добавить блок | Add block | Opens insertion picker |
| block.move | Переместить блок | Move block | Dedicated move controls, keyboard alternative |
| slash.label | Выберите тип блока | Choose a block type | Picker label |
| slash.empty | Ничего не найдено | No results | Visible non-option status |
| readonly | Только чтение | Read-only | Persistent mode badge |
| disabled | Редактор временно недоступен | Editor temporarily unavailable | Persistent disabled reason |
| loading | Открываем документ… | Opening document… | Busy status |
| composing | Завершите ввод, чтобы применить действие. | Finish typing to use this action. | Temporary command lock reason, not an input error |
| invalidNest | Этот блок нельзя поместить сюда. | This block cannot be placed here. | Destination refusal |
| unavailable | Недоступно в этом документе. | Unavailable in this document. | Profile capability reason |
| staleSelection | Выделение изменилось. Выберите текст снова. | The selection changed. Select the text again. | Bookmark refusal |
| staleDialog | Документ изменился. Откройте окно заново. | The document changed. Open the dialog again. | Async result refusal |
| loadError | Не удалось открыть редактор. | Could not open the editor. | Initialization error heading |
| runtimeError | Редактирование остановлено. Сохраните копию перед повторным запуском. | Editing stopped. Save a copy before restarting. | Fatal runtime recovery |
| retry | Повторить | Retry | Explicit retry action |
| downloadOriginal | Скачать исходный документ | Download original document | Original payload recovery only |
| downloadRecovery | Скачать доступную копию | Download available copy | Recoverable snapshot; disclose content age separately |
| cancel | Отмена | Cancel | Dismiss without document mutation |
| apply | Применить | Apply | Validate result before mutation |

Strings are keyed, not assembled by concatenating translated fragments. Errors use stable machine codes plus user-readable localized messages; raw exception/stack text is not primary UX. Copy that mentions a resource or recovery snapshot is shown only when that resource actually exists.

## Linked implementation ownership

[OSR-42](https://linear.app/klenwriter/issue/OSR-42) implements toolbar/gutter/keyboard move; [OSR-43](https://linear.app/klenwriter/issue/OSR-43) insertion/slash and [OSR-44](https://linear.app/klenwriter/issue/OSR-44) DnD consume frames 02–03; [OSR-50](https://linear.app/klenwriter/issue/OSR-50) containers, [OSR-51](https://linear.app/klenwriter/issue/OSR-51) poetry and [OSR-52](https://linear.app/klenwriter/issue/OSR-52) tables consume frame 04. OSR-39/40/41 implement the identity, selection, scroll and composition invariants this UX depends on. Host-adapter tasks consume frame 07. Cross-browser/accessibility acceptance consumes all frames and UX-K01–K10. The parity matrix remains the feature inventory authority; a designed control is not evidence that parity is complete.
