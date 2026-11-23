import type { Taxon, TreeData } from '../types';
import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import type { LayoutMode } from '../tree/geometry';
import { SharedArtworkPool } from '../tree/shared-artwork';
import { themeColors } from '../tree/visual-theme';
import { countryGrowthFrame, type buildCountryGrowth } from '../arboretum/country-growth';
import { prepareExportTree } from './tree-scene';
import { drawExportComposition, planExportGrid } from './composition';
import { exportDurationPlan, sampleExportTime } from './timeline';
import { animationAbortError, encodeVideo, type EncodedAnimation } from './encode-video';
import { exportCredits } from '../sources';

export type AnimationFormat='video'|'gif';
export interface AnimationExportProgress { phase:'preparing'|'encoding'; fraction:number }
export interface AnimationExportOptions {
  model:ReturnType<typeof buildCountryGrowth>;
  tree:TreeData;
  taxa:Taxon[];
  geometry?:StickerGeometryData;
  sizeMode:StickerSizeMode;
  layoutMode:LayoutMode;
  theme:'light'|'dark';
  year?:number|null;
  format:AnimationFormat;
  durationMs:number;
  width:number;
  canvas:HTMLCanvasElement;
  signal:AbortSignal;
  onProgress?:(progress:AnimationExportProgress)=>void;
}
export interface AnimationExportResult extends EncodedAnimation {
  width:number;
  height:number;
  durationMs:number;
  panelCount:number;
  species:number;
}

const checkAbort=(signal:AbortSignal)=>{if(signal.aborted)throw animationAbortError();};

/** Render from a fixed collection snapshot; no browser scrolling or UI playback is recorded. */
export async function createAnimationExport(options:AnimationExportOptions):Promise<AnimationExportResult> {
  const {signal,canvas,model}=options;
  checkAbort(signal);
  if(!model.timeline.datedCount)throw new Error('This collection has no dated species to animate.');
  const hasCountryTrees=model.panels.length>1;
  const title=hasCountryTrees?'phyloBirds · Life lists together':'phyloBirds · Life list growth';
  const subtitle=[`${model.timeline.datedCount.toLocaleString()} species`,hasCountryTrees&&`${model.panels.length-1} ${model.panels.length===2?'country':'countries'}`,options.year!=null&&`Through ${options.year}`].filter(Boolean).join(' · ');
  const plan=planExportGrid(model.panels.length,options.width);
  const time=exportDurationPlan(model.timeline,options.durationMs);
  const colors=themeColors(options.theme),sceneColors={...colors,paper:colors.surface};
  canvas.width=plan.width;canvas.height=plan.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('This browser could not create an animation canvas.');
  const pool=new SharedArtworkPool();
  const scenes:ReturnType<typeof prepareExportTree>[]=[];
  try {
    options.onProgress?.({phase:'preparing',fraction:0});
    // Fonts are already local app assets; cap the wait and retain cancellation.
    await new Promise<void>((resolve,reject)=>{
      let timer:ReturnType<typeof setTimeout>;
      const finish=(error?:unknown)=>{clearTimeout(timer);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const abort=()=>finish(animationAbortError());
      timer=setTimeout(()=>finish(),10000);
      signal.addEventListener('abort',abort,{once:true});
      document.fonts.ready.then(()=>finish(),()=>finish());
      if(signal.aborted)abort();
    });
    for(let index=0;index<model.panels.length;index++){
      checkAbort(signal);
      const card=plan.cards[index],panel=model.panels[index];
      const cache=pool.connect(()=>{});
      try{scenes.push(prepareExportTree({tree:options.tree,taxa:options.taxa,finalCodes:panel.finalCodes,geometry:options.geometry,sizeMode:options.sizeMode,layoutMode:options.layoutMode,cache,colors:sceneColors,width:card.art.width,height:card.art.height}));}
      catch(error){cache.dispose();throw error;}
    }
    const lastDate=model.timeline.lastDate;
    // Register every panel before awaiting the shared queue, including off-screen countries.
    const scratch=document.createElement('canvas');
    scratch.width=Math.ceil(Math.max(...plan.cards.map(card=>card.art.width)));
    scratch.height=Math.ceil(Math.max(...plan.cards.map(card=>card.art.height)));
    const scratchCtx=scratch.getContext('2d');
    if(!scratchCtx)throw new Error('This browser could not prepare the bird illustrations.');
    for(let index=0;index<scenes.length;index++){
      const panel=model.panels[index];
      scenes[index].draw(scratchCtx,{...countryGrowthFrame(panel,lastDate),date:lastDate,progress:1});
    }
    for(let index=0;index<scenes.length;index++){
      checkAbort(signal);
      await scenes[index].preload(scratchCtx,20000,signal);
      options.onProgress?.({phase:'preparing',fraction:(index+1)/scenes.length});
    }
    scratch.width=1;scratch.height=1;
    const notes=`${options.layoutMode==='compact'?'Compact · Branch lengths not to scale.':'True distance · Approximate branch dates.'} First sightings · Portraits spaced to fit.`;
    const render=(elapsedMs:number)=>{
      checkAbort(signal);
      const sample=sampleExportTime(time,elapsedMs);
      const frames=model.panels.map(panel=>countryGrowthFrame(panel,sample.date));
      drawExportComposition(ctx,plan,{
        title,date:sample.date,subtitle,colors,notes,credits:exportCredits,
        panels:model.panels.map((panel,index)=>({name:hasCountryTrees?panel.name:'Life list',count:frames[index].revealedCodes.size,total:panel.timeline.datedCount,undatedCount:panel.timeline.undatedCount,draw:sceneCtx=>{scenes[index].draw(sceneCtx,{...frames[index],date:sample.date,progress:sample.progress});}})),
      });
    };
    render(options.durationMs);
    checkAbort(signal);
    const encoderOptions={canvas,durationMs:options.durationMs,fps:options.format==='video'?24:12,render,signal,onProgress:(fraction:number)=>options.onProgress?.({phase:'encoding',fraction})};
    const encoded=options.format==='video'?await encodeVideo(encoderOptions):await (await import('./encode-gif')).encodeGif(encoderOptions);
    checkAbort(signal);
    render(options.durationMs);
    return {...encoded,width:plan.width,height:plan.height,durationMs:options.durationMs,panelCount:model.panels.length,species:model.timeline.datedCount};
  } finally {for(const scene of scenes)scene.dispose();}
}
