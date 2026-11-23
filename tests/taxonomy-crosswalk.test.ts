import { describe, expect, it } from 'vitest';
import { buildOfficialCrosswalk, type CurrentTaxon, type OfficialTaxonRow, type OfficialTaxonomy, type SourceTaxon, type CrosswalkOverride } from '../scripts/taxonomy-crosswalk';

const source = (name: string, id: string, sort: number): SourceTaxon => ({ SCI_NAME: name, PRIMARY_COM_NAME: name, TAXON_CONCEPT_ID: `avibase-${id}`, TAXON_ORDER: String(sort), SPECIES_CODE: name });
const current = (code: string, name = code): CurrentTaxon => ({ speciesCode: code, sciName: name, comName: name, category: 'species' });
const row = (code: string, id: string, sort: number | null, extra: Partial<OfficialTaxonRow> = {}): OfficialTaxonRow => ({ sourceRow: 2, code, scientificName: code, commonName: code, category: 'species', conceptId: `avibase-${id}`, sort2025: sort, ...extra });
const official = (rows: OfficialTaxonRow[]): OfficialTaxonomy => ({ version: 1, taxonomyVersion: '2026', sheet: 'Test official sheet', rows });
const change = (target: string, names: string, status: string): CrosswalkOverride => ({ targetScientificName: target, sourceScientificNames: names, status, evidence: 'Reviewed official annual change', reviewStatus: 'reviewed' });

describe('official concept crosswalk guards', () => {
  it('uses persistent concept identity across name changes without artwork metadata', () => {
    const mappings = buildOfficialCrosswalk([current('New name')], [source('Old name', '12345678', 10)], official([row('New name', '12345678', 10)]), []);
    expect(mappings.get('New name')).toMatchObject({ status: 'renamed', method: 'official-concept-id', targetConceptId: 'avibase-12345678', aliases: ['Old name'] });
    expect(mappings.get('New name')!.sourceRecords[0].SCI_NAME).toBe('Old name');
  });

  it('never treats the same name or an old sort position as exact concept identity', () => {
    const mappings = buildOfficialCrosswalk([current('Bird')], [source('Bird', '12345678', 10)], official([row('Bird', '87654321', 10)]), []);
    expect(mappings.get('Bird')).toMatchObject({ status: 'unresolved', sourceRecords: [], targetConceptId: 'avibase-87654321' });
    expect(mappings.get('Bird')!.previousSourceConceptIds).toEqual(['avibase-12345678']);
  });

  it('requires complete agreement between workbook/API species identities', () => {
    expect(() => buildOfficialCrosswalk([current('Bird')], [source('Bird', '12345678', 10)], official([row('Bird', '12345678', 10, { scientificName: 'Different bird' })]), [])).toThrow('scientific-name disagreement');
    expect(() => buildOfficialCrosswalk([current('Bird')], [source('Bird', '12345678', 10)], official([row('Bird', '12345678', 11)]), [])).toThrow('Previous-sort alignment changed');
  });

  it('does not permit an exact override to replace a different official concept', () => {
    expect(() => buildOfficialCrosswalk([current('Bird')], [source('Bird', '12345678', 10)], official([row('Bird', '87654321', 10)]), [change('Bird', 'Bird', 'exact')])).toThrow('Exact override changes a species concept');
  });

  it('validates source containment and retains all source tips for a reviewed lump', () => {
    const sourceRows = [source('Old one', '11111111', 10), source('Old two', '22222222', 20)];
    const rows = [row('Lump', '33333333', 10, { changes: 'lump', changeText: 'Lump Old one and Old two.' }), row('Old two group', '22222222', 20, { sourceRow: 3, category: 'group (monotypic)', parentSpeciesCode: 'Lump' })];
    const mapping = buildOfficialCrosswalk([current('Lump')], sourceRows, official(rows), [change('Lump', 'Old one|Old two', 'narrower')]).get('Lump')!;
    expect(mapping.sourceRecords.map(taxon => taxon.SCI_NAME)).toEqual(['Old one', 'Old two']);
    expect(mapping.status).toBe('narrower');
    expect(() => buildOfficialCrosswalk([current('Lump')], sourceRows, official(rows), [change('Lump', 'Old one', 'broader')])).toThrow('omits prior source membership');
  });

  it('allows a newly described daughter only when official split text names its source', () => {
    const target = current('Daughter');
    const treeSpecies = [source('Parent', '11111111', 10)];
    expect(buildOfficialCrosswalk([target], treeSpecies, official([row('Daughter', '22222222', null, { changes: 'split', changeText: 'Split Parent into Daughter and Other.' })]), [change('Daughter', 'Parent', 'broader')]).get('Daughter')!.status).toBe('broader');
    expect(() => buildOfficialCrosswalk([target], treeSpecies, official([row('Daughter', '22222222', null, { changes: 'split' })]), [change('Daughter', 'Parent', 'broader')])).toThrow('lacks official annual-change evidence');
  });
});

