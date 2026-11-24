// SPDX-License-Identifier: MIT OR Apache-2.0
import type { MountedEditor } from '@klenwriter/editor-dom';
/** Profile-specific command construction; all semantic checks remain in Rust. */
export { artifactStage } from '@klenwriter/editor-sdk';
import { createCommand } from '@klenwriter/editor-sdk';
import type { CommandDto, DeepReadonly, KwdjForwardDeleteIntentV2, KwdjIntentDto, KwdjLabeledContainerIntentV2, KwdjLiteraryIntentV2, KwdjScopedSelectionIntentV2, KwdjTableCellAlignIntentV2, KwdjTableCellIntentV2, KwdjTableColumnIntentV2, KwdjTableRowIntentV2, KwdjWarningIntentV2, RawInputRestoreV2 } from '@klenwriter/editor-sdk';

export type { KwdjForwardDeleteIntentV2, KwdjIntentDto, KwdjLabeledContainerIntentV2, KwdjLiteraryIntentV2, KwdjScopedSelectionIntentV2, KwdjTableCellAlignIntentV2, KwdjTableCellIntentV2, KwdjTableColumnIntentV2, KwdjTableRowIntentV2, KwdjWarningIntentV2, TableCellAlignV2, BlockTargetDto, ListKindDto, MarkDto } from '@klenwriter/editor-sdk';

type KwdjCommandIntent = KwdjIntentDto | KwdjLiteraryIntentV2 | KwdjWarningIntentV2
  | KwdjLabeledContainerIntentV2 | KwdjForwardDeleteIntentV2 | KwdjScopedSelectionIntentV2
  | KwdjTableRowIntentV2 | KwdjTableColumnIntentV2 | KwdjTableCellAlignIntentV2 | KwdjTableCellIntentV2;
const commandNames: Record<KwdjCommandIntent['kind'], string> = {
  enter: 'enter', shift_enter: 'shift-enter', toggle_mark: 'toggle-mark',
  set_link: 'set-link', unset_link: 'unset-link', insert_text: 'insert-text',
  transform_block: 'transform-block', toggle_quote: 'toggle-quote', toggle_list: 'toggle-list',
  insert_block: 'insert-block', move: 'move', duplicate: 'duplicate', remove: 'remove',
  accept_slash: 'accept-slash', dismiss_slash: 'dismiss-slash',
  delete_backward: 'delete-backward',
  delete_forward: 'delete-forward',
  insert_row_above: 'insert-row-above', insert_row_below: 'insert-row-below', delete_row: 'delete-row',
  insert_column_left: 'insert-column-left', insert_column_right: 'insert-column-right', delete_column: 'delete-column',
  set_table_cell_align: 'set-table-cell-align',
  merge_cells: 'merge-cells', split_cell: 'split-cell', move_cell: 'move-cell',
  delete_selection: 'delete-selection',
  set_literary_kind: 'set-literary-kind',
  wrap_literary_block: 'wrap-literary-block',
  unwrap_literary_block: 'unwrap-literary-block',
  set_container_label: 'set-container-label',
  wrap_labeled_container: 'wrap-labeled-container',
  unwrap_labeled_container: 'unwrap-labeled-container',
  set_warning_kind: 'set-warning-kind',
  wrap_warning: 'wrap-warning',
  unwrap_warning: 'unwrap-warning',
};

/** Numeric metadata, revision/group tokens and ordered-list starts remain strings. */
export function kwdjCommand(intent: KwdjCommandIntent): CommandDto {
  const kind = intent && typeof intent === 'object' ? Object.getOwnPropertyDescriptor(intent, 'kind') : undefined;
  if (!kind || !('value' in kind) || typeof kind.value !== 'string' || !Object.hasOwn(commandNames, kind.value)) {
    throw new TypeError('sdk.invalid_command_kind');
  }
  const name = commandNames[kind.value as keyof typeof commandNames];
  return createCommand(`org.klenwriter.kwdj/command/${name}`, intent);
}

type ToolbarStamp = NonNullable<ReturnType<MountedEditor['capture']>>;
interface KwdjTableToolbarContext {
  readonly state: { readonly stamp: ToolbarStamp };
  readonly catalog: readonly string[];
}
type ToolbarLabel = Readonly<{ru:string;en:string}>;
type ToolbarAction = {
  readonly kind: 'command';
  readonly id: string;
  readonly label: ToolbarLabel;
  readonly nativeDisabled: true;
  readonly command: (captured: KwdjTableToolbarContext) => CommandDto | {
    readonly status: 'unavailable'; readonly code: string; readonly message: ToolbarLabel;
  };
};
const tableAlignmentLabels = {
  center: {ru:'Выровнять ячейку по центру',en:'Center cell content'},
  right: {ru:'Выровнять ячейку по правому краю',en:'Align cell content right'},
  left: {ru:'Выровнять ячейку по левому краю',en:'Align cell content left'},
} as const;

/** Append these contextual actions to the existing KWDJ toolbar. */
export function kwdjTableToolbar(editor: Pick<MountedEditor, 'selection'>, captured: KwdjTableToolbarContext): readonly ToolbarAction[] {
  const target=editor.selection.tableCell?.();
  if (!target) return [];
  const {stamp,table,row,column}=target;
  const matches=(value:ToolbarStamp) => value.session===stamp.session && value.generation===stamp.generation
    && value.revision===stamp.revision && value.selection_epoch===stamp.selection_epoch && value.history_epoch===stamp.history_epoch;
  if (!matches(captured.state.stamp)) return [];
  const align=target.align==='center' ? 'right' : target.align==='right' ? 'left' : 'center';
  const definitions: readonly [ToolbarLabel,KwdjCommandIntent][] = [
    [{ru:'Добавить строку выше',en:'Add row above'},{kind:'insert_row_above',row}],
    [{ru:'Добавить строку ниже',en:'Add row below'},{kind:'insert_row_below',row}],
    [{ru:'Удалить текущую строку',en:'Delete current row'},{kind:'delete_row',row}],
    [{ru:'Добавить колонку слева',en:'Add column left'},{kind:'insert_column_left',table,column}],
    [{ru:'Добавить колонку справа',en:'Add column right'},{kind:'insert_column_right',table,column}],
    [{ru:'Удалить текущую колонку',en:'Delete current column'},{kind:'delete_column',table,column}],
    [tableAlignmentLabels[align],{kind:'set_table_cell_align',align}],
  ];
  return definitions.flatMap(([label,intent]): ToolbarAction[]=>{
    const command=kwdjCommand(intent);
    if (!captured.catalog.includes(command.id)) return [];
    return [{
      kind:'command',id:command.id.slice('org.klenwriter.kwdj/command/'.length),label,nativeDisabled:true,
      command: current => matches(current.state.stamp) ? command : {
        status:'unavailable',code:'kwdj.command_unsupported_context',
        message:{ru:'Недоступно в этом документе.',en:'Unavailable in this document.'},
      },
    }];
  });
}

/** Explicit ABI2 input route only; configuration and semantics belong to the native profile. */
export function kwdjTypedTextCommand(text:string,origin:'ordinary_insert_text'|'composition_commit'):CommandDto {
  return createCommand('org.klenwriter.kwdj/command/insert-typed-text',{kind:'insert_typed_text',text,origin});
}
export function kwdjRestoreTypedTextCommand(restore:DeepReadonly<RawInputRestoreV2>):CommandDto {
  return createCommand('org.klenwriter.kwdj/command/restore-typed-text',{kind:'restore_typed_text',restore});
}

export { kwdjSlashCandidates, kwdjSlashTextBlockTypes } from './slash-candidates.generated.js';
