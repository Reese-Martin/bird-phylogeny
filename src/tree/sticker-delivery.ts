import config from '../generated/sticker-delivery.json';
import { ArtworkCache, type ArtworkRequest } from './artwork-cache';
import { LocalImageLoader, type ArtworkImage } from './artwork-image-loader';

export interface StickerSheet { path: string; tier: number; width: number; height: number; bytes: number }
export type SheetCrop = [sheet: number, x: number, y: number, width: number, height: number, bytes: number];
export interface StickerSheetIndex { version: number; revision: string; sheets: StickerSheet[]; images: Record<string, SheetCrop> }
interface DeliveryConfig { version: number; revision: string; indexUrl: string; artworkRevision: string }
interface SheetEntry { promise: Promise<HTMLImageElement>; image?: HTMLImageElement; users: number; touched: number }
interface DeliveryOptions {
  config?: DeliveryConfig;
  fetchIndex?: () => Promise<unknown>;
  loadImage?: (path: string) => Promise<HTMLImageElement>;
  crop?: (image: HTMLImageElement, crop: SheetCrop) => Promise<ArtworkImage>;
  maxSheetBytes?: number;
}

const settings: DeliveryConfig = config;
const plainPath = (path: string) => path.split('?')[0];
export function versionArtworkUrl(path: string, revision = settings.artworkRevision): string {
  if (!/^\/stickers\/(32|64|128|384)\/[^/?]+\.webp(?:\?.*)?$/.test(path)) return path;
  return `${plainPath(path)}?v=${revision}`;
}
export function artworkDimensions(image: ArtworkImage): { width: number; height: number } {
  return 'naturalWidth' in image ? { width: image.naturalWidth, height: image.naturalHeight } : { width: image.width, height: image.height };
}
function releaseArtwork(image: ArtworkImage) { if ('close' in image) image.close(); }

export function validateSheetIndex(value: unknown, revision: string): StickerSheetIndex {
  const index = value as StickerSheetIndex;
  if (!index || index.version !== 1 || index.revision !== revision || !Array.isArray(index.sheets) || !index.images || typeof index.images !== 'object' || index.sheets.length > 2000) throw new Error('Invalid sticker sheet catalog.');
  for (const sheet of index.sheets) {
    if (!sheet || !/^\/sticker-sheets\/[a-zA-Z0-9_-]+\.webp$/.test(sheet.path) || ![32,64].includes(sheet.tier) || ![sheet.width,sheet.height,sheet.bytes].every(n=>Number.isSafeInteger(n)&&n>0) || sheet.width > 1024 || sheet.height > 1024) throw new Error('Invalid sticker sheet.');
  }
  for (const [path, crop] of Object.entries(index.images)) {
    if (!/^\/stickers\/(32|64)\/[^/?]+\.webp$/.test(path) || !Array.isArray(crop) || crop.length !== 6 || !crop.every(Number.isSafeInteger)) throw new Error('Invalid sticker crop.');
    const [sheetId,x,y,width,height,bytes] = crop, sheet = index.sheets[sheetId];
    if (!sheet || Number(path.split('/')[2]) !== sheet.tier || x<0 || y<0 || width<=0 || height<=0 || bytes<=0 || Math.max(width,height)>sheet.tier || x+width>sheet.width || y+height>sheet.height) throw new Error('Sticker crop exceeds its sheet.');
  }
  return index;
}

/** Only fetch a sheet when shared HTTP work justifies its extra unseen bytes. */
export function chooseStickerSheets(index: StickerSheetIndex, paths: Iterable<string>): Set<number> {
  const groups = new Map<number, { count: number; bytes: number }>();
  for (const path of new Set([...paths].map(plainPath))) {
    const crop=index.images[path]; if (!crop) continue;
    const group=groups.get(crop[0])||{count:0,bytes:0};group.count++;group.bytes+=crop[5];groups.set(crop[0],group);
  }
  return new Set([...groups].filter(([id,group])=>group.count>=2 && index.sheets[id].bytes<=group.bytes*8).map(([id])=>id));
}

async function cropArtwork(image: HTMLImageElement, crop: SheetCrop): Promise<ArtworkImage> {
  const [,x,y,width,height]=crop;
  if (typeof createImageBitmap === 'function') {
    let expired=false,timer:ReturnType<typeof setTimeout>|undefined;
    try {
      const bitmap=await Promise.race([
        createImageBitmap(image,x,y,width,height).then(value=>{if(expired){value.close();return undefined;}return value;},()=>undefined),
        new Promise<undefined>(resolve=>{timer=setTimeout(()=>resolve(undefined),100);}),
      ]);
      if(bitmap)return bitmap;
    } catch { /* Canvas crop supports older browsers and allocation fallback. */ }
    finally {expired=true;clearTimeout(timer);}
  }
  const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;
  const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Could not crop overview artwork.');
  ctx.drawImage(image,x,y,width,height,0,0,width,height);return canvas;
}

