## Stern PO · Refine · Codex · Ready (2026-10-17)

Режим intake → start; роль implementer. Technical acceptance основного Codex по делегированию OSR-26; это готовность контракта, не self-review реализации.

Факты свежего intake: OSR-36 — standalone, parent отсутствует, children=0 (hasNextPage=false); blocked-by OSR-34/59 Done; последовательная OSR-35 действительно Done после полного DoD. Base main `e31707f6573fb6f2164a5c2e025df5b92d542b39`, чистая каноническая worktree. Прочитан единственный комментарий 29963da5-1130-425b-b014-0445a1d04ba5: DOM-only наблюдение U+0020/U+00A0 из OSR-28 сохраняется как browser observation, а exact history здесь проверяет model literals. Приоритет High/проект/M2/исходные четыре AC и связи сохранены.

Authority: принятая architecture v2.0/master plan v3, ADR-003, contracts OSR-33/34/35, CONTRIBUTING. Старые /tmp proposals не являются самостоятельной authority. Выбор: sparse owned replay по ADR вместо повторного планирования command или full document snapshots. Это сохраняет exact IDs/selection/marks без snapshot на каждый ввод; semantic map recipes нужны для хронологического mapping. Default retention и explicit grouping — обратимые native API implementation choices в пределах делегирования26, не новые продуктовые обязательства. Скрытых owner-blockers нет.

Ниже принятый execution contract. Все четыре исходных AC обязательны; typing/IME/paste/drop/typography должны быть настоящими модельными изменениями. Browser event integration остаётся в задачах-владельцах, не подменяя эту модельную проверку.

## Outcome и границы

Production headless Rust history для Session: exact document/selection/stored
marks undo+redo, типизированные объяснимые отказы, explicit model undo units,
детерминированный grouping и bounded memory/map retention. Это внутренний native
bootstrap API, а не финальный JS SDK63/descriptor64. Engine остаётся generic;
URL/schema/reference/mark rules принадлежат frozen profile. Никаких CMS/DB,
browser-native undo authority, persisted session IDs, CRDT, snapshot на каждый
ввод или registry publication.

Модельные semantic units composition/paste/drop/typography обязательны здесь:
настоящие атомарные Session changes с буквальными expected checkpoints. Native
DOM interception/exactly-once composition, DnD/clipboard conversion и runtime
typography rules сохраняют gates41/44/47/48. Их deferred интеграция не заменяет
headless36 semantics фальшивыми action labels.

## Exact restore и publication

Использовать private owned sparse before/after records, подготовленные вместе
с исходным commit, и явные forward/reverse semantic map recipes. Не перепланировать
исходную user command и не восстанавливать full canonical snapshot. Restore
authority создаётся только engine из verified commit, закрыта для DTO/SDK/provider.

Каждый replay проверяет SessionKey/generation, captured revision+selection epoch,
фактический expected side всех затронутых records (включая присутствие/отсутствие,
parent/children/type/attrs/marks/text), scalar validity и resource bounds. Текущая
navigation/ephemeral marks не обязана совпадать с исторической after selection:
undo после перемещения курсора остаётся разрешён. Restore target selection/marks
берётся из unit, с direction/affinity и None vs Some(empty) без потери.

Scalar inverse не повторяет user EGC guards: a→a+U0301→a должно точно работать.
Это закрытая authority конкретного engine-owned материала с expected-side proof,
не публичный scalar/origin bypass. Restored document и FINAL selection/marks
проходят shared core/profile/normality validation и текущие synchronous identity
facts до публикации. Изменившиеся invalid identity/final mark facts дают atomic
refusal и сохраняют stack для retry; historical trust не отменяет profile rules.
Нормализация исходного commit входит в материал целиком; replay должен вернуть
exact historical records, а не незаметно «починить» их с потерей metadata.

Принятый минимальный seam — core `HistoryProfile: TransactionProfile` с
final restored typing hook и stable profile error mapping. Blanket implementation
для `CommandProvider` делегирует существующим finalizer/error_code без второй
KWDJ policy; TP-only profile может явно реализовать HistoryProfile без command
catalog (это отдельный generic witness). Existing CommandProvider/TP contracts
не требуется ломать ради переезда метода. History entry points требуют этот
generic seam, не KWDJ или command catalog. Exact saved marks должны совпасть с
результатом finalizer; если он их меняет, exact replay отказывает до публикации.

