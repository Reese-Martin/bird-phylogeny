import { UMAP } from 'umap-js';
import type { Taxon, TreeData } from '../types';
import { distanceMatrix, sourceGroups } from './distance';
import { EMBEDDING_PARAMETERS, MDS_PARAMETERS, type EmbeddingMethod, type EmbeddingProgress, type EmbeddingResult } from './types';
export { EMBEDDING_PARAMETERS, MDS_PARAMETERS } from './types';

export function seededRandom(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export interface MetricMdsOptions {
  maxIterations?: number;
  tolerance?: number;
  checkCancelled?: () => void;
  onProgress?: (iteration: number, total: number) => void;
  onStress?: (stress: number, iteration: number) => void;
}

/**
 * Uniform metric SMACOF on the original dissimilarities (divided by a common
 * maximum). The Guttman update is B(X)X/n; pair contributions are accumulated
 * symmetrically, avoiding another quadratic distance/ratio matrix.
 *
 * Initialization and stopping match the tested scikit-learn 1.9.1 protocol:
 * UMAP/std(all coordinates)*0.3, maximum 1000 updates, and stress improvement
 * divided by the sum of squared embedded pair distances below 1e-7. Axes and
 * output coordinates are not calibrated evolutionary distances.
 */
export function refineMetricMds(matrix: Float64Array, size: number, initial: readonly (readonly number[])[], maximum: number, options: MetricMdsOptions = {}) {
  const maxIterations = options.maxIterations ?? MDS_PARAMETERS.maxIterations;
  const tolerance = options.tolerance ?? MDS_PARAMETERS.tolerance;
  if (!Number.isInteger(size) || size < 2 || matrix.length !== size * size || initial.length !== size) throw new Error('Invalid metric MDS dimensions.');
  if (!Number.isFinite(maximum) || maximum <= 0 || !Number.isInteger(maxIterations) || maxIterations < 1 || !Number.isFinite(tolerance) || tolerance < 0) throw new Error('Invalid metric MDS settings.');
  let mean = 0;
  for (const point of initial) {
    if (point.length !== 2 || !point.every(Number.isFinite)) throw new Error('Metric MDS requires finite two-dimensional starting coordinates.');
    mean += point[0] + point[1];
  }
  mean /= size * 2;
  let variance = 0;
  for (const point of initial) variance += (point[0] - mean) ** 2 + (point[1] - mean) ** 2;
  const standardDeviation = Math.sqrt(variance / (size * 2));
  if (!(standardDeviation > 1e-12)) throw new Error('The UMAP initialization is collapsed; metric MDS could not refine it.');
  let current = new Float64Array(size * 2), next = new Float64Array(size * 2);
  const scale = MDS_PARAMETERS.initialScale / standardDeviation;
  let centerX = 0, centerY = 0;
  for (let index = 0; index < size; index++) { current[index * 2] = initial[index][0] * scale; current[index * 2 + 1] = initial[index][1] * scale; centerX += current[index * 2]; centerY += current[index * 2 + 1]; }
  centerX /= size; centerY /= size;
  for (let index = 0; index < size; index++) { current[index * 2] -= centerX; current[index * 2 + 1] -= centerY; }
  let initialSpread = 0;
  for (const value of current) initialSpread += value * value;
  if (!(initialSpread > 1e-20)) throw new Error('The UMAP initialization is collapsed; metric MDS could not refine it.');
  for (let row = 0; row < size; row++) {
    options.checkCancelled?.();
    if (matrix[row * size + row] !== 0) throw new Error('Metric MDS requires zero self-distances.');
    for (let column = row + 1; column < size; column++) {
      const value = matrix[row * size + column];
      if (!Number.isFinite(value) || value < 0 || !Number.isFinite(matrix[column * size + row]) || Math.abs(value - matrix[column * size + row]) > 1e-10) throw new Error('Metric MDS requires finite symmetric nonnegative distances.');
    }
  }
  const evaluateAndMajorize = () => {
    next.fill(0);
    let stress = 0, pairEnergy = 0;
    for (let row = 0; row < size; row++) {
      if (row % 16 === 0) options.checkCancelled?.();
      const rx = current[row * 2], ry = current[row * 2 + 1], offset = row * size;
      for (let column = row + 1; column < size; column++) {
        const dx = rx - current[column * 2], dy = ry - current[column * 2 + 1];
        const square = dx * dx + dy * dy, distance = Math.sqrt(square), target = matrix[offset + column] / maximum;
        const error = distance - target; stress += error * error; pairEnergy += square;
        // This is scikit-learn's explicit zero-distance convention, not a
        // transformation of nonzero dissimilarities or missing-distance mask.
        const ratio = target / (distance || 1e-5), x = ratio * dx, y = ratio * dy;
        next[row * 2] += x; next[row * 2 + 1] += y;
        next[column * 2] -= x; next[column * 2 + 1] -= y;
      }
    }
    for (let index = 0; index < next.length; index++) next[index] /= size;
    if (!Number.isFinite(stress) || !Number.isFinite(pairEnergy)) throw new Error('Metric MDS produced a non-finite fit.');
    return { stress, pairEnergy };
  };
  let statistics = evaluateAndMajorize();
  const initialStress = statistics.stress;
  options.onStress?.(initialStress, 0);
  let previousStress: number | undefined, iterations = 0, converged = false;
  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    options.checkCancelled?.();
    [current, next] = [next, current];
    const previous = statistics.stress;
    statistics = evaluateAndMajorize(); iterations = iteration;
    if (statistics.stress > previous + Math.max(1e-10, previous * 1e-10)) throw new Error('Metric MDS stress increased unexpectedly.');
    options.onStress?.(statistics.stress, iteration);
    if (iteration % 5 === 0 || iteration === maxIterations) options.onProgress?.(iteration, maxIterations);
    if (previousStress !== undefined && (previousStress - statistics.stress) / Math.max(statistics.pairEnergy, 1e-30) < tolerance) { converged = true; break; }
    previousStress = statistics.stress;
  }
  const coordinates = Array.from({ length: size }, (_, index) => [current[index * 2], current[index * 2 + 1]]);
  if (coordinates.some(point => point.some(value => !Number.isFinite(value)))) throw new Error('Metric MDS did not produce finite coordinates.');
  const metadata: NonNullable<EmbeddingResult['metadata']['mds']> = {
    initialization: 'umap', iterations, maxIterations, converged, initialStress, stress: statistics.stress,
    normalizedStress: statistics.pairEnergy > 0 ? Math.sqrt(statistics.stress / statistics.pairEnergy) : 0,
    relativeImprovement: initialStress > 0 ? Math.max(0, (initialStress - statistics.stress) / initialStress) : 0, tolerance,
  };
  return { coordinates, metadata };
}

