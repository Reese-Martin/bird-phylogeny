import { describe, expect, it } from 'vitest';
import { ArtworkCache,ArtworkVariantBatch } from '../src/tree/artwork-cache';

const flush = async () => { for (let index = 0; index < 8; index++) await Promise.resolve(); };

describe('decoded artwork scheduling', () => {
  it('bounds concurrency, prioritizes representatives, and does not restart visible loads on redraw', async () => {
    const started: string[] = [];
    const finish = new Map<string, (value: string) => void>();
    const cache = new ArtworkCache<string>({ concurrency: 2, load: (key) => { started.push(key); return new Promise((resolve) => finish.set(key, resolve)); } });
    cache.setWanted([{ key: 'species', priority: 1 }, { key: 'order', priority: 10 }, { key: 'selected', priority: 20 }]);
    await flush();
    expect(started).toEqual(['selected', 'order']);
    for (let index = 0; index < 20; index++) cache.setWanted([{ key: 'species', priority: 1 }, { key: 'order', priority: 10 }, { key: 'selected', priority: 20 }]);
    expect(started).toHaveLength(2);
    expect(cache.metrics().active).toBe(2);
    finish.get('selected')!('decoded-selected'); await flush();
    expect(started).toEqual(['selected', 'order', 'species']);
    expect(cache.get('selected')).toEqual({ state: 'ready', value: 'decoded-selected' });
    expect(cache.metrics().cacheHits).toBe(1);
    finish.get('order')!('decoded-order'); finish.get('species')!('decoded-species'); await flush();
    expect(cache.metrics().visibleReady).toBe(3);
    expect(cache.metrics().active).toBe(0);
  });

  it('drops obsolete queued work, retains in-flight work and reuses decoded images across views', async () => {
    const started: string[] = [];
    const finish = new Map<string, (value: string) => void>();
    const cache = new ArtworkCache<string>({ concurrency: 1, load: (key) => { started.push(key); return new Promise((resolve) => finish.set(key, resolve)); } });
    cache.setWanted([{ key: 'a' }, { key: 'obsolete' }]); await flush();
    cache.setWanted([{ key: 'b' }]);
    expect(cache.metrics().active).toBe(1);
    finish.get('a')!('a'); await flush();
    expect(started).toEqual(['a', 'b']);
    finish.get('b')!('b'); await flush();
    cache.setWanted([{ key: 'a' }]);
    expect(cache.get('a')?.state).toBe('ready');
    expect(started).toEqual(['a', 'b']);
  });

  it('evicts only old decoded entries, protecting the chosen visible images', async () => {
    const cache = new ArtworkCache<string>({ capacity: 2, load: async (key) => key });
    cache.setWanted([{ key: 'a' }]); await flush();
    cache.setWanted([{ key: 'b' }]); await flush();
    cache.setWanted([{ key: 'c' }]); await flush();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')?.value).toBe('b');
    expect(cache.get('c')?.value).toBe('c');
    expect(cache.metrics().ready).toBe(2);
    expect(cache.metrics().evictions).toBe(1);
  });

  it('finishes every visible sticker above the retention limit and releases hidden images afterward', async () => {
    const requests: string[] = [];
    const cache = new ArtworkCache<string>({ capacity: 2, concurrency: 2, load: async key => { requests.push(key); return key; } });
    const all = Array.from({ length: 5 }, (_, index) => ({ key: `bird-${index}` }));
    cache.setWanted(all);
    await cache.settleVisible(1000);
    expect(cache.metrics().visibleReady).toBe(5);
    expect(cache.metrics().visibleQueued + cache.metrics().visibleActive).toBe(0);
    expect(requests).toHaveLength(5);
    cache.setWanted(all);
    expect(requests).toHaveLength(5);
    expect(cache.metrics().evictions).toBe(0);
    cache.setWanted([{ key: 'bird-4' }]);
    expect(cache.get('bird-4')?.state).toBe('ready');
    expect(cache.metrics().ready).toBe(2);
    expect(cache.metrics().evictions).toBe(3);
  });

  it('keeps loading and genuine failure distinct, without retrying a failed file on every frame', async () => {
    let requests = 0;
    const cache = new ArtworkCache<string>({ load: async () => { requests++; throw new Error('not found'); } });
    cache.setWanted([{ key: 'broken' }]);
    expect(cache.get('broken')?.state).toBe('loading');
    await flush();
    expect(cache.get('broken')?.state).toBe('failed');
    for (let index = 0; index < 20; index++) cache.setWanted([{ key: 'broken' }]);
    expect(requests).toBe(1);
    expect(cache.metrics().visibleFailed).toBe(1);
    expect(cache.metrics().visibleActive).toBe(0);
  });

  it('settles all700 wanted images above both soft limits and trims only hidden images afterward',async()=>{
    let loads=0;
    const cache=new ArtworkCache<{width:number;height:number}>({capacity:512,maxDecodedBytes:65536,concurrency:6,load:async()=>{loads++;return {width:32,height:16};}});
    const all=Array.from({length:700},(_,i)=>({key:`/stickers/32/bird-${i}.webp`}));
    cache.setWanted(all);await cache.settleVisible(2000);
    expect(cache.metrics()).toMatchObject({ready:700,visibleReady:700,visibleQueued:0,visibleActive:0,visibleFailed:0,evictions:0,decodedBytes:700*32*16*4,overBudgetBytes:700*32*16*4-65536,visibleTiers:{32:700}});
    for(let i=0;i<5;i++)cache.setWanted(all);
    expect(loads).toBe(700);
    cache.setWanted(all.slice(0,10));
    expect(cache.metrics().visibleReady).toBe(10);expect(cache.metrics().decodedBytes).toBeLessThanOrEqual(65536);
    for(const request of all.slice(0,10))expect(cache.peek(request.key)?.state).toBe('ready');
    expect(cache.metrics().evictions).toBeGreaterThan(0);
  });

  it('uses byte cost as well as image count, retaining a visible image that alone exceeds the budget',async()=>{
    const cache=new ArtworkCache<{width:number;height:number}>({capacity:512,maxDecodedBytes:8192,load:async key=>({width:key==='large'?128:32,height:32})});
    for(const key of ['a','b','c']){cache.setWanted([{key}]);await cache.settleVisible(1000);}
    expect(cache.peek('a')).toBeUndefined();expect(cache.metrics().decodedBytes).toBe(8192);
    cache.setWanted([{key:'large'}]);await cache.settleVisible(1000);
    expect(cache.metrics()).toMatchObject({visibleReady:1,ready:1,decodedBytes:16384,overBudgetBytes:8192});
    expect(cache.peek('large')?.state).toBe('ready');
  });

  it('reuses successful grayscale variants and drops their bytes as soon as highlighting clears',async()=>{
    const cache=new ArtworkCache<{width:number;height:number}>({load:async()=>({width:32,height:16})});
    cache.setWanted([{key:'bird',variants:['gray']}]);await cache.settleVisible(1000);
    let creates=0;
    const create=()=>{creates++;return {width:32,height:16,neutral:true};};
    const first=cache.variant('bird','gray',create,value=>value.width*value.height*4);
    expect(cache.variant('bird','gray',create,value=>value.width*value.height*4)).toBe(first);expect(creates).toBe(1);
    expect(cache.metrics()).toMatchObject({decodedBytes:4096,visibleDecodedBytes:4096,variantBytes:2048});
    cache.setWanted([{key:'bird'}]);
    expect(cache.metrics()).toMatchObject({decodedBytes:2048,visibleDecodedBytes:2048,variantBytes:0});
    cache.setWanted([{key:'bird',variants:['gray']}]);
    expect(cache.variant('bird','gray',create,value=>value.width*value.height*4)).not.toBe(first);expect(creates).toBe(2);
  });

  it('keeps every source image usable if variant creation fails, and does not retry the failure each frame',async()=>{
    const image={width:32,height:16};let creates=0;
    const cache=new ArtworkCache<typeof image>({load:async()=>image});
    cache.setWanted([{key:'bird',variants:['gray']}]);await cache.settleVisible(1000);
    const failed=()=>{creates++;throw new Error('Canvas allocation/readback unavailable');};
    for(let i=0;i<10;i++){
      cache.setWanted([{key:'bird',variants:['gray']}]);
      expect(()=>cache.variant('bird','gray',failed,()=>2048)).not.toThrow();
      expect(cache.variant('bird','gray',failed,()=>2048)).toBeUndefined();
      expect(cache.getReady(['bird'])?.value).toBe(image);
    }
    expect(creates).toBe(1);expect(cache.metrics()).toMatchObject({visibleReady:1,visibleFailed:0,variantBytes:0});
  });
});

