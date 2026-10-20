// SPDX-License-Identifier: MIT OR Apache-2.0
// Pre-candidate specification. Imports name existing public types only.
import type { DeepReadonly, SelectionDto, CommandDto } from '@klenwriter/editor-sdk';
import type { UiText, UiActionContext, UiUnavailable } from '@klenwriter/editor-ui';
export interface UiSlashRange {
  readonly range: DeepReadonly<SelectionDto>;
  readonly literal: string;
}
export interface UiSlashChoice {
  readonly id: string;
  readonly label: UiText;
  readonly keywords: Readonly<{ru: readonly string[]; en: readonly string[]}>;
  readonly command: (captured: UiActionContext, slash: UiSlashRange|null) => CommandDto|UiUnavailable;
}
export interface UiSlashProfile {
  readonly textBlockTypes: readonly string[];
  readonly choices: readonly UiSlashChoice[];
}
// UiProfile adds optional readonly slash?: UiSlashProfile.
// Null slash means the same Add catalog, bound to pre-focus native insertion.
// No new package dependency from generic UI to KWDJ is permitted.
