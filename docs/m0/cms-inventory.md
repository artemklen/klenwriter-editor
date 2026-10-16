# CMS inventory for OSR-60 and provenance facts for OSR-27

Status: read-only source audit; no CMS deployment, migration, runtime acceptance or test execution is claimed.

Baseline: private GitLab project `15`, `local/klenwriter-cms`, default branch `master`, exact commit `a7f8a081b7827dd31097ad6c9104654366ae6e04` (default branch resolved on 2026-10-17). Source access used authenticated GitLab APIs. The old recovered local checkout was not used as the current baseline and was not changed. Repository [AGENTS][instructions], [agent rules][rules] and [documentation policy][policy] were read at this revision. This audit contains independently written findings and metadata; it contains no private CMS source or fixture bodies.

Evidence: [source file hashes](../../evidence/osr-60/source-provenance.json), [repository path inventory](../../evidence/osr-60/source-tree.json), [all corpus cases by stage, without payloads](../../evidence/osr-60/corpus-stages.json), [rights observations](../../evidence/osr-60/rights-observations.json). File hashes were recomputed from bytes in memory and matched GitLab `content_sha256`. Source links below are pinned to this commit; access remains private.

## Consumers and current runtime boundary

There are **seven Angular component mount sites, covering nine route patterns**. They share `kw-kwdj-document-editor` → injectable `EDITABLE_KWDJ_EDITOR_MOUNTER` → `mountEditableKwdjEditor` → Tiptap 3 (`@tiptap/core` and `@tiptap/pm` pinned to 3.28.0). Route definitions are in [app.routes.ts][routes]; each path below is relative to `frontend/admin-spa/src/app/`. Every host has a corresponding `.html` mount. The shared codec reads `document.profile`, so a host name alone must not select the schema.

| Component and source | Route (under /admin) | Schema/profile and host-specific behavior |
| --- | --- | --- |
| [materials/material-detail.ts][material], HTML mount lines 80–96 | `materials/:materialId` | KWDJ v1; admitted response profile supports prose/poetry. Material families share this consumer. Inline document autosave; metadata/SEO explicit save. Media insertion enabled; focus mode output consumed. |
| [chapters/chapter-create.ts][chaptercreate], HTML 113–121 | `materials/:materialId/chapters/new` | KWDJ v1; initial prose document from `chapter-create.models.ts`. Explicit create; no If-Match for a not-yet-created identity. |
| [chapters/chapter-detail.ts][chapter], HTML 99–114 | `materials/:materialId/chapters/:chapterId` | KWDJ v1; profile from admitted document (chapter create seeds prose). Inline document autosave; title/excerpt/SEO explicit save. Media enabled. |
| [world/universe-create.ts][universecreate], HTML 88–96 | `universes/new` | KWDJ v1 prose seed from `universe-create.models.ts`; explicit create. |
| [world/reference-entity-create.ts][referencecreate], HTML 164–172 | `universes/:universeId/reference-entities/new` | KWDJ v1 prose seed; explicit create. |
| [world/collection-create.ts][collectioncreate], HTML 118–126 | `collections/new` | KWDJ v1 prose seed; explicit create. |
| [world/world-detail.ts][world], HTML 480–489 | `universes/:universeId`; `universes/:universeId/reference-entities/:referenceEntityId`; `collections/:collectionId` | KWDJ v1 admitted document; explicit save. **Existing reference-entity body is locked**, unlike reference creation: `referenceDocumentLocked` at line 424 and document-event guard at 929. Universe and collection share the editable path. Media insertion stays default false. |

All seven pass document/mount identity/disabled state and consume document, mount-state and status events. Material, chapter and existing-world hosts also consume the separate unexported-change signal; create hosts do not bind that signal. This is a current difference to test during replacement, not an instruction to reproduce a data-loss risk. Material-create and static-page-create routes are not additional editor mount sites; the shared material detail is their subsequent document surface. Search for the selector and component import found the seven HTML mounts above; the exact files, route table and hashes are in evidence.

