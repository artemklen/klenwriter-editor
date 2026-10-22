# ADR-004: KlenWriter canonical JSON v1

Status: принято основным Codex как сохранение существующего v1; реализация и
доказательства OSR-77 проходят отдельный независимый review. Дата: 17.10.2026.
Идентификатор правила: `klenwriter-canonical-json-v1`.

## Решение и совместимость

Сохраняем собственное правило `core::json::canonical_value`, которым уже
пользуется KWDJ. Это **не RFC 8785 / JCS**. Замена сортировки на UTF-16 и
преобразование всех чисел в JS Number поменяли бы bytes и потеряли допустимые
KWDJ `u64` значения. Никакого изменения schema_version, семи normative maxima,
валидных canonical bytes или формата сохранённых документов здесь нет.
Правило относится к уже представленному JSON Value: оно не является обещанием
одинакового результата для всех математически эквивалентных raw JSON tokens.

- Объекты: рекурсивная лексикографическая сортировка последовательностей Unicode
  scalar values. При совпавшем префиксе короче идёт первым. Не UTF-16 code units,
  locale collation или Unicode normalization. Поэтому U+E000 идёт **до** U+1F600.
- Массивы сохраняют порядок. Null/bool — `null`, `true`, `false`. Разделители
  `,` и `:` без незначащих пробелов, без завершающего перевода строки/BOM.
- Ключи и строки: JSON quoting Serde; `"` и `\\` экранируются; U+0000–001F —
  `\b`, `\t`, `\n`, `\f`, `\r` либо lowercase `\u00xx`. `/` не экранируется.
  Остальные Unicode scalar values, включая DEL, U+2028/2029 и supplementary
  characters, пишутся буквальным UTF-8. NFC/NFD не преобразуются.
- Rust String допускает только Unicode scalars. Raw parser отказывает на
  invalid UTF-8 и unpaired surrogate escape. Корректная escaped surrogate pair
  становится одним scalar. Дубликаты object keys raw parser сворачивает по
  правилу last value wins **до** canonical serializer. Это существующий parser
  behavior, а не рекомендация создавать документы с дубликатами.

## Числа и границы представления

В принятой standalone сборке pinned `serde_json=1.0.150`, `zmij=1.0.21`, обычные
features без `arbitrary_precision` и `float_roundtrip`. Core вызывает
`Number::to_string`; не переводит `u64` в `f64` и не меняет число на строку.

Raw number grammar: `-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?`.
В `Value` обычный nonnegative integer token до `18446744073709551615`
представлен точным `u64`, negative integer от `-9223372036854775808` до `-1` —
точным `i64`. Их вывод — десятичная запись без ведущих нулей и экспоненты.
`9007199254740993` сохраняется, даже если обычный JS JSON.parse округлил бы его.

Дробная часть, exponent token, `-0` и integer overflow переходят в finite
binary64 по закреплённому parser. В default parser накапливается significand,
помещающийся в u64; остаточные integer digits увеличивают decimal exponent,
излишние fractional digits отбрасываются. Затем выполняется binary64
multiply/divide на заранее округлённые powers of ten. Это не договор о
математически точном decimal→binary64 преобразовании всех spellings.
Например, `9007199254740993.0` при накоплении significand и делении в этом
профиле parser даёт `9007199254740994.0`, тогда как точный integer token
`9007199254740993` сохраняется без округления. Этот representation boundary
зафиксирован отдельным literal vector.
Положительный nonzero overflow в infinity отказывается; underflow может дать
signed zero. Nonfinite JSON tokens не принимаются.

Вывод finite f64 закреплён formatter `zmij`: shortest correctly rounded decimal,
затем fixed layout при decimal exponent от -5 до 15 включительно, scientific
layout иначе. Fixed integral f64 сохраняет `.0`; signed zero — `-0.0`/`0.0`.
В scientific layout `e` lowercase, положительная степень с `+`, без ведущих
нулей exponent. Примеры: `1` → `1`, `1.00` → `1.0`, `-0` → `-0.0`, `1e15` →
`1000000000000000.0`, `1e16` → `1e+16`, `1e21` → `1e+21`, `1e-5` → `0.00001`,
`1e-6` → `1e-6`. Integer `10000000000000000` остаётся integer string.