Успешный undo/redo создаёт fresh r→r+1, coherent selection epoch, dirty=true,
новый ordered map/change material и ровно одно наблюдаемое publication. Revision
не декрементируется; allocator high-water не откатывается. Исторические IDs могут
revive ровно из owned material, новые allocations никогда их не переиспользуют.
Старый Deleted bookmark не прикрепляется к revived leaf задним числом; saved
selection восстанавливается отдельно. Устаревшая map chain возвращает Stale.

Полная prepare path охватывает tree target, expected-side scans, maps/inverses,
final validation/typing, checked counters, affected-record work/copies, action
stacks/grouping и projected retention/evictions. Не pop live undo/redo и не
очищать redo до последнего fallible gate. Query availability использует тот же
полный publication-free preparer с теми же actual payload/limits/facts и одним
WorkMeter; совпадает с execute по result/refusal/work без изменения committed
facets/high-water. ReadOnly/stale/closed/poisoned/counter/limit отказ атомарен.

Принят явный checked u64 history epoch для captured history requests.
Он меняется при successful cursor/grouping/retention mutation, включая actual
manual boundary, и публикуется в summary. Noop/refusal его сохраняют. Remount
сбрасывает его только вместе с новой generation. Undo/redo проверяют session,
document revision, selection/context epoch и history epoch. Raw/command edits
записываются одним атомарным history planner; новый optional captured history
token в bootstrap requests не превращает отсутствие токена в cache authority:
execute всегда заново проверяет actual state. Все checked counters/барьеры
готовятся до publication; no partial history mutation на переполнении.

## Units, grouping и branches

Default raw dispatch и structural/toolbar/slash/compound commands — isolated
units. Composition final commit, paste и drop — каждый один isolated successful
model transaction; canceled/no-change composition не создаёт unit. Typography
trigger+rule составляет один compound unit (literal before `..`, trigger `.`,
result `…`; undo ровно `..`). Это не реализует browser/input-rule adapters48.

Host may provide bounded equality token/kind hint. Engine не читает clock.
Time/word-break UI policy фиксируется token/barrier; одного label недостаточно
для coalescing arbitrary Move/Transform. Adjacent simple inserts группируются
только при доказанной совместимости actual footprint: same session/generation,
unsealed latest unit, same token, no redo traversal/intervening context epoch,
логически collapsed/contiguous mapped caret в том же textblock, одинаковый
actual mark/type/attrs context и stored inherit/plain semantics. Нормализация
включена. Направленные adjacent backward/forward deletions могут группироваться
только внутри своего класса/направления при аналогичном proof. Insert↔delete,
направление, selected replacement, структура/атом/барьер/изменение mark context
создают новую unit. Не удалось доказать coalescing — supported edit остаётся
новой корректной unit, а не unsupported действием.

Successful navigation, actual mark-only changes, host/manual boundary и undo/redo
закрывают текущую typing group без document revision/dirty/fake history entry.
Идентичная selection, true no-op и refused operation не меняют grouping/redo.
Если host требует barrier после failed input, он посылает отдельное explicit
действие. Ни trim, ни NFC, ни NBSP→SPACE не участвуют в history/grouping.

Новая successful document branch очищает redo атомарно. Refused/noop и state-only
navigation/formatting сохраняют redo; redo восстанавливает saved after context,
а не текущий ephemeral override. Примеры обязательны: toggle→type→undo→redo;
undo→nav/toggle→redo; undo→refusal/noop→redo; undo→new Changed→redo unavailable.
Unit before/after marks — actual owned snapshots, Some([]) отличается от None.
Не нужен optimizer смешанной net-cancel group; chronological revisions/maps
уже совершённых Changes всегда остаются в своём bounded journal.

## Retention и lifecycle

