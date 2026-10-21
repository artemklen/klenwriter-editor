# Разработка

Это библиотека с headless Session SDK и [basic mounted DOM adapter](docs/dom.md).
[Mounted selection](docs/selection.md), bookmarks, edge autoscroll и минимальные
plaintext copy/cut реализованы поверх SDK2. [Composition41](docs/composition.md)
добавляет bounded settlement и retained recovery; browser/installed приёмка
подтверждается отдельными exact-source receipts. Необязательный [block chrome42](docs/ui.md)
добавляет toolbar/move/host dialogs и optional slash/insertion picker43.
`npm run test:slash` проверяет frozen contracts, native/sealed semantic literals,
bounded text-window reads и controlled/public types; slash browser cases входят
в существующий `test:ui:browser`. [Block drag44](docs/drag.md) добавляет optional
pointer handle поверх того же native Move и клавиатурного меню. `npm run test:drag`
проверяет native/sealed semantics и controlled owner/types; `test:drag:browser`
проверяет mounted geometry, pointer и lifecycle во всех трёх движках.
Clipboard47, полная a11y66 и vanilla alpha сохраняют отдельные
задачи и acceptance gates.
`npm run test:mounted-corpus` добавляет [mounted corpus45](docs/mounted-corpus.md):
независимые source literals, три browser engines, original public receipts,
save/destroy/fresh reopen и отдельные integrity/requirement результаты. Lane
входит в локальный `npm run check`; installed/native и ручные наблюдения
сохраняют собственные обязательные acceptance gates.
Следуйте [архитектуре](docs/m0/architecture.md)
и контракту задачи Linear. Реализуйте общую семантику на Rust; KWDJ остаётся отдельным
профилем. CMS, DB, Angular и browser runtime не входят в native core/profile closure.

## Чистая сборка

Нужны Git, публичный доступ к crates.io/npm/Rust toolchain downloads и системные
build tools для Rust. CMS checkout, DB, private registry и секреты не нужны.

Для локальных Playwright checks на macOS используйте свежий каталог данных
приложения в child environment: `CFFIXED_USER_HOME` указывает на отдельный
task-owned `browser-appdata`, `TMPDIR` — на отдельный каталог в `/private/tmp`.
Так запускался принятый OSR-43 gate; без отдельного appdata Firefox может
завершиться до открытия страницы с `Could not find profile folder`.
Это окружение только браузерных checks. Installed input helpers используют
реальное пользовательское окружение, чтобы сохранить существующие grants.

1. Установите Node **24.22.0** (CI pin `.node-version`) и npm **11.14.0**.
   Node 26 допускается для разработки, но acceptance lane использует Node 24.
2. Установите rustup. `rust-toolchain.toml` закрепляет Rust **1.97.1**, rustfmt,
   clippy и `wasm32-unknown-unknown`. Release builder использует этот pin; native core/profile дополнительно
   поддерживают Rust **1.89.0** и проверяются на нём локально перед отправкой.
3. Выполните из корня:

```sh
npm ci --ignore-scripts
cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
npm run check
node scripts/reliability/check.mjs
npm test
node scripts/summarize-evidence.mjs
```

