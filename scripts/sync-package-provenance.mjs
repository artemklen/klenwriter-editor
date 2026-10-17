import { copyFileSync } from 'node:fs';
import { identity } from './package-identity.mjs';

// Run explicitly after reviewing a change to the root ownership manifest.
for (const entry of [...Object.values(identity.rust), ...Object.values(identity.web)]) {
  copyFileSync('provenance/source-files.json', `${entry.path}/SOURCE-PROVENANCE.json`);
}
