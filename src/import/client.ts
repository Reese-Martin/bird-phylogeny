import type { Collection, Taxon } from '../types';
import type { ImportOptions, ImportProgress } from './aggregate';

export type ImportWorkerMessage =
  | { type: 'progress'; progress: ImportProgress }
  | { type: 'complete'; collection: Collection }
  | { type: 'error'; message: string };

export function startImport(file: File, taxa: Taxon[], options: ImportOptions & { onProgress: (progress: ImportProgress) => void }): {
  promise: Promise<Collection>;
  cancel: () => void;
} {
  const worker = new Worker(new URL('../workers/import.worker.ts', import.meta.url), { type: 'module' });
  let settled = false;
  let rejectImport: (error: Error) => void = () => undefined;
  const promise = new Promise<Collection>((resolve, reject) => {
    rejectImport = reject;
    worker.onmessage = (event: MessageEvent<ImportWorkerMessage>) => {
      if (settled) return;
      const message = event.data;
      if (message.type === 'progress') options.onProgress(message.progress);
      else {
        settled = true;
        worker.terminate();
        if (message.type === 'complete') resolve(message.collection);
        else reject(new Error(message.message));
      }
    };
    worker.onerror = () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      reject(new Error('The import worker stopped unexpectedly. Your previous collection is unchanged.'));
    };
    worker.postMessage({ file, taxa, options: { datasetVersion: options.datasetVersion, taxonomyVersion: options.taxonomyVersion, label: options.label, importedAt: options.importedAt } });
  });
  return {
    promise,
    cancel: () => {
      if (settled) return;
      settled = true;
      worker.terminate();
      rejectImport(new DOMException('Import cancelled. Your previous collection is unchanged.', 'AbortError'));
    },
  };
}
