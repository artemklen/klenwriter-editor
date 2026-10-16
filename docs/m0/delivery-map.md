# Delivery map — M0 v2.0

Live Linear snapshot: 2026-10-17, 48 issues, pagination exhausted, 136 blocking edges, no cycles. Machine-readable [dependency graph](../../evidence/m0/dependency-graph.json) contains the full topological order. A dependency means readiness to accept the result, not prohibition on research/scaffolding in parallel. Dates/effort are not invented before implementation capacity is assigned.

## Observable milestone exits

| Milestone | Required exit evidence | Acceptance owner |
| --- | --- | --- |
| M0 | Browser comparison, ADRs, two profile vectors, Unicode/maps/history vectors, live CMS inventory, calibration/performance protocol, Figma UX and FigJam flows; independent review of exact package; owner scope/license choices recorded | Primary Codex technical; Артём product/grants, OSR-26 |
| M1 | Clean reproducible Rust/native/WASM builds; generic core with KWDJ profile; pinned authoritative corpus and stage parity; provenance/license/name checks | Library/profile maintainer + independent reviewer |
| M2 | Atomic operations, selection/history/revisions/lifecycle; native/WASM DTO parity; independent profile via public API; fuzz/property/performance gates | Engine/SDK maintainer + independent reviewer |
| M3 | Installable vanilla alpha without CMS/Rust toolchain; supported input/selection/clipboard/UI/states; Chrome/Safari native lane plus all three engine measurements; security/keyboard/focus/semantics/axe; explicit virtualization go/no-go | Browser/UX/security maintainers + reviewer |
| M4 | Full KWDJ domain/table/poetry/reference/media capabilities, stage-aware corpus and mounted round trips; authoring vs preservation explicitly checked | Profile/host maintainers + reviewer |
| M5 | Real CMS CSP delivery, server validation, SDK mirrors replacement, Angular pilot with save/reopen/conflict/auth/navigation/recovery and rollback | CMS maintainer, product acceptance |
| M6 | Every Angular and legacy consumer migrated or explicitly retired with replacement path; rollback drill/observation; then zero Tiptap v2/v3 manifests, locks, bundles and runtime paths | CMS maintainer, product acceptance |
| M7 | Clean external install and extension example, reproducible packages, license/security/contribution/release docs; supported/experimental/deferred matrix; M6 cutover complete | Артём release owner + independent reviewer |

## Requirement traceability

| Requirement | Contract / design artifact | Implementation and acceptance |
| --- | --- | --- |
| Standalone OSS with CMS priority | architecture §1–4, ADR-002 | OSR-28/29/54/63/64/65/71 |
| Generic core, KWDJ first, native/WASM agreement | ADR-002, CMS corpus stage inventory | OSR-29/30/32/64 |
| Lossless schema/codecs/unknown refusal and limits | ADR-002, decision D12/D13, inventory limits | OSR-29/30/34/50/51/52/67 |
| Atomic edits, selection, history and dirty snapshots | ADR-003, flows F01/F02/F04/F06 | OSR-33/34/35/36/37/63 |
| Cross-block native selection and explicit scrolling | ADR-001, UX frames 01/03/04 | OSR-39/40/45/46 |
| RU/EN, composition and exactly-once model commit | ADR-001, flow F03, UX frame 06 | OSR-41/45/48 |
| Toolbars, slash, DnD and keyboard alternative | UX frames 01–04/08 | OSR-42/43/44/66 |
| Clipboard security, no data loss, atomic insertion | Architecture §9, flow F02 | OSR-47/67/45 |
| Full KWDJ containers, tables and poetry | CMS parity, UX frame 04 | OSR-50/51/52/45 |
| Media/links/references and stale dialogs | ADR-002, flow F05, UX frame 07 | OSR-68/63/42 |
| Explicit loading/readonly/disabled/refusal/fatal states | UX frames 05/06, flow F07 | OSR-63/65/66/67 |
| Performance without sacrificing correctness | Performance protocol, decision D08 | OSR-38/46/71 |
| CMS delivery/CSP/save/recovery | CMS inventory, flows F06/F07 | OSR-31/32/49/69 |
| Remove both Tiptap generations | CMS route/consumer matrix, decision D02 | OSR-70/72/53; M7 waits |
| Future extension and compatibility evolution | Architecture §4/11–13, decision register | OSR-54/63/64/71 |
| Chrome/Safari required, Firefox experimental | ADR-001, decision D04/D05 | OSR-45/66/71; OSR-73 post-v1 |
| Explain choices, alternatives, dependencies and cost without them | Architecture §11–13, ADR-001/002/003 | OSR-56/26 review package |
| Licensing, rights, corpus owner, namespaces | Decision register and provenance inventory | OSR-27/29/30/54/71 |

## Full task graph

