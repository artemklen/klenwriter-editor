# DOM renderer и mounted SDK · OSR-39/40

`@klenwriter/editor-dom` создаёт одну редактируемую поверхность вокруг существующего
headless SDK2. Rust определяет документ, selection, IDs, команды, normalization и
history; DOM хранит только соответствие с текущим native view и ограниченный
provisional input. Контракт и независимые ожидаемые документы закреплены до кода
в [contracts/dom/v1](../contracts/dom/v1/README.md).
Selection/bookmarks, bounded edge autoscroll и минимальные plaintext copy/cut
описаны в [практическом руководстве](selection.md); их additive контракт —
[contracts/selection/v1](../contracts/selection/v1/README.md). Frozen basic39
контракт и его literals сохраняются.

## Подключение

Подключите статический `@klenwriter/editor-dom/style.css` обычным stylesheet.
Передайте пустой HTMLElement с именем через aria-label/aria-labelledby, полностью
заданную конфигурацию существующего SDK2
и явный renderer catalog. Для KWDJ catalog экспортируется отдельным subpath:

```ts
import { mountEditor } from '@klenwriter/editor-dom';
import { kwdjBasicRenderers } from '@klenwriter/editor-kwdj/dom';

const mounted = mountEditor({
  element,
  editor: sdk2Configuration, // input + options, при необходимости loader/limits
  renderers: kwdjBasicRenderers,
  onRecovery(packet) { retainRecovery(packet); },
  onRefusal(failure) { showRefusal(failure.diagnostic.code); },
});
const ready = await mounted.ready;
if (ready.status === 'ready') {
  const stamp = mounted.capture();
  // Обычные stamped read/query/submit и SDK Submission сохраняют свои значения.
}
```

Готовность наступает после native admission, проверки build/profile/registry,
покрытия реальных узлов и первого согласованного render/selection boundary.
До неё поверхность не редактируется, а facade сохраняет свою копию input.
При неуспешном mount исходные байты доступны через ready recovery и originalInput().
После готовности originalInput() освобождается; это не сохранение dirty-документа.
Обычные snapshot/save/release остаются явными SDK-действиями.

Профильные options/registry/facts задаются по [SDK2](extensions.md); сам renderer
не создаёт профиль и не меняет frozen registry. Финальный устанавливаемый vanilla
alpha API остаётся OSR-65. Bootstrap-пакеты приватны и не предназначены для publish.

## Покрытие и безопасное представление

KWDJ binding поддерживает точные12 типов: text/hard_break, paragraph/heading/
code_block, blockquote, bullet_list/ordered_list/list_item, task_list/task_item,
scene_break. Девять marks: strong/emphasis/strike/code/subscript/superscript,
text_color/highlight/link. SceneBreak — BlockAtom. MediaImage — неподдержанный
Container; table/verse/domain/reference_link также требуют других renderers.
Неизвестные composition/type/mark/attrs дают явный отказ, без flatten/delete.

Native build-time producer проверяет полный inventory из реальных публичных
registrations/FrozenRegistry; digest не заменяет проверку покрытия. Generic DOM
не импортирует KWDJ. Независимый [Notes D0](../examples/notes-extension/dom.mjs)
использует тот же adapter, сохраняет title/tags и не получает renderers Notes D1.

Все элементы/атрибуты/классы ограничены фиксированной политикой. Текст создаётся
через Text, никогда через HTML. Цвета выбирают статические классы; authored CSS,
скрипты и ресурсы не загружаются. Представление link ограничено http(s) и одиночным
root-relative path. Значения вне этой policy отказываются, не исправляются молча.
Ordered start0 сохраняется. HTML-представление start ограничено2147483647;
больший валидный native u64 не округляется. Если native structural normalization
порождает такое значение после commit, результат SDK остаётся Ok, lifecycle
становится recoveryRequired, onRefusal помечает alreadyPublished. Native документ
остаётся доступен для read и явного snapshot/save/release. Это не atomic refusal
и не обещание полного представления каждого native числового значения.

Закрытый command gate проверяет полный payload, targets, marks и stored marks.
Новые recipes/registry compositions требуют нового явного binding. Он проверяет
UI-покрытие, а семантическую допустимость и лимиты по-прежнему решает Rust.

## Input, selection и восстановление

