import type { Taxon, TreeData, TreeNode } from '../types';

export interface LayoutNode {
  id: number;
  angle: number;
  radius: number;
  x: number;
  y: number;
  /** Decorative angular interval; present when portrait-footprint spacing is used. */
  angularStart?: number;
  angularEnd?: number;
}

export interface TreeLayout {
  nodes: LayoutNode[];
  tipCount: number;
  maxDistance: number;
  mode: LayoutMode;
}

export type LayoutMode = 'true-distance' | 'compact';
export interface LayoutOptions {
  mode?: LayoutMode;
  visibleTips?: Iterable<number>;
  fanAngle?: number;
  /** Stable fan membership, independent of currently drawn/background paths. */
  angularTips?: Iterable<number>;
  /** Complete country reference. Omitted source tips retain a small positive slot. */
  tipWeights?: ReadonlyMap<number, number>;
}

/** Combined angular weight reserved for source tips outside the recorded reference. */
export const FOOTPRINT_BACKGROUND_FRACTION = 1e-4;

/** Resize keeps the same world point at the viewport center, including first mobile fit. */
export function resizeViewportTransform(previous: {width:number;height:number}, next: {width:number;height:number}, transform: {x:number;y:number;k:number}, previousScale: number, nextScale: number) {
  if (transform.k === 1) return { x: next.width / 2, y: next.height / 2, k: nextScale };
  const centerX = (previous.width / 2 - transform.x) / transform.k;
  const centerY = (previous.height / 2 - transform.y) / transform.k;
  const k = transform.k / previousScale * nextScale;
  return { x: next.width / 2 - centerX * k, y: next.height / 2 - centerY * k, k };
}

export function containsPolarSector(x: number, y: number, sector: {start:number;end:number;inner:number;outer:number}): boolean {
  const radius = Math.hypot(x, y);
  if (radius < sector.inner || radius > sector.outer) return false;
  const tau = Math.PI * 2;
  const angle = ((Math.atan2(y, x) - sector.start) % tau + tau) % tau + sector.start;
  return angle <= sector.end + 1e-10;
}

export function mappedTipIds(taxon?: Taxon): number[] {
  if (!taxon || taxon.mappingStatus === 'unresolved') return [];
  return taxon.treeTips?.length ? taxon.treeTips : taxon.treeTip !== undefined ? [taxon.treeTip] : [];
}

/** Collection counts include known taxonomy species whose source placement is missing. */
export function recordedOrderGroups(taxa: Iterable<Taxon>, recordedCodes: Set<string>): Map<string, Taxon[]> {
  const groups = new Map<string, Taxon[]>();
  for (const taxon of taxa) {
    if (taxon.category !== 'species' || !taxon.order || !recordedCodes.has(taxon.code)) continue;
    const members = groups.get(taxon.order) || [];
    members.push(taxon); groups.set(taxon.order, members);
  }
  return groups;
}

export interface TreeVisibility {
  recordedTipIds: Set<number>;
  selectedTipIds: Set<number>;
  backgroundTipIds: Set<number>;
  tipIds: Set<number>;
  recordedNodeIds: Set<number>;
  selectedNodeIds: Set<number>;
  backgroundNodeIds: Set<number>;
  nodeIds: Set<number>;
}

/** Visibility only removes source paths; it never rewrites nodes, dates or angles. */
export function computeTreeVisibility(tree: TreeData, taxa: Iterable<Taxon>, visibleCodes: Set<string>, selectedCode: string | null, showAllBranches = false, backgroundCodes?: Set<string>): TreeVisibility {
  const recordedTipIds = new Set<number>();
  const selectedTipIds = new Set<number>();
  const backgroundTipIds = showAllBranches && !backgroundCodes ? new Set(tree.tips) : new Set<number>();
  for (const taxon of taxa) {
    if (taxon.category !== 'species') continue;
    const recorded = visibleCodes.has(taxon.code);
    const selected = taxon.code === selectedCode;
    const background = showAllBranches && backgroundCodes?.has(taxon.code);
    if (!recorded && !selected && !background) continue;
    for (const tip of mappedTipIds(taxon)) {
      if (!tree.nodes[tip] || tree.nodes[tip].children.length) continue;
      if (recorded) recordedTipIds.add(tip);
      if (selected) selectedTipIds.add(tip);
      if (background) backgroundTipIds.add(tip);
    }
  }
  const recordedNodeIds = collectAncestry(tree, recordedTipIds);
  const selectedNodeIds = collectAncestry(tree, selectedTipIds);
  const backgroundNodeIds = collectAncestry(tree, backgroundTipIds);
  const tipIds = new Set([...backgroundTipIds, ...recordedTipIds, ...selectedTipIds]);
  const nodeIds = new Set([...backgroundNodeIds, ...recordedNodeIds, ...selectedNodeIds]);
  return { recordedTipIds, selectedTipIds, backgroundTipIds, tipIds, recordedNodeIds, selectedNodeIds, backgroundNodeIds, nodeIds };
}

