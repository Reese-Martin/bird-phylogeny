import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, extname } from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants } from 'node:zlib';

const brotli = promisify(brotliCompress), gz = promisify(gzip);
const immutable = 'public, max-age=31536000, immutable';
const mime: Record<string, string> = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.json':'application/json; charset=utf-8', '.svg':'image/svg+xml', '.webp':'image/webp', '.png':'image/png', '.jpg':'image/jpeg', '.woff2':'font/woff2', '.csv':'text/csv; charset=utf-8', '.txt':'text/plain; charset=utf-8' };
const artworkRoute = /^\/(?:stickers\/(?:32|64|128|384)\/[^/]+\.webp|sticker-sheets\/[^/]+\.webp|data\/sticker-sheets-[a-f0-9]+\.json)$/;
const publicRoute = /^\/(?:index\.html|favicon\.svg|assets\/[A-Za-z0-9_.-]+|data\/[A-Za-z0-9_.-]+\.json|fonts\/[A-Za-z0-9_./-]+|demo\/[A-Za-z0-9_.-]+|stickers\/(?:32|64|128|384)\/[^/]+\.webp|sticker-sheets\/[^/]+\.webp)$/;

export interface StaticDeliveryOptions {
  root: string;
  artworkOnly?: boolean;
  artworkRevision?: string | (() => string | undefined);
  maxBytes?: number;
  compress?: boolean;
  buildFingerprint?: string;
  /** Test/diagnostic hook counts actual reads rather than HTTP requests. */
  onRead?: (path: string) => void;
}
interface Asset { body: Buffer; digest: string; contentType: string; variants: Map<string, Promise<Buffer>>; bytes: number }

/** Bounded encoded-byte LRU and coalesced reads; never walks the workspace. */
export function createStaticDelivery(options: StaticDeliveryOptions) {
  const root = resolve(options.root), rootPrefix = root + sep, rootReal = realpath(root);
  const cache = new Map<string, Asset>(), pending = new Map<string, Promise<Asset>>();
  const maxBytes = options.maxBytes ?? 32 * 1024 * 1024;
  let retainedBytes = 0;
  const trim = () => {
    while (retainedBytes > maxBytes && cache.size) { const [path, asset] = cache.entries().next().value!; cache.delete(path); retainedBytes -= asset.bytes; }
  };
  const load = (path: string): Promise<Asset> => {
    const saved = cache.get(path);
    if (saved) { cache.delete(path); cache.set(path,saved); return Promise.resolve(saved); }
    const active = pending.get(path); if (active) return active;
    const promise = (async () => {
      const absolute = resolve(root, '.' + path);
      if (!absolute.startsWith(rootPrefix)) throw Object.assign(new Error('Outside static root'),{code:'ENOENT'});
      const actual = await realpath(absolute), actualRoot = await rootReal;
      if (!actual.startsWith(actualRoot + sep)) throw Object.assign(new Error('Outside static root'),{code:'ENOENT'});
      const body = await readFile(actual);
      options.onRead?.(path);
      const asset: Asset = {body,digest:createHash('sha256').update(body).digest('hex'),contentType:mime[extname(path)] || 'application/octet-stream',variants:new Map(),bytes:body.byteLength};
      cache.set(path,asset); retainedBytes += asset.bytes; trim(); return asset;
    })().finally(() => pending.delete(path));
    pending.set(path,promise); return promise;
  };
  const encoded = async (path: string, asset: Asset, encoding: string) => {
    let variant = asset.variants.get(encoding);
    if (!variant) {
      variant = (encoding === 'br' ? brotli(asset.body,{params:{[constants.BROTLI_PARAM_QUALITY]:5}}) : gz(asset.body,{level:6})).then(bytes => {
        if (cache.get(path) === asset) { asset.bytes += bytes.byteLength; retainedBytes += bytes.byteLength; trim(); }
        return bytes;
      });
      asset.variants.set(encoding,variant);
    }
    return variant;
  };
  const fail = (res: ServerResponse, status: number, message: string, head = false) => {
    res.statusCode=status; res.setHeader('Cache-Control','no-cache'); res.setHeader('Content-Type','text/plain; charset=utf-8'); res.setHeader('X-Content-Type-Options','nosniff'); res.end(head ? undefined : message);
  };
  return {
    clear() { cache.clear(); retainedBytes=0; },
    metrics() { return {entries:cache.size,retainedBytes,inflight:pending.size,maxBytes}; },
    async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
      let url: URL, path: string;
      try { url = new URL(req.url || '/', 'http://localhost'); path = decodeURIComponent(url.pathname); }
      catch { if(options.artworkOnly)return false; fail(res,400,'Invalid URL'); return true; }
      if (options.artworkOnly && !artworkRoute.test(path)) return false;
      if (path === '/') path='/index.html';
      const head = req.method === 'HEAD';
      if (req.method !== 'GET' && !head) { res.setHeader('Allow','GET, HEAD'); fail(res,405,'Method not allowed'); return true; }
      if (!publicRoute.test(path) || path.slice(1).split('/').some(part => !part || part === '.' || part === '..' || part.startsWith('.')) || /[\\\0]/.test(path)) { fail(res,404,'Not found',head); return true; }
      let asset: Asset;
      try { asset=await load(path); }
      catch { fail(res,404,'Not found',head); return true; }
      const text = /^(?:text\/|application\/json|image\/svg\+xml)/.test(asset.contentType);
      const encoding = options.compress !== false && text && asset.body.byteLength >= 512 ? acceptedEncoding(req.headers['accept-encoding'] || '') : undefined;
      const body = encoding ? await encoded(path,asset,encoding) : asset.body;
      const revision = typeof options.artworkRevision === 'function' ? options.artworkRevision() : options.artworkRevision;
      const hashed = /-([a-f0-9]{12,64})\.(?:webp|json)$/.exec(path)?.[1];
      const isImmutable = Boolean(hashed && asset.digest.startsWith(hashed)) || /^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(path) || Boolean(/^\/stickers\//.test(path) && revision && url.searchParams.get('v') === revision);
      const etag = `"${asset.digest}${encoding ? '-' + encoding : ''}"`;
      res.setHeader('Content-Type',asset.contentType); res.setHeader('X-Content-Type-Options','nosniff');
      res.setHeader('Cache-Control',isImmutable ? immutable : 'no-cache'); res.setHeader('ETag',etag);
      if (text) res.setHeader('Vary','Accept-Encoding');
      if (encoding) res.setHeader('Content-Encoding',encoding);
      if (!options.artworkOnly) { res.setHeader('X-Birds-And-Trees-Server','production'); if(options.buildFingerprint)res.setHeader('X-Birds-And-Trees-Build',options.buildFingerprint); }
      if (String(req.headers['if-none-match'] || '').split(',').some(value => value.trim().replace(/^W\//,'') === etag || value.trim() === '*')) { res.statusCode=304; res.end(); return true; }
      res.setHeader('Content-Length',body.byteLength); res.statusCode=200; res.end(head ? undefined : body); return true;
    },
  };
}

function acceptedEncoding(header: string): 'br' | 'gzip' | undefined {
  const allowed = new Map(header.toLowerCase().split(',').map(value => {const [name,...parameters]=value.trim().split(';');const q=parameters.find(parameter=>parameter.trim().startsWith('q='));return[name,q ? Number(q.trim().slice(2)) : 1] as const;}));
  const quality = (name: string) => allowed.get(name) ?? allowed.get('*') ?? 0;
  const br=quality('br'), gzip=quality('gzip'); return br>0 && br>=gzip ? 'br' : gzip>0 ? 'gzip' : undefined;
}
