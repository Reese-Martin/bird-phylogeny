import {describe,expect,it} from 'vitest';
import type {Taxon} from '../src/types';
import {ArtworkCache} from '../src/tree/artwork-cache';
import {ArtworkResolver,artworkRequests,baseArtworkPath,grayscalePixels,readyArtwork} from '../src/tree/artwork-resolution';

const bird=Object.freeze({code:'bird',category:'species',commonName:'Bird',scientificName:'Avis avis',stickerSmall:'/stickers/128/bird.webp',sticker:'/stickers/384/bird.webp'}) as Taxon;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

describe('artwork resolution selection',()=>{
  it('uses physical pixels and capped DPR without changing taxon data or portrait geometry',()=>{
    const before=JSON.stringify(bird),geometry=Object.freeze({x:1.25,y:-.5,width:.2,height:.12,angle:Math.PI/3});
    for(const [css,dpr,tier]of [[20,1,32],[20,2,64],[20,3,64],[40,1,64],[40,2,128],[80,2,384],[800,1,384]]){
      const selected=new ArtworkResolver().select(bird,css,dpr);
      expect(selected.key).toBe(`/stickers/${tier}/bird.webp`);expect(selected.tier).toBe(tier);
      expect(selected).not.toHaveProperty('width');expect(selected).not.toHaveProperty('height');
      expect(geometry).toEqual({x:1.25,y:-.5,width:.2,height:.12,angle:Math.PI/3});
    }
    expect(JSON.stringify(bird)).toBe(before);
  });

  it('keeps each requested tier stable across promotion and demotion hysteresis boundaries',()=>{
    const resolver=new ArtworkResolver();
    expect(resolver.select(bird,31).tier).toBe(32);
    expect(resolver.select(bird,35.2).tier).toBe(32);
    expect(resolver.select(bird,35.21).tier).toBe(64);
    expect(resolver.select(bird,24).tier).toBe(64);
    expect(resolver.select(bird,23.99).tier).toBe(32);
    expect(resolver.select(bird,64).tier).toBe(64);
    expect(resolver.select(bird,70.4).tier).toBe(64);
    expect(resolver.select(bird,70.41).tier).toBe(128);
    expect(resolver.select(bird,48).tier).toBe(128);
    expect(resolver.select(bird,47.99).tier).toBe(64);
    expect(resolver.select(bird,128).tier).toBe(128);
    expect(resolver.select(bird,140.8).tier).toBe(128);
    expect(resolver.select(bird,140.81).tier).toBe(384);
    expect(resolver.select(bird,96).tier).toBe(384);
    expect(resolver.select(bird,95.99).tier).toBe(128);
  });

  it('supports legacy paths, supplies every other local tier as fallback, and honors artwork rejection',()=>{
    const selected=new ArtworkResolver().select(bird,40);
    expect(selected.fallbackKeys).toEqual(['/stickers/32/bird.webp','/stickers/128/bird.webp','/stickers/384/bird.webp']);
    expect(new Set(selected.fallbackKeys).size).toBe(selected.fallbackKeys.length);
    expect(new ArtworkResolver().select({...bird,stickerSmall:'/local/custom.png'},10).key).toBe('/local/custom.png');
    expect(new ArtworkResolver().select({...bird,stickerSmall:undefined},10).key).toBe('/stickers/32/bird.webp');
    expect(baseArtworkPath({...bird,artworkStatus:'quality-fallback'})).toBeUndefined();
    expect(new ArtworkResolver().select({...bird,artworkStatus:'rejected'},20)).toEqual({fallbackKeys:[],tier:0});
  });
});

