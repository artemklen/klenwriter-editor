# Toolbar, gutter и host dialogs

`@klenwriter/editor-ui` — необязательный пакет поверх публичных DOM/SDK2:
toolbar, Add с выбором блока, gutter и меню перемещения. Host/profile передаёт
factories typed commands; Rust определяет availability, изменение, normalization,
selection и undo. Generic UI не импортирует KWDJ, CMS или frontend framework
и не создаёт вторую Session. Пакет private, bootstrap `0.0.0`, публикация OSR-71.

[Контракт OSR-42](../contracts/ui/v1/README.md) содержит API и независимые
ожидания, закреплённые до реализации. Работающий host с KWDJ factories и настоящей
NotesD0 form находится в [acceptance fixture](../spikes/workspace/ui-host.js).
Это test host, отдельный от vanilla alpha и CMS integration.

## Подключение и lifecycle

Host вызывает `mountEditor`, загружает внешние stylesheets
`@klenwriter/editor-dom/style.css` и `@klenwriter/editor-ui/style.css`, затем
`createEditorUi({editor, editorElement, slots, locale, profile, onResult})`.
Три slots — разные connected HTMLElement одного документа, вне editing root,
без вложения друг в друга и без editing root внутри: `toolbar`, `gutter`, `entry`.
UI владеет только своими потомками. `editorElement` — исходная embedding-ссылка
для событий; она не предоставляет authority на команды.

`profile(context)` возвращает следующие поля:

| Поле | Содержимое |
| --- | --- |
| `toolbar` | `command`, `toggle` или opaque host action с RU/EN labels |
| `insertions` | Команды Add в заранее захваченную native позицию |
| `blockActions` | Прямые host actions выбранного блока |
| `moves(context)` | Кандидаты up/down/nest/unnest: command или причина unavailable |

Context содержит неизменяемые native state/catalog и факты node/parent/index/
ancestors. Factory создаёт данные, не изменяет редактор. UI запрашивает и
исполняет один payload/current stamp. KWDJ host явно импортирует `kwdjCommand`
из профильного пакета; другой профиль предоставляет свои factories.

`createEditorUi` возвращает `EditorUi` или typed failure. Дождитесь `ui.ready`.
`ui.setLocale('ru' | 'en')` сохраняет keyed controls и focus. Используйте
`ui.setInteractionMode(mode)`; после прямого mounted mode/replace/destroy нужен
`ui.refresh()` в том же переходе. Native mode event не предполагается.
`ui.destroy().settled` завершает собственные continuations; редактор уничтожается
отдельно. `resources()` учитывает listeners, observer, RAF, subscription, requests
и continuations.

UI подключает собственные composition/input listeners после `editor.ready`,
поэтому mounted owner обрабатывает terminal раньше presentation даже при создании
UI во время загрузки. Terminal заменяет старый собственный RAF: два конечных
обновления идут после owner, включая zero-change settlement без native event.
Лимит одного собственного RAF и общее число listeners сохраняются.

## Keyboard и команды

Toolbar имеет имя и один roving Tab stop. Left/Right, Home/End перемещают focus;
Tab/Shift+Tab выходят. Недоступные controls discoverable через `aria-disabled`
и видимую причину. Toggle использует свежие native on/off/mixed; mutation
presentation может содержать состояние ДО действия.

Add захватывает selection до ухода focus. Paragraph в root gap создаёт один
пустой блок. В позиции1 внутри `ab` та же команда создаёт `a`, пустой paragraph
и trailing `b`, с caret в trailing text. UI не делает предварительный
`set_selection` для имитации вставки после блока. Slash parsing — OSR-43.

Move показывает target/type/position/breadcrumb. Up/down/Nest/Unnest используют
native Move. `before_index` задаётся ДО удаления исходного блока: B в A/B/C
двигается вниз через index3. Alt+Up/Down/Left/Right работают только внутри move
control/menu и означают up/down/unnest/nest. Native Find/document shortcuts
сохраняются. Профиль проверяет контейнеры: вынос единственного ребёнка из quote
может быть refused, без удаления обёртки в JS. Physical DnD — OSR-44.

Контекст использует локализованные generic primitive names и путь native
ancestors, например «Документ / Контейнер». Он связан с Move и меню через ARIA;
технические node/type IDs не служат пользовательскими подписями.

Composition блокирует конфликтующие controls, сохраняя native provisional input.
Read-only сохраняет selection/copy/Find; disabled не предоставляет editing focus.
После отказа требуется новое явное действие; позднего replay нет.
Live status очищает истёкшую причину availability после проверенного восстановления.
Независимые сообщения о результате, отказе команды или host dialog сохраняются
при обычном refresh. Частная provenance каждого writer определяет это поведение;
совпадение текста не определяет владельца сообщения.
Причина недоступности остаётся в `aria-describedby` и показывается при hover/focus
вне flow controls; focus имеет приоритет. Она не сдвигает editor или Add. Floating
gutter сохраняет scroll bounds и показывает причину в ограниченной viewport-panel
для обычного embedding; transformed/clipped hosts не получают обещания escape.

