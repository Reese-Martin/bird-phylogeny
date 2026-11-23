import { describe, expect, it, vi } from 'vitest';
import Papa from 'papaparse';
import { canonicalHeader, CollectionAggregator, parseCsv, parseObservationDate, TaxonResolver, validateHeaders, validateParsedChunk, type CsvRow } from '../src/import/aggregate';
import { startImport } from '../src/import/client';
import { countryForRow, resolveCountryNameOrCode } from '../src/import/countries';
import { csv, testTaxa, testVersions } from './fixtures/taxa';

describe('eBird CSV import and taxonomy reconciliation', () => {
  it('accounts for every input row, rolls up groups, and deduplicates transient checklist IDs', () => {
    const result = parseCsv(csv([
      'S1,American Crow,Corvus brachyrhynchos,2,2024-01-02',
      'S1,American Crow,Corvus brachyrhynchos,2,2024-01-02',
      'S2,American Crow,Corvus brachyrhynchos,X,2023-12-01',
      'S3,Mallard,Anas platyrhynchos,1,2024-02-01',
      'S3,Mallard (Northern),Anas platyrhynchos platyrhynchos,1,2024-02-01',
      'S4,Unknown Bird,Testus unknown,1,2024-03-01',
      'S5,American Crow,Corvus brachyrhynchos,0,2024-04-01',
      'S6,Mallard x Northern Pintail (hybrid),Anas platyrhynchos x acuta,1,2024-05-01',
    ]), testTaxa, testVersions);
    expect(result.report).toMatchObject({ totalRecords: 8, acceptedRecords: 5, excludedRecords: 2, unresolvedRecords: 1, duplicateRecords: 2, mappedSpecies: 2, unmappedSpecies: 1, sourceTipCount: 2 });
    expect(result.species.find(item => item.code === 'amecro')).toMatchObject({ earliestDate: '2023-12-01', checklistCount: 2, recordCount: 3 });
    expect(result.species.find(item => item.code === 'mallar')).toMatchObject({ checklistCount: 1, recordCount: 2 });
    expect(result.species.some(item => item.code.startsWith('unresolved:'))).toBe(true);
    expect(result.report.totalRecords).toBe(result.report.acceptedRecords + result.report.excludedRecords + result.report.unresolvedRecords);
    expect(JSON.stringify(result)).not.toContain('S1');
  });

  it('handles BOM, quoted commas and multiline cells without retaining private columns', () => {
    const source = '\uFEFF Submission ID , Common Name , Scientific Name , Count , Date ,Location,Observation Details\r\n' +
      'S1,American Crow,Corvus_brachyrhynchos,X,2024-03-04,"A private place, exact location","Line one\nLine two"\r\n';
    const result = parseCsv(source, testTaxa, testVersions);
    expect(result.report.totalRecords).toBe(1);
    expect(result.species[0].code).toBe('amecro');
    expect(JSON.stringify(result)).not.toMatch(/private place|Line one|Line two/);
  });

  it('preserves date uncertainty and counts X as presence while excluding zeros and invalid counts', () => {
    const result = parseCsv(csv([
      'S1,American Crow,Corvus brachyrhynchos,X,1900-01-01',
      'S2,American Crow,Corvus brachyrhynchos,1,2024-02-30',
      'S3,American Crow,Corvus brachyrhynchos,1,',
      'S4,American Crow,Corvus brachyrhynchos,1,2/29/2024',
      'S5,American Crow,Corvus brachyrhynchos,0,2024-01-01',
      'S6,American Crow,Corvus brachyrhynchos,-1,2024-01-01',
      ',American Crow,Corvus brachyrhynchos,1,2023-01-01',
    ]), testTaxa, testVersions);
    expect(result.report).toMatchObject({ acceptedRecords: 5, excludedRecords: 2, invalidDateRecords: 1, historicalDateRecords: 1, missingDateRecords: 1 });
    expect(result.species[0]).toMatchObject({ checklistCount: 4, recordCount: 5, historicalDateCount: 1, missingDateCount: 2, earliestDate: '2023-01-01' });
    expect(result.report.issues.some(issue => issue.reason.includes('Missing submission ID'))).toBe(true);
  });

  it('is deterministic when replacing a collection with the same full export', () => {
    const source = csv(['S1,American Crow,Corvus brachyrhynchos,1,2024-01-01', 'S1,American Crow,Corvus brachyrhynchos,X,2024-01-01']);
    expect(parseCsv(source, testTaxa, testVersions)).toEqual(parseCsv(source, testTaxa, testVersions));
  });

  it('rejects invalid headers and malformed CSV atomically', () => {
    expect(() => parseCsv('Common Name,Count\nAmerican Crow,1', testTaxa, testVersions)).toThrow('Missing required CSV columns');
    expect(() => parseCsv(csv(['S1,"Unclosed,Corvus brachyrhynchos,1,2024-01-01']), testTaxa, testVersions)).toThrow('could not be read safely');
    expect(() => validateHeaders(['Submission ID', 'Date', 'Count', 'Common Name', 'Count'])).toThrow('duplicate');
    expect(canonicalHeader('\uFEFF SCIENTIFIC_Name ')).toBe('scientific name');
  });

  it('accepts eBird rows omitting empty optional trailing cells while rejecting absent required fields', () => {
    const source = 'Submission ID,Common Name,Scientific Name,Count,Date,Breeding Code,Observation Details,Checklist Comments,ML Catalog Numbers\n' +
      'S1,American Crow,Corvus brachyrhynchos,X,2024-01-01\n' +
      'S2,American Crow,Corvus brachyrhynchos,1,2024-02-01,,,\n';
    const result = parseCsv(source, testTaxa, testVersions);
    expect(result.report).toMatchObject({ totalRecords: 2, acceptedRecords: 2, excludedRecords: 0 });
    expect(result.species[0].checklistCount).toBe(2);
    expect(() => parseCsv('Submission ID,Common Name,Scientific Name,Count,Date,Comments\nS1,American Crow,Corvus brachyrhynchos', testTaxa, testVersions)).toThrow('could not be read safely');
    expect(() => parseCsv('Submission ID,Common Name,Scientific Name,Count,Date\nS1,American Crow,Corvus brachyrhynchos,1,2024-01-01,extra', testTaxa, testVersions)).toThrow('could not be read safely');
  });

  it('accepts the standard 23-column export with only the first 19 populated columns', () => {
    const headers = ['Submission ID', 'Common Name', 'Scientific Name', 'Taxonomic Order', 'Count', 'State/Province', 'County', 'Location ID', 'Location', 'Latitude', 'Longitude', 'Date', 'Time', 'Protocol', 'Duration (Min)', 'All Obs Reported', 'Distance Traveled (km)', 'Area Covered (ha)', 'Number of Observers', 'Breeding Code', 'Observation Details', 'Checklist Comments', 'ML Catalog Numbers'];
    const values = ['S1', 'American Crow', 'Corvus brachyrhynchos', '1', 'X', 'SYNTHETIC', 'SYNTHETIC', 'SYNTHETIC', 'SYNTHETIC', '0', '0', '2024-01-01', '12:00', 'Incidental', '0', '1', '0', '0', '1'];
    const result = parseCsv(headers.join(',') + '\n' + values.join(','), testTaxa, testVersions);
    expect(result.report).toMatchObject({ totalRecords: 1, acceptedRecords: 1, excludedRecords: 0 });
    expect(result.species[0]).toMatchObject({ code: 'amecro', earliestDate: '2024-01-01', checklistCount: 1 });
    expect(JSON.stringify(result)).not.toContain('SYNTHETIC');
  });

  it('validates omitted optional cells with Papa global row indices across multiple chunks', () => {
    const source = 'Submission ID,Common Name,Scientific Name,Count,Date,Comments\n' + Array.from({ length: 50 }, (_, i) => `S${i},American Crow,Corvus brachyrhynchos,1,2024-01-01`).join('\n');
    const aggregator = new CollectionAggregator(testTaxa, testVersions);
    let chunks = 0;
    const config: Papa.ParseConfig<CsvRow> & { chunkSize: number; chunk: (result: Papa.ParseResult<CsvRow>) => void } = {
      header: true, skipEmptyLines: 'greedy', transformHeader: canonicalHeader, chunkSize: 128,
      chunk: result => {
        validateParsedChunk(result, aggregator.report.totalRecords);
        for (const row of result.data) aggregator.add(row);
        chunks++;
      },
    };
    Papa.parse(source, config);
    expect(chunks).toBeGreaterThan(10);
    expect(aggregator.finish()).toEqual(parseCsv(source, testTaxa, testVersions));
  });

  it('streams many records through the same bounded aggregation model', () => {
    const source = csv(Array.from({ length: 25000 }, (_, i) => `S${i % 1000},American Crow,Corvus brachyrhynchos,X,2024-01-01`));
    const result = parseCsv(source, testTaxa, testVersions);
    expect(result.report.totalRecords).toBe(25000);
    expect(result.species[0].checklistCount).toBe(1000);
    expect(result.report.duplicateRecords).toBe(24000);
  });
});

