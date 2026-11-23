import {describe,expect,it} from 'vitest';
import {drawExportComposition,planExportGrid} from '../src/export/composition';
import {exportDurationPlan,sampleExportTime} from '../src/export/timeline';
import {buildGrowthTimeline,type GrowthTimeline} from '../src/arboretum/growth';
import {LIGHT_COLORS} from '../src/tree/visual-theme';
import type {SpeciesObservation} from '../src/types';

const observation=(code:string,date:string):SpeciesObservation=>({code,earliestDate:date,originalNames:[code],checklistCount:1,recordCount:1,missingDateCount:0,historicalDateCount:0});
const timeline=buildGrowthTimeline([observation('a','2023-01-01'),observation('b','2024-01-01'),observation('c','2024-01-01')]);

describe('all-country export composition',()=>{
  it('uses four by two video cards and three by three GIF cards, retaining all eight',()=>{
    const video=planExportGrid(8,1280),gif=planExportGrid(8,800);
    expect(video).toMatchObject({width:1280,columns:4,rows:2});expect(gif).toMatchObject({width:800,columns:3,rows:3});
    expect(video.cards).toHaveLength(8);expect(gif.cards).toHaveLength(8);
    expect(new Set(video.cards.map(card=>`${card.width}:${card.height}`)).size).toBe(1);
  });
  it('keeps one through 251 trees inside bounded, nonoverlapping export canvases',()=>{
    // Cover row boundaries and world-sized sets without repeating every layout assertion 502 times.
    for(const width of [800,1280])for(const count of [1,2,3,4,7,8,9,15,16,17,31,32,33,64,100,150,200,250,251]){
      const plan=planExportGrid(count,width);
      expect(plan.width).toBeLessThanOrEqual(4096);expect(plan.height).toBeLessThanOrEqual(4096);expect(plan.width*plan.height).toBeLessThanOrEqual(12000000);
      expect(plan.width%2).toBe(0);expect(plan.height%2).toBe(0);expect(plan.cards).toHaveLength(count);
      for(let index=0;index<plan.cards.length;index++){
        const card=plan.cards[index];
        expect(card.x).toBeGreaterThanOrEqual(plan.margin);expect(card.y).toBeGreaterThanOrEqual(plan.header.y+plan.header.height);
        expect(card.x+card.width).toBeLessThanOrEqual(plan.width-plan.margin+.001);expect(card.y+card.height).toBeLessThanOrEqual(plan.footer.y);
        expect(card.art.x).toBeGreaterThan(card.x);expect(card.art.y).toBeGreaterThan(card.y);expect(card.art.width).toBeGreaterThan(0);expect(card.art.height).toBeGreaterThan(0);
        if(index%plan.columns)expect(card.x).toBeGreaterThan(plan.cards[index-1].x+plan.cards[index-1].width);
        if(index>=plan.columns)expect(card.y).toBeGreaterThan(plan.cards[index-plan.columns].y+plan.cards[index-plan.columns].height);
      }
    }
  });
  it('rejects unusable dimensions and unbounded panel counts clearly',()=>{
    for(const count of [0,-1,1.5,NaN,1001])expect(()=>planExportGrid(count)).toThrow('trees');
    for(const width of [0,479,4097,NaN,Infinity])expect(()=>planExportGrid(8,width)).toThrow('width');
  });
  it('draws every panel once with its bounded native viewport, restores transforms after failures',()=>{
    const calls:Array<{method:string,args:any[]}>=[],stack:any[]=[];
    const ctx=new Proxy({},{get:(_target,key)=>key==='measureText'?(text:string)=>({width:text.length*5}):(...args:any[])=>{calls.push({method:String(key),args});if(key==='save')stack.push(1);if(key==='restore')stack.pop();},set:()=>true}) as CanvasRenderingContext2D;
    const plan=planExportGrid(8),draws:Array<{width:number,height:number}>=[];
    const options={title:'Birds&trees',date:'2026-01-01',colors:LIGHT_COLORS,credits:'Tree and illustration credits retained.',panels:plan.cards.map((_card,index)=>({name:`Country ${index}`,count:index,total:100,draw:(_ctx:CanvasRenderingContext2D,width:number,height:number)=>draws.push({width,height})}))};
    drawExportComposition(ctx,plan,options);
    expect(draws).toEqual(plan.cards.map(card=>({width:card.art.width,height:card.art.height})));expect(stack).toEqual([]);
    expect(calls.some(call=>call.method==='fillText'&&call.args[0]==='Tree and illustration credits retained.')).toBe(true);
    expect(()=>drawExportComposition(ctx,plan,{...options,panels:[]})).toThrow('count');
    const failure={...options,panels:options.panels.map((panel,index)=>index?panel:{...panel,draw:()=>{throw new Error('draw failed');}})};
    expect(()=>drawExportComposition(ctx,plan,failure)).toThrow('draw failed');expect(stack).toEqual([]);
  });
});

