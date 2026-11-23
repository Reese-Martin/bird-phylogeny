import Papa from 'papaparse';
import type { Collection, ImportIssue, ImportReport, SpeciesObservation, Taxon } from '../types';
import { countryForRow, type CountryIdentity } from './countries';

export interface ImportOptions {
  datasetVersion: string;
  taxonomyVersion: string;
  label?: string;
  importedAt?: string;
}

export interface ImportProgress {
  bytes: number;
  totalBytes: number;
  records: number;
}

export type CsvRow = Record<string, string | undefined>;

const normalizeName = (name: string) => name.normalize('NFKC').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
export const normalizeHeader = (header: string) => header.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[_\s]+/g, ' ');

const headerAliases: Record<string, string> = {
  'submission id': 'submission id', 'checklist id': 'submission id',
  'scientific name': 'scientific name', 'sci name': 'scientific name',
  'common name': 'common name', 'com name': 'common name',
  'date': 'date', 'observation date': 'date', 'count': 'count', 'number': 'count',
  'country code': 'country code', 'countrycode': 'country code', 'country': 'country', 'country name': 'country',
  'state/province': 'state/province', 'state province': 'state/province', 'state/province code': 'state/province',
};

export function canonicalHeader(header: string): string {
  const normalized = normalizeHeader(header);
  return headerAliases[normalized] ?? normalized;
}

export function validateHeaders(fields: string[] | undefined): void {
  if (!fields?.length) throw new Error('The CSV is empty. Choose the full MyEBirdData.csv export.');
  const normalized = fields.map(canonicalHeader);
  const missing = ['submission id', 'date', 'count'].filter(field => !normalized.includes(field));
  if (!normalized.includes('scientific name') && !normalized.includes('common name')) missing.push('scientific name or common name');
  if (missing.length) throw new Error(`Missing required CSV columns: ${missing.join(', ')}. Choose the full MyEBirdData.csv export.`);
  const seen = new Set<string>();
  for (const field of normalized) {
    if (['scientific name', 'common name', 'submission id', 'date', 'count', 'country code', 'country', 'state/province'].includes(field) && seen.has(field)) {
      throw new Error(`The CSV contains duplicate ${field} columns.`);
    }
    seen.add(field);
  }
}

/** eBird omits empty optional cells at the end of many rows in its own export. */
export function validateParsedChunk(result: Papa.ParseResult<CsvRow>, previousRecords = 0): void {
  const usedFields = ['submission id', 'scientific name', 'common name', 'count', 'date'];
  const declaredUsedFields = (result.meta.fields ?? []).filter(field => usedFields.includes(field));
  for (const error of result.errors) {
    if (error.type === 'FieldMismatch' && error.code === 'TooFewFields' && typeof error.row === 'number') {
      const row = result.data[error.row - previousRecords];
      if (row && declaredUsedFields.every(field => Object.hasOwn(row, field))) continue;
    }
    throw new Error(`The CSV could not be read safely: ${error.message}`);
  }
}

type Resolution = { kind: 'species'; taxon: Taxon; warning?: string } | { kind: 'excluded'; reason: string } | { kind: 'unresolved'; reason: string };

/** Names are matched against the pinned taxonomy; no fuzzy species inference is used. */
export class TaxonResolver {
  private byCode: Map<string, Taxon>;
  private byName = new Map<string, Taxon[]>();

  constructor(taxa: Taxon[]) {
    this.byCode = new Map(taxa.map(taxon => [taxon.code, taxon]));
    for (const taxon of taxa) {
      const aliases = (taxon as Taxon & { aliases?: string[] }).aliases ?? [];
      for (const value of new Set([taxon.scientificName, taxon.commonName, ...aliases].map(normalizeName))) {
        if (!value) continue;
        const existing = this.byName.get(value) ?? [];
        existing.push(taxon);
        this.byName.set(value, existing);
      }
    }
  }

