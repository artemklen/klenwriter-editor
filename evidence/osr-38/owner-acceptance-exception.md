# OSR-38 — owner acceptance exception

Дата решения: **19.10.2026, Europe/Moscow**. Основание — явное указание владельца, дословно:

> Зафиксируй пропущенный шаг, закрой задачу, смержи и продолжай цель

Владелец разрешил закрыть OSR-38 с явно записанными исключениями ниже. Это **owner acceptance exception**, а не утверждение о выполнении всех первоначальных AC или успешном performance comparison. До записи окончательного статуса сохраняются обычные delivery gates.

## Что не выполнено или остаётся inconclusive

- **AC3:** ранее остановленный дополнительный блок не выполнялся. Его результат отсутствует; выполненные ordinary replay/shrinker/recorder checks не выдаются за доказательство этого блока.
- **AC4:** один полный corrected reference capture завершился actual exit0:410 launches,1 040 runs,208 cases. Current raw integrity valid:470 raw files/66 logical requests проверены исходными validators. Однако все104 time cases имеют CV>0.1;104 resource cases стабильны. Полный performance результат noisy/inconclusive. Единственный floor-helper invocation завершился exit1; floor draft/policy/adoption отсутствуют, candidate timing и conclusive comparison не проводились. Ни скорость, ни regression-free performance не доказаны.
- **Historical auxiliary witness:** сохранён Notes capacity report SHA256 `90f85d395b74f83e19e0270628fd298aa451f6dc6e64ef16361874b5d2430fcf`, но exact historical debug executable32 880 032 B / SHA256 `5f1a10b2b2f1963407a6c8afc14bcf101ef1ea29066f8f1875525cd5801685dc` не найден в описанном lookup scope. Current raw validity и этот gap — разные scopes. V4 audit actual exit1 фиксирует historical witness incomplete; текущий shared target и release binaries не подставляются вместо него.

## Граница исключения

Закрытие38 разрешено владельцем **с этими ограничениями**, а не посредством замены исходных AC на passed. Исходные требования, noisy raw, stopped scope, failed/helper/operator history и отсутствие witness сохраняются. Запись не меняет measurement floors, production limits или persisted/API contracts и не является автоматическим waiver для будущих **OSR-71/OSR-80** либо иных release/acceptance gates. Их собственные критерии остаются обязательными; это решение не доказывает их выполнение и не разрешает publish/deploy.

**Обычные CI и delivery gates сохраняются:** applicable checks, prepared CI на точном SHA, независимый full-scope review с явным раскрытием exception, normal exact-head merge, успешный post-merge CI, evidence preservation, cleanup и фактический closing/readback. Указание владельца не подменяет эти результаты. Эта запись не объявляет review/merge/close уже завершёнными.

## Уже существующие источники

- Capture completion `/tmp/osr-38-perf-reference-calibration-phased-1.completion.json`, SHA256 `01b1116c07d4eec4b92375461939fb31af5a5f4f99a379c78e7c2cff1dc14d64`.
- V4 integrity report `/tmp/osr-38-calibration-integrity-phased-1-v4.json`, SHA256 `089ed9ebd5f2fd5112a372ed0440258e07dc512ae5754984401b4d3cab1afe44`; actual-exit SHA256 `9d1f33085e4fa8541e17b88eac6473a8747d74a444150534d04eafec7e717d41`.
- Durable checkpoint `/Users/artem/projects/.evidence-archives/editor-wasm/osr-38/calibration-phased-b163-quality-rejected/receipt.json`, SHA256 `4440462a74c134b19d35f62bac64fb3b6384811fda57efeeadf9c5b6cba92a1b`; ZIP SHA256 `74ad363dbdb90c4d65b70936e222cef91f09ca44bd950ab1d91123c15c7067ad`.

Подготовка этой записи не включала новые проверки, измерения, поиски binary или изменения репозитория.

## Актуальный delivery mode

Перед поставкой включён upstream `6f6f2a2391499256beef62fdc33a2311f1762a0d` (OPS-632/PR19). По его AGENTS.md и CONTRIBUTING.md тесты выполняются локально на exact отправляемом SHA, CI — только build (`npm ci --ignore-scripts`, `npm run build`). Старый CI test step из ветки38 не восстанавливается. Один prepared build CI и один post-merge build CI сохраняются; зелёная сборка не объявляется выполнением тестов или пропущенных AC.
