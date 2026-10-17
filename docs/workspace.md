# Workspace M1 / OSR-28

Статус: автономная build foundation. API/codecs/editor semantics появятся в своих
задачах; `0.0.0` и private names не являются публичной совместимостью или alpha.

| Пакет | Владелец ответственности | Прямая внутренняя зависимость |
| --- | --- | --- |
| `crates/core` | Generic document kernel | — |
| `crates/engine` | Sessions/transactions/history | core |
| `crates/kwdj` | KWDJ profile/codec | core |
| `crates/wasm` | Matching WASM distribution | core, engine, kwdj |
| `packages/wasm` | Prebuilt web artifact + glue | compiled Rust bridge |
| `packages/sdk` | Future typed lifecycle SDK | wasm |
| `packages/dom` | DOM/input adapter + static CSS | sdk |
| `packages/vanilla` | Framework-free binding | dom |
| `packages/angular` | Angular binding boundary | vanilla |
| `packages/kwdj` | Host-facing profile boundary | sdk |

Engine не импортирует KWDJ. WASM distribution связывает профиль с generic engine;
это допустимый composition root. Core/profile можно использовать native из другого
Cargo проекта по source path/git pin; public registry packages появятся после OSR-54/71.
Angular runtime/peer пока не добавлен: binding implementation и version matrix — OSR-49.
`contracts/kwdj/v1` не наполнен фиктивными данными; authoritative corpus ещё в CMS.

## Зависимости

Exact direct versions находятся в `Cargo.toml`/`package.json`, transitive versions
и integrity — в `Cargo.lock`/`package-lock.json`. `npm run check:workspace` генерирует
полный report из Cargo metadata/lock и package-lock, проверяет public sources и
native dependency closure и фиксирует фактические raw/gzip/SHA-256 артефактов.
Плановые зависимости отдельно помечены не установленными: unicode-segmentation,
parse5, ts-rs, Angular и property/fuzz/benchmark tooling подключаются там, где нужны.
`wasm-bindgen-cli` закреплён тем же exact version, что Rust ABI crate, и устанавливается
с upstream `--locked`; это build tool, не импорт DOM runtime.

Оригинальный код лицензирован MIT OR Apache-2.0; root/crate/npm LICENSE и NOTICE
входят в source/distributable layout. Runtime dependency notices генерируются при
сборке и включаются в WASM package. Никакой CMS код не скопирован в OSR-28.
Выбранная схема workspace опирается на [Cargo workspaces](https://doc.rust-lang.org/cargo/reference/workspaces.html),
web glue — на [wasm-bindgen deployment](https://wasm-bindgen.github.io/wasm-bindgen/reference/deployment.html).

## Чеки и доставка

Команды чистой сборки и interpretation evidence — [CONTRIBUTING](../CONTRIBUTING.md).
CI использует pinned Node/Rust/CLI, запускает весь bootstrap и M0 regression suite,
публикует только CI artifacts. Revert PR возвращает исходный M0 layout.
