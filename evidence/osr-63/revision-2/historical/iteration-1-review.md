## Review · Grok · request changes (2026-10-18)

Независимый review, сессия `ed5c2eb6-b68e-4e03-a5cb-f24361333599`. Код OSR-63 эта сессия не писала. Linear MCP в раннере нет (подключён только safari-mcp): карточка и оба комментария прочитаны из полных raw snapshots `issue.md` / `comments.md` / `comments.json` пакета. Это fallback, не live Linear readback и не запись в Linear.

Проверено до verdict: ветка `osr-63`, HEAD `8f09e211badfcf5fe7e7d1403f9bff465352ff0a`, дерево чистое, совпадает с `origin/osr-63`. Live PR https://github.com/artemklen/klenwriter-editor/pull/17 открыт, base `62a52bb054b09f0e850762124b53229e2b195d14`, head тот же `8f09e211badfcf5fe7e7d1403f9bff465352ff0a`. ci_mode standalone, ci_owner none. Контракт `evidence/osr-63/execution-contract.md` SHA256 `17c4e170d98e34f1ae9ce4c9199c37196360d1d8c240cee4ed883ddce06485bf`.

Prepared CI run `39121355551`, attempt 1, event `pull_request`, conclusion success, job `workspace-and-browser`. Raw log: checkout `3274f7af435ff3678ad16202783c5873c36ad647` — `Merge 8f09e211badfcf5fe7e7d1403f9bff465352ff0a into 62a52bb054b09f0e850762124b53229e2b195d14`. Отдельный fetch этого commit без переключения дерева: родители ровно base, затем source; tree `1b37b568231368e1b74df1ea4938149f2c240bd4` равен tree source. Log 317449 bytes, SHA256 `e3fe34dd2187fb34ae1cc86037fed214752dae5a018792ad5324a9da94b2e313`. Artifact `12134771096`, expiry `2026-11-01T11:09:31Z`. ZIP 133483424 bytes, 708 entries, SHA256 `c7848d8872e8be4179755ad69279ec6791472729be96575a319fc7eb8d2c61ff`, чтение entries без CRC-ошибки. Receipt SHA256 `5e6d8cec8d598c61c479aed69e5dabcc8e27aee9f270ffc7c8806929289d1073`. Полный suite заново не запускался.

| Contract | Evidence | Status |
|---|---|---|
| AC1 init/load/mismatch/destroy-before-init/double destroy | `packages/wasm/src/sdk.ts` проверяет seal до import/init glue; wrong-module до init сбрасывает cache. `EditorController.#initialize` не оживляет destroyed controller. Rust `Session::remount` подменяет состояние только после полного admit. | pass |
| AC2 generation/revision/stale callbacks | `stamp_check` сверяет token и decimal generation/revision/epochs. Queued payload не переписывается. `completeHostRequest` и смена generation отменяют старый request. | pass |
| AC3 types/runtime, structured errors, callbacks cannot reenter unsafely | Generated DTO и envelope checker согласованы с serde `deny_unknown_fields` и required null. Прямой post-commit non-JSON на самом `call` становится Fatal/`may_have_committed`. Read/query внутри listener fence после уже опубликованного commit помечает этот commit как Refused. | fail |
| AC4 npm без Rust, CSP, повторный mount не копит handles | CI log содержит clean-consumer и Playwright Chromium/Firefox/WebKit install; suite зелёный. Этот дефект их не отменяет и не заменяет. Installed Safari/AT/IME/CMS не заявлены. | pass, вне blocker |
| Profile/extension до document decode; engine/core без KWDJ | `BridgeSession::open` вызывает `ensure_matches` до `Session::open`. `crates/engine` и `crates/core` не импортируют KWDJ/browser. | pass |
| Opaque token, retired id без live read | `token_fields` проверяет version/length/nonzero/decimal. `parse_node_token` не даёт liveness; `node_at` режет retired id через tree. Ever-seen registry нет. | pass |
| Caps, stale save, explicit reconcile | 32 handles / 32MiB / native 16MiB до insert. Ack r при текущем r+1 оставляет dirty. Reconcile только exact bytes. | pass |
| Noop/query не зовут listeners; state-only не двигает revision | Query идёт в `#readonly`. Пустой event batch не вызывает listeners. `publish_prepared` без document change не увеличивает revision. | pass |

Blocking: 1.

1. `packages/sdk/src/controller.ts`, `#deliver` после listener вызывает `#unavailable()`, если lifecycle уже не `ready`. `#readonly` → `#wire(..., mutation=false)` при throw вызывает `#fatal(code, false)`, то есть Fatal с `may_have_committed: false`, и `#dispose('fatal')`. `#execute` подменяет уже успешный mutation response этим результатом. `#unavailable` строит `status: "refused"`, code `sdk.fatal`, `may_have_committed: false`, category `sdk`.

Trigger: listener на post-commit fence делает разрешённый `readAt(r)` или `query`, и native call бросает trap/transport exception либо возвращает fatal. Контракт и `docs/sdk-v1.md`: Refused значит, что native publication не было; trap или transport failure после commit — Fatal с `may_have_committed`; ошибка callback не переименовывает edit. Следствие: хост видит атомарный отказ и может слепо повторить уже опубликованную правку. Сессия при этом освобождается (`destroy`/`free`), утечки handles в repro нет.

Focused repro на `packages/sdk/dist` и controlled fake, репозиторий не менялся. После commit revision `1` listener `read({kind:'state'})` бросает `WebAssembly.RuntimeError`. Submit: `status "refused"`, code `sdk.fatal`, `may_have_committed false`, stamp revision уже `"1"`. Read самого listener: `status "fatal"`, code `sdk.transport_failure`, `may_have_committed false`. Lifecycle `fatal`. Повторный submit тоже Refused с `may_have_committed false`. Существующий controller test `fixture.transport_failure` ломает JSON самого mutation `call` и этот путь не видит, поэтому остаётся зелёным. Это дыра продукта, не ложный oracle fake.

Нужно: если fence уже после успешной publication и read/query/trap переводит controller в fatal, ticket этого edit завершается как Fatal с `may_have_committed: true`. Не Refused. Regression на read и query внутри listener, отдельно от non-JSON ответа самого command call.

Non-blocking: 1.

1. Remount передаёт документ строкой внутри JSON request с потолком 16MiB, тем же, что и native document ceiling. Документ ровно на потолке не проходит `ownData` и до Rust remount не доходит; старая Session сохраняется, ответ — typed refusal. Это безопасный отказ, не порча generation. Имеет смысл явно записать пересечение потолков в `docs/sdk-v1.md`.

Suggestion: 1.

1. `packages/kwdj/src/index.ts` `kwdjCommand` вызывает `JSON.stringify` до `ownData`. Getter/`toJSON` на intent выполняются в helper, хотя controller submit сам accessors не вызывает. Для недоверенного intent helper стоит собирать payload тем же plain-data копированием.

Controlled fake (`tests/helpers/sdk-fake.mjs`) для `update_facts` возвращает `released`, а cursor событий — `generation/sequence`, не decimal. Это не создало зелёный прогон blocker-а и не заменяет packaged native/WASM lane. Отдельно от закрытого DTO дефекта не найдено: required null и `deny_unknown_fields` на wire сохранены.

Следующий шаг: вернуть OSR-63 в In Progress. Close выполняет implementer. Статус Linear эта сессия не меняла: MCP недоступен.

review · reviewer · OSR-63 · In Progress двигает implementer
VERDICT: request changes