  private parentSpecies(taxon: Taxon): Taxon | undefined {
    let current: Taxon | undefined = taxon;
    const visited = new Set<string>();
    while (current && !visited.has(current.code)) {
      visited.add(current.code);
      if (current.category.toLowerCase() === 'species') return current;
      current = current.parentCode ? this.byCode.get(current.parentCode) : undefined;
    }
    return undefined;
  }

  resolve(scientificName: string, commonName: string): Resolution {
    const sci = normalizeName(scientificName);
    const common = normalizeName(commonName);
    const scientific = this.byName.get(sci) ?? [];
    const named = this.byName.get(common) ?? [];
    let candidates = scientific.length ? scientific : named;
    if (scientific.length && named.length) {
      const shared = scientific.filter(taxon => named.some(other => {
        const parentCode = this.parentSpecies(taxon)?.code;
        return other.code === taxon.code || (parentCode !== undefined && parentCode === this.parentSpecies(other)?.code);
      }));
      if (!shared.length) return { kind: 'unresolved', reason: 'Scientific and common names resolve to different taxa in the pinned taxonomy.' };
      candidates = shared;
    }
    const unique = [...new Map(candidates.map(taxon => [taxon.code, taxon])).values()];
    if (!unique.length) {
      const reported = `${sci} ${common}`;
      if (/\bhybrid\b|\s[x×]\s/.test(reported)) return { kind: 'excluded', reason: 'Hybrid identification; excluded from species totals.' };
      if (/\bdomestic\b/.test(reported)) return { kind: 'excluded', reason: 'Domestic form; excluded from species totals.' };
      if (scientificName.includes('/') || commonName.includes('/')) return { kind: 'excluded', reason: 'Slash identification; excluded from species totals.' };
      if (/\bsp\.?\s*$|\bspp\.?\s*$|\bunidentified\b/.test(sci || common)) return { kind: 'excluded', reason: 'Unidentified bird; excluded from species totals.' };
      return { kind: 'unresolved', reason: 'No unambiguous name match in the pinned taxonomy. The reported taxon is retained for review.' };
    }
    if (unique.length > 1) {
      const parentCodes = unique.map(taxon => this.parentSpecies(taxon)?.code);
      if (!parentCodes[0] || !parentCodes.every(code => code === parentCodes[0])) return { kind: 'unresolved', reason: 'The reported name matches multiple taxon concepts.' };
    }
    const original = unique[0];
    const category = original.category.toLowerCase();
    if (['hybrid', 'slash', 'spuh', 'domestic', 'intergrade'].includes(category)) {
      return { kind: 'excluded', reason: `${category === 'spuh' ? 'Unidentified bird' : category[0].toUpperCase() + category.slice(1)} identification; excluded from species totals.` };
    }
    const taxon = this.parentSpecies(original);
    if (!taxon) return { kind: 'unresolved', reason: `Taxonomy category “${original.category}” has no documented parent species.` };
    const aliases = (taxon as Taxon & { aliases?: string[] }).aliases ?? [];
    const originalAliases = (original as Taxon & { aliases?: string[] }).aliases ?? [];
    const currentCommonMatches = common && [taxon.commonName, original.commonName, ...aliases, ...originalAliases].some(name => normalizeName(name) === common);
    if (['broader', 'narrower'].includes(taxon.mappingStatus) && !currentCommonMatches) {
      return { kind: 'unresolved', reason: 'This name spans a documented concept change. The original common name does not identify a current species unambiguously; retained for review.' };
    }
    let warning: string | undefined;
    if (original.code !== taxon.code) warning = `Reported ${original.commonName || original.scientificName} rolled into parent species ${taxon.commonName}.`;
    else if (!scientific.length && sci && named.length) warning = 'Resolved by an exact common name; the reported scientific name was not found in the pinned taxonomy.';
    if (taxon.mappingStatus !== 'exact') warning = [warning, taxon.mappingNote || `Source-tree relationship: ${taxon.mappingStatus}.`].filter(Boolean).join(' ');
    return { kind: 'species', taxon, warning };
  }
}

