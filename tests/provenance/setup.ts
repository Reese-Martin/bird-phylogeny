import { readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';

interface PinnedSource { path: string; sha256: string }

/** Fail explicitly rather than silently skipping independent source comparisons. */
export default function requirePinnedSources(): void {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const lock = read('data/sources.lock.json') as { sources: PinnedSource[] };
  const taxonomy = read('data/clements2026-source.json') as { source: PinnedSource; output: PinnedSource };
  const geometry = read('data/sticker-geometry-source.json') as { inputMass: PinnedSource };
  const inputPaths = ['data/raw/tree.nex', 'data/raw/ebird2026.json', 'data/raw/ott2025.csv'];
  const inputs = inputPaths.map(path => {
    const source = lock.sources.find(source => source.path === path);
    if (!source) throw new Error(`The provenance audit input is absent from the source lock: ${path}`);
    return source;
  });
  const sources = [...inputs, taxonomy.source, taxonomy.output, geometry.inputMass];
  const missing = sources.filter(source => {
    try { return !statSync(source.path).isFile(); } catch { return true; }
  });
  if (missing.length) {
    throw new Error([
      'The provenance audit requires pinned raw source evidence, intentionally excluded from Git.',
      'Missing files:',
      ...missing.map(source => `  ${source.path}`),
      'Restore these exact files from a trusted local copy, or fetch pinned inputs with:',
      '  npm run data:fetch -- --no-assets',
      'Then create the normalized workbook evidence with:',
      '  npm run taxonomy:import',
      'Workbook extraction needs Python 3 and openpyxl 3.1.5; see README-DATA.md.',
      'Use npm test for the shipped runtime/artifact checks that need no raw source files.',
    ].join('\n'));
  }
  for (const source of sources) {
    const actual = createHash('sha256').update(readFileSync(source.path)).digest('hex');
    if (actual !== source.sha256) {
      throw new Error(`Pinned provenance source changed: ${source.path}. Restore the exact pinned bytes; review source updates before changing recorded hashes.`);
    }
  }
}
