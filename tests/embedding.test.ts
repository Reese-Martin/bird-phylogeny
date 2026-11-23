import { describe, expect, it } from 'vitest';
import type { Taxon, TreeData } from '../src/types';
import { distanceMatrix, MAX_EMBEDDING_GROUPS, patristicIndex, sourceGroups } from '../src/embedding/distance';
import { computeEmbedding, exactNeighbors, refineMetricMds } from '../src/embedding/engine';

const tree: TreeData = {
  version: 'distance-fixture', root: 0, maxDistance: 10, tips: [2, 3, 4, 5],
  nodes: [
    { id: 0, parent: null, children: [1, 4, 5], length: 0, distance: 0, age: 10, leafStart: 0, leafEnd: 4 },
    { id: 1, parent: 0, children: [2, 3], length: 7, distance: 7, age: 3, leafStart: 0, leafEnd: 2 },
    { id: 2, parent: 1, children: [], length: 3, distance: 10, age: 0, leafStart: 0, leafEnd: 1 },
    { id: 3, parent: 1, children: [], length: 3, distance: 10, age: 0, leafStart: 1, leafEnd: 2 },
    { id: 4, parent: 0, children: [], length: 10, distance: 10, age: 0, leafStart: 2, leafEnd: 3 },
    { id: 5, parent: 0, children: [], length: 10, distance: 10, age: 0, leafStart: 3, leafEnd: 4 },
  ],
};
const species = (code: string, tips: number[], extra: Partial<Taxon> = {}): Taxon => ({ code, commonName: code, scientificName: code, category: 'species', mappingStatus: 'exact', treeTips: tips, ...extra });
const taxa = [species('a', [2]), species('b', [3]), species('c', [4]), species('d', [5]), species('a-split', [2], { mappingStatus: 'narrower' }), species('lump', [2, 3], { mappingStatus: 'broader' }), species('gap', [])];

describe('source distances for UMAP', () => {
  it('computes exact sister/root patristic lengths and is independent of stored display depths', () => {
    const index = patristicIndex(tree);
    expect(index.distance(2, 2)).toBe(0);
    expect(index.distance(2, 3)).toBe(6);
    expect(index.distance(2, 4)).toBe(20);
    expect(index.distance(4, 2)).toBe(20);
    const differentDisplayFields = structuredClone(tree);
    differentDisplayFields.nodes.forEach((node) => { node.distance = 999; node.age = 999; });
    expect(patristicIndex(differentDisplayFields).distance(2, 3)).toBe(6);
  });

  it('collapses identical older concepts, excludes gaps, and averages cross-tip distances for lumps', () => {
    const { groups, excludedCodes } = sourceGroups(tree, taxa, ['gap', 'lump', 'a-split', 'a', 'b', 'c', 'unknown']);
    expect(excludedCodes).toEqual(['gap', 'unknown']);
    expect(groups.find((group) => group.key === '2')?.codes).toEqual(['a', 'a-split']);
    const { matrix } = distanceMatrix(tree, groups);
    const a = groups.findIndex((group) => group.key === '2'), lump = groups.findIndex((group) => group.key === '2,3');
    expect(matrix[a * groups.length + lump]).toBe(3);
    for (let row = 0; row < groups.length; row++) for (let column = 0; column < groups.length; column++) {
      expect(matrix[row * groups.length + column]).toBe(matrix[column * groups.length + row]);
      if (row === column) expect(matrix[row * groups.length + column]).toBe(0);
    }
  });

  it('uses exact metric neighbors rather than distances between distance-profile vectors', () => {
    const { groups } = sourceGroups(tree, taxa, ['a', 'b', 'c', 'd']);
    const { matrix, range } = distanceMatrix(tree, groups);
    const nearest = exactNeighbors(matrix, groups.length, 3, range[1]);
    expect(nearest.indices[0]).toEqual([0, 1, 2]);
    expect(nearest.distances[0]).toEqual([0, 0.3, 1]);
  });

  it('rejects a collection beyond the explicit bound before building a quadratic matrix', () => {
    const largeTree = { ...tree, nodes: Array.from({ length: MAX_EMBEDDING_GROUPS + 1 }, (_, id) => ({ ...tree.nodes[2], id })) };
    const largeTaxa = largeTree.nodes.map((node) => species(`bird-${node.id}`, [node.id]));
    expect(() => sourceGroups(largeTree, largeTaxa, largeTaxa.map((taxon) => taxon.code))).toThrow('No species were sampled or omitted');
  });
});