export function parseObservationDate(value: string): { date: string | null; kind: 'valid' | 'missing' | 'invalid' | 'historical' } {
  const text = value.trim();
  if (!text) return { date: null, kind: 'missing' };
  let year: number, month: number, day: number;
  let match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(text);
  if (match) [, year, month, day] = match.map(Number);
  else {
    match = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
    if (!match) return { date: null, kind: 'invalid' };
    [, month, day, year] = match.map(Number);
  }
  if (year! < 1000 || year! > 9999 || month! < 1 || month! > 12 || day! < 1 || day! > 31) return { date: null, kind: 'invalid' };
  const check = new Date(Date.UTC(year!, month! - 1, day!));
  if (check.getUTCFullYear() !== year! || check.getUTCMonth() !== month! - 1 || check.getUTCDate() !== day!) return { date: null, kind: 'invalid' };
  const date = `${year!}`.padStart(4, '0') + '-' + `${month!}`.padStart(2, '0') + '-' + `${day!}`.padStart(2, '0');
  return date === '1900-01-01' ? { date: null, kind: 'historical' } : { date, kind: 'valid' };
}

interface Aggregate {
  observation: SpeciesObservation;
  names: Set<string>;
  checklists: Set<string>;
}

function addPresence(aggregates: Map<string, Aggregate>, code: string, originalNames: string[], checklist: string, date: ReturnType<typeof parseObservationDate>): boolean {
  let aggregate = aggregates.get(code);
  if (!aggregate) {
    aggregate = {
      observation: { code, originalNames: [], earliestDate: null, checklistCount: 0, recordCount: 0, missingDateCount: 0, historicalDateCount: 0 },
      names: new Set(), checklists: new Set(),
    };
    aggregates.set(code, aggregate);
  }
  for (const original of originalNames) if (original) aggregate.names.add(original);
  aggregate.observation.recordCount++;
  const duplicate = Boolean(checklist && aggregate.checklists.has(checklist));
  if (checklist) aggregate.checklists.add(checklist);
  if (date.kind === 'historical') aggregate.observation.historicalDateCount++;
  else if (date.kind === 'invalid' || date.kind === 'missing') aggregate.observation.missingDateCount++;
  else if (date.date && (!aggregate.observation.earliestDate || date.date < aggregate.observation.earliestDate)) aggregate.observation.earliestDate = date.date;
  return duplicate;
}

function finishSpecies(aggregates: Map<string, Aggregate>): SpeciesObservation[] {
  return [...aggregates.values()].map(aggregate => ({
    ...aggregate.observation, checklistCount: aggregate.checklists.size,
    originalNames: [...aggregate.names].sort(),
  })).sort((a, b) => a.code.localeCompare(b.code));
}

function mergeAggregates(target: Map<string, Aggregate>, source: Map<string, Aggregate>): void {
  for (const [code, next] of source) {
    let current = target.get(code);
    if (!current) {
      current = { observation: { ...next.observation }, names: new Set(next.names), checklists: new Set(next.checklists) };
      target.set(code, current);
      continue;
    }
    current.observation.recordCount += next.observation.recordCount;
    current.observation.missingDateCount += next.observation.missingDateCount;
    current.observation.historicalDateCount += next.observation.historicalDateCount;
    const date = next.observation.earliestDate;
    if (date && (!current.observation.earliestDate || date < current.observation.earliestDate)) current.observation.earliestDate = date;
    for (const name of next.names) current.names.add(name);
    for (const checklist of next.checklists) current.checklists.add(checklist);
  }
}

interface CountryAggregates { country: CountryIdentity; aggregates: Map<string, Aggregate> }
const finishCountries = (countries: Map<string, CountryAggregates>) => [...countries.values()].map(group => ({ ...group.country, species: finishSpecies(group.aggregates) })).sort((a,b)=>a.code.localeCompare(b.code));

