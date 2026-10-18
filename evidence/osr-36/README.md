# OSR-36 — exact Session history

Локальная поставка headless history следует [принятому execution contract](execution-contract.md)
и [native API/retention contract](../../docs/history.md). Base перед реализацией:
`e31707f6573fb6f2164a5c2e025df5b92d542b39`. Точная delivery source revision,
prepared CI, independent verdict и merge фиксируются в Linear/PR. Здесь записаны
реальные local gates и hash-bound inputs; base HEAD не выдаётся за содержимое
проверенной в тот момент uncommitted worktree.

## Acceptance matrix

| Исходный AC | Реальная проверка и артефакт |
| --- | --- |
| 1. Apply → undo возвращает canonical doc и selection; redo тот же результат | [29 KWDJ literals](../../contracts/history/v1/vectors.json), generic ADR16 (15 direct + один declared structural embedding с отдельным full physical oracle), все operational families и normalization-owned effects. Exact bytes, typed selection/direction/affinity, stored marks, historical IDs. [History report](history-report.json); private tree replay tests. |
| 2. IME commit, paste, DnD и typography имеют предусмотренные units | H11–H14 — реальные атомарные model transactions, H15 slash compound, H04 typing group, H05–H08 navigation/marks/inherit/plain/redo. Runtime adapters и настоящий OS input проверяются в OSR-41/44/47/48. |
| 3. Refused/noop не создаёт ложную запись; новая branch удаляет redo | H09/H10/H21/H24, HistoryEpoch-only stale request, duplicate boundary и identical typed selection. Полный query/execute с одинаковыми error/work; actual mutable KWDJ Missing/Unavailable identity facts, same-request retry для undo и redo. Private HP Err/rewrite, NotNormal и validator retry проверяются отдельно. |
| 4. Детерминированные barriers/memory limits/remount policy | H20–H22, member cap2 seal/start, cap0 refusal vs positive cap1 Stale maps при сохранённом replay, complete-unit/furthest-redo eviction, actual unique Arc ownership и fixed ring allocation. Known staging+final-copy bound до admission/coalescing; один meter на всю group. Failed/successful remount и closed/poisoned/read-only guards. |

Поверх literal cases исполняются 32 seeded sequences по 6–10 isolated Type/Enter
actions: 255 edits, 255 undo, 255 redo и **797 независимых canonical/caret
checkpoints**. Pure paragraph/string oracle строится до работы Session. Opaque
IDs сравниваются как historical identity invariant. Ещё восемь literal Unicode
pairs проверяют SPACE/NBSP, decomposed/non-BMP/ZWJ без нормализации текста.

512 actual KWDJ edit → undo → redo cycles дают **1536 publications**. Action/map
caps равны1; каждая операция укладывается в32 KiB work. После двух initial
ownership состояний 510 steady cycles сравнивают actual work/retained bytes
отдельно по трём фазам. Это bounded recurrence, не OSR-38 performance acceptance.
Отдельный inherited transaction witness проверяет512 commits с1map/1action,
двумя warmup commits и510 steady commits; историческое OSR-34 evidence не менялось.

## Выполненные local gates

| Команда | Фактический результат |
| --- | --- |
| `npm run check` | PASS: fmt/clippy, **236 Rust tests с doctests**, canonical/codec/corpus/session/transactions/commands/history native+WASM, metadata/architecture,6 private tarballs/external consumers, M0 integrity/perf integrity, **12 browser smoke tests**. |
| `cargo +1.89.0 test --locked -p klenwriter-editor-core -p klenwriter-editor-kwdj` | PASS: **103 с doctests**,40 source-file hashes проверены после выполнения. |
| `npm test` | **102/102 PASS**,0 harness failures. |
| `node scripts/summarize-evidence.mjs` |102 observations: **28 MET /26 GAP /48 OBSERVATION**. Это M0 observations, не утверждение о выполнении всех editor requirements. |

Node24.22.0/npm11.14.0, Rust1.97.1, macOS27.0.1. Firefox использовал отдельный
app-data каталог согласно CONTRIBUTING. Harness/WebKit не выдаётся за installed
Safari/OS IME acceptance.

[Local verification](local-verification.json) содержит raw/gzip log hashes,
91 исходный source closure hash, точные report hashes и scoped counts.
[MSRV receipt](msrv-receipt.json) и [focused receipt](focused-implementation-receipt.json)
сохраняют соответствующие lanes. Shared history report содержит64 hashes:
63 source files + actual WASM binary. Все hashes сверены после full gate.
Native/WASM и повторный WASM совпали по portable observations; target-local
work/retained byte diagnostics не выданы за portable constants или RSS.

Три private H23 counter tests и шесть private profile-gate tests реально прошли
в Rust lane; это **не выполнение private fixtures в WASM** и не публичный setter.
Known-cost group test задаёт один target-local Q: каждый отдельный member fits,
сумма staging всей группы превышает Q, полная group atomically refuses; после
увеличения бюджета literal undo/redo проходит. Oracle documents не берутся из
replay output.

## Артефакты и provenance

- [History report](history-report.json), [command report](command-report.json),
  [transaction report](transaction-report.json), [foundation report](session-foundation-report.json).
- [Raw M0 observations, gzip](automated/observations.json.gz):3,253,668 raw bytes;
  SHA256 raw `6a46c2fec3b2aa1ee92a14a491af3c3c08d0fd9298e63aa86af93ca29cdebd13`.
  Gzip/size/summary проверены в local receipt. Frozen OSR-58 восстановлен побайтно
  с SHA256 `d26e6d92decfc48e7663b6489ea2cef7f5a6ec4bbfd683b59acd34768fa4f79a`.
- [Manifest](../../contracts/history/v1/manifest.json) фиксирует unchanged ADR source,
  accepted contract, embedding и provenance независимых drafts. Их fixture
  curations (supported strike, public baseline revision0 и initial selection
  context) названы явно; raw drafts сохранены. Ни одна oracle не переписана из
  фактического replay output.
- [Implementation/regression notes](implementation-notes.md) и compressed direct
  logs в `logs/` сохраняют проверяемые ограничения provenance.

CI и независимый exact-SHA Grok review — отдельные обязательные delivery gates.
Они не подменяются этим local receipt или supporting Codex audits.
