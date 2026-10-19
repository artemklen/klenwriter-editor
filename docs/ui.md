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
UI имеет normal-flow fallback. Stylesheet внешний; finite CSSOM positioning
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
