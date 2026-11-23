import { deterministicLayoutKey, getPersistentLayout, persistentLayoutCacheEpoch, putPersistentLayout } from '../storage/layout-cache';
import type { StickerPackingInput, StickerPackingOptions, StickerPackingResult as EnginePackingResult } from './sticker-packing';
export type { PackedSticker, StickerPackingInput, StickerMask, StickerPackingOptions } from './sticker-packing';
export type StickerPackingResult = EnginePackingResult & { cacheSource?: 'computed' | 'memory' | 'persistent'; cacheReadMs?: number; loadMs?: number };
export const PACKING_ALGORITHM_VERSION = 'alpha-spiral-packing-v2-center-count';
let cache = new Map<string, EnginePackingResult>(), memoryEpoch = 0;
export function clearPackingMemoryCache() { memoryEpoch++; cache = new Map(); }
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const nonnegative = (value: unknown): value is number => finite(value) && value >= 0;
const object = (value: unknown): value is Record<string, any> => !!value && typeof value === 'object' && !Array.isArray(value);
const near = (a: unknown, b: number) => finite(a) && Math.abs(a - b) <= Math.max(1, Math.abs(b)) * 1e-9;
interface CachedPacking { schemaVersion: 1; key: string; settings: Record<string, unknown>; result: EnginePackingResult }

function validResult(value: unknown, input: readonly StickerPackingInput[], settings: { maxDisplacement?: number; stickerScale?: number; gap?: number; targetCoverage?: number; reserveCenter?: boolean }): value is EnginePackingResult {
  if (!object(value) || !Array.isArray(value.points) || value.points.length !== input.length || !object(value.bounds) || !object(value.anchorCenter)) return false;
  const scale = settings.stickerScale ?? 1;
  if (value.stickerScale !== scale || value.maxDisplacement !== (settings.maxDisplacement ?? null) || !finite(value.anchorScale) || value.anchorScale <= 0 || !finite(value.anchorCenter.x) || !finite(value.anchorCenter.y)) return false;
  if (![value.gap, value.maxActualDisplacement, value.elapsedMs].every(nonnegative) || ![value.overlapCount, value.displacedCount, value.attempts].every(n => Number.isInteger(n) && n >= 0) || value.displacedCount > input.length || value.attempts < input.length) return false;
  if (settings.gap !== undefined && value.gap !== settings.gap) return false;
  const bounds = value.bounds;
  if (![bounds.minX, bounds.minY, bounds.maxX, bounds.maxY, bounds.width, bounds.height].every(finite) || bounds.width < 0 || bounds.height < 0 || !near(bounds.width, bounds.maxX - bounds.minX) || !near(bounds.height, bounds.maxY - bounds.minY)) return false;
  if (settings.reserveCenter) {
    const reserve=value.centerReserve;
    if(!object(reserve)||reserve.x!==0||reserve.y!==0||![reserve.width,reserve.height].every(n=>finite(n)&&n>0))return false;
    if(reserve.x-reserve.width/2<bounds.minX||reserve.x+reserve.width/2>bounds.maxX||reserve.y-reserve.height/2<bounds.minY||reserve.y+reserve.height/2>bounds.maxY)return false;
  } else if (value.centerReserve !== undefined) return false;
  const byCode = new Map(input.map(point => [point.code, point])), seen = new Set<string>();
  for (const point of value.points) {
    if (!object(point) || typeof point.code !== 'string' || seen.has(point.code)) return false;
    const source = byCode.get(point.code); if (!source) return false; seen.add(point.code);
    if (![point.x, point.y, point.anchorX, point.anchorY, point.displayAnchorX, point.displayAnchorY, point.width, point.height].every(finite) || point.width <= 0 || point.height <= 0) return false;
    if (point.anchorX !== source.x || point.anchorY !== source.y || !near(point.width, source.width * scale) || !near(point.height, source.height * scale) || JSON.stringify(point.mask) !== JSON.stringify(source.mask)) return false;
    if (!near(point.displayAnchorX, (source.x - value.anchorCenter.x) * value.anchorScale) || !near(point.displayAnchorY, (source.y - value.anchorCenter.y) * value.anchorScale)) return false;
    const epsilon = Math.max(1, bounds.width, bounds.height) * 1e-8;
    if (point.x - point.width / 2 < bounds.minX - epsilon || point.x + point.width / 2 > bounds.maxX + epsilon || point.y - point.height / 2 < bounds.minY - epsilon || point.y + point.height / 2 > bounds.maxY + epsilon) return false;
    if (settings.maxDisplacement !== undefined && Math.hypot(point.x - point.displayAnchorX, point.y - point.displayAnchorY) / Math.max(point.width, point.height) > settings.maxDisplacement + 1e-8) return false;
    if(settings.reserveCenter && settings.maxDisplacement===undefined){const r=value.centerReserve;if(Math.abs(point.x-r.x)<(point.width+r.width)/2-1e-9&&Math.abs(point.y-r.y)<(point.height+r.height)/2-1e-9)return false;}
  }
  return true;
}

