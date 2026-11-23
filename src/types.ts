export type MappingStatus = 'exact' | 'renamed' | 'broader' | 'narrower' | 'unresolved';
export interface Taxon {
  code: string;
  scientificName: string;
  commonName: string;
  category: string;
  parentCode?: string;
  order?: string;
  family?: string;
  conceptId?: string;
  treeTip?: number;
  treeTips?: number[];
  mappingStatus: MappingStatus;
  mappingNote?: string;
  sticker?: string;
  stickerSmall?: string;
  artworkStatus?: string;
  aliases?: string[];
}
export interface TreeNode {
  id: number;
  parent: number | null;
  children: number[];
  length: number;
  distance: number;
  age: number;
  leafStart: number;
  leafEnd: number;
  name?: string;
  taxonCode?: string;
}
export interface TreeData {
  version: string;
  root: number;
  nodes: TreeNode[];
  tips: number[];
  maxDistance: number;
  sourceClades?: Array<{name:string;rank:'order'|'family';nodeId:number;tipCount:number}>;
}
export interface SpeciesObservation {
  code: string;
  originalNames: string[];
  earliestDate: string | null;
  checklistCount: number;
  recordCount: number;
  missingDateCount: number;
  historicalDateCount: number;
}
export interface ImportIssue {
  row: number;
  name: string;
  reason: string;
  disposition: 'excluded' | 'unresolved' | 'warning';
  count?: number;
}
export interface ImportReport {
  totalRecords: number;
  acceptedRecords: number;
  excludedRecords: number;
  invalidDateRecords: number;
  missingDateRecords: number;
  historicalDateRecords: number;
  duplicateRecords: number;
  unresolvedRecords: number;
  issues: ImportIssue[];
  mappedSpecies: number;
  unmappedSpecies: number;
  sourceTipCount: number;
  artworkGaps: number;
  countryUnassignedRecords?: number;
}
export interface CountryCollection {
  code: string;
  name: string;
  species: SpeciesObservation[];
}
/** Calendar-year summaries contain only records with a valid, specified date. */
export interface YearCollection {
  year: number;
  species: SpeciesObservation[];
  countries: CountryCollection[];
  cumulative: { species: SpeciesObservation[]; countries: CountryCollection[] };
}
export interface Collection {
  schemaVersion: 1;
  datasetVersion: string;
  taxonomyVersion: string;
  label: string;
  importedAt: string;
  species: SpeciesObservation[];
  countries?: CountryCollection[];
  /** Missing in older backups, which retain first-seen membership only. */
  years?: YearCollection[];
  report: ImportReport;
  isDemo?: boolean;
}
