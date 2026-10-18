// SPDX-License-Identifier: MIT OR Apache-2.0
/** Profile-specific command construction; all semantic checks remain in Rust. */
export { artifactStage } from '@klenwriter/editor-sdk';
import { createCommand } from '@klenwriter/editor-sdk';
import type { CommandDto, KwdjIntentDto } from '@klenwriter/editor-sdk';

export type { KwdjIntentDto, BlockTargetDto, ListKindDto, MarkDto } from '@klenwriter/editor-sdk';

const commandNames: Record<KwdjIntentDto['kind'], string> = {
  enter: 'enter', shift_enter: 'shift-enter', toggle_mark: 'toggle-mark',
  set_link: 'set-link', unset_link: 'unset-link', insert_text: 'insert-text',
  transform_block: 'transform-block', toggle_quote: 'toggle-quote', toggle_list: 'toggle-list',
  insert_block: 'insert-block', move: 'move', duplicate: 'duplicate', remove: 'remove',
  accept_slash: 'accept-slash', dismiss_slash: 'dismiss-slash',
};

/** Numeric metadata, revision/group tokens and ordered-list starts remain strings. */
export function kwdjCommand(intent: KwdjIntentDto): CommandDto {
  const kind = intent && typeof intent === 'object' ? Object.getOwnPropertyDescriptor(intent, 'kind') : undefined;
  if (!kind || !('value' in kind) || typeof kind.value !== 'string' || !Object.hasOwn(commandNames, kind.value)) {
    throw new TypeError('sdk.invalid_command_kind');
  }
  const name = commandNames[kind.value as KwdjIntentDto['kind']];
  return createCommand(`org.klenwriter.kwdj/command/${name}`, intent);
}
