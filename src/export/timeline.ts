import {growthEventDelay,type GrowthTimeline} from '../arboretum/growth';

export interface ExportEventSpan {
  index:number;
  date:string;
  codes:readonly string[];
  total:number;
  startMs:number;
  endMs:number;
  transitionMs:number;
}

export interface ExportDurationPlan {
  durationMs:number;
  leadMs:number;
  finalHoldMs:number;
  animationEndMs:number;
  events:readonly ExportEventSpan[];
}

export interface ExportTimeSample {
  index:number;
  date:string|null;
  /** Smoothstep-eased progress, ready for the same branch renderer as live playback. */
  progress:number;
  /** Species added on this date to the combined tree; country-only dates may be empty. */
  codes:readonly string[];
  total:number;
  holdingFinal:boolean;
  complete:boolean;
}

const emptyCodes:readonly string[]=Object.freeze([]);
const clamp=(value:number)=>Math.max(0,Math.min(1,value));

/** Scale the existing activity weights to a fixed export length, skipping no source dates. */
export function exportDurationPlan(timeline:GrowthTimeline,targetMs:number):ExportDurationPlan {
  if(!Number.isFinite(targetMs)||targetMs<1500||targetMs>600000)throw new Error('Choose an animation duration between 1.5 seconds and 10 minutes.');
  const durationMs=Math.round(targetMs),leadMs=300,finalHoldMs=1000;
  const animationEndMs=durationMs-finalHoldMs;
  if(!timeline.events.length)return{durationMs,leadMs,finalHoldMs,animationEndMs,events:[]};
  const weights=timeline.events.map((_event,index)=>growthEventDelay(timeline,index,1));
  const sum=weights.reduce((total,value)=>total+value,0),activeMs=animationEndMs-leadMs;
  let startMs=leadMs;
  const events=timeline.events.map((event,index)=>{
    const endMs=index===timeline.events.length-1?animationEndMs:startMs+activeMs*weights[index]/sum;
    const span:ExportEventSpan={index,date:event.date,codes:[...event.codes],total:event.total,startMs,endMs,transitionMs:(endMs-startMs)*.99};
    startMs=endMs;
    return span;
  });
  return{durationMs,leadMs,finalHoldMs,animationEndMs,events};
}

/** Deterministic random access allows both real-time video and offline GIF encoding. */
export function sampleExportTime(plan:ExportDurationPlan,elapsedMs:number):ExportTimeSample {
  const time=Number.isNaN(elapsedMs)?0:Math.max(0,Math.min(plan.durationMs,elapsedMs));
  const complete=time>=plan.durationMs;
  if(!plan.events.length||time<plan.leadMs)return{index:-1,date:null,progress:1,codes:emptyCodes,total:0,holdingFinal:false,complete};
  const last=plan.events[plan.events.length-1];
  if(time>=plan.animationEndMs)return{index:last.index,date:last.date,progress:1,codes:last.codes,total:last.total,holdingFinal:true,complete};
  let low=0,high=plan.events.length-1;
  while(low<high){const middle=(low+high)>>>1;if(time<plan.events[middle].endMs)high=middle;else low=middle+1;}
  const event=plan.events[low],raw=clamp((time-event.startMs)/event.transitionMs);
  return{index:event.index,date:event.date,progress:raw*raw*(3-2*raw),codes:event.codes,total:event.total,holdingFinal:false,complete};
}
