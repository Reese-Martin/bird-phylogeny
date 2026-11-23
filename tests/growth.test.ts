import {afterEach,describe,expect,it,vi} from 'vitest';
import type {SpeciesObservation} from '../src/types';
import {buildGrowthTimeline,clampGrowthIndex,codesThroughEvent,growthStepDelay,growthTransitionDuration,growthEventDelay,growthEventTransitionDuration,nextGrowthIndex,scheduleGrowthStep} from '../src/arboretum/growth';

const observation=(code:string,date:string|null):SpeciesObservation=>({code,earliestDate:date,originalNames:[code],checklistCount:1,recordCount:1,missingDateCount:date?0:1,historicalDateCount:0});
const withAdditions=(sizes:number[])=>buildGrowthTimeline(sizes.flatMap((size,index)=>Array.from({length:size},(_,bird)=>observation(`${index}-${bird}`,`2024-01-${String(index+1).padStart(2,'0')}`))));
afterEach(()=>vi.useRealTimers());

describe('first-recorded growth chronology',()=>{
  it('groups simultaneous additions, sorts dates and species deterministically, and leaves inputs intact',()=>{
    const input=[observation('late','2024-12-31'),observation('b','2023-03-02'),observation('a','2023-03-02'),observation('first','2022-01-01')];
    const before=JSON.stringify(input),timeline=buildGrowthTimeline(input);
    expect(timeline.events).toEqual([{date:'2022-01-01',codes:['first'],total:1},{date:'2023-03-02',codes:['a','b'],total:3},{date:'2024-12-31',codes:['late'],total:4}]);
    expect(timeline).toMatchObject({datedCount:4,undatedCount:0,totalSpecies:4,firstDate:'2022-01-01',lastDate:'2024-12-31'});
    expect(buildGrowthTimeline([...input].reverse())).toEqual(timeline);expect(JSON.stringify(input)).toBe(before);
  });
  it('deduplicates species at their earliest valid date, including when an unknown date appears first',()=>{
    const timeline=buildGrowthTimeline([observation('bird',null),observation('bird','2024-03-01'),observation('bird','2023-12-31'),observation('bird','2023-12-31'),observation('other',null),observation('other','1900-01-01')]);
    expect(timeline.events).toEqual([{date:'2023-12-31',codes:['bird'],total:1}]);expect(timeline.totalSpecies).toBe(2);expect(timeline.undatedCount).toBe(1);
  });
  it('excludes unresolved identifications, invalid dates and the historical placeholder without inventing their timing',()=>{
    const timeline=buildGrowthTimeline([observation('unresolved:unknown','2024-02-29'),observation('','2024-01-01'),observation('missing',null),observation('invalid','2023-02-29'),observation('historical','1900-01-01'),observation('leap','2024-02-29'),observation('valid-1900','1900-01-02')]);
    expect(timeline.events.map(event=>[event.date,event.codes])).toEqual([['1900-01-02',['valid-1900']],['2024-02-29',['leap']]]);
    expect(timeline).toMatchObject({totalSpecies:5,datedCount:2,undatedCount:3});
  });
  it('uses supplied country-first dates and includes real species without a source placement',()=>{
    const global=buildGrowthTimeline([observation('shared','2021-01-01')]),country=buildGrowthTimeline([observation('shared','2024-01-01'),observation('valid-unmapped','2024-01-02')]);
    expect(global.firstDate).toBe('2021-01-01');expect(country.firstDate).toBe('2024-01-01');expect(country.datedCount).toBe(2);expect(codesThroughEvent(country,1)).toEqual(new Set(['shared','valid-unmapped']));
  });
  it('respects a calendar-year endpoint and accounts for undated and later species separately',()=>{
    const timeline=buildGrowthTimeline([observation('early','2024-12-31'),observation('late','2025-01-01'),observation('unknown',null)],2024);
    expect(timeline).toMatchObject({datedCount:1,totalSpecies:3,undatedCount:1,excludedAfterEndCount:1,lastDate:'2024-12-31'});
    for(const year of [2024.5,NaN,999,10000])expect(()=>buildGrowthTimeline([],year)).toThrow('calendar year');
  });
  it('starts blank, grows monotonically by additions and has safe empty and final endpoints',()=>{
    const timeline=buildGrowthTimeline([observation('a','2022-01-01'),observation('b','2022-01-02'),observation('c','2022-01-02')]);
    expect(codesThroughEvent(timeline,-1).size).toBe(0);expect(codesThroughEvent(timeline,0)).toEqual(new Set(['a']));expect(codesThroughEvent(timeline,99)).toEqual(new Set(['a','b','c']));
    expect(nextGrowthIndex(timeline,-1)).toBe(0);expect(nextGrowthIndex(timeline,1)).toBeNull();expect(nextGrowthIndex(buildGrowthTimeline([]),-1)).toBeNull();
    expect(clampGrowthIndex(NaN,2)).toBe(-1);expect(clampGrowthIndex(1.9,2)).toBe(1);expect(clampGrowthIndex(Infinity,2)).toBe(1);
  });
});

