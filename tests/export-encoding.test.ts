import {afterEach,describe,expect,it,vi} from 'vitest';
import {encodeVideo,supportedVideoType,type AnimationRecorder,type VideoRuntime} from '../src/export/encode-video';
import {encodeGif,gifFrameSchedule,MAX_GIF_BYTES,type GifRequest,type GifResponse,type GifWorkerLike} from '../src/export/encode-gif';
import sharp from 'sharp';

const canvas={width:4,height:4} as HTMLCanvasElement;
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();});

function videoHarness({empty=false,mimeType='video/mp4',constructorError=false}={}){
  let time=0,nextFrame=0;
  const callbacks=new Map<number,FrameRequestCallback>(),listeners=new Set<()=>void>();
  const track={stop:vi.fn()},stream={getTracks:()=>[track]} as unknown as MediaStream;
  const recorder={
    state:'inactive',mimeType,ondataavailable:null as null|((event:{data:Blob})=>void),onstop:null as null|(()=>void),onerror:null as null|((event:Event)=>void),
    start:vi.fn(()=>{recorder.state='recording';}),
    stop:vi.fn(()=>{
      recorder.state='inactive';
      if(!empty)recorder.ondataavailable?.({data:new Blob(['encoded native bytes'],{type:mimeType})});
      recorder.onstop?.();
    }),
  };
  const visibility={hidden:false,addEventListener:(_type:'visibilitychange',callback:()=>void)=>{listeners.add(callback);},removeEventListener:(_type:'visibilitychange',callback:()=>void)=>{listeners.delete(callback);}};
  const runtime:VideoRuntime={
    support:{isTypeSupported:type=>type.startsWith('video/mp4')},
    capture:()=>stream,
    recorder:()=>{if(constructorError)throw new Error('Native encoder unavailable.');return recorder as unknown as AnimationRecorder;},
    now:()=>time,visibility,
    requestFrame:callback=>{callbacks.set(++nextFrame,callback);return nextFrame;},
    cancelFrame:id=>{callbacks.delete(id);},
  };
  const advance=(elapsed:number)=>{
    time=elapsed;
    for(const [id,callback] of [...callbacks]){callbacks.delete(id);callback(time);}
  };
  const hide=()=>{visibility.hidden=true;for(const callback of [...listeners])callback();};
  return{runtime,recorder,track,callbacks,listeners,advance,hide};
}

