# Mounted selection, bookmarks и plaintext clipboard

SDK2 mount использует один SelectionOwner и существующую SDK mutation queue.
Rust остаётся единственным источником range semantics, maps, EGC admission,
normalization и history. Generic DOM не импортирует KWDJ policy и не создаёт
второй Session. Basic mount, renderer bindings и recovery описаны в
[DOM guide](dom.md), additive frozen contract — в
[contracts/selection/v1](../contracts/selection/v1/README.md).
Два явных authoring errata сохраняют исходные frozen bytes: [пустой Unicode
input](../contracts/selection/errata/001-empty-unicode-input.md) и [mixed-mark
typing group](../contracts/selection/errata/002-mixed-mark-typing-group.md).
Корректный пустой документ и положительные history witnesses берутся из уже
существовавших frozen данных; native admission/grouping policy не меняется.

## Прочитать, синхронизировать, сохранить

`mounted.read({kind:'state'})` читает native state без синхронизации browser range.
Обычный owned input синхронизирует актуальный DOM selection перед командой.
`captureBookmark()` — тоже чистое чтение: при активном owned DOM range, который
не совпадает с native selection, возвращается `dom.selection_unsynchronized`.
Скрытого set_selection или flush при capture нет. Если focus принадлежит внешнему
control, сохраняется текущий model selection без захвата чужого DOM range.

```ts
const captured = mounted.selection.captureBookmark();
if (captured.status === 'captured') {
  const result = mounted.selection.restoreBookmark(captured.bookmark, {
    policy: 'exact', // default; 'mapped' выбирается явно
    focus: true,    // default false
  });
  if (result.status === 'queued') {
    const response = await result.completion; // исходный SDK Promise/response
    consumeNativeResponse(response);
  } else if (result.status === 'completed') {
    consumeNativeResponse(result.response);
  } else {
    showFailure(result); // dom_refused либо sdk_failure
  }
  mounted.selection.releaseBookmark(captured.bookmark);
}
```

Opaque handle принадлежит одному mount и не сериализуется. Копия object или handle
другого mount не получает его полномочия. Максимум64 живых handles; release
возвращает true один раз. Restore consumes handle при dispatch; preflight/busy
refusal сохраняет его. `.selection` имеет стабильную identity до ready и после
destroy, но операции возвращают соответствующий lifecycle refusal.

`exact` проверяет весь stamp, context, generation и неизменённый intent.
`mapped` дополнительно вызывает native map_position для обоих endpoints;
deleted/stale/invalid/null mapping не превращается в угаданную каретку. Только
прямой синхронный programmatic document command с ожидаемым document publication
и без reentrant mutation может сохранить такую continuity. Новый pointer/key/
selection intent, host set_selection (даже native no-op), history, state-only
mutation или неизвестное происхождение делают старый handle stale. Undo может
вернуть прежние IDs, но не разрешает восстановить устаревшее user intent.
Повторный capture не оживляет старый handle.

Native selection null сохраняется как null. `focus:true` для null возвращает
`dom.selection_missing`; focus:false не выбирает произвольную каретку. UI readOnly
разрешает selection, disabled/composing/provisional/busy отказывают. Mode change
сохраняет handles, но прекращает активный drag. Начавшийся replace attempt
инвалидирует handles и при последующем admission refusal; destroy освобождает их.
Keyboard Tab return восстанавливает **текущий native selection**. Явный restore
не крадёт внешний focus без focus:true; после focus callbacks owner проверяется
повторно. Новая subscriber selection не переписывается поздним DOM restore.

Возвращается исходный SDK Submission. Уже queued ticket не отзывается и не
отправляется повторно. Если native commit состоялся, а presentation/focus guard
позже перестал выполняться, native Ok остаётся Ok; DOM сообщает отдельную ошибку
с publication provenance. Busy проверяется до добавления новой работы в queue.

## Координаты и жесты

Text/Child/Edge и affinity сохраняются из native. `PositionDto.text.offset`
остаётся числом **UTF-16 units**, а не scalar index. DOM bridge проверяет scalar
boundary; середина surrogate pair не округляется. Scalar-readable endpoint ещё
не гарантирует EGC-editable range: это решает Rust command admission без
`Intl.Segmenter`. Новый DOM endpoint получает After; известный native endpoint
сохраняет Before/After. Direction не сортируется и не теряется.

Owned Cmd/Ctrl+A публикует root Child0/After → Childlen/After; вне mounted host
обычный browser Select All не перехватывается. Noncollapsed Backspace/Delete
использует KWDJ DeleteSelection17; collapsed Backspace сохраняет DeleteBackward16.
Selection-only native effects не создают document revision/undo entry; selection
epoch, stored marks и grouping barriers следуют настоящей native операции,
а не восстанавливаются из JS bookmark.

Edge autoscroll принадлежит одному primary left-mouse pointer и одному RAF.
Сдвиг ограничен24CSSpx/frame; поддерживаются axis-aligned rectangular clipping,
ближайший vertical scroll owner и viewport, максимум32 ancestors. Transforms,
nonrectangular clips, missing/zero-area geometry отказывают явно. Перед каждым
явным edge-focus publication выполняется не более8 настоящих browser hit/caret
probes: **весь** collapsed focus-caret rect должен быть видим внутри viewport и
всех relevant clipping ancestors. Модельные endpoints не вычисляются по номеру
строки. Release/cancel/lost capture/blur/другой focus owner/mode/provisional/
replacement/recovery/destroy прекращают RAF; post-release исправления endpoint нет.