describe('bounded growth playback scheduling',()=>{
  it('targets a watchable full list and leaves sparse country additions perceptible',()=>{
    expect(growthStepDelay(1,170)).toBe(320);expect(growthStepDelay(1,8)).toBe(1200);expect(growthStepDelay(4,8)).toBe(300);expect(growthStepDelay(.5,1000)).toBe(640);expect(growthStepDelay(0,170)).toBe(320);
  });
  it('finishes every growing stroke before its next date across all speeds and collection sizes',()=>{
    for(const speed of [.5,1,2,4])for(const count of [0,1,8,79,170,1000,NaN]){
      const step=growthStepDelay(speed,count),transition=growthTransitionDuration(speed,count);
      expect(Number.isFinite(transition)).toBe(true);expect(transition).toBeGreaterThan(0);
      expect(transition).toBeLessThan(step);expect(transition/step).toBeCloseTo(.9,1);
    }
    expect(growthTransitionDuration(1,170)).toBe(288);
  });
  it('advances one date per timer, then lets the final date finish before completing once',()=>{
    vi.useFakeTimers();const timeline=buildGrowthTimeline([observation('a','2024-01-01'),observation('b','2024-01-02')]),advance=vi.fn(),complete=vi.fn();
    const cancel=scheduleGrowthStep({timeline,index:0,speed:1,onAdvance:advance,onComplete:complete});
    vi.advanceTimersByTime(209);expect(advance).not.toHaveBeenCalled();vi.advanceTimersByTime(1);expect(advance).toHaveBeenCalledExactlyOnceWith(1);expect(complete).not.toHaveBeenCalled();
    cancel();const finish=scheduleGrowthStep({timeline,index:1,speed:1,onAdvance:advance,onComplete:complete});
    vi.advanceTimersByTime(growthEventTransitionDuration(timeline,1,1));expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(growthEventDelay(timeline,1,1)-growthEventTransitionDuration(timeline,1,1));expect(complete).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(10000);expect(advance).toHaveBeenCalledOnce();expect(complete).toHaveBeenCalledOnce();finish();expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels obsolete date/scope steps and ignores stale callbacks after a seek or pause',()=>{
    vi.useFakeTimers();const timeline=buildGrowthTimeline([observation('a','2024-01-01'),observation('b','2024-01-02')]),advance=vi.fn(),complete=vi.fn();
    const cancel=scheduleGrowthStep({timeline,index:-1,speed:1,onAdvance:advance,onComplete:complete});cancel();vi.advanceTimersByTime(2000);expect(advance).not.toHaveBeenCalled();
    let current=true;scheduleGrowthStep({timeline,index:-1,speed:1,onAdvance:advance,onComplete:complete,isCurrent:()=>current});current=false;vi.advanceTimersByTime(2000);expect(advance).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('handles empty timelines immediately without leaving a timer',()=>{
    vi.useFakeTimers();const advance=vi.fn(),complete=vi.fn();
    scheduleGrowthStep({timeline:buildGrowthTimeline([]),index:-1,speed:1,onAdvance:advance,onComplete:complete});expect(complete).toHaveBeenCalledOnce();expect(advance).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
  it('cancels a final-frame hold on pause or scope changes without reporting completion',()=>{
    vi.useFakeTimers();const timeline=buildGrowthTimeline([observation('a','2024-01-01')]),advance=vi.fn(),complete=vi.fn();
    const cancel=scheduleGrowthStep({timeline,index:0,speed:1,onAdvance:advance,onComplete:complete});
    vi.advanceTimersByTime(100);cancel();vi.advanceTimersByTime(2000);expect(complete).not.toHaveBeenCalled();
    let current=true;scheduleGrowthStep({timeline,index:0,speed:1,onAdvance:advance,onComplete:complete,isCurrent:()=>current});current=false;
    vi.advanceTimersByTime(2000);expect(complete).not.toHaveBeenCalled();expect(advance).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });
});

describe('addition-weighted pacing',()=>{
  it('gives a burst more time while preserving its character and reducing addition-rate contrast',()=>{
    const timeline=withAdditions([1,40]);
    const quiet=growthEventDelay(timeline,0,1),burst=growthEventDelay(timeline,1,1);
    expect(quiet).toBe(210);expect(burst).toBeGreaterThan(1000);expect(burst).toBeLessThan(1600);
    expect(burst).toBeGreaterThan(quiet*4);
    const rateContrast=(40/burst)/(1/quiet);
    expect(rateContrast).toBeGreaterThan(1);expect(rateContrast).toBeLessThan(8);
    expect(quiet).toBeLessThan(growthStepDelay(1,170));
  });

  it('scales all date weights with speed and spends almost the entire interval growing',()=>{
    const timeline=withAdditions([1,2,8,40,1000]);
    for(let index=0;index<timeline.events.length;index++)for(const speed of [.5,1,2,4]){
      const delay=growthEventDelay(timeline,index,speed),transition=growthEventTransitionDuration(timeline,index,speed);
      expect(Math.abs(delay-Math.round(growthEventDelay(timeline,index,1)/speed))).toBeLessThanOrEqual(1);
      expect(transition).toBeGreaterThan(0);expect(transition).toBeLessThan(delay);
      expect(transition/delay).toBeGreaterThanOrEqual(.97);
    }
    expect(growthEventDelay(timeline,4,1)).toBe(2200);
    expect(growthEventDelay(timeline,0,NaN)).toBe(growthEventDelay(timeline,0,1));
  });

  it('counts country-only activity even when the combined life list adds no new species',()=>{
    const timeline=withAdditions([1,1]);timeline.events[1]={...timeline.events[1],codes:[],activityCount:40};
    expect(growthEventDelay(timeline,1,1)).toBe(growthEventDelay(withAdditions([40]),0,1));
    timeline.events[1].activityCount=NaN;expect(growthEventDelay(timeline,1,1)).toBe(160);
    timeline.events[1].activityCount=-5;expect(growthEventDelay(timeline,1,1)).toBe(160);
    timeline.events[1].activityCount=0;expect(growthEventDelay(timeline,1,1)).toBe(160);
  });

  it('starts promptly and ignores calendar gaps without changing event membership or dates',()=>{
    const timeline=withAdditions([1,3]),before=structuredClone(timeline);
    expect(growthEventDelay(timeline,-1,1)).toBe(120);expect(growthEventDelay(timeline,-1,4)).toBe(30);
    const distant=structuredClone(timeline);distant.events[1].date='2034-01-02';
    expect(growthEventDelay(distant,1,1)).toBe(growthEventDelay(timeline,1,1));
    growthEventTransitionDuration(timeline,1,1);expect(timeline).toEqual(before);
  });

  it('holds each current event for its own activity duration, not the upcoming event weight',()=>{
    vi.useFakeTimers();const timeline=withAdditions([1,40]),advance=vi.fn(),complete=vi.fn();
    const cancel=scheduleGrowthStep({timeline,index:0,speed:1,onAdvance:advance,onComplete:complete});
    vi.advanceTimersByTime(210);expect(advance).toHaveBeenCalledExactlyOnceWith(1);expect(complete).not.toHaveBeenCalled();cancel();
    scheduleGrowthStep({timeline,index:1,speed:1,onAdvance:advance,onComplete:complete});
    vi.advanceTimersByTime(210);expect(complete).not.toHaveBeenCalled();
    vi.advanceTimersByTime(growthEventDelay(timeline,1,1)-210);expect(complete).toHaveBeenCalledOnce();
  });
});