describe('native animation video encoding',()=>{
  it('negotiates actual supported containers and handles unavailable or throwing support checks',()=>{
    expect(supportedVideoType({isTypeSupported:type=>type.startsWith('video/mp4')},true)).toMatchObject({extension:'mp4',mimeType:'video/mp4'});
    expect(supportedVideoType({isTypeSupported:type=>type==='video/webm;codecs=vp8'},true)?.mimeType).toBe('video/webm;codecs=vp8');
    expect(supportedVideoType({isTypeSupported:type=>{if(type.startsWith('video/mp4'))throw new Error('Unsupported');return type==='video/webm';}},true)?.extension).toBe('webm');
    expect(supportedVideoType(null,true)).toBeNull();
    expect(supportedVideoType({isTypeSupported:()=>true},false)).toBeNull();
  });

  it('renders a monotonic timeline, includes the final frame, and releases native resources',async()=>{
    const harness=videoHarness(),render=vi.fn(),progress=vi.fn();
    const result=encodeVideo({canvas,durationMs:100,fps:24,render,onProgress:progress},harness.runtime);
    harness.advance(25);harness.advance(60);harness.advance(110);
    expect(harness.recorder.stop).not.toHaveBeenCalled();
    harness.advance(120);
    const encoded=await result;
    expect(render.mock.calls.map(call=>call[0])).toEqual([0,60,100]);
    expect(encoded.mimeType).toBe('video/mp4');expect(encoded.extension).toBe('mp4');expect(encoded.blob.size).toBeGreaterThan(0);
    expect(harness.track.stop).toHaveBeenCalledOnce();expect(harness.callbacks.size).toBe(0);expect(harness.listeners.size).toBe(0);
    expect(progress.mock.calls.at(-1)).toEqual([1]);
  });

  it('caps composition work at the requested rate on a60Hz display and still paints the endpoint',async()=>{
    const harness=videoHarness(),render=vi.fn();
    const result=encodeVideo({canvas,durationMs:1000,fps:24,render},harness.runtime);
    for(let frame=1;frame<=60;frame++)harness.advance(frame*1000/60);
    expect(harness.recorder.stop).not.toHaveBeenCalled();
    harness.advance(1020);await result;
    const times=render.mock.calls.map(call=>call[0] as number);
    expect(times[0]).toBe(0);expect(times.at(-1)).toBe(1000);
    expect(times.length).toBeGreaterThan(18);expect(times.length).toBeLessThanOrEqual(25);
    for(let frame=1;frame<times.length-1;frame++)expect(times[frame]-times[frame-1]).toBeGreaterThanOrEqual(1000/24);
    expect(harness.track.stop).toHaveBeenCalledOnce();expect(harness.callbacks.size).toBe(0);
  });

  it('uses the recorder actual MIME type for the result and extension',async()=>{
    const harness=videoHarness({mimeType:'video/webm;codecs=vp9'});
    const result=encodeVideo({canvas,durationMs:100,fps:24,render:()=>{}},harness.runtime);
    harness.advance(100);harness.advance(120);
    expect(await result).toMatchObject({extension:'webm',mimeType:'video/webm;codecs=vp9'});
  });

  it('cancels recording and pending frames without producing a partial download',async()=>{
    const harness=videoHarness(),controller=new AbortController();
    const result=encodeVideo({canvas,durationMs:100,fps:24,render:()=>{},signal:controller.signal},harness.runtime);
    controller.abort();
    await expect(result).rejects.toMatchObject({name:'AbortError'});
    expect(harness.track.stop).toHaveBeenCalledOnce();expect(harness.recorder.stop).toHaveBeenCalledOnce();expect(harness.callbacks.size).toBe(0);expect(harness.listeners.size).toBe(0);
  });

  it('stops cleanly when the tab becomes hidden or the native constructor fails',async()=>{
    const harness=videoHarness();
    const result=encodeVideo({canvas,durationMs:100,fps:24,render:()=>{}},harness.runtime);harness.hide();
    await expect(result).rejects.toThrow('tab was hidden');expect(harness.track.stop).toHaveBeenCalledOnce();
    const broken=videoHarness({constructorError:true});
    await expect(encodeVideo({canvas,durationMs:100,fps:24,render:()=>{}},broken.runtime)).rejects.toThrow('Native encoder unavailable');
    expect(broken.track.stop).toHaveBeenCalledOnce();expect(broken.callbacks.size).toBe(0);
  });

  it('rejects empty recordings and rendering failures, and clears all callbacks',async()=>{
    const empty=videoHarness({empty:true});
    const result=encodeVideo({canvas,durationMs:100,fps:24,render:()=>{}},empty.runtime);empty.advance(100);empty.advance(110);
    await expect(result).rejects.toThrow('empty video');expect(empty.track.stop).toHaveBeenCalledOnce();
    const broken=videoHarness();
    await expect(encodeVideo({canvas,durationMs:100,fps:24,render:()=>{throw new Error('Could not draw.');}},broken.runtime)).rejects.toThrow('Could not draw');
    expect(broken.callbacks.size).toBe(0);
  });

  it('has a finite watchdog if the browser never delivers recording frames',async()=>{
    vi.useFakeTimers();const harness=videoHarness();
    const result=encodeVideo({canvas,durationMs:100,fps:24,render:()=>{}},harness.runtime);
    const assertion=expect(result).rejects.toThrow('did not finish');
    await vi.advanceTimersByTimeAsync(15101);await assertion;
    expect(harness.track.stop).toHaveBeenCalledOnce();expect(harness.callbacks.size).toBe(0);expect(vi.getTimerCount()).toBe(0);
  });
});

class GifWorker implements GifWorkerLike {
  onmessage:GifWorkerLike['onmessage']=null;
  onerror:GifWorkerLike['onerror']=null;
  requests:GifRequest[]=[];
  terminate=vi.fn();
  active=0;maxActive=0;
  hold=false;
  output:ArrayBuffer=new TextEncoder().encode('GIF89a').buffer;
  postMessage=(message:GifRequest)=>{
    this.requests.push(message);this.maxActive=Math.max(this.maxActive,++this.active);
    if(this.hold)return;
    queueMicrotask(()=>{
      this.active--;
      const response:GifResponse=message.type==='finish'?{id:message.id,type:'done',bytes:this.output}:{id:message.id,type:message.type==='init'?'ready':'frame'};
      this.onmessage?.({data:response} as MessageEvent<GifResponse>);
    });
  };
}

