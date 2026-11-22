// SPDX-License-Identifier: MIT OR Apache-2.0
// The inherited source controls read their fixed base through this fixture.
import {readFileSync as diskRead,lstatSync as diskStat} from 'node:fs';
import {relative,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {descriptorPath,decodeDescriptor,previousBytes,requireSource} from './renderer-source-data.mjs';
const root = fileURLToPath(new URL('../../',import.meta.url));
const descriptor = decodeDescriptor(diskRead(resolve(root,descriptorPath)));
const sources = new Map(descriptor.changes.map(row => [row.current.path,row]));
function source(file) {
  const path = relative(root,file instanceof URL ? fileURLToPath(file) : file);
  return sources.get(path);
}
function currentStat(file,row) {
  const stat = diskStat(file);
  requireSource(stat.isFile() && stat.size === row.current.bytes,row.current.path);
  return stat;
}
export function readFileSync(file,...args) {
  const row = source(file);
  if (!row) return diskRead(file,...args);
  currentStat(file,row);
  return previousBytes(row,diskRead(file));
}
export function lstatSync(file,...args) {
  const row = source(file);
  if (!row) return diskStat(file,...args);
  const stat = currentStat(file,row);
  stat.size = row.previous.bytes;
  return stat;
}
