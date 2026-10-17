import { readFileSync } from 'node:fs';

// One distribution-name map; stored profile IDs and protocol revisions are separate.
export const identity = JSON.parse(readFileSync(new URL('../package-map.json', import.meta.url), 'utf8'));
