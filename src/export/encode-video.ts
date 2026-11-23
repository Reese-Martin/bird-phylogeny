export interface VideoType { mimeType:string; extension:'mp4'|'webm'; label:string }
export interface EncodedAnimation { blob:Blob; extension:string; mimeType:string }
export interface EncodeAnimationOptions {
  canvas:HTMLCanvasElement;
  durationMs:number;
  fps:number;
  render:(elapsedMs:number)=>void;
  signal?:AbortSignal;
  onProgress?:(fraction:number)=>void;
}

interface RecorderSupport { isTypeSupported:(mimeType:string)=>boolean }
export type AnimationRecorder=Pick<MediaRecorder,'state'|'mimeType'|'start'|'stop'|'ondataavailable'|'onstop'|'onerror'>;
interface VisibilitySource {
  readonly hidden:boolean;
  addEventListener:(type:'visibilitychange',listener:()=>void)=>void;
  removeEventListener:(type:'visibilitychange',listener:()=>void)=>void;
}
export interface VideoRuntime {
  support:RecorderSupport|null;
  capture:(canvas:HTMLCanvasElement,fps:number)=>MediaStream;
  recorder:(stream:MediaStream,options:MediaRecorderOptions)=>AnimationRecorder;
  now:()=>number;
  requestFrame:(callback:FrameRequestCallback)=>number;
  cancelFrame:(id:number)=>void;
  visibility?:VisibilitySource;
}

const VIDEO_TYPES:readonly VideoType[]=[
  // Leave H.264 profile/level selection to the encoder for HD and larger grids.
  {mimeType:'video/mp4',extension:'mp4',label:'MP4 video'},
  {mimeType:'video/webm;codecs=vp9',extension:'webm',label:'WebM video'},
  {mimeType:'video/webm;codecs=vp8',extension:'webm',label:'WebM video'},
  {mimeType:'video/webm',extension:'webm',label:'WebM video'},
];
export const MAX_VIDEO_BYTES=128*1024*1024;

const recorderSupport=():RecorderSupport|null=>typeof MediaRecorder==='undefined'?null:MediaRecorder;

/** Codec support is queried rather than inferred from a browser name. */
export function supportedVideoType(support:RecorderSupport|null=recorderSupport(),canCapture=typeof HTMLCanvasElement!=='undefined'&&typeof HTMLCanvasElement.prototype.captureStream==='function'):VideoType|null {
  if(!support||!canCapture)return null;
  for(const type of VIDEO_TYPES){try{if(support.isTypeSupported(type.mimeType))return {...type};}catch{/* Try the next native container. */}}
  return null;
}

export function animationAbortError():DOMException {return new DOMException('Animation export cancelled.','AbortError');}

export function validateAnimationOptions(options:EncodeAnimationOptions):void {
  if(!Number.isFinite(options.durationMs)||options.durationMs<=0)throw new Error('Choose a positive animation duration.');
  if(!Number.isFinite(options.fps)||options.fps<=0||options.fps>60)throw new Error('Animation frame rate must be between 1 and 60.');
  if(!Number.isInteger(options.canvas.width)||!Number.isInteger(options.canvas.height)||options.canvas.width<1||options.canvas.height<1)throw new Error('The animation canvas must have positive dimensions.');
  if(options.canvas.width>4096||options.canvas.height>4096)throw new Error('The animation is too large to encode. Use a smaller export size.');
}

const nativeRuntime=(overrides:Partial<VideoRuntime>):VideoRuntime=>({
  support:recorderSupport(),
  capture:(canvas,fps)=>{
    if(typeof canvas.captureStream!=='function')throw new Error('This browser cannot record a canvas as video. Choose GIF instead.');
    return canvas.captureStream(fps);
  },
  recorder:(stream,options)=>new MediaRecorder(stream,options),
  now:()=>performance.now(),
  requestFrame:callback=>requestAnimationFrame(callback),
  cancelFrame:id=>cancelAnimationFrame(id),
  visibility:typeof document==='undefined'?undefined:document,
  ...overrides,
});

/**
 * Encodes the supplied compositor canvas in real time. Render is driven by a
 * monotonic clock, independently of the UI's playback timer or scroll position.
 */