describe('taxon concept regression cases', () => {
  const resolver = new TaxonResolver(testTaxa);
  it('resolves an exact species, documented rename and parent group', () => {
    expect(resolver.resolve('Corvus brachyrhynchos', 'American Crow')).toMatchObject({ kind: 'species', taxon: { code: 'amecro' } });
    expect(resolver.resolve('Perisoreus canadensis', 'Gray Jay')).toMatchObject({ kind: 'species', taxon: { code: 'canjay', mappingStatus: 'renamed' } });
    expect(resolver.resolve('Anas platyrhynchos platyrhynchos', 'Mallard (Northern)')).toMatchObject({ kind: 'species', taxon: { code: 'mallar' } });
  });
  it('retains both current Willets at a broader source tip without resolving an older Willet by its persisted scientific name', () => {
    expect(resolver.resolve('Tringa semipalmata', 'Saltmarsh Willet')).toMatchObject({ kind: 'species', taxon: { code: 'willet2', treeTip: 4, mappingStatus: 'broader' } });
    expect(resolver.resolve('Tringa inornata', 'Prairie Willet')).toMatchObject({ kind: 'species', taxon: { code: 'willet3', treeTip: 4, mappingStatus: 'broader' } });
    expect(resolver.resolve('Tringa semipalmata', 'Willet')).toMatchObject({ kind: 'unresolved' });
    expect(resolver.resolve('Tringa semipalmata', '')).toMatchObject({ kind: 'unresolved' });
    const result = parseCsv(csv(['S1,Saltmarsh Willet,Tringa semipalmata,1,2026-11-01', 'S2,Prairie Willet,Tringa inornata,1,2026-11-01']), testTaxa, testVersions);
    expect(result.report).toMatchObject({ mappedSpecies: 2, sourceTipCount: 1 });
  });
  it('handles a documented lump, hybrids, unidentified and domestic forms, slash and unmatched names', () => {
    expect(resolver.resolve('Testus former', 'Former Finch')).toMatchObject({ kind: 'species', taxon: { code: 'merged-finch', mappingStatus: 'narrower' } });
    expect(resolver.resolve('Anas platyrhynchos x acuta', 'Mallard x Northern Pintail (hybrid)')).toMatchObject({ kind: 'excluded' });
    expect(resolver.resolve('Anatidae sp.', 'duck sp.')).toMatchObject({ kind: 'excluded' });
    expect(resolver.resolve('Anas platyrhynchos (Domestic type)', 'Mallard (Domestic type)')).toMatchObject({ kind: 'excluded' });
    expect(resolver.resolve('Tringa semipalmata/inornata', 'Saltmarsh/Prairie Willet')).toMatchObject({ kind: 'excluded' });
    expect(resolver.resolve('Testus unknown', 'Unknown Bird')).toMatchObject({ kind: 'unresolved' });
    expect(resolver.resolve('Corvus brachyrhynchos', 'Mallard')).toMatchObject({ kind: 'unresolved' });
  });
  it('counts every source tip covered by one current lumped species', () => {
    const taxa = testTaxa.map(taxon => taxon.code === 'merged-finch' ? { ...taxon, treeTips: [5, 6] } : taxon);
    const result = parseCsv(csv(['S1,Former Finch,Testus former,1,2024-01-01']), taxa, testVersions);
    expect(result.report).toMatchObject({ mappedSpecies: 1, sourceTipCount: 2 });
  });
});

