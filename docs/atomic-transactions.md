# OSR-34 — atomic transactions

Rust `Session<P: TransactionProfile>` публикует compound edit одним commit.
Engine зависит только от generic core; KWDJ реализует borrowed profile hooks без
зависимости от engine. Native API пока bootstrap. Test-only WASM observer
проверяет composition; typed SDK/host lifecycle — OSR-63.

`Transaction` захватывает SessionKey, document revision и optional selection epoch.
Операции включают text replace/delete, split/join, per-key attributes, marks,
сохранение payload при transform, fragments, move/duplicate/remove. `NodeRef::Created`
адресует результат предыдущей операции по bounded child path. Прямые NodeId остаются
непрозрачными; forward refs и stale session/generation/revision отказываются.
Range marks выражаются split → set marks → normalization. User text/marks/leaf removal
используют EGC boundaries через соседние styled leaves. Scalar privilege доступна
только внутреннему normalization origin.

Dispatch выполняет borrowed payload preflight, sparse preparation, deterministic
normalization, generic structure validation и profile/schema/limit/normality validation.
Затем он готовит maps, selection, checked counters, owned before/after material и
решение о retention. Только после этого публикуются tree, revision, selection epoch,
dirty и journal. `CommitEvent` возвращается после coherent publication; host callbacks
внутри dispatch отсутствуют. Subscriptions/reentrancy/save acknowledgement — OSR-37.

Expected refusal возвращает typed reason и identity map текущей revision; committed
tree, selection, counters, retained maps, journal и dirty сохраняются. Allocator high-water
может увеличиться: abandoned IDs никогда не получают повторное значение. Panic/trap/OOM
не изображаются как обычный Refused; fatal host boundary выполняется в OSR-63.

`Changed` создаёт ровно одну revision и journal entry. Sparse semantic/identity equality
определяет `Unchanged`, игнорируя служебную copy-cost cache и временные IDs/maps.
Net-noop работает и при исчерпанном revision counter. Selection-only update сохраняет
document revision/journal/dirty, меняет только epoch и не вызывает domain/identity lookup.
Direction anchor/focus сохраняется; итоговые positions проверяются по scalar boundaries.
Dirty консервативен: успешное изменение делает его true до будущего save protocol.

KWDJ wire-model и candidate adapter используют один authoritative semantic walker.
Candidate adapter декодирует только bounded shallow metadata через тот же closed Serde
decoder, включая empty-variant unknown-field guards. Настоящие text/children заимствуются.
Count-only wire serializer считает точную canonical byte length с теми же полями,
escaping и number spelling, не создавая canonical buffer. Порядок object keys на длину
не влияет. Full Document/Value/canonical admission остаётся explicit export/checkpoint.
Ordinary dispatch не вызывает full snapshot admission и не клонирует полный документ.

Editing normalization возвращает explicit operations и достигает fixed point.
CRLF удаляется точными CR ranges справа налево: unrelated anchors не становятся Deleted.
Defaults, mark order, compatible adjacent text и stanza cleanup используют те же решения,
что import normalizer. Unknown/malformed metadata не удаляется автоматическим cleanup;
auto-discard проверяет active authored identities/URLs/metadata общими правилами KWDJ.
Import normalization, canonical encoding и user edits остаются отдельными путями.

Distribution ceilings: 256 user operations, 512 non-empty normalization passes,
4096 normalization operations/tree map steps, 1,000,000 logical work units, 64 MiB
logical transaction byte work, 16 MiB cumulative draft copy/material work, depth128.
Host settings могут только ужесточать ceilings. Счётчики включают повторные scans/copies,
metadata/header allocations, normalization proposals, maps и journal material; это
conservative logical accounting, не точное RSS. KWDJ продолжает применять семь собственных
более строгих document limits. Overhead зависит от Rust representation target: byte work
и journal size diagnostics могут отличаться между native/WASM при одинаковом содержимом.
Cache размера записи отражает текущие поля, включая замену/удаление metadata.
Накопительный work относится к одной подготовке; прежние commit не увеличивают цену
будущих одинаковых правок.
Exhaustion/nonconvergence/counter overflow — typed refusal.

Commit journal хранит реальные sparse before/after records, включая IDs, metadata,
children/text, ordered maps и selections. Public unchecked restore отсутствует.
Максимум64 entries/32 MiB; per-transaction tighter bound применяется только при успешном
commit. Entry, не помещающаяся целиком, отказывается; предыдущие entries вытесняются
по заранее рассчитанному плану. Summary явно сообщает bytes/entries/evictions/oldest revision.
Maps удерживаются вместе с entries; отсутствующий chain даёт Stale. Undo/redo, grouping,
historical replay и branch policy — OSR-36.

Проверки: native engine isolation tests и real-profile native/WASM witness
(`npm run test:transactions`) сравнивают literal canonical outputs, metadata, selection,
normalization maps, identity preservation, retained history и late rollback. Borrowed
validator checkpoints сравнивают native errors/paths/limits/manifests и точный byte count.
Общие gates — CONTRIBUTING. Persisted schema, CMS runtime и registry releases этим PR
не меняются; rollback — revert source delivery.
