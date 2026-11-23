import type { Taxon, TreeData } from '../types';

export const MAX_EMBEDDING_GROUPS = 3000;
export interface SourceGroup { key: string; tips: number[]; codes: string[] }

/** Same source concept has one input point, including current species sharing an older tip. */
export function sourceGroups(tree: TreeData, taxa: Taxon[], codes: Iterable<string>) {
  const byCode = new Map(taxa.map((taxon) => [taxon.code, taxon]));
  const grouped = new Map<string, SourceGroup>();
  const excludedCodes: string[] = [];
  for (const code of [...new Set(codes)].sort()) {
    const taxon = byCode.get(code);
    const ids = taxon?.treeTips?.length ? taxon.treeTips : taxon?.treeTip !== undefined ? [taxon.treeTip] : [];
    const tips = [...new Set(ids)].sort((a, b) => a - b);
    if (!taxon || taxon.category !== 'species' || taxon.mappingStatus === 'unresolved' || !tips.length || tips.some((id) => !tree.nodes[id] || tree.nodes[id].children.length)) {
      excludedCodes.push(code); continue;
    }
    const key = tips.join(',');
    const group = grouped.get(key);
    if (group) group.codes.push(code);
    else grouped.set(key, { key, tips, codes: [code] });
  }
  const groups = [...grouped.values()].sort((a, b) => a.codes[0].localeCompare(b.codes[0], 'en'));
  if (groups.length > MAX_EMBEDDING_GROUPS) throw new Error(`This map supports up to ${MAX_EMBEDDING_GROUPS.toLocaleString()} distinct source placements per view. Choose a country with fewer birds. No species were sampled or omitted.`);
  return { groups, excludedCodes };
}

/** Binary-lifting LCA; the published lengths are summed rather than using any display geometry. */
export function patristicIndex(tree: TreeData) {
  const count = tree.nodes.length;
  const levels = Math.max(1, Math.ceil(Math.log2(Math.max(2, count))));
  const ancestors = Array.from({ length: levels }, () => new Int32Array(count).fill(-1));
  const edges = new Int32Array(count).fill(-1);
  const depths = new Float64Array(count);
  if (!tree.nodes[tree.root]) throw new Error('The source tree has no valid root.');
  edges[tree.root] = 0;
  ancestors[0][tree.root] = tree.root;
  const stack = [tree.root];
  while (stack.length) {
    const id = stack.pop()!;
    for (const child of tree.nodes[id].children) {
      const node = tree.nodes[child];
      if (!node || edges[child] !== -1 || !Number.isFinite(node.length) || node.length < 0) throw new Error('Invalid source topology or branch length.');
      edges[child] = edges[id] + 1;
      depths[child] = depths[id] + node.length;
      ancestors[0][child] = id;
      stack.push(child);
    }
  }
  for (let level = 1; level < levels; level++) for (let id = 0; id < count; id++) {
    const parent = ancestors[level - 1][id];
    if (parent >= 0) ancestors[level][id] = ancestors[level - 1][parent];
  }
  function distance(first: number, second: number) {
    if (edges[first] < 0 || edges[second] < 0 || edges[first] === undefined || edges[second] === undefined) throw new Error('A mapped tip is disconnected from the source root.');
    let a = first, b = second;
    if (edges[a] < edges[b]) [a, b] = [b, a];
    const delta = edges[a] - edges[b];
    for (let level = 0; level < levels; level++) if (delta & (1 << level)) a = ancestors[level][a];
    if (a !== b) {
      for (let level = levels - 1; level >= 0; level--) if (ancestors[level][a] !== ancestors[level][b]) { a = ancestors[level][a]; b = ancestors[level][b]; }
      a = ancestors[0][a];
    }
    return Math.max(0, depths[first] + depths[second] - 2 * depths[a]);
  }
  return { distance, depths };
}

/** Multi-tip mappings use the mean cross-tip patristic dissimilarity, never an invented split. */
export function sourceDistance(first: SourceGroup, second: SourceGroup, tipDistance: (a: number, b: number) => number) {
  if (first.key === second.key) return 0;
  let total = 0;
  for (const a of first.tips) for (const b of second.tips) total += tipDistance(a, b);
  return total / (first.tips.length * second.tips.length);
}

export function distanceMatrix(tree: TreeData, groups: SourceGroup[], onRow?: (row: number, total: number) => void, checkCancelled: () => void = () => undefined) {
  const size = groups.length;
  const matrix = new Float64Array(size * size);
  const index = patristicIndex(tree);
  let min = Infinity, max = 0;
  for (let row = 0; row < size; row++) {
    checkCancelled();
    for (let column = row + 1; column < size; column++) {
      const value = sourceDistance(groups[row], groups[column], index.distance);
      matrix[row * size + column] = matrix[column * size + row] = value;
      min = Math.min(min, value); max = Math.max(max, value);
    }
    if (row % 16 === 0 || row === size - 1) onRow?.(row + 1, size);
  }
  return { matrix, range: [Number.isFinite(min) ? min : 0, max] as [number, number] };
}