The [current capability inventory][capabilities] distinguishes the Angular target from production cutover: `spa-production-admin-cutover` is absent (line 276). [AGENTS][instructions] and the [runtime boundary][boundary] describe `ADMIN_UI_OWNER` with Askama as the unset/default owner; this audit did not inspect a live deployment. Do not infer that deployed production uses Angular solely from a shipped Angular feature.

### Legacy consumers remain a separate migration lane

Five server-rendered form families still mount the Markdown-backed Tiptap 2 editor; they are not five more KWDJ hosts. Tiptap is declared as `^2.11.5` in the [legacy package manifest][legacypackage]; this is a dependency range, not a claim about the resolved lockfile version.

| Source template under templates/admin | GET form routes under /admin | Canonical field and editor mode |
| --- | --- | --- |
| `works/form.html` | `works/new`, `works/{id}` | `description`, prose |
| `chapters/form.html` | `chapters/new`, `chapters/{id}` | `content_markdown`, prose |
| `articles/form.html` | `articles/new`, `articles/{id}` | `content_markdown`, prose |
| `reviews/form.html` | `reviews/new`, `reviews/{id}` | `content_markdown`, prose |
| `poems/form.html` | `poems/new`, `poems/{id}` | `content_markdown`, poem |

The [router][legacyroutes] maps create POSTs to the collection path and update POSTs to the detail path. `templates/admin/partials/wysiwyg_editor.html` and `wysiwyg_editor_description.html` own hidden canonical textareas and `data-kw-tiptap-mount`. [admin_editor.html][legacylayout] loads the bundle and [editor-shell.js][shell]; the shell calls `window.KwTiptapEditor.initForm(form, hooks)`, then [main.js][legacy] calls `initEditor`.

Legacy prose config includes headings 2/3, quotes/lists, code, literary/spoiler blocks, media, tables, nested task items, text marks, links, typography and block/slash/bubble UI. Poem mode disables prose structures such as headings, lists, quotes, code blocks and rules and uses a separate Markdown conversion path. Toolbar dispatch includes paragraph, H2/H3, quote, bold, italic, strike, bullet/ordered list, scene break, undo and redo. Every document update serializes to the hidden Markdown field. Failure exposes the fallback textarea rather than discarding its value. Local draft recovery uses localStorage plus server timestamp/content comparison, and Save/publish orchestration requires an accepted response before clearing recovery state. Native submit intent alone does not prove persistence ([shell][shell] 293–444).

OSR-72 must record **replacement or retirement for each of these five rows**, including preservation/conversion policy and rollback. It must not silently reinterpret Markdown as KWDJ or require a whole Askama-to-Angular rewrite merely to remove Tiptap. OSR-53 deletion waits for both Angular and legacy consumer closure, release references, bundle/package removal and rollback evidence.

## Schema and authoring parity

The [versioned contract][contract], [JSON schema][schema] and [domain boundary][domain] are authoritative for KWDJ v1; the generic editor core is not this closed schema. The envelope has `schema = klenwriter.document`, `schema_version = 1`, profile `prose | poetry`, and a nonempty root content array. A paragraph may have empty inline content. Text leaves are nonempty. Unknown fields/types/marks and unsupported versions fail admission; they are not silently removed.

The schema has **24 node types and 10 mark types**. The table separates representability/preservation from exposed authoring controls; schema support is not a UI acceptance claim.

