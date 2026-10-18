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
