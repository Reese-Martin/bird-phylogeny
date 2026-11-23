import { IDBFactory, IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearPersistentLayoutCache, deterministicLayoutKey, discardPersistentLayout, getPersistentLayout,
  LAYOUT_CACHE_DATABASE, LAYOUT_CACHE_LIMITS, LAYOUT_CACHE_STORE, persistentLayoutCacheEpoch, putPersistentLayout,
} from '../src/storage/layout-cache';

interface Layout { coordinates: Array<[number, number]> }
const layout = (number = 1): Layout => ({ coordinates: [[number, number + 1]] });
const valid = (value: unknown): value is Layout => Boolean(value && typeof value === 'object' && Array.isArray((value as Layout).coordinates) && (value as Layout).coordinates.every(pair => Array.isArray(pair) && pair.length === 2 && pair.every(Number.isFinite)));
const keyFor = (number: number) => deterministicLayoutKey('embedding', { number });

async function rawDatabase() {
  return await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LAYOUT_CACHE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(LAYOUT_CACHE_STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function rawPut(value: unknown) {
  const database = await rawDatabase();
  await new Promise<void>((resolve, reject) => {
    const tx = database.transaction(LAYOUT_CACHE_STORE, 'readwrite');
    tx.objectStore(LAYOUT_CACHE_STORE).put(value);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
  database.close();
}
async function rawEntries() {
  const database = await rawDatabase();
  const values = await new Promise<any[]>((resolve, reject) => {
    const request = database.transaction(LAYOUT_CACHE_STORE, 'readonly').objectStore(LAYOUT_CACHE_STORE).getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  database.close(); return values;
}

beforeEach(() => { vi.stubGlobal('indexedDB', new IDBFactory()); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('deterministic versioned layout identities', () => {
  it('canonicalizes nested object keys while retaining numeric, array, source and kind identity', async () => {
    const a = await deterministicLayoutKey('embedding', { tree: { edges: [1, 2], root: 0 }, parameters: { seed: 42, iterations: 1000 } });
    const b = await deterministicLayoutKey('embedding', { parameters: { iterations: 1000, seed: 42 }, tree: { root: 0, edges: [1, 2] } });
    expect(a).toBe(b); expect(a).toMatch(/^layout-v1:embedding:[a-f0-9]{64}$/);
    expect(await deterministicLayoutKey('embedding', { tree: { edges: [2, 1], root: 0 }, parameters: { seed: 42, iterations: 1000 } })).not.toBe(a);
    expect(await deterministicLayoutKey('packing', { tree: { edges: [1, 2], root: 0 }, parameters: { seed: 42, iterations: 1000 } })).not.toBe(a);
    expect(await deterministicLayoutKey('embedding', { value: undefined })).toBe(await deterministicLayoutKey('embedding', {}));
    expect(await deterministicLayoutKey('embedding', [undefined])).toBe(await deterministicLayoutKey('embedding', [null]));
  });

  it('rejects nonfinite/cyclic/non-JSON key material instead of silently changing it', async () => {
    await expect(deterministicLayoutKey('embedding', { coordinates: [NaN] })).rejects.toThrow('finite');
    const cyclic: any = {}; cyclic.cyclic = cyclic;
    await expect(deterministicLayoutKey('embedding', cyclic)).rejects.toThrow('cycles');
    await expect(deterministicLayoutKey('embedding', { matrix: new Float64Array([1, 2]) })).rejects.toThrow('plain JSON');
  });
});

describe('optional bounded completed-layout persistence', () => {
  it('roundtrips only JSON payloads and survives a new imported module like a reload', async () => {
    const key = await keyFor(1);
    const before = layout(); await putPersistentLayout(key, 'embedding', before);
    expect(await getPersistentLayout(key, valid)).toEqual(before);
    before.coordinates[0][0] = 99;
    expect(await getPersistentLayout(key, valid)).toEqual(layout());
    vi.resetModules();
    const reloaded = await import('../src/storage/layout-cache');
    expect(await reloaded.getPersistentLayout(key, valid)).toEqual(layout());
    expect((await rawEntries())[0]).toMatchObject({ key, kind: 'embedding', storageVersion: 1 });
    await reloaded.discardPersistentLayout(key); expect(await reloaded.getPersistentLayout(key, valid)).toBeNull();
  });

  it('bounds entry count with persistent LRU touches, rather than insertion order', async () => {
    const keys = await Promise.all(Array.from({ length: LAYOUT_CACHE_LIMITS.maxEntries + 1 }, (_, i) => keyFor(i)));
    for (let i = 0; i < LAYOUT_CACHE_LIMITS.maxEntries; i++) await putPersistentLayout(keys[i], 'embedding', layout(i));
    await getPersistentLayout(keys[0], valid);
    await putPersistentLayout(keys.at(-1)!, 'embedding', layout(100));
    expect(await getPersistentLayout(keys[0], valid)).toEqual(layout(0));
    expect(await getPersistentLayout(keys[1], valid)).toBeNull();
    expect((await rawEntries()).length).toBe(LAYOUT_CACHE_LIMITS.maxEntries);
  });

  it('bounds serialized bytes and skips a single oversized payload', async () => {
    const a = await keyFor(100), b = await keyFor(101), c = await keyFor(102);
    const payload = { text: 'x'.repeat(9 * 1024 * 1024) };
    await putPersistentLayout(a, 'embedding', payload); await putPersistentLayout(b, 'embedding', payload);
    const entries = await rawEntries();
    expect(entries.map(value => value.key)).toEqual([b]);
    expect(entries.reduce((sum, value) => sum + value.bytes, 0)).toBeLessThanOrEqual(LAYOUT_CACHE_LIMITS.maxBytes);
    await putPersistentLayout(c, 'embedding', { text: 'x'.repeat(LAYOUT_CACHE_LIMITS.maxBytes + 1) });
    expect((await rawEntries()).map(value => value.key)).toEqual([b]);
  });

  it('discards stale wrappers, corrupt byte counts and invalid caller schemas', async () => {
    const key = await keyFor(2);
    await putPersistentLayout(key, 'embedding', layout());
    let record = (await rawEntries())[0];
    await rawPut({ ...record, storageVersion: 0 });
    expect(await getPersistentLayout(key, valid)).toBeNull(); expect(await rawEntries()).toEqual([]);
    await putPersistentLayout(key, 'embedding', layout()); record = (await rawEntries())[0];
    await rawPut({ ...record, bytes: 1 });
    expect(await getPersistentLayout(key, valid)).toBeNull(); expect(await rawEntries()).toEqual([]);
    await putPersistentLayout(key, 'embedding', { coordinates: [[null, 1]] });
    expect(await getPersistentLayout(key, valid)).toBeNull(); expect(await rawEntries()).toEqual([]);
    await expect(putPersistentLayout(key, 'embedding', { matrix: new Float64Array(2) })).resolves.toBeUndefined();
    expect(await rawEntries()).toEqual([]);
  });

  it('does not mix kind/key identities and explicitly discards completed entries', async () => {
    const embedding = await keyFor(3), packing = await deterministicLayoutKey('packing', { points: [] });
    await putPersistentLayout(embedding, 'packing', layout()); expect(await getPersistentLayout(embedding, valid)).toBeNull();
    await putPersistentLayout(packing, 'packing', layout()); expect(await getPersistentLayout(packing, valid)).toEqual(layout());
    await discardPersistentLayout(packing); expect(await getPersistentLayout(packing, valid)).toBeNull();
  });

  it('clears older reads, queued writes and results from computations started before clear', async () => {
    const key = await keyFor(4), epoch = persistentLayoutCacheEpoch();
    await putPersistentLayout(key, 'embedding', layout());
    const reading = getPersistentLayout(key, valid), writing = putPersistentLayout(key, 'embedding', layout(9), epoch);
    const clearing = clearPersistentLayoutCache();
    expect(persistentLayoutCacheEpoch()).toBeGreaterThan(epoch);
    await Promise.all([reading, writing, clearing]); expect(await clearing).toBe(true);
    expect(await reading).toBeNull(); expect(await getPersistentLayout(key, valid)).toBeNull();
    await putPersistentLayout(key, 'embedding', layout(10), epoch);
    expect(await getPersistentLayout(key, valid)).toBeNull();
    await putPersistentLayout(key, 'embedding', layout(11), persistentLayoutCacheEpoch());
    expect(await getPersistentLayout(key, valid)).toEqual(layout(11));
  });

  it('degrades to misses for unavailable, security-blocked and blocked opens', async () => {
    const key = await keyFor(5);
    vi.stubGlobal('indexedDB', undefined);
    expect(await getPersistentLayout(key, valid)).toBeNull(); await expect(putPersistentLayout(key, 'embedding', layout())).resolves.toBeUndefined();
    vi.stubGlobal('indexedDB', { open() { throw new DOMException('Blocked', 'SecurityError'); } });
    expect(await getPersistentLayout(key, valid)).toBeNull(); await expect(clearPersistentLayoutCache()).resolves.toBe(false);
    vi.stubGlobal('indexedDB', { open() {
      const request: any = {};
      queueMicrotask(() => request.onblocked?.()); return request;
    } });
    expect(await getPersistentLayout(key, valid)).toBeNull();
  });

  it('ignores quota/write failures without rejecting completion or preserving half-writes', async () => {
    const key = await keyFor(6);
    const original = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function () { throw new DOMException('Storage full', 'QuotaExceededError'); });
    await expect(putPersistentLayout(key, 'embedding', layout())).resolves.toBeUndefined();
    expect(await getPersistentLayout(key, valid)).toBeNull();
    IDBObjectStore.prototype.put = original;
    expect(await rawEntries()).toEqual([]);
  });
});
