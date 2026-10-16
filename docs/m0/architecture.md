# Editor WASM — архитектура v2.0 и основания решений

Автор архитектурных решений: Codex в основном чате проекта. Версия M0: 17.10.2026. Технические решения приняты основным агентом; помощники независимо собирали CMS facts, performance calibration и UX artifacts.

Статус: **архитектурный пакет M0 для независимого review**. Browser spike OSR-58 завершён и смержен в PR #1 (`922c5c6`); контракты расширений, Unicode, UX, CMS inventory и performance protocol оформлены отдельными проверяемыми артефактами. Это проектные решения и доказательства уровня M0, не реализованный production editor. Production Rust/native/WASM parity, browser reconciliation и release performance остаются gates M1–M7.

[Master plan](<https://linear.app/klenwriter/document/editor-wasm-master-plan-v2-arhitektura-milestones-i-delivery-gates-cf5d7e6af041>) · [Архитектурная задача OSR-56](<https://linear.app/klenwriter/issue/OSR-56>) · [FigJam: модули и поток сохранения](<https://www.figma.com/board/MfPnaBZYxczK6Yi9qd6fiv>).

## 1. Решение в одном абзаце

Строим собственный редактор документов: Rust владеет моделью, правилами допустимости и операциями; TypeScript связывает его с браузером; профили определяют формат и возможности конкретного продукта. KWDJ — первый профиль, но ядро не знает о KlenWriter. Начинаем с синхронного WASM-ядра в основном потоке браузера и единой DOM editing surface. Используем небольшие инфраструктурные библиотеки для сериализации, Unicode и WASM-границы; семантику редактора и сохранения не отдаём чужому editor framework.

Отдельный блок в интерфейсе не обязан быть отдельным contenteditable. В [OSR-58](https://linear.app/klenwriter/issue/OSR-58) сравнение завершено: **выбран один editing host**. Islands ограничили cross-block selection, Select All и clipboard текущим полем. Single host сохраняет браузерные возможности, но требует нашего structural reconciliation, identity mapping и explicit edge scroll. Подробные измерения и ограничения — [ADR-001](editing-host-decision.md).

## 2. Что в системе общее, а что продуктовая политика

| Модуль | Чем владеет | Чего не знает | Публичный результат |
| -- | -- | -- | -- |
| Document kernel, Rust | Дерево, типы узлов, attrs/marks, позиции, структурные инварианты | CMS, DOM, HTTP, Angular, таблицы БД | Типы документов и primitives |
| Schema/profile runtime, Rust | Проверенная схема сессии, допустимые типы/ограничения, codec contract | Пользовательские диалоги и сетевые запросы | Admission и capabilities |
| Editing engine, Rust | Transactions, history, mapping, session IDs, revisions, dirty changes | DOM-события и способ сохранения | Command result, change set, snapshot |
| KWDJ profile, Rust | KWDJ v1 codec, нормативные limits, профильные правила | CMS lifecycle и DB implementation | Native/WASM KWDJ parity |
| WASM bridge | Handles, преобразование DTO, ошибки, проверка версий | Продуктовый UX | Версионируемый API |
| DOM adapter, TypeScript | beforeinput/input, composition, native selection, DOM reconciliation | Persistence API и смысл CMS сущностей | Согласованная редактируемая поверхность |
| UI layer, TypeScript | Slash, toolbar, drag handles, focus, theme/i18n | Авторизация, серверные сохранения | Слоты/события/host callbacks |
| Vanilla / Angular bindings | Mount/update/destroy и framework integration | Новые правила документа | Устанавливаемый SDK |
| CMS host adapters | Auth, dialogs, uploads, media/reference resolution, ETag/idempotency, drafts | Внутреннее хранение дерева Rust | Реальные product workflows |
| Native server consumers | Авторитетная проверка и существующий rendering/save workflow | Browser selection/IME | Прежний API/persistence contract |

Направление зависимостей: host → bindings/SDK → engine/kernel; profile реализует контракты kernel и подключается при создании engine. Engine получает интерфейс профиля, а не импортирует конкретный KWDJ package. Native server использует kernel/profile без DOM и без WASM.

Не обещаем no_std, C ABI, мобильную поддержку или arbitrary embedded platforms в v1: это отдельные требования, а не автоматический эффект выбора Rust.

## 3. Документ и сессия — разные сущности

**Документ** — семантическое дерево. Узел имеет тип из схемы, типизированные атрибуты и допустимое содержимое. Текстовые блоки содержат inline text runs/marks и inline atoms; контейнеры — дочерние узлы по grammar. List item, table row и cell могут иметь отдельные структурные типы. Не ограничиваем модель плоским массивом blocks.

**Сессия** добавляет адресацию и историю: IDs, revision, selection, history, caches, dirty state. Эти поля не становятся частью KWDJ автоматически.

**Persisted format** принадлежит codec профиля. KWDJ adapter экспортирует существующий KWDJ v1 без session metadata. Для самостоятельного базового профиля будет собственный versioned JSON codec с тем же принципом отделения от сессии. Формат не является дампом Rust structs.

### Правила хранения

* Базовая реализация: дерево в стандартных Rust collections; node lookup по opaque ID, порядок children явный. Никакого собственного unsafe allocator.
* Изменения сначала готовятся в write set затронутых узлов; commit публикует согласованное новое состояние. Для затронутых структур допустимы временные копии; весь документ на каждую букву не клонируется.
* TextStore сначала использует String. Публичный API не раскрывает это хранение. Вставка в длинный String может стоить O(длины блока); обещания O(1) нет.
* Ropey подключается только если benchmark длинного абзаца/undo memory покажет нарушение бюджета. Смена TextStore не меняет codec/API, но всё равно требует regression tests.
* Dirty ancestors, индекс позиций и stats обновляются по затронутой области. Move большого subtree, global query и export могут обходить значительную часть документа.
* Limits задаются на bytes/depth/nodes/attrs/operation size до дорогой обработки. Нормативные KWDJ maxima остаются в KWDJ profile; host вправе лишь ужесточать их.

Почему дерево: таблицы, списки, вложенные контейнеры и стихи естественно имеют иерархию. Плоские blocks потребовали бы скрытой второй модели связей. Почему не HTML как canonical storage: структуру и правила документа нужно проверять независимо от браузерного DOM.

## 4. Как работают расширения

Выбираю **проверяемую декларативную схему, неизменную в пределах сессии, и доверенные Rust-модули для нестандартной семантики**.

### Уровень A — без пересборки WASM

Host передаёт manifest при создании сессии. Он может собирать профиль из имеющихся primitives:

* новые имена node/mark types;
* attrs из ограниченного набора типов: строка, boolean, конечное число, enum, ID, nullable, ограниченные списки и закрытые объекты; без arbitrary JSON, функций и объектов DOM;
* content grammar из поддержанных последовательностей/вариантов/повторений с ограничениями сложности;
* разрешённые marks и правила вложенности;
* комбинации имеющихся commands;
* renderer, toolbar actions, меню, темы, локализацию и host callbacks на TS.

Пример: блок callout с kind=info|warning, title и дочерними абзацами. Для него достаточно descriptors, renderer и обычных операций дерева. JS-команда может предложить batch существующих операций; ядро всё равно полностью проверяет batch.

Ограничение: TS-код не может объявить новую обязательную норму валидности, которую native server не знает. Проверка «обязательно спросить внешний сервис» тоже не выполняется внутри transaction.

### Уровень B — с Rust-расширением и пересборкой

Если нужны новые structural invariants, codec или алгоритм команды, добавляется Rust crate. Например, специфическая табличная геометрия, особая грамматика verse или новая семантика трансформации.

Результат публикуется как согласованная native/WASM сборка. Обычный потребитель получает prebuilt artifact и не устанавливает Rust. Автор нового Rust-плагина использует toolchain. Это сознательная цена единой семантики.

### Что разрешено и запрещено расширению

* Получать readonly context, предлагать операции, проверять candidate state и возвращать typed refusal.
* Нельзя менять committed tree напрямую, вызывать сеть во время validate, менять registry посреди сессии или полагаться на часы/randomness для результата validation.
* Config/manifest проверяется до работы: IDs уникальны, зависимости доступны, grammar ограничена, conflicts и порядок rules определены явно.
* Validator объявляет область проверки: node/subtree/ancestors либо весь document. Глобальный инвариант может стоить O(document); его цена измеряется, а incremental optimization должна сохранять результат проверки.
* Hooks имеют фиксированные фазы. UI может перехватить shortcut, но не отменить структурный validator.
* Trusted Rust/TS plugin — код приложения, не sandbox. Marketplace с недоверенными plugins не обещается.
* Без renderer поддержанный семантически узел не становится автоматически редактируемым: editable mount отказывает либо используется отдельный безопасный viewer. Unknown data не удаляется.
* Identity resolution: host предоставляет проверенные факты через явный интерфейс, server повторяет авторитетную проверку. Offline browser не объявляет неразрешённый внешний ID существующим.

Почему не произвольные runtime JS validators: они разрушили бы native/WASM parity либо потребовали JS runtime на сервере. Почему не исключительно compile-time схемы: обычный новый блок тогда требовал бы Rust даже при отсутствии новой семантики. Выбранные два уровня дают понятную цену каждому виду расширения.

## 5. Transactions: единственное место изменения документа

Путь команды: capture intent → проверка session/revision → построение candidate/write set → bounded profile normalization → schema/profile/limits validation → atomic commit вместе с position map/history/revision/change set → render.

Схематический API, имена ещё могут уточняться:

```ts
const result = session.dispatch({
  baseRevision: currentRevision,
  command: { type: "replaceRange", range, fragment }
});

// Changed { revision, changes, positionMap, selection }
// Unchanged { revision }
// Refused { revision, code, details }
```

Command не содержит DOM handles. Opaque session/node IDs и revision на JS-границе сериализуются без потери integer precision; выбранный DTO использует строковые tokens/decimal revisions. Rust не принимает произвольное округление JS number.

**Атомарность:** ошибка любого шага не меняет document, selection, revision, dirty state и history. Она не гарантирует отсутствие временного DOM browser input — это отдельный reconciliation contract.

**Сохранность:** проверяем текст, attrs, marks, ссылки, spans и metadata. Сохранить все буквы, но потерять ссылку — тоже ошибка. Import normalization, canonical encoding и редактирование разделены. Неизвестные данные не «чинятся» удалением.

**История:** один осмысленный шаг — typing group, paste, DnD, composition или compound command. Undo восстанавливает документ и согласованную selection; failed command не попадает в историю. External document replacement/reset имеет отдельный history policy. Browser historyUndo/historyRedo направляются в наш engine; native undo stack не становится второй authority.

**Ревизии документа и выделения:** перемещение курсора само по себе не создаёт новую doc revision, не делает документ dirty и не добавляет undo entry. Selection имеет отдельное состояние/epoch; успешная document transaction возвращает связанный position map и selection. Command использует captured selection/anchors, а не случайное положение DOM focus после async dialog.

**Reentrancy:** внешние callbacks доставляются после commit. Вызов subscriber не может вложенно изменить незавершённую transaction; новый command проходит очередь публичного dispatch.

**Ошибка ядра:** expected validation errors возвращаются как Refused. WASM trap/panic — неисправность, handle дальше не используется; host сохраняет исходный/snapshot input и доступный provisional text для восстановления. Не обещаем безопасно продолжать работу повреждённой сессии.

## 6. Позиции, Unicode и выделение

Выбираю явные типы позиций, а не один числовой offset «на все случаи».

* Text position: text-leaf ID + UTF-16 offset на DOM/SDK boundary + affinity.
* Structural position: before/after node либо child boundary, без выдуманного количества «символов» у image/table.
* Внутри Rust text storage — отдельно типизированные UTF-8 byte boundaries. Boundary adapter преобразует и проверяет позиции; half-surrogate/mid-byte offset отказывается.
* Mark split/merge и изменение text leaves возвращают position map; callers не хранят DOM path как постоянный ID.
* Grapheme navigation/deletion — отдельная политика. Emoji family или буква с combining accent не равны одному byte/code unit. Unicode rules версии фиксируются; изменение версии проверяется corpus.
* Native visual/bidi navigation используется там, где браузер уже корректно даёт selection. Engine задаёт семантику изменений; не пишем собственный layout/shaping engine.
* Каждый command несёт base revision. Async dialog result со старой revision либо явно remap по сохранённым maps, либо отказывается; «поставим в ближайший похожий блок» запрещено.
* History maps не обещаются вечными: имеют bounded retention. Устаревший anchor получает явный stale result.

Эти решения опираются на различие Rust UTF-8 strings, DOM selection и Unicode segmentation. Библиотека сегментации не решает за нас визуальный bidi movement. [Rust String](<https://doc.rust-lang.org/std/string/struct.String.html>), [Selection API](<https://www.w3.org/TR/selection-api/>), [unicode-segmentation](<https://docs.rs/unicode-segmentation/latest/unicode_segmentation/>).

## 7. Браузерный слой: решение после M0 prototype

**Выбран один contenteditable editing host на непрерывную document surface**, с key-stable DOM blocks внутри. Блоковый UX не требует отдельных editing roots. Toolbar/menus/handles и независимые form controls отделены от editable text. Полный root на каждый ввод не пересоздаётся.

Решение обновлено 17.10.2026 по [OSR-58: complete browser spike and choose one editing host](https://linear.app/klenwriter/review/osr-58-complete-browser-spike-and-choose-one-editing-host-ba37c5e4c0eb), [ADR-001 и versioned evidence](<https://github.com/artemklen/klenwriter-editor/blob/229bdd6bff06c04cd02581ffecab4f828b3ee11e/docs/m0/editing-host-decision.md>). GitHub — единственный repository, без GitLab mirror. Reviewed revision: `229bdd6bff06c04cd02581ffecab4f828b3ee11e`; независимый review без actionable P1/P2. [Matching CI](<https://github.com/artemklen/klenwriter-editor/actions/runs/38968851533>) SUCCESS: 102 cases, 28 MET / 26 GAP / 48 OBSERVATION. PR #1 merged по указанию владельца: `922c5c6afc5772e114938a790c2abf0c75944108`; [post-merge CI](https://github.com/artemklen/klenwriter-editor/actions/runs/38969622549) SUCCESS, OSR-58 Done. Release/deploy не выполнялись. Это DOM-only spike, не Rust renderer; runtime dependencies = 0, empty WASM проверяет только representative CSP allowance.

### Измерения и их пределы

Исходные 78 cases показали document-level Shift/mouse selection, Select All, copy/cut/undo и keyboard selection через atom/nested block у single-host; islands ограничивали их текущим полем. Расширенная matrix — 102 harness cases (17 сценариев × 2 режима × 3 движка), raw MET/GAP/OBSERVATION опубликованы отдельно. Успех harness означает корректно собранные наблюдения, а не отсутствие product gaps. Playwright: Chromium 156, Firefox 157, WebKit 27.2; установленный Safari не подменяется WebKit.

Cross-block paste с новым clipboard marker проходит у single-host во всех трёх движках. Enter в конце p1 временно дублирует DOM id в Chromium/WebKit; Backspace восстанавливает fixture. Значит, browser DOM IDs не являются authoritative model identity — [OSR-39](https://linear.app/klenwriter/issue/OSR-39/dom-renderer-osnovnyh-blokov-i-reconciliation) проверяет split/join и назначает уникальные identity при reconciliation.

Удержание мыши за краем viewport проверяется вместе с endpoint, а не только scrollTop. Частичное пересечение каретки с viewport недостаточно для полной видимости. Native короткий drag Chrome/Safari достигает p3, но endpoint остаётся ниже viewport; Firefox останавливается на atom. Длительный automated hold — другой жест: WebKit single-host MET, Chromium GAP из-за обрезанного сверху caret, Firefox GAP на atomic boundary. Проверка ждёт полную видимость либо 20 polls × 100ms; фактический heldMs записан. [OSR-40](https://linear.app/klenwriter/issue/OSR-40/selection-controller-unicode-i-granicy-blokov) **должен реализовать edge autoscroll для Chrome/Safari и проверить оба направления, atom/nesting, полную видимость endpoint, pointer cancel и focus return.** Firefox имеет дополнительный boundary path, вынесенный в [OSR-73](https://linear.app/klenwriter/issue/OSR-73/firefox-gate-perehoda-iz-experimental-v-supported-posle-v1).

Официальный Mozilla-signed Firefox 158 запущен без ослабления системной защиты; прежний unsigned Playwright app упирался в macOS App Data protection. [Диагноз и первичные источники](<https://github.com/artemklen/klenwriter-editor/blob/229bdd6bff06c04cd02581ffecab4f828b3ee11e/docs/m0/firefox-launch-diagnosis.md>). Native Chrome 155.0.8059.85 / Safari 27.0.1 / Firefox 158 на macOS 27.0.1: RU/EN проверен в обоих режимах, 18 независимых clean dead-key sessions (3 повтора × 2 режима × 3 браузера), 6 replacement+Undo probes и 6 native Find checks. Find находит один Charlie в nested p3; diagnostics скрыты через native=1.

Чистая последовательность commit → Escape+x → blur → refocus/reposition+e даёт `Alpha bold omega.é ´x ´e`. Escape/blur оставляют spacing accent, а не гарантируют отмену. Safari после blur может отправить пустой [compositionend.data](<http://compositionend.data>) при наличии accent в DOM. Chrome в clean Incognito сохраняет compositionend.trusted=false при trusted start/update/input; exact-version source corroborates scoped dispatch path. Это не доказательство синтетического ввода и не причина отбрасывать event. Raw trust values сохранены.

Replacement probes пока внутри абзаца; cross-block composition остаётся production acceptance [OSR-41](https://linear.app/klenwriter/issue/OSR-41/ime-state-machine-i-exactly-once-composition-commit). Refocus с явным reposition не доказывает caret recovery. Download trace сам переводит focus на кнопку; final snapshot относится к состоянию после этого blur, этапы подтверждаются промежуточными checkpoints/events. Exploratory ошибки setup и первые неудачные traces сохранены отдельно.

Native Undo grouping непостоянен: первый расширенный Chromium run снял только последний символ вставки, три unchanged repeats — всю вставку. Причина не установлена; raw first failure сохранён. Browser history не задаёт контракт Rust history. WebKit clipboard может преобразовать decomposed e+accent в U+00E9: scope MET не доказывает code-point fidelity. [OSR-47](https://linear.app/klenwriter/issue/OSR-47/clipboard-pipeline-bezopasnyj-decode-i-atomic-insert) задаёт serialization/normalization contract без тихой нормализации ядром.

AX/axe/keyboard/focus checks выполнены; это не screen-reader acceptance. VoiceOver/real AT, CJK input, mobile и collaboration отложены за v1 по решению владельца. Unicode storage не ограничен RU/EN.

### Почему single host и как он развивается

Single-host уже даёт native непрерывное выделение и document clipboard scope. Islands удобны локальной областью DOM mutations, но требуют собственного cross-host selection, Select All, clipboard scope, focus и координации истории. Их создание возможно; для выбранного продукта эта стоимость не оправдана. Независимые поля остаются допустимы вне непрерывной document surface.

Цена выбора: bounded DOM reconciliation, model selection bookmarks, unique identity, atomic boundary policy, собственный scroll и composition state machine. Tab-out/back может сбросить caret даже когда explicit focus out/back его сохраняет; возвращаем модельный bookmark, а не надеемся на incidental browser behavior.

Это решение browser adapter, не Rust schema/commands/KWDJ codec. Generic core и profile extensions развиваются независимо; новая input/virtualization/collaboration strategy потребует своих evidence contracts.

### Обычный ввод

При надёжном cancelable beforeinput adapter отменяет default, вызывает synchronous Rust command и patch-ит затронутый DOM. Для noncancelable/неполного input сверяет bounded изменённую область с моделью, строит команду и принимает либо восстанавливает DOM с явным отказом. MutationObserver и произвольный DOM не являются canonical document.

### Composition

Браузер временно владеет provisional range: не remount/normalize/format active subtree, не создаём history на каждый intermediate event. Adapter хранит original/provisional text и model range, сверяет bounded final DOM delta и применяет его ровно один раз по session/revision token. Trailing input не создаёт второй transaction; отмена без изменения текста не создаёт commit. Escape, blur, [end.data](<http://end.data>) и isTrusted отдельно не являются решением о commit/cancel.

Blur/destroy/conflicting command имеют queue/refusal policy; неопределённый исход сохраняет recoverable text и запрещает destructive remount. При отказе committed model state сохраняется, пользователь получает явный отказ и возможность восстановить ввод. [OSR-41](https://linear.app/klenwriter/issue/OSR-41/ime-state-machine-i-exactly-once-composition-commit) доказывает эти свойства на production adapter; DOM spike их не реализует. [Input Events Level 2](<https://www.w3.org/TR/input-events-2/>) не заменяет native OS traces.

### Support и virtualization

**Обязательная v1 matrix: desktop Chrome/Safari, RU/EN. Firefox — experimental compatibility**, вне обещания поддержки v1. Решение основного архитектурного агента в рамках разрешённого владельцем сокращения scope. Трёхдвижковый measurement CI обязателен: известные Firefox behavioral GAP публикуются и не блокируют v1; ошибки harness, отсутствие или повреждение evidence остаются ошибками. Не ставить весь Firefox job в continue-on-error. [OSR-73](<https://linear.app/klenwriter/issue/OSR-73>) — отдельный post-v1 promotion gate по установленному браузеру и production artifacts.

Full-DOM baseline сохраняется; сначала сокращаем patching/layout work. Offscreen unmount разрешён только после измерений selection, Find, composition, scroll, keyboard/focus/semantics/axe на обязательной matrix ([OSR-46](https://linear.app/klenwriter/issue/OSR-46/virtualization-s-sohraneniem-selection-ime-i-a11y)). Реальный AT не проверен и требует отдельного будущего acceptance до обещания поддержки.

[OSR-58](https://linear.app/klenwriter/issue/OSR-58/spike-single-editing-host-protiv-per-block-islands) завершает сравнение и решение с известными GAP; [OSR-39](https://linear.app/klenwriter/issue/OSR-39/dom-renderer-osnovnyh-blokov-i-reconciliation)/40/41 реализуют production исправления. Контракты расширений/Unicode, CMS inventory, performance protocol и итоговое архитектурное принятие собраны в §15 как отдельные артефакты M0.

## 8. WASM, потоки и сохранение

**Ввод — synchronous main-thread WASM.** Инициализация и загрузка async; command после ready синхронный. Это уменьшает число гонок между native input, selection и model commit.

Worker пока нужен только как возможный путь для тяжёлых независимых вычислений: import preparation, search index, analysis. Он получает immutable snapshot + revision; устаревший результат не применяется автоматически. Перенос authoritative session в Worker потребует нового async протокола и отдельного решения — не обещаем прозрачную замену синхронного API. Worker messages используют очередь, поэтому latency и ordering меняются. [HTML Workers](<https://html.spec.whatwg.org/multipage/workers.html#dedicated-workers-and-the-worker-interface>).

**WASM API** проверяет engine API version, build identity, profile version и extension manifest. JS glue и wasm поставляются согласованным комплектом. Передача — небольшие typed DTO для command/change; полный document только на import/export boundaries.

**Сохранение — host responsibility.** Core выдаёт snapshot {revision, document}; host связывает его со своими ETag/idempotency/auth contracts. Change event не значит сохранение. Save receipt r42 при текущей r43 не очищает dirty r43. Export snapshot не значит IDB transaction committed, а IDB commit не значит server save.

Существующие CMS semantics — exact If-Match, body-bound Idempotency-Key, uncertain outcomes/reconciliation, identity-bound recovery — остаются за host. Старый editor нельзя включать поверх устаревшего snapshot, уничтожив unexported changes: требуется успешный flush/export или отказ от переключения с сохранением текущей сессии.

Session lifecycle: loading → ready → composing/ready → disposing → destroyed; fatal failure имеет отдельное состояние. Doc switch меняет generation; поздние load/dialog/save callbacks проверяют context и не оживляют старую сессию.

## 9. Как архитектура допускает развитие

| Будущее изменение | Что предусмотрено сейчас | Что придётся добавить/изменить | Цена и граница обещания |
| -- | -- | -- | -- |
| Новый простой block/mark | Declarative schema + renderer + existing primitives | Manifest, renderer, fixtures | Без изменения kernel и без rebuild, если semantics уже выразима |
| Новый инвариант/алгоритм | Rust extension contract | Rust crate, native/WASM artifacts, conformance tests | Нужна пересборка; не «любая возможность без core work» |
| React/Vue/Web Component | DOM renderer и framework-free SDK | Thin binding, lifecycle/focus tests | Core/codec сохраняются; framework integration всё равно тестируется |
| Другой продукт/формат | Profile и codec отделены | Profile/codec + host adapters | Независимый профиль доказывается уже в M2/M3 |
| Новый серверный стек | Browser packages не зависят от CMS | Native service wrapper либо новый WASM server adapter | Не обещан C ABI/no_std/любой runtime |
| Mobile | DOM adapter отделён от semantics | Virtual keyboard, touch selection, viewport, real-device tests | Существенная browser работа, не один media query |
| Comments/annotations | Explicit positions/maps и revisioned document | Durable anchors, orphan/reanchor policy, storage/API | Session IDs недостаточны для долговременных комментариев |
| Track changes | Atomic operations и origin metadata | Семантика accept/reject, persistent annotations, UI, codec version | Значительная функция; обычный undo journal её не заменяет |
| Collaboration | Engine boundary и logical operations | Shared identity, CRDT/OT semantics, conflict policy, distributed undo, transport/auth | Может потребовать новой engine/API major версии |
| Offline editing | Local engine, codec и host recovery seam | Durable operation/snapshot policy, resync/conflict UX | Local recovery уже предусмотрен; offline merge отсутствует |
| Очень длинные документы | TextStore/renderer abstractions и benchmarks | Rope/indexing/virtualization при необходимости | Без обещания бесплатной замены или постоянного времени |
| AI assistance | Typed commands и host callbacks | Preview patch, provenance, confirm/reject UX, async revision checks | AI не получает прямую мутацию дерева и право молча менять текст |
| PDF/paginated layout | Codec/document semantics отделены от view | Отдельный layout/export subsystem | Google Docs pagination не скрыта в v1 scope |

Стабильные границы уменьшают область изменений, но не делают будущие функции бесплатными. Особенно collaboration: session-local IDs, inverse history и обычный snapshot не образуют CRDT. Не резервируем фиктивную «готовность к collaboration» без выбранной модели согласования.

## 10. Рамки, устанавливаемые сразу

### Жёсткие контракты v1

 1. Модель — структурированный документ, а не произвольный HTML/DOM.
 2. Mutation только через atomic commands/transactions; UI и plugins не правят committed tree.
 3. Профиль фиксирован на время сессии; его смена — явный export/convert/reimport с проверкой, не live schema mutation.
 4. Данные неизвестного типа/версии не удаляются; editing admission отказывает, исходные bytes/JSON остаются host.
 5. Core/profile rules deterministic; сетевые зависимости/авторизация — host и server.
 6. Browser и server используют один Rust profile implementation, но server остаётся авторитетным.
 7. KWDJ v1 и CMS persistence/API не меняются как побочный эффект замены editor.
 8. Никаких обязательных CMS, Angular, облачного сервиса или telemetry в standalone core.
 9. Desktop v1: обязательные Chrome/Safari; Firefox experimental. Три engine measurement targets сохраняются. Реальные Safari/OS RU/EN input/dead-key checks дополняют automation. Keyboard/focus/semantics/axe входят в v1; реальный screen-reader/VoiceOver acceptance отложен за v1 без заявления поддержки.
10. No CRDT/mobile/pagination/arbitrary untrusted plugins в v1. Уход Tiptap v2 и v3 из CMS обязателен.

### Детали, которые можно менять без изменения смысла документа

TextStore, внутренние indexes, способ DOM patching, internal scheduling/cache, часть third-party libraries за adapters. Их замена всё равно требует тестов; сохранение public API — обязанность нашей реализации.

### Когда нужна major version либо явная миграция

Изменение persisted schema/meaning, command semantics, публичного plugin contract, формата/единиц публичных позиций, version negotiation или synchronous dispatch contract. Library version и document/profile version различаются. Bugfix не используется как оправдание незаметной потери ранее допустимых данных.

## 11. Почему эти варианты, а не альтернативы

| Решение | Рассмотренная альтернатива | Почему выбираю | Что теряем / когда пересмотреть |
| -- | -- | -- | -- |
| Rust semantics + TS DOM | Весь editor на TS | Native server reuse, единая семантика и строгая граница ownership | Два toolchains, WASM startup/boundary cost; нельзя обещать автоматическое ускорение |
| Собственный engine | Tiptap/ProseMirror как основной engine + Rust validator | Требуется Rust authority над editing, а не только final validation | Теряем зрелую browser machinery и обязуемся её реализовать; самый большой расход проекта |
| Generic kernel + KWDJ profile | Вынести текущий kwdj модуль и назвать общим | Другой consumer не обязан наследовать CMS node inventory | Более сложные profile contracts; проверяются вторым реальным профилем |
| Два уровня extensions | Только JS plugins / только Rust rebuild | Обычные схемы без rebuild, сложная semantics едина в native/WASM | Runtime flexibility ограничена grammar/algebra ядра |
| Tree + text runs | Плоский block list / HTML source | Явная nested structure, marks и profile grammar | Нужны position maps и structural commands |
| Single editing host baseline | Per-block islands / Canvas | Сохраняем native continuous selection, не пишем text layout | DOM reconciliation остаётся трудным; решение проверяется [OSR-58](https://linear.app/klenwriter/issue/OSR-58/spike-per-block-vvod-cross-block-selection-i-ime) |
| Sync main-thread session | Authoritative session в Worker сразу | Проще input/selection ordering и typed refusal | Длинная операция может block UI; budgets обязательны |
| String сначала | Rope с первого commit | Меньше initial complexity, реальная стоимость измерима | Длинный block может потребовать Ropey ещё до релиза |
| Собственный transaction journal | Browser native undo / CRDT с первого дня | One authority, atomic structural operations и контролируемая группировка | Distributed history не появляется автоматически |
| Versioned codecs | Serialize внутреннего дерева как есть | Меняем internals без порчи persisted docs | Дополнительные mapping/conformance tests |

ProseMirror не отвергается как «плохой» или обязательно зависимый от Tiptap: его view/state — отдельные открытые модули. Использовать их зрелую DOM-логику выгодно, но полный PM state/model в роли второй authority противоречит выбранной цели. При необходимости можно изучать алгоритмы и тестовые сценарии с соблюдением лицензии; копирование чужого runtime не является обещанным обходным путём. [ProseMirror view](<https://github.com/ProseMirror/prosemirror-view>), [state](<https://github.com/ProseMirror/prosemirror-state>). GitHub repositories перенесены; архивный статус сам по себе не доказывает прекращение проекта.

## 12. Внешние библиотеки: что выбираю и что будет без них

Ниже **выбор для будущей реализации**, не список уже установленного редактора. Exact versions, transitive closure, licenses/MSRV, browser build и размеры фиксируются в M1. Число строк таблицы не равно числу транзитивных packages.

### Runtime dependencies

| Библиотека | Где и что даёт | Цена / ограничение | Если отказаться | Решение |
| -- | -- | -- | -- | -- |
| serde + serde_json | Profile codecs/DTO: преобразование типов и JSON | Parser/derive dependencies, allocations; KWDJ canonical ordering/validation остаются нашими | Писать и сопровождать JSON parsing/escaping/schema mapping вручную либо выбрать другой parser | Берём |
| unicode-segmentation | Engine: Unicode grapheme/word boundaries | Версия Unicode влияет на поведение; это не bidi layout и не CMS counting policy | Своя реализация UAX #29 и Unicode tables либо другая mature Unicode library | Берём, pin Unicode behavior |
| wasm-bindgen + необходимые js-sys bindings | Browser bridge: handles, strings/objects, JS/WASM glue | Generated glue/build coupling; не стабильный универсальный C ABI | Ручной ABI, память, string encoding, callbacks и cleanup | Берём, скрываем за нашим SDK |
| serde-wasm-bindgen | Bridge: Rust DTO ↔ JS values без обязательной JSON-строки на каждую команду | Нужно явно настроить map/null/integer representation; не генерирует все public TS types | Для малых DTO ручной conversion; для bulk JSON возможно stringify/parse с измеряемой ценой | Берём, изолируем в bridge |
| parse5 | Clipboard package: HTML → data tree, затем наш allowlist decoder | JS/transitive bytes, отдельная lazy-loaded browser build; не sanitizer и не KWDJ validator | Native DOMParser с доказанной isolation/no-fetch policy либо другой parser; собственный HTML parser не рекомендую | Выбран для clipboard proof; browser/bundle gate до закрепления |
| Angular | Только Angular binding как peer dependency | Версионная матрица Angular | Пользователь берёт vanilla API | Не входит в generic core/vanilla runtime |

[Serde](<https://serde.rs/>) даёт механизм сериализации, но не наши domain invariants. [unicode-segmentation](<https://docs.rs/unicode-segmentation/latest/unicode_segmentation/>) реализует Unicode segmentation. [wasm-bindgen](<https://wasm-bindgen.github.io/wasm-bindgen/>) предоставляет high-level JS/WASM bindings; [serde-wasm-bindgen](<https://docs.rs/serde-wasm-bindgen/latest/serde_wasm_bindgen/>) конвертирует values, причём default representation не обязана быть JSON-compatible. Эти особенности учитываются в DTO tests.

[parse5](<https://parse5.js.org/>) — HTML parser; официальный package [manifest](<https://github.com/inikulin/parse5/blob/master/packages/parse5/package.json>) содержит transitive dependency entities. Документация позиционирует его прежде всего для Node; работоспособность выбранного browser build и его бюджет ещё предстоит проверить. Нельзя обещать zero-network только по названию parser: проверяется весь pipeline. ClipboardData читается синхронно в paste handler до завершения события; async preparation хранит captured revision/selection и применяет результат только после проверки актуальности. После parsing никогда не вставляем чужой HTML/DOM в editor; allowlist строит новый fragment, затем Rust проверяет профиль. Diagnostics существующего CMS clipboard contract сохраняются. Если gate не проходит, выбор parser пересматривается до реализации UI, без ослабления security acceptance.

### Build/test dependencies — не browser runtime

| Инструмент | Выигрыш | Если без него |
| -- | -- | -- |
| ts-rs, только generation feature/build | TS DTO из Rust declarations; меньше ручного расхождения | Ручные .d.ts и обязательные serialization contract tests; generation не заменяет runtime validation |
| proptest | Генерация docs/commands, поиск и уменьшение failing cases | Собственный random generator/shrinker и худшая диагностика |
| cargo-fuzz / libFuzzer | Поиск crashes/edge cases на hostile input | Собственный fuzz runner; обычные examples не эквивалентны |
| Criterion | Повторяемые native benchmarks и статистика | Свой benchmark harness; всё равно нужны noise controls |
| Playwright | Mounted tests Chromium/Firefox/WebKit, traces | Несколько browser drivers/harnesses и больше glue code |
| TypeScript compiler и package build tooling | Статические checks и distributable JS/declarations | Другая build цепочка либо ручная сборка |

Источники: [ts-rs](<https://github.com/Aleph-Alpha/ts-rs>), [proptest](<https://docs.rs/proptest/latest/proptest/>), [cargo-fuzz](<https://rust-fuzz.github.io/book/cargo-fuzz.html>), [Criterion](<https://docs.rs/criterion/latest/criterion/>), [Playwright browsers](<https://playwright.dev/docs/browsers>). Native benchmark не измеряет browser input-to-paint; Playwright WebKit не заменяет все проверки реального Safari, OS IME и screen readers.

### Пока не добавляем

* **Ropey:** резерв для TextStore после benchmark. Даёт rope storage, но не schema, marks, history или grapheme UX. Без него используем String и честно измеряем длинные блоки. [Документация](<https://docs.rs/ropey/latest/ropey/>).
* **Yrs/Automerge:** CRDT не входит в v1; зависимость сейчас не создаст автоматически правильные merge semantics. Если collaboration станет задачей, сравним модели конфликтов и цену integration отдельно. [Yrs](<https://docs.rs/yrs/latest/yrs/>).
* **Floating UI:** кандидат для сложной геометрии toolbar/slash, не hard dependency ядра. Решение после UX/CSP prototype; без него небольшой positioning adapter, с риском роста edge cases. [computePosition](<https://floating-ui.com/docs/computeposition>).
* **Tiptap/ProseMirror runtime:** не входят в новый editor engine. Существующие используются только в CMS transition/rollback window и затем удаляются по owner scope.
* **Full frontend framework внутри DOM renderer:** Angular ограничен binding; не вводим React/Vue/Leptos/Dioxus как обязательный runtime библиотеки.

### Политика зависимости

1. У зависимости есть узкая обязанность, owner wrapper и public API, не раскрывающий её типы без необходимости.
2. До включения — exact lock, license/provenance, transitive graph, supported targets, fixture tests и измерение bundle/startup/memory.
3. Upgrades проходят corpus/compatibility tests. В generated release artifacts фиксируем build identities и checksums; library consumers получают documented compatible ranges, не требование общей lockfile.
4. Exit plan различается: DTO converter заменить проще, чем WASM toolchain. Не пишем «можно легко заменить любую библиотеку».
5. Нулевая зависимость не является KPI. Unicode/JSON/ABI с нуля увеличат объём критического собственного кода; отказ оправдан, когда есть доказанная проблема библиотеки и приемлемая альтернатива.

## 13. Проверки, которые могут заставить меня пересмотреть решение

| Решение | Проверка | Что делаем при провале |
| -- | -- | -- |
| Single editing host | [OSR-58](https://linear.app/klenwriter/issue/OSR-58/spike-per-block-vvod-cross-block-selection-i-ime): same scenarios, three-engine measurements; required Chrome/Safari native RU/EN, keyboard/focus/semantics/axe и cross-block/nested/table acceptance; Firefox experimental ([OSR-73](https://linear.app/klenwriter/issue/OSR-73/firefox-gate-perehoda-iz-experimental-v-supported-posle-v1)), real AT deferred beyond v1 | Required Chrome/Safari failure блокирует baseline до исправления adapter или пересмотра DOM strategy. Firefox GAP документируется и блокирует promotion, не v1 |
| Декларативные extensions | [OSR-57](https://linear.app/klenwriter/issue/OSR-57/adr-kontrakt-rasshirenij-i-granica-kwdj-profilya) sketch/vectors, [OSR-64](https://linear.app/klenwriter/issue/OSR-64/publichnoe-extension-api-i-nezavisimyj-profil) runtime: KWDJ и независимый callout profile | Уточняем grammar/API; нет special cases CMS в kernel |
| String/main thread | [OSR-61](https://linear.app/klenwriter/issue/OSR-61/protokol-performance-baseline-i-byudzhety-redaktora) protocol и [OSR-38](https://linear.app/klenwriter/issue/OSR-38/propertyfuzz-tests-i-performance-regression-gates) core+boundary, затем input-to-paint | TextStore/index/algorithm changes; Worker только при доказанной необходимости и новом контракте |
| Clipboard parser | [OSR-47](https://linear.app/klenwriter/issue/OSR-47/clipboard-pipeline-bezopasnyj-decode-i-atomic-insert)/67: browser build, XSS/no-fetch, limits, parity, bundle budget | Меняем parser adapter, не сокращаем safety scope |
| API/DTO types | [OSR-63](https://linear.app/klenwriter/issue/OSR-63/wasmtypescript-sdk-lifecycle-revisions-i-error-contract): native/WASM/TS representation tests и stale lifecycle cases | Исправляем schema/generator/bridge до public alpha |
| CMS migration | [OSR-69](https://linear.app/klenwriter/issue/OSR-69/cms-saverecovery-adapter-bez-eksporta-na-kazhdyj-vvod)/49/70/72: save, recovery, unknown outcomes, rollback | Не удаляем старый editor до accepted replacement и сохранённого текста |

M0 проверяет feasibility и reference contracts; production checks этой таблицы остаются gates реализации. Неизвестные численные бюджеты и exact library versions не заполняются вымышленными значениями.

## 14. Как это отражается в backlog

* [OSR-56](https://linear.app/klenwriter/issue/OSR-56/arhitektura-v-figmafigjam-moduli-potoki-i-adr): этот документ + FigJam + rationale/exit conditions; status остаётся открытым до evidence M0.
* [OSR-57](https://linear.app/klenwriter/issue/OSR-57/adr-kontrakt-rasshirenij-i-granica-kwdj-profilya): двухуровневые extensions, frozen session registry и public schema constraints.
* [OSR-58](https://linear.app/klenwriter/issue/OSR-58/spike-per-block-vvod-cross-block-selection-i-ime): сравнение single editing host и per-block islands, с выбранным единым editing host по завершённым measurements.
* [OSR-59](https://linear.app/klenwriter/issue/OSR-59/adr-unicode-pozicii-selection-mapping-i-istoriya): explicit UTF-16 boundary / UTF-8 storage / grapheme policy / structural positions.
* [OSR-63](https://linear.app/klenwriter/issue/OSR-63/wasmtypescript-sdk-lifecycle-revisions-i-error-contract): synchronous dispatch после async init, DTO representation, compatibility/lifecycle.
* [OSR-39](https://linear.app/klenwriter/issue/OSR-39/dom-renderer-osnovnyh-blokov-i-reconciliation)/40/41: native selection + model mapping и composition reconciliation; отдельные islands не навязаны заранее.
* [OSR-46](https://linear.app/klenwriter/issue/OSR-46/virtualization-s-sohraneniem-selection-ime-i-a11y): baseline без offscreen unmount, optimization после доказательства.
* [OSR-47](https://linear.app/klenwriter/issue/OSR-47/clipboard-pipeline-bezopasnyj-decode-i-atomic-insert)/67: clipboard parser adapter, allowlist и profile validation как разные проверки.
* [OSR-28](https://linear.app/klenwriter/issue/OSR-28/repozitorij-oss-workspace-ci-i-vosproizvodimaya-sborka)/38: dependency register, reproducible artifacts и реальные tests/benchmarks.
* [OSR-26](https://linear.app/klenwriter/issue/OSR-26/utverdit-arhitekturu-scope-v1-i-kriterii-milestones): review проверенных архитектурных результатов. Автор и принимающий технические решения — основной Codex; owner понимает и принимает продуктовые ограничения. Независимая проверка реализации по действующему процессу не отменяется.

Этот документ читается вместе с контрактами ниже. M0 закрывается после проверки пакета на точной версии и синхронизации Linear/FigJam; acceptance реализации сохраняется в следующих milestones.

## 15. Версионированные контракты и доказательства M0

| Артефакт | Что уточняет | Граница доказательства |
| --- | --- | --- |
| [ADR-001](editing-host-decision.md) | Один editing host, измеренные browser GAP и follow-through | DOM spike, не Rust renderer |
| [ADR-002](extensions-contract.md) | Schema/grammar/attrs, phases, codec/renderer admission, два профиля | Executable reference, production OSR-64 |
| [ADR-003](unicode-positions.md) | UTF-8/UTF-16/EGC, atoms, maps, undo, lifecycle | Expected vectors, production OSR-33/34/36/40 |
| [CMS inventory](cms-inventory.md) | Exact upstream SHA, consumers, corpus stages, limits, parity | Read-only source audit, не runtime CMS acceptance |
| [Performance protocol](performance-protocol.md) | Calibrated fixtures, budgets, noise, layout/crossing/core separation | Calibration, не performance готового engine |
| [UX contract](ux-contract.md) | 8 Figma frames, keyboard paths, modes, dialogs, RU/EN | Проектирование, не реализованный UI |
| [Decision register](decision-register.md) | Лицензия/права, corpus authority, support/ownership | Fact/accepted/proposal явно разделены |
| [Module and scenario contract](architecture-flows.md) | Входы/выходы/владельцы модулей, семь failure/success flows | Обязательства будущей реализации |
| [Delivery map](delivery-map.md) | Requirement→task→milestone, dependency DAG и exit gates | План принятия по evidence, не календарный прогноз |

В версии v2.0 закреплены точные правила ADR-002/003 и UX contract: structured attributes закрыты и ограничены; product dialog lifecycle принадлежит host; unsupported data не теряются; Firefox остаётся experimental. Эти изменения не превращают минимальные reference vectors в полную реализацию KWDJ.

## 16. Что изменили измерения производительности M0

[Полный baseline](../../evidence/osr-61/baseline.md) содержит 9 независимых запусков трёх bundled engines и 63 corpus-runs. Отдельная Chromium Event Timing серия имеет полное сопоставление 30 измеренных вводов во всех 21 corpus-runs. На конкретном смешанном RU/EN+emoji/combining тексте median run-p95 input-to-next-paint составил 232ms для одного leaf 262,144B и 424ms для восьми длинных leaves. WebKit full rebuild+layout около лимита bytes занял 5105ms, тогда как его native input proxy — 33ms: это разные пути, и нельзя назвать время полного перестроения задержкой каждой буквы.

Это обосновывает раннюю проверку incremental DOM patching и длинных текстов в OSR-39/38/46. Пока измерен только маленький String kernel без production validation/history/codecs, переносить его в Worker ради общей задержки оснований нет: Worker не исполняет browser layout. Rope также не исправит дорогой DOM. Оставляю String/main-thread/full-DOM как проверяемую исходную реализацию; меняем конкретный слой после сравнительного измерения production pipeline, а не весь стек по одному медленному числу.

Принята методика сравнения из [protocol](performance-protocol.md): одинаковая среда, interleaved серии, не менее пяти запусков, порог относительно baseline variance плюс абсолютный floor и подтверждение второй серией. 17 из 147 групп текущего baseline имеют CV >10% и не годятся для regression gate без стабилизации. Истинный allocator peak не измерен: отчёт разделяет точную WASM capacity, sampled process RSS и отдельную WebKit XPC серию. Кандидаты <1ms core / <50ms export / 400KB gzip остаются кандидатами до готового SDK.
