import { describe, expect, it } from 'vitest';
import { ageRingStep, buildLayout, cladeBounds, collectAncestry, computeTreeVisibility, containsPolarSector, findMonophyleticClade, FOOTPRINT_BACKGROUND_FRACTION, lowestCommonAncestor, recordedOrderGroups, resizeViewportTransform } from '../src/tree/geometry';
import type { Taxon, TreeData } from '../src/types';

const tree: TreeData = {
  version: 'fixture', root: 0, tips: [2, 3, 4], maxDistance: 100,
  nodes: [
    { id: 0, parent: null, children: [1, 4], length: 0, distance: 0, age: 100, leafStart: 0, leafEnd: 3 },
    { id: 1, parent: 0, children: [2, 3], length: 60, distance: 60, age: 40, leafStart: 0, leafEnd: 2 },
    { id: 2, parent: 1, children: [], length: 40, distance: 100, age: 0, leafStart: 0, leafEnd: 1 },
    { id: 3, parent: 1, children: [], length: 40, distance: 100, age: 0, leafStart: 1, leafEnd: 2 },
    { id: 4, parent: 0, children: [], length: 100, distance: 100, age: 0, leafStart: 2, leafEnd: 3 },
  ],
};

describe('dated radial geometry', () => {
  it('preserves the source root distance and deterministic leaf order', () => {
    const layout = buildLayout(tree);
    expect(layout.nodes[0].radius).toBe(0);
    expect(layout.nodes[1].radius).toBe(0.6);
    expect(layout.nodes[2].radius).toBe(1);
    expect(layout.nodes[2].angle).toBeLessThan(layout.nodes[3].angle);
    expect(Math.hypot(layout.nodes[4].x, layout.nodes[4].y)).toBeCloseTo(1, 12);
  });

  it('unions shared paths and tolerates an absent tip', () => {
    expect([...collectAncestry(tree, [2, 3, 999])].sort()).toEqual([0, 1, 2, 3]);
  });

  it('distinguishes a verified clade from a taxonomic membership spanning clades', () => {
    expect(lowestCommonAncestor(tree, [2, 3])).toBe(1);
    expect(findMonophyleticClade(tree, [2, 3])).toBe(1);
    expect(findMonophyleticClade(tree, [2, 4])).toBe(null);
    expect(findMonophyleticClade(tree, [2, 2, 3])).toBe(1);
    expect(findMonophyleticClade(tree, [])).toBe(null);
  });

  it('fits the descendant geometry without altering the dated layout', () => {
    const layout = buildLayout(tree);
    const bounds = cladeBounds(tree, layout, [2, 3]);
    expect(bounds).not.toBe(null);
    expect(bounds!.width).toBeGreaterThan(0);
    expect(layout.nodes[1].radius * tree.maxDistance).toBe(60);
    expect(ageRingStep(100)).toBe(20);
  });

  it('keeps the calibrated mode unchanged even when only a subset is visible', () => {
    const full = buildLayout(tree);
    const filtered = buildLayout(tree, { mode: 'true-distance', visibleTips: [2, 4] });
    expect(filtered.mode).toBe('true-distance');
    expect(filtered.nodes).toEqual(full.nodes);
    expect(filtered.nodes[1].radius).toBe(0.6);
  });

  it('compacts long edges and redistributes visible tips while preserving source topology and dates', () => {
    const source = JSON.stringify(tree);
    const compact = buildLayout(tree, { mode: 'compact', visibleTips: [2, 4] });
    expect(compact.mode).toBe('compact');
    expect(compact.tipCount).toBe(2);
    expect(compact.nodes[0].radius).toBe(0);
    expect(compact.nodes[1].radius).toBeGreaterThan(0);
    expect(compact.nodes[2].radius).toBeGreaterThan(compact.nodes[1].radius);
    expect(compact.nodes[4].radius).toBeLessThan(1);
    expect(compact.nodes[4].angle - compact.nodes[2].angle).toBeCloseTo(Math.PI, 12);
    expect(JSON.stringify(tree)).toBe(source);
  });

  it('fans a selected group angularly without changing calibrated radial distances', () => {
    const metric = buildLayout(tree);
    const fan = buildLayout(tree, { mode: 'true-distance', visibleTips: [2, 3], fanAngle: Math.PI * 4 / 3 });
    expect(fan.nodes.map((node) => node.radius)).toEqual(metric.nodes.map((node) => node.radius));
    expect(fan.nodes[2].angle).toBeLessThan(fan.nodes[3].angle);
    expect(fan.nodes[3].angle - fan.nodes[2].angle).toBeLessThan(Math.PI * 4 / 3);
    expect(fan.nodes[1].angle).toBeCloseTo(-Math.PI / 2, 12);
  });

  it('preserves a focused world point when resizing from desktop to mobile', () => {
    const previous = { width: 1000, height: 700 }, next = { width: 375, height: 600 };
    const transform = { x: -300, y: 200, k: 1000 };
    const resized = resizeViewportTransform(previous, next, transform, 250, 125);
    expect((next.width / 2 - resized.x) / resized.k).toBeCloseTo((previous.width / 2 - transform.x) / transform.k, 12);
    expect((next.height / 2 - resized.y) / resized.k).toBeCloseTo((previous.height / 2 - transform.y) / transform.k, 12);
    expect(resizeViewportTransform(previous, next, { x: 0, y: 0, k: 1 }, 250, 125)).toEqual({ x: 187.5, y: 300, k: 125 });
  });

  it('hits expanded order wedges across the angular wrap without capturing the tree center', () => {
    const sector = { start: -Math.PI * 1.2, end: -Math.PI * 0.8, inner: 0.9, outer: 1.1 };
    expect(containsPolarSector(-1, 0, sector)).toBe(true);
    expect(containsPolarSector(1, 0, sector)).toBe(false);
    expect(containsPolarSector(0, 0, sector)).toBe(false);
  });
});

