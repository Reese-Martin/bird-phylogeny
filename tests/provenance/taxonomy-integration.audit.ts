import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import Papa from 'papaparse';
import { describe, expect, it } from 'vitest';
import type { MappingStatus, Taxon, TreeData } from '../../src/types';

const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
interface OfficialRow {
  sourceRow: number;
  category: string | null;
  code: string;
  conceptId: string;
  commonName: string;
  scientificName: string;
  order: string;
  familySciName: string;
  sort2025: string | number | null;
  changes: string | null;
}
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

// Read the authority and the older source independently of the crosswalk builder.
const official = read('data/raw/clements2026-integrated.json');
const officialRows: OfficialRow[] = official.rows;
const current = officialRows.filter(row => row.category === 'species');
const officialSourceRows = new Set(officialRows.map(row => row.sourceRow));
const csv = Papa.parse<Record<string, string>>(readFileSync('data/raw/ott2025.csv', 'utf8'), { header: true, skipEmptyLines: true });
if (csv.errors.length) throw new Error('The independently read source taxonomy is not valid CSV.');
const sourceByConcept = new Map(csv.data.map(row => [row.TAXON_CONCEPT_ID, row]));
const tree: TreeData = read('public/data/tree.json');
const taxa: Taxon[] = read('public/data/taxa.json');
const taxaByCode = new Map(taxa.map(taxon => [taxon.code, taxon]));
const crosswalk: Crosswalk[] = read('public/data/crosswalk.json');
const crosswalkByCode = new Map(crosswalk.map(row => [row.targetCode, row]));
const coverage = read('public/data/coverage.json');

describe('official integrated checklist and global species identity', () => {
  it('pins the supplied workbook and accounts for every official species and reportable taxon', () => {
    const provenance = read('data/clements2026-source.json');
    expect(createHash('sha256').update(readFileSync(provenance.source.path)).digest('hex')).toBe('69c5e6dc79989a604930d314e51fb13d777369511c265347b067807c780714af');
    expect(createHash('sha256').update(readFileSync(provenance.output.path)).digest('hex')).toBe(provenance.output.sha256);
    expect(officialRows).toHaveLength(36128);
    expect(current).toHaveLength(11201);
    expect(new Set(current.map(row => row.code)).size).toBe(11201);
    expect(new Set(current.map(row => row.conceptId)).size).toBe(11201);
    expect(crosswalk).toHaveLength(11201);
    expect(crosswalkByCode.size).toBe(11201);
    expect(taxa).toHaveLength(18631);
    const api = read('data/raw/ebird2026.json');
    expect(taxa.map(t => [t.code, t.category, t.scientificName, t.commonName])).toEqual(api.map((t: any) => [t.speciesCode, t.category, t.sciName, t.comName]));
    for (const row of current) {
      expect(taxaByCode.get(row.code), row.code).toMatchObject({
        code: row.code, scientificName: row.scientificName, commonName: row.commonName,
        conceptId: row.conceptId, order: row.order, family: row.familySciName,
      });
      const mapping = crosswalkByCode.get(row.code)!;
      expect(mapping).toMatchObject({ targetConceptId: row.conceptId, targetScientificName: row.scientificName,
        targetConceptSource: 'official-clements2026-integrated', officialSourceRow: row.sourceRow });
      expect(mapping.officialEvidenceRows).toContain(row.sourceRow);
      expect(mapping.officialEvidenceRows.every(sourceRow => officialSourceRows.has(sourceRow))).toBe(true);
    }
  });

  it('joins all 11,121 unchanged concepts by identity, even when names or artwork taxonomy differ', () => {
    const direct = current.filter(row => sourceByConcept.has(row.conceptId));
    expect(direct).toHaveLength(11121);
    let exact = 0, renamed = 0;
    for (const row of direct) {
      const source = sourceByConcept.get(row.conceptId)!;
      // This independently verifies the meaning of the workbook's retained
      // 2025 sort column before it is used as annual-change evidence.
      expect(Number(row.sort2025), row.code).toBe(Number(source.TAXON_ORDER));
      const nameChanged = source.SCI_NAME !== row.scientificName || source.PRIMARY_COM_NAME !== row.commonName;
      if (nameChanged) renamed++; else exact++;
      const mapping = crosswalkByCode.get(row.code)!;
      expect(mapping.method, row.code).toBe('official-concept-id');
      expect(mapping.relationship, row.code).toBe(nameChanged ? 'renamed' : 'exact');
      expect(mapping.sourceConceptIds, row.code).toEqual([row.conceptId]);
      expect(mapping.sourceNames, row.code).toEqual([source.SCI_NAME]);
      expect(mapping.sourceTips, row.code).toHaveLength(1);
      expect(tree.nodes[mapping.sourceTips[0]].name, row.code).toBe(source.SCI_NAME);
      expect(taxaByCode.get(row.code)!.treeTip, row.code).toBe(mapping.sourceTips[0]);
    }
    expect({ exact, renamed }).toEqual({ exact: 10928, renamed: 193 });
  });

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
      expect(tree.nodes[row.sourceTips[0]].name, code).toBe(sourceByConcept.get(conceptId)!.SCI_NAME);
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
      const currentRow = current.find(row => row.scientificName === name)!;
      expect(currentRow.changes).toContain('lump');
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
      for (const candidate of row.candidateSources) expect(sourceByConcept.get(candidate.conceptId)!.SCI_NAME).toBe(candidate.scientificName);
    }
    expect(coverage.mappingStatuses).toEqual({ exact: 10928, renamed: 193, broader: 70, narrower: 4, unresolved: 6 });
    expect(coverage.officialConceptAudit).toMatchObject({ status: 'official-full-species', speciesAudited: 11201,
      directConceptMatches: 11121, reviewedAnnualChanges: 74, unresolvedSourceConcepts: 6, previousSortAnchorMatches: 11121 });
    expect(coverage.currentSpeciesGaps.map((row: any) => row.code).sort()).toEqual(unresolved.map(row => row.targetCode).sort());
  });
});
