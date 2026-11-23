export type ArtworkImage = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface ImageLoaderMetrics {
  requests: number;
  deduplicated: number;
  networkCompleted: number;
  decoded: number;
  decodeTimeouts: number;
  decodeFallbacks: number;
  decodeSkipped: number;
  failures: number;
  cancelled: number;
  networkMs: number;
  decodeMs: number;
  activeNetwork: number;
  activeDecode: number;
  queuedNetwork: number;
  queuedDecode: number;
}

export interface ImageLoaderOptions {
  networkConcurrency?: number;
  decodeConcurrency?: number;
  networkTimeoutMs?: number;
  decodeTimeoutMs?: number;
  decodeQueueTimeoutMs?: number;
}

interface ImageTask {
  url: string;
  image?: HTMLImageElement;
  resolve: (image: HTMLImageElement) => void;
  reject: (error: Error) => void;
  settled: boolean;
  networkStarted?: number;
  decodeStarted?: number;
  timer?: ReturnType<typeof setTimeout>;
}

const validPositive = (value: number, label: string, integer = false) => {
  if (!Number.isFinite(value) || value <= 0 || integer && !Number.isInteger(value)) throw new Error(`Invalid ${label}.`);
  return value;
};

/**
 * Network slots are released on load, before decode preparation begins. A slow
 * off-DOM decode cannot block every subsequent sticker download indefinitely.
 * Only in-flight promises are retained; decoded-image ownership belongs to the
 * artwork cache, so switching views does not leave another unbounded image set.
 */
export class LocalImageLoader {
  private readonly networkConcurrency: number;
  private readonly decodeConcurrency: number;
  private readonly networkTimeoutMs: number;
  private readonly decodeTimeoutMs: number;
  private readonly decodeQueueTimeoutMs: number;
  private readonly inFlight = new Map<string, Promise<HTMLImageElement>>();
  private readonly tasks = new Set<ImageTask>();
  private readonly networkQueue: ImageTask[] = [];
  private readonly decodeQueue: ImageTask[] = [];
  private readonly networkActive = new Set<ImageTask>();
  private readonly decodeActive = new Set<ImageTask>();
  private disposed = false;
  private readonly counts = { requests: 0, deduplicated: 0, networkCompleted: 0, decoded: 0, decodeTimeouts: 0, decodeFallbacks: 0, decodeSkipped: 0, failures: 0, cancelled: 0, networkMs: 0, decodeMs: 0 };

  constructor(options: ImageLoaderOptions = {}) {
    this.networkConcurrency = validPositive(options.networkConcurrency ?? 12, 'network concurrency', true);
    this.decodeConcurrency = validPositive(options.decodeConcurrency ?? 2, 'decode concurrency', true);
    this.networkTimeoutMs = validPositive(options.networkTimeoutMs ?? 10000, 'network timeout');
    this.decodeTimeoutMs = validPositive(options.decodeTimeoutMs ?? 250, 'decode timeout');
    this.decodeQueueTimeoutMs = validPositive(options.decodeQueueTimeoutMs ?? 16, 'decode queue timeout');
  }

  load(path: string): Promise<HTMLImageElement> {
    if (this.disposed) return Promise.reject(this.abortError());
    let url: URL;
    try { url = new URL(path, window.location.href); }
    catch { return Promise.reject(new Error('Invalid local artwork path.')); }
    if (url.origin !== window.location.origin || !['http:', 'https:'].includes(url.protocol)) return Promise.reject(new Error('Artwork must be served locally.'));
    const existing = this.inFlight.get(url.href);
    if (existing) { this.counts.deduplicated++; return existing; }
    this.counts.requests++;
    let task!: ImageTask;
    const pending = new Promise<HTMLImageElement>((resolve, reject) => {
      task = { url: url.href, resolve, reject, settled: false };
      this.tasks.add(task);
      this.networkQueue.push(task);
    });
    // Attach cleanup without leaving a separately rejected finally() promise.
    void pending.then(() => this.inFlight.delete(url.href), () => this.inFlight.delete(url.href));
    this.inFlight.set(url.href, pending);
    this.pumpNetwork();
    return pending;
  }