| Nodes/marks | Required preservation and current creation/editing surface |
| --- | --- |
| `text`, `paragraph`, `heading`, `hard_break` | Text/marks, H1–H6, align and first-line indent survive adapters. Current toolbar creates paragraph/H2/H3; it is not an H1–H6 creation UI. Shift+Enter inserts a bare hard_break where admitted; in code it inserts a newline. |
| `scene_break`, `code_block`, `blockquote` | Scene insertion, slash Code, quote wrap/unwrap; code may be empty and carries optional language. Unsupported transforms refuse before mutation. |
| `bullet_list`, `ordered_list`, `list_item`, `task_list`, `task_item` | All types round-trip; ordered start and task checked state are preserved. Current essential list commands operate on flat top-level bullet/ordered lists with Enter split/exit. Nested/task list authoring and indentation are explicitly absent in capability row 275. |
| `table`, `table_row`, `table_cell`, `table_header` | Cell spans, contents and rectangular effective width survive; slash inserts a 2×2 table. This does not establish a full table-row/column editing UI. |
| `media_image` | UUID identity, usage-specific alt/decorative choice, alignment and paragraph caption; image/gallery flow enabled only on material/chapter detail. A gallery inserts sequential images, not a new KWDJ gallery node. |
| `literary_block`, `warning`, `spoiler`, `disclosure` | Preserve bounded kinds, labels and containers; slash callout creates an author note. Full property editors for every container are not established by this audit. |
| `verse`, `verse_line`, `stanza_break` | Poetry permits verse alongside prose. A verse contains lines and stanza breaks; a line accepts text and hard_break. A stanza break stores positive blank_lines. Paragraph↔verse conversion preserves marks/breaks or refuses when layout/blank-line information would be lost. |
| `strong`, `emphasis` | Live command capability and pressed state; toolbar/bubble plus Mod-b/Mod-i. |
| `strike`, `code`, `subscript`, `superscript`, `text_color`, `highlight` | Preserve all marks and closed color tokens; no general current Angular control for all these marks was identified in the command registry. |
| `link`, `reference_link` | Safe ordinary URL/title dialog and Mod-k; reference UUID marks are preserved and protected from replacement by the ordinary-link dialog. The reference-entity picker remains absent (capability row 274). |

Current poetry keys are a concrete parity baseline ([verse-editing.ts][verse], [factory][factory]): Enter splits a nonempty verse line; an empty line after a line becomes a stanza break and continues in a line; Enter on the terminal empty line after a break exits into a paragraph. The middle-of-verse empty-line-after-break case retains the caret. Shift+Enter may insert hard_break inside a verse_line. Adjacent candidate stanza breaks merge during normalization; the edit plugin trims invalid leading/trailing break edges. New-editor UX changes need explicit decisions, not an accidental interpretation that every Enter starts a new verse.

The [command registry][commands] exposes undo, redo, paragraph, heading2, heading3, blockquote, sceneBreak, bulletList, orderedList, strong, emphasis and link. [Block commands][blocks] add slash choices paragraph/H2/H3/quote/bullet/ordered/scene/image/gallery/table/code/callout/verse, root block move/duplicate/delete, preserving transforms and Markdown prefixes. Verse is poetry-only. Commands derive capability from selection/schema/ancestors rather than a static toolbar switch. Root/native drop is application-owned; unsupported native ProseMirror drop is blocked. Keyboard reordering is a separate path to preserve.

