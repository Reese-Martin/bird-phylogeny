import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseNexus, validateTree } from '../scripts/tree-parser';
import type { TreeData, Taxon } from '../src/types';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const tree: TreeData = read('public/data/tree.json');
const taxa: Taxon[] = read('public/data/taxa.json');

describe('published tree and source provenance', () => {
  it('preserves the full source tip count, dated branch distances and exclusive leaf intervals', () => {
    expect(tree.tips).toHaveLength(11167);
    expect(tree.nodes).toHaveLength(22333);
    const seen = new Set<number>();
    const visit = (id: number) => {
      expect(seen.has(id)).toBe(false); seen.add(id);
      const n = tree.nodes[id];
      expect(n.id).toBe(id);
      expect(n.length).toBeGreaterThanOrEqual(0);
      expect(n.age).toBeCloseTo(tree.maxDistance - n.distance, 9);
      if (!n.children.length) {
        expect(n.leafEnd).toBe(n.leafStart + 1);
        expect(tree.tips[n.leafStart]).toBe(id);
      }
      for (const c of n.children) {
        const child = tree.nodes[c]; expect(child.parent).toBe(id);
        expect(child.distance - n.distance).toBeCloseTo(child.length, 10);
        expect(child.leafStart).toBeGreaterThanOrEqual(n.leafStart);
        expect(child.leafEnd).toBeLessThanOrEqual(n.leafEnd);
        visit(c);
      }
    };
    visit(tree.root); expect(seen.size).toBe(tree.nodes.length);
    expect(tree.nodes[tree.root].leafEnd).toBe(11167);
    expect(tree.maxDistance).toBeCloseTo(98.990012, 6);
    expect(new Set(tree.tips.map(id => tree.nodes[id].name)).size).toBe(11167);
  });

  it('retains annotations and rejects malformed or translated inputs rather than guessing', () => {
    const source = '#NEXUS\nBEGIN TAXA; DIMENSIONS NTAX=2; END;\nBEGIN TREES; TREE 1 = [&R] (A_a:1[&index=1],B_b:1[&index=2])ott1:0[&index=3,posterior=0.75,age_95%_HPD={0.7,1.3}]; END;';
    const parsed = parseNexus(source);
    expect(validateTree(parsed).tipCount).toBe(2);
    expect(parsed.nodes[0].sourceName).toBe('ott1');
    expect(parsed.nodes[0].posterior).toBe(.75);
    expect(parsed.nodes[0].age95Hpd).toEqual([.7,1.3]);
    expect(() => parseNexus(source.replace('NTAX=2','NTAX=3'))).toThrow();
    expect(() => parseNexus(source.replace('A_a:1','A_a:-1'))).toThrow();
    expect(() => parseNexus(source.replace('BEGIN TREES;', 'BEGIN TREES; TRANSLATE 1 A_a;'))).toThrow();
  });

  it('pins every local artwork file and keeps runtime asset URLs local', () => {
    const lock = read('data/sources.lock.json');
    expect(lock.revisions.aves).toMatch(/^[0-9a-f]{40}$/);
    expect(lock.sources.find((s: any) => s.id === 'tree').sha256).toMatch(/^[0-9a-f]{64}$/);
    for (const a of lock.assets) for (const f of a.files) {
      expect(createHash('sha256').update(readFileSync(f.path)).digest('hex')).toBe(f.sha256);
      expect(f.url).toContain(lock.revisions.stickers);
    }
    for (const t of taxa) if (t.sticker) expect(t.sticker).toMatch(/^\/stickers\/(128|384)\/[\w]+\.webp$/);
  }, 60000);

  it('bundles all available global species artwork independently of tree coverage', () => {
    const lock = read('data/sources.lock.json');
    expect(lock.artworkScope).toBe('all-available-current-species');
    expect(lock.assets).toHaveLength(11027);
    expect(new Set(lock.assets.map((a: any) => a.code)).size).toBe(11027);
    expect(taxa.filter(t => !!t.sticker)).toHaveLength(11027);
    expect(taxa.filter(t => !!t.sticker).map(t => t.code).sort()).toEqual(lock.assets.map((a: any) => a.code).sort());
    for (const a of lock.assets) expect(a.files.map((f: any) => f.longSide)).toEqual([128, 384]);
    const manifest = read('public/data/manifest.json');
    const bytes = readFileSync('public/data/artwork-manifest.json');
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.assets.sha256);
    expect(manifest.artwork.bundledSpecies).toBe(11027);
    expect(read('public/data/coverage.json').artwork.gaps).toHaveLength(174);
  });

  it('binds independent ape and clootl audit evidence to the exact prepared tree', () => {
    const audit = read('public/data/tree-audit.json');
    expect(audit.authorPackagedTreeAgrees).toBe(true);
    expect(audit.browserTopologyAgrees).toBe(true);
    expect(audit.browserLeafOrderAgrees).toBe(true);
    expect(audit.maxBrowserRootDistanceError).toBe(0);
    expect(audit.maxBrowserBranchLengthError).toBeLessThan(1e-10);
    expect(audit.preparedTreeSha256).toBe(createHash('sha256').update(readFileSync('public/data/tree.json')).digest('hex'));
    expect(read('public/data/manifest.json').independentAudit.preparedTreeSha256).toBe(audit.preparedTreeSha256);
  });
});