describe('bounded GIF animation encoding',()=>{
  it('distributes centiseconds without accumulating12fps timing drift and samples both endpoints',()=>{
    for(const duration of [15000,30000,60000]){
      const schedule=gifFrameSchedule(duration,12);
      expect(schedule).toHaveLength(duration/1000*12);
      expect(schedule.reduce((sum,frame)=>sum+frame.delayMs,0)).toBe(duration);
      expect(new Set(schedule.map(frame=>frame.delayMs))).toEqual(new Set([80,90]));
      expect(schedule[0].elapsedMs).toBe(0);expect(schedule.at(-1)?.elapsedMs).toBe(duration);
    }
    expect(()=>gifFrameSchedule(0,12)).toThrow('at least');expect(()=>gifFrameSchedule(100,0)).toThrow('frame rate');
  });

  it('prepares one final-scene palette, transfers sequential frames and finishes with cleanup',async()=>{
    const worker=new GifWorker(),render=vi.fn(),pixels=vi.fn(()=>new Uint8ClampedArray(64)),progress=vi.fn();
    const result=await encodeGif({canvas,durationMs:1000,fps:12,render,onProgress:progress},{worker:()=>worker,pixels});
    expect(result.extension).toBe('gif');expect(result.blob.type).toBe('image/gif');expect(await result.blob.text()).toBe('GIF89a');
    expect(worker.requests[0]).toMatchObject({type:'init',width:4,height:4,maxBytes:MAX_GIF_BYTES});
    expect(worker.requests.filter(message=>message.type==='frame')).toHaveLength(12);
    expect(worker.requests.at(-1)?.type).toBe('finish');expect(worker.maxActive).toBe(1);
    expect(render.mock.calls[0]).toEqual([1000]);expect(render.mock.calls[1]).toEqual([0]);expect(render.mock.calls.at(-1)).toEqual([1000]);
    expect(pixels).toHaveBeenCalledTimes(13);expect(worker.terminate).toHaveBeenCalled();expect(worker.onmessage).toBeNull();expect(progress.mock.calls.at(-1)).toEqual([1]);
  });

  it('cancels an in-flight worker and rejects an already-aborted request before allocating it',async()=>{
    const worker=new GifWorker();worker.hold=true;const controller=new AbortController();
    const result=encodeGif({canvas,durationMs:1000,fps:12,render:()=>{},signal:controller.signal},{worker:()=>worker,pixels:()=>new Uint8ClampedArray(64)});
    controller.abort();await expect(result).rejects.toMatchObject({name:'AbortError'});expect(worker.terminate).toHaveBeenCalled();
    const factory=vi.fn(()=>worker);
    await expect(encodeGif({canvas,durationMs:1000,fps:12,render:()=>{},signal:controller.signal},{worker:factory})).rejects.toMatchObject({name:'AbortError'});
    expect(factory).not.toHaveBeenCalled();
  });

  it('times out an unresponsive worker and releases it',async()=>{
    vi.useFakeTimers();const worker=new GifWorker();worker.hold=true;
    const result=encodeGif({canvas,durationMs:1000,fps:12,render:()=>{}},{worker:()=>worker,pixels:()=>new Uint8ClampedArray(64),timeoutMs:50});
    const assertion=expect(result).rejects.toThrow('timed out');await vi.advanceTimersByTimeAsync(51);await assertion;
    expect(worker.terminate).toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);
  });

  it('enforces the encoded byte cap and cleans up when pixel readback fails',async()=>{
    const worker=new GifWorker();worker.output={byteLength:MAX_GIF_BYTES+1} as ArrayBuffer;
    await expect(encodeGif({canvas,durationMs:1000,fps:12,render:()=>{}},{worker:()=>worker,pixels:()=>new Uint8ClampedArray(64)})).rejects.toThrow('exceeded 64 MB');
    expect(worker.terminate).toHaveBeenCalled();
    const broken=new GifWorker();
    await expect(encodeGif({canvas,durationMs:1000,fps:12,render:()=>{}},{worker:()=>broken,pixels:()=>{throw new Error('Canvas unavailable.');}})).rejects.toThrow('Canvas unavailable');
    expect(broken.terminate).toHaveBeenCalled();
  });

  it('writes a real looping GIF with correct dimensions, delays and final colors',async()=>{
    const responses:GifResponse[]=[],scope={onmessage:null as null|((event:MessageEvent<GifRequest>)=>void),postMessage:(message:GifResponse)=>{responses.push(message);},close:vi.fn()};
    vi.stubGlobal('self',scope);
    await import('../src/export/gif.worker');
    const pixels=(final:boolean)=>{
      const rgba=new Uint8Array(4*4*4);
      for(let pixel=0;pixel<16;pixel++){const rgb=final&&pixel<15?(pixel<8?[255,0,0]:[0,0,255]):[255,255,255];rgba.set([...rgb,255],pixel*4);}
      return rgba.buffer;
    };
    const send=(message:GifRequest)=>scope.onmessage!({data:message} as MessageEvent<GifRequest>);
    send({type:'init',id:1,width:4,height:4,rgba:pixels(true),maxBytes:MAX_GIF_BYTES});
    send({type:'frame',id:2,rgba:pixels(false),delayMs:100});
    send({type:'frame',id:3,rgba:pixels(true),delayMs:100});
    send({type:'finish',id:4});
    expect(responses.map(response=>response.type)).toEqual(['ready','frame','frame','done']);
    const bytes=Buffer.from(responses.at(-1)!.bytes!);
    expect(bytes.subarray(0,6).toString()).toBe('GIF89a');expect(bytes.at(-1)).toBe(0x3b);
    const metadata=await sharp(bytes,{animated:true}).metadata();
    expect(metadata).toMatchObject({format:'gif',width:4,pages:2,pageHeight:4,delay:[100,100],loop:0});
    const decoded=await sharp(bytes,{animated:true}).ensureAlpha().raw().toBuffer();
    expect([...decoded.subarray(0,3)]).toEqual([255,255,255]);
    expect([...decoded.subarray(64,67)]).toEqual([255,0,0]);expect(scope.close).toHaveBeenCalledOnce();
  });
});