describe('continuous artwork during tier changes',()=>{
  it('keeps the ready32px bird visible while its128px promotion loads, then releases the old copy',async()=>{
    const finishes=new Map<string,(image:{naturalWidth:number;naturalHeight:number})=>void>();
    const loads:string[]=[];
    const cache=new ArtworkCache<{naturalWidth:number;naturalHeight:number}>({load:key=>{loads.push(key);return new Promise(resolve=>finishes.set(key,resolve));}});
    const low=new ArtworkResolver().select(bird,20),high=new ArtworkResolver().select(bird,80);
    cache.setWanted(artworkRequests(cache,low));await flush();finishes.get(low.key!)!({naturalWidth:32,naturalHeight:24});await flush();
    const old=readyArtwork(cache,low)!;
    const requests=artworkRequests(cache,high,500,['gray']);
    expect(requests.map(r=>r.key)).toEqual([high.key,low.key]);
    cache.setWanted(requests);await flush();
    expect(cache.peek(high.key!)?.state).toBe('loading');expect(readyArtwork(cache,high)).toEqual(old);
    expect(cache.metrics().visibleReady).toBe(1);
    finishes.get(high.key!)!({naturalWidth:128,naturalHeight:96});await flush();
    cache.setWanted(artworkRequests(cache,high));
    expect(readyArtwork(cache,high)?.key).toBe(high.key);expect(cache.peek(low.key!)).toBeUndefined();
    expect(cache.metrics()).toMatchObject({visibleReady:1,decodedBytes:128*96*4,evictions:1});
    expect(loads).toEqual([low.key,high.key]);
  });

  it('disposes unused384px copies once a32px replacement is ready even below the nominal budget',async()=>{
    const finishes=new Map<string,(image:{width:number;height:number})=>void>();
    const cache=new ArtworkCache<{width:number;height:number}>({load:key=>new Promise(resolve=>finishes.set(key,resolve))});
    const high=new ArtworkResolver().select(bird,300),low=new ArtworkResolver().select(bird,20);
    // Simulate a retained full-resolution image from an earlier close-up.
    cache.setWanted([{key:high.key!,fallbackKeys:high.fallbackKeys}]);await flush();finishes.get(high.key!)!({width:384,height:384});await flush();
    cache.setWanted(artworkRequests(cache,low));await flush();
    expect(readyArtwork(cache,low)?.key).toBe(high.key);expect(cache.peek(high.key!)?.state).toBe('ready');
    finishes.get(low.key!)!({width:32,height:32});await flush();
    cache.setWanted(artworkRequests(cache,low));
    expect(cache.peek(high.key!)).toBeUndefined();expect(cache.metrics()).toMatchObject({ready:1,visibleReady:1,decodedBytes:4096,visibleTiers:{32:1}});
  });

  it('loads a small overview before its sharp copy and keeps that overview visible throughout promotion',async()=>{
    const finishes=new Map<string,(value:{width:number;height:number})=>void>(),loads:string[]=[];
    const cache=new ArtworkCache<{width:number;height:number}>({load:key=>{loads.push(key);return new Promise(resolve=>finishes.set(key,resolve));}});
    const high=new ArtworkResolver().select(bird,80);
    const preview='/stickers/32/bird.webp';
    cache.setWanted(artworkRequests(cache,high));await flush();
    expect(loads).toEqual([preview]);
    expect(readyArtwork(cache,high)).toBeUndefined();
    finishes.get(preview)!({width:32,height:24});await flush();
    cache.setWanted(artworkRequests(cache,high));await flush();
    expect(loads).toEqual([preview,high.key]);
    expect(readyArtwork(cache,high)?.key).toBe(preview);
    finishes.get(high.key!)!({width:128,height:96});await flush();
    cache.setWanted(artworkRequests(cache,high));
    expect(readyArtwork(cache,high)?.key).toBe(high.key);
    expect(cache.peek(preview)).toBeUndefined();
  });

  it('falls back to an existing tier if an overview file is missing and does not retry every redraw',async()=>{
    const loads:string[]=[];
    const cache=new ArtworkCache<{width:number;height:number}>({load:async key=>{loads.push(key);if(!key.includes('/128/'))throw new Error('File missing');return {width:128,height:96};}});
    const selection=new ArtworkResolver().select(bird,20);
    cache.setWanted(artworkRequests(cache,selection));await cache.settleVisible(1000);
    expect(loads).toEqual(['/stickers/32/bird.webp','/stickers/64/bird.webp','/stickers/128/bird.webp']);
    expect(readyArtwork(cache,selection)?.value).toEqual({width:128,height:96});
    expect(cache.metrics()).toMatchObject({visibleReady:1,visibleFailed:0,visibleTiers:{128:1}});
    for(let i=0;i<20;i++)cache.setWanted(artworkRequests(cache,selection));
    await flush();expect(loads).toHaveLength(3);
  });

  it('ends a completely missing image in one failed state after trying all supported tiers once',async()=>{
    const loads:string[]=[];
    const cache=new ArtworkCache<unknown>({load:async key=>{loads.push(key);throw new Error('File missing');}});
    const selection=new ArtworkResolver().select(bird,20);
    cache.setWanted(artworkRequests(cache,selection));await cache.settleVisible(1000);
    expect(loads).toHaveLength(4);expect(new Set(loads).size).toBe(4);expect(readyArtwork(cache,selection)).toBeUndefined();
    for(let i=0;i<20;i++)cache.setWanted(artworkRequests(cache,selection));
    await flush();expect(loads).toHaveLength(4);expect(cache.metrics()).toMatchObject({visibleReady:0,visibleFailed:1,visibleActive:0,visibleQueued:0});
  });
});

describe('neutralized illustration pixels',()=>{
  it('makes every pixel neutral while retaining partial, opaque and zero alpha exactly',()=>{
    const pixels=new Uint8ClampedArray([255,0,0,0,0,255,0,83,0,0,255,255,80,80,80,127]);
    const original=pixels.slice();grayscalePixels(pixels);
    for(let i=0;i<pixels.length;i+=4){expect(pixels[i]).toBe(pixels[i+1]);expect(pixels[i]).toBe(pixels[i+2]);expect(pixels[i+3]).toBe(original[i+3]);}
    expect([...pixels]).toEqual([54,54,54,0,182,182,182,83,18,18,18,255,80,80,80,127]);
  });
});
