import type { Collection, SpeciesObservation, YearCollection } from '../types';

export type YearMode = 'cumulative' | 'annual';
export interface PeriodOptions { countryCode?: string | null; year?: number | null; mode?: YearMode }
const countrySpecies = (collection: Collection, countryCode?: string | null) => countryCode ? collection.countries?.find(country=>country.code===countryCode)?.species || [] : collection.species;

export function yearHistoryAvailable(collection: Collection): boolean { return Array.isArray(collection.years); }
export function periodCountsAreExact(collection: Collection, options: PeriodOptions = {}): boolean { return options.year == null || yearHistoryAvailable(collection); }
export function undatedSpeciesCount(collection: Collection, countryCode?: string | null): number { return countrySpecies(collection,countryCode).filter(observation=>!observation.code.startsWith('unresolved:')&&!observation.earliestDate).length; }
export function undatedRecordCount(collection: Collection, countryCode?: string | null): number { return countrySpecies(collection,countryCode).reduce((sum,observation)=>sum+observation.missingDateCount+observation.historicalDateCount,0); }

/** Years with dated observations; the gallery can combine these with a country. */
export function availableYears(collection: Collection, countryCode?: string | null): number[] {
  const years = collection.years === undefined ? countrySpecies(collection,countryCode).flatMap(observation=>observation.earliestDate?[Number(observation.earliestDate.slice(0,4))]:[]) : collection.years.filter(annual=>!countryCode||annual.countries.some(country=>country.code===countryCode&&country.species.length)).map(annual=>annual.year);
  return [...new Set(years)].sort((a,b)=>a-b);
}

/** Older exports support first-seen cumulative membership, never invented annual sightings. */
export function observationsForPeriod(collection: Collection, options: PeriodOptions = {}): SpeciesObservation[] {
  const {countryCode,year,mode='cumulative'}=options;
  if(year==null)return countrySpecies(collection,countryCode);
  if(!Number.isInteger(year)||year<1000||year>9999)return [];
  if(collection.years===undefined) {
    if(mode==='annual')return [];
    return countrySpecies(collection,countryCode).filter(observation=>observation.earliestDate&&Number(observation.earliestDate.slice(0,4))<=year);
  }
  const annual=mode==='annual'?collection.years.find(item=>item.year===year):collection.years.reduce<YearCollection|undefined>((latest,item)=>item.year<=year&&(!latest||item.year>latest.year)?item:latest,undefined);
  if(!annual)return [];
  const period=mode==='annual'?annual:annual.cumulative;
  return countryCode?period.countries.find(country=>country.code===countryCode)?.species||[]:period.species;
}