Chronological transition maps отделены от undo/redo action cursor. Undo/redo
добавляет новую map, не удаляет старые revision transitions. Owned immutable
sparse material разрешено разделять internal Arc handles на native/WASM;
никакого Arc::make_mut/shared mutable Session. Конкретное ledger устройство
минимально; подсчёт unique payload ownership не зависит от Arc::strong_count,
temporary query references или hash-only equality. Metadata/maps/recipes/marks
и контейнеры учитываются явно. WorkMeter отдельно считает временные copies.

Принятые hard ceilings (host только ужесточает):64 chronological transitions,
64 undo+redo units всего,32 commits/member в coalesced unit,4096 saved map recipe
steps/unit,16MiB payload/unit,32MiB aggregate unique history+map payload и всей
retained metadata. Существующие work/copy/depth ceilings также применяются.
Если append достигает cap — seal старую group/start новую целиком. Oversized
isolated action, который нельзя удержать/replay целиком, атомарно отказывает.
Count1 не позволяет бесконечно наращивать typing group.

Replay всей group, включая expected-side scans/copies, ВСЕ forward/reverse maps,
final validation/typing и retention, использует один WorkMeter и общие hard work
limits. Бюджет не обновляется на каждом member. При record/coalescing заранее
проверяются known aggregate member/map/staging-work bounds: достижение group cap
начинает новую целую unit. Full replay availability всё равно перепроверяет
текущие факты/limits и opaque profile work; typed refusal сохраняет stacks.

Projected eviction deterministic: chronological oldest prefix; oldest complete
undo units; если нужен redo shrink — furthest future first, сохраняя immediate
redo chain. Для aggregatebytes сначала освобождать dispensable oldest maps,
затем complete actions в этом порядке; shared payload освобождается после
последнего projected retained owner. Protect newly accepted unit/transition.
Нельзя вырезать member из retained group. Нельзя применить evictions при refusal.
Summary отдельно показывает map oldest/evictions, action counts/evictions,
aggregate retained bytes. Повтор edit/undo/redo не размножает cached copy_cost.

External replacement использует существующий explicit remount: новая generation,
empty undo/redo/maps/grouping после successful admission; failed replacement
сохраняет старую сессию целиком. Старые handles не импортируются. Консервативный
dirty не сбрасывается по history depth/старому boolean; save baseline/event
receipt и сравнение на snapshot boundary остаются37/69.

## Evidence и неизменённые AC

1. Exact apply→undo→redo canonical/selection/marks/IDs на всех существующих
   операционных семействах и35 compound recipes, включая normalization-owned
   effects.16 ADR operation vectors — независимые seeds, дополнить new35 ranges;
   не переписать goldens из replay output. Explicit reverse maps/Delete/Revive/
   stale cases, monotonic revisions, exact U0020/U00A0/decomposed/non-BMP.
2. Детерминированные реальные typing/composition/paste/drop/typography/toolbar/
   slash units и coalescing/barriers; headless scope отдельно от будущих adapters.
3. Refused/noop/state-only/redo-branch sequences с проверкой всех committed
   facets, bounded full query/execute equality и late failure retry safety.
4. Tight limits, complete-unit eviction, member/map/aggregate bounds, repeated
   retention costs, ReadOnly/stale/closed/poisoned and successful/failed remount.

Bounded deterministic generated/property sequences undo-all/redo-all сверяются
с literal canonical checkpoints и ID/selection/mark invariants. Actual native
Session<KwdjProfile> и compiled WASM дают portable equal report с source/binary
hashes; non-KWDJ compiled profile доказывает policy separation. Counted hooks
показывают отсутствие ordinary full snapshot/admit/canonical buffers, explicit
checkpoint exports отдельно. Raw target-dependent byte costs не выдаются за
portable constants. OSR38 расширяет fuzz/performance, но не заменяет эти36 tests.

DoD: все четыре исходных AC+принятый execution contract, versioned docs/literals/
receipts/provenance, applicable MSRV/full workspace/M0/package/license gates,
один final prepared CI, fresh independent exact-SHA Grok4.7/full/xhigh/OIDC
review с verbatim publications/readbacks, normal merge, один postCI, cleanup/
closing/Done. Relevant repair rationale до каждого дополнительного CI.
Rollback — source revert; persisted KWDJ/CMS не меняется. Проект продолжается.