describe('UMAP computation', () => {
  it('is seeded, code-order invariant, finite and keeps shared source concepts coincident', () => {
    const codes = ['a', 'b', 'c', 'd', 'a-split', 'gap'];
    const first = computeEmbedding(tree, taxa, codes, { method: 'umap' });
    const second = computeEmbedding(tree, taxa, [...codes].reverse(), { method: 'umap' });
    expect(first.metadata.method).toBe('umap');
    expect(first.metadata.epochs).toBe(300);
    expect(first.metadata.distanceRange).toEqual([6, 20]);
    expect(first.points).toEqual(second.points);
    expect(first.excludedCodes).toEqual(['gap']);
    expect(first.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y))).toBe(true);
    const split = first.points.find((point) => point.code === 'a-split')!, original = first.points.find((point) => point.code === 'a')!;
    expect([split.x, split.y, split.sourceGroup]).toEqual([original.x, original.y, original.sourceGroup]);
    expect(first.metadata.sourceGroupCount).toBe(4);
    expect(first.metadata.speciesCount).toBe(5);
  });

  it('labels tiny and wholly zero-distance inputs without claiming a UMAP fit', () => {
    expect(computeEmbedding(tree, taxa, []).points).toEqual([]);
    const tiny = computeEmbedding(tree, taxa, ['a', 'b']);
    expect(tiny.metadata.method).toBe('small-collection');
    expect(tiny.metadata.epochs).toBe(0);
    const zeroTree = structuredClone(tree);
    zeroTree.nodes.forEach((node) => { node.length = 0; });
    const zero = computeEmbedding(zeroTree, taxa, ['a', 'b', 'c']);
    expect(zero.metadata.method).toBe('degenerate-distance');
    expect(zero.points.every((point) => point.x === 0 && point.y === 0)).toBe(true);
  });

  it('reports monotonic progress through distances/neighbors/optimization and allows cancellation', () => {
    const values: number[] = [], stages = new Set<string>();
    computeEmbedding(tree, taxa, ['a', 'b', 'c', 'd'], { method: 'umap', onProgress: (progress) => { values.push(progress.percent); stages.add(progress.stage); } });
    expect([...stages]).toEqual(['distances', 'neighbors', 'embedding']);
    expect(values.at(-1)).toBe(100);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
    let cancel = false;
    expect(() => computeEmbedding(tree, taxa, ['a', 'b', 'c'], { onProgress: () => { cancel = true; }, shouldCancel: () => cancel })).toThrow('Embedding cancelled');
  });
});

describe('UMAP-initialized metric MDS', () => {
  const pointDistances = (points: number[][]) => Float64Array.from(points.flatMap(a => points.map(b => Math.hypot(a[0] - b[0], a[1] - b[1]))));

  it('recovers a known planar metric while monotonically improving stress without mutating input', () => {
    const target = [[0, 0], [1, 0], [1, 1], [0, 1], [0.4, 0.2]];
    const matrix = pointDistances(target), original = Array.from(matrix);
    const initial = [[-2, 0.5], [0, -2], [3, 1], [-1, 3], [0.1, 1.7]], saved = structuredClone(initial);
    const stresses: number[] = [];
    const result = refineMetricMds(matrix, target.length, initial, Math.SQRT2, { tolerance: 1e-11, onStress: stress => stresses.push(stress) });
    expect(result.metadata.stress).toBeLessThan(1e-8);
    expect(result.metadata.stress).toBeLessThan(result.metadata.initialStress);
    expect(stresses.every((value, i) => i === 0 || value <= stresses[i - 1] + 1e-10)).toBe(true);
    const embedded = pointDistances(result.coordinates);
    expect(Array.from(embedded).every((value, i) => Math.abs(value - matrix[i] / Math.SQRT2) < 0.001)).toBe(true);
    expect(Array.from(matrix)).toEqual(original);
    expect(initial).toEqual(saved);
  });

  it('defaults to deterministic MDS, preserves shared source placements and reports separate progress', () => {
    const codes = ['a', 'b', 'c', 'd', 'a-split', 'gap'];
    const progress: number[] = [], stages = new Set<string>();
    const first = computeEmbedding(tree, taxa, codes, { onProgress: value => { progress.push(value.percent); stages.add(value.stage); } });
    const second = computeEmbedding(tree, taxa, [...codes].reverse());
    expect(first.metadata.method).toBe('umap-mds');
    expect(first.metadata.mds?.initialization).toBe('umap');
    expect(first.metadata.mds?.stress).toBeLessThanOrEqual(first.metadata.mds!.initialStress);
    expect(first.metadata.mds?.iterations).toBeGreaterThan(1);
    expect(first.metadata.mds?.iterations).toBeLessThanOrEqual(1000);
    expect(first.points).toEqual(second.points);
    expect(first.points.find(p => p.code === 'a')?.x).toBe(first.points.find(p => p.code === 'a-split')?.x);
    expect(first.points.find(p => p.code === 'a')?.y).toBe(first.points.find(p => p.code === 'a-split')?.y);
    expect(first.excludedCodes).toEqual(['gap']);
    expect([...stages]).toEqual(['distances', 'neighbors', 'embedding', 'mds']);
    expect(progress.at(-1)).toBe(100);
    expect(progress.every((value, i) => i === 0 || value >= progress[i - 1])).toBe(true);
  });

  it('checks cancellation during MDS and rejects invalid or collapsed starting data', () => {
    let cancel = false;
    expect(() => computeEmbedding(tree, taxa, ['a', 'b', 'c', 'd'], { onProgress: value => { if (value.stage === 'mds') cancel = true; }, shouldCancel: () => cancel })).toThrow('Embedding cancelled');
    const matrix = pointDistances([[0, 0], [1, 0], [0, 1]]);
    expect(() => refineMetricMds(matrix, 3, [[0, 0], [0, 0], [0, 0]], 1)).toThrow('collapsed');
    const asymmetric = matrix.slice(); asymmetric[3] = NaN;
    expect(() => refineMetricMds(asymmetric, 3, [[0, 0], [1, 0], [0, 1]], 1)).toThrow('finite symmetric');
    expect(() => refineMetricMds(matrix, 3, [[0, 0], [1, 0], [0, 1]], 0)).toThrow('settings');
  });
});