/** Leaf intervals are [start, end) and follow the unmodified source-tree order. */
export function buildLayout(tree: TreeData, options: LayoutOptions = {}): TreeLayout {
  const mode = options.mode || 'true-distance';
  const count = tree.tips.length;
  const maximum = tree.maxDistance || Math.max(...tree.nodes.map((node) => node.distance));
  const visibleTips = options.visibleTips ? new Set(options.visibleTips) : new Set(tree.tips);
  const compactCount = tree.tips.filter((tip) => visibleTips.has(tip)).length;
  const angularTips = options.fanAngle !== undefined && options.angularTips ? new Set(options.angularTips) : visibleTips;
  const angularCount = options.fanAngle !== undefined ? tree.tips.filter(tip => angularTips.has(tip)).length : compactCount;
  const redistributeAngles = mode === 'compact' || options.fanAngle !== undefined;
  const prefix = new Uint32Array(count + 1);
  if (redistributeAngles) for (let index = 0; index < count; index++) prefix[index + 1] = prefix[index] + Number(angularTips.has(tree.tips[index]));
  let weightedPrefix: Float64Array | undefined, weightedFanPrefix: Float64Array | undefined;
  if (options.tipWeights?.size) {
    const tips = new Set(tree.tips);
    let largest = 0;
    for (const [tip, weight] of options.tipWeights) {
      if (!tips.has(tip) || !Number.isFinite(weight) || weight <= 0) throw new Error('Invalid portrait-footprint tip weight.');
      largest = Math.max(largest, weight);
    }
    if (options.fanAngle !== undefined && (!Number.isFinite(options.fanAngle) || options.fanAngle <= 0 || options.fanAngle > Math.PI * 2)) throw new Error('Invalid portrait-footprint fan angle.');
    // Max normalization keeps finite positive input weights from overflowing.
    const normalized = new Map([...options.tipWeights].map(([tip, weight]) => [tip, weight / largest]));
    const recordedWeight = [...normalized.values()].reduce((sum, weight) => sum + weight, 0);
    const backgroundCount = count - normalized.size;
    const floor = recordedWeight * FOOTPRINT_BACKGROUND_FRACTION / Math.max(1, backgroundCount || count);
    weightedPrefix = new Float64Array(count + 1);
    if (options.fanAngle !== undefined) weightedFanPrefix = new Float64Array(count + 1);
    for (let index = 0; index < count; index++) {
      const tip = tree.tips[index];
      // The floor also protects extremely small explicit weights after normalization.
      const weight = Math.max(normalized.get(tip) ?? floor, floor);
      weightedPrefix[index + 1] = weightedPrefix[index] + weight;
      if (weightedFanPrefix) weightedFanPrefix[index + 1] = weightedFanPrefix[index] + (angularTips.has(tip) ? weight : 0);
    }
  }
  const transformed = new Float64Array(tree.nodes.length);
  let compactMaximum = 1;
  if (mode === 'compact') {
    const ancestry = collectAncestry(tree, visibleTips);
    const positive = tree.nodes.filter((node) => ancestry.has(node.id) && node.length > 0).map((node) => node.length).sort((a, b) => a - b);
    const scale = positive[Math.floor(positive.length / 2)] || 1;
    const pending = [tree.root];
    while (pending.length) {
      const id = pending.pop()!;
      const node = tree.nodes[id];
      for (const childId of node.children) {
        transformed[childId] = transformed[id] + Math.log1p(Math.max(0, tree.nodes[childId].length) / scale);
        pending.push(childId);
      }
    }
    compactMaximum = Math.max(1e-12, ...tree.tips.filter((tip) => visibleTips.has(tip)).map((tip) => transformed[tip]));
  }
  const nodes: LayoutNode[] = [];
  for (const node of tree.nodes) {
    const hasVisibleDescendants = redistributeAngles && prefix[node.leafEnd] > prefix[node.leafStart];
    const midpoint = hasVisibleDescendants ? (prefix[node.leafStart] + prefix[node.leafEnd]) / 2 : (node.leafStart + node.leafEnd) / 2;
    const fraction = midpoint / Math.max(1, hasVisibleDescendants ? angularCount : count);
    let angle = options.fanAngle !== undefined && hasVisibleDescendants
      ? (fraction - 0.5) * options.fanAngle - Math.PI / 2
      : fraction * Math.PI * 2 - Math.PI / 2;
    let angularStart: number | undefined, angularEnd: number | undefined;
    if (weightedPrefix) {
      const inFan = weightedFanPrefix && weightedFanPrefix[node.leafEnd] > weightedFanPrefix[node.leafStart];
      const angularPrefix = inFan ? weightedFanPrefix! : weightedPrefix;
      const span = inFan ? options.fanAngle! : Math.PI * 2;
      const start = inFan ? -Math.PI / 2 - span / 2 : -Math.PI / 2;
      const total = angularPrefix[count];
      angularStart = start + angularPrefix[node.leafStart] / total * span;
      angularEnd = start + angularPrefix[node.leafEnd] / total * span;
      angle = (angularStart + angularEnd) / 2;
    }
    const radius = mode === 'compact' ? transformed[node.id] / compactMaximum : node.distance / (maximum || 1);
    nodes[node.id] = { id: node.id, angle, radius, x: Math.cos(angle) * radius, y: Math.sin(angle) * radius,
      ...(angularStart !== undefined ? { angularStart, angularEnd } : {}) };
  }
  return { nodes, tipCount: redistributeAngles ? angularCount : count, maxDistance: maximum, mode };
}