Pointer click связан с тем же control и genuine request, который захвачен на
его pointerdown. Если down отклонён или исходный request инвалидирован сменой
selection/stamp/mode, этот click поглощается без повторного capture. Новый down
проверяется заново; Enter, Space и zero-detail keyboard/AT entry сохраняют свои
существующие пути. Контролируемый zero-detail тест не подтверждает реальную AT.

## Host-owned dialog

`defineUiHostAction<T extends UiJson>` связывает paired labels, заранее connected
`scope`, `open({context, signal, accept, cancel})` и command factory результата.
`open` возвращает cleanup function. Host владеет содержимым, named modal scope,
начальным focus, Tab trap только при реальной модальности, Apply/Cancel/Escape,
fetch/auth и освобождением своих ресурсов. UiJson — данные, HTML не вставляется.
Предел результата: 64KiB UTF8 JSON, depth32,4096values; labels256/id128 UTF16 units.
В каждой группе максимум32actions; одновременно один popup/request/RAF/observer.

Mounted `hostRequests.capture({focusScope})` захватывает genuine SDK request,
exact bookmark, полный stamp/context и intent до ухода focus. Scope — connected
HTMLElement того же документа, вне editing root и не содержащий его. Hidden
scope можно создать заранее. Копия descriptor не получает authority.

`complete(request, command, {focus:'native_result' | 'none'})` — одна terminal
попытка. Старый bookmark не восстанавливается перед SDK completion. Original
Submission/Ok/Refused/fatal/queued сохраняется; отдельный `focus` promise сообщает
restored/not_requested/not_restored. Возврат focus требует continuity исходного
native result и той же connected scope, всё ещё владеющей focus. Reentry, новые
tokens, внешний focus, replace/mode/destroy исключают focus theft.

`cancel` использует exact restore и default focus:true. Он не создаёт document
transaction, но может иметь штатные selection/history barrier эффекты. UI передаёт
focus:false, если focus уже забрал внешний control. Stale bookmark не разрешает
угадывать caret. `release` не отправляет команду и не меняет focus; true означает
ещё live/exact request, stale authority освобождается с false. Смена UI lease
использует этот live proof и исходные tokens, без hidden retry.

Requests отзываются при изменении intent/tokens/context/generation, реальном mode
transition, replace attempt, recovery/fatal/destroy. Pure reads/query сами не
устаревают. Selection40 bookmarks сохраняют прежние invalidation rules;
prospective result focus не оживляет старый bookmark. Mounted resources отдельно
показывают pending requests/focus continuations. SDK cap128 и shared bookmark
cap64 — разные ограничения.

## Geometry, CSP и проверки

`editor.geometry.read` измеряет `block`, `block_at_point` или текущую native
`selection` с exact stamp. Результат — immutable CSS-client rectangles/context/
target. Доступны genuine text_block/container/block_atom; clones, detached
objects и stale tokens получают typed refusal. Measurement в read-only/disabled
не даёт editing permission. Оно не меняет browser/native selection, focus,
scroll или history и получает свежий layout на каждом вызове.

`rects` сохраняют UA order; anchor/focus направлены по native range. Невозможный
anchor даёт geometry_unsupported; focus может быть null. `visible` означает
пересечение хотя бы одного fragment/caret с clip, не видимость всего выделения.
Пределы: 256rawrectangles,128distinct inspected ancestors,1024selected objects.
Heterogeneous clipping, transforms, CSS zoom, vertical writing, rounded clipping
и iframe могут быть unsupported. Page zoom измеряется в CSS coordinates.
Toolbar располагается рядом с видимым native selection/caret, когда над ним
или под ним достаточно места. Собственный flow box сохраняется, поэтому
позиционирование не сдвигает документ. При unsupported/busy/stale geometry,
невидимом выделении или нехватке места сохраняется исходный sticky/normal-flow
entry с теми же controls и Tab order. Geometry не предоставляет authority
для действия. Пока принадлежащий UI pointer gesture удерживает фактическую
`:active` кнопку, обычный refresh сохраняет положение toolbar/gutter до click.
Доступность обновляется независимо; отклонённый down не становится действием.
После click следующий существующий RAF возобновляет текущую geometry. Fatal/disposal
cleanup не задерживается; release вне UI допускает возобновление при следующем
обычном refresh без нового глобального pointer listener.
Stylesheet внешний; finite CSSOM positioning
проверяется под strict CSP, без unsafe-inline и переноса UA-style exception на UI.

`npm run test:ui` выполняет frozen data check, actual native/packaged WASM semantic
vectors, controlled owner policy tests, declaration consumer и mounted
Chromium/WebKit/Firefox checks. Controlled faults/queues, реальные browser events
и installed input — отдельные evidence lanes. Installed Chrome/Safari RU/EN
проверяются на финальной source/build версии. WebKit не является Safari;
labels/axe не подтверждают real screen-reader acceptance. Delivery gates —
CONTRIBUTING; CI остаётся build-only.

Конечный [installed protocol](../contracts/ui/v1/installed-matrix.md) и
[его runner](../scripts/ui-native/README.md) разделяют физические действия,
подготовку через host API и наблюдение native-вызовов. Проверки input owner в
`test:ui:unit` используют процессы-заглушки; компиляция Swift/AppleScript и эти
тесты сами по себе не подтверждают ввод в установленном браузере.