На macOS 27 Firefox 157 может завершиться до теста из-за обращения к защищённому
каталогу реального Firefox ([upstream #42768](https://github.com/microsoft/playwright/issues/42768)).
Для локальных прогонов можно создать отдельный пустой каталог и передать
`CFFIXED_USER_HOME=/absolute/path/to/test-browser-appdata` только тестовому процессу.
Это изолирует app-data; browser build, CSP и assertions остаются прежними.
Локальный macOS 15 использует обычный запуск.

Linux дополнительно требует Playwright system dependencies (`npx playwright install --with-deps`).

## Локальный pre-send gate (OPS-625)

Агент обязан выполнить команды выше на точной отправляемой ревизии и записать
команды, результаты, окружение и `git rev-parse HEAD`. CI (`.github/workflows/spike.yml`)
выполняет только `npm ci --ignore-scripts` и `npm run build`; Rust/npm/Playwright/check
tests и test-evidence upload из CI удалены.

Недоступный browser/Playwright, Rust toolchain или npm registry — blocker в Linear,
не silent skip и не повод вернуть тесты в CI. Meaningful code change аннулирует
соответствующее evidence; неизменённый SHA можно не перепроверять. Тесты и assertions
не удалять и не ослаблять; новых тестов ради галочки не добавлять.

`npm run check` включает fmt/clippy/native tests, independent canonical JS/native
reference vectors (`npm run test:canonical`, [ADR-004](docs/adr/004-canonical-json-v1.md)), native + wasm32 release build,
TypeScript project references, generated web glue, transitive architecture closure,
license/version/MSRV/target/size inventory, упаковку семи private пакетов, установку
их tarballs во внешний временный проект и WASM smoke во всех трёх движках, затем
существующие M0 contract/artifact/performance-integrity checks.
`npm test` сохраняет 102 browser scenarios M0 spike отдельно от workspace smoke.

`npm run test:codec` после build запускает настоящий Node/WASM codec ABI v1
против native на versioned corpus: 60 codec inputs / 180 comparisons,
typed admission/identity/u64 boundaries. Lane включён в `npm run check`;
[контракт](docs/codec-v1.md) отделяет 1 deferred и 5 no-candidate cases и
неисполняемые non-codec stages от pass. `npm run test:corpus` проверяет package
integrity, baseline/additive rules и stage-aware native/WASM projections;
публикует отдельные hardening/extension reports и data-only bundle. Единственный
источник — `contracts/kwdj/v1`; CMS использует immutable artifact с pin/hash.

`npm run test:session` после build исполняет shared native/compiled-WASM witness
на настоящем Rust `Session<KwdjProfile>`, отдельно от distributable codec ABI.
Lane входит в `npm run check`; source/artifact hashes и target comparison —
`artifacts/session-foundation-report.json`. Rust unit/integration tests проверяют
Unicode, mapping, identity, lifecycle и bounded preparation. [Контракт OSR-33](docs/session-foundation.md)
отделяет эту foundation от последующих задач.

`npm run test:transactions` проверяет атомарный Rust dispatch на native и compiled
WASM с настоящим KWDJ-профилем: содержимое, metadata, normalization maps, selection,
owned journal и typed refusals. Lane входит в `npm run check`, сохраняет
`artifacts/transaction-report.json`; [контракт OSR-34](docs/atomic-transactions.md)
описывает лимиты и publication gate. User-facing undo/grouping и typed SDK
выполняются в OSR-36/63.

`npm run test:commands` сравнивает настоящий KWDJ command/capability prepare и
execute на native/compiled WASM с независимыми literal vectors, future typing,
Unicode и отказами. Lane входит в `npm run check`; report с hashes —
`artifacts/command-report.json`. [Контракт OSR-35](docs/commands.md) и
[baseline disposition](docs/command-parity.md) отделяют headless доказательства
от будущих mounted/SDK/host gates.

`npm run test:history` после build сравнивает actual native/compiled-WASM history
на независимых литералах и generated sequences. Headless replay, grouping,
границы памяти и query/execute проверяются на Session с KWDJ и generic profile;
счётчики u64::MAX проверяются отдельным private engine fixture без публичного
setter. Report — `artifacts/history-report.json`, контракт —
[OSR-36](docs/history.md). Browser history/input adapters остаются отдельными gates.

`npm run test:deltas` проверяет actual native/compiled-WASM dirty impact, ordered
events, guarded reads, snapshot/save receipts и scoped KWDJ phase counters.
Report — `artifacts/deltas-report.json`; [контракт OSR-37](docs/deltas.md) описывает
bounded delivery и отдельные JS callback/host gates63/69. Generic opaque profiles
сохраняют явно измеренный full fallback; local-work proof относится к KWDJ.
Native optimized/full Session tests отдельно сравнивают32 mixed sequences и
1312 canonical/stat/revision checkpoints с полным authoritative control.

`npm run test:sdk` проверяет public Session ABI `editor-sdk/1`: native/compiled
WASM literal lane, реальный packaged lifecycle/event queue и отдельные явно
помеченные controlled controller/loader tests. `npm run check:sdk-types` сверяет
generated TypeScript с Rust DTO; генератор — native-only optional build dependency,
не runtime. [SDK contract](docs/sdk-v1.md) описывает exact build negotiation,
lossless transport, bounded callbacks/snapshot handles и fatal-after-commit.
Чистый JS consumer и отдельный strict-CSP SDK host используют prebuilt packages.

`npm run test:extensions` проверяет явный SDK2, frozen runtime registry и отдельные
notes-only/KWDJ-only native/WASM consumers через публичные crates. D0/D1,
53 notes codec literals,18 команд и JSON recipe используют настоящий Session;
[руководство автора](docs/extensions.md) описывает границы и test kit.
SDK1 и его36 DTO сохраняются; SDK2 выбирается явно. Rust1.89 дополнительно
проверяет normal closures registry/protocol/notes/extensions; engine/adapters
и основной builder используют1.97.1.

`node scripts/reliability/check.mjs` выполняет отдельную ordinary reliability
lane после build: независимый finite model, reducer/comparator checks,
native public-API replay и actual packaged SDK, границы лимитов и dependency
inventory. Она входит в локальный pre-send gate; [контракт и команды](docs/reliability.md)
описывают source/build pins и отдельные performance measurements.

`npm run test:dom` сохраняет basic39 renderer/input, bounded reconciliation и
recovery assertions. `npm run test:selection` после build проверяет неизменность
pre-candidate selection contracts, native/compiled-WASM comparator, отдельные
Node suites и mounted browser cases во всех трёх configured engines. Controlled
SDK/platform tests явно отделены от настоящих Rust/WASM/browser путей. Lane входит
в `npm run check`; [руководство](docs/selection.md) описывает API, границы и
отдельный installed Chrome/Safari EN/RU протокол. Команды native39 в
[DOM guide](docs/dom.md#installed-native-input-на-macos) остаются foundation,
а не доказательством новых selection40 сценариев. До фактического выполнения
протокола никакой native40 pass не подразумевается.

`npm run test:composition` после coherent build объединяет pinned contract/data
check, actual native/sealed-WASM comparator, отдельно помеченные controlled Node
owner/transport suites и mounted browser cases. Отдельные команды —
`check:composition-contract`, `test:composition:native`, `test:composition:unit`
и `test:composition:browser`. Lane входит в `npm run check`; физический installed
протокол автоматически не запускается. [Composition guide](docs/composition.md)
описывает original native ticket, exactly-once history, recovery ownership,
границы и отдельные 24 Chrome/Safari EN/RU/dead-key rows. Frozen v1 сохраняется;
resolved DOM data применяет только явно pinned authoring erratum 001. Наличие
реализации/протокола не является browser/native acceptance PASS.

`npm run fuzz:bounded` (четыре 60-секундных libFuzzer-таргета, лимит job 20 минут)
выполняет coverage-guided fuzz lane OSR-38 AC3 после `npm run build`:
отдельный `tests/fixtures/fuzz-native` workspace на pinned
`nightly-2026-10-17` + `cargo-fuzz 0.13.2`/`libfuzzer-sys 0.4.13` (ставятся в
`.tools`), explicit locked fetch → offline build, corpus regression replay и
replay сохранённых байт через actual packaged WASM/SDK под внешним process
watchdog. `npm run fuzz:long` (4×900 секунд, лимит 90 минут) — отдельный
долгий прогон той же lane; его фактическое завершение обязательно для
long-конфигурации, настроенный schedule сам по себе evidence не является.
[Контракт и границы](docs/reliability-fuzz.md).

## Артефакты и ограничения

`artifacts/dependencies.json` содержит зафиксированные direct/transitive версии,
лицензии, заявленные зависимости MSRV, targets, размеры raw/gzip и SHA-256 сборки.
`artifacts/package-inventory.json` и `artifacts/packages/*.tgz` доказывают содержимое
упаковки. `artifacts/browser.json` — результаты Chrome-engine/Firefox/WebKit smoke,
не установленного Safari. Локальные прогоны сохраняют browser evidence отдельно
от build-артефактов CI.
Lockfiles обязательны; `--locked` запрещает тихое разрешение новых Rust версий.
Reproducible здесь означает чистую сборку одинакового pinned source/toolchain/lock,
а не обещание идентичных native binaries на разных OS/CPU. Rust std/CLI и системный
linker входят в build environment; performance regression проверяет OSR-38,
а production bundle budget — OSR-80.

Все Rust crates имеют `publish = false`, JS packages — `private: true`.
Ни один install/build/check hook не публикует пакеты и не разворачивает CMS.
Имена, package map и version namespaces закреплены [OSR-54](docs/identity.md).
Фактическая publisher authorization и registry write проверяются заново
непосредственно перед publish в OSR-71.
Нельзя публиковать bootstrap tarballs как alpha. Native codec извлечён в OSR-29;
WASM/SDK предоставляют headless Session ABI1 и явно выбираемый ABI2. Basic DOM mount39
и selection40 используют тот же SDK2 owner; полный vanilla/Angular
alpha остаётся отдельными задачами; пакеты пока не являются alpha release.

## Изменения

Ветка по ID задачи (`ops-625` для эпика OPS-625); logical commit с ID; PR включает
scope, локальные команды проверок и матрицу AC/evidence. Локальные тесты обязательны
на exact SHA до отправки; независимый review точного SHA и merge сохраняются. CI
даёт build-артефакт, а не test-гейт. Повтор CI — после относящегося к ошибке
исправления. Не ставьте Done по одному локальному тесту. Rollback bootstrap:
revert PR; persisted documents не меняются.

Dependency updates меняют manifest + lock + dependency evidence вместе. Новая
runtime dependency требует основания из ADR; Angular только в binding, parse5
только после clipboard browser proof, test/generation tools не в browser runtime.
Перед переносом CMS исходников/fixtures нужны per-file provenance и сохранение
notices; пользовательские документы/секреты не входят в grant владельца.
Пакеты включают точную копию `provenance/source-files.json`. После отдельной
проверки изменения owner grant выполните `npm run sync:provenance`; metadata lint
отказывает при stale копии или расхождении лицензий с корнем.
