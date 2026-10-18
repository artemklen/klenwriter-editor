# Implementation notes и локальные исправления

History хранит private sparse material, captured primitive inverse chunks и
owned selection/mark boundaries. Все fallible tree/profile/counter/retention
решения выполняются до общего publication. Chronological journal не служит
undo cursor; immutable Arc ownership позволяет удержать action после потери
старой map chain.

До prepared source исправлены два конкретных пробела:

1. Empty paragraph → `a` → `ab` с одним typing token сначала давал две units.
   Независимый H04 ожидал одну. Proof теперь допускает пустой textblock и берёт
   context из реального profile-planned Text prototype, затем проверяет exact
   final text/metadata/caret. [Red log](logs/osr-36-history-fourth.log.gz) и
   [fixed log](logs/osr-36-history-h04-fixed.log.gz) — прямые capture. Это WIP
   запуск до отдельного commit; intermediate source не был pinned. Точная final
   source closure и passing H04 зафиксированы report/receipt и full gate.
2. Unit payload мог fit16 MiB, хотя staging плюс final sparse patch превышали
   cumulative draft-copy cap16 MiB. `replay_copy_bound` включает оба этапа и
   changed-ID scratch; сумма проверяется при record/coalescing. В private test
   31 реальный disjoint256KiB material показывает actual final-patch refusal,
   который теперь обнаруживается до принятия такой unit. Append cap закрывает
   старую group и начинает новую, oversized isolated action atomically refuses.

Дополнительный fixed64slot journal ring выделяется при admission/remount.
Projection учитывает capacity один раз на защищённой новой map. Eviction старой
map не объявляет освобождение слотов. `journal_summary.bytes` сохраняет область
logical retained entries; `history_summary.retained_bytes` считает unique
action/map payload и все retained metadata. Это не два складываемых бюджета.

Inherited512 metadata test прежде ограничивал только chronological entry и
ожидал одинаковый whole-prepare cost начиная с первого commit. После добавления
самостоятельного action store это стало неверной областью теста: фактический
первый red показал рост61/50 work units при одинаковом1458B journal payload.
Этот red остался в tool transcript, отдельный direct file stream не записывался.
Тест теперь ограничивает и action cap1 и сравнивает steady phase после двух
названных initial ownership состояний. Все512 по-прежнему проверяют canonical
159B/caps/IDs/maps/revisions/evictions. Новый отдельный history recurrence реально
выполняет512 edit/undo/redo cycles; старые source-bound OSR-34 artifacts сохранены.

Supporting Codex audits — участники реализации и проверки доказательств, не
официальные независимые verdicts. Grok handoff выполняется отдельно на final
source после matching prepared CI.

Accepted execution-contract.md сохранён побайтно с исходной завершающей пустой
строкой: его hash уже входит в manifest и actual tested reports. Staged
`git diff --check` отмечает только эту строку187; scoped check остальных файлов
проходит. Это явное formatting exception, не изменение проверенного контракта.