## Optional slash/insertion picker — OSR-43

`UiProfile.slash?: UiSlashProfile` добавляет `textBlockTypes` и `choices`.
Choice содержит уникальный `id`, paired `label:{ru,en}`,
`keywords:{ru:string[],en:string[]}` и `command(captured, slash)`.
`slash` — `{range,literal}` из committed native text либо `null` для Add.
Профиль без поля сохраняет toolbar/insertions/moves42. Generic UI не
импортирует KWDJ/CMS и не проверяет семантику в TypeScript.

Optional KWDJ package экспортирует `kwdjSlashCandidates` (9 immutable IDs/targets)
и `kwdjSlashTextBlockTypes` (native paragraph/heading). Они генерируются из Rust;
labels/keywords поставляет host. Factory строит `accept_slash` с точными
`range/literal/target`, либо `insert_block` для `null`. Каждый payload проходит
actual native query перед execute. Недоступная known choice остаётся видимой
с причиной; future providers не появляются автоматически.

Начальный trigger — одиночный ordinary `insertText` `/` в начале блока либо
после ASCII space/tab. Slash/query уже входят в snapshots/recovery. Midword/URL,
multi-character paste, composition и ambiguous/stale origin не открывают меню.
До256 UTF-16 units включая `/`; ASCII whitespace закрывает query. Filtering —
substring по текущим labels/keywords/ID, fixed ASCII/Cyrillic case fold, без
normalization/fuzzy search. Exact document literal не изменяется поиском.

Focus остаётся в editor. Up/Down меняют active option, Enter выполняет один
native accept, Escape сохраняет текст, Tab закрывает и следует page order.
No-results/disabled Enter не создаёт paragraph. Native modifiers/Find не
перехватываются. Устаревший frame отказывает собственным Enter/Escape/Up/Down:
клавиша не становится обычной вставкой paragraph и не получает новую authority.
Committed query сохраняется; дальнейший RAF не возобновляет закрытый anchor.
Shared Add открывает тот же catalog без выдуманного range,
сохраняя pre-focus request42. Accept сохраняет native topology
prefix + target + copied-header trailing block. Один Undo возвращает точный
pre-accept literal, а не всю последовательность ordinary typing.

`editor.read({kind:'text_window',stamp,before_utf16,after_utf16})` — ABI2 pure read.
До256 UTF-16 output,32768 cumulative decoded scalars,1024 node visits,
128 root-inclusive path nodes и256KiB conservative reply bound. Spans имеют
native IDs/source offsets и явные block/BR/atom/window boundaries. Reader не
копирует весь leaf/child array и не меняет native state/history/resources.
Long-tail caret использует cached end; слишком глубокий interior даёт явный
`text_window.source_scan_limit`. Это предел нового lexical read, не legacy42
Node reads. При отказе нет DOM/textContent fallback.

`inputObservations.subscribe` сообщает только завершённый свежий изменившийся
ordinary input с bounded native before-window witness. Composition-owned path
не становится ordinary по inputType/publication. Данные immutable, trust
сохраняется как наблюдение. UI callback делает bounded pure read и удерживает
один lexical seed; существующий RAF заново сверяет native tokens. Подписчик
не получает command/focus/selection authority. Максимум32 subscribers.

`popupPresentation.open` возвращает один owned handle для genuine outside
listbox/option. На textbox он владеет только haspopup/controls/active-descendant;
expanded принадлежит shared Add button. Dispose восстанавливает свои attrs,
сохраняя foreign edits. ARIA handle не является bookmark. Activation использует
genuine request42 и original Submission без recapture/replay.

При неподдерживаемой caret geometry меню остаётся привязано к entry/Add;
этот fallback не восстанавливает selection и не прокручивает документ.
Active-option scrolling меняет только scrollTop самого listbox с пересчётом
его локальных CSS units. Controlled CSS zoom и native browser zoom учитываются
как отдельные проверки; они не заменяют друг друга.

Контракты: [slash v1](../contracts/slash/v1/README.md) и отдельные
[source clarifications](../contracts/slash/v1.1/ordinary-presentation-coalescing.md).
`npm run test:slash` проверяет source/native/sealed/controlled lanes; browser
cases входят в `test:ui:browser`. Installed Chrome/Safari EN/RU, real AT и CMS
cutover имеют отдельное evidence. CMS49 включает query/accept/undo, Escape/Tab,
no-results/refusal, shared Add, stale result и composition suppression в
обязательный cutover checklist; эти сценарии не откладываются как polish.

Отдельная [installed43 matrix](../contracts/slash/installed-v1/freeze-decisions.md)
содержит20 фиксированных EN/RU строк на каждый установленный браузер.
[Runner43](../scripts/slash-native-acceptance.mjs) использует отдельные protocol/
helpers и прежние42 файлы не меняет. Native ACK, trusted DOM events, native
payload/history и cleanup сохраняются раздельно. Missing composition opportunity
остаётся UNOBSERVED; compile/stub/Playwright результаты не считаются installed PASS.
