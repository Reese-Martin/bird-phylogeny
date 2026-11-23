export type EmbeddingMethod = 'umap' | 'mds';
export const EMBEDDING_ALGORITHM_VERSION = 'source-patristic-umap-mds-v1';
export const EMBEDDING_PARAMETERS = { seed: 42, nNeighbors: 15, minDist: 0.15, epochs: 300 } as const;
export const MDS_PARAMETERS = { maxIterations: 1000, tolerance: 1e-7, initialScale: 0.3 } as const;
export interface EmbeddingPoint { code: string; x: number; y: number; sourceGroup: string }
export interface EmbeddingProgress {
  stage: 'distances' | 'neighbors' | 'embedding' | 'mds';
  completed: number;
  total: number;
  percent: number;
}
export interface EmbeddingResult {
  points: EmbeddingPoint[];
  excludedCodes: string[];
  metadata: {
    method: 'umap' | 'umap-mds' | 'small-collection' | 'degenerate-distance';
    seed: number;
    nNeighbors: number;
    minDist: number;
    epochs: number;
    distanceMetric: 'source-tree-patristic';
    distanceUnits: 'Ma';
    distanceRange: [number, number];
    speciesCount: number;
    sourceGroupCount: number;
    elapsedMs: number;
    /** Current request provenance; elapsedMs remains the original fit duration. */
    cacheSource?: 'computed' | 'memory' | 'persistent';
    cacheReadMs?: number;
    loadMs?: number;
    mds?: {
      initialization: 'umap';
      iterations: number;
      maxIterations: number;
      converged: boolean;
      initialStress: number;
      stress: number;
      normalizedStress: number;
      relativeImprovement: number;
      tolerance: number;
    };
  };
}
export type EmbeddingWorkerMessage =
  | { type: 'progress'; progress: EmbeddingProgress }
  | { type: 'complete'; result: EmbeddingResult }
  | { type: 'error'; message: string };
