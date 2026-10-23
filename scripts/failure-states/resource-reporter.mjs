// SPDX-License-Identifier: MIT OR Apache-2.0
// Node test event reporter for the EXISTING command; does not launch/repeat tests.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative } from 'node:path';
import { existingSourceFiles } from './existing-resource-cases.mjs';

const hashes = () => Object.fromEntries(existingSourceFiles.map(path => [path, createHash('sha256').update(readFileSync(path)).digest('hex')]));
const normalized = file => typeof file === 'string' ? (isAbsolute(file) ? relative(process.cwd(), file) : file).replaceAll('\\', '/') : null;
const line = value => JSON.stringify({ format: 'editor-failure-states/test-event/1', ...value }) + '\n';
export default async function* resourceReporter(events) {
  const sourceBefore = hashes();
  yield line({ type: 'header', sourceBefore });
  let failed = 0;
  for await (const event of events) {
    const data = event.data ?? {};
    if (event.type === 'test:pass' || event.type === 'test:fail') {
      if (event.type === 'test:fail') failed++;
      yield line({ type: event.type, name: data.name, file: normalized(data.file), line: data.line ?? null,
        skip: Boolean(data.skip), todo: Boolean(data.todo), nesting: data.nesting ?? null,
        durationMs: data.details?.duration_ms ?? null,
        error: data.details?.error ? { name: data.details.error.name, message: data.details.error.message, stack: data.details.error.stack, code: data.details.error.code } : null });
    } else if (event.type === 'test:stdout' || event.type === 'test:stderr') {
      yield line({ type: event.type, file: normalized(data.file), message: data.message });
    } else if (event.type === 'test:summary') {
      yield line({ type: event.type, success: data.success, counts: data.counts });
    }
  }
  const sourceAfter = hashes();
  yield line({ type: 'footer', failed, sourceAfter, sourceUnchanged: JSON.stringify(sourceAfter) === JSON.stringify(sourceBefore) });
}
