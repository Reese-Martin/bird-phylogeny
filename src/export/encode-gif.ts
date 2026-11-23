import {animationAbortError,validateAnimationOptions,type EncodeAnimationOptions,type EncodedAnimation} from './encode-video';

export const MAX_GIF_BYTES=64*1024*1024;
export interface GifFrame { elapsedMs:number; delayMs:number }
export interface GifRequest {
  type:'init'|'frame'|'finish'; id:number;
  width?:number; height?:number; rgba?:ArrayBuffer; delayMs?:number; maxBytes?:number;
}
export interface GifResponse { type:'ready'|'frame'|'done'|'error'; id:number; bytes?:ArrayBuffer; message?:string }
export interface GifWorkerLike {
  onmessage:((event:MessageEvent<GifResponse>)=>void)|null;
  onerror:((event:ErrorEvent)=>void)|null;
  postMessage:(message:GifRequest,transfer?:Transferable[])=>void;
  terminate:()=>void;
}
export interface GifRuntime {
  worker:()=>GifWorkerLike;
  /** Reading one frame at a time keeps RGBA memory independent of duration. */
  pixels:(canvas:HTMLCanvasElement)=>Uint8ClampedArray;
  timeoutMs:number;
}

/** Centisecond error is distributed, so 12fps does not become an 80ms/frame GIF. */
export function gifFrameSchedule(durationMs:number,fps:number):GifFrame[] {
  if(!Number.isFinite(durationMs)||durationMs<20)throw new Error('A GIF must be at least 20 milliseconds long.');
  if(!Number.isFinite(fps)||fps<1||fps>60)throw new Error('GIF frame rate must be between 1 and 60.');
  const centiseconds=Math.round(durationMs/10);
  const count=Math.min(centiseconds,Math.max(2,Math.ceil(durationMs*fps/1000)));
  if(count>7200)throw new Error('This GIF has too many frames. Choose a shorter duration.');
  return Array.from({length:count},(_,index)=>({
    elapsedMs:index===count-1?durationMs:index*durationMs/count,
    delayMs:(Math.round((index+1)*centiseconds/count)-Math.round(index*centiseconds/count))*10,
  }));
}

const defaultRuntime=(overrides:Partial<GifRuntime>):GifRuntime=>({
  worker:()=>new Worker(new URL('./gif.worker.ts',import.meta.url),{type:'module'}) as unknown as GifWorkerLike,
  pixels:canvas=>{
    const context=canvas.getContext('2d',{willReadFrequently:true});
    if(!context)throw new Error('This browser could not read animation frames.');
    return context.getImageData(0,0,canvas.width,canvas.height).data;
  },
  timeoutMs:30000,
  ...overrides,
});

/**
 * Offline GIF encoding with one RGBA transfer awaiting acknowledgment at a time.
 * Only encoded bytes accumulate in the worker, under the explicit 64MiB limit.
 */
export async function encodeGif(options:EncodeAnimationOptions,overrides:Partial<GifRuntime>={}):Promise<EncodedAnimation&{extension:'gif'}> {
  validateAnimationOptions(options);
  if(options.signal?.aborted)throw animationAbortError();
  const frames=gifFrameSchedule(options.durationMs,options.fps),runtime=defaultRuntime(overrides);
  let worker:GifWorkerLike|undefined;
  let nextId=0,stopped=false;
  let pending:{id:number;resolve:(value:GifResponse)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>}|undefined;
  const abort=()=>{
    stopped=true;
    if(pending){clearTimeout(pending.timer);pending.reject(animationAbortError());pending=undefined;}
    worker?.terminate();
  };
  const failPending=(error:Error)=>{
    if(!pending)return;
    clearTimeout(pending.timer);pending.reject(error);pending=undefined;
  };
  const exchange=(request:Omit<GifRequest,'id'>,transfer:Transferable[]=[]):Promise<GifResponse>=>new Promise((resolve,reject)=>{
    if(stopped||options.signal?.aborted){reject(animationAbortError());return;}
    const id=++nextId;
    const timer=setTimeout(()=>{
      if(pending?.id!==id)return;
      pending=undefined;stopped=true;worker?.terminate();
      reject(new Error('GIF encoding timed out. Try a shorter duration or video.'));
    },runtime.timeoutMs);
    pending={id,resolve,reject,timer};
    try{worker!.postMessage({...request,id},transfer);}catch(error){failPending(error instanceof Error?error:new Error('Could not send a GIF frame.'));}
  });
  try{
    worker=runtime.worker();
    worker.onmessage=event=>{
      const message=event.data;
      if(stopped||!pending||message.id!==pending.id)return;
      if(message.type==='error'){failPending(new Error(message.message||'GIF encoding failed.'));return;}
      const item=pending;pending=undefined;clearTimeout(item.timer);item.resolve(message);
    };
    worker.onerror=event=>failPending(new Error(event.message||'The GIF encoder stopped unexpectedly.'));
    options.signal?.addEventListener('abort',abort,{once:true});
    if(options.signal?.aborted){abort();throw animationAbortError();}
    options.onProgress?.(0);
    // A palette from the complete scene includes future birds and stays stable.
    options.render(options.durationMs);
    const palettePixels=runtime.pixels(options.canvas);
    const paletteBuffer=palettePixels.buffer as ArrayBuffer;
    await exchange({type:'init',width:options.canvas.width,height:options.canvas.height,rgba:paletteBuffer,maxBytes:MAX_GIF_BYTES},[paletteBuffer]);
    for(let index=0;index<frames.length;index++){
      if(stopped||options.signal?.aborted)throw animationAbortError();
      options.render(frames[index].elapsedMs);
      const pixels=runtime.pixels(options.canvas),buffer=pixels.buffer as ArrayBuffer;
      await exchange({type:'frame',rgba:buffer,delayMs:frames[index].delayMs},[buffer]);
      options.onProgress?.((index+1)/frames.length);
    }
    const result=await exchange({type:'finish'});
    if(result.type!=='done'||!result.bytes||!result.bytes.byteLength)throw new Error('The GIF encoder produced an empty file.');
    if(result.bytes.byteLength>MAX_GIF_BYTES)throw new Error('The GIF exceeded 64 MB. Choose a shorter duration.');
    return {blob:new Blob([result.bytes],{type:'image/gif'}),extension:'gif',mimeType:'image/gif'};
  }finally{
    stopped=true;
    options.signal?.removeEventListener('abort',abort);
    if(pending)clearTimeout(pending.timer);
    pending=undefined;
    if(worker){worker.onmessage=null;worker.onerror=null;worker.terminate();}
  }
}
