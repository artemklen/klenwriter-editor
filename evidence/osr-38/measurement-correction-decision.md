# OSR-38: исправление измерительного harness до нового reference

Решение primary implementer от 18.10.2026 под техническим делегированием
OSR-26. Это обратимые изменения test-only harness; production API, данные и
принятые guards не меняются. Новая калибровка этим документом не запускается.

Первый полный reference на принятом OSR-64 завершил все 410 запусков с exit 0.
Отдельная проверка целостности прошла для 208 cases и 1 040 runs. Однако 102
cases имеют конечный CV >10%, поэтому весь reference непригоден для принятия
floors. Полная связь с raw, actual exits и двумя durable архивами сохранена в
`calibration-quality-checkpoint.json`. Старые исходники и результаты остаются
историческими; они не становятся измерением исправленного harness.

## Форматирование успешного ответа

В исходном `perf-sdk-child.mjs` helper `ok` передавал
`JSON.stringify(response)` третьим аргументом `assert.equal` при каждом вызове.
JavaScript вычисляет аргумент и при успешном assertion. Helper вызывается
внутри timed command/export/lifecycle sections. Это добавляет диагностическое
форматирование, включая canonical snapshot, к измеряемой операции.

Решение: формировать описание ответа только при ошибочном status. Проверка
status и возвращаемое value сохраняются; обязательная сериализация самого
production bridge остаётся частью соответствующего слоя. Отдельная проверка
успешного ответа с недопустимым для сериализации diagnostic payload должна
показать, что success path его не форматирует. Это дефект harness, а не
обнаруженная ошибка production engine и не доказательство ускорения SDK.

## Отдельная фаза allocator

Исходное расписание выполняло в каждом круге 70 обычных запусков и затем 12
DHAT-запусков. Поэтому перед timing round 0 и последующими timing rounds
различалась история работы profiler. В сохранённых данных round 0 имеет
минимальную наблюдённую per-case run statistic в 100 из 104 timing cases.
Причина этого сдвига не установлена; 59 cases
остаются шумными даже в диагностике только rounds 1–4.

Решение: явно закрепить две последовательные фазы — все timing rounds,
затем все allocator rounds. Оба слоя по-прежнему выполняют все пять кругов,
каждый case остаётся в плане. Порядок baseline/candidate AB/BA внутри круга,
полные 410 reference launches / 208 cases, 200 samples и 64 warmups,
process-scalar definitions и исходные CV/timer/integrity guards сохраняются.
Описание расписания и фактические launch bindings должны быть sealed;
проверка обязана выявлять пропуск, дубликат, неверную фазу или порядок.

Это исключает DHAT-запуски между timing-кругами в пределах данного capture.
Внешняя и предшествующая история host этим не выравнивается. Решение не
доказывает, что profiler был причиной шума или что на этом target следующий
batch будет стабильным. Обычная фаза сохраняет также cold-startup,
WASM capacity и RSS measurements: разделяются launches, а не их metric rows.

Проверка расписания должна отказать до materialization при переполнении
произведений или превышении 16 384 launch entries / 65 536 metric rows на
descriptor. Полный comparison использует 820 / 2 080 соответственно.
Эти технические границы защищают parser от несоразмерного descriptor и не
разрешают дополнительные actual runs. Ошибка чтения/JSON/проверки исходного
schedule или plan в analyzer сохраняется как machine-readable
`INCONCLUSIVE`, `integrity: invalid`, с непроверенным acceptance scope.

## Условия последующего измерения

До нового capture нужны завершённые source changes, целевые integrity checks,
новый frozen harness identity и matching reference/candidate producer receipts.
Стабильность target требует фактического подтверждения; source inspection её
не устанавливает. Старые observations не отбрасываются, успешный subset не
заменяет полный reference, floors не увеличиваются для поглощения шума.

Numeric floors остаются непринятыми. Candidate timing и comparison ещё не
начинались. AC4 и полный delivery остаются незавершёнными. Остановленный
дополнительный блок проверок не является частью этого решения и не возобновляется.

## Завершённая phased calibration: результат

Один corrected reference завершился с actual exit 0: 410 launches, 1 040 runs,
208 cases. Измерительный source — `b163636c09a9641970fd3af28da2fcfa92015963`;
production source остаётся принятым OSR-64. Все 104 time cases имеют конечный
CV >10%; 104 resource cases стабильны. Полный reference отклонён по качеству.
Единственный floor-helper invocation завершился exit 1; config и policy не
созданы, floors не приняты, candidate timing/comparison не выполнялись.

V4 supporting audit подтвердил current raw integrity для 470 raw files,
66 logical requests и всех 208 cases. Его actual exit 1 относится к отдельному
historical capacity witness gap: старый mutable debug executable теперь имеет
другие bytes. Сохранённый capacity report не заменяет отсутствующий executable.
Current raw validity не устраняет failed CV и этот отдельный пробел evidence.
История operator postprocessing, включая import-inert no-op и ошибочное V3
предположение о точном числе samples, сохранена вместе с исправленным V4.
Исходные raw и shared validators не переписывались.

Полные pins, actual receipts, counts и ограничения записаны в
[phased-calibration-quality-checkpoint.json](phased-calibration-quality-checkpoint.json).
Durable checkpoint `calibration-phased-b163-quality-rejected` содержит 1 857
payload files / 1 858 ZIP entries; ZIP SHA256
`74ad363dbdb90c4d65b70936e222cef91f09ca44bd950ab1d91123c15c7067ad`.
Проверка сохранности архива не является приёмкой измерений. Оригиналы сохранены.

AC3 и AC4 остаются незавершёнными. Этот результат не разрешает повторные
проверки, новый capture, изменение порогов или возобновление остановленного
дополнительного блока. CI, formal review, merge и закрытие ещё не выполнены.