| Surface/state | Replacement acceptance to carry into OSR-49/69/70 |
| --- | --- |
| Mount, view, disabled | Read-only prose has no editor chrome. Reading/disabled changes toggle the retained instance, with textbox role, label, multiline, readonly/disabled semantics. Mount failure and export failure remain distinct. Only a changed mountKey replaces the document instance. |
| Transaction and dirty | Selection-only transactions refresh capability without document dirtying. Current document changes serialize the whole Tiptap JSON and export to KWDJ; a failed export retains a separate dirty/unexported state, blocks Save, and undo-to-baseline clears that error before semantic deduplication. OSR-69 must replace per-input export without losing these guarantees. |
| Link dialog | Captures a stable target; validates safe URL/title before dispatch; protects reference_link; cancel/refusal changes nothing. Trap/return focus, Escape, disabled state and stale-document invalidation remain observable. |
| Media dialog | Selector plus usage metadata; UUID identity is distinct from a delivery URL. Captured insertion target, preview, decorative/alt/caption/align, cancellation, auth handoff and unresolved upload leave protection. A rejected/stale insertion dispatches no transaction. |
| Slash, bubble and block menus | Bounded caret/selection anchors, Russian searchable entries, keyboard navigation/Escape, contextual enablement, visible refusal, root move/duplicate/delete, drag cancellation, scroll positioning and focus restoration. Current block-menu authoring exists; capability wording about absent reference picker must not be read as absence of every block menu. |
| Clipboard | One application owner, inert rich conversion and explicit plain fallback, resource/URL/media rejection diagnostics. Current `paste.ts` refuses a nonempty selection crossing different textblock instances. Browser spike success for cross-block paste is not current CMS production coverage. |
| Input and typography | RU/EN typing, quote/dash/NBSP transformations with undo; code remains literal; paragraph/verse/list Enter, Shift+Enter, selection deletion and history grouping. Current DOM schema/semantics are evidence; this audit did not run native input or assistive technology. |
| Accessibility | Preserve keyboard operation, focus ownership, labels, disabled explanations and semantic roles. New v1 requires keyboard/focus/semantics/axe; real screen-reader/VoiceOver acceptance is explicitly deferred by owner and no support promise is made here. |
| Support scope | Required new v1 acceptance is desktop Chrome/Safari, RU/EN. Firefox remains experimental but Chromium/Firefox/WebKit measurements are required; a recorded behavioral GAP is not a missing measurement. Mobile, collaboration and CJK acceptance are beyond v1. |

The [adapter README][adapterreadme] has stale deferrals for menus, MediaHub and chapters; code and [capability inventory][capabilities] show these shipped. Its reference-picker/nested-list deferrals remain current. Preserve this distinction when refreshing OSR-35/68/70.

## Save, recovery, security and host responsibilities

Material and chapter detail autosave document changes after **1200 ms**, gated by dirty state, valid export, session, dialogs and save availability ([material][material] 990–1005; [chapter][chapter] AUTOSAVE_DELAY_MS). Metadata/SEO remain explicit-save forms. World detail is explicit-save. Existing-reference body remains locked. Create flows use sealed Idempotency-Key attempts and admitted create receipt/Location/ETag followed by a separate GET, with no If-Match before identity exists.

Existing-resource saves use the CMS adapter's CSRF/session, If-Match and Idempotency-Key contract. A receipt is not by itself a current working document: GET reconciliation checks identity, ETag and expected saved contents. Preserve conflict/412, invalid receipt, outcome-unknown/in-progress, retryable uncertainty, stale response generation, auth handoff and user-directed recovery. Do not auto-replay a mutation after authentication. Input typed after an in-flight save belongs to a newer local draft; the response must not replace it. Same-document save/property transitions retain editor history/selection when canonical content is unchanged.

Durable recovery is principal/resource scoped: material; parent-work/chapter; or typed world owner. Each has its own recovery service/IndexedDB implementation under the respective `recovery/` path. The write queue serializes per key, coalesces pending writes and fences stale deletes. Restore/Discard is explicit; matching baseline permits a normal dirty draft, changed baseline becomes conflict. Storage failure is visible; never store one principal's text under another principal's key. Generation and event boundaries include navigation/retry/destroy, pagehide/beforeunload/visibility changes and post-save reconciliation. Recovery is not editor undo and not a promise of server persistence. Create flows use pending-draft auth handoff; this audit does not establish durable IndexedDB recovery for not-yet-created objects.

The Angular [entry CSP][csp] at line 59 sets script-src self and nonce-bound style-src; it contains no wasm-unsafe-eval allowance. [Shared public CSP][publiccsp] is also strict. Current Tiptap uses `injectCSS: false`. OSR-31 must prove the narrow WASM delivery/CSP change on the actual CMS boundary; do not widen public policy, inline scripts or worker policy by inference. Build artifacts, nonce handling, media resolution and authenticated network calls remain host concerns.

