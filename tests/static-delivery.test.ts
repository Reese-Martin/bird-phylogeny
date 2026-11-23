import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { createStaticDelivery } from '../scripts/static-delivery';

describe('bounded public static delivery',()=>{
  let root:string,reads:string[],revision:string;
  let delivery:ReturnType<typeof createStaticDelivery>;
  const text=JSON.stringify({birds:Array.from({length:300},(_,i)=>`species-${i}`)});
  async function get(path:string,headers:Record<string,string>={},method='GET'){
    const result={status:200,headers:{} as Record<string,unknown>,body:Buffer.alloc(0)};
    const req={url:path,method,headers} as IncomingMessage;
    const res={statusCode:200,setHeader:(name:string,value:unknown)=>{result.headers[name.toLowerCase()]=value;},end:(bytes?:Buffer|string)=>{result.body=bytes===undefined?Buffer.alloc(0):Buffer.from(bytes);}};
    await delivery.handle(req,res as unknown as ServerResponse);result.status=res.statusCode;return result;
  }
  beforeEach(async()=>{
    root=await mkdtemp(resolve(tmpdir(),'birds-static-'));
    for(const directory of ['data','stickers/32','sticker-sheets','assets','personal'])await mkdir(resolve(root,directory),{recursive:true});
    await writeFile(resolve(root,'index.html'),'<title>Birds&trees</title>');
    await writeFile(resolve(root,'data/tree.json'),text);
    await writeFile(resolve(root,'stickers/32/bird.webp'),Buffer.from('encoded bird'));
    await writeFile(resolve(root,'personal/private.csv'),'PRIVATE OBSERVATIONS');
    await writeFile(resolve(root,'.env'),'SECRET');
    reads=[];revision='catalog-current';
    delivery=createStaticDelivery({root,artworkRevision:()=>revision,maxBytes:1024*1024,onRead:path=>reads.push(path)});
  });
  afterEach(async()=>{
    delivery.clear();
    const target=resolve(root),prefix=resolve(tmpdir())+sep+'birds-static-';
    if(!target.startsWith(prefix))throw new Error('Unsafe temporary test cleanup path');
    await rm(target,{recursive:true,force:true});
  });
  it('coalesces concurrent reads and retains encoded resources across redraws',async()=>{
    const results=await Promise.all(Array.from({length:20},()=>get('/stickers/32/bird.webp?v=catalog-current')));
    expect(results.every(result=>result.status===200&&result.body.toString()==='encoded bird')).toBe(true);
    expect(reads).toEqual(['/stickers/32/bird.webp']);expect(delivery.metrics().inflight).toBe(0);
  });
  it('uses immutable caching only for recognized current artwork revisions',async()=>{
    expect((await get('/stickers/32/bird.webp')).headers['cache-control']).toBe('no-cache');
    expect((await get('/stickers/32/bird.webp?v=old-catalog')).headers['cache-control']).toBe('no-cache');
    expect((await get('/stickers/32/bird.webp?v=catalog-current')).headers['cache-control']).toContain('immutable');
    revision='catalog-next';
    expect((await get('/stickers/32/bird.webp?v=catalog-current')).headers['cache-control']).toBe('no-cache');
    expect((await get('/stickers/32/bird.webp?v=catalog-next')).headers['cache-control']).toContain('immutable');
  });
  it('validates hash-named sheets and manifests before granting immutable caching',async()=>{
    const bytes=Buffer.from('packed overview'),hash=createHash('sha256').update(bytes).digest('hex');
    await writeFile(resolve(root,`sticker-sheets/sheet-${hash}.webp`),bytes);
    await writeFile(resolve(root,'sticker-sheets/sheet-000000000000.webp'),bytes);
    await writeFile(resolve(root,`data/sticker-sheets-${hash}.json`),bytes);
    expect((await get(`/sticker-sheets/sheet-${hash}.webp`)).headers['cache-control']).toContain('immutable');
    expect((await get('/sticker-sheets/sheet-000000000000.webp')).headers['cache-control']).toBe('no-cache');
    expect((await get(`/data/sticker-sheets-${hash}.json`)).headers['cache-control']).toContain('immutable');
  });
  it('compresses text with reusable Brotli/gzip variants and honors explicit exclusions',async()=>{
    const br=await get('/data/tree.json',{'accept-encoding':'gzip, br'}),gz=await get('/data/tree.json',{'accept-encoding':'gzip;q=1, br;q=0'}),plain=await get('/data/tree.json',{'accept-encoding':'gzip;q=0, br;q=0'});
    expect(br.headers['content-encoding']).toBe('br');expect(brotliDecompressSync(br.body).toString()).toBe(text);
    expect(gz.headers['content-encoding']).toBe('gzip');expect(gunzipSync(gz.body).toString()).toBe(text);
    expect(plain.headers['content-encoding']).toBeUndefined();expect(plain.body.toString()).toBe(text);
    expect(br.headers.vary).toBe('Accept-Encoding');expect(br.body.length).toBeLessThan(plain.body.length);
    await get('/data/tree.json',{'accept-encoding':'br'});expect(reads).toEqual(['/data/tree.json']);
  });
  it('supports conditional requests and HEAD without body bytes',async()=>{
    const first=await get('/data/tree.json',{'accept-encoding':'br'}),cached=await get('/data/tree.json',{'accept-encoding':'br','if-none-match':String(first.headers.etag)}),head=await get('/data/tree.json',{'accept-encoding':'br'},'HEAD');
    expect(cached.status).toBe(304);expect(cached.body.length).toBe(0);
    expect(head.status).toBe(200);expect(head.body.length).toBe(0);expect(Number(head.headers['content-length'])).toBe(first.body.length);expect(head.headers.etag).toBe(first.headers.etag);
    expect((await get('/data/tree.json',{'if-none-match':String(first.headers.etag)})).status).toBe(200);
  });
  it('serves only public routes and rejects workspace/private/traversal paths',async()=>{
    for(const path of ['/personal/private.csv','/.env','/data/../../personal/private.csv','/data/%2e%2e%2f%2e%2e%2fpersonal/private.csv','/data/%5c..%5cpersonal/private.csv','/data/missing.json','/@fs/C:/Users/ramar/private.csv']){
      const result=await get(path);expect(result.status,path).toBe(404);expect(result.body.toString()).not.toContain('PRIVATE');expect(result.headers['cache-control']).toBe('no-cache');
    }
    expect((await get('/')).status).toBe(200);expect((await get('/index.html')).headers['cache-control']).toBe('no-cache');
    expect((await get('/data/tree.json',{},'POST')).status).toBe(405);
  });
  it('enforces a hard encoded-cache byte budget without dropping response bodies',async()=>{
    delivery.clear();
    delivery=createStaticDelivery({root,artworkRevision:revision,maxBytes:16});
    expect((await get('/data/tree.json')).body.toString()).toBe(text);expect(delivery.metrics().retainedBytes).toBeLessThanOrEqual(16);
    expect((await get('/stickers/32/bird.webp')).body.toString()).toBe('encoded bird');expect(delivery.metrics().retainedBytes).toBeLessThanOrEqual(16);
  });
});
