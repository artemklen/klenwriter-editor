// SPDX-License-Identifier: MIT OR Apache-2.0
import type { UiLocale } from './types.js';
const copy = {
  toolbar: ['Форматирование текста', 'Text formatting'], add: ['Добавить блок', 'Add block'],
  move: ['Переместить блок', 'Move block'], actions: ['Действия с блоком', 'Block actions'],
  picker: ['Выберите тип блока', 'Choose a block type'], empty: ['Ничего не найдено', 'No results'],
  loading: ['Открываем документ…', 'Opening document…'],
  readonly: ['Только чтение', 'Read-only'], disabled: ['Редактор временно недоступен', 'Editor temporarily unavailable'],
  composing: ['Завершите ввод, чтобы применить действие.', 'Finish typing to use this action.'],
  unavailable: ['Недоступно в этом документе.', 'Unavailable in this document.'],
  stale: ['Выделение изменилось. Выберите текст снова.', 'The selection changed. Select the text again.'],
  staleDialog: ['Документ изменился. Откройте окно заново.', 'The document changed. Open the dialog again.'],
  callback: ['Не удалось применить действие.', 'Could not apply the action.'],
  position: ['Блок перемещён на позицию {position}.', 'Block moved to position {position}.'],
  unchanged: ['Положение блока не изменилось.', 'Block position did not change.'],
  block: ['Блок {position}: {type}', 'Block {position}: {type}'],
  document: ['Документ', 'Document'], textBlock: ['Текстовый блок', 'Text block'],
  container: ['Контейнер', 'Container'], object: ['Объект', 'Object'], genericBlock: ['Блок', 'Block'],
} as const;
export function label(key: keyof typeof copy, locale: UiLocale): string { return copy[key][locale === 'ru' ? 0 : 1]; }