export function exactNeighbors(matrix: Float64Array, size: number, count: number, maximum: number, onRow?: (row: number, total: number) => void, checkCancelled: () => void = () => undefined) {
  const indices: number[][] = [], distances: number[][] = [];
  for (let row = 0; row < size; row++) {
    checkCancelled();
    const neighbors = Array.from({ length: size }, (_, id) => id).filter((id) => id !== row)
      .sort((a, b) => matrix[row * size + a] - matrix[row * size + b] || a - b).slice(0, count - 1);
    indices.push([row, ...neighbors]);
    distances.push([0, ...neighbors.map((id) => matrix[row * size + id] / (maximum || 1))]);
    if (row % 16 === 0 || row === size - 1) onRow?.(row + 1, size);
  }
  return { indices, distances };
}

/** Run in a worker. The ordinary taxonomy labels never enter UMAP's optimization. */
export function computeEmbedding(tree: TreeData, taxa: Taxon[], codes: Iterable<string>, options: { method?: EmbeddingMethod; onProgress?: (progress: EmbeddingProgress) => void; shouldCancel?: () => boolean } = {}): EmbeddingResult {
  const started = performance.now();
  const requestedMethod = options.method ?? 'mds';
  const checkCancelled = () => { if (options.shouldCancel?.()) throw new DOMException('Embedding cancelled.', 'AbortError'); };
  checkCancelled();
  const { groups, excludedCodes } = sourceGroups(tree, taxa, codes);
  const size = groups.length;
  const progress = (stage: EmbeddingProgress['stage'], completed: number, total: number) => {
    const span = requestedMethod === 'umap'
      ? stage === 'distances' ? [0, 45] : stage === 'neighbors' ? [45, 10] : [55, 45]
      : stage === 'distances' ? [0, 25] : stage === 'neighbors' ? [25, 10] : stage === 'embedding' ? [35, 30] : [65, 35];
    options.onProgress?.({ stage, completed, total, percent: span[0] + span[1] * completed / Math.max(1, total) });
  };
  progress('distances', 0, size);
  const { matrix, range } = distanceMatrix(tree, groups, (row, total) => progress('distances', row, total), checkCancelled);
  let coordinates: number[][];
  let method: EmbeddingResult['metadata']['method'] = 'umap';
  let epochs = 0;
  let mds: EmbeddingResult['metadata']['mds'];
  const nNeighbors = Math.min(EMBEDDING_PARAMETERS.nNeighbors, Math.max(0, size - 1));
  if (size <= 2) {
    method = 'small-collection';
    coordinates = size === 2 ? [[-0.5, 0], [0.5, 0]] : size === 1 ? [[0, 0]] : [];
  } else if (range[1] === 0) {
    method = 'degenerate-distance';
    coordinates = groups.map(() => [0, 0]);
  } else {
    const neighbors = exactNeighbors(matrix, size, nNeighbors, range[1], (row, total) => progress('neighbors', row, total), checkCancelled);
    const umap = new UMAP({ nComponents: 2, nNeighbors, minDist: EMBEDDING_PARAMETERS.minDist, spread: 1, nEpochs: EMBEDDING_PARAMETERS.epochs, random: seededRandom(EMBEDDING_PARAMETERS.seed), distanceFn: (a, b) => matrix[a[0] * size + b[0]] / range[1] });
    umap.setPrecomputedKNN(neighbors.indices, neighbors.distances);
    // Index vectors are labels into the supplied matrix, not numerical species features.
    epochs = umap.initializeFit(groups.map((_, id) => [id]));
    for (let epoch = 0; epoch < epochs; epoch++) {
      checkCancelled(); umap.step();
      if (epoch % 5 === 0 || epoch === epochs - 1) progress('embedding', epoch + 1, epochs);
    }
    coordinates = umap.getEmbedding();
    if (coordinates.some((point) => point.length !== 2 || point.some((value) => !Number.isFinite(value)))) throw new Error('UMAP did not produce finite coordinates for this collection. The tree view remains available.');
    if (requestedMethod === 'mds') {
      progress('mds', 0, MDS_PARAMETERS.maxIterations);
      const refined = refineMetricMds(matrix, size, coordinates, range[1], { checkCancelled, onProgress: (iteration, total) => progress('mds', iteration, total) });
      coordinates = refined.coordinates; mds = refined.metadata; method = 'umap-mds';
    }
  }
  checkCancelled(); progress(requestedMethod === 'mds' ? 'mds' : 'embedding', 1, 1);
  return {
    points: groups.flatMap((group, index) => group.codes.map((code) => ({ code, x: coordinates[index][0], y: coordinates[index][1], sourceGroup: group.key }))),
    excludedCodes,
    metadata: { method, seed: EMBEDDING_PARAMETERS.seed, nNeighbors, minDist: EMBEDDING_PARAMETERS.minDist, epochs, distanceMetric: 'source-tree-patristic', distanceUnits: 'Ma', distanceRange: range, speciesCount: groups.reduce((sum, group) => sum + group.codes.length, 0), sourceGroupCount: size, elapsedMs: performance.now() - started, ...(mds ? { mds } : {}) },
  };
}
