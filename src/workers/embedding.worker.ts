/// <reference lib="webworker" />
import type { Taxon, TreeData } from '../types';
import { computeEmbedding } from '../embedding/engine';
import type { EmbeddingMethod, EmbeddingWorkerMessage } from '../embedding/types';

const scope = self as unknown as DedicatedWorkerGlobalScope;
scope.onmessage = (event: MessageEvent<{ tree: TreeData; taxa: Taxon[]; codes: string[]; method?: EmbeddingMethod }>) => {
  const send = (message: EmbeddingWorkerMessage) => scope.postMessage(message);
  try {
    const { tree, taxa, codes, method } = event.data;
    const result = computeEmbedding(tree, taxa, codes, { method, onProgress: (progress) => send({ type: 'progress', progress }) });
    send({ type: 'complete', result });
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : 'Could not compute this embedding view.' });
  }
};
