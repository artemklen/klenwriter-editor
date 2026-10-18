// SPDX-License-Identifier: MIT OR Apache-2.0
import { createEditor, loadSdk, sdkBuildId } from '@klenwriter/editor-sdk';
import { kwdjCommand } from '@klenwriter/editor-kwdj';
import { exercisePackagedSdk } from './sdk-scenario.js';

export async function runSdkHost(cycles = 12) {
  const module = await loadSdk();
  if (module.manifest.build_id !== sdkBuildId) throw new Error('SDK host source identity differs');
  return exercisePackagedSdk({ createEditor, kwdjCommand, module, loader: () => Promise.resolve(module) }, cycles);
}
