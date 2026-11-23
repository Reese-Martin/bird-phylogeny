import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import Papa from 'papaparse';
import { buildOfficialCrosswalk, type CurrentTaxon, type OfficialTaxonomy, type SourceTaxon, type CrosswalkOverride } from '../../scripts/taxonomy-crosswalk';

describe('complete pinned official taxonomy', () => {
  const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
  const csv = <T,>(path: string) => Papa.parse<T>(readFileSync(path, 'utf8'), { header: true, skipEmptyLines: true }).data;
  const api: CurrentTaxon[] = read('data/raw/ebird2026.json');
  const normalized: OfficialTaxonomy = read('data/raw/clements2026-integrated.json');
  const mappings = buildOfficialCrosswalk(api, csv<SourceTaxon>('data/raw/ott2025.csv'), normalized, csv<CrosswalkOverride>('data/crosswalk-overrides.csv'));

  it('audits all 11,201 official species, not only observed birds', () => {
    expect(mappings.size).toBe(11201);
    for (const mapping of mappings.values()) expect(mapping.targetConceptId).toBe(mapping.officialRow.conceptId);
    expect([...mappings.values()].filter(mapping => mapping.method === 'official-concept-id')).toHaveLength(11121);
  });

  it('resolves all six reported gaps to their unchanged official source concepts', () => {
    for (const code of ['brnowl', 'bulori', 'carcro1', 'purswa6', 'rudduc', 'yebmag']) {
      const mapping = mappings.get(code)!;
      expect(mapping.status).toBe('exact');
      expect(mapping.sourceRecords).toHaveLength(1);
      expect(mapping.sourceRecords[0].TAXON_CONCEPT_ID).toBe(mapping.targetConceptId);
      expect(mapping.mappingNote).not.toContain('unresolved');
    }
  });

  it('handles revised official containment beyond the personal life list', () => {
    for (const code of ['cartap1', 'cicada1', 'runlar1', 'bostib1', 'chefan1', 'citfan1']) {
      const mapping = mappings.get(code)!;
      expect(mapping.status).toBe('broader');
      expect(mapping.sourceRecords).toHaveLength(1);
      expect(mapping.sourceRecords[0].TAXON_CONCEPT_ID).not.toBe(mapping.targetConceptId);
    }
    expect(mappings.get('y00960')!.sourceRecords.map(source => source.SCI_NAME).sort()).toEqual(['Apus affinis', 'Apus nipalensis']);
  });

  it('keeps newly ratified and genuinely overlapping source concepts honest', () => {
    const unresolved = [...mappings.entries()].filter(([, mapping]) => mapping.status === 'unresolved');
    expect(unresolved.map(([code]) => code).sort()).toEqual(['sddtin1', 'hoojeb1', 'papcus1', 'plalar1', 'sttbab1', 'blcwar1'].sort());
    for (const [, mapping] of unresolved) {
      expect(mapping.sourceRecords).toEqual([]);
      expect(mapping.officialEvidenceRows).toContain(mapping.officialRow.sourceRow);
      expect(mapping.mappingNote.length).toBeGreaterThan(90);
    }
    expect(mappings.get('sttbab1')!.candidateSourceRecords.map(source => source.SCI_NAME)).toEqual(['Mixornis gularis', 'Mixornis bornensis']);
    expect(mappings.get('papcus1')!.candidateSourceRecords.map(source => source.SCI_NAME)).toEqual(['Edolisoma incertum', 'Edolisoma tenuirostre']);
  });
});
