import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeEmbedding } from '../src/embedding/engine';
import { cacheRecords, embeddingFixture, FakeLayoutWorker as FakeWorker } from './fixtures/layout-workers';
let client: typeof import('../src/embedding/client'), storage: typeof import('../src/storage/layout-cache');
beforeEach(async () => {
  vi.resetModules(); FakeWorker.instances = [];
  vi.stubGlobal('indexedDB', new IDBFactory()); vi.stubGlobal('Worker', FakeWorker);
  client = await import('../src/embedding/client'); storage = await import('../src/storage/layout-cache');
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function worker(index = 0) { await vi.waitFor(() => expect(FakeWorker.instances.length).toBeGreaterThan(index)); return FakeWorker.instances[index]; }
async function completed() {
  const fixture = embeddingFixture(), result = computeEmbedding(fixture.tree, fixture.taxa, fixture.codes);
  const run = client.startEmbedding(fixture.tree, fixture.taxa, fixture.codes), instance = await worker();
  instance.onmessage?.({ data: { type: 'complete', result } });
  const received = await run.promise;
  await vi.waitFor(async () => expect(await cacheRecords()).toHaveLength(1));
  return { ...fixture, result, received, instance };
}

describe('embedding asynchronous cache and worker lifecycle', () => {
  it('cancels immediately before hashing/read completes without starting a worker', async () => {
    const fixture = embeddingFixture(), run = client.startEmbedding(fixture.tree, fixture.taxa, fixture.codes);
    const rejected = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' });
    run.cancel(); run.cancel(); await rejected; await new Promise(resolve => setTimeout(resolve, 20));
    expect(FakeWorker.instances).toHaveLength(0); expect(await cacheRecords()).toHaveLength(0);
  });

  it('terminates active work and ignores late completion without caching', async () => {
    const fixture = embeddingFixture(), run = client.startEmbedding(fixture.tree, fixture.taxa, fixture.codes), instance = await worker();
    const rejected = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel();
    instance.onmessage?.({ data: { type: 'complete', result: computeEmbedding(fixture.tree, fixture.taxa, fixture.codes) } });
    await rejected; expect(instance.terminated).toBe(true); expect(await cacheRecords()).toHaveLength(0);
  });

  it('returns construction failures as rejected promises', async () => {
    vi.stubGlobal('Worker', class { constructor() { throw new Error('Worker unavailable'); } });
    const f = embeddingFixture(), run = client.startEmbedding(f.tree, f.taxa, f.codes);
    await expect(run.promise).rejects.toThrow('Worker unavailable'); run.cancel();
  });

  it('hashes and computes one immutable source snapshot across asynchronous lookups', async () => {
    const f = embeddingFixture(), run = client.startEmbedding(f.tree, f.taxa, f.codes);
    f.tree.nodes[1].length = 99; f.taxa[0].treeTip = 2;
    const instance = await worker(); expect(instance.message.tree.nodes[1].length).toBe(1); expect(instance.message.taxa[0].treeTip).toBe(1);
    const { tree, taxa, codes } = instance.message;
    instance.onmessage?.({ data: { type: 'complete', result: computeEmbedding(tree, taxa, codes) } });
    expect((await run.promise).points).toHaveLength(2);
  });

  it('computes without caching when cryptographic hashing is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    const f = embeddingFixture(), run = client.startEmbedding(f.tree, f.taxa, f.codes), instance = await worker();
    instance.onmessage?.({ data: { type: 'complete', result: computeEmbedding(f.tree, f.taxa, f.codes) } });
    expect((await run.promise).metadata.cacheSource).toBe('computed'); expect(await cacheRecords()).toHaveLength(0);
  });

  it('uses memory then persisted coordinates after module reload without another worker', async () => {
    const f = await completed(); expect(f.received.metadata.cacheSource).toBe('computed'); expect(f.received.metadata.elapsedMs).toBe(f.result.metadata.elapsedMs);
    expect(f.received.metadata.loadMs).toBeGreaterThanOrEqual(0); expect(f.instance.terminated).toBe(true); expect(f.instance.message).toMatchObject({ method: 'mds' });
    const memory = await client.startEmbedding(f.tree, f.taxa, [...f.codes].reverse()).promise;
    expect(memory.metadata.cacheSource).toBe('memory'); expect(memory.metadata.cacheReadMs).toBe(0);
    vi.resetModules(); const reloaded = await import('../src/embedding/client');
    const disk = await reloaded.startEmbedding(structuredClone(f.tree), f.taxa, f.codes).promise;
    expect(disk.metadata.cacheSource).toBe('persistent'); expect(disk.metadata.elapsedMs).toBe(f.result.metadata.elapsedMs); expect(disk.points).toEqual(f.result.points);
    expect(FakeWorker.instances).toHaveLength(1);
    const text = JSON.stringify(await cacheRecords()); expect(text).not.toContain('checklist'); expect(text).not.toContain('originalNames'); expect(text).not.toContain('sourceTree'); expect(text).not.toContain('matrix'); expect(text).not.toContain('cacheSource');
  });

  it('invalidates same-version source changes, mapping, membership, method and parameter changes', async () => {
    const f = await completed();
    const changedTree = structuredClone(f.tree); changedTree.nodes[1].length += .1;
    const cases = [
      () => client.startEmbedding(changedTree, f.taxa, f.codes),
      () => client.startEmbedding(f.tree, f.taxa.map((t, i) => i ? t : { ...t, treeTip: 2 }), f.codes),
      () => client.startEmbedding(f.tree, f.taxa, [f.codes[0]]),
      () => client.startEmbedding(f.tree, f.taxa, f.codes, { method: 'umap' }),
    ];
    for (const start of cases) { const count = FakeWorker.instances.length, run = start(); await worker(count); const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; }
    const types = await import('../src/embedding/types'), previous = types.EMBEDDING_PARAMETERS.minDist;
    Object.assign(types.EMBEDDING_PARAMETERS, { minDist: .2 });
    try { const count = FakeWorker.instances.length, run = client.startEmbedding(f.tree, f.taxa, f.codes); await worker(count); const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; }
    finally { Object.assign(types.EMBEDDING_PARAMETERS, { minDist: previous }); }
    // In-place edge mutation is detected too, rather than trusting object identity.
    f.tree.nodes[1].length += .2; const count = FakeWorker.instances.length, run = client.startEmbedding(f.tree, f.taxa, f.codes); await worker(count); const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled;
  });

  it('rejects corrupted cached coverage/nonfinite points and computes again', async () => {
    const f = await completed(), [record] = await cacheRecords();
    for (const corrupt of [() => { record.value.result.points[0].x = null; }, () => { record.value.result.points.pop(); }]) {
      corrupt(); await storage.putPersistentLayout(record.key, 'embedding', record.value); client.clearEmbeddingMemoryCache();
      const count = FakeWorker.instances.length, run = client.startEmbedding(f.tree, f.taxa, f.codes); await worker(count);
      const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled;
      expect(await cacheRecords()).toHaveLength(0);
    }
  });

  it('cancels a delayed disk lookup without delivering a stale hit or writing', async () => {
    let release!: (value: null) => void;
    vi.spyOn(storage, 'getPersistentLayout').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const put = vi.spyOn(storage, 'putPersistentLayout'), f = embeddingFixture(), run = client.startEmbedding(f.tree, f.taxa, f.codes);
    await vi.waitFor(() => expect(release).toBeTypeOf('function'));
    const cancelled = expect(run.promise).rejects.toMatchObject({ name: 'AbortError' }); run.cancel(); await cancelled; release(null);
    await new Promise(resolve => setTimeout(resolve, 10)); expect(FakeWorker.instances).toHaveLength(0); expect(put).not.toHaveBeenCalled();
  });

  it('computes safely through disk lookup/write errors and does not refill after clearing', async () => {
    vi.spyOn(storage, 'getPersistentLayout').mockRejectedValue(new Error('Storage unavailable'));
    const put = vi.spyOn(storage, 'putPersistentLayout').mockRejectedValue(new Error('Quota exceeded'));
    const f = embeddingFixture(), result = computeEmbedding(f.tree, f.taxa, f.codes), run = client.startEmbedding(f.tree, f.taxa, f.codes), instance = await worker();
    instance.onmessage?.({ data: { type: 'complete', result } }); expect((await run.promise).metadata.cacheSource).toBe('computed'); await Promise.resolve(); expect(put).toHaveBeenCalledTimes(1);
    const next = client.startEmbedding(f.tree, f.taxa, [f.codes[0]]), nextWorker = await worker(1);
    await storage.clearPersistentLayoutCache(); client.clearEmbeddingMemoryCache();
    nextWorker.onmessage?.({ data: { type: 'complete', result: computeEmbedding(f.tree, f.taxa, [f.codes[0]]) } });
    expect((await next.promise).metadata.cacheSource).toBe('computed'); expect(put).toHaveBeenCalledTimes(1); expect(await cacheRecords()).toHaveLength(0);
  });
});