Cancelable обычный input предотвращает browser default и вызывает native команду
синхронно. Native KWDJ DeleteBackward — command16: предыдущий pinned EGC через
соседние стили или совместимый paragraph/heading join. Noncollapsed Backspace/Delete
вызывает command17 DeleteSelection; collapsed Backspace сохраняет command16.
Before-history содержит исходный selection. SDK1/2 получают одинаковый закрытый
KWDJ DTO; новый mounted SDK2 read selection_text возвращает bounded native plaintext
projection. Старые payload/edit vectors сохранены, persisted schema не меняется.

Noncancelable text/split/join сопоставляется с ограниченным affected DOM region и
публикуется через native команду. Клонированный HTML id не даёт model identity.
Максимумы observation:8 blocks,131072 nodes, depth128,2097152 UTF16 units,
4096 mutation records; более строгие native/transport лимиты сохраняются.
Сначала проверяется бюджет, затем копируются данные. За лимитом actual DOM
сохраняется целиком и передаётся владельцу, без заявления полного захвата.

Узлы имеют собственные document-unique DOM IDs и WeakMap authority. Unaffected
DOM objects сохраняются при обычных patches; native undo/redo восстанавливает
исторические model IDs. Новое поколение replacement получает новые mappings.
Empty-block BR — только placeholder. Native selection сохраняет direction/affinity;
суррогатная середина не округляется. Публичные ошибки native positions остаются
position.invalid с исходными code/path/category; JS не сегментирует EGC.

Перед удалением выбранного пустого text block renderer может перенести DOM range
на текущий native `event.selection_after`, если оба endpoint уже соответствуют
одному неизменившемуся owned Text. Проверяются connected topology, ancestors,
identity и presentation; перенос происходит до первой структурной DOM mutation.
Child/edge/new targets и provisional/composing используют обычный final restore.
Native affinity сохраняется. Этот порядок DOM patch не добавляет SDK submit,
document event или history unit; final selection restore остаётся обязательным.

При непосредственном keyboard Tab entry из внешнего host control в mounted host
адаптер восстанавливает **текущий** native selection до синхронизации browser reset.
Один focus-return не меняет native stamp, документ, history или identities; после
редактирования используется текущая каретка, а не начальная позиция mount.
Это узкий keyboard-entry guard с проверками lifecycle/busy/provisional/composing,
не перехват намеренного pointer selection. SelectionOwner теперь также обслуживает
owned keyboard/pointer selection, явные bookmarks и bidirectional edge autoscroll;
точные правила stale/focus/visibility и ресурсы приведены в [selection guide](selection.md).

Активный composing subtree защищён. Совместимое редактирование другой области
проверяет, что защищённые objects/rows не меняются; конфликт явно отказывается.
После compositionend не выполняется предполагаемое settlement: unresolved input
сохраняется для восстановления. Полный exactly-once IME controller — OSR-41.

`destroy()` сначала сохраняет bounded original/provisional input либо actual DOM
reference при overflow, блокирует мутации и возвращает typed receipt с настоящим
SDK destroy Submission. Callback вызывается синхронно вне native borrow; его throw
не лишает receipt восстановления. Callback и receipt имеют разные копии бинарных
данных. Повторный destroy возвращает тот же receipt. При retained_dom actual subtree
не очищается. Владение этим reference передано host; его дальнейшие изменения
принадлежат host. Recovery не заменяет явное сохранение committed dirty-документа.

## Modes и замена документа

`setInteractionMode('editable'|'readOnly'|'disabled')` меняет UI guard без remount,
новых IDs или history reset. Native read_only нельзя повысить до editable.
Read-only оставляет текст для выделения/copy/Find. Disabled убирает editing focus,
а host recovery controls остаются достижимы. На изначально editable Session host
programmatic submit разрешён при действующих native/capability/composition guards.

`replace(input)` выполняет временную реальную SDK2 admission и renderer preflight
с owned options/facts/limits/registry, освобождает временный Session на каждом пути
и повторно проверяет capture/context перед настоящим remount. При pending native
работе, reentrant forwarding/delivery или второй replace возвращает dom.busy;
DOM не добавляет очередь или retry. Смена composition/capture даёт явный отказ.
Успех меняет generation и сбрасывает history/maps/events/saved baseline, затем
выполняет один полный render: native remount не создаёт обычного document event.
Native selection `null` очищает браузерные ranges внутри этого host; выделение
другого mounted instance или host control сохраняется.
Отказ до публикации оставляет прежний Session и DOM. Факты/profile/registry меняются
через нового owner и admission, а не replace или скрытый update_facts.

## Проверки

