import type { Taxon, TreeData } from '../types';
import { deterministicLayoutKey, getPersistentLayout, persistentLayoutCacheEpoch, putPersistentLayout } from '../storage/layout-cache';
import { EMBEDDING_ALGORITHM_VERSION, EMBEDDING_PARAMETERS, MDS_PARAMETERS, type EmbeddingMethod, type EmbeddingProgress, type EmbeddingResult, type EmbeddingWorkerMessage } from './types';
export type { EmbeddingMethod, EmbeddingPoint, EmbeddingProgress, EmbeddingResult } from './types';

let caches = new WeakMap<TreeData, Map<string, EmbeddingResult>>();
let memoryEpoch = 0;
export function clearEmbeddingMemoryCache() { memoryEpoch++; caches = new WeakMap(); }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
interface CachedEmbedding { schemaVersion: 1; key: string; result: EmbeddingResult }

function expectedMembership(tree: TreeData, taxa: Taxon[], codes: string[]) {
  const byCode = new Map(taxa.map(taxon => [taxon.code, taxon])), mapped = new Map<string, string>(), excluded: string[] = [];
  for (const code of codes) {
    const taxon = byCode.get(code), tips = [...new Set(taxon?.treeTips?.length ? taxon.treeTips : taxon?.treeTip !== undefined ? [taxon.treeTip] : [])].sort((a, b) => a - b);
    if (!taxon || taxon.category !== 'species' || taxon.mappingStatus === 'unresolved' || !tips.length || tips.some(id => !tree.nodes[id] || tree.nodes[id].children.length)) excluded.push(code);
    else mapped.set(code, tips.join(','));
  }
  return { mapped, excluded, groups: new Set(mapped.values()).size };
}

function validResult(value: unknown, expected: ReturnType<typeof expectedMembership>, method: EmbeddingMethod): value is EmbeddingResult {
  if (!object(value) || !Array.isArray(value.points) || !Array.isArray(value.excludedCodes) || !object(value.metadata)) return false;
  if (value.points.length !== expected.mapped.size || value.excludedCodes.length !== expected.excluded.length || !value.excludedCodes.every((code: unknown, i: number) => code === expected.excluded[i])) return false;
  const seen = new Set<string>();
  for (const point of value.points) {
    if (!object(point) || typeof point.code !== 'string' || seen.has(point.code) || point.sourceGroup !== expected.mapped.get(point.code) || !expected.mapped.has(point.code) || !finite(point.x) || !finite(point.y)) return false;
    seen.add(point.code);
  }
  const m = value.metadata;
  if (m.speciesCount !== expected.mapped.size || m.sourceGroupCount !== expected.groups || m.seed !== EMBEDDING_PARAMETERS.seed || m.nNeighbors !== Math.min(EMBEDDING_PARAMETERS.nNeighbors, Math.max(0, expected.groups - 1)) || m.minDist !== EMBEDDING_PARAMETERS.minDist || m.distanceMetric !== 'source-tree-patristic' || m.distanceUnits !== 'Ma' || !nonnegative(m.elapsedMs)) return false;
  if (!Array.isArray(m.distanceRange) || m.distanceRange.length !== 2 || !m.distanceRange.every(nonnegative) || m.distanceRange[0] > m.distanceRange[1]) return false;
  const expectedMethod = expected.groups <= 2 ? 'small-collection' : m.distanceRange[1] === 0 ? 'degenerate-distance' : method === 'mds' ? 'umap-mds' : 'umap';
  if (m.method !== expectedMethod || m.epochs !== (expectedMethod === 'umap' || expectedMethod === 'umap-mds' ? EMBEDDING_PARAMETERS.epochs : 0)) return false;
  if (m.method === 'umap-mds') {
    const fit = m.mds;
    if (!object(fit) || fit.initialization !== 'umap' || fit.maxIterations !== MDS_PARAMETERS.maxIterations || fit.tolerance !== MDS_PARAMETERS.tolerance || !Number.isInteger(fit.iterations) || fit.iterations < 1 || fit.iterations > fit.maxIterations || typeof fit.converged !== 'boolean') return false;
    if (![fit.initialStress, fit.stress, fit.normalizedStress, fit.relativeImprovement].every(nonnegative) || fit.relativeImprovement > 1 || fit.stress > fit.initialStress + Math.max(1e-8, fit.initialStress * 1e-8)) return false;
  } else if (m.mds !== undefined) return false;
  return true;
}

/** Persist only coordinates, source groups and numeric fit metadata. */
function cleanResult(value: EmbeddingResult): EmbeddingResult {
  const m = value.metadata;
  return { points: value.points.map(p => ({ code: p.code, x: p.x, y: p.y, sourceGroup: p.sourceGroup })), excludedCodes: [...value.excludedCodes], metadata: {
    method: m.method, seed: m.seed, nNeighbors: m.nNeighbors, minDist: m.minDist, epochs: m.epochs, distanceMetric: m.distanceMetric, distanceUnits: m.distanceUnits,
    distanceRange: [...m.distanceRange], speciesCount: m.speciesCount, sourceGroupCount: m.sourceGroupCount, elapsedMs: m.elapsedMs,
    ...(m.mds ? { mds: { initialization: m.mds.initialization, iterations: m.mds.iterations, maxIterations: m.mds.maxIterations, converged: m.mds.converged, initialStress: m.mds.initialStress, stress: m.mds.stress, normalizedStress: m.mds.normalizedStress, relativeImprovement: m.mds.relativeImprovement, tolerance: m.mds.tolerance } } : {}),
  } };
}