describe('portrait-footprint angular spacing', () => {
  const weights = new Map([[2, 1], [3, 3]]);

  it('allocates weighted leaf slots and nested clade intervals without changing dated radii or source data', () => {
    const source = JSON.stringify(tree), reference = buildLayout(tree);
    const layout = buildLayout(tree, { tipWeights: weights });
    expect(layout.nodes.map(node => node.radius)).toEqual(reference.nodes.map(node => node.radius));
    expect(JSON.stringify(tree)).toBe(source);
    expect([...weights]).toEqual([[2, 1], [3, 3]]);
    const first = layout.nodes[2], second = layout.nodes[3], background = layout.nodes[4], parent = layout.nodes[1];
    const slot = (first.angularEnd! - first.angularStart!);
    expect(second.angularEnd! - second.angularStart!).toBeCloseTo(slot * 3, 12);
    expect(first.angle).toBeCloseTo((first.angularStart! + first.angularEnd!) / 2, 12);
    expect(parent.angle).toBeCloseTo((first.angularStart! + second.angularEnd!) / 2, 12);
    expect(background.angularEnd! - background.angularStart!).toBeGreaterThan(0);
    expect((background.angularEnd! - background.angularStart!) / (Math.PI * 2)).toBeCloseTo(FOOTPRINT_BACKGROUND_FRACTION / (1 + FOOTPRINT_BACKGROUND_FRACTION), 12);
    expect(layout.nodes[0].angularStart).toBe(-Math.PI / 2);
    expect(layout.nodes[0].angularEnd).toBeCloseTo(Math.PI * 1.5, 12);
    for (const node of tree.nodes) for (const child of node.children) {
      expect(layout.nodes[child].angularStart!).toBeGreaterThanOrEqual(layout.nodes[node.id].angularStart!);
      expect(layout.nodes[child].angularEnd!).toBeLessThanOrEqual(layout.nodes[node.id].angularEnd!);
    }
    expect(tree.tips.map(tip => layout.nodes[tip].angle)).toEqual([...tree.tips].map(tip => layout.nodes[tip].angle).sort((a, b) => a - b));
  });

  it('anchors the full-circle angles to country weights rather than transient visibility or background branches', () => {
    const all = buildLayout(tree, { tipWeights: weights, visibleTips: tree.tips });
    const subset = buildLayout(tree, { tipWeights: weights, visibleTips: [2] });
    const none = buildLayout(tree, { tipWeights: weights, visibleTips: [] });
    expect(subset.nodes).toEqual(all.nodes); expect(none.nodes).toEqual(all.nodes);
    expect(buildLayout(tree, { tipWeights: new Map([...weights].reverse()) }).nodes).toEqual(all.nodes);
  });

  it('retains compact radial compression while using country footprint angles', () => {
    const compact = buildLayout(tree, { mode: 'compact', visibleTips: [2, 4] });
    const footprint = buildLayout(tree, { mode: 'compact', visibleTips: [2, 4], tipWeights: weights });
    expect(footprint.nodes.map(node => node.radius)).toEqual(compact.nodes.map(node => node.radius));
    expect(footprint.nodes.map(node => node.angle)).toEqual(buildLayout(tree, { tipWeights: weights }).nodes.map(node => node.angle));
    expect(footprint.tipCount).toBe(2);
  });

  it('fans the requested visible membership with weighted slots and unchanged true distances', () => {
    const reference = buildLayout(tree, { tipWeights: weights });
    const span = Math.PI * 4 / 3;
    const fan = buildLayout(tree, { tipWeights: weights, visibleTips: [2, 3], fanAngle: span });
    expect(fan.nodes.map(node => node.radius)).toEqual(reference.nodes.map(node => node.radius));
    expect(fan.nodes[1].angle).toBeCloseTo(-Math.PI / 2, 12);
    expect(fan.nodes[2].angularStart).toBeCloseTo(-Math.PI / 2 - span / 2, 12);
    expect(fan.nodes[3].angularEnd).toBeCloseTo(-Math.PI / 2 + span / 2, 12);
    expect(fan.nodes[3].angularEnd! - fan.nodes[3].angularStart!).toBeCloseTo(3 * (fan.nodes[2].angularEnd! - fan.nodes[2].angularStart!), 12);
    expect(fan.nodes[4]).toEqual(reference.nodes[4]);
  });

  it('keeps fan angles stable with an explicit angular domain while drawn and background membership changes', () => {
    const options = { tipWeights: weights, angularTips: [2, 3], fanAngle: Math.PI * 4 / 3 };
    const recordedOnly = buildLayout(tree, { ...options, visibleTips: [2] });
    const withBackgroundAndContext = buildLayout(tree, { ...options, visibleTips: [2, 3, 4] });
    expect(recordedOnly.nodes).toEqual(withBackgroundAndContext.nodes);
    expect(recordedOnly.tipCount).toBe(2);
    expect(recordedOnly.nodes.map(node => node.radius)).toEqual(buildLayout(tree).nodes.map(node => node.radius));
    expect(recordedOnly.nodes[2].angularStart).toBeCloseTo(-Math.PI / 2 - options.fanAngle / 2, 12);
    expect(recordedOnly.nodes[3].angularEnd).toBeCloseTo(-Math.PI / 2 + options.fanAngle / 2, 12);
    const compactRecorded = buildLayout(tree, { ...options, mode: 'compact', visibleTips: [2] });
    const compactBackground = buildLayout(tree, { ...options, mode: 'compact', visibleTips: [2, 3, 4] });
    expect(compactRecorded.nodes.map(node => node.angle)).toEqual(compactBackground.nodes.map(node => node.angle));
    expect(compactRecorded.nodes.map(node => node.radius)).toEqual(buildLayout(tree, { mode: 'compact', visibleTips: [2] }).nodes.map(node => node.radius));
    expect(compactBackground.nodes.map(node => node.radius)).toEqual(buildLayout(tree, { mode: 'compact', visibleTips: [2, 3, 4] }).nodes.map(node => node.radius));
    expect(buildLayout(tree, { angularTips: [2, 3], fanAngle: options.fanAngle, visibleTips: [2] }).nodes)
      .toEqual(buildLayout(tree, { angularTips: [2, 3], fanAngle: options.fanAngle, visibleTips: [2, 3, 4] }).nodes);
    expect(buildLayout(tree, { tipWeights: weights, angularTips: [2] }).nodes).toEqual(buildLayout(tree, { tipWeights: weights }).nodes);
  });

  it('keeps positive source slots and finite coordinates with extreme finite input weights', () => {
    const extreme = buildLayout(tree, { tipWeights: new Map([[2, 1e308], [3, 1e-308]]) });
    for (const tip of tree.tips) {
      const node = extreme.nodes[tip];
      expect([node.angle, node.radius, node.x, node.y, node.angularStart!, node.angularEnd!].every(Number.isFinite)).toBe(true);
      expect(node.angularEnd! - node.angularStart!).toBeGreaterThan(0);
    }
    expect(extreme.nodes[2].angle).toBeLessThan(extreme.nodes[3].angle);
    expect(extreme.nodes[3].angle).toBeLessThan(extreme.nodes[4].angle);
    const equalLarge = buildLayout(tree, { tipWeights: new Map([[2, 1e308], [3, 1e308]]) });
    expect(equalLarge.nodes).toEqual(buildLayout(tree, { tipWeights: new Map([[2, 1], [3, 1]]) }).nodes);
  });

  it('keeps empty-reference legacy behavior and rejects invalid tip weights', () => {
    expect(buildLayout(tree, { tipWeights: new Map() })).toEqual(buildLayout(tree));
    for (const value of [0, -1, NaN, Infinity]) expect(() => buildLayout(tree, { tipWeights: new Map([[2, value]]) })).toThrow('tip weight');
    for (const id of [1, 99, NaN]) expect(() => buildLayout(tree, { tipWeights: new Map([[id, 1]]) })).toThrow('tip weight');
    for (const fanAngle of [0, -1, NaN, Infinity, Math.PI * 3]) expect(() => buildLayout(tree, { tipWeights: weights, fanAngle })).toThrow('fan angle');
  });
});

