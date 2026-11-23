import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Taxon } from '../src/types';
import { parseCsv, TaxonResolver } from '../src/import/aggregate';
import { parseBackup, serializeBackup } from '../src/storage/collection';
import Papa from 'papaparse';

const taxa: Taxon[] = JSON.parse(readFileSync(new URL('../public/data/taxa.json', import.meta.url), 'utf8'));
const manifest = JSON.parse(readFileSync(new URL('../public/data/manifest.json', import.meta.url), 'utf8'));
const options = { datasetVersion: manifest.datasetVersion, taxonomyVersion: manifest.taxonomyVersion, importedAt: '2026-11-17T12:00:00.000Z' };

describe('prepared eBird 2026 taxonomy integration', () => {
  it('distinguishes current named Willets from the older unresolved Willet', () => {
    const resolver = new TaxonResolver(taxa);
    const saltmarsh = resolver.resolve('Tringa semipalmata', 'Saltmarsh Willet');
    const prairie = resolver.resolve('Tringa inornata', 'Prairie Willet');
    expect(saltmarsh).toMatchObject({ kind: 'species', taxon: { code: 'willet2', mappingStatus: 'broader' } });
    expect(prairie).toMatchObject({ kind: 'species', taxon: { code: 'willet3', mappingStatus: 'broader' } });
    if (saltmarsh.kind === 'species' && prairie.kind === 'species') expect(saltmarsh.taxon.treeTip).toBe(prairie.taxon.treeTip);
    expect(resolver.resolve('Tringa semipalmata', 'Willet').kind).toBe('unresolved');
    expect(resolver.resolve('Tringa semipalmata', '').kind).toBe('unresolved');
  });

  it('imports the synthetic review CSV with all rows and date/count uncertainty accounted for', () => {
    const source = readFileSync(new URL('./fixtures/synthetic-ebird.csv', import.meta.url), 'utf8');
    const result = parseCsv(source, taxa, options);
    expect(result.report).toMatchObject({ totalRecords: 14, acceptedRecords: 9, excludedRecords: 3, unresolvedRecords: 2, duplicateRecords: 1, invalidDateRecords: 1, missingDateRecords: 1, historicalDateRecords: 1, mappedSpecies: 4, unmappedSpecies: 2, sourceTipCount: 3 });
    expect(result.species.filter(item => !item.code.startsWith('unresolved:'))).toHaveLength(4);
    expect(result.species.find(item => item.code === 'amecro')).toMatchObject({ checklistCount: 4, recordCount: 6, earliestDate: '2023-01-01', missingDateCount: 2, historicalDateCount: 1 });
    expect(result.species.find(item => item.code === 'willet2')).toMatchObject({ checklistCount: 1, recordCount: 1 });
    expect(result.species.find(item => item.code === 'willet3')).toMatchObject({ checklistCount: 1, recordCount: 1 });
    const serialized = serializeBackup(result);
    expect(serialized).not.toMatch(/S-SYNTHETIC|Invented place|Quoted details|Latitude|Longitude/);
    expect(parseBackup(serialized, { ...options, taxa })).toEqual(result);
  });

  it('imports all 56 sample species with two Willets sharing broader source coverage', () => {
    const source = readFileSync(new URL('../public/demo/MyEBirdData-sample.csv', import.meta.url), 'utf8');
    const result = parseCsv(source, taxa, options);
    expect(result.report).toMatchObject({ totalRecords: 56, acceptedRecords: 56, excludedRecords: 0, unresolvedRecords: 0, duplicateRecords: 0, mappedSpecies: 56, unmappedSpecies: 0, sourceTipCount: 55, artworkGaps: 0 });
    expect(result.species).toHaveLength(56);
    expect(result.species.every(item => item.checklistCount === 1)).toBe(true);
    expect(parseCsv(source, taxa, options)).toEqual(result);
    expect(parseBackup(serializeBackup(result), { ...options, taxa })).toEqual(result);
  });

  it('recognizes every prepared current species in a global synthetic import', () => {
    const current = taxa.filter(taxon => taxon.category === 'species');
    const source = Papa.unparse(current.map((row: any, index: number) => ({
      'Submission ID': `S-GLOBAL-SYNTHETIC-${index}`,
      'Common Name': row.commonName, 'Scientific Name': row.scientificName,
      Count: 1, Date: '2026-11-01', Country: 'US',
    })));
    const result = parseCsv(source, taxa, options);
    const coverage = JSON.parse(readFileSync(new URL('../public/data/coverage.json', import.meta.url), 'utf8'));
    expect(result.report).toMatchObject({ totalRecords: 11201, acceptedRecords: 11201, unresolvedRecords: 0,
      excludedRecords: 0, duplicateRecords: 0, mappedSpecies: 11195, unmappedSpecies: 6,
      sourceTipCount: coverage.representedSourceTips, countryUnassignedRecords: 0 });
    expect(result.species.map(observation => observation.code).sort()).toEqual(current.map((row: any) => row.code).sort());
    expect(result.countries).toHaveLength(1);
    expect(result.countries![0]).toMatchObject({ code: 'US', species: result.species });
    // Known species with unavailable source placements remain identified birds,
    // distinct from an unknown or ambiguous imported name.
    expect(result.species.some(observation => observation.code.startsWith('unresolved:'))).toBe(false);
    expect(parseBackup(serializeBackup(result), { ...options, taxa })).toEqual(result);
  }, 30000);

  it('refreshes the six corrected species in an older saved collection without losing observations or countries', () => {
    const corrected = new Set(['brnowl', 'bulori', 'carcro1', 'purswa6', 'rudduc', 'yebmag']);
    const previousTaxa: Taxon[] = taxa.map(taxon => corrected.has(taxon.code)
      ? { ...taxon, treeTip: undefined, treeTips: undefined, mappingStatus: 'unresolved', mappingNote: 'Previous dataset had no verified source concept.' }
      : taxon);
    const source = Papa.unparse(taxa.filter(taxon => corrected.has(taxon.code)).map((taxon, index) => ({
      'Submission ID': `S-MIGRATION-SYNTHETIC-${index}`,
      'Common Name': taxon.commonName, 'Scientific Name': taxon.scientificName,
      Count: 1, Date: `2026-11-0${index + 1}`, Country: index % 2 ? 'CA' : 'US',
    })));
    const previous = parseCsv(source, previousTaxa, { ...options, datasetVersion: 'before-official-concept-audit' });
    expect(previous.report).toMatchObject({ acceptedRecords: 6, unresolvedRecords: 0, mappedSpecies: 0, unmappedSpecies: 6, sourceTipCount: 0 });
    const restored = parseBackup(serializeBackup(previous), { ...options, taxa });
    expect(restored.datasetVersion).toBe(options.datasetVersion);
    expect(restored.species).toEqual(previous.species);
    expect(restored.countries).toEqual(previous.countries);
    expect(restored.countries).toHaveLength(2);
    expect(restored.report).toMatchObject({ acceptedRecords: 6, unresolvedRecords: 0, mappedSpecies: 6, unmappedSpecies: 0, sourceTipCount: 6 });
  });
});