/** Keeps only aggregates and transient checklist IDs; location and comments never enter state. */
export class CollectionAggregator {
  readonly report: ImportReport = {
    totalRecords: 0, acceptedRecords: 0, excludedRecords: 0, invalidDateRecords: 0, missingDateRecords: 0,
    historicalDateRecords: 0, duplicateRecords: 0, unresolvedRecords: 0, issues: [],
    mappedSpecies: 0, unmappedSpecies: 0, sourceTipCount: 0, artworkGaps: 0,
    countryUnassignedRecords: 0,
  };
  private resolver: TaxonResolver;
  private taxaByCode: Map<string, Taxon>;
  private aggregates = new Map<string, Aggregate>();
  private countries = new Map<string, CountryAggregates>();
  private years = new Map<number, { aggregates: Map<string, Aggregate>; countries: Map<string, CountryAggregates> }>();
  private issues = new Map<string, ImportIssue>();

  constructor(taxa: Taxon[], private options: ImportOptions) {
    this.resolver = new TaxonResolver(taxa);
    this.taxaByCode = new Map(taxa.map(taxon => [taxon.code, taxon]));
  }

  private issue(row: number, name: string, reason: string, disposition: ImportIssue['disposition']) {
    const key = `${disposition}\u0000${name}\u0000${reason}`;
    const previous = this.issues.get(key);
    if (previous) previous.count = (previous.count ?? 1) + 1;
    else this.issues.set(key, { row, name, reason, disposition, count: 1 });
  }

  add(row: CsvRow): void {
    const rowNumber = ++this.report.totalRecords + 1;
    const scientificName = (row['scientific name'] ?? '').trim();
    const commonName = (row['common name'] ?? '').trim();
    const name = commonName || scientificName || '(unnamed record)';
    const count = (row.count ?? '').trim();
    if (count !== 'X' && count !== 'x' && (!/^\d+(?:\.0+)?$/.test(count) || !Number.isSafeInteger(Number(count)))) {
      this.report.excludedRecords++;
      this.issue(rowNumber, name, 'Invalid or missing count. Expected a nonnegative whole number or X for presence.', 'excluded');
      return;
    }
    if (count !== 'X' && count !== 'x' && Number(count) === 0) {
      this.report.excludedRecords++;
      this.issue(rowNumber, name, 'Zero-count record; explicitly excluded from recorded presences.', 'excluded');
      return;
    }
    const resolution = this.resolver.resolve(scientificName, commonName);
    if (resolution.kind === 'excluded') {
      this.report.excludedRecords++;
      this.issue(rowNumber, name, resolution.reason, 'excluded');
      return;
    }
    const code = resolution.kind === 'species' ? resolution.taxon.code : `unresolved:${normalizeName(scientificName || commonName) || 'unnamed'}`;
    if (resolution.kind === 'unresolved') {
      this.report.unresolvedRecords++;
      this.issue(rowNumber, name, resolution.reason, 'unresolved');
    } else {
      this.report.acceptedRecords++;
      if (resolution.warning) this.issue(rowNumber, name, resolution.warning, 'warning');
    }
    const checklist = (row['submission id'] ?? '').trim();
    if (!checklist) this.issue(rowNumber, name, 'Missing submission ID: presence retained, but this row cannot add to the distinct checklist count.', 'warning');
    const date = parseObservationDate(row.date ?? '');
    if (addPresence(this.aggregates, code, [commonName, scientificName], checklist, date)) this.report.duplicateRecords++;
    const country = countryForRow(row);
    if (country) {
      let group = this.countries.get(country.code);
      if (!group) { group = { country, aggregates: new Map() }; this.countries.set(country.code, group); }
      addPresence(group.aggregates, code, [commonName, scientificName], checklist, date);
    } else this.report.countryUnassignedRecords = (this.report.countryUnassignedRecords ?? 0) + 1;
    if (date.kind === 'valid' && date.date) {
      const year = Number(date.date.slice(0,4));
      let annual = this.years.get(year);
      if (!annual) { annual = { aggregates: new Map(), countries: new Map() }; this.years.set(year,annual); }
      addPresence(annual.aggregates,code,[commonName,scientificName],checklist,date);
      if (country) {
        let group = annual.countries.get(country.code);
        if (!group) { group = { country, aggregates:new Map() };annual.countries.set(country.code,group); }
        addPresence(group.aggregates,code,[commonName,scientificName],checklist,date);
      }
    }
    if (date.kind === 'historical') {
      this.report.historicalDateRecords++;
      this.issue(rowNumber, name, 'January 1, 1900 is an unspecified historical date; excluded from precise earliest-date claims.', 'warning');
    } else if (date.kind === 'invalid') {
      this.report.invalidDateRecords++;
      this.issue(rowNumber, name, 'Invalid observation date; presence retained without a precise date.', 'warning');
    } else if (date.kind === 'missing') {
      this.report.missingDateRecords++;
    }
  }

