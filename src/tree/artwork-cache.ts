export type ArtworkState = 'queued' | 'loading' | 'ready' | 'failed';
export interface ArtworkRequest { key: string; priority?: number; fallbackKeys?: readonly string[]; variants?: readonly string[] }
export interface ArtworkMetrics {
  queued: number; active: number; ready: number; failed: number; cacheHits: number;
  visibleQueued: number; visibleActive: number; visibleReady: number; visibleFailed: number;
  evictions: number;
  decodedBytes: number; visibleDecodedBytes: number; variantBytes: number; overBudgetBytes: number;
  visibleTiers: Record<string, number>;
  delivery?: Record<string, number>;
}
interface Entry<T> { key: string; state: ArtworkState; value?: T; priority: number; touched: number; promise?: Promise<void>; fallbackKeys: readonly string[]; resolvedKey?: string; bytes: number; variants: Map<string, { value: unknown; bytes: number }>; wantedVariants: Set<string>; failedVariants: Set<string> }
interface CacheOptions<T> {
  load: (key: string) => Promise<T>;
  onChange?: () => void;
  capacity?: number;
  concurrency?: number;
  maxDecodedBytes?: number;
  estimateBytes?: (value: T) => number;
  prepare?: (requests: ArtworkRequest[]) => void;
  dispose?: () => void;
  deliveryMetrics?: () => Record<string, number>;
  release?: (value: T) => void;
}

/** Decoded images are retained across views. In-flight visible work is never evicted. */
export class ArtworkCache<T> {
  private entries = new Map<string, Entry<T>>();
  private wanted = new Set<string>();
  private active = 0;
  private clock = 0;
  private hits = 0;
  private evictions = 0;
  private stopped = false;
  private readonly capacity: number;
  private readonly concurrency: number;
  private readonly maxDecodedBytes: number;
  constructor(private options: CacheOptions<T>) {
    this.capacity = options.capacity ?? 512;
    this.concurrency = options.concurrency ?? 6;
    this.maxDecodedBytes = options.maxDecodedBytes ?? 32 * 1024 * 1024;
  }

  setWanted(requests: ArtworkRequest[]): void {
    if (this.stopped) return;
    const priorities = new Map<string, number>();
    const details = new Map<string, ArtworkRequest>();
    for (const request of requests) {
      priorities.set(request.key, Math.max(priorities.get(request.key) || 0, request.priority || 0));
      const previous = details.get(request.key);
      details.set(request.key, { ...request, variants: [...new Set([...(previous?.variants || []), ...(request.variants || [])])] });
    }
    this.wanted = new Set(priorities.keys());
    for (const [key, entry] of this.entries) {
      // Pending, obsolete labels have never started a request, so discard cheaply.
      if (entry.state === 'queued' && !this.wanted.has(key)) this.entries.delete(key);
    }
    for (const [key, priority] of priorities) {
      const existing = this.entries.get(key);
      const request = details.get(key)!;
      if (existing) { existing.priority = priority; existing.touched = ++this.clock; existing.fallbackKeys = request.fallbackKeys || []; existing.wantedVariants = new Set(request.variants); }
      else this.entries.set(key, { key, state: 'queued', priority, touched: ++this.clock, fallbackKeys: request.fallbackKeys || [], bytes: 0, variants: new Map(), wantedVariants: new Set(request.variants),failedVariants:new Set() });
    }
    for (const entry of this.entries.values()) for (const name of entry.variants.keys()) if (!this.wanted.has(entry.key) || !entry.wantedVariants.has(name)) entry.variants.delete(name);
    this.trim();
    this.options.prepare?.(requests);
    this.pump();
  }

