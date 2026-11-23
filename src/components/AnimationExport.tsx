import { useEffect, useMemo, useRef, useState } from 'react';
import type { Collection, Taxon, TreeData } from '../types';
import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import type { LayoutMode } from '../tree/geometry';
import { buildCountryGrowth } from '../arboretum/country-growth';
import { supportedVideoType } from '../export/encode-video';
import { createAnimationExport, type AnimationFormat, type AnimationExportProgress, type AnimationExportResult } from '../export/export-animation';
import './AnimationExport.css';

export interface AnimationExportProps {
  collection:Collection;
  tree:TreeData;
  taxa:Taxon[];
  geometry?:StickerGeometryData;
  sizeMode:StickerSizeMode;
  layoutMode:LayoutMode;
  theme:'light'|'dark';
  year?:number|null;
  includeCountriesByDefault:boolean;
}
interface DownloadResult extends AnimationExportResult {url:string;filename:string}

export default function AnimationExport(props:AnimationExportProps) {
  const videoType=useMemo(()=>typeof HTMLCanvasElement!=='undefined'&&'captureStream' in HTMLCanvasElement.prototype?supportedVideoType():null,[]);
  const hasCountryData=Boolean(props.collection.countries?.length);
  const [includeCountries,setIncludeCountries]=useState(props.includeCountriesByDefault&&hasCountryData);
  const [format,setFormat]=useState<AnimationFormat>(videoType?'video':'gif');
  const [duration,setDuration]=useState(30);
  const [large,setLarge]=useState(false);
  const [busy,setBusy]=useState(false);
  const [progress,setProgress]=useState<AnimationExportProgress|null>(null);
  const [error,setError]=useState('');
  const [cancelled,setCancelled]=useState(false);
  const [result,setResult]=useState<DownloadResult|null>(null);
  const [previewGif,setPreviewGif]=useState(false);
  const [showCanvas,setShowCanvas]=useState(false);
  const canvas=useRef<HTMLCanvasElement>(null);
  const controller=useRef<AbortController|null>(null);
  const downloadUrl=useRef<string|null>(null);
  const mounted=useRef(true);
  const model=useMemo(()=>buildCountryGrowth(props.collection,{year:props.year,includeCountries}),[props.collection,props.year,includeCountries]);
  const width=format==='video'?(large?1920:1280):(large?960:800);
  useEffect(()=>{
    mounted.current=true;
    return()=>{mounted.current=false;controller.current?.abort();if(downloadUrl.current){const previous=downloadUrl.current;setTimeout(()=>URL.revokeObjectURL(previous),10000);}};
  },[]);

  function changeScope(withCountries:boolean) {
    setIncludeCountries(withCountries);
    setResult(null);
    setShowCanvas(false);
    setPreviewGif(false);
    setError('');
    setCancelled(false);
  }

  async function start() {
    if(busy||!canvas.current)return;
    const aborter=new AbortController();controller.current=aborter;
    setBusy(true);setError('');setCancelled(false);setPreviewGif(false);setResult(null);setShowCanvas(true);
    if(downloadUrl.current){const previous=downloadUrl.current;downloadUrl.current=null;setTimeout(()=>URL.revokeObjectURL(previous),10000);}
    try {
      const completed=await createAnimationExport({...props,model,format,durationMs:duration*1000,width,canvas:canvas.current,signal:aborter.signal,onProgress:next=>{
        if(!mounted.current||aborter.signal.aborted)return;
        setProgress(previous=>previous?.phase===next.phase&&Math.floor(previous.fraction*100)===Math.floor(next.fraction*100)?previous:next);
      }});
      if(aborter.signal.aborted||!mounted.current)return;
      const baseName=completed.panelCount>1?'phylobirds-country-growth':'phylobirds-life-list-growth';
      const url=URL.createObjectURL(completed.blob),filename=`${baseName}${props.year!=null?`-through-${props.year}`:''}.${completed.extension}`;
      downloadUrl.current=url;
      setResult({...completed,url,filename});
      const link=document.createElement('a');link.href=url;link.download=filename;link.click();
    } catch(reason) {
      if(!mounted.current)return;
      if(aborter.signal.aborted||(reason instanceof Error&&reason.name==='AbortError')){setCancelled(true);setShowCanvas(false);}
      else setError(reason instanceof Error?reason.message:'The animation could not be exported.');
    } finally {
      if(controller.current===aborter)controller.current=null;
      if(mounted.current){setBusy(false);setProgress(null);}
    }
  }

  const percentage=Math.round((progress?.fraction||0)*100);
  return <div className="animation-export">
    <p className="animation-export-scope">{model.timeline.datedCount.toLocaleString()} dated species{model.panels.length>1&&` · ${model.panels.length-1} country ${model.panels.length===2?'tree':'trees'}`}{props.year!=null?` · Through ${props.year}`:''}</p>
    <fieldset className="animation-export-options" disabled={busy}>
      {hasCountryData&&<label className="animation-export-trees"><span>Trees to export</span><select value={includeCountries?'countries':'life-list'} onChange={event=>changeScope(event.target.value==='countries')}><option value="life-list">Life list only</option><option value="countries">Life list + country trees</option></select></label>}
      <label><span>Format</span><select aria-label="Animation format" value={format} onChange={event=>setFormat(event.target.value as AnimationFormat)}><option value="video" disabled={!videoType}>{videoType?`${videoType.label} (.${videoType.extension})`:'Video unavailable in this browser'}</option><option value="gif">Animated GIF (.gif)</option></select></label>
      <label><span>Duration</span><select aria-label="Animation duration" value={duration} onChange={event=>setDuration(Number(event.target.value))}>{[15,30,60].map(seconds=><option key={seconds} value={seconds}>{seconds} seconds</option>)}</select></label>
      <label><span>Size</span><select aria-label="Animation size" value={large?'large':'standard'} onChange={event=>setLarge(event.target.value==='large')}><option value="standard">Standard · {format==='video'?1280:800}px wide</option><option value="large">Large · {format==='video'?1920:960}px wide</option></select></label>
    </fieldset>
    <p className="animation-export-note">{format==='video'?'Keep this tab visible while recording.':'GIF loops and uses fewer colors.'}</p>
    <div className="animation-export-actions">
      <button type="button" className="primary" disabled={busy||!model.timeline.datedCount} onClick={()=>void start()}>{result?'Export again':'Create animation'}</button>
      {busy&&<button type="button" className="secondary" onClick={()=>controller.current?.abort()}>Cancel export</button>}
      {result&&<a className="secondary" href={result.url} download={result.filename}>Download {result.extension.toUpperCase()}</a>}
      {result?.extension==='gif'&&<button type="button" className="text-button" onClick={()=>setPreviewGif(value=>!value)}>{previewGif?'Stop GIF preview':'Preview GIF'}</button>}
    </div>
    {busy&&<div className="animation-export-progress"><span role="status">{progress?.phase==='encoding'?format==='video'?'Recording video':'Encoding GIF':'Preparing bird illustrations'}</span><span aria-hidden="true">{percentage}%</span><progress aria-label="Animation export progress" max="100" value={percentage}/></div>}
    {error&&<p className="animation-export-error" role="alert">{error}</p>}
    {cancelled&&<p role="status" className="animation-export-note">Export cancelled.</p>}
    {result&&<p className="animation-export-complete" role="status">Ready to download · {result.durationMs/1000}s · {(result.blob.size/1024/1024).toFixed(1)} MB.</p>}
    <div className="animation-export-preview" hidden={!showCanvas}>
      <canvas ref={canvas} aria-label="Animation export preview" hidden={Boolean(result&&(result.extension!=='gif'||previewGif))}/>
      {result&&result.extension!=='gif'&&<video src={result.url} controls preload="metadata" aria-label="Exported tree animation"/>}
      {result?.extension==='gif'&&previewGif&&<img src={result.url} alt={result.panelCount>1?'Exported life list and country tree animation':'Exported life list animation'}/>}
    </div>
  </div>;
}
