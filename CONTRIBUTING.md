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

`npm run check` включает fmt/clippy/native tests, native + wasm32 release build,
TypeScript project references, generated web glue, transitive architecture closure,
license/version/MSRV/target/size inventory, упаковку шести private пакетов, установку
их tarballs во внешний временный проект и WASM smoke во всех трёх движках, затем
существующие M0 contract/artifact/performance-integrity checks.
`npm test` сохраняет 102 browser scenarios M0 spike отдельно от workspace smoke.

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
