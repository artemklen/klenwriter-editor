# OSR-33 — session tree foundation

Статус: Rust foundation для admission, адресации, подготовки дерева и mapping.
Публичный dispatch/atomic publication — OSR-34; команды — OSR-35; журнал undo/redo —
OSR-36; typed WASM/TypeScript lifecycle SDK — OSR-63. Test-only WASM observer не
входит в npm distribution и не заменяет эти задачи.

## Admission и профиль

`core::profile::FrozenProfile` — интерфейс доверенного compiled Rust-кода.
`Session<P>` импортирует только core. KWDJ реализует интерфейс без зависимости от
engine. Полная Cargo dependency closure проверяет оба направления, включая dev
dependencies. Composition tests находятся в `crates/wasm`, который вправе связать
оба модуля.

`ProfileBinding` проверяет bounded ASCII IDs, exact SemVer strings, уникальные
extension IDs и порядок по точному ASCII ID. Сравнение case-sensitive: profile,
semantic version, codec, wire version и полный extension set должны совпасть до
декодирования документа. Сети, version ranges и runtime descriptor compiler нет.
Компиляция декларативного registry и независимый production-профиль — OSR-64.

У compiled KWDJ adapter отдельная явно выбранная compatibility version `1.0.0`,
codec `org.klenwriter.kwdj/json`, wire `1`, base extension
`org.klenwriter.kwdj/base@1.0.0`. Это не package version `0.0.0`, не codec ABI
`kwdj-codec/1` и не объявление registry release. Persisted KWDJ schema остаётся v1.

Strict admission отказывает non-normalized input; Import применяет только
существующую KWDJ import normalization. Unknown/invalid input не получает пустого
editable дерева или статуса «валидный readonly». Host сохраняет исходные bytes.
ReadOnly — режим уже admitted документа: чтение, selection и export разрешены,
подготовка правки отказывается.

Generic `Document` хранит только children. Session отдельно сохраняет opaque
`P::Context`, полученный из успешного admitted handle. KWDJ context сохраняет
prose/poetry, включая одинаковые children у этих разных root profiles. Только
профиль создаёт canonical bytes на explicit export; IDs, synthetic root,
generation, selection и revision туда не попадают.

## Identity, lifecycle и preparation

SessionKey и NodeId непрозрачны, без публичного конструктора/Deserialize.
Checked process-local allocator разделяет сессии; generation меняется при
успешном remount. Идентичность ограничена одним Rust/WASM instance: будущий SDK
должен также проверять ownership instance/handle, а не трактовать tokens как
глобальные UUID. Overflow отказывается, счётчики не оборачиваются.

Remount сначала полностью допускает новый input и строит новое дерево. Refusal
сохраняет прежние tree/key/selection/revisions. Успешный remount инвалидирует
старые IDs; close и poison отказывают дальнейшим операциям. Poison предназначен
для fatal boundary, не для обычной ошибки validation. Selection сохраняет
anchor/focus direction; её epoch меняется отдельно от document revision.

Committed tree закрыт. `prepare_tree` возвращает **unadmitted** sparse TreeDraft:
нет метода публикации candidate в Session. `candidate_document()` — явный full
snapshot boundary для профильной проверки; обычные primitives его не вызывают.
OSR-34 добавляет prepare/normalize/validate/commit без обхода этого гейта.

TextStore пока String за закрытым интерфейсом. Replace копирует только leaf;
split/join — затронутые leaves/parent. Move проверяет глубину borrowed обходом
поддерева, копирует изменяемые parent/root records и сохраняет descendant IDs.
Detach владеет historical records. Revive потребляет non-Clone receipt и
проверяет session, collisions, parent/index и depth. Join возвращает отдельный
owned receipt: checked restore_join восстанавливает исходный right ID/content,
а обычный новый split выделяет новый ID. Это primitive replay для будущей
истории, без user-facing undo/grouping или selection restoration.

Новые draft IDs никогда не переиспользуются после abandoned candidate. Они не
публикуют документ, но не должны стать ABA-alias следующей подготовки.

Каждая подготовка ограничена 4096 step records и 16 MiB совокупной logical copy
cost. Cost проверяется до copies: payload + closed-value/record/child overhead;
это operational accounting, **не точное измерение RSS/allocator**. Бюджет
суммирует также повторное копирование и historical/map material. Максимальная
длина одного candidate text leaf — 16 MiB, глубина — 128; KWDJ при admission и
будущем commit по-прежнему применяет более строгие собственные maxima. Borrowed
metadata preflight не обходит children, не сериализует числа и не сканирует
Unicode. Grapheme preparation ограничивает временную span metadata до allocation.

## Позиции и maps

`Utf8Offset` и `Utf16Offset` различаются типом, но сами по себе не доказывают
валидность позиции. Conversion проверяет конкретную строку; lone UTF-16
surrogates, half-surrogate и mid-byte offsets отказываются. Text/child/edge
positions не назначают atoms фиктивную длину.

Read-only selection проверяется по scalar boundaries. Пользовательские
replacement/split проверяют extended grapheme boundaries через соседние marked
leaves; inline atoms/hard breaks разделяют последовательность. Marks не
разрывают cluster. `unicode-segmentation = 1.13.3`, Unicode **17.0.0**, MSRV crate
1.85.0: факты из pinned registry source/lock и exposed runtime constants. Bidi
координаты логические; browser visual navigation/layout этим не доказаны.

Step maps исполняются по порядку. Move destination — pre-operation index,
корректировка после удаления выполняется один раз. Split affinity и join
successors определены ADR-003. Retire ведёт к бывшему parent gap; каскад удалений
продолжает mapping к surviving ancestor. Revive отмечает восстановленную
identity как live, но не прикрепляет удалённые anchors обратно: Deleted provenance
остаётся sticky. Semantic no-op move не создаёт step или новую revision.

PositionMap различает Mapped/Deleted/Stale/Invalid. MapLog ограничен явной
capacity, принимает только contiguous committed revision +1, возвращает eviction;
пропавшая часть chain даёт Stale даже при живом исходном node ID. Refusal identity
map не является новой committed revision. Caller валидирует source/target
positions и SessionKey; map не угадывает профиль или DOM path. Retention journal
и async SDK policies детализируются в OSR-36/63.

## Проверка

Native tests исполняют production primitives, literal ADR-003 cases, generated
split/join sequences, collision/overflow/budget refusal и lifecycle guards.
Fixture adapter в engine tests — только trusted test double, не поставленный
независимый профиль OSR-64. KWDJ tests и shared native/compiled-WASM observer
проверяют реальные opaque admission handles, root context, canonical snapshots,
maps и owned replay. `npm run test:session` сохраняет source/artifact hashes и
результат target comparison в `artifacts/session-foundation-report.json`.

Общие команды: `npm run check`, `npm test`, evidence summary из CONTRIBUTING.
Rollback — revert source delivery; persisted migration и CMS deployment нет.