/** Return node IDs for the union of all tip-to-root paths, including the root. */
export function collectAncestry(tree: TreeData, tips: Iterable<number>): Set<number> {
  const result = new Set<number>();
  for (const tip of tips) {
    let current: number | null = tip;
    while (current !== null && !result.has(current)) {
      const node: TreeNode | undefined = tree.nodes[current];
      if (!node) break;
      result.add(current);
      current = node.parent;
    }
  }
  return result;
}

export function lowestCommonAncestor(tree: TreeData, tips: number[]): number | null {
  if (!tips.length) return null;
  if (!tree.nodes[tips[0]]) return null;
  let ancestor: number | null = tips[0];
  for (const tip of tips.slice(1)) {
    const path = new Set<number>();
    let current: number | null = tip;
    while (current !== null) {
      if (!tree.nodes[current]) return null;
      path.add(current);
      current = tree.nodes[current].parent;
    }
    while (ancestor !== null && !path.has(ancestor)) ancestor = tree.nodes[ancestor]?.parent ?? null;
    if (ancestor === null) break;
  }
  return ancestor;
}

/** A family/order is a single clade only when the MRCA has exactly these tips. */
export function findMonophyleticClade(tree: TreeData, tips: number[]): number | null {
  const unique = new Set(tips);
  const ancestor = lowestCommonAncestor(tree, [...unique]);
  if (ancestor === null) return null;
  const node = tree.nodes[ancestor];
  if (node.leafEnd - node.leafStart !== unique.size) return null;
  for (let index = node.leafStart; index < node.leafEnd; index++) {
    if (!unique.has(tree.tips[index])) return null;
  }
  return ancestor;
}

export function cladeBounds(tree: TreeData, layout: TreeLayout, tips: number[], visibleNodes?: Set<number>): { x: number; y: number; width: number; height: number } | null {
  const ancestor = lowestCommonAncestor(tree, tips);
  if (ancestor === null) return null;
  const root = tree.nodes[ancestor];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of tree.nodes) {
    if (visibleNodes && !visibleNodes.has(node.id)) continue;
    if (node.leafStart < root.leafStart || node.leafEnd > root.leafEnd) continue;
    const point = layout.nodes[node.id];
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, width: Math.max(0.03, maxX - minX), height: Math.max(0.03, maxY - minY) };
}

/** Return an age-ring step which keeps the global scale legible. */
export function ageRingStep(maxAge: number): number {
  if (maxAge <= 10) return 2;
  if (maxAge <= 40) return 10;
  if (maxAge <= 120) return 20;
  return 40;
}
