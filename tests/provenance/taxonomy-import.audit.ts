import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import Papa from 'papaparse';
import type { Taxon } from '../../src/types';
import { parseCsv } from '../../src/import/aggregate';
import { parseBackup, serializeBackup } from '../../src/storage/collection';

const taxa: Taxon[] = JSON.parse(readFileSync('public/data/taxa.json', 'utf8'));
const manifest = JSON.parse(readFileSync('public/data/manifest.json', 'utf8'));
const options = { datasetVersion: manifest.datasetVersion, taxonomyVersion: manifest.taxonomyVersion, importedAt: '2026-11-17T12:00:00.000Z' };

describe('independent official taxonomy import', () => {
  it('recognizes every official current species in a global synthetic import', () => {
    const official = JSON.parse(readFileSync('data/raw/clements2026-integrated.json', 'utf8'));
    const current = official.rows.filter((row: any) => row.category === 'species');
    const source = Papa.unparse(current.map((row: any, index: number) => ({
      'Submission ID': `S-GLOBAL-SYNTHETIC-${index}`,
      'Common Name': row.commonName, 'Scientific Name': row.scientificName,
      Count: 1, Date: '2026-11-01', Country: 'US',
    })));
    const result = parseCsv(source, taxa, options);
    const coverage = JSON.parse(readFileSync('public/data/coverage.json', 'utf8'));
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
});
