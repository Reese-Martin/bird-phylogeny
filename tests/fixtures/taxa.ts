import type { Taxon } from '../../src/types';

/** Deliberately synthetic concept cases, independent of downloaded source revisions. */
export const testTaxa: Taxon[] = [
  { code: 'amecro', commonName: 'American Crow', scientificName: 'Corvus brachyrhynchos', category: 'species', mappingStatus: 'exact', treeTip: 1, sticker: '/stickers/amecro.webp' },
  { code: 'canjay', commonName: 'Canada Jay', scientificName: 'Perisoreus canadensis', aliases: ['Gray Jay'], category: 'species', mappingStatus: 'renamed', treeTip: 2, mappingNote: 'Documented common-name change; species concept retained.' },
  { code: 'mallar', commonName: 'Mallard', scientificName: 'Anas platyrhynchos', category: 'species', mappingStatus: 'exact', treeTip: 3 },
  { code: 'mallar-group', commonName: 'Mallard (Northern)', scientificName: 'Anas platyrhynchos platyrhynchos', category: 'issf', parentCode: 'mallar', mappingStatus: 'exact' },
  { code: 'willet2', commonName: 'Saltmarsh Willet', scientificName: 'Tringa semipalmata', category: 'species', mappingStatus: 'broader', treeTip: 4, mappingNote: 'The 2025 Willet source tip is a broader pre-split aggregate, with no assigned descendant divergence date.' },
  { code: 'willet3', commonName: 'Prairie Willet', scientificName: 'Tringa inornata', category: 'species', mappingStatus: 'broader', treeTip: 4, mappingNote: 'The 2025 Willet source tip is a broader pre-split aggregate, with no assigned descendant divergence date.' },
  { code: 'merged-finch', commonName: 'Merged Finch', scientificName: 'Testus merged', aliases: ['Former Finch', 'Testus former'], category: 'species', mappingStatus: 'narrower', treeTip: 5, mappingNote: 'Synthetic lump: source-tree coverage is narrower than the target species.' },
  { code: 'duck-hybrid', commonName: 'Mallard x Northern Pintail (hybrid)', scientificName: 'Anas platyrhynchos x acuta', category: 'hybrid', mappingStatus: 'unresolved' },
  { code: 'duck-spuh', commonName: 'duck sp.', scientificName: 'Anatidae sp.', category: 'spuh', mappingStatus: 'unresolved' },
  { code: 'duck-domestic', commonName: 'Mallard (Domestic type)', scientificName: 'Anas platyrhynchos (Domestic type)', category: 'domestic', mappingStatus: 'unresolved' },
  { code: 'willet-slash', commonName: 'Saltmarsh/Prairie Willet', scientificName: 'Tringa semipalmata/inornata', category: 'slash', mappingStatus: 'unresolved' },
];

export const testVersions = { datasetVersion: 'synthetic-2025', taxonomyVersion: 'synthetic-2026', importedAt: '2026-11-17T12:00:00.000Z' };

export const csv = (rows: string[]) => 'Submission ID,Common Name,Scientific Name,Count,Date\n' + rows.join('\n');
