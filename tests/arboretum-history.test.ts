import 'fake-indexeddb/auto';
import {describe,expect,it} from 'vitest';
import {parseCsv} from '../src/import/aggregate';
import {availableYears,observationsForPeriod,periodCountsAreExact,undatedRecordCount,undatedSpeciesCount,yearHistoryAvailable} from '../src/arboretum/history';
import {parseBackup,serializeBackup,saveCollection,loadCollection,clearCollection} from '../src/storage/collection';
import {makeDemo} from '../src/demo';
import type {Collection,Taxon} from '../src/types';
import {testTaxa,testVersions} from './fixtures/taxa';

const source=()=>parseCsv('Submission ID,Common Name,Scientific Name,Count,Date,Country,Latitude,Longitude,Location,Observation Details\n'+[
  'PRIVATE-CHECKLIST-A,American Crow,Corvus brachyrhynchos,1,2021-12-31,US,47.123,-122.456,PRIVATE-PLACE,PRIVATE-COMMENT',
  'PRIVATE-CHECKLIST-A,American Crow,Corvus brachyrhynchos,X,2021-12-31,US',
  'PRIVATE-CHECKLIST-B,Mallard,Anas platyrhynchos,1,2021-06-01,US',
  // A deliberately reused identifier across years proves that adding yearly
  // distinct-checklist counts cannot produce exact cumulative totals.
  'PRIVATE-CHECKLIST-A,American Crow,Corvus brachyrhynchos,1,2022-01-01,CA',
  'PRIVATE-CHECKLIST-C,American Crow,Corvus brachyrhynchos,1,2022-04-01,CA',
  'PRIVATE-CHECKLIST-D,Mallard,Anas platyrhynchos,1,2022-02-01,CA',
  'PRIVATE-CHECKLIST-E,Mystery bird,Unknownus birdus,1,2022-03-01,US',
  'PRIVATE-CHECKLIST-F,Canada Jay,Perisoreus canadensis,1,2023-03-01,US',
  'PRIVATE-CHECKLIST-G,American Crow,Corvus brachyrhynchos,1,,US',
  'PRIVATE-CHECKLIST-H,Mallard,Anas platyrhynchos,1,1900-01-01,CA',
  'PRIVATE-CHECKLIST-I,American Crow,Corvus brachyrhynchos,1,not-a-date,US',
  'PRIVATE-CHECKLIST-J,Canada Jay,Perisoreus canadensis,1,2020-02-30,US',
  'PRIVATE-CHECKLIST-K,Mallard,Anas platyrhynchos,1,2024-01-01,',
  'PRIVATE-CHECKLIST-L,Saltmarsh Willet,Tringa semipalmata,1,1900-01-01,US',
  'PRIVATE-CHECKLIST-Z,American Crow,Corvus brachyrhynchos,0,2020-01-01,US',
].join('\n'),testTaxa,testVersions);
const codes=(collection:Collection,options:Parameters<typeof observationsForPeriod>[1]={})=>observationsForPeriod(collection,options).map(item=>item.code);
const change=(mutate:(collection:Collection)=>void)=>{const collection=source();mutate(collection);return()=>parseBackup(JSON.stringify(collection));};