describe('date parsing', () => {
  it('does not let JavaScript roll impossible dates into another month', () => {
    expect(parseObservationDate('2023-02-29').kind).toBe('invalid');
    expect(parseObservationDate('2024-02-29')).toEqual({ kind: 'valid', date: '2024-02-29' });
    expect(parseObservationDate('2024-13-01').kind).toBe('invalid');
    expect(parseObservationDate('yesterday').kind).toBe('invalid');
    expect(parseObservationDate('1900-01-01')).toEqual({ kind: 'historical', date: null });
  });
});

describe('country aggregates without precise locations', () => {
  const countryCsv = (rows: string[]) => 'Submission ID,Common Name,Scientific Name,Count,Date,State/Province,Country Code,Country\n' + rows.join('\n');
  it('preserves independent species dates and checklist deduplication within each country', () => {
    const result = parseCsv(countryCsv([
      'S1,American Crow,Corvus brachyrhynchos,1,2022-01-01,US-TN,,',
      'S1,American Crow,Corvus brachyrhynchos,X,2024-01-01,US-TN,,',
      'S2,American Crow,Corvus brachyrhynchos,1,2023-01-01,CA-ON,,',
      'S3,Mallard (Northern),Anas platyrhynchos platyrhynchos,X,1900-01-01,US-TN,,',
      'S3,Mallard,Anas platyrhynchos,1,2024-02-01,US-TN,,',
      'S4,American Crow,Corvus brachyrhynchos,1,2025-01-01,CA-BC,,',
    ]), testTaxa, testVersions);
    expect(result.report).toMatchObject({ totalRecords: 6, acceptedRecords: 6, duplicateRecords: 2, countryUnassignedRecords: 0 });
    expect(result.countries?.map(country => country.code)).toEqual(['CA', 'US']);
    expect(result.countries?.find(country => country.code === 'CA')?.species).toMatchObject([{ code: 'amecro', earliestDate: '2023-01-01', checklistCount: 2, recordCount: 2 }]);
    const us = result.countries?.find(country => country.code === 'US');
    expect(us?.species.find(species => species.code === 'amecro')).toMatchObject({ earliestDate: '2022-01-01', checklistCount: 1, recordCount: 2 });
    expect(us?.species.find(species => species.code === 'mallar')).toMatchObject({ earliestDate: '2024-02-01', checklistCount: 1, recordCount: 2, historicalDateCount: 1 });
    expect(result.species.find(species => species.code === 'amecro')?.checklistCount).toBe(3);
    expect(JSON.stringify(result)).not.toMatch(/US-TN|CA-ON|CA-BC|S1|S2|S3|S4/);
  });

  it('uses explicit codes and names, and keeps conflicting or unknown geography only in the global collection', () => {
    const result = parseCsv(countryCsv([
      'S1,American Crow,Corvus brachyrhynchos,1,2024-01-01,US-TN,US,United States',
      'S2,American Crow,Corvus brachyrhynchos,X,2024-01-01,,FR,France',
      'S3,American Crow,Corvus brachyrhynchos,1,2024-01-01,,ZZ,',
      'S4,American Crow,Corvus brachyrhynchos,1,2024-01-01,CA-ON,US,',
      'S5,American Crow,Corvus brachyrhynchos,1,2024-01-01,,,',
      'S6,American Crow,Corvus brachyrhynchos,0,2024-01-01,US-TN,,',
    ]), testTaxa, testVersions);
    expect(result.report).toMatchObject({ acceptedRecords: 5, excludedRecords: 1, countryUnassignedRecords: 3 });
    expect(result.countries?.map(country => country.code)).toEqual(['FR', 'US']);
    expect(result.species[0].checklistCount).toBe(5);
    expect(countryForRow({ 'country code': 'US', country: 'Canada' })).toBeUndefined();
    expect(countryForRow({ latitude: '0', longitude: '0', location: 'Paris' })).toBeUndefined();
    expect(countryForRow({ 'state/province': 'us-ca' })?.code).toBe('US');
    expect(resolveCountryNameOrCode('United States of America')?.code).toBe('US');
    expect(resolveCountryNameOrCode('UK')?.code).toBe('GB');
    expect(resolveCountryNameOrCode('Atlantis')).toBeUndefined();
  });

  it('preserves within-country uncertain dates and unresolved taxa without losing global records', () => {
    const result = parseCsv(countryCsv([
      'S1,American Crow,Corvus brachyrhynchos,1,2024-02-30,US-TN,,',
      'S2,American Crow,Corvus brachyrhynchos,X,,US-TN,,',
      'S3,American Crow,Corvus brachyrhynchos,1,1900-01-01,CA-ON,,',
      'S4,American Crow,Corvus brachyrhynchos,1,2025-01-01,CA-ON,,',
      'S5,Unknown Bird,Testus unknown,1,2024-01-01,MX-JAL,,',
    ]), testTaxa, testVersions);
    expect(result.countries?.find(country => country.code === 'US')?.species[0]).toMatchObject({ earliestDate: null, missingDateCount: 2 });
    expect(result.countries?.find(country => country.code === 'CA')?.species[0]).toMatchObject({ earliestDate: '2025-01-01', historicalDateCount: 1 });
    expect(result.countries?.find(country => country.code === 'MX')?.species[0].code).toMatch(/^unresolved:/);
    expect(result.report.countryUnassignedRecords).toBe(0);
  });

  it('accepts missing optional trailing country fields, including older exports with no country column', () => {
    const result = parseCsv('Submission ID,Common Name,Scientific Name,Count,Date,Country_Code\nS1,American Crow,Corvus brachyrhynchos,1,2024-01-01', testTaxa, testVersions);
    expect(result.countries).toEqual([]);
    expect(result.report.countryUnassignedRecords).toBe(1);
    expect(canonicalHeader('CountryCode')).toBe('country code');
    expect(canonicalHeader('State Province')).toBe('state/province');
    expect(canonicalHeader('Country Name')).toBe('country');
  });
});

describe('worker lifecycle', () => {
  it('cancels without publishing a partial collection', async () => {
    const terminate = vi.fn();
    class StubWorker { onmessage = null; onerror = null; postMessage = vi.fn(); terminate = terminate; }
    vi.stubGlobal('Worker', StubWorker);
    try {
      const task = startImport({ size: 200 } as File, testTaxa, { ...testVersions, onProgress: vi.fn() });
      task.cancel();
      await expect(task.promise).rejects.toMatchObject({ name: 'AbortError' });
      expect(terminate).toHaveBeenCalledOnce();
      task.cancel();
      expect(terminate).toHaveBeenCalledOnce();
    } finally { vi.unstubAllGlobals(); }
  });
});