  get(key: string): { state: ArtworkState; value?: T } | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    entry.touched = ++this.clock;
    if (entry.state === 'ready') this.hits++;
    return { state: entry.state, value: entry.value };
  }

  peek(key: string): { state: ArtworkState; value?: T } | undefined {
    const entry = this.entries.get(key); return entry ? { state: entry.state, value: entry.value } : undefined;
  }

  getReady(keys: readonly string[]): { key: string; value: T } | undefined {
    for (const key of keys) { const entry = this.entries.get(key); if (entry?.state === 'ready' && entry.value !== undefined) { entry.touched = ++this.clock; this.hits++; return { key, value: entry.value }; } }
    return undefined;
  }

  variantState(key:string,name:string):'ready'|'missing'|'failed'|undefined {
    const entry=this.entries.get(key);if(entry?.state!=='ready'||entry.value===undefined)return undefined;
    return entry.variants.has(name)?'ready':entry.failedVariants.has(name)?'failed':'missing';
  }

  variant<V>(key: string, name: string, create: (value: T) => V, estimateBytes: (value: V) => number): V | undefined {
    const entry = this.entries.get(key); if (entry?.state !== 'ready' || entry.value === undefined) return undefined;
    const cached = entry.variants.get(name); if (cached) return cached.value as V;
    if(entry.failedVariants.has(name))return undefined;
    try{
      const value=create(entry.value),bytes=estimateBytes(value);
      if(!Number.isFinite(bytes)||bytes<0)throw new Error('Invalid artwork variant byte estimate.');
      entry.variants.set(name,{value,bytes});this.trim();return value;
    }catch{
      // A failed Canvas allocation/readback must not abort painting all birds.
      // Remember this entry's failure so every pointer frame can use the source.
      entry.failedVariants.add(name);return undefined;
    }
  }

  metrics(): ArtworkMetrics {
    const result: ArtworkMetrics = { queued: 0, active: this.active, ready: 0, failed: 0, cacheHits: this.hits, visibleQueued: 0, visibleActive: 0, visibleReady: 0, visibleFailed: 0, evictions: this.evictions, decodedBytes: 0, visibleDecodedBytes: 0, variantBytes: 0, overBudgetBytes: 0, visibleTiers: {} };
    for (const entry of this.entries.values()) {
      if (entry.state === 'queued') result.queued++;
      else if (entry.state === 'ready') result.ready++;
      else if (entry.state === 'failed') result.failed++;
      const variantBytes = [...entry.variants.values()].reduce((sum, item) => sum + item.bytes, 0);
      result.decodedBytes += entry.bytes + variantBytes; result.variantBytes += variantBytes;
      if (this.wanted.has(entry.key)) {
        if (entry.state === 'queued') result.visibleQueued++;
        else if (entry.state === 'loading') result.visibleActive++;
        else if (entry.state === 'ready') result.visibleReady++;
        else result.visibleFailed++;
        result.visibleDecodedBytes += entry.bytes + variantBytes;
        if (entry.state === 'ready') { const tier = /\/stickers\/(\d+)\//.exec(entry.resolvedKey || entry.key)?.[1] || 'other'; result.visibleTiers[tier] = (result.visibleTiers[tier] || 0) + 1; }
      }
    }
    result.overBudgetBytes = Math.max(0, result.decodedBytes - this.maxDecodedBytes);
    if (this.options.deliveryMetrics) result.delivery = this.options.deliveryMetrics();
    return result;
  }

  async settleVisible(timeoutMs = 8000): Promise<void> {
    const start = Date.now();
    while (!this.stopped && Date.now() - start < timeoutMs) {
      const pending = [...this.entries.values()].filter((entry) => this.wanted.has(entry.key) && (entry.state === 'queued' || entry.state === 'loading'));
      if (!pending.length) return;
      const active = pending.flatMap((entry) => entry.promise ? [entry.promise] : []);
      if (!active.length) { this.pump(); continue; }
      await Promise.race([Promise.all(active), new Promise<void>((resolve) => setTimeout(resolve, Math.min(100, timeoutMs)))]);
    }
  }

  dispose(): void { this.stopped = true; for (const entry of this.entries.values()) if (entry.value !== undefined) this.options.release?.(entry.value); this.entries.clear(); this.wanted.clear(); this.options.dispose?.(); }

  private pump(): void {
    if (this.stopped) return;
    const queued = [...this.entries.values()].filter((entry) => entry.state === 'queued' && this.wanted.has(entry.key))
      .sort((a, b) => b.priority - a.priority || a.touched - b.touched);
    while (this.active < this.concurrency && queued.length) {
      const entry = queued.shift()!;
      entry.state = 'loading'; this.active++;
      entry.promise = Promise.resolve().then(async () => {
        let failure: unknown;
        for (const key of [entry.key, ...entry.fallbackKeys]) {
          try { const value = await this.options.load(key); entry.resolvedKey = key; return value; } catch (error) { failure = error; }
        }
        throw failure;
      }).then((value) => {
        if (this.stopped) { this.options.release?.(value); return; }
        entry.value = value; entry.state = 'ready'; entry.touched = ++this.clock;
        const sized = value as { naturalWidth?: number; naturalHeight?: number; width?: number; height?: number };
        entry.bytes = this.options.estimateBytes?.(value) ?? Math.max(0, Number(sized?.naturalWidth || sized?.width || 0) * Number(sized?.naturalHeight || sized?.height || 0) * 4);
      }, () => { if (!this.stopped) entry.state = 'failed'; }).finally(() => {
        this.active--;
        if (this.stopped) return;
        this.trim(); this.pump(); this.options.onChange?.();
      });
    }
  }

  private trim(): void {
    const decoded = [...this.entries.values()].filter((entry) => entry.state === 'ready' || entry.state === 'failed');
    const cost = (entry: Entry<T>) => entry.bytes + [...entry.variants.values()].reduce((sum, item) => sum + item.bytes, 0);
    let bytes = decoded.reduce((sum, entry) => sum + cost(entry), 0), count = decoded.length;
    // A ready replacement makes unused resolution copies immediately disposable.
    const readyFamilies = new Set(decoded.filter(entry => this.wanted.has(entry.key) && entry.state === 'ready').map(entry => entry.key.replace(/\/stickers\/\d+\//, '/stickers/')));
    const evictable = decoded.filter((entry) => !this.wanted.has(entry.key)).sort((a, b) => a.touched - b.touched);
    for (const entry of evictable) {
      const replaced = /\/stickers\/\d+\//.test(entry.key) && readyFamilies.has(entry.key.replace(/\/stickers\/\d+\//, '/stickers/'));
      if (!replaced && count <= this.capacity && bytes <= this.maxDecodedBytes) continue;
      this.entries.delete(entry.key); if (entry.value !== undefined) this.options.release?.(entry.value); this.evictions++; count--; bytes -= cost(entry);
    }
  }
}

/** Budget only new conversions, so previously converted birds never starve later ones. */
export class ArtworkVariantBatch<T> {
  private spent=0;
  private created=0;
  private pending=new Set<string>();
  private failed=new Set<string>();
  constructor(private cache:ArtworkCache<T>,private budgetMs=4,private now=()=>performance.now()){}
  get elapsedMs(){return this.spent;}
  get createdCount(){return this.created;}
  get pendingCount(){return this.pending.size;}
  get failedCount(){return this.failed.size;}
  get<V>(key:string,name:string,create:(source:T)=>V,estimateBytes:(value:V)=>number):V|undefined {
    const state=this.cache.variantState(key,name),identity=`${key}\0${name}`;
    if(state==='ready')return this.cache.variant(key,name,create,estimateBytes);
    if(state==='failed'){this.failed.add(identity);return undefined;}
    if(state!=='missing')return undefined;
    if(this.spent>=this.budgetMs){this.pending.add(identity);return undefined;}
    const began=this.now(),value=this.cache.variant(key,name,create,estimateBytes);
    this.spent+=Math.max(0,this.now()-began);
    if(this.cache.variantState(key,name)==='ready')this.created++;
    if(this.cache.variantState(key,name)==='failed')this.failed.add(identity);
    return value;
  }
}

