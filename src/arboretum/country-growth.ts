import type { Collection, SpeciesObservation } from '../types';
import { observationsForPeriod } from './history';
import { buildGrowthTimeline, codesThroughEvent, type GrowthEvent, type GrowthTimeline } from './growth';

export interface CountryGrowthPanel {
  key: string;
  countryCode: string | null;
  name: string;
  observations: SpeciesObservation[];
  timeline: GrowthTimeline;
  /** The fixed dated layout scope, independent of the currently selected date. */
  finalCodes: Set<string>;
}

export interface CountryGrowthFrame {
  /** Stable while a country has no further additions; callers must not mutate. */
  revealedCodes: Set<string>;
  /** Only additions on this exact shared date, never the preceding local date. */
  newCodes: Set<string>;
}

interface PanelIndex {
  additions: Set<string>[];
  empty: Set<string>;
  lastIndex: number;
  revealed: Set<string>;
}
const panelIndexes = new WeakMap<CountryGrowthPanel, PanelIndex>();
const compareCountry = new Intl.Collator('en', {sensitivity:'base',numeric:true});

function makePanel(collection: Collection, countryCode: string | null, name: string, year?: number | null): CountryGrowthPanel {
  const observations=observationsForPeriod(collection,{countryCode,year,mode:'cumulative'});
  const timeline=buildGrowthTimeline(observations,year);
  return {key:countryCode===null?'combined':`country:${countryCode}`,countryCode,name,observations,timeline,finalCodes:codesThroughEvent(timeline,timeline.events.length-1)};
}

/**
 * A shared calendar includes first sightings in every country, even when the
 * same species was already recorded elsewhere. Main-tree counts remain unique
 * combined species; activityCount measures additions across the displayed trees.
 * Undated-only countries remain visible, with zero dated birds and their
 * timeline's undated count. Only empty country/period intersections are omitted.
 */
export function buildCountryGrowth(collection: Collection, {year, includeCountries = true}: {year?:number|null;includeCountries?:boolean} = {}): {timeline:GrowthTimeline;panels:CountryGrowthPanel[]} {
  const combined=makePanel(collection,null,'All countries',year);
  if(!includeCountries)return {timeline:combined.timeline,panels:[combined]};
  const countries=[...(collection.countries||[])].sort((a,b)=>compareCountry.compare(a.name,b.name)||a.code.localeCompare(b.code));
  const panels=[combined,...countries.map(country=>makePanel(collection,country.code,country.name,year)).filter(panel=>panel.observations.length>0)];
  const byDate=new Map<string,{codes:string[];activityCount:number}>();
  for(const panel of panels)for(const event of panel.timeline.events){
    const shared=byDate.get(event.date)||{codes:[],activityCount:0};
    if(panel.countryCode===null)shared.codes.push(...event.codes);
    shared.activityCount+=event.codes.length;
    byDate.set(event.date,shared);
  }
  let total=0;
  const events:Array<GrowthEvent&{activityCount:number}>=[...byDate].sort(([a],[b])=>a.localeCompare(b)).map(([date,activity])=>{
    total+=activity.codes.length;
    return {date,codes:activity.codes,total,activityCount:activity.activityCount};
  });
  return {panels,timeline:{...combined.timeline,events,firstDate:events[0]?.date||null,lastDate:events.at(-1)?.date||null}};
}

/** Binary-search a country's local timeline and grow only its new prefix. */
export function countryGrowthFrame(panel: CountryGrowthPanel, sharedDate: string | null): CountryGrowthFrame {
  let index=panelIndexes.get(panel);
  if(!index){
    const empty=new Set<string>();
    index={additions:panel.timeline.events.map(event=>new Set(event.codes)),empty,lastIndex:-1,revealed:empty};
    panelIndexes.set(panel,index);
  }
  const events=panel.timeline.events;
  let low=0,high=events.length;
  if(sharedDate!==null)while(low<high){const middle=(low+high)>>>1;if(events[middle].date<=sharedDate)low=middle+1;else high=middle;}
  const current=sharedDate===null?-1:low-1;
  if(current!==index.lastIndex){
    const revealed=current>index.lastIndex?new Set(index.revealed):new Set<string>();
    for(let i=current>index.lastIndex?index.lastIndex+1:0;i<=current;i++)for(const code of events[i].codes)revealed.add(code);
    index.lastIndex=current;index.revealed=revealed;
  }
  return {revealedCodes:index.revealed,newCodes:current>=0&&events[current].date===sharedDate?index.additions[current]:index.empty};
}
