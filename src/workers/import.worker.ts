/// <reference lib="webworker" />
import Papa from 'papaparse';
import type { Taxon } from '../types';
import { CollectionAggregator, canonicalHeader, validateHeaders, validateParsedChunk, type CsvRow, type ImportOptions } from '../import/aggregate';
import type { ImportWorkerMessage } from '../import/client';

const scope = self as DedicatedWorkerGlobalScope;
const CHUNK_BYTES = 512 * 1024;
const send = (message: ImportWorkerMessage) => scope.postMessage(message);

scope.onmessage = (event: MessageEvent<{ file: File; taxa: Taxon[]; options: ImportOptions }>) => {
  const { file, taxa, options } = event.data;
  const aggregator = new CollectionAggregator(taxa, options);
  let chunks = 0;
  let validated = false;
  let failed = false;
  const fail = (error: unknown, parser?: Papa.Parser) => {
    if (failed) return;
    failed = true;
    parser?.abort();
    send({ type: 'error', message: error instanceof Error ? error.message : 'The CSV could not be read. The previous collection is unchanged.' });
  };
  send({ type: 'progress', progress: { bytes: 0, totalBytes: file.size, records: 0 } });
  if (file.size === 0) {
    fail(new Error('The CSV is empty. Choose the full MyEBirdData.csv export.'));
    return;
  }
  Papa.parse<CsvRow>(file, {
    header: true, skipEmptyLines: 'greedy', transformHeader: canonicalHeader, chunkSize: CHUNK_BYTES,
    chunk: (result, parser) => {
      if (failed) return;
      try {
        if (!validated) {
          validateHeaders(result.meta.fields);
          const renamed = (result.meta as unknown as { renamedHeaders?: Record<string, string> }).renamedHeaders;
          if (renamed && Object.keys(renamed).length) throw new Error('The CSV contains duplicate column names.');
          validated = true;
        }
        validateParsedChunk(result, aggregator.report.totalRecords);
        for (const row of result.data) aggregator.add(row);
        chunks++;
        send({ type: 'progress', progress: { bytes: Math.min(file.size, chunks * CHUNK_BYTES), totalBytes: file.size, records: aggregator.report.totalRecords } });
      } catch (error) { fail(error, parser); }
    },
    complete: () => {
      if (failed) return;
      try {
        if (!validated) throw new Error('The CSV is empty. Choose the full MyEBirdData.csv export.');
        send({ type: 'complete', collection: aggregator.finish() });
      } catch (error) { fail(error); }
    },
    error: () => fail(new Error('The file could not be opened. Choose the CSV again; your previous collection is unchanged.')),
  });
};