`npm run test:dom` использует настоящие built packages/WASM, строгий CSP и literals
T01–T12 в Chromium/WebKit/Firefox, сохраняет native rows, canonical, events,
DOM selection, IDs и resources в artifacts/dom. Это измерения automated engines.
Installed Chrome/Safari RU/EN input и keyboard/focus имеют отдельные traces и
точные версии; WebKit не доказывает Safari. Firefox experimental, ошибки harness
не превращаются в skip. Playwright Firefox `keyboard.insertText('я')` в измеренном
engine проходит через composition events: basic39 сохраняет этот символ в
provisional DOM и recovery receipt, оставляя committed state неизменным до OSR-41.
Это отдельный preservation oracle, а не proof ordinary RU commit или IME settlement.
Fixture CSP разрешает только точный local `/favicon.ico` с ответом204 для
автоматического запроса браузера; default/script/style ограничения и проверка
отсутствия CSP violations сохраняются. `npm run test:selection` добавляет отдельные
native/WASM, controlled controller/platform и mounted selection cases; наличие
реализации не заменяет фактическое acceptance evidence. Полные IME/clipboard/domain/
security/alpha acceptance остаются соответствующим OSR-41/47/50/67/65. CI остаётся build-only;
обязательные проверки выполняются локально на точной поставляемой ревизии.

### Installed native input на macOS

Ниже сохранён basic39 foundation protocol. Расширение installed Chrome/Safari EN/RU
протокола для selection40 (в том числе held drag и OS clipboard readback) требует
отдельной проверки; эти команды сами по себе не утверждают покрытие selection40.

После локального pre-send gate используйте pinned Node 24.22.0, установленные Chrome и
Safari и уже выданные macOS Automation/Accessibility grants. Для первоначального
Safari bootstrap нужен JavaScript from Apple Events. Скрипты не меняют настройки.
Каждому запуску нужен новый абсолютный output path вне checkout; исходники должны
быть committed и чистыми, built packages/WASM — соответствовать этому SHA.
Один localhost fixture server занимает 127.0.0.1:4174; запускайте браузеры последовательно.

Для Chrome запустите обычный fixture server, затем в другом Terminal:

```sh
node scripts/workspace-server.mjs
```

```sh
node scripts/dom-native-acceptance.mjs --browser chrome --output /tmp/editor-chrome-001/chrome.json
```

Остановите обычный server перед Safari. Его отдельный opt-in server создаёт
свежие nonce/title/config и ограниченный same-origin command/result канал:

```sh
node scripts/dom-native/server.mjs --directory /tmp/editor-safari-001
```

В другом Terminal выполните:

```sh
node scripts/dom-native-acceptance.mjs --browser safari --output /tmp/editor-safari-001/safari.json --broker /tmp/editor-safari-001/config.json
```

Apple Events создаёт и bootstrap-ит одно обычное Safari окно. Дальнейшие fixture
команды используют HTTP; реальные клавиши отправляет System Events. Перед каждой
клавишей новый page guard подтверждает URL/title, connected mounted host, focus
и точный target. System Events немедленно проверяет уникальный nonce title
foreground-окна. Срок guard ограничивает весь процесс отправки; неизвестный исход
прекращает дальнейший ввод и сохраняется как `may_have_sent`.

Канал допускает только закрытые fixture методы и один неподтверждённый request.
Page отмечает request ID до выполнения; потеря ответа не повторяет native команду.
Сохранённый результат остаётся до явного acknowledgement. Ограничены число команд,
байты запросов/ответов/logs, polling и абсолютные deadlines; обычный server сохраняет
свои routes/CSP. Эти endpoints существуют только у явно запущенного native server.

Обе локали должны пройти 8 checkpoints: focus, typing, split/join, public-host
undo/redo, delete-last и focus-return. Receipt сохраняет exact canonical/native
selection/revision/history/IDs, trusted UA trace и actual System Events exits.
Отмена cancelable beforeinput проверяется в document bubble; capture-listener
microtask имеет отдельное точное имя и не считается post-dispatch наблюдением.
Public-host undo/redo не является keyboard-shortcut proof.

Safari cleanup отправляет один guarded CmdW только текущей fixture-вкладке и
проверяет исчезновение её уникального AX title. Native zero resources подтверждает
отдельный `finish`, а не закрытие вкладки. Исходная input source восстанавливается
в finally. До и после запуска проверяются HEAD, чистый tracked tree, source/dist и
broker-config hashes. Любая ошибка assertions, ресурсов, cleanup, восстановления
раскладки или source identity оставляет итог FAILED/NOT_RUN. Остановите server
после получения receipt; config и raw broker/client logs сохраняйте вместе с ним.