  finish(): Collection {
    const species = finishSpecies(this.aggregates);
    const cumulative = new Map<string,Aggregate>(), cumulativeCountries = new Map<string,CountryAggregates>();
    const years = [...this.years].sort(([a],[b])=>a-b).map(([year,annual])=>{
      mergeAggregates(cumulative,annual.aggregates);
      for (const [code,group] of annual.countries) {
        let total = cumulativeCountries.get(code);
        if (!total) { total = {country:group.country,aggregates:new Map()};cumulativeCountries.set(code,total); }
        mergeAggregates(total.aggregates,group.aggregates);
      }
      return { year,species:finishSpecies(annual.aggregates),countries:finishCountries(annual.countries),cumulative:{species:finishSpecies(cumulative),countries:finishCountries(cumulativeCountries)} };
    });
    this.report.issues = [...this.issues.values()];
    const tips = new Set<number>();
    this.report.mappedSpecies = 0; this.report.unmappedSpecies = 0; this.report.artworkGaps = 0;
    for (const observation of species) {
      const taxon = this.taxaByCode.get(observation.code);
      if (taxon?.treeTip !== undefined && taxon.mappingStatus !== 'unresolved') {
        this.report.mappedSpecies++;
        for (const tip of taxon.treeTips ?? [taxon.treeTip]) tips.add(tip);
      } else this.report.unmappedSpecies++;
      if (!taxon?.sticker || taxon.artworkStatus === 'questionable') this.report.artworkGaps++;
    }
    this.report.sourceTipCount = tips.size;
    return {
      schemaVersion: 1, datasetVersion: this.options.datasetVersion, taxonomyVersion: this.options.taxonomyVersion,
      label: this.options.label ?? 'Imported eBird observations', importedAt: this.options.importedAt ?? new Date().toISOString(),
      species, countries: finishCountries(this.countries), years,
      report: { ...this.report, issues: this.report.issues.map(issue => ({ ...issue })) },
    };
  }
}

/** Synchronous entry point for small synthetic fixtures and deterministic regression tests. */
export function parseCsv(text: string, taxa: Taxon[], options: ImportOptions): Collection {
  const parsed = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: 'greedy', transformHeader: canonicalHeader });
  validateHeaders(parsed.meta.fields);
  if ((parsed.meta as unknown as { renamedHeaders?: Record<string, string> }).renamedHeaders && Object.keys((parsed.meta as unknown as { renamedHeaders: Record<string, string> }).renamedHeaders).length) throw new Error('The CSV contains duplicate column names.');
  validateParsedChunk(parsed);
  const aggregator = new CollectionAggregator(taxa, options);
  for (const row of parsed.data) aggregator.add(row);
  return aggregator.finish();
}