const taxa: Taxon[] = [
  { code: 'a', commonName: 'Bird A', scientificName: 'Birdus alpha', category: 'species', mappingStatus: 'exact', treeTip: 2 },
  { code: 'b', commonName: 'Bird B', scientificName: 'Birdus beta', category: 'species', mappingStatus: 'exact', treeTip: 3 },
  { code: 'c', commonName: 'Bird C', scientificName: 'Otherus gamma', category: 'species', mappingStatus: 'exact', treeTip: 4 },
  { code: 'gap', commonName: 'Unresolved bird', scientificName: 'Unknown gamma', category: 'species', mappingStatus: 'unresolved', treeTip: 4 },
];

describe('personal-tree visibility', () => {
  it('counts known recorded species with source gaps in an order without inventing paths', () => {
    const orderTaxa = taxa.map((taxon) => ({ ...taxon, order: 'Anseriformes' }));
    const recorded = new Set(['a', 'gap']);
    expect(recordedOrderGroups(orderTaxa, recorded).get('Anseriformes')).toHaveLength(2);
    const view = computeTreeVisibility(tree, orderTaxa, recorded, null);
    expect([...view.recordedTipIds]).toEqual([2]);
    expect(view.recordedNodeIds.has(4)).toBe(false);
  });

  it('defaults to exactly the root paths needed by the visible recorded species', () => {
    const view = computeTreeVisibility(tree, taxa, new Set(['a']), null);
    expect([...view.nodeIds].sort()).toEqual([0, 1, 2]);
    expect([...view.tipIds]).toEqual([2]);
    expect(view.nodeIds.has(3)).toBe(false);
    expect(view.nodeIds.has(4)).toBe(false);
  });

  it('replaces filtered paths and preserves source dates, topology and leaf angles', () => {
    const before = JSON.stringify(tree);
    const all = computeTreeVisibility(tree, taxa, new Set(['a', 'c']), null);
    const filtered = computeTreeVisibility(tree, taxa, new Set(['c']), null);
    expect([...all.tipIds].sort()).toEqual([2, 4]);
    expect([...filtered.nodeIds].sort()).toEqual([0, 4]);
    expect(JSON.stringify(tree)).toBe(before);
    expect(buildLayout(tree).nodes[4].radius).toBe(1);
  });

  it('adds an explicitly selected unrecorded species as separate selection context', () => {
    const view = computeTreeVisibility(tree, taxa, new Set(['a']), 'c');
    expect([...view.recordedNodeIds].sort()).toEqual([0, 1, 2]);
    expect([...view.selectedNodeIds].sort()).toEqual([0, 4]);
    expect([...view.tipIds].sort()).toEqual([2, 4]);
  });

  it('never invents ancestry for unresolved selections and reveals background only by opt-in', () => {
    expect(computeTreeVisibility(tree, taxa, new Set(), 'gap').nodeIds.size).toBe(0);
    const full = computeTreeVisibility(tree, taxa, new Set(['a']), null, true);
    expect([...full.nodeIds].sort()).toEqual([0, 1, 2, 3, 4]);
    expect([...full.tipIds]).toEqual(tree.tips);
  });

  it('keeps optional background branches within the active group', () => {
    const view = computeTreeVisibility(tree, taxa, new Set(['a']), null, true, new Set(['a', 'b']));
    expect([...view.backgroundTipIds].sort()).toEqual([2, 3]);
    expect([...view.nodeIds].sort()).toEqual([0, 1, 2, 3]);
    expect(view.tipIds.has(4)).toBe(false);
    expect(view.nodeIds.has(4)).toBe(false);
  });
});