export function startEmbedding(tree: TreeData, taxa: Taxon[], codes: Iterable<string>, options: { method?: EmbeddingMethod; onProgress?: (progress: EmbeddingProgress) => void } = {}): { promise: Promise<EmbeddingResult>; cancel: () => void } {
  const started = performance.now(), requestMemoryEpoch = memoryEpoch, requestDiskEpoch = persistentLayoutCacheEpoch();
  const method = options.method ?? 'mds', selectedCodes = [...new Set(codes)].sort();
  const byCode = new Map(taxa.map(taxon => [taxon.code, taxon]));
  let worker: Worker | undefined, settled = false, rejectEmbedding: (error: Error) => void = () => undefined;
  const promise = new Promise<EmbeddingResult>((resolve, reject) => {
    rejectEmbedding = reject;
    void (async () => {
      // The hash, validation and worker must see one source snapshot even if a
      // caller mutates its data while the asynchronous cache read is pending.
      const sourceTree = structuredClone(tree), relevantTaxa = structuredClone(selectedCodes.flatMap(code => byCode.has(code) ? [byCode.get(code)!] : []));
      const expected = expectedMembership(sourceTree, relevantTaxa, selectedCodes);
      let key: string | undefined, cacheReadMs = 0;
      try { key = await deterministicLayoutKey('embedding', { schemaVersion: 1, algorithmVersion: EMBEDDING_ALGORITHM_VERSION, method, sourceTree, umap: EMBEDDING_PARAMETERS, ...(method === 'mds' ? { mds: MDS_PARAMETERS } : {}), codes: selectedCodes, mappings: relevantTaxa.map(taxon => ({ code: taxon.code, category: taxon.category, status: taxon.mappingStatus, tips: taxon.treeTips?.length ? taxon.treeTips : taxon.treeTip === undefined ? [] : [taxon.treeTip] })) }); } catch { /* Hash/storage support is optional. */ }
      if (settled) return;
      const cache = caches.get(tree) || new Map<string, EmbeddingResult>(); caches.set(tree, cache);
      const remember = (result: EmbeddingResult) => {
        if (!key || requestMemoryEpoch !== memoryEpoch || requestDiskEpoch !== persistentLayoutCacheEpoch()) return;
        cache.delete(key); cache.set(key, result); while (cache.size > 4) cache.delete(cache.keys().next().value!);
      };
      const finish = (result: EmbeddingResult, cacheSource: 'computed' | 'memory' | 'persistent') => {
        if (settled) return;
        settled = true; worker?.terminate();
        resolve({ ...result, metadata: { ...result.metadata, cacheSource, cacheReadMs, loadMs: performance.now() - started } });
      };
      const inMemory = key ? cache.get(key) : undefined;
      if (inMemory && validResult(inMemory, expected, method)) { remember(inMemory); finish(inMemory, 'memory'); return; }
      if (key) {
        cache.delete(key); const began = performance.now(); let stored: CachedEmbedding | null = null;
        try { stored = await getPersistentLayout<CachedEmbedding>(key, (value): value is CachedEmbedding => object(value) && value.schemaVersion === 1 && value.key === key && validResult(value.result, expected, method)); } catch { /* Optional persistence failure is a miss. */ }
        cacheReadMs = performance.now() - began;
        if (settled) return;
        if (stored && requestDiskEpoch === persistentLayoutCacheEpoch()) { const result = cleanResult(stored.result); remember(result); finish(result, 'persistent'); return; }
      }
      if (settled) return;
      worker = new Worker(new URL('../workers/embedding.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<EmbeddingWorkerMessage>) => {
        if (settled) return;
        const message = event.data;
        if (message.type === 'progress') options.onProgress?.(message.progress);
        else if (message.type === 'complete') {
          if (!validResult(message.result, expected, method)) { settled = true; worker?.terminate(); reject(new Error('The embedding worker returned an invalid completed layout.')); return; }
          const result = cleanResult(message.result);
          remember(result);
          if (key && requestMemoryEpoch === memoryEpoch && requestDiskEpoch === persistentLayoutCacheEpoch()) void putPersistentLayout(key, 'embedding', { schemaVersion: 1, key, result }, requestDiskEpoch).catch(() => undefined);
          finish(result, 'computed');
        } else { settled = true; worker?.terminate(); reject(new Error(message.message)); }
      };
      worker.onerror = () => { if (!settled) { settled = true; worker?.terminate(); reject(new Error('The embedding worker stopped unexpectedly. The tree view remains available.')); } };
      worker.postMessage({ tree: sourceTree, taxa: relevantTaxa, codes: selectedCodes, method });
    })().catch(error => { if (!settled) { settled = true; worker?.terminate(); reject(error instanceof Error ? error : new Error('The embedding could not start.')); } });
  });
  return { promise, cancel: () => { if (!settled) { settled = true; worker?.terminate(); rejectEmbedding(new DOMException('Embedding cancelled.', 'AbortError')); } } };
}
