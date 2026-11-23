import {describe,expect,it,vi} from 'vitest';
import {ArtworkCache} from '../src/tree/artwork-cache';
import type {ArtworkImage} from '../src/tree/artwork-image-loader';
import {StickerDelivery,chooseStickerSheets,validateSheetIndex,versionArtworkUrl,type StickerSheetIndex} from '../src/tree/sticker-delivery';

const settings={version:1,revision:'catalog',indexUrl:'/data/sheets-hash.json',artworkRevision:'art-hash'};
const index:StickerSheetIndex={version:1,revision:'catalog',sheets:[{path:'/sticker-sheets/overview-hash.webp',tier:32,width:128,height:32,bytes:3000}],images:Object.fromEntries(['a','b','c','d'].map((name,i)=>[`/stickers/32/${name}.webp`,[0,i*32,0,32,32,1000]]))};
const keys=Object.keys(index.images),sheet={naturalWidth:128,naturalHeight:32} as HTMLImageElement;
const flush=async()=>{for(let i=0;i<16;i++)await Promise.resolve();};

describe('overview delivery',()=>{
  it('uses shared sheets for several requested birds, with a bounded extra-byte allowance',()=>{
    expect([...chooseStickerSheets(index,keys.slice(0,3))]).toEqual([0]);
    expect([...chooseStickerSheets(index,keys.slice(0,2))]).toEqual([0]);
    expect([...chooseStickerSheets(index,keys.slice(0,1))]).toEqual([]);
    expect([...chooseStickerSheets({...index,sheets:[{...index.sheets[0],bytes:24001}]},keys.slice(0,3))]).toEqual([]);
    expect([...chooseStickerSheets(index,[keys[0],keys[0],keys[0]])]).toEqual([]);
  });
  it('deduplicates sheet fetches and returns only the exact requested crops',async()=>{
    const requested:string[]=[],crops:number[][]=[];
    const delivery=new StickerDelivery({config:settings,fetchIndex:async()=>index,loadImage:async path=>{requested.push(path);return sheet;},crop:async(_image,crop)=>{crops.push(crop);return{width:crop[3],height:crop[4]} as HTMLCanvasElement;}});
    delivery.prepare(keys.slice(0,3).map(key=>({key})));
    const images=await Promise.all(keys.slice(0,3).map(path=>delivery.load(path)));
    expect(images).toHaveLength(3);expect(requested).toEqual([index.sheets[0].path]);
    expect(crops.map(crop=>crop[1])).toEqual([0,32,64]);
    expect(delivery.metrics()).toMatchObject({sheetRequests:1,sheetHits:2,sheetCrops:3,directRequests:0});
    delivery.dispose();
  });
  it('falls back to versioned individual art when the manifest or sheet fails',async()=>{
    for(const badIndex of [true,false]){
      const requested:string[]=[];
      const delivery=new StickerDelivery({config:settings,fetchIndex:async()=>badIndex?{...index,revision:'old'}:index,loadImage:async path=>{requested.push(path);if(path.startsWith('/sticker-sheets/'))throw new Error('offline');return sheet;}});
      delivery.prepare(keys.map(key=>({key})));
      await delivery.load(keys[0]);await delivery.load(keys[1]);
      expect(requested.filter(path=>path.startsWith('/stickers/'))).toEqual(keys.slice(0,2).map(path=>`${path}?v=art-hash`));
      expect(requested.filter(path=>path.startsWith('/sticker-sheets/'))).toHaveLength(badIndex?0:1);
      delivery.dispose();
    }
  });
  it('rejects external and out-of-bounds metadata and versions only known local sticker routes',()=>{
    expect(()=>validateSheetIndex({...index,sheets:[{...index.sheets[0],path:'https://example.com/sheet.webp'}]},'catalog')).toThrow();
    expect(()=>validateSheetIndex({...index,images:{[keys[0]]:[0,127,0,32,32,1000]}},'catalog')).toThrow();
    expect(versionArtworkUrl('/stickers/128/bird.webp','new')).toBe('/stickers/128/bird.webp?v=new');
    expect(versionArtworkUrl('/stickers/128/bird.webp?v=old','new')).toBe('/stickers/128/bird.webp?v=new');
    expect(versionArtworkUrl('https://example.com/bird.webp','new')).toBe('https://example.com/bird.webp');
  });
  it('releases unneeded sheet memory and closes evicted bitmap crops',async()=>{
    let closed=0;
    const delivery=new StickerDelivery({config:settings,fetchIndex:async()=>index,maxSheetBytes:1,loadImage:async()=>sheet,crop:async()=>({width:32,height:32,close:()=>closed++}) as ImageBitmap});
    const cache=new ArtworkCache<ArtworkImage>({load:path=>delivery.load(path),prepare:requests=>delivery.prepare(requests),dispose:()=>delivery.dispose(),release:image=>{if('close'in image)image.close();},capacity:1});
    cache.setWanted(keys.slice(0,3).map(key=>({key})));await cache.settleVisible(1000);
    expect(cache.metrics().visibleReady).toBe(3);expect(delivery.metrics().sheetDecodedBytes).toBe(0);
    cache.setWanted([{key:keys[0]}]);expect(closed).toBe(2);
    cache.dispose();expect(closed).toBe(3);await flush();
  });
  it('closes a crop completed after disposal without returning an abandoned image',async()=>{
    let finish!:(value:ArtworkImage)=>void,closed=0;
    const delivery=new StickerDelivery({config:settings,fetchIndex:async()=>index,loadImage:async()=>sheet,crop:()=>new Promise(resolve=>{finish=resolve;})});
    delivery.prepare(keys.map(key=>({key})));
    const pending=delivery.load(keys[0]);const rejected=expect(pending).rejects.toThrow('disposed');await flush();
    delivery.dispose();finish({width:32,height:32,close:()=>closed++} as ImageBitmap);
    await rejected;expect(closed).toBe(1);expect(delivery.metrics().sheetDecodedBytes).toBe(0);
  });
  it('falls back to a canvas if GPU cropping stalls, and closes a late bitmap',async()=>{
    vi.useFakeTimers();let finish!:(value:ImageBitmap)=>void,closed=0;
    const canvas={width:0,height:0,getContext:()=>({drawImage:()=>{}})} as unknown as HTMLCanvasElement;
    vi.stubGlobal('createImageBitmap',()=>new Promise<ImageBitmap>(resolve=>{finish=resolve;}));
    vi.stubGlobal('document',{createElement:()=>canvas});
    const delivery=new StickerDelivery({config:settings,fetchIndex:async()=>index,loadImage:async()=>sheet});
    try{
      delivery.prepare(keys.map(key=>({key})));
      const pending=delivery.load(keys[0]);await flush();
      await vi.advanceTimersByTimeAsync(100);
      expect(await pending).toBe(canvas);expect(canvas.width).toBe(32);expect(canvas.height).toBe(32);
      finish({width:32,height:32,close:()=>closed++} as ImageBitmap);await flush();expect(closed).toBe(1);
      expect(delivery.metrics()).toMatchObject({sheetCrops:1,sheetFailures:0});
    }finally{delivery.dispose();vi.useRealTimers();vi.unstubAllGlobals();}
  });
});
