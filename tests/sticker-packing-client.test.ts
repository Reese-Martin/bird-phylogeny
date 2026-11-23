import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { packStickers } from '../src/embedding/sticker-packing';
import { cacheRecords, FakeLayoutWorker as FakeWorker } from './fixtures/layout-workers';
let client: typeof import('../src/embedding/sticker-packing-client'), storage: typeof import('../src/storage/layout-cache');
const input = () => [{ code: 'a', x: 0, y: 0, width: 1, height: 1, mask: [1, 1, 'gA=='] as [number, number, string] }, { code: 'b', x: 1, y: 1, width: 2, height: 1 }];
beforeEach(async () => {
  vi.resetModules(); FakeWorker.instances = []; vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('Worker', FakeWorker);
  client = await import('../src/embedding/sticker-packing-client'); storage = await import('../src/storage/layout-cache');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function worker(index = 0) { await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(index)); return FakeWorker.instances[index]; }
async function completed() {
  const points = input(), result = packStickers(points), run = client.startStickerPacking(points), instance = await worker();
  instance.onmessage?.({ data: { type: 'complete', result } }); const received = await run.promise;
  await vi.waitFor(async () => expect(await cacheRecords()).toHaveLength(1)); return { points, result, received, instance };
}

describe('packing asynchronous cache and worker lifecycle', () => {
  it('cancels before lookup completion and ignores a late worker completion', async () => {
    const early = client.startStickerPacking(input()), rejected = expect(early.promise).rejects.toMatchObject({ name: 'AbortError' }); early.cancel(); await rejected;
    await new Promise(resolve => setTimeout(resolve, 15)); expect(FakeWorker.instances).toHaveLength(0);
    const run = client.startStickerPacking(input()), instance = await worker(), cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel();
    instance.onmessage?.({ data: { type: 'complete', result: packStickers(input()) } }); await cancelled; expect(instance.terminated).toBe(true); expect(await cacheRecords()).toHaveLength(0);
  });

  it('rejects construction failures from the promise', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker unavailable'); } });
    const run = client.startStickerPacking(input()); await expect(run.promise).rejects.toThrow('Worker unavailable'); run.cancel();
  });

  it('hashes and packs the same coordinate/mask snapshot while lookup is pending', async () => {
    const points = input(), run = client.startStickerPacking(points);
    points[0].width = 50; points[0].mask![2] = 'AA==';
    const instance = await worker(); expect(instance.message.input[0].width).toBe(1); expect(instance.message.input[0].mask[2]).toBe('gA==');
    instance.onmessage?.({ data: { type: 'complete', result: packStickers(instance.message.input) } });
    expect((await run.promise).cacheSource).toBe('computed');
  });

  it('reports progress and reuses completed packing from memory and a reloaded client', async () => {
    const points = input(), result = packStickers(points), progress: number[] = [];
    const run = client.startStickerPacking(points, { onProgress: completed => progress.push(completed) }), instance = await worker();
    instance.onmessage?.({ data: { type: 'progress', completed: 2, total: 2 } }); instance.onmessage?.({ data: { type: 'complete', result } });
    const cold = await run.promise; expect(cold.cacheSource).toBe('computed'); expect(cold.elapsedMs).toBe(result.elapsedMs); expect(progress).toEqual([2]);
    expect((await client.startStickerPacking([...points].reverse()).promise).cacheSource).toBe('memory'); expect(FakeWorker.instances).toHaveLength(1);
    await vi.waitFor(async () => expect(await cacheRecords()).toHaveLength(1)); vi.resetModules(); const reloaded = await import('../src/embedding/sticker-packing-client');
    const disk = await reloaded.startStickerPacking(points).promise; expect(disk.cacheSource).toBe('persistent'); expect(disk.points).toEqual(result.points); expect(disk.elapsedMs).toBe(result.elapsedMs); expect(disk.loadMs).toBeGreaterThanOrEqual(0); expect(FakeWorker.instances).toHaveLength(1);
  });

  it('invalidates coordinates, dimensions, masks and every tuning setting', async () => {
    const f = await completed();
    const cases = [
      () => client.startStickerPacking(f.points.map((p, i) => i ? p : { ...p, x: .1 })),
      () => client.startStickerPacking(f.points.map((p, i) => i ? p : { ...p, width: 3 })),
      () => client.startStickerPacking(f.points.map((p, i) => i ? p : { ...p, mask: [1, 1, 'AA=='] })),
      () => client.startStickerPacking(f.points, { maxDisplacement: 0 }),
      () => client.startStickerPacking(f.points, { stickerScale: .5 }),
      () => client.startStickerPacking(f.points, { gap: .1 }),
      () => client.startStickerPacking(f.points, { targetCoverage: .5 }),
      () => client.startStickerPacking(f.points, { reserveCenter: true }),
    ];
    for (const start of cases) { const count = FakeWorker.instances.length, run = start(); await worker(count); const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; }
  });

  it('persists the count reservation and rejects a cached layout whose slot covers a portrait',async()=>{
    const points=input(),options={reserveCenter:true},result=packStickers(points,options),run=client.startStickerPacking(points,options),instance=await worker();
    instance.onmessage?.({data:{type:'complete',result}});expect((await run.promise).centerReserve).toEqual(result.centerReserve);
    await vi.waitFor(async()=>expect(await cacheRecords()).toHaveLength(1));
    const [record]=await cacheRecords();client.clearPackingMemoryCache();
    expect((await client.startStickerPacking(points,options).promise).cacheSource).toBe('persistent');
    const broken=structuredClone(record.value);broken.result.points[0].x=0;broken.result.points[0].y=0;
    await storage.putPersistentLayout(record.key,'packing',broken);client.clearPackingMemoryCache();
    const retry=client.startStickerPacking(points,options);await worker(1);const rejected=expect(retry.promise).rejects.toMatchObject({name:'AbortError'});retry.cancel();await rejected;
  });

  it('rejects cached missing coverage, nonfinite coordinates and mismatched settings', async () => {
    const f = await completed(), [record] = await cacheRecords();
    const base = structuredClone(record.value);
    for (const corrupt of [(v: any) => { v.result.points.pop(); }, (v: any) => { v.result.points[0].x = null; }, (v: any) => { v.settings.stickerScale = .25; }]) {
      const value = structuredClone(base); corrupt(value); await storage.putPersistentLayout(record.key, 'packing', value); client.clearPackingMemoryCache();
      const count = FakeWorker.instances.length, run = client.startStickerPacking(f.points); await worker(count); const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; expect(await cacheRecords()).toHaveLength(0);
    }
  });

  it('cancels an outstanding disk lookup immediately and survives storage/write failures', async () => {
    let release!: (value: null) => void;
    const read = vi.spyOn(storage, 'getPersistentLayout').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const run = client.startStickerPacking(input()); await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; release(null); await Promise.resolve(); expect(FakeWorker.instances).toHaveLength(0);
    read.mockRejectedValue(new Error('Blocked')); const put = vi.spyOn(storage, 'putPersistentLayout').mockRejectedValue(new Error('Quota exceeded'));
    const normal = client.startStickerPacking(input()), instance = await worker(); instance.onmessage?.({ data: { type: 'complete', result: packStickers(input()) } }); expect((await normal.promise).cacheSource).toBe('computed'); await Promise.resolve(); expect(put).toHaveBeenCalledTimes(1);
  });

  it('does not repopulate disk or memory when an old computation finishes after clear', async () => {
    const points = input(), run = client.startStickerPacking(points), instance = await worker();
    await storage.clearPersistentLayoutCache(); client.clearPackingMemoryCache();
    instance.onmessage?.({ data: { type: 'complete', result: packStickers(points) } }); await run.promise;
    expect(await cacheRecords()).toHaveLength(0);
    const next = client.startStickerPacking(points); await worker(1); const cancelled = expect(next.promise).rejects.toMatchObject({ name: 'AbortError' }); next.cancel(); await cancelled;
  });
});