Feature unification у стороннего Rust consumer может изменить Number/parser
representation. Включение `arbitrary_precision`, `float_roundtrip`, замена
Serde/formatter или parsing пути требует отдельной проверки совместимости;
настоящий ADR не объявляет такие сборки эквивалентными принятой сборке.
Upgrade dependencies не даёт права обновлять expected bytes под новый output.

## KWDJ и generic core

KWDJ v1 имеет закрытые ASCII structural/attribute keys; все сериализуемые
model поля фиксированы. Authored **values** могут содержать Unicode. Допустимые
числовые поля KWDJ имеют integer domains (включая u64); произвольный generic
JSON f64 не становится допустимым полем KWDJ через этот ADR.

Meaningful negative test обнаружил исключение в прежнем decoder: Serde
internally-tagged **unit** variants `hard_break`, `scene_break`, `strong`,
`emphasis`, `strike`, `code`, `subscript`, `superscript` игнорировали лишние поля
несмотря на container `deny_unknown_fields`. Native scan теперь проверяет их закрытый набор полей до Serde; публичная
Rust model syntax сохранена. Валидная wire shape осталась `{"type":"…"}`; неизвестные ASCII и
Unicode fields теперь дают `kwdj.unknown_attribute`, без молчаливой потери.
Это явная квалифицированная коррекция invalid-input admission, а не обещание
байтовой совместимости на ранее ошибочно принятых лишних полях.

Тест обходит каждый object в документах со всеми 24 видами nodes и 10 marks:
проверяет ASCII keys и по одному внедряет unknown ASCII и supplementary key;
каждая мутация должна отказать. Обычные canonical round-trips сохраняются.

## Независимая проверка

[Статические vectors](../../crates/core/tests/canonical-v1.json) содержат exact raw
input и фиксированные expected UTF-8 strings либо parser refusal. Это новые
synthetic inputs под MIT OR Apache-2.0; CMS fixtures, user payloads и private
source не копируются. Expected не генерируются serializer под тестом.

`npm run test:canonical` сравнивает на одном input три результата: fixture,
native core и независимую test-only JS reference. Числовые токены выделяются
до Number conversion, integer domains читаются через BigInt. Сортировка по
scalars и decimal layout реализованы отдельно. V8 shortest binary64 decimal
служит независимым formatter; Rust/WASM не вызывается из reference.
Отрицательные контрольные assertions доказывают, что default JS precision loss,
UTF-16 sort и схлопывание integer/float либо signed zero были бы обнаружены.

Отчёт `artifacts/canonical-v1-report.json` содержит input/output hashes,
fixture/reference/native-source/lock hashes, Node identity и результаты.
Он входит в `npm run check` и CI artifacts. Это доказательство перечисленных
vectors, **не** exhaustive binary64 proof, **не** corpus gate OSR-30. Полный
corpus остаётся authoritative в CMS до передачи OSR-30; WASM corpus parity
следует после OSR-76. Fuzz/широкие числовые distributions — OSR-38.

Полный native differential отдельно сравнивает неизменённые 264 ordinary CMS
cases и ранее принятый OSR-74 projection refusal. Для OSR-77 добавлены 64
synthetic unknown-unit-field cases: прежде admitted с потерей поля, теперь
UnknownAttribute. Они не записываются как равенство или valid-byte drift.

Rollback: парный revert интеграций и immutable native pin CMS; данных мигрировать
не нужно. Старый decoder снова игнорирует invalid unit fields, что не выполняет
новую границу закрытых ключей. Это должно быть явно отражено в rollback receipt.
