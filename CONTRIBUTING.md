# Разработка

Это bootstrap M1, а не готовый редактор. Следуйте [архитектуре](docs/m0/architecture.md)
и контракту задачи Linear. Реализуйте общую семантику на Rust; KWDJ остаётся отдельным
профилем. CMS, DB, Angular и browser runtime не входят в native core/profile closure.

## Чистая сборка

Нужны Git, публичный доступ к crates.io/npm/Rust toolchain downloads и системные
build tools для Rust. CMS checkout, DB, private registry и секреты не нужны.

1. Установите Node **24.22.0** (CI pin `.node-version`) и npm **11.14.0**.
   Node 26 допускается для разработки, но acceptance lane использует Node 24.
2. Установите rustup. `rust-toolchain.toml` закрепляет Rust **1.97.1**, rustfmt,
   clippy и `wasm32-unknown-unknown`. Release builder использует этот pin; native core/profile дополнительно
   поддерживают Rust **1.89.0** и проверяются на нём в CI.
3. Выполните из корня:

```sh
npm ci --ignore-scripts
cargo install wasm-bindgen-cli --version 0.2.129 --locked --root .tools
PLAYWRIGHT_SKIP_BROWSER_GC=1 npx playwright install chromium firefox webkit
npm run check
npm test
node scripts/summarize-evidence.mjs
```

На macOS 27 Firefox 157 может завершиться до теста из-за обращения к защищённому
каталогу реального Firefox ([upstream #42768](https://github.com/microsoft/playwright/issues/42768)).
Для локальных прогонов можно создать отдельный пустой каталог и передать
`CFFIXED_USER_HOME=/absolute/path/to/test-browser-appdata` только тестовому процессу.
Это изолирует app-data; browser build, CSP и assertions остаются прежними.
CI macOS 15 использует обычный запуск.

Linux дополнительно требует Playwright system dependencies (`npx playwright install --with-deps`).
CI запускается на macOS 15 и выполняет ту же последовательность; OS browser input
проверяется отдельными implementation gates, bootstrap smoke этого не доказывает.

`npm run check` включает fmt/clippy/native tests, independent canonical JS/native
reference vectors (`npm run test:canonical`, [ADR-004](docs/adr/004-canonical-json-v1.md)), native + wasm32 release build,
TypeScript project references, generated web glue, transitive architecture closure,
license/version/MSRV/target/size inventory, упаковку шести private пакетов, установку
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

## Артефакты и ограничения

`artifacts/dependencies.json` содержит зафиксированные direct/transitive версии,
лицензии, заявленные зависимости MSRV, targets, размеры raw/gzip и SHA-256 сборки.
`artifacts/package-inventory.json` и `artifacts/packages/*.tgz` доказывают содержимое
упаковки. `artifacts/browser.json` — результаты Chrome-engine/Firefox/WebKit smoke,
не установленного Safari. CI сохраняет эти файлы вместе с browser evidence.
Lockfiles обязательны; `--locked` запрещает тихое разрешение новых Rust версий.
Reproducible здесь означает чистую сборку одинакового pinned source/toolchain/lock,
а не обещание идентичных native binaries на разных OS/CPU. Rust std/CLI и системный
linker входят в build environment; production size budgets проверит OSR-38.

Все Rust crates имеют `publish = false`, JS packages — `private: true`.
Ни один install/build/check hook не публикует пакеты и не разворачивает CMS.
Имена, package map и version namespaces закреплены [OSR-54](docs/identity.md).
Проверка npm CLI сейчас даёт ENEEDAUTH; publisher authorization не заявляется.
Registry write/проверка фактических прав перед publish — OSR-71.
Нельзя публиковать bootstrap tarballs как alpha. Native codec извлечён в OSR-29;
web packages пока содержат границы и диагностический build identity. Реальные
session/DOM/Angular APIs — будущие задачи.

## Изменения

Ветка по ID задачи; logical commit с ID; PR включает scope, команды проверок и
матрицу AC/evidence. Для standalone и финала эпика нужен один подготовленный CI
run и независимый review точного SHA, затем merge и успешный post-merge CI.
Повтор CI — после относящегося к ошибке исправления. Не ставьте Done по одному
локальному тесту. Rollback bootstrap: revert PR; persisted documents не меняются.

Dependency updates меняют manifest + lock + dependency evidence вместе. Новая
runtime dependency требует основания из ADR; Angular только в binding, parse5
только после clipboard browser proof, test/generation tools не в browser runtime.
Перед переносом CMS исходников/fixtures нужны per-file provenance и сохранение
notices; пользовательские документы/секреты не входят в grant владельца.
Пакеты включают точную копию `provenance/source-files.json`. После отдельной
проверки изменения owner grant выполните `npm run sync:provenance`; metadata lint
отказывает при stale копии или расхождении лицензий с корнем.
