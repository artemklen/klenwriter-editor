// SPDX-License-Identifier: MIT OR Apache-2.0
import type { CommandDto } from '@klenwriter/editor-wasm';
import { ownData } from './data.js';
export { artifactStage, loadSdk, sdkAbiV1, sdkBuildId } from '@klenwriter/editor-wasm';
export * from './controller.js';
export type * from '@klenwriter/editor-wasm';

/** Own a data-only command payload before serialization; Rust owns its semantics. */
export function createCommand(id: string, payload: unknown): CommandDto {
  if (typeof id !== 'string') throw new TypeError('sdk.invalid_command_kind');
  const owned = ownData(payload);
  return { id, payload_json: owned.json };
}