describe('annual and cumulative collection history',()=>{
  it('uses every dated record for annual membership and exact country/year checklists',()=>{
    const collection=source();
    expect(availableYears(collection)).toEqual([2021,2022,2023,2024]);
    expect(availableYears(collection,'CA')).toEqual([2022]);
    expect(codes(collection,{year:2022,mode:'annual',countryCode:'CA'})).toEqual(['amecro','mallar']);
    expect(codes(collection,{year:2023,mode:'annual'})).toEqual(['canjay']);
    expect(codes(collection,{year:2024,mode:'annual',countryCode:'US'})).toEqual([]);
    expect(codes(collection,{year:2022,mode:'cumulative'})).toEqual(['amecro','mallar','unresolved:unknownus birdus']);
    expect(observationsForPeriod(collection,{year:2021}).find(item=>item.code==='amecro')).toMatchObject({recordCount:2,checklistCount:1,earliestDate:'2021-12-31'});
    expect(observationsForPeriod(collection,{year:2022}).find(item=>item.code==='amecro')).toMatchObject({recordCount:4,checklistCount:2,earliestDate:'2021-12-31'});
    expect(observationsForPeriod(collection,{year:2022,mode:'annual'}).find(item=>item.code==='amecro')).toMatchObject({recordCount:2,checklistCount:2,earliestDate:'2022-01-01'});
    expect(observationsForPeriod(collection,{year:2024,countryCode:'US'}).find(item=>item.code==='amecro')).toMatchObject({recordCount:2,checklistCount:1});
    expect(collection.report.duplicateRecords).toBe(2);
  });
  it('keeps unknown/historical/invalid dates in all-time totals and out of precise year views',()=>{
    const collection=source();
    expect(collection.species.reduce((sum,item)=>sum+item.recordCount,0)).toBe(14);
    expect(collection.years!.reduce((sum,year)=>sum+year.species.reduce((subtotal,item)=>subtotal+item.recordCount,0),0)).toBe(9);
    expect(undatedRecordCount(collection)).toBe(5);expect(undatedSpeciesCount(collection)).toBe(1);
    expect(codes(collection)).toContain('willet2');expect(codes(collection,{year:2024})).not.toContain('willet2');
    expect(codes(collection,{year:2020})).toEqual([]);
    expect(observationsForPeriod(collection,{countryCode:'CA'}).find(item=>item.code==='mallar')?.recordCount).toBe(2);
    expect(observationsForPeriod(collection,{countryCode:'CA',year:2024}).find(item=>item.code==='mallar')?.recordCount).toBe(1);
    expect(collection.years!.flatMap(year=>year.species).every(item=>!item.missingDateCount&&!item.historicalDateCount)).toBe(true);
    expect(periodCountsAreExact(collection,{year:2022})).toBe(true);
  });
  it('provides faithful legacy cumulative membership while declaring unavailable annual counts',()=>{
    const collection=source();delete collection.years;
    const restored=parseBackup(serializeBackup(collection));
    expect(restored.years).toBeUndefined();expect(yearHistoryAvailable(restored)).toBe(false);
    expect(codes(restored,{year:2022,mode:'cumulative'})).toEqual(['amecro','mallar','unresolved:unknownus birdus']);
    expect(codes(restored,{year:2022,mode:'annual'})).toEqual([]);
    expect(periodCountsAreExact(restored,{year:2022})).toBe(false);expect(periodCountsAreExact(restored)).toBe(true);
    expect(observationsForPeriod(restored,{year:2022}).find(item=>item.code==='amecro')?.recordCount).toBe(6);
  });
  it('handles unordered histories, empty dated collections and out-of-range years',()=>{
    const collection=source();collection.years!.reverse();
    expect(codes(collection,{year:2023})).toContain('canjay');
    expect(codes(collection,{year:NaN})).toEqual([]);expect(codes(collection,{year:2022.5})).toEqual([]);
    const undated=parseCsv('Submission ID,Common Name,Count,Date\nA,American Crow,1,',testTaxa,testVersions);
    expect(undated.years).toEqual([]);expect(yearHistoryAvailable(undated)).toBe(true);expect(availableYears(undated)).toEqual([]);
    expect(parseBackup(serializeBackup(undated))).toEqual(undated);
  });
});

describe('private normalized history backups',()=>{
  it('roundtrips annual and cumulative aggregates and saves them without raw identifiers or locations',async()=>{
    const collection=source(),json=serializeBackup(collection);
    expect(parseBackup(json)).toEqual(collection);
    expect(json).not.toMatch(/PRIVATE-|47\.123|-122\.456|latitude|longitude|location|submission id|checklistIds/i);
    await saveCollection(collection);expect(await loadCollection(testVersions)).toEqual(collection);await clearCollection();
  });
  it('rejects incomplete years, duplicate years, inconsistent prefixes and mismatched calendar dates',()=>{
    expect(change(collection=>{collection.years!.pop();})).toThrow('cover all dated');
    expect(change(collection=>{collection.years!.push(collection.years![0]);})).toThrow('valid and unique');
    expect(change(collection=>{collection.years![0].species[0].earliestDate='2020-01-01';})).toThrow('dated year');
    expect(change(collection=>{collection.years![1].cumulative.species[0].recordCount++;})).toThrow('cumulative year records');
    expect(change(collection=>{collection.years![0].cumulative.species[0].checklistCount=2;})).toThrow('cumulative checklist');
    expect(change(collection=>{collection.years![1].cumulative.species.pop();})).toThrow('country species counts');
    expect(change(collection=>{collection.years![1].cumulative.countries.pop();})).toThrow('cumulative country membership');
  });
  it('rejects raw fields and year countries which contradict their annual/global aggregates',()=>{
    expect(change(collection=>{(collection.years![0] as unknown as Record<string,unknown>).locations=['SECRET'];})).toThrow('unexpected fields');
    expect(change(collection=>{(collection.years![0].cumulative as unknown as Record<string,unknown>).checklistIds=['SECRET'];})).toThrow('unexpected fields');
    expect(change(collection=>{collection.years![1].countries[0].species[0].recordCount=1;})).toThrow('inconsistent species');
    expect(change(collection=>{collection.years![0].cumulative.countries[0].species[0].earliestDate='2022-01-01';})).toThrow('cumulative year records');
  });
});

it('gives the invented demo a consistent three-year and two-country Arboretum',()=>{
  const taxa=Array.from({length:24},(_,i)=>({code:`sample${i}`,commonName:`Sample ${i}`,scientificName:`Avis sample${i}`,category:'species',mappingStatus:'exact',treeTip:i,sticker:`/stickers/${i}.webp`,order:i<22?'Passeriformes':'Struthioniformes'} as Taxon));
  const demo=makeDemo(taxa,'sample-tree','sample-taxonomy');
  expect(demo.isDemo).toBe(true);expect(availableYears(demo)).toEqual([2022,2023,2024]);
  expect(demo.countries?.map(country=>[country.code,country.species.length])).toEqual([['US',22],['ZA',2]]);
  expect([2022,2023,2024].map(year=>observationsForPeriod(demo,{year}).length)).toEqual([8,16,24]);
  expect(parseBackup(serializeBackup(demo))).toEqual(demo);
});
