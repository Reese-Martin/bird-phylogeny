import {describe,expect,it} from 'vitest';
import type {Collection,CountryCollection,SpeciesObservation} from '../src/types';
import {buildCountryGrowth,countryGrowthFrame} from '../src/arboretum/country-growth';

const observation=(code:string,date:string|null):SpeciesObservation=>({code,earliestDate:date,originalNames:[code],checklistCount:1,recordCount:1,missingDateCount:date?0:1,historicalDateCount:0});
const country=(code:string,name:string,species:SpeciesObservation[]):CountryCollection=>({code,name,species});
const collection=(species:SpeciesObservation[],countries:CountryCollection[]=[]):Collection=>({
  schemaVersion:1,datasetVersion:'test',taxonomyVersion:'2026',label:'Test',importedAt:'2026-01-01',species,countries,
  report:{totalRecords:0,acceptedRecords:0,excludedRecords:0,invalidDateRecords:0,missingDateRecords:0,historicalDateRecords:0,duplicateRecords:0,unresolvedRecords:0,issues:[],mappedSpecies:0,unmappedSpecies:0,sourceTipCount:0,artworkGaps:0},
});
const fixture=()=>collection([observation('shared','2022-01-01'),observation('second','2024-01-01'),observation('unassigned','2025-01-01')],[
  country('US','United States',[observation('shared','2022-01-01')]),
  country('CA','Canada',[observation('shared','2023-01-01'),observation('second','2024-01-01')]),
]);