function cleanResult(value: EnginePackingResult): EnginePackingResult {
  return { points: value.points.map(p => ({ code: p.code, x: p.x, y: p.y, width: p.width, height: p.height, ...(p.mask ? { mask: [...p.mask] as typeof p.mask } : {}), anchorX: p.anchorX, anchorY: p.anchorY, displayAnchorX: p.displayAnchorX, displayAnchorY: p.displayAnchorY })),
    bounds: { minX: value.bounds.minX, minY: value.bounds.minY, maxX: value.bounds.maxX, maxY: value.bounds.maxY, width: value.bounds.width, height: value.bounds.height }, anchorScale: value.anchorScale, anchorCenter: { x: value.anchorCenter.x, y: value.anchorCenter.y }, gap: value.gap,
    overlapCount: value.overlapCount, maxDisplacement: value.maxDisplacement, maxActualDisplacement: value.maxActualDisplacement, displacedCount: value.displacedCount, stickerScale: value.stickerScale, attempts: value.attempts, elapsedMs: value.elapsedMs, ...(value.centerReserve ? {centerReserve:{...value.centerReserve}} : {}) };
}

export function startStickerPacking(input: readonly StickerPackingInput[], options: Omit<StickerPackingOptions, 'checkCancelled'> = {}): { promise: Promise<StickerPackingResult>; cancel: () => void } {
  const started = performance.now(), requestMemoryEpoch = memoryEpoch, requestDiskEpoch = persistentLayoutCacheEpoch();
  const settings = { maxDisplacement: options.maxDisplacement, stickerScale: options.stickerScale, gap: options.gap, targetCoverage: options.targetCoverage, reserveCenter: options.reserveCenter };
  const requestedInput = input.map(point => ({ code: point.code, x: point.x, y: point.y, width: point.width, height: point.height, ...(point.mask ? { mask: [...point.mask] as typeof point.mask } : {}) }));
  let worker: Worker | undefined, settled = false, rejectPacking: (reason: Error) => void = () => undefined;
  const promise = new Promise<StickerPackingResult>((resolve, reject) => {
    rejectPacking = reject;
    void (async () => {
      let key: string | undefined, cacheReadMs = 0;
      try { key = await deterministicLayoutKey('packing', { schemaVersion: 1, algorithmVersion: PACKING_ALGORITHM_VERSION, settings, input: [...requestedInput].sort((a, b) => a.code.localeCompare(b.code, 'en')) }); } catch { /* Optional persistence; computation remains available. */ }
      if (settled) return;
      const remember = (result: EnginePackingResult) => { if (key && requestMemoryEpoch === memoryEpoch && requestDiskEpoch === persistentLayoutCacheEpoch()) { cache.delete(key); cache.set(key, result); while (cache.size > 4) cache.delete(cache.keys().next().value!); } };
      const finish = (result: EnginePackingResult, cacheSource: 'computed' | 'memory' | 'persistent') => { if (!settled) { settled = true; worker?.terminate(); resolve({ ...result, cacheSource, cacheReadMs, loadMs: performance.now() - started }); } };
      const inMemory = key ? cache.get(key) : undefined;
      if (inMemory && validResult(inMemory, requestedInput, settings)) { remember(inMemory); finish(inMemory, 'memory'); return; }
      if (key) {
        cache.delete(key); const began = performance.now(); let stored: CachedPacking | null = null;
        try { stored = await getPersistentLayout<CachedPacking>(key, (value): value is CachedPacking => object(value) && value.schemaVersion === 1 && value.key === key && object(value.settings) && Object.keys(value.settings).length === Object.keys(JSON.parse(JSON.stringify(settings))).length && ['maxDisplacement', 'stickerScale', 'gap', 'targetCoverage', 'reserveCenter'].every(name => value.settings[name] === settings[name as keyof typeof settings]) && validResult(value.result, requestedInput, settings)); } catch { /* Unavailable storage is a cache miss. */ }
        cacheReadMs = performance.now() - began;
        if (settled) return;
        if (stored && requestDiskEpoch === persistentLayoutCacheEpoch()) { const result = cleanResult(stored.result); remember(result); finish(result, 'persistent'); return; }
      }
      if (settled) return;
      worker = new Worker(new URL('../workers/sticker-packing.worker.ts', import.meta.url), { type: 'module' });
      worker.onmessage = (event: MessageEvent<{ type: 'progress'; completed: number; total: number } | { type: 'complete'; result: EnginePackingResult } | { type: 'error'; message: string }>) => {
        if (settled) return;
        const message = event.data;
        if (message.type === 'progress') options.onProgress?.(message.completed, message.total);
        else if (message.type === 'complete') {
          if (!validResult(message.result, requestedInput, settings)) { settled = true; worker?.terminate(); reject(new Error('The packing worker returned an invalid completed layout.')); return; }
          const result = cleanResult(message.result);
          remember(result); if (key && requestMemoryEpoch === memoryEpoch && requestDiskEpoch === persistentLayoutCacheEpoch()) void putPersistentLayout(key, 'packing', { schemaVersion: 1, key, settings, result }, requestDiskEpoch).catch(() => undefined);
          finish(result, 'computed');
        } else { settled = true; worker?.terminate(); reject(new Error(message.message)); }
      };
      worker.onerror = () => { if (!settled) { settled = true; worker?.terminate(); reject(new Error('The sticker packing worker stopped unexpectedly.')); } };
      worker.postMessage({ input: requestedInput, options: settings });
    })().catch(error => { if (!settled) { settled = true; worker?.terminate(); reject(error instanceof Error ? error : new Error('Sticker packing could not start.')); } });
  });
  return { promise, cancel: () => { if (!settled) { settled = true; worker?.terminate(); rejectPacking(new DOMException('Sticker packing cancelled.', 'AbortError')); } } };
}
