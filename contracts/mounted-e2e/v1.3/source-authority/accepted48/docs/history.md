# История Session — OSR-36

Внутренний native bootstrap контракт следует [ADR-003](m0/unicode-positions.md)
и [принятому execution contract](../evidence/osr-36/execution-contract.md).
Финальные JS DTO/SDK принадлежат OSR-63. KWDJ schema/identity/mark policy остаётся
в профиле; history не зависит от KWDJ или command catalog.

## Запись и replay

Успешный document dispatch и command execution используют один record planner.
Commit сохраняет owned sparse before/after records, session generation/root и
forward/reverse semantic map chunks. Порядок обратных chunks противоположен
порядку примитивов. Dimensions, attachment gaps и complete identity sets
захватываются до удаления исходных фактов. Это не обратный обход сырого StepMap
и не повторное исполнение user command.

Undo проверяет expected after side, redo — before side каждого затронутого
record. Restore authority доступна только engine-owned material. Она разрешает
scalar inverse внутри образовавшегося grapheme, сохраняя публичные EGC guards.
Полная schema/identity/normality validation и проверка saved selection/marks
остаются обязательными. Непустой результат normalization при replay означает
отказ: незаметное изменение исторического payload не допускается.

`HistoryProfile: TransactionProfile` проверяет typing context на конечном view.
Blanket implementation для CommandProvider делегирует существующему finalizer.
Transaction-only профиль может реализовать HistoryProfile без command catalog.
Ошибка finalizer или изменение saved marks дают atomic refusal. `None` и
`Some(empty)` различаются. Историческая selection восстанавливается независимо
от текущего перемещения курсора, с прежними direction и affinity.

Каждый replay создаёт новый r→r+1, map, dirty event и ровно одну публикацию.
Revision и ID allocator не откатываются. Только owned material может revive
исторические IDs. Старый Deleted bookmark остаётся Deleted; saved selection
восстанавливается отдельно.

## Доступность и tokens

`HistoryRequest::new(key, revision, selection_epoch, history_epoch, direction)`
создаёт запрос с default limits. `query_history` возвращает полную availability
с actual work; `execute_history` повторяет тот же prepare и возвращает
`HistoryOutcome::Completed(CommitEvent)` либо типизированный Refused.
Query не меняет allocator, stacks, barriers, maps, dirty или counters.
Отсутствие undo/redo, stale tokens, ReadOnly, closed/poisoned session, изменившиеся
profile facts, переполнение и лимиты проверяются до публикации.

Raw Transaction и CommandRequest имеют optional `history_epoch`; отсутствие
не создаёт cache authority. Выполнение всё равно перепроверяет actual state.
History epoch меняется при записи, replay и фактическом закрытии typing group.
`seal_history(key, revision, selection_epoch, history_epoch, work_limits)`
возвращает event с `changed=false`, если group уже закрыта. Noop не требует
следующего counter value. Selection/context epoch остаётся отдельным token.

## Undo units и grouping

Default raw edit и structural/toolbar/slash/compound commands — отдельные units.
Composition final commit, paste, drop — по одной атомарной модельной transaction.
Typography trigger и rule входят в один compound commit: `..` → `…` → undo `..`.
Это модельный контракт; browser exactly-once composition/history events,
clipboard conversion и runtime typography adapters проверяются в OSR-41/44/47/48.

Host может передать `HistoryHint::Typing { token, class }`, где class — Insert,
DeleteBackward или DeleteForward. Engine не использует clock. Он доказывает
actual simple edit, direction, collapsed contiguous logical caret, same block,
exact metadata и inherit/plain typing context. Текущий proof консервативен:
одна text operation в textblock с одинаковыми type/attributes/marks у его text
leaves; normalized final text должен точно равняться ожидаемой замене. Разрешены
только локальные joins и удаление пустых leaves при normalization. Mixed styles,
atoms, структура или недоказанная совместимость создают отдельную корректную
unit. Одного host label недостаточно.

Navigation, actual mark-only command, manual boundary и replay закрывают group.
Идентичная selection, refused operation и true noop сохраняют group и redo.
Успешная новая document branch очищает redo атомарно. Navigation/format override
после undo сохраняют redo; replay восстанавливает свой saved typing context.

## Память и lifecycle

Chronological map journal отделён от action cursor. `journal_summary()` сообщает
map counts/bytes/oldest revision/evictions; `history_summary()` — history epoch,
undo/redo units и members, action evictions и aggregate unique retained bytes.
Map bytes и aggregate bytes имеют разные области учёта; складывать их нельзя.
Material разделяется immutable Arc handles, uniqueness определяется identity
реальных retained owners. Временные query references не увеличивают retained
payload. Metadata/containers/marks/recipes и временные copies учитываются отдельно.
Chronological ring выделяет hard64 slots при admission/remount и публикует после
projected prefix eviction без расширения allocation. Его фактическая capacity
учитывается один раз на защищённой новой transition; удаление старой map не
вычитает память slots. `retained_bytes=0` пустой новой generation означает
отсутствие committed retention; после первой transition summary включает ring.
Это оценка retained ownership, а не RSS всей Session или allocator high-water.

Hard ceilings: 64 transitions, 64 undo+redo units, 32 members/unit,
4096 saved forward+reverse map steps/unit, 16 MiB/unit, 32 MiB aggregate.
Host только ужесточает `HistoryLimits` и обычные TransactionLimits. Один WorkMeter
покрывает целый replay всех members, validation, typing и retention. Дополнительный
`replay_work` ограничивает известную сумму staging work до admission/coalescing;
opaque текущая profile validation всё равно полностью проверяется при query.
Known draft copy/staging bounds входят в предварительную проверку целой unit.

При достижении group cap создаётся новая целая unit; oversized isolated action
отказывает до публикации. Eviction удаляет oldest chronological prefix, oldest
complete undo, затем furthest redo, сохраняя immediate redo chain. При aggregate
pressure сначала уходят старые maps. Новая transition/action защищена. Refusal
не применяет projected evictions и не теряет stack для повторной попытки.

Успешный remount допускает внешний документ полностью, затем начинает новую
generation с пустой history/maps/grouping. Failed admission сохраняет старую
Session. Export не содержит session IDs/history. Dirty остаётся conservative;
baseline/save acknowledgement и undo-to-clean сравнение принадлежат OSR-37/69.

Rollback — revert source change; persisted KWDJ и CMS не мигрируют.

## Проверка

`cargo test -p klenwriter-editor-engine --locked` проверяет private tree authority,
map algebra, retention и counter injection. `npm run test:history` после build
исполняет shared real native/compiled-WASM observers и сохраняет
`artifacts/history-report.json` с source/binary hashes. Independent literals
находятся в `contracts/history/v1`; unchanged ADR seeds имеют явное отображение
на core shape (15 direct, один declared structural embedding с полным физическим
oracle). u64::MAX fixture — только private engine test, без публичного setter.
Полная итоговая матрица и точные результаты delivery публикуются в evidence.