describe('versioned taxonomy crosswalk', () => {
  it('keeps the 2026 Willet descendants as one broader 2025 source-tip aggregate', () => {
    const salt = taxa.find(t => t.code === 'willet2')!;
    const prairie = taxa.find(t => t.code === 'willet3')!;
    expect(salt.commonName).toBe('Saltmarsh Willet');
    expect(prairie.scientificName).toBe('Tringa inornata');
    expect(salt.conceptId).not.toBe(prairie.conceptId);
    expect(salt.mappingStatus).toBe('broader');
    expect(prairie.treeTip).toBe(salt.treeTip);
    expect(tree.nodes[salt.treeTip!].name).toBe('Tringa semipalmata');
    expect(salt.aliases || []).not.toContain('Willet');
    expect(taxa.find(t => t.code === 'willet1')!.category).toBe('slash');
  });

  it('retains all source tips for a lump and all records for reportable categories', () => {
    const sw = taxa.find(t => t.scientificName === 'Apus affinis')!;
    expect(sw.mappingStatus).toBe('narrower');
    expect(sw.treeTips?.map(id => tree.nodes[id].name)).toEqual(['Apus affinis', 'Apus nipalensis']);
    expect(taxa).toHaveLength(18631);
    expect(taxa.filter(t => t.category === 'species')).toHaveLength(11201);
    expect(taxa.some(t => t.category === 'issf' && t.parentCode)).toBe(true);
    expect(taxa.some(t => t.category === 'hybrid')).toBe(true);
  });

  it('accounts for every current species and every source coverage gap', () => {
    const coverage = read('public/data/coverage.json');
    const crosswalk = read('public/data/crosswalk.json');
    expect(Object.values(coverage.mappingStatuses).reduce((a: any,b: any) => a+b,0)).toBe(11201);
    expect(coverage.mappedCurrentSpecies + coverage.currentSpeciesGaps.length).toBe(11201);
    expect(coverage.representedSourceTips + coverage.sourceSpeciesGaps.length).toBe(11167);
    for (const c of crosswalk) {
      if (c.relationship === 'exact' || c.relationship === 'renamed') expect(c.sourceConceptIds).toContain(c.targetConceptId);
      if (c.relationship === 'unresolved') expect(c.sourceTips).toHaveLength(0);
    }
    expect(read('public/data/manifest.json').taxonomy.conceptAudit).toBe('official-full-species');
  });
});