Server [normalization/validation][domain] and [rendering][render] remain separate acceptance boundaries. Only a validated document reaches projections/manifests; identity resolution is fallible. [Public rendering][renderdoc] fails visibly on unsupported content, manifest drift or missing required media rather than dropping nodes or falling back to the legacy body. Replacing a browser editor does not replace persistence, publish guards or public rendering automatically.

### Existing operational limits, not new core defaults

[Normative policy][limits] and [Rust constants][domain] agree on inclusive limits: canonical UTF-8 envelope 2,097,152 bytes; depth 32; nodes 50,000; normalized merged text leaf 262,144 UTF-8 bytes; 500 rows per table; 50 effective span-expanded columns; 8,192 UTF-8 bytes per authored string attribute. Root block is depth 1 and text child depth 2. Node count includes all block/inline/text/row/cell/item/caption nodes, excludes envelope/attrs/marks/scalars. Attribute budget excludes text, fixed tokens/enums and system-resolved URLs. Serialized byte size is measured after deterministic normalization; transport/clipboard input budgets are separate.

On violation, rejection is atomic with no partial canonical revision/projection/manifests; splitting/truncating to fit is not an allowed repair. Deterministic serialization sorts object keys by Unicode code point, keeps array order, emits no insignificant whitespace, uses literal printable Unicode UTF-8 and the defined JSON control escapes. These are KWDJ-profile limits and not an arbitrary cap imposed on every generic editor profile.

## Corpus stages and coverage ownership

The single existing CMS authority is `contracts/kwdj/v1/manifest.json`, package 1.0.0, accepted schema v1, **34 fixture IDs / 59 cases** across four files. The Angular test loader reads these files from disk, not a second copied corpus. Evidence lists every case's stage, ordinal, source path, outcome and disposition without copying authored content.

Counts below are **declared stage membership**, including deferred membership. They are not passing-test counts. Native, WASM and browser entries identify acceptance responsibility for the editor migration, not named people or claims that a new implementation exists.

| Stage | Declared cases | Native responsibility / observed source | WASM responsibility | Browser/CMS responsibility |
| --- | ---: | --- | --- | --- |
| validate_normalize | 59 | Rust KWDJ profile; shared [contract runner][rustcorpus], exact structural/semantic/limit diagnostics | Same codec/normalizer vectors and deterministic results at the bridge | Fail before editable mount; diagnosed failed import/save |
| determinism | 59 | Canonical bytes, repeat normalization/projection and manifest ordering | Native/WASM byte-equivalence, stable diagnostic order | Repeat export/reopen without document drift |
| editor_round_trip_unchanged | 32 | Admit/export semantic oracle | Profile import/snapshot/export equivalence | Mounted UI lane plus existing [headless adapter cases][roundtrip]; headless is not mounted evidence |
| editor_edit_save_reopen | 20 | Expected delta and canonical document oracle | Commands/selection mapping and snapshot round-trip | Existing [edit tests][edits] cover 14 append + 4 replace + 2 mark operations headlessly; real CMS save/GET/reopen is additional |
| clipboard_plain_to_kwdj | 2 | Codec validation and normalization oracle | Shared converter/bridge outcome as implemented | Browser clipboard acquisition and context insertion; [current clipboard tests][clipboard] use DOM test environment |
| clipboard_rich_to_kwdj | 5 | Safe candidate admission after conversion | Explicit conversion boundary; no implied DOM parser in Rust | Inert HTML, unsafe URL/media handling, fallback diagnostics and native clipboard evidence |
| plain_text_projection | 30 | Rust projection plus applicable corpus expectations and [projection tests][projection] | Same projection if exposed through WASM | Live counts/search/public snippet consumers verify the intended projection, not innerText |
| identity_manifest_extraction | 10 | Rust validator extracts manifests; resolver is injected and fallible | Deterministic identity collection without database dependency | CMS resolves IDs/permissions; client metadata is not authority |
| public_render | 37 | CMS Rust renderer and contextual escaping; [renderer tests][render] plus runtime contract | No requirement to put public rendering into editor WASM | CMS public rendering/integration lane; per-case corpus execution was not established by this audit |
| legacy_import_parse | 21 | CMS migration/import owner; parser → candidate → canonical KWDJ | Only an explicitly selected import package, not hidden core behavior | Legacy replacement/conversion and loss reports; stage-complete executable coverage not established here |
| schema_upconversion | 2 | DOC-018 rejects unsupported version; DOC-024 awaits approved later schema/converter | Version admission now; a future converter only after its own versioned contract | Preserve/reject unsupported input visibly; no silent flattening or v2-success claim |

