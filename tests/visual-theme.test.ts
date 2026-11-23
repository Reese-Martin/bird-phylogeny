import { describe, expect, it } from 'vitest';
import { COLORS, DARK_COLORS, LIGHT_COLORS, themeColors, type ColorPalette } from '../src/tree/visual-theme';
import { drawTreeScene, type RadialPortrait, type RendererTip } from '../src/tree/renderer';
import type { ArtworkCache } from '../src/tree/artwork-cache';
import type { TreeLayout } from '../src/tree/geometry';

const luminance=(hex:string)=>{
  const rgb=[1,3,5].map(start=>Number.parseInt(hex.slice(start,start+2),16)/255).map(value=>value<=.04045?value/12.92:((value+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
};
const contrast=(first:string,second:string)=>{const a=luminance(first),b=luminance(second);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05);};

describe('light and dark plotting palettes',()=>{
  it('keeps text, selected emphasis and recorded ancestry readable on plot and footer surfaces',()=>{
    for(const palette of [LIGHT_COLORS,DARK_COLORS])for(const background of [palette.paper,palette.surface]){
      expect(contrast(palette.ink,background)).toBeGreaterThanOrEqual(7);
      expect(contrast(palette.label,background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.accent,background)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(palette.observed,background)).toBeGreaterThanOrEqual(7);
    }
    expect(themeColors('dark')).toBe(DARK_COLORS);expect(themeColors('light')).toBe(LIGHT_COLORS);expect(COLORS).toBe(LIGHT_COLORS);
  });
});

describe('theme-aware radial rendering',()=>{
  const image={naturalWidth:128,naturalHeight:64};
  const tip={id:0,angle:0,radius:1,x:1,y:0,code:'example',taxon:{code:'example',commonName:'Example bird',scientificName:'Example species',category:'species',mappingStatus:'exact',stickerSmall:'/stickers/128/example.webp'}} as RendererTip;
  const portraits:RadialPortrait[]=[{id:'example:0',code:tip.code,taxon:tip.taxon,tip,angle:0,radius:1.4,x:1.4,y:0,width:.2,height:.1}];
  const layout:TreeLayout={nodes:[tip],tipCount:1,maxDistance:100,mode:'true-distance'};
  const backgroundPath={} as Path2D,observedPath={} as Path2D,selectedPath={} as Path2D;
  function render(colors:Readonly<ColorPalette>,ready=true){
    const calls:Array<{method:string;args:any[];fill:unknown;stroke:unknown}>=[],state:Record<string,unknown>={};
    const ctx=new Proxy({},{get:(_target,key)=>key==='measureText'?(text:string)=>({width:text.length*6}):(...args:any[])=>calls.push({method:String(key),args,fill:state.fillStyle,stroke:state.strokeStyle}),set:(_target,key,value)=>{state[String(key)]=value;return true;}}) as CanvasRenderingContext2D;
    const cache={peek:()=>({state:ready?'ready':'queued'}),getReady:(keys:string[])=>ready&&keys.length?{key:keys[0],value:image}:undefined,setWanted:()=>{}} as unknown as ArtworkCache<HTMLImageElement>;
    const result=drawTreeScene(ctx,{width:800,height:700,transform:{x:350,y:350,k:100},baseScale:100,layout,points:[tip],clades:[],orders:[{name:'Order',count:1,start:-.4,end:.4,verified:true}],hoveredOrder:'Order',observedCodes:new Set([tip.code]),selectedCode:null,backgroundPath,observedPath,selectedPath,cache,radialPortraits:portraits,showTree:true,speciesCount:1,colors});
    return {calls,result};
  }
  it('changes background and branch colors while preserving portrait placement, size and hit targets',()=>{
    const light=render(LIGHT_COLORS),dark=render(DARK_COLORS);
    for(const [rendered,palette]of [[light,LIGHT_COLORS],[dark,DARK_COLORS]] as const){
      expect(rendered.calls.find(call=>call.method==='fillRect')?.fill).toBe(palette.paper);
      expect(rendered.calls.find(call=>call.method==='stroke'&&call.args[0]===backgroundPath)?.stroke).toBe(palette.muted);
      expect(rendered.calls.find(call=>call.method==='stroke'&&call.args[0]===observedPath)?.stroke).toBe(palette.observed);
      expect(rendered.calls.find(call=>call.method==='stroke'&&call.args[0]===selectedPath)?.stroke).toBe(palette.accent);
    }
    expect(dark.calls.filter(call=>call.method==='drawImage').map(call=>call.args)).toEqual(light.calls.filter(call=>call.method==='drawImage').map(call=>call.args));
    expect(dark.result.hitBoxes).toEqual(light.result.hitBoxes);expect(dark.result.readyPortraitCount).toBe(1);
  });
  it('draws pending and missing-artwork fallbacks using the chosen palette',()=>{
    const dark=render(DARK_COLORS,false);
    expect(dark.calls.some(call=>call.method==='fill'&&call.fill===DARK_COLORS.surface)).toBe(true);
    expect(dark.calls.some(call=>call.method==='stroke'&&call.stroke===DARK_COLORS.line)).toBe(true);
    expect(dark.result.readyPortraitCount).toBe(0);expect(dark.result.radialPortraitCount).toBe(1);
  });
});