describe('incremental grayscale preparation',()=>{
  it('budgets only new conversions, keeps cached variants immediate, and finishes later birds across frames',async()=>{
    const cache=new ArtworkCache<{width:number;height:number}>({load:async()=>({width:32,height:16})});
    const keys=Array.from({length:8},(_,i)=>`bird-${i}`);cache.setWanted(keys.map(key=>({key,variants:['gray']})));await cache.settleVisible(1000);
    let time=0,created=0;
    const create=()=>{created++;time+=2;return {gray:true,width:32,height:16};};
    const estimate=(value:ReturnType<typeof create>)=>value.width*value.height*4;
    let previousReady=0;
    for(let frame=0;frame<4;frame++){
      const batch=new ArtworkVariantBatch(cache,4,()=>time),drawn=keys.map(key=>batch.get(key,'gray',create,estimate)||cache.getReady([key])!.value);
      expect(drawn).toHaveLength(8);expect(batch.elapsedMs).toBe(4);expect(created).toBe(previousReady+2);expect(batch.createdCount).toBe(2);
      expect(batch.pendingCount).toBe(6-frame*2);previousReady=created;
    }
    const complete=new ArtworkVariantBatch(cache,0,()=>time);
    for(const key of keys)expect(complete.get(key,'gray',create,estimate)).toMatchObject({gray:true});
    expect(complete.pendingCount).toBe(0);expect(complete.elapsedMs).toBe(0);expect(created).toBe(8);
  });

  it('does not request endless frames for failed or not-yet-decoded images',async()=>{
    const cache=new ArtworkCache<{width:number;height:number}>({load:async()=>({width:32,height:16})});
    cache.setWanted([{key:'broken-gray',variants:['gray']}]);await cache.settleVisible(1000);
    let calls=0,time=0;const create=()=>{calls++;time+=3;throw new Error('No canvas memory');};
    for(let frame=0;frame<5;frame++){
      const batch=new ArtworkVariantBatch(cache,4,()=>time);
      expect(batch.get('broken-gray','gray',create,()=>2048)).toBeUndefined();
      expect(batch.get('not-loaded','gray',create,()=>2048)).toBeUndefined();
      expect(batch.pendingCount).toBe(0);expect(batch.failedCount).toBe(1);
      expect(cache.getReady(['broken-gray'])?.value).toEqual({width:32,height:16});
    }
    expect(calls).toBe(1);
  });

  it('stops after one conversion overruns its budget, and supports explicit export flushing',async()=>{
    const cache=new ArtworkCache<{width:number;height:number}>({load:async()=>({width:64,height:48})});
    const keys=['a','b','c'];cache.setWanted(keys.map(key=>({key,variants:['gray']})));await cache.settleVisible(1000);
    let time=0;const create=()=>{time+=6;return {gray:true};};
    const frame=new ArtworkVariantBatch(cache,4,()=>time);
    for(const key of keys)frame.get(key,'gray',create,()=>64*48*4);
    expect(frame.createdCount).toBe(1);expect(frame.elapsedMs).toBe(6);expect(frame.pendingCount).toBe(2);
    const exporting=new ArtworkVariantBatch(cache,Infinity,()=>time);
    for(const key of keys)expect(exporting.get(key,'gray',create,()=>64*48*4)).toEqual({gray:true});
    expect(exporting.createdCount).toBe(2);expect(exporting.elapsedMs).toBe(12);expect(exporting.pendingCount).toBe(0);
  });
});
