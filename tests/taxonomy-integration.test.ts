import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MappingStatus, Taxon, TreeData } from '../src/types';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
interface Crosswalk {
  targetCode: string;
  targetScientificName: string;
  targetConceptId: string;
  targetConceptSource: string;
  officialSourceRow: number;
  officialEvidenceRows: number[];
  sourceConceptIds: string[];
  sourceNames: string[];
  sourceTips: number[];
  relationship: MappingStatus;
  method: string;
  candidateSources: Array<{ conceptId: string; scientificName: string }>;
}

const tree: TreeData = read('public/data/tree.json');
const taxa: Taxon[] = read('public/data/taxa.json');
const taxaByCode = new Map(taxa.map(taxon => [taxon.code, taxon]));
const crosswalk: Crosswalk[] = read('public/data/crosswalk.json');
const crosswalkByCode = new Map(crosswalk.map(row => [row.targetCode, row]));
const coverage = read('public/data/coverage.json');

// These regressions use shipped artifacts; independent authority comparisons run in test:provenance.
describe('prepared global species placements', () => {
  it('places the six previously missing life-list species on their own source concepts', () => {
    const corrected = {
      brnowl: 'avibase-6B54759B', bulori: 'avibase-7E65A952', carcro1: 'avibase-26FB62DA',
      purswa6: 'avibase-0E0D8AE7', rudduc: 'avibase-675EEA7F', yebmag: 'avibase-538A9CA7',
    };
    for (const [code, conceptId] of Object.entries(corrected)) {
      const row = crosswalkByCode.get(code)!;
      expect(row.targetConceptId, code).toBe(conceptId);
      expect(row.sourceConceptIds, code).toEqual([conceptId]);
      expect(['exact', 'renamed']).toContain(row.relationship);
      expect(tree.nodes[row.sourceTips[0]].name, code).toBe(row.sourceNames[0]);
    }
    const names = Object.keys(corrected).map(code => tree.nodes[taxaByCode.get(code)!.treeTip!].name);
    expect(names).toEqual(['Tyto furcata', 'Icterus bullockii', 'Corvus corone', 'Porphyrio melanotus', 'Oxyura jamaicensis', 'Pica nuttalli']);
    expect(names).not.toContain('Tyto glaucops');
    expect(names).not.toContain('Corvus cornix');
    expect(names).not.toContain('Oxyura ferruginea');
  });

  it('retains complete older source membership for all four current lumps', () => {
    const lumps: Record<string, string[]> = {
      'Aerodramus leucophaeus': ['Aerodramus leucophaeus', 'Aerodramus ocistus'],
      'Apus affinis': ['Apus affinis', 'Apus nipalensis'],
      'Tyto novaehollandiae': ['Tyto novaehollandiae', 'Tyto almae', 'Tyto sororcula', 'Tyto manusi'],
      'Tyto javanica': ['Tyto javanica', 'Tyto nigrobrunnea', 'Tyto rosenbergii'],
    };
    for (const [name, sources] of Object.entries(lumps)) {
      const currentRow = taxa.find(taxon => taxon.scientificName === name)!;
      const mapping = crosswalkByCode.get(currentRow.code)!;
      expect(mapping.relationship).toBe('narrower');
      expect(mapping.method).toBe('reviewed-change');
      expect([...mapping.sourceNames].sort()).toEqual([...sources].sort());
      expect(mapping.sourceTips.map(tip => tree.nodes[tip].name).sort()).toEqual([...sources].sort());
      expect([...taxaByCode.get(currentRow.code)!.treeTips!].sort((a, b) => a - b)).toEqual([...mapping.sourceTips].sort((a, b) => a - b));
    }
  });

  it('preserves the same old tip for newly split daughters without inventing a species divergence', () => {
    const daughters = [['willet2', 'willet3'], ['penhac1', 'larhac1'], ['chefan1', 'citfan1']];
    for (const codes of daughters) {
      const records = codes.map(code => crosswalkByCode.get(code)!);
      expect(new Set(records.map(row => row.targetConceptId)).size).toBe(2);
      expect(records[0].sourceTips).toEqual(records[1].sourceTips);
      for (const row of records) {
        expect(row.relationship).toBe('broader');
        expect(row.sourceTips).toHaveLength(1);
        expect(row.sourceConceptIds).not.toContain(row.targetConceptId);
      }
    }
  });

  it('retains six genuinely unavailable or overlapping placements as explicit gaps', () => {
    const unresolved = crosswalk.filter(row => row.relationship === 'unresolved');
    expect(unresolved.map(row => row.targetCode).sort()).toEqual(['sddtin1', 'hoojeb1', 'papcus1', 'plalar1', 'sttbab1', 'blcwar1'].sort());
    for (const row of unresolved) {
      expect(row.sourceTips).toEqual([]);
      expect(row.sourceConceptIds).toEqual([]);
      expect(row.method).toBe('unresolved');
      expect(taxaByCode.get(row.targetCode)!.treeTip).toBeUndefined();
      expect(taxaByCode.get(row.targetCode)!.treeTips).toBeUndefined();
      expect(taxaByCode.get(row.targetCode)!.mappingNote!.length).toBeGreaterThan(30);
      for (const candidate of row.candidateSources) {
        expect(candidate.conceptId).toMatch(/^avibase-[A-F0-9]{8}$/);
        expect(candidate.scientificName.length).toBeGreaterThan(0);
      }
    }
    expect(coverage.mappingStatuses).toEqual({ exact: 10928, renamed: 193, broader: 70, narrower: 4, unresolved: 6 });
    expect(coverage.officialConceptAudit).toMatchObject({ status: 'official-full-species', speciesAudited: 11201,
      directConceptMatches: 11121, reviewedAnnualChanges: 74, unresolvedSourceConcepts: 6, previousSortAnchorMatches: 11121 });
    expect(coverage.currentSpeciesGaps.map((row: any) => row.code).sort()).toEqual(unresolved.map(row => row.targetCode).sort());
  });
});