Reading the Rust runner establishes **39 document cases + 14 resource-boundary cases**, **5 non-applicable cases with no KWDJ candidate**, and **1 deferred case**. The 14 resource cases expand to **21 measurements**. Non-applicable to this module is not deferred everywhere and must be assigned to its adapter/migration stage; none is counted as a passing validator case here. All tests in this paragraph are source-inspected, not rerun.

**DOC-024 is genuinely deferred** because v1 is the first schema: a real mixed-version upconverter cannot be executed until a later approved schema exists. Its declared validate/render/projection/manifest/determinism/editor-roundtrip memberships remain deferred too. The future revision scenario must preserve retained historical bytes and create a new revision on restore according to upstream policy; no fake v2 fixture should turn this into a green v1 test. OSR-45 must publish stage × case × runtime disposition so headless, native, WASM, mounted and CMS integration results cannot substitute for one another.

## License, source and fixture provenance facts

These observations support OSR-27; they do not decide licensing:

- [Workspace Cargo.toml][workspace] line 13 declares MIT OR Apache-2.0. [klenwriter_domain/Cargo.toml][domaincargo] does not declare a package license or inherit `license.workspace`.
- [Angular][angularpackage] and [legacy][legacypackage] npm packages declare private=true and no package license field.
- Recursive baseline tree inspection found no license/copying/copyright file. The only notice-named match is `templates/partials/public/notice.html`, a UI template rather than a redistribution notice.
- The selected source/provenance files have no SPDX-License-Identifier or copyright marker in the first 80 lines. This bounded header scan cannot prove authorship or permissions.
- The inspected corpus manifest/README establish versioned authority and test semantics; no explicit corpus redistribution grant was found. Fixture payload authorship/rights and any third-party contribution provenance remain **UNKNOWN**.
- CMS repository visibility is private. Source accessibility, source hashes, a workspace license expression and owner access are not interchangeable with a documented grant to redistribute every file or fixture.

An independently implemented codec and newly authored synthetic vectors can be prepared without copying private implementation or fixture payloads. Their record must say “independent synthetic vector” and describe coverage; it must not say “upstream DOC corpus passed” without an authorized, pinned conformance run. Root/owner decides extraction rights, upstream corpus home and permitted distribution. This audit neither exports private source nor invents a new authoritative corpus.

Subsequent owner decision, 2026-10-17: rights and scoped transfer of owner-controlled source/synthetic fixtures were explicitly confirmed, with MIT OR Apache-2.0 selected. See [D10–D12](decision-register.md) and [licensing](licensing.md). The original source-inspection observations above remain factual; third-party provenance still requires per-file review before extraction. One versioned corpus authority and pinned CMS consumption are selected in D12.

## Dependencies, refresh triggers and unresolved decisions

Use this inventory in OSR-49 (Angular binding/chapter pilot), OSR-69 (save/recovery adapter), OSR-70 (remaining Angular migrations), OSR-72 (legacy replacement), OSR-68 (host dialogs) and OSR-53 (remove both Tiptap generations). OSR-35 consumes command/capability distinctions; OSR-45 consumes the corpus stage matrix; OSR-31 owns CSP/delivery validation. The source snapshot does not assign CMS release owners or dates.