## Copy и cut: два разных эффекта

```ts
const result = await mounted.clipboard.copy(); // либо cut()
showClipboardResult(result.status, result.clipboard);
```

Операция требует active owned host и точного DOM/native range. ReadOnly copy
разрешён; cut требует UI editable и native editable. Native read_only cut даёт
`dom.native_read_only`, UI readOnly — `dom.mode_blocked`. Host control/другой mount
не получают неявный selection restore. Native SDK2 `selection_text` — чистый,
stamped bounded plaintext read; SDK1 его не принимает.

Одна операция на mount, максимум1MiB retained UTF-8 payload,15s deadline writer.
По умолчанию используется owning document navigator.clipboard.writeText;
`MountEditorOptions.clipboard.writeText` задаёт trusted host adapter, а onResult
получает итог после cleanup. Writer должен вернуть Promise. Event DataTransfer
не считается подтверждением OS write. Cut сначала делает полный native query,
потом ждёт подтверждённый write, повторно проверяет stamp/context/intent/ownership
и отправляет ровно один isolated DeleteSelection. Старый destructive target
не map-ится и не переустанавливается.

| status | Что произошло |
| --- | --- |
| copied | Writer подтвердил write; native delete не отправлялся. |
| cut | Write подтверждён, исходный native ticket завершился document change. |
| empty | Семантически пустой range; ни write, ни command. |
| refused | Отказ до write. |
| write_failed | Write не подтверждён; native delete не отправлялся. |
| copied_but_not_cut | Write подтверждён, но target устарел либо native отказал/вернул no-op. |
| indeterminate | Native fatal/unknown; сохранены исходный ticket и may_have_committed. |

Atom-only nonempty range может записать пустой текст и удалить atom; это не empty.
Cancel/deadline освобождает owned payload, но не умеет отменять внешний Promise:
unconfirmed write ещё может завершиться вне библиотеки. Новое user intent после
confirmed write даёт copied_but_not_cut, без позднего удаления. Destroy подавляет
host callbacks; уже отправленный native queued ticket остаётся учтённым до своего
фактического terminal. onResult throw не меняет результат или cleanup.

## Ресурсы и проверки

`resources().selection` содержит bookmarks/restoreTickets/activePointers/
animationFrames; `.clipboard` — pending/continuations/retainedTextBytes.
Исходный пятикомпонентный `.dom` сохранён. После destroy listeners/pointer/RAF/
handles освобождаются; уже queued continuation не объявляется завершённым раньше
native terminal. Host может показать persistent polite stale сообщение через
onRefusal: EN “The selection changed. Select the text again.” или RU “Выделение
изменилось. Выберите текст снова.” Не объявляйте каждую каретку через live region.

После соответствующего build выполните `npm run test:selection`. Команда проверяет
frozen contract pins, native/compiled-WASM data comparator, отдельные Node suites и
mounted browser cases. Controlled SDK/platform boundaries, actual WASM semantics,
automated browser input и installed Chrome/Safari EN/RU evidence имеют отдельные
labels. WebKit не считается Safari; synthetic pointercancel не доказывает physical
cancel, writer resolution не заменяет OS clipboard readback, axe — real AT acceptance.
Этот guide описывает реализацию и её protocol; фактические acceptance результаты
фиксируются отдельно. Готовые native39 commands сохранены в [DOM guide](dom.md).

Для installed selection40 нужны committed clean checkout, соответствующий полный
build и pinned Node24.22.0; Node process запускается с обычным окружением macOS.
Закрытый fixture использует существующие Accessibility/Automation grants и только
уже включённые US/Russian input sources. Настройки разрешений не изменяются.
Подготовленный harness проверяет13 фиксированных случаев в EN/RU; его фактический
успех устанавливает только receipt конкретного запуска, а не наличие команд:

```sh
node scripts/workspace-server.mjs
```

В другом Terminal:

```sh
node scripts/selection-native-acceptance.mjs --browser chrome --output /tmp/selection-chrome-001/chrome.json
```

Остановите обычный server перед Safari. Создайте свежий output directory вне
checkout; не переиспользуйте истёкший broker:

```sh
node scripts/selection-native/server.mjs --directory /tmp/selection-safari-001
```

В другом Terminal:

```sh
node scripts/selection-native-acceptance.mjs --browser safari --output /tmp/selection-safari-001/safari.json --broker /tmp/selection-safari-001/config.json
```

Safari Apple Events ограничены созданием отдельного окна и bootstrap. После них
closed HTTP protocol отмечает request до выполнения и сохраняет result до явного
ACK. Перед каждым platform input новый page guard плюс exact unique AX title и
viewport подтверждают owned fixture; неизвестная доставка прекращает дальнейший
ввод. Для pointer cleanup допускается лишь отдельный один guarded release; он не
превращает failed case в PASS. CGEvent — platform input, не аппаратная мышь.
OS clipboard читается только после подтверждённой записи самого fixture. Новый
receipt содержит actual trusted trace, геометрию, ресурсы, source/dist/helper
hashes, точные browser versions и восстановление первоначальной раскладки.

Full IME settlement41, paste/HTML/multiformat/sanitization clipboard47 и complete
UI/localization/assistive-technology66 остаются отдельными задачами. Они не
реализуются неявно этой plaintext selection surface.
