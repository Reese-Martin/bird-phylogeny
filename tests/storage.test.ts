import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { parseCsv } from '../src/import/aggregate';
import { clearCollection, loadCollection, parseBackup, saveCollection, serializeBackup } from '../src/storage/collection';
import { csv, testTaxa, testVersions } from './fixtures/taxa';

const collection = () => parseCsv(csv([
  'S1,American Crow,Corvus brachyrhynchos,1,2024-01-01',
  'S2,Mallard,Anas platyrhynchos,X,1900-01-01',
]), testTaxa, testVersions);

describe('versioned normalized backups', () => {
  it('roundtrips exactly with no raw observation details or submission IDs', () => {
    const result = collection();
    const json = serializeBackup(result);
    expect(parseBackup(json, { ...testVersions, taxa: testTaxa })).toEqual(result);
    expect(json).not.toMatch(/S1|S2|latitude|longitude|location|comments/i);
  });
  it('rejects invalid JSON, schema versions, duplicate species and inconsistent totals', () => {
    expect(() => parseBackup('{')).toThrow('valid JSON');
    const result = collection();
    expect(() => parseBackup(JSON.stringify({ ...result, schemaVersion: 2 }))).toThrow('Unsupported backup version');
    expect(() => parseBackup(JSON.stringify({ ...result, species: [...result.species, result.species[0]] }))).toThrow('unique');
    expect(() => parseBackup(JSON.stringify({ ...result, report: { ...result.report, totalRecords: 900 } }))).toThrow('accounted for');
    expect(() => parseBackup(JSON.stringify({ ...result, species: [{ ...result.species[0], checklistCount: 999 }, result.species[1]] }))).toThrow('inconsistent');
  });
  it('rejects unexpected personal fields instead of saving or restoring raw data', () => {
    const result = collection();
    expect(() => parseBackup(JSON.stringify({ ...result, latitude: 38.5 }))).toThrow('unexpected fields');
    expect(() => parseBackup(JSON.stringify({ ...result, species: result.species.map(species => ({ ...species, checklistIds: ['S123'] })) }))).toThrow('unexpected fields');
  });
  it('requires fresh CSV for a changed taxonomy and remaps dataset-scoped nodes for a new source tree', () => {
    const json = serializeBackup(collection());
    expect(() => parseBackup(json, { taxonomyVersion: 'synthetic-2027' })).toThrow('Reimport the original CSV');
    expect(() => parseBackup(json, { datasetVersion: 'new-tree' })).toThrow('source tree has changed');
    const migrated = parseBackup(json, { datasetVersion: 'new-tree', taxonomyVersion: testVersions.taxonomyVersion, taxa: testTaxa.map(taxon => ({ ...taxon, treeTip: undefined })) });
    expect(migrated.datasetVersion).toBe('new-tree');
    expect(migrated.report).toMatchObject({ mappedSpecies: 0, unmappedSpecies: 2, sourceTipCount: 0 });
    expect(migrated.species).toEqual(collection().species);
  });
  it('preserves valid multi-tip coverage for lumped species', () => {
    const taxa = testTaxa.map(taxon => taxon.code === 'merged-finch' ? { ...taxon, treeTips: [5, 6] } : taxon);
    const result = parseCsv(csv(['S1,Former Finch,Testus former,1,2024-01-01']), taxa, testVersions);
    expect(parseBackup(serializeBackup(result)).report.sourceTipCount).toBe(2);
    expect(parseBackup(serializeBackup(result), { ...testVersions, datasetVersion: 'next-tree', taxa }).report.sourceTipCount).toBe(2);
  });
  it('refreshes artwork availability when the source tree version is unchanged', () => {
    const before = collection();
    expect(before.report.artworkGaps).toBe(1);
    const withArtwork = testTaxa.map(t => ({ ...t, sticker: `/stickers/384/${t.code}.webp` }));
    const restored = parseBackup(serializeBackup(before), { ...testVersions, taxa: withArtwork });
    expect(restored.report.artworkGaps).toBe(0);
    expect(restored.datasetVersion).toBe(before.datasetVersion);
    expect(restored.species).toEqual(before.species);
  });
  it('rejects placeholder/invalid precise dates and unsafe counts', () => {
    const result = collection();
    expect(() => parseBackup(JSON.stringify({ ...result, species: result.species.map(species => ({ ...species, earliestDate: '1900-01-01' })) }))).toThrow('valid ISO date');
    expect(() => parseBackup(JSON.stringify({ ...result, report: { ...result.report, duplicateRecords: -1 } }))).toThrow('nonnegative integer');
  });
});