Refresh before implementation or rollout when any watched path changes: schema/manifest/fixtures/operational policy; KWDJ domain validation/normalization/render; Angular editor/host HTML and TS/routes; save/API/recovery/identity/media boundaries; legacy templates/editor/shell/bundle/build dependencies; CSP/runtime owner configuration. Re-resolve default HEAD, compare exact source hashes, update affected rows, recount selectors/routes and repeat stage disposition extraction. An unchanged subset may retain its proof only with an explicit comparison; elapsed time alone is not a proof of staleness or freshness.

Remaining decisions/facts to verify at the relevant gate:

1. Which CMS release and baseline will consume the replacement, who owns that rollout, and which concurrent CMS roadmap changes affect the nine routes: **not established** by a source-only audit. Source-linked historical KW/KWC IDs are provenance, not current delivery commitments.
2. Authoring features currently absent (reference picker, nested/task list controls) versus new product requirements: keep them explicit additions, not invented parity regressions.
3. For each legacy form, replace in place or retire the route; define Markdown preservation/conversion and rollback before deleting Tiptap 2.
4. Execute the approved scoped source/corpus transfer and single-authority plan from D10–D12 with per-file provenance; no divergent public/private fixture copies.
5. Real CMS acceptance after bindings exist: same-document history/selection, disabled/read-only and reference lock, data loss prevention, native clipboard, saved canonical bytes, post-save typing, dialogs/auth uncertainty, reload recovery and strict CSP. No runtime acceptance is claimed by this inventory.

[instructions]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/AGENTS.md
[rules]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/agent_rules.md
[policy]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/documentation_policy.md
[capabilities]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/runtime/capability_inventory.md
[boundary]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/decisions/admin_spa_boundary.md
[routes]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/app.routes.ts
[host]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj-document-editor.ts
[hosthtml]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj-document-editor.html
[factory]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/create-editable-kwdj-editor.ts
[commands]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/formatting-commands.ts
[blocks]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/block-editor-commands.ts
[verse]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/verse-editing.ts
[paste]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/paste.ts
[link]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/link-editing.ts
[image]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/media-image-insertion.ts
[material]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/materials/material-detail.ts
[chapter]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/chapters/chapter-detail.ts
[world]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/world/world-detail.ts
[chaptercreate]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/chapters/chapter-create.ts
[universecreate]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/world/universe-create.ts
[referencecreate]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/world/reference-entity-create.ts
[collectioncreate]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/world/collection-create.ts
[schema]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/contracts/kwdj/v1/kwdj.schema.json
[contract]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/contracts/kwdj/v1/README.md
[manifest]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/contracts/kwdj/v1/manifest.json
[limits]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/contracts/kwdj_operational_policy_v1.md
[domain]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/src/kwdj/mod.rs
[rustcorpus]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/tests/kwdj_contract.rs
[projection]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/tests/kwdj_projection.rs
[validator]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/tests/kwdj_validator.rs
[render]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/src/kwdj/render.rs
[renderdoc]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/docs/runtime/kwdj_public_rendering.md
[corpus]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj/corpus.ts
[roundtrip]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj/adapter.corpus.spec.ts
[edits]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj/adapter.edit.spec.ts
[clipboard]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj/clipboard/clipboard.spec.ts
[adapterreadme]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/src/app/editor/kwdj/README.md
[legacy]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/editor/src/main.js
[shell]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/static/js/editor-shell.js
[legacyroutes]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_web/src/admin/mod.rs
[legacylayout]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/templates/layouts/admin_editor.html
[csp]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_web/src/routes/admin_spa.rs
[publiccsp]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_web/src/auth/middleware.rs
[workspace]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/Cargo.toml
[domaincargo]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/crates/klenwriter_domain/Cargo.toml
[angularpackage]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/admin-spa/package.json
[legacypackage]: https://git.aklen.me/local/klenwriter-cms/-/blob/a7f8a081b7827dd31097ad6c9104654366ae6e04/frontend/editor/package.json