describe('shared country growth calendar',()=>{
  it('exports the standalone life list on its own calendar, including sightings without a country',()=>{
    const data=fixture();
    const result=buildCountryGrowth(data,{includeCountries:false});
    expect(result.panels.map(panel=>panel.countryCode)).toEqual([null]);
    expect(result.timeline).toBe(result.panels[0].timeline);
    expect(result.timeline.events.map(event=>event.date)).toEqual(['2022-01-01','2024-01-01','2025-01-01']);
    expect(result.panels[0].finalCodes).toEqual(new Set(['shared','second','unassigned']));
    const through2024=buildCountryGrowth(data,{includeCountries:false,year:2024});
    expect(through2024.timeline.datedCount).toBe(2);
    expect(through2024.timeline.lastDate).toBe('2024-01-01');
  });

  it('retains country-only first-seen dates without adding the species again to the main tree',()=>{
    const result=buildCountryGrowth(fixture());
    expect(result.panels.map(panel=>[panel.key,panel.name])).toEqual([['combined','All countries'],['country:CA','Canada'],['country:US','United States']]);
    expect(result.timeline.events).toEqual([
      {date:'2022-01-01',codes:['shared'],total:1,activityCount:2},
      {date:'2023-01-01',codes:[],total:1,activityCount:1},
      {date:'2024-01-01',codes:['second'],total:2,activityCount:2},
      {date:'2025-01-01',codes:['unassigned'],total:3,activityCount:1},
    ]);
    expect(result.timeline.datedCount).toBe(3);
    expect(result.panels[0].finalCodes).toEqual(new Set(['shared','second','unassigned']));
    expect(result.panels[1].finalCodes).toEqual(new Set(['shared','second']));
  });

  it('uses country dates independently, reuses quiet membership, and supports backwards seeking without mutating old frames',()=>{
    const canada=buildCountryGrowth(fixture()).panels[1];
    expect(countryGrowthFrame(canada,null).revealedCodes.size).toBe(0);
    expect(countryGrowthFrame(canada,'2022-01-01').revealedCodes.size).toBe(0);
    const first=countryGrowthFrame(canada,'2023-01-01');
    expect(first.revealedCodes).toEqual(new Set(['shared']));expect(first.newCodes).toEqual(new Set(['shared']));
    const quiet=countryGrowthFrame(canada,'2023-12-31');
    expect(quiet.revealedCodes).toBe(first.revealedCodes);expect(quiet.newCodes.size).toBe(0);
    const last=countryGrowthFrame(canada,'2025-01-01');
    expect(last.revealedCodes).toEqual(new Set(['shared','second']));expect(last.newCodes.size).toBe(0);
    expect(first.revealedCodes).toEqual(new Set(['shared']));
    expect(countryGrowthFrame(canada,'2023-01-01').revealedCodes).toEqual(new Set(['shared']));
    expect(last.revealedCodes).toEqual(new Set(['shared','second']));
    expect(countryGrowthFrame(canada,null).revealedCodes.size).toBe(0);
  });

  it('keeps same-day groups simultaneous and deduplicates each local species at its earliest valid date',()=>{
    const data=collection([observation('b','2024-02-29'),observation('a','2024-02-29'),observation('a','2024-03-01')],[country('CA','Canada',[observation('a',null),observation('a','2024-02-29'),observation('b','2024-02-29')])]);
    const result=buildCountryGrowth(data);
    expect(result.timeline.events).toEqual([{date:'2024-02-29',codes:['a','b'],total:2,activityCount:4}]);
    const frame=countryGrowthFrame(result.panels[1],'2024-02-29');
    expect(frame.newCodes).toEqual(new Set(['a','b']));expect(frame.revealedCodes.size).toBe(2);
  });

  it('applies legacy cumulative cutoffs to both main and local first-seen dates',()=>{
    const result=buildCountryGrowth(fixture(),{year:2022});
    expect(result.timeline.events.map(event=>event.date)).toEqual(['2022-01-01']);
    expect(result.panels.map(panel=>panel.countryCode)).toEqual([null,'US']);
    expect(result.panels[0].finalCodes).toEqual(new Set(['shared']));
    expect(()=>buildCountryGrowth(fixture(),{year:2022.5})).toThrow('calendar year');
  });

  it('uses exact cumulative yearly snapshots instead of annual membership',()=>{
    const data=fixture();
    data.years=[
      {year:2022,species:[observation('shared','2022-01-01')],countries:[country('US','United States',[observation('shared','2022-01-01')])],cumulative:{species:[observation('shared','2022-01-01')],countries:[country('US','United States',[observation('shared','2022-01-01')])]}},
      {year:2023,species:[observation('shared','2023-01-01')],countries:[country('CA','Canada',[observation('shared','2023-01-01')])],cumulative:{species:[observation('shared','2022-01-01')],countries:[country('US','United States',[observation('shared','2022-01-01')]),country('CA','Canada',[observation('shared','2023-01-01')])]}}
    ];
    const result=buildCountryGrowth(data,{year:2023});
    expect(result.timeline.datedCount).toBe(1);
    expect(result.timeline.events.map(event=>[event.date,event.codes])).toEqual([['2022-01-01',['shared']],['2023-01-01',[]]]);
    expect(result.panels.map(panel=>panel.countryCode)).toEqual([null,'CA','US']);
  });

  it('keeps undated-only countries visible while excluding invented dates and unresolved rows from animation',()=>{
    const observations=[observation('missing',null),observation('historical','1900-01-01'),observation('invalid','2023-02-29'),observation('unresolved:unknown','2024-01-01')];
    const result=buildCountryGrowth(collection(observations,[country('CA','Canada',observations),country('US','United States',[])]));
    expect(result.panels.map(panel=>panel.countryCode)).toEqual([null,'CA']);
    expect(result.timeline).toMatchObject({events:[],datedCount:0,undatedCount:3,totalSpecies:3,firstDate:null,lastDate:null});
    expect(result.panels[1].timeline.undatedCount).toBe(3);
    expect(result.panels[1].finalCodes.size).toBe(0);
    expect(countryGrowthFrame(result.panels[1],'2026-01-01').revealedCodes.size).toBe(0);
  });

  it('retains final counts and source immutability, with deterministic country order',()=>{
    const data=fixture(),before=structuredClone(data),result=buildCountryGrowth(data);
    for(const panel of result.panels){
      expect(countryGrowthFrame(panel,result.timeline.lastDate).revealedCodes).toEqual(panel.finalCodes);
      countryGrowthFrame(panel,null);
      expect(panel.finalCodes.size).toBe(panel.timeline.datedCount);
    }
    expect(data).toEqual(before);
    expect(buildCountryGrowth({...data,countries:[...data.countries!].reverse()}).panels.map(panel=>panel.key)).toEqual(result.panels.map(panel=>panel.key));
  });

  it('always includes the main panel for an empty collection without scheduling invented events',()=>{
    const result=buildCountryGrowth(collection([]));
    expect(result.panels).toHaveLength(1);expect(result.panels[0].countryCode).toBeNull();
    expect(result.timeline.events).toEqual([]);expect(result.timeline.datedCount).toBe(0);
  });
});