  metrics(): ImageLoaderMetrics {
    return { ...this.counts, activeNetwork: this.networkActive.size, activeDecode: this.decodeActive.size, queuedNetwork: this.networkQueue.length, queuedDecode: this.decodeQueue.length };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const task of this.tasks) {
      const wasLoading = this.networkActive.has(task);
      this.counts.cancelled++;
      this.finish(task, this.abortError());
      if (wasLoading) task.image?.removeAttribute('src');
    }
    this.networkQueue.length = 0;
    this.decodeQueue.length = 0;
    this.inFlight.clear();
  }

  private abortError(): Error {
    const error = new Error('Artwork loading was cancelled.');
    error.name = 'AbortError';
    return error;
  }

  private finish(task: ImageTask, error?: Error): void {
    if (task.settled) return;
    task.settled = true;
    clearTimeout(task.timer);
    if (task.image) { task.image.onload = null; task.image.onerror = null; }
    this.tasks.delete(task);
    this.networkActive.delete(task);
    this.decodeActive.delete(task);
    const queuedIndex = this.decodeQueue.indexOf(task);
    if (queuedIndex !== -1) this.decodeQueue.splice(queuedIndex, 1);
    if (error) task.reject(error); else task.resolve(task.image!);
    if (!this.disposed) { this.pumpNetwork(); this.pumpDecode(); }
  }

  private pumpNetwork(): void {
    if (this.disposed) return;
    while (this.networkActive.size < this.networkConcurrency && this.networkQueue.length) {
      const task = this.networkQueue.shift()!;
      if (task.settled) continue;
      this.networkActive.add(task);
      task.networkStarted = performance.now();
      const failed = (message: string) => {
        if (task.settled || !this.networkActive.has(task)) return;
        this.counts.networkMs += Math.max(0, performance.now() - task.networkStarted!);
        this.counts.failures++;
        this.finish(task, new Error(message));
        task.image?.removeAttribute('src');
      };
      try {
        const image = task.image = new Image();
        image.decoding = 'async';
        image.onload = () => {
          if (task.settled || !this.networkActive.has(task)) return;
          clearTimeout(task.timer);
          image.onload = null;
          image.onerror = null;
          this.counts.networkMs += Math.max(0, performance.now() - task.networkStarted!);
          if (!image.naturalWidth || !image.naturalHeight) { this.counts.failures++; this.finish(task, new Error('Artwork has no drawable pixels.')); return; }
          this.counts.networkCompleted++;
          this.networkActive.delete(task);
          this.decodeQueue.push(task);
          task.timer = setTimeout(() => {
            if (task.settled || this.decodeActive.has(task)) return;
            // An optional explicit decode is preparation, not a prerequisite
            // after a successful load. Avoid a convoy behind busy decoders.
            this.counts.decodeSkipped++;
            this.finish(task);
          }, this.decodeQueueTimeoutMs);
          this.pumpNetwork();
          this.pumpDecode();
        };
        image.onerror = () => failed('Local artwork could not be loaded.');
        task.timer = setTimeout(() => failed('Local artwork download timed out.'), this.networkTimeoutMs);
        image.src = task.url;
      } catch { failed('Local artwork could not be loaded.'); }
    }
  }

  private pumpDecode(): void {
    if (this.disposed) return;
    while (this.decodeActive.size < this.decodeConcurrency && this.decodeQueue.length) {
      const task = this.decodeQueue.shift()!;
      if (task.settled) continue;
      clearTimeout(task.timer);
      const image = task.image!;
      if (typeof image.decode !== 'function') { this.finish(task); continue; }
      this.decodeActive.add(task);
      task.decodeStarted = performance.now();
      const complete = (outcome: 'decoded' | 'timeout' | 'fallback') => {
        if (task.settled || !this.decodeActive.has(task)) return;
        this.counts.decodeMs += Math.max(0, performance.now() - task.decodeStarted!);
        if (outcome === 'decoded') this.counts.decoded++;
        else if (outcome === 'timeout') this.counts.decodeTimeouts++;
        else this.counts.decodeFallbacks++;
        // onload already validated this image. Canvas can paint it even if an
        // optional explicit decode stalls/rejects (for example after a context
        // switch); preserve its ready pixels instead of failing the whole queue.
        this.finish(task);
      };
      task.timer = setTimeout(() => complete('timeout'), this.decodeTimeoutMs);
      try { void Promise.resolve(image.decode()).then(() => complete('decoded'), () => complete('fallback')); }
      catch { complete('fallback'); }
    }
  }
}
