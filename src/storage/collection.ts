import type { Collection, CountryCollection, ImportIssue, ImportReport, SpeciesObservation, Taxon, YearCollection } from '../types';
import { parseObservationDate } from '../import/aggregate';
import { countryByCode, resolveCountryNameOrCode } from '../import/countries';

const DATABASE = 'everybird-phylogeny';
const STORE = 'collections';
const KEY = 'current';
const MAX_BACKUP_BYTES = 64 * 1024 * 1024;
const REPORT_COUNTS = ['totalRecords', 'acceptedRecords', 'excludedRecords', 'invalidDateRecords', 'missingDateRecords', 'historicalDateRecords', 'duplicateRecords', 'unresolvedRecords', 'mappedSpecies', 'unmappedSpecies', 'sourceTipCount', 'artworkGaps'] as const;

export interface CollectionVersions {
  datasetVersion?: string;
  taxonomyVersion?: string;
  taxa?: Taxon[];
}

const object = (value: unknown, label: string): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid backup: ${label} must be an object.`);
  return value as Record<string, unknown>;
};
const text = (value: unknown, label: string, max = 1000): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error(`Invalid backup: ${label} must be a nonempty string.`);
  return value;
};
const count = (value: unknown, label: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`Invalid backup: ${label} must be a nonnegative integer.`);
  return value;
};
const allowedKeys = (value: Record<string, unknown>, allowed: string[], label: string) => {
  if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error(`Invalid backup: unexpected fields in ${label}. Only normalized collection data can be restored.`);
};

function validateObservation(value: unknown): SpeciesObservation {
  const item = object(value, 'species observation');
  allowedKeys(item, ['code', 'originalNames', 'earliestDate', 'checklistCount', 'recordCount', 'missingDateCount', 'historicalDateCount'], 'species observation');
  const code = text(item.code, 'species code', 500);
  if (!Array.isArray(item.originalNames) || item.originalNames.length > 1000) throw new Error('Invalid backup: originalNames must be a short list of reported taxon names.');
  const originalNames = [...new Set(item.originalNames.map(name => text(name, 'reported taxon name', 500)))];
  const earliestDate = item.earliestDate === null ? null : text(item.earliestDate, 'earliest date', 10);
  if (earliestDate !== null && (!/^\d{4}-\d{2}-\d{2}$/.test(earliestDate) || parseObservationDate(earliestDate).kind !== 'valid')) throw new Error('Invalid backup: earliestDate must be a valid ISO date or null.');
  const observation = {
    code, originalNames, earliestDate,
    checklistCount: count(item.checklistCount, 'checklist count'), recordCount: count(item.recordCount, 'record count'),
    missingDateCount: count(item.missingDateCount, 'missing-date count'), historicalDateCount: count(item.historicalDateCount, 'historical-date count'),
  };
  if (!observation.recordCount || observation.checklistCount > observation.recordCount || observation.missingDateCount + observation.historicalDateCount > observation.recordCount) throw new Error('Invalid backup: inconsistent species observation counts.');
  return observation;
}

function validateIssue(value: unknown): ImportIssue {
  const item = object(value, 'import issue');
  allowedKeys(item, ['row', 'name', 'reason', 'disposition', 'count'], 'import issue');
  if (!['warning', 'unresolved', 'excluded'].includes(String(item.disposition))) throw new Error('Invalid backup: unknown issue disposition.');
  const result: ImportIssue = {
    row: count(item.row, 'issue row'), name: text(item.name, 'reported taxon name', 1000),
    reason: text(item.reason, 'issue explanation', 4000), disposition: item.disposition as ImportIssue['disposition'],
  };
  if (item.count !== undefined) {
    result.count = count(item.count, 'issue count');
    if (!result.count) throw new Error('Invalid backup: an issue count must be positive.');
  }
  return result;
}

function validateCountries(value: unknown, globalSpecies: SpeciesObservation[]): CountryCollection[] {
  if (!Array.isArray(value) || value.length > 300) throw new Error('Invalid backup: countries must be a short list of country aggregates.');
  const globalByCode = new Map(globalSpecies.map(species => [species.code, species]));
  const countryCodes = new Set<string>();
  const combined = new Map<string, { records: number; missing: number; historical: number }>();
  return value.map(item => {
    const raw = object(item, 'country aggregate');
    allowedKeys(raw, ['code', 'name', 'species'], 'country aggregate');
    const code = text(raw.code, 'country code', 2);
    const country = countryByCode(code);
    const name = text(raw.name, 'country name', 150);
    if (!country || country.code !== code || resolveCountryNameOrCode(name)?.code !== code) throw new Error('Invalid backup: unknown or inconsistent country code and name.');
    if (countryCodes.has(code)) throw new Error('Invalid backup: country codes must be unique.');
    countryCodes.add(code);
    if (!Array.isArray(raw.species) || !raw.species.length || raw.species.length > 100000) throw new Error('Invalid backup: each country must have a bounded, nonempty species list.');
    const species = raw.species.map(validateObservation);
    if (new Set(species.map(observation => observation.code)).size !== species.length) throw new Error('Invalid backup: species codes within a country must be unique.');
    for (const observation of species) {
      const global = globalByCode.get(observation.code);
      if (!global || observation.recordCount > global.recordCount || observation.checklistCount > global.checklistCount || observation.missingDateCount > global.missingDateCount || observation.historicalDateCount > global.historicalDateCount) throw new Error('Invalid backup: country species counts exceed the global collection.');
      if ((observation.earliestDate !== null && global.earliestDate === null) || (observation.earliestDate !== null && global.earliestDate !== null && observation.earliestDate < global.earliestDate)) throw new Error('Invalid backup: a country earliest date precedes its global species date.');
      if (observation.originalNames.some(original => !global.originalNames.includes(original))) throw new Error('Invalid backup: country taxon names are absent from the global collection.');
      const total = combined.get(observation.code) ?? { records: 0, missing: 0, historical: 0 };
      total.records += observation.recordCount;
      total.missing += observation.missingDateCount;
      total.historical += observation.historicalDateCount;
      if (total.records > global.recordCount || total.missing > global.missingDateCount || total.historical > global.historicalDateCount) throw new Error('Invalid backup: combined country records exceed the global collection.');
      combined.set(observation.code, total);
    }
    return { ...country, species };
  });
}

interface PrefixObservation { records: number; checklistSum: number; checklistMaximum: number; previousChecklists: number; earliest: string; names: Set<string> }
type Prefix = Map<string, PrefixObservation>;
function extendPrefix(prefix: Prefix, species: SpeciesObservation[]): void {
  for (const item of species) {
    const previous=prefix.get(item.code)||{records:0,checklistSum:0,checklistMaximum:0,previousChecklists:0,earliest:item.earliestDate!,names:new Set<string>()};
    previous.records+=item.recordCount;previous.checklistSum+=item.checklistCount;previous.checklistMaximum=Math.max(previous.checklistMaximum,item.checklistCount);
    if(item.earliestDate!<previous.earliest)previous.earliest=item.earliestDate!;
    for(const name of item.originalNames)previous.names.add(name);
    prefix.set(item.code,previous);
  }
}
function assertDatedWithin(item: SpeciesObservation, parent: SpeciesObservation | undefined, year?: number): void {
  if(!parent||!item.earliestDate||item.missingDateCount||item.historicalDateCount||!parent.earliestDate||item.earliestDate<parent.earliestDate||item.recordCount>parent.recordCount||item.checklistCount>parent.checklistCount||item.originalNames.some(name=>!parent.originalNames.includes(name))||(year!==undefined&&Number(item.earliestDate.slice(0,4))!==year))throw new Error('Invalid backup: inconsistent dated year observation.');
}
function validateYearSpecies(value:unknown,parent:SpeciesObservation[],year?:number):SpeciesObservation[]{
  if(!Array.isArray(value)||!value.length||value.length>100000)throw new Error('Invalid backup: year species must be a bounded, nonempty list.');
  const species=value.map(validateObservation),byCode=new Map(parent.map(item=>[item.code,item]));
  if(new Set(species.map(item=>item.code)).size!==species.length)throw new Error('Invalid backup: year species codes must be unique.');
  for(const item of species)assertDatedWithin(item,byCode.get(item.code),year);
  return species;
}
function validateYearCountries(value:unknown,period:SpeciesObservation[],globalCountries:CountryCollection[],year?:number):CountryCollection[]{
  const countries=validateCountries(value,period),byCountry=new Map(globalCountries.map(country=>[country.code,new Map(country.species.map(item=>[item.code,item]))]));
  for(const country of countries){
    const global=byCountry.get(country.code);
    if(!global)throw new Error('Invalid backup: year country is absent from the collection.');
    for(const item of country.species)assertDatedWithin(item,global.get(item.code),year);
  }
  return countries;
}
function assertCumulative(species:SpeciesObservation[],prefix:Prefix,annual:SpeciesObservation[],parent:SpeciesObservation[]):void{
  if(species.length!==prefix.size)throw new Error('Invalid backup: cumulative year membership does not match annual records.');
  const annualByCode=new Map(annual.map(item=>[item.code,item])),parentByCode=new Map(parent.map(item=>[item.code,item]));
  for(const item of species){
    const expected=prefix.get(item.code),global=parentByCode.get(item.code);
    if(!expected||!global||item.recordCount!==expected.records||item.earliestDate!==expected.earliest||item.originalNames.length!==expected.names.size||item.originalNames.some(name=>!expected.names.has(name)))throw new Error('Invalid backup: cumulative year records do not match annual records.');
    let minimum=Math.max(expected.checklistMaximum,expected.previousChecklists);
    if(expected.records===global.recordCount-global.missingDateCount-global.historicalDateCount)minimum=Math.max(minimum,global.checklistCount-global.missingDateCount-global.historicalDateCount);
    const maximum=Math.min(expected.checklistSum,expected.previousChecklists+(annualByCode.get(item.code)?.checklistCount||0),global.checklistCount);
    if(item.checklistCount<minimum||item.checklistCount>maximum)throw new Error('Invalid backup: cumulative checklist totals are inconsistent.');
    expected.previousChecklists=item.checklistCount;
  }
}
function assertDatedCoverage(prefix:Prefix,parent:SpeciesObservation[]):void{
  for(const item of parent){
    const total=prefix.get(item.code),expected=item.recordCount-item.missingDateCount-item.historicalDateCount;
    if((total?.records||0)!==expected||(expected>0&&total?.earliest!==item.earliestDate))throw new Error('Invalid backup: year records do not cover all dated observations.');
  }
}
function validateYears(value:unknown,species:SpeciesObservation[],countries:CountryCollection[]):YearCollection[]{
  if(!Array.isArray(value)||value.length>9000)throw new Error('Invalid backup: years must be a bounded list.');
  const seen=new Set<number>();
  const years=value.map(item=>{
    const raw=object(item,'year aggregate');allowedKeys(raw,['year','species','countries','cumulative'],'year aggregate');
    const year=count(raw.year,'observation year');
    if(year<1000||year>9999||seen.has(year))throw new Error('Invalid backup: observation years must be valid and unique.');
    seen.add(year);
    const annual=validateYearSpecies(raw.species,species,year),annualCountries=validateYearCountries(raw.countries,annual,countries,year);
    const cumulative=object(raw.cumulative,'cumulative year aggregate');allowedKeys(cumulative,['species','countries'],'cumulative year aggregate');
    const cumulativeSpecies=validateYearSpecies(cumulative.species,species),cumulativeCountries=validateYearCountries(cumulative.countries,cumulativeSpecies,countries);
    if(cumulativeSpecies.some(observation=>Number(observation.earliestDate!.slice(0,4))>year))throw new Error('Invalid backup: cumulative observation follows the selected year.');
    return{year,species:annual,countries:annualCountries,cumulative:{species:cumulativeSpecies,countries:cumulativeCountries}};
  }).sort((a,b)=>a.year-b.year);
  const prefix:Prefix=new Map(),countryPrefixes=new Map<string,Prefix>(),globalCountries=new Map(countries.map(country=>[country.code,country.species]));
  for(const annual of years){
    extendPrefix(prefix,annual.species);assertCumulative(annual.cumulative.species,prefix,annual.species,species);
    for(const country of annual.countries){const current=countryPrefixes.get(country.code)||new Map();extendPrefix(current,country.species);countryPrefixes.set(country.code,current);}
    if(annual.cumulative.countries.length!==countryPrefixes.size)throw new Error('Invalid backup: cumulative country membership is inconsistent.');
    for(const country of annual.cumulative.countries){
      const current=countryPrefixes.get(country.code),parent=globalCountries.get(country.code);
      if(!current||!parent)throw new Error('Invalid backup: unexpected cumulative country.');
      assertCumulative(country.species,current,annual.countries.find(item=>item.code===country.code)?.species||[],parent);
    }
  }
  assertDatedCoverage(prefix,species);
  for(const country of countries)assertDatedCoverage(countryPrefixes.get(country.code)||new Map(),country.species);
  return years;
}

function normalizeCollection(value: unknown): Collection {
  const data = object(value, 'collection');
  allowedKeys(data, ['schemaVersion', 'datasetVersion', 'taxonomyVersion', 'label', 'importedAt', 'species', 'countries', 'years', 'report', 'isDemo'], 'collection');
  if (data.schemaVersion !== 1) throw new Error('Unsupported backup version. Import the original eBird CSV to create a current collection.');
  if (!Array.isArray(data.species) || data.species.length > 100000) throw new Error('Invalid backup: species must be a list with at most 100,000 entries.');
  const species = data.species.map(validateObservation);
  if (new Set(species.map(item => item.code)).size !== species.length) throw new Error('Invalid backup: species codes must be unique.');
  const rawReport = object(data.report, 'import report');
  allowedKeys(rawReport, [...REPORT_COUNTS, 'countryUnassignedRecords', 'issues'], 'import report');
  if (!Array.isArray(rawReport.issues) || rawReport.issues.length > 200000) throw new Error('Invalid backup: import issues must be a bounded list.');
  const report = Object.fromEntries(REPORT_COUNTS.map(key => [key, count(rawReport[key], key)])) as unknown as ImportReport;
  report.issues = rawReport.issues.map(validateIssue);
  if (rawReport.countryUnassignedRecords !== undefined) report.countryUnassignedRecords = count(rawReport.countryUnassignedRecords, 'unassigned country record count');
  if (report.totalRecords !== report.acceptedRecords + report.excludedRecords + report.unresolvedRecords) throw new Error('Invalid backup: not all input records are accounted for.');
  if (species.reduce((sum, item) => sum + item.recordCount, 0) !== report.acceptedRecords + report.unresolvedRecords) throw new Error('Invalid backup: species records do not agree with the reconciliation report.');
  if (report.mappedSpecies + report.unmappedSpecies !== species.length || report.artworkGaps > species.length) throw new Error('Invalid backup: source coverage counts are inconsistent.');
  if (report.invalidDateRecords + report.missingDateRecords + report.historicalDateRecords > report.acceptedRecords + report.unresolvedRecords || report.duplicateRecords > report.acceptedRecords + report.unresolvedRecords) throw new Error('Invalid backup: invalid reconciliation counts.');
  const countries = data.countries === undefined ? undefined : validateCountries(data.countries, species);
  if (countries !== undefined) {
    const countryRecords = countries.reduce((sum, country) => sum + country.species.reduce((total, observation) => total + observation.recordCount, 0), 0);
    const unassigned = report.acceptedRecords + report.unresolvedRecords - countryRecords;
    if (unassigned < 0 || (report.countryUnassignedRecords !== undefined && report.countryUnassignedRecords !== unassigned)) throw new Error('Invalid backup: country and unassigned record counts do not account for the global collection.');
    report.countryUnassignedRecords = unassigned;
  } else if ((report.countryUnassignedRecords ?? 0) > report.acceptedRecords + report.unresolvedRecords) throw new Error('Invalid backup: unassigned country count exceeds recorded presences.');
  const years=data.years===undefined?undefined:validateYears(data.years,species,countries||[]);
  const importedAt = text(data.importedAt, 'import timestamp', 40);
  if (!/^\d{4}-\d\d-\d\dT/.test(importedAt) || Number.isNaN(Date.parse(importedAt))) throw new Error('Invalid backup: import timestamp must be an ISO timestamp.');
  if (data.isDemo !== undefined && typeof data.isDemo !== 'boolean') throw new Error('Invalid backup: isDemo must be a boolean.');
  return {
    schemaVersion: 1, datasetVersion: text(data.datasetVersion, 'dataset version', 250), taxonomyVersion: text(data.taxonomyVersion, 'taxonomy version', 250),
    label: text(data.label, 'collection label', 1000), importedAt,
    species, ...(countries !== undefined ? { countries } : {}), ...(years!==undefined?{years}:{}), report, ...(data.isDemo !== undefined ? { isDemo: data.isDemo as boolean } : {}),
  };
}

/** A backup is whitelisted and validated before either downloading or replacing state. */
export function serializeBackup(collection: Collection): string {
  return JSON.stringify(normalizeCollection(collection), null, 2);
}

export function parseBackup(json: string, versions: CollectionVersions = {}): Collection {
  if (json.length > MAX_BACKUP_BYTES) throw new Error('This backup is too large. Import a full eBird CSV instead.');
  let raw: unknown;
  try { raw = JSON.parse(json); }
  catch { throw new Error('The backup is not valid JSON. Your existing collection is unchanged.'); }
  const collection = normalizeCollection(raw);
  if (versions.taxonomyVersion && versions.taxonomyVersion !== collection.taxonomyVersion) throw new Error(`This backup uses taxonomy ${collection.taxonomyVersion}; the app uses ${versions.taxonomyVersion}. Reimport the original CSV so changed taxon concepts can be reviewed.`);
  const datasetChanged = versions.datasetVersion && versions.datasetVersion !== collection.datasetVersion;
  if (datasetChanged && !versions.taxa) throw new Error('The source tree has changed. Reimport the CSV or restore with the current taxonomy dataset to recompute tree coverage.');
  // Artwork can change independently of the tree and taxonomic concepts.
  // Refresh coverage against available data on every restore, including same-version restores.
  if (versions.taxa) {
    const taxaByCode = new Map(versions.taxa.map(taxon => [taxon.code, taxon]));
    const tips = new Set<number>();
    let mappedSpecies = 0, artworkGaps = 0;
    for (const observation of collection.species) {
      const taxon = taxaByCode.get(observation.code);
      if (taxon?.treeTip !== undefined && taxon.mappingStatus !== 'unresolved') {
        mappedSpecies++;
        for (const tip of taxon.treeTips ?? [taxon.treeTip]) tips.add(tip);
      }
      if (!taxon?.sticker || taxon.artworkStatus === 'questionable') artworkGaps++;
    }
    collection.report = { ...collection.report, mappedSpecies, unmappedSpecies: collection.species.length - mappedSpecies, sourceTipCount: tips.size, artworkGaps };
    if (versions.datasetVersion) collection.datasetVersion = versions.datasetVersion;
  }
  return collection;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('Browser storage is unavailable. Download a backup to keep your collection.')); return; }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) database.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Browser storage could not be opened. Download a backup to keep your collection.'));
    request.onblocked = () => reject(new Error('Browser storage is blocked by another app tab. Close that tab and try again.'));
  });
}

export async function saveCollection(collection: Collection): Promise<void> {
  const normalized = parseBackup(serializeBackup(collection));
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).put(normalized, KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('The collection could not be saved on this device. Storage may be full or disabled. Download a backup instead.'));
    });
  } finally { database.close(); }
}

export async function loadCollection(versions: CollectionVersions = {}): Promise<Collection | null> {
  const database = await openDatabase();
  try {
    const stored = await new Promise<unknown>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly');
      const request = transaction.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('The saved collection could not be read.'));
    });
    return stored === undefined ? null : parseBackup(JSON.stringify(stored), versions);
  } finally { database.close(); }
}

export async function clearCollection(): Promise<void> {
  const database = await openDatabase();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite');
      transaction.objectStore(STORE).delete(KEY);
      transaction.oncomplete = () => resolve();
      transaction.onerror = transaction.onabort = () => reject(new Error('The saved collection could not be cleared. Try again after closing other app tabs.'));
    });
  } finally { database.close(); }
}