| Task | Milestone | Deliverable | Blocked by |
| --- | --- | --- | --- |
| [OSR-26](https://linear.app/klenwriter/issue/OSR-26) | M0 | Утвердить архитектуру, scope v1 и критерии milestones | OSR-27, OSR-56 |
| [OSR-27](https://linear.app/klenwriter/issue/OSR-27) | M0 | Реестр решений: лицензия, corpus ownership и продуктовые границы | — |
| [OSR-28](https://linear.app/klenwriter/issue/OSR-28) | M1 | Репозиторий OSS: workspace, CI и воспроизводимая сборка | OSR-26 |
| [OSR-29](https://linear.app/klenwriter/issue/OSR-29) | M1 | Извлечь KWDJ-профиль и общее document core | OSR-28, OSR-57 |
| [OSR-30](https://linear.app/klenwriter/issue/OSR-30) | M1 | Corpus parity: native Rust, WASM и profile conformance | OSR-29 |
| [OSR-31](https://linear.app/klenwriter/issue/OSR-31) | M5 | CMS WASM delivery и узкий CSP-контракт | OSR-27, OSR-63 |
| [OSR-32](https://linear.app/klenwriter/issue/OSR-32) | M5 | Заменить TS semantic mirrors после native/WASM parity | OSR-30, OSR-31, OSR-63 |
| [OSR-33](https://linear.app/klenwriter/issue/OSR-33) | M2 | Session tree: идентичность, lifecycle и mapping | OSR-30, OSR-59 |
| [OSR-34](https://linear.app/klenwriter/issue/OSR-34) | M2 | Атомарные transactions и typed refusal | OSR-33, OSR-57 |
| [OSR-35](https://linear.app/klenwriter/issue/OSR-35) | M2 | Команды редактирования и capability API | OSR-34 |
| [OSR-36](https://linear.app/klenwriter/issue/OSR-36) | M2 | Undo/redo: document, selection и границы группировки | OSR-34, OSR-59 |
| [OSR-37](https://linear.app/klenwriter/issue/OSR-37) | M2 | Dirty revisions, render deltas и snapshot export | OSR-34 |
| [OSR-38](https://linear.app/klenwriter/issue/OSR-38) | M2 | Property/fuzz tests и performance regression gates | OSR-36, OSR-37, OSR-61, OSR-63, OSR-64 |
| [OSR-39](https://linear.app/klenwriter/issue/OSR-39) | M3 | DOM renderer основных блоков и reconciliation | OSR-35, OSR-58, OSR-63 |
| [OSR-40](https://linear.app/klenwriter/issue/OSR-40) | M3 | Selection controller: Unicode и границы блоков | OSR-39, OSR-59 |
| [OSR-41](https://linear.app/klenwriter/issue/OSR-41) | M3 | IME state machine и exactly-once composition commit | OSR-36, OSR-39, OSR-40 |
| [OSR-42](https://linear.app/klenwriter/issue/OSR-42) | M3 | Block chrome: toolbar, gutter и keyboard move | OSR-35, OSR-40, OSR-62 |
| [OSR-43](https://linear.app/klenwriter/issue/OSR-43) | M3 | Slash menu: контекстные команды и отказы | OSR-41, OSR-42 |
| [OSR-44](https://linear.app/klenwriter/issue/OSR-44) | M3 | Drag-and-drop блоков с доступной альтернативой | OSR-41, OSR-42 |
| [OSR-45](https://linear.app/klenwriter/issue/OSR-45) | M3 | Mounted E2E harness: corpus stages и три движка | OSR-39, OSR-63 |
| [OSR-46](https://linear.app/klenwriter/issue/OSR-46) | M3 | Virtualization с сохранением selection, IME и a11y | OSR-40, OSR-41, OSR-61, OSR-66 |
| [OSR-47](https://linear.app/klenwriter/issue/OSR-47) | M3 | Clipboard pipeline: безопасный decode и atomic insert | OSR-34, OSR-40, OSR-41 |
| [OSR-48](https://linear.app/klenwriter/issue/OSR-48) | M3 | Типографика как настраиваемые input rules | OSR-35, OSR-36, OSR-41 |
| [OSR-49](https://linear.app/klenwriter/issue/OSR-49) | M5 | Angular binding и chapter-detail pilot | OSR-31, OSR-38, OSR-43, OSR-44, OSR-45, OSR-46, OSR-48, OSR-50, OSR-51, OSR-52, OSR-66, OSR-67, OSR-68, OSR-69 |
| [OSR-50](https://linear.app/klenwriter/issue/OSR-50) | M4 | KWDJ containers и доменные блоки | OSR-39, OSR-40, OSR-45, OSR-64 |
| [OSR-51](https://linear.app/klenwriter/issue/OSR-51) | M4 | Poetry profile: verse, stanza и Enter semantics | OSR-50 |
| [OSR-52](https://linear.app/klenwriter/issue/OSR-52) | M4 | Таблицы: grid operations и редактирование ячеек | OSR-50 |
| [OSR-53](https://linear.app/klenwriter/issue/OSR-53) | M6 | Удалить оба поколения Tiptap после полного cutover CMS | OSR-46, OSR-70, OSR-72 |
| [OSR-54](https://linear.app/klenwriter/issue/OSR-54) | M1 | Имя, лицензия и package namespaces | OSR-26 |
| [OSR-55](https://linear.app/klenwriter/issue/OSR-55) | M7 | Документация, playground и путь внешнего contributor | OSR-50, OSR-51, OSR-52, OSR-64, OSR-65, OSR-67 |
| [OSR-56](https://linear.app/klenwriter/issue/OSR-56) | M0 | Архитектура в Figma/FigJam: модули, потоки и ADR | OSR-57, OSR-58, OSR-59, OSR-60, OSR-61, OSR-62 |
| [OSR-57](https://linear.app/klenwriter/issue/OSR-57) | M0 | ADR: контракт расширений и граница KWDJ-профиля | — |
| [OSR-58](https://linear.app/klenwriter/issue/OSR-58) | M0 | Spike: single editing host против per-block islands | — |
| [OSR-59](https://linear.app/klenwriter/issue/OSR-59) | M0 | ADR: Unicode-позиции, selection mapping и история | — |
| [OSR-60](https://linear.app/klenwriter/issue/OSR-60) | M0 | Инвентаризация CMS: контракты, consumers и parity matrix | — |
| [OSR-61](https://linear.app/klenwriter/issue/OSR-61) | M0 | Протокол performance: baseline и бюджеты редактора | — |
| [OSR-62](https://linear.app/klenwriter/issue/OSR-62) | M0 | Figma: UX-контракт блокового редактора и состояний | — |
| [OSR-63](https://linear.app/klenwriter/issue/OSR-63) | M2 | WASM/TypeScript SDK: lifecycle, revisions и error contract | OSR-34, OSR-35, OSR-36, OSR-37 |
| [OSR-64](https://linear.app/klenwriter/issue/OSR-64) | M2 | Публичное extension API и независимый профиль | OSR-29, OSR-34, OSR-36, OSR-63 |
| [OSR-65](https://linear.app/klenwriter/issue/OSR-65) | M3 | Standalone vanilla API и устанавливаемый alpha-пример | OSR-38, OSR-39, OSR-40, OSR-41, OSR-45, OSR-54, OSR-63, OSR-64, OSR-66, OSR-67 |
| [OSR-66](https://linear.app/klenwriter/issue/OSR-66) | M3 | Доступность, keyboard navigation и локализация | OSR-40, OSR-41, OSR-42, OSR-43, OSR-44 |
| [OSR-67](https://linear.app/klenwriter/issue/OSR-67) | M3 | Безопасность DOM и состояния отказа браузерного SDK | OSR-39, OSR-47, OSR-63 |
| [OSR-68](https://linear.app/klenwriter/issue/OSR-68) | M4 | Host adapters: media, links и reference entities | OSR-35, OSR-50, OSR-63 |
| [OSR-69](https://linear.app/klenwriter/issue/OSR-69) | M5 | CMS save/recovery adapter без экспорта на каждый ввод | OSR-32, OSR-37, OSR-60, OSR-63 |
| [OSR-70](https://linear.app/klenwriter/issue/OSR-70) | M6 | Миграция Angular consumers и rollback drill | OSR-49, OSR-51, OSR-52, OSR-66, OSR-68, OSR-69 |
| [OSR-71](https://linear.app/klenwriter/issue/OSR-71) | M7 | Open Source 1.0: reproducible release и независимая интеграция | OSR-38, OSR-53, OSR-55, OSR-64, OSR-66, OSR-67 |
| [OSR-72](https://linear.app/klenwriter/issue/OSR-72) | M6 | Перевести legacy consumers с Tiptap v2 на новый редактор | OSR-49, OSR-60, OSR-65, OSR-68 |
| [OSR-73](https://linear.app/klenwriter/issue/OSR-73) | Post-v1 | Firefox: gate перехода из experimental в supported после v1 | — |

## Critical acceptance paths

M0 proofs → OSR-56 + OSR-27 → OSR-26 → workspace/name → profile/corpus → session/transactions → SDK. After SDK, DOM/input, profile capabilities and CMS delivery can advance in parallel. Vanilla alpha waits for browser/security/keyboard/performance gates; CMS pilot additionally waits for complete needed KWDJ capability and real save/recovery. Both Angular and Askama cutovers precede deletion of Tiptap; OSS 1.0 waits for that owner-requested project boundary.

OSR-73 has no M0–M7 blocking edge. CJK/mobile/collaboration/real screen-reader support are documented future work and are not disguised as tested v1 capabilities. Scope deferral does not permit silent data loss or an untested supported browser.
