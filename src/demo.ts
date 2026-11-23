import type { Collection, Taxon } from './types';

const favorites = [
  'baleag', 'annhum', 'amerob', 'norcar', 'blujay', 'mallar3', 'rewbla', 'grbher3',
  'amecro', 'houspa', 'mourdo', 'dowwoo', 'amegfi', 'cedwax', 'belkin1', 'rebwoo',
  'osprey', 'sancra', 'killde', 'calqua', 'acowoo', 'wesscr1', 'norfli', 'yerwar',
];

export function makeDemo(taxa: Taxon[], datasetVersion: string, taxonomyVersion: string): Collection {
  const speciesTaxa = taxa.filter(t => t.category === 'species' && t.treeTip !== undefined);
  const preferred = favorites.map(code => speciesTaxa.find(t => t.code === code)).filter((t): t is Taxon => !!t);
  const illustrated = speciesTaxa.filter(t => t.sticker && !preferred.some(p => p.code === t.code));
  const chosen = [...preferred, ...illustrated].slice(0, 24);
  if (chosen.length < 24) {
    for (const t of speciesTaxa.filter((_, i) => i % 419 === 0)) {
      if (!chosen.some(p => p.code === t.code)) chosen.push(t);
      if (chosen.length === 24) break;
    }
  }
  const species = chosen.map((t, i) => ({
    code: t.code, originalNames: [t.scientificName], earliestDate: `${2022+i%3}-${String(i % 9 + 1).padStart(2, '0')}-${String(i % 24 + 1).padStart(2, '0')}`,
    checklistCount: 2 + (i * 7) % 37, recordCount: 2 + (i * 7) % 37, missingDateCount: 0, historicalDateCount: 0,
  }));
  const totalRecords = species.reduce((n, s) => n + s.recordCount, 0);
  const countries = [{code:'US',name:'United States'},{code:'ZA',name:'South Africa'}].map(country=>({...country,species:species.filter(observation=>(chosen.find(t=>t.code===observation.code)?.order==='Struthioniformes'?'ZA':'US')===country.code)})).filter(country=>country.species.length);
  const years = [...new Set(species.map(observation=>Number(observation.earliestDate.slice(0,4))))].sort().map(year=>{
    const annual=species.filter(observation=>Number(observation.earliestDate.slice(0,4))===year), cumulative=species.filter(observation=>Number(observation.earliestDate.slice(0,4))<=year);
    const scopeCountries=(codes:Set<string>)=>countries.map(country=>({...country,species:country.species.filter(observation=>codes.has(observation.code))})).filter(country=>country.species.length);
    return{year,species:annual,countries:scopeCountries(new Set(annual.map(observation=>observation.code))),cumulative:{species:cumulative,countries:scopeCountries(new Set(cumulative.map(observation=>observation.code)))}};
  });
  return {
    schemaVersion: 1, datasetVersion, taxonomyVersion, label: 'Sample collection', importedAt: '2026-11-17T12:00:00.000Z', isDemo: true, species, countries, years,
    report: {
      totalRecords, acceptedRecords: totalRecords, excludedRecords: 0, invalidDateRecords: 0,
      missingDateRecords: 0, historicalDateRecords: 0, duplicateRecords: 0, unresolvedRecords: 0,countryUnassignedRecords:0,
      issues: [], mappedSpecies: species.length, unmappedSpecies: 0,
      sourceTipCount: new Set(chosen.flatMap(t => t.treeTips || [t.treeTip])).size, artworkGaps: chosen.filter(t => !t.sticker).length,
    },
  };
}