describe('optional country aggregates in schema version 1', () => {
  const withCountries = () => parseCsv('Submission ID,Common Name,Scientific Name,Count,Date,State/Province\n' + [
    'S1,American Crow,Corvus brachyrhynchos,1,2024-01-01,US-TN',
    'S2,American Crow,Corvus brachyrhynchos,X,2025-01-01,CA-ON',
    'S3,American Crow,Corvus brachyrhynchos,1,2025-02-01,',
  ].join('\n'), testTaxa, testVersions);

  it('roundtrips country aggregates while preserving legacy backups with no geography', () => {
    const current = withCountries();
    expect(parseBackup(serializeBackup(current))).toEqual(current);
    const legacy = collection();
    delete legacy.countries;
    delete legacy.report.countryUnassignedRecords;
    const restored = parseBackup(serializeBackup(legacy));
    expect(restored).toEqual(legacy);
    expect(restored.countries).toBeUndefined();
    expect(restored.report.countryUnassignedRecords).toBeUndefined();
  });

  it('rejects unknown countries, unsafe extra fields, name/code conflicts, and duplicate country codes', () => {
    const current = withCountries();
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...current.countries![0], code: 'ZZ', name: 'Unknown' }] }))).toThrow('unknown or inconsistent country');
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...current.countries![0], location: 'Private place' }] }))).toThrow('unexpected fields');
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...current.countries![0], name: 'United States' }] }))).toThrow('unknown or inconsistent country');
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [...current.countries!, current.countries![0]] }))).toThrow('country codes must be unique');
  });

  it('validates country counts, species membership, dates and unassigned records against the global collection', () => {
    const current = withCountries();
    const country = current.countries![0];
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...country, species: [{ ...country.species[0], code: 'not-global' }] }] }))).toThrow('exceed the global collection');
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...country, species: [{ ...country.species[0], recordCount: 99 }] }] }))).toThrow('exceed the global collection');
    expect(() => parseBackup(JSON.stringify({ ...current, countries: [{ ...country, species: [{ ...country.species[0], earliestDate: '2020-01-01' }] }] }))).toThrow('precedes');
    expect(() => parseBackup(JSON.stringify({ ...current, report: { ...current.report, countryUnassignedRecords: 0 } }))).toThrow('do not account');
    const unsafe = current.countries!.map(item => ({ ...item, species: item.species.map(species => ({ ...species, recordCount: 2 })) }));
    expect(() => parseBackup(JSON.stringify({ ...current, countries: unsafe }))).toThrow('combined country records exceed');
  });

  it('derives a missing additive unassigned count from valid country totals', () => {
    const current = withCountries();
    delete current.report.countryUnassignedRecords;
    const restored = parseBackup(JSON.stringify(current));
    expect(restored.report.countryUnassignedRecords).toBe(1);
    expect(restored.countries).toEqual(current.countries);
  });

  it('persists country aggregates and legacy no-country collections without migration loss', async () => {
    const current = withCountries();
    await saveCollection(current);
    expect(await loadCollection({ ...testVersions, taxa: testTaxa })).toEqual(current);
    const legacy = collection();
    delete legacy.countries;
    delete legacy.report.countryUnassignedRecords;
    await saveCollection(legacy);
    const restored = await loadCollection({ ...testVersions, taxa: testTaxa });
    expect(restored).toEqual(legacy);
    expect(restored?.countries).toBeUndefined();
    await clearCollection();
  });
});

describe('explicit on-device storage', () => {
  beforeEach(async () => { await clearCollection(); });
  it('saves, restores and clears a validated collection transactionally', async () => {
    expect(await loadCollection()).toBeNull();
    const result = collection();
    await saveCollection(result);
    expect(await loadCollection({ ...testVersions, taxa: testTaxa })).toEqual(result);
    await clearCollection();
    expect(await loadCollection()).toBeNull();
  });
  it('an invalid replacement preserves the previously saved collection', async () => {
    const result = collection();
    await saveCollection(result);
    await expect(saveCollection({ ...result, schemaVersion: 9 } as never)).rejects.toThrow('Unsupported');
    expect(await loadCollection()).toEqual(result);
  });
});