describe('duration-normalized export timeline',()=>{
  it('includes a blank lead and final completed hold within the selected length',()=>{
    const plan=exportDurationPlan(timeline,30000);
    expect(plan).toMatchObject({durationMs:30000,leadMs:300,finalHoldMs:1000,animationEndMs:29000});
    expect(sampleExportTime(plan,0)).toMatchObject({index:-1,date:null,progress:1,total:0,complete:false});
    expect(sampleExportTime(plan,299).index).toBe(-1);expect(sampleExportTime(plan,300)).toMatchObject({index:0,progress:0,date:'2023-01-01'});
    expect(sampleExportTime(plan,29000)).toMatchObject({index:1,progress:1,total:3,holdingFinal:true,complete:false});
    expect(sampleExportTime(plan,30000)).toMatchObject({index:1,progress:1,total:3,complete:true});
  });
  it('retains activity weighting, country-only dates, source membership and exact span boundaries',()=>{
    const shared:GrowthTimeline={...timeline,events:[timeline.events[0],{date:'2023-06-01',codes:[],total:1,activityCount:40},timeline.events[1]]};
    const before=JSON.stringify(shared),plan=exportDurationPlan(shared,15000);
    expect(plan.events).toHaveLength(3);expect(plan.events[1].endMs-plan.events[1].startMs).toBeGreaterThan((plan.events[0].endMs-plan.events[0].startMs)*4);
    expect(sampleExportTime(plan,plan.events[1].startMs)).toMatchObject({index:1,date:'2023-06-01',codes:[],total:1,progress:0});
    expect(sampleExportTime(plan,plan.events[1].startMs+plan.events[1].transitionMs/2).progress).toBeCloseTo(.5);
    expect(sampleExportTime(plan,plan.events[0].endMs).index).toBe(1);expect(JSON.stringify(shared)).toBe(before);
    expect(plan.events[0].codes).not.toBe(shared.events[0].codes);
  });
  it('samples monotonically at video and GIF rates, reaches every final species and supports backward random access',()=>{
    for(const duration of [15000,30000,60000])for(const fps of [12,24]){
      const plan=exportDurationPlan(timeline,duration);let previousIndex=-1,previousProgress=1;
      for(let frame=0;frame<=Math.ceil(duration/1000*fps);frame++){
        const sample=sampleExportTime(plan,frame*1000/fps);
        expect(sample.index).toBeGreaterThanOrEqual(previousIndex);
        if(sample.index===previousIndex)expect(sample.progress).toBeGreaterThanOrEqual(previousProgress);
        expect(sample.progress).toBeGreaterThanOrEqual(0);expect(sample.progress).toBeLessThanOrEqual(1);
        previousIndex=sample.index;previousProgress=sample.progress;
      }
      expect(sampleExportTime(plan,duration)).toMatchObject({total:3,index:1,progress:1});
      expect(sampleExportTime(plan,0).index).toBe(-1);
    }
  });
  it('handles empty and clamped endpoints without inventing a dated addition',()=>{
    const empty=exportDurationPlan(buildGrowthTimeline([]),15000);
    expect(sampleExportTime(empty,15000)).toMatchObject({index:-1,date:null,total:0,complete:true});
    const plan=exportDurationPlan(timeline,15000);
    expect(sampleExportTime(plan,Infinity)).toMatchObject({index:1,total:3,progress:1,complete:true});
    for(const time of [-Infinity,-1,NaN])expect(sampleExportTime(plan,time).index).toBe(-1);
    for(const duration of [0,1499,NaN,Infinity,600001])expect(()=>exportDurationPlan(timeline,duration)).toThrow('duration');
  });
});
