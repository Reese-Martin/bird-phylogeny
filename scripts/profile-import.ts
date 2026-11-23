import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import { performance } from 'node:perf_hooks';
import Papa from 'papaparse';
import type { Collection, Taxon } from '../src/types';
import { CollectionAggregator, canonicalHeader, parseCsv, validateHeaders, type CsvRow } from '../src/import/aggregate';

const taxa: Taxon[] = JSON.parse(await readFile(new URL('../public/data/taxa.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(await readFile(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
const options = { datasetVersion: manifest.datasetVersion, taxonomyVersion: manifest.taxonomyVersion, importedAt: '2026-11-17T12:00:00.000Z' };
const eligible = taxa.filter(taxon => taxon.category === 'species' && taxon.treeTip !== undefined && ['exact', 'renamed'].includes(taxon.mappingStatus));
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const makeCsv = (speciesCount: number, rowCount = speciesCount) => {
  const rows = ['Submission ID,Common Name,Scientific Name,Count,Date'];
  for (let i = 0; i < rowCount; i++) {
    const taxon = eligible[i % speciesCount];
    rows.push([`PROFILE-${i % 10000}`, taxon.commonName, taxon.scientificName, i % 7 ? '1' : 'X', '2024-06-01'].map(quote).join(','));
  }
  return rows.join('\n');
};

function chunkedParse(source: string): { collection: Collection; chunks: number } {
  const aggregator = new CollectionAggregator(taxa, options);
  let chunks = 0;
  // Papa's StringStreamer supports chunk callbacks; upstream types expose them only on file configs.
  const config: Papa.ParseConfig<CsvRow> & { chunkSize: number; chunk: (result: Papa.ParseResult<CsvRow>) => void } = {
    header: true, skipEmptyLines: 'greedy', transformHeader: canonicalHeader, chunkSize: 512 * 1024,
    chunk: result => {
      if (chunks === 0) validateHeaders(result.meta.fields);
      if (result.errors.length) throw new Error(result.errors[0].message);
      for (const row of result.data) aggregator.add(row);
      chunks++;
    },
  };
  Papa.parse<CsvRow>(source, config);
  return { collection: aggregator.finish(), chunks };
}

const cases = [{ species: 100, rows: 100 }, { species: 1000, rows: 1000 }, { species: 5000, rows: 5000 }, { species: 100, rows: 100000 }];
const results = [];
for (const test of cases) {
  const source = makeCsv(test.species, test.rows);
  parseCsv(source, taxa, options); // warm-up; data and module loading excluded
  const samples: number[] = [];
  let collection!: Collection;
  for (let run = 0; run < 5; run++) {
    const started = performance.now();
    collection = parseCsv(source, taxa, options);
    samples.push(performance.now() - started);
  }
  samples.sort((a, b) => a - b);
  if (collection.species.length !== test.species || collection.report.totalRecords !== test.rows || collection.report.unresolvedRecords) throw new Error('Profile input did not reconcile as expected.');
  const chunkedStarted = performance.now();
  const chunked = chunkedParse(source);
  const chunkedMs = performance.now() - chunkedStarted;
  if (JSON.stringify(chunked.collection) !== JSON.stringify(collection)) throw new Error('Chunked and full parser results differ.');
  results.push({ species: test.species, rows: test.rows, bytes: Buffer.byteLength(source), medianMs: samples[2], minMs: samples[0], maxMs: samples[4], chunkedMs, chunks: chunked.chunks, duplicates: collection.report.duplicateRecords });
}

const cpus = os.cpus();
const report = `# Local performance measurements

Measured ${new Date().toISOString()} using ${process.version}, ${os.type()} ${os.release()} ${os.arch()}.
Hardware: ${cpus[0]?.model.trim() ?? 'CPU model unavailable'}; ${cpus.length} logical processors; ${(os.totalmem() / 1024 ** 3).toFixed(1)} GiB RAM.
Prepared dataset: \`${manifest.datasetVersion}\`; 18,631 reportable eBird 2026 taxa. Inputs are deterministic generated observations, with no personal data. The large CSV is generated in memory and is not committed.

## Node import throughput

Each full-parse measurement is the median of five runs after one warm-up; includes building the complete taxon-name index, Papa Parse, concept reconciliation, aggregation, and report creation. CSV generation, module/data loading, file I/O, UI, and browser worker startup are excluded.

| Species | Rows | UTF-8 bytes | Full parse median (ms) | Range (ms) | 512 KiB chunk parse (ms) | Chunks | Duplicate species/checklist rows |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${results.map(result => `| ${result.species.toLocaleString('en')} | ${result.rows.toLocaleString('en')} | ${result.bytes.toLocaleString('en')} | ${result.medianMs.toFixed(1)} | ${result.minMs.toFixed(1)}–${result.maxMs.toFixed(1)} | ${result.chunkedMs.toFixed(1)} | ${result.chunks} | ${result.duplicates.toLocaleString('en')} |`).join('\n')}

The chunk test uses Papa Parse string chunks and the same aggregation class as the worker. All chunked results were byte-for-byte equal to full-parse normalized collections. This isolates parsing/aggregation from species count and checks chunk-boundary consistency. It does not measure browser FileReader, worker transfer, progress/cancellation latency, rendering, or navigation FPS. Those require the browser workflow checks.

Reproduce with \`node --import tsx scripts/profile-import.ts\`. Timings depend on system load and JavaScript warm-up. These are observations, not pass/fail performance promises.

## Browser measurements

Browser workflow and rendering measurements are recorded separately during local QA. Node throughput alone does not establish the three-second usable-demo or 30 FPS navigation targets.
`;
await writeFile(new URL('../README-PERFORMANCE.md', import.meta.url), report);
process.stdout.write(JSON.stringify({ environment: { node: process.version, cpu: cpus[0]?.model, logicalProcessors: cpus.length }, results }, null, 2) + '\n');