/** Bounded sheet cache; the main artwork cache retains only requested crops. */
export class StickerDelivery {
  private loader=new LocalImageLoader();
  private catalog?: StickerSheetIndex;
  private catalogPromise?: Promise<StickerSheetIndex|undefined>;
  private controller=new AbortController();
  private wanted: string[]=[];
  private chosen=new Set<number>();
  private sheets=new Map<number,SheetEntry>();
  private failedSheets=new Set<number>();
  private stopped=false;
  private clock=0;
  private counters={sheetRequests:0,sheetHits:0,sheetCrops:0,sheetFailures:0,directRequests:0,indexFailures:0};
  private settings: DeliveryConfig;
  private maxSheetBytes: number;
  constructor(private options: DeliveryOptions={}) {this.settings=options.config||settings;this.maxSheetBytes=options.maxSheetBytes??8*1024*1024;}
  prepare(requests: ArtworkRequest[]) {
    const paths=requests.map(request=>plainPath(request.key));
    if(paths.length===this.wanted.length && paths.every((path,i)=>path===this.wanted[i]))return;
    this.wanted=paths;if(this.catalog)this.chosen=chooseStickerSheets(this.catalog,paths);
  }
  private index() {
    if(!this.catalogPromise)this.catalogPromise=(async()=>{
      const timer=setTimeout(()=>this.controller.abort(),4000);
      try {
        const raw=this.options.fetchIndex?await this.options.fetchIndex():await fetch(this.settings.indexUrl,{signal:this.controller.signal}).then(response=>{if(!response.ok)throw new Error('Sticker sheets unavailable.');return response.json();});
        const index=validateSheetIndex(raw,this.settings.revision);if(this.stopped)return undefined;
        this.catalog=index;this.chosen=chooseStickerSheets(index,this.wanted);return index;
      }catch{this.counters.indexFailures++;return undefined;}finally{clearTimeout(timer);}
    })();
    return this.catalogPromise;
  }
  private image(path:string) {return this.options.loadImage?this.options.loadImage(path):this.loader.load(path);}
  async load(path:string):Promise<ArtworkImage> {
    if(this.stopped)throw new Error('Artwork loader disposed.');
    const normalized=plainPath(path);
    if(/^\/stickers\/(32|64)\//.test(normalized)) {
      const index=await this.index(),crop=index?.images[normalized];
      if(index && crop && this.chosen.has(crop[0]) && !this.failedSheets.has(crop[0])) {
        let entry=this.sheets.get(crop[0]);
        if(!entry){
          this.counters.sheetRequests++;
          entry={promise:this.image(index.sheets[crop[0]].path),users:0,touched:++this.clock};
          this.sheets.set(crop[0],entry);
        }else this.counters.sheetHits++;
        entry.users++;entry.touched=++this.clock;
        try {
          const image=await entry.promise;entry.image=image;
          const sheet=index.sheets[crop[0]];
          if(image.naturalWidth!==sheet.width||image.naturalHeight!==sheet.height)throw new Error('Sticker sheet dimensions changed.');
          if(this.stopped)throw new Error('Artwork loader disposed.');
          const result=await (this.options.crop||cropArtwork)(image,crop);
          if(this.stopped){releaseArtwork(result);throw new Error('Artwork loader disposed.');}
          this.counters.sheetCrops++;return result;
        }catch{
          this.failedSheets.add(crop[0]);this.counters.sheetFailures++;this.sheets.delete(crop[0]);
        }finally{entry.users--;this.trimSheets();}
      }
    }
    if(this.stopped)throw new Error('Artwork loader disposed.');
    this.counters.directRequests++;return this.image(versionArtworkUrl(path,this.settings.artworkRevision));
  }
  private sheetBytes(){let bytes=0;for(const entry of this.sheets.values())if(entry.image)bytes+=entry.image.naturalWidth*entry.image.naturalHeight*4;return bytes;}
  private trimSheets(){
    let bytes=this.sheetBytes();
    for(const [id,entry]of [...this.sheets].sort((a,b)=>a[1].touched-b[1].touched)){
      if(bytes<=this.maxSheetBytes)break;
      if(entry.users||!entry.image)continue;
      bytes-=entry.image.naturalWidth*entry.image.naturalHeight*4;this.sheets.delete(id);
    }
  }
  metrics():Record<string,number>{return{...this.counters,sheetDecodedBytes:this.sheetBytes(),...this.loader.metrics()};}
  dispose(){this.stopped=true;this.controller.abort();this.sheets.clear();this.wanted=[];this.loader.dispose();}
}

export function createArtworkCache(onChange:()=>void) {
  const delivery=new StickerDelivery();
  return new ArtworkCache<ArtworkImage>({load:path=>delivery.load(path),prepare:requests=>delivery.prepare(requests),dispose:()=>delivery.dispose(),deliveryMetrics:()=>delivery.metrics(),release:releaseArtwork,concurrency:24,capacity:512,onChange});
}
