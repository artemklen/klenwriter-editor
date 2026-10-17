# Ранние бюджеты admission

OSR-75. Эксплуатационная политика ограничивает работу до разбора сырых JSON
байтов и до копирования borrowed snapshot. Семь нормативных максимумов KWDJ v1,
нормализация, canonical JSON, manifests и проекции не изменены. Превышение
возвращает `kwdj.admission_budget_exceeded` с числовыми maximum/observed и
статическим именем ограничения; исходный документ и частичный результат не выдаются.

| Поле | Библиотечный потолок | Единица |
| --- | --- | --- |
| AdmissionBudget.raw_input_bytes | 16 MiB | Длина входного byte slice до serde_json |
| PreflightBudget.payload_bytes | 16 MiB | Сумма UTF-8 длин type IDs, текста, ключей и строк/scalar payload |
| PreflightBudget.values | 1 000 000 | Узлы, marks и attribute values; для JSON — все values, включая containers |
| PreflightBudget.depth | 128 | Совместная глубина узлов/marks/metadata либо вложенность JSON values |

Это консервативные operational assumptions: запас над 2 MiB canonical JSON
оставляет место для пробелов, escaping и generic metadata. Raw JSON и canonical
JSON — разные размеры; нормативный canonical limit нельзя применять к raw bytes.
Каждое поле `effective()` может только уменьшаться относительно потолка.

`editor_core::admission::preflight_snapshot` обходит borrowed Document без
клонирования, Unicode scalar/UTF-16 сканирования или выделения frontier stack.
До рекурсии проверяются ширина коллекции и глубина; до копирования строк — их
длины. Учитываются также неизвестные type IDs, node/mark attributes, object keys,
вложенные metadata и числовое представление через counting formatter без
`to_string`. Ключи входят в bytes, сами по себе не создают value work unit.
Null/boolean считаются по длине JSON spelling; число — по Display spelling.
Корневой generic Document не считается value; пустой snapshot имеет нулевой usage.

`decode_candidate_with_limits_and_budget`,
`decode_normalize_validate_with_limits_and_budget` и
`validate_normalized_json_with_limits_and_budget` проверяют raw length **до**
парсера, затем borrowed Value до shape/normalization/codec copies. Существующие
entry points используют эту же политику по умолчанию. Opaque CandidateDocument
можно получить только после preflight; наружу не выдан mutable доступ.

`decode_candidate_value_with_limits_and_budget` принимает уже разобранный
borrowed Value: проверяет его до clone и позволяет хосту избежать повторной
serialization/parse. Для этого пути raw bytes отсутствуют; транспорт хоста обязан
ограничивать исходный request до своего parser. `admit_core_document_with_budget`
сначала проверяет generic snapshot, затем использует тот же закрытый codec без
промежуточного JSON byte buffer. Ранний отказ предшествует identity resolution.
Предыдущие валидированные handles и входной snapshot остаются неизменными.

Каждое представление имеет отдельный bounded preflight: счётчики не являются
суммарным allocation ledger всей admission pipeline. Host construction входного
Value/Document, parser allocation multiplier, allocator capacity, точный RSS и
latency SLA сюда не входят. Эти проверки ограничивают выбранные work units;
полный fuzz/performance gate остаётся OSR-38. Storage validity и operational
refusal различаются; нельзя молча обрезать текст или ослаблять нормативные limits.

Девять общих Rust-сценариев проверяются native и compiled WASM: zero/exact/over
boundaries, escaping, metadata/keys/marks/numbers, host tightening, diagnostic
priority, atomicity и отсутствие resolver calls. Test-only admission_budget_probe
поставляется в artifacts/admission-budget, вне npm package dist и публичного ABI.
