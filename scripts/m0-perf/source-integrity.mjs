import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';

// Only this dependency input evolved in OSR-28. Its immutable M0 copy must still
// match the hash in sealed metadata; unknown paths never fall back to snapshots.
export function capturedSourceHash(root, path) {
  const source = path === 'package-lock.json' ? 'evidence/osr-61/sources/package-lock.json' : path;
  return createHash('sha256').update(readFileSync(resolve(root, source))).digest('hex');
}