export async function encodeVideo(options:EncodeAnimationOptions,overrides:Partial<VideoRuntime>={}):Promise<EncodedAnimation> {
  validateAnimationOptions(options);
  if(options.signal?.aborted)throw animationAbortError();
  const runtime=nativeRuntime(overrides),type=supportedVideoType(runtime.support,true);
  if(!type)throw new Error('Video recording is unavailable in this browser. Choose GIF instead.');
  if(runtime.visibility?.hidden)throw new Error('Keep this tab visible while recording a video.');
  return new Promise<EncodedAnimation>((resolve,reject)=>{
    let stream:MediaStream|undefined,recorder:AnimationRecorder|undefined;
    let frame=0,done=false,stopRequested=false,bytes=0;
    let deadline:ReturnType<typeof setTimeout>|undefined;
    const chunks:Blob[]=[];
    const cleanup=()=>{
      if(frame)runtime.cancelFrame(frame);frame=0;
      if(deadline!==undefined)clearTimeout(deadline);
      options.signal?.removeEventListener('abort',abort);
      runtime.visibility?.removeEventListener('visibilitychange',visibilityChanged);
      if(recorder){recorder.ondataavailable=null;recorder.onstop=null;recorder.onerror=null;}
      for(const track of stream?.getTracks()||[]){try{track.stop();}catch{/* Release every remaining track. */}}
    };
    const fail=(error:unknown)=>{
      if(done)return;done=true;
      cleanup();
      try{if(recorder&&recorder.state!=='inactive')recorder.stop();}catch{/* The rejection already owns cleanup. */}
      chunks.length=0;
      reject(error instanceof Error?error:new Error('Video export failed.'));
    };
    const abort=()=>fail(animationAbortError());
    const visibilityChanged=()=>{if(runtime.visibility?.hidden)fail(new Error('Video recording stopped because the tab was hidden. Keep this tab visible and try again.'));};
    try{
      options.render(0);
      stream=runtime.capture(options.canvas,options.fps);
      recorder=runtime.recorder(stream,{mimeType:type.mimeType,videoBitsPerSecond:6_000_000});
      recorder.ondataavailable=event=>{
        if(done||!event.data?.size)return;
        bytes+=event.data.size;
        if(bytes>MAX_VIDEO_BYTES){fail(new Error('The video exceeded 128 MB. Choose a shorter duration or GIF.'));return;}
        chunks.push(event.data);
      };
      recorder.onerror=event=>fail(new Error(`Video encoding failed${'error' in event&&event.error instanceof Error?`: ${event.error.message}`:'.'}`));
      recorder.onstop=()=>{
        if(done)return;
        if(!stopRequested){fail(new Error('Video recording ended before the animation finished.'));return;}
        if(!chunks.length||!bytes){fail(new Error('The browser produced an empty video. Try GIF instead.'));return;}
        done=true;
        const mimeType=recorder?.mimeType||chunks.find(chunk=>chunk.type)?.type||type.mimeType;
        const blob=new Blob(chunks,{type:mimeType});chunks.length=0;
        cleanup();options.onProgress?.(1);
        resolve({blob,mimeType,extension:mimeType.startsWith('video/mp4')?'mp4':'webm'});
      };
      options.signal?.addEventListener('abort',abort,{once:true});
      runtime.visibility?.addEventListener('visibilitychange',visibilityChanged);
      if(options.signal?.aborted){abort();return;}
      recorder.start(1000);
      const start=runtime.now();
      const frameInterval=1000/options.fps;
      let lastPaint=0;
      options.onProgress?.(0);
      const draw=()=>{
        frame=0;if(done)return;
        try{
          if(options.signal?.aborted){abort();return;}
          const elapsed=Math.max(0,Math.min(options.durationMs,runtime.now()-start));
          if(elapsed>=options.durationMs||elapsed-lastPaint>=frameInterval){
            options.render(elapsed);lastPaint=elapsed;
            options.onProgress?.(elapsed/options.durationMs);
          }
          if(elapsed>=options.durationMs){
            stopRequested=true;
            // Let the final canvas paint reach the capture track before stopping.
            frame=runtime.requestFrame(()=>{frame=0;if(done)return;try{recorder!.stop();}catch(error){fail(error);}});
          }else frame=runtime.requestFrame(draw);
        }catch(error){fail(error);}
      };
      deadline=setTimeout(()=>fail(new Error('The browser did not finish recording. Keep this tab visible and try again.')),options.durationMs+15000);
      frame=runtime.requestFrame(draw);
    }catch(error){fail(error);}
  });
}
