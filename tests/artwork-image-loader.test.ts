import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalImageLoader } from '../src/tree/artwork-image-loader';

const flush = async () => { for (let index = 0; index < 12; index++) await Promise.resolve(); };

class TestImage {
  static all: TestImage[] = [];
  decoding = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  naturalWidth = 32;
  naturalHeight = 24;
  src = '';
  decode = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  removeAttribute = vi.fn();
  constructor() { TestImage.all.push(this); }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('Image', TestImage);
  vi.stubGlobal('window', { location: { href: 'http://localhost:5173/', origin: 'http://localhost:5173' } });
  TestImage.all = [];
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('local artwork HTTP and decode scheduling', () => {
  it('starts another network image while the preceding decode is pending, with independent bounds', async () => {
    const loader = new LocalImageLoader({ networkConcurrency: 2, decodeConcurrency: 1 });
    const loads = ['a', 'b', 'c', 'd'].map(name => loader.load(`/stickers/32/${name}.webp`));
    expect(TestImage.all).toHaveLength(2);
    let firstDecoded!: () => void;
    TestImage.all[0].decode.mockImplementation(() => new Promise(resolve => firstDecoded = resolve));
    TestImage.all[0].onload!();
    expect(TestImage.all).toHaveLength(3);
    expect(loader.metrics()).toMatchObject({ activeNetwork: 2, activeDecode: 1, queuedNetwork: 1 });
    TestImage.all[1].onload!();
    expect(TestImage.all).toHaveLength(4);
    expect(TestImage.all[1].decode).not.toHaveBeenCalled();
    expect(loader.metrics()).toMatchObject({ activeNetwork: 2, activeDecode: 1, queuedDecode: 1 });
    TestImage.all[2].onload!(); TestImage.all[3].onload!();
    firstDecoded(); await Promise.all(loads);
    expect(loader.metrics()).toMatchObject({ requests: 4, networkCompleted: 4, decoded: 4, failures: 0, activeNetwork: 0, activeDecode: 0, queuedNetwork: 0, queuedDecode: 0 });
  });

  it('deduplicates in-flight URLs and releases ownership after completion', async () => {
    const loader = new LocalImageLoader();
    const first = loader.load('/stickers/32/a.webp?v=one'), same = loader.load('http://localhost:5173/stickers/32/a.webp?v=one');
    expect(first).toBe(same); expect(TestImage.all).toHaveLength(1);
    TestImage.all[0].onload!();
    expect(await first).toBe(TestImage.all[0]);
    expect(loader.metrics()).toMatchObject({ requests: 1, deduplicated: 1 });
    const next = loader.load('/stickers/32/a.webp?v=one');
    expect(TestImage.all).toHaveLength(2);
    TestImage.all[1].onload!(); await next;
  });

  it('releases a hung explicit decode after 250ms and finishes the rest of the queue', async () => {
    const loader = new LocalImageLoader({ networkConcurrency: 1, decodeConcurrency: 1, decodeQueueTimeoutMs: 500 });
    const first = loader.load('/a.webp'), second = loader.load('/b.webp');
    let delayed!: () => void;
    TestImage.all[0].decode.mockImplementation(() => new Promise(resolve => delayed = resolve));
    TestImage.all[0].onload!();
    TestImage.all[1].onload!();
    await vi.advanceTimersByTimeAsync(250);
    expect(await first).toBe(TestImage.all[0]); expect(await second).toBe(TestImage.all[1]);
    expect(loader.metrics()).toMatchObject({ decodeTimeouts: 1, decoded: 1, failures: 0, activeDecode: 0 });
    delayed(); await flush();
    expect(loader.metrics()).toMatchObject({ decodeTimeouts: 1, decoded: 1 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not queue an entire collection behind two stalled decode preparations', async () => {
    const loader = new LocalImageLoader({ networkConcurrency: 12, decodeConcurrency: 2 });
    const loads = Array.from({ length: 30 }, (_, index) => loader.load(`/${index}.webp`));
    // Loading each image starts the next HTTP task, independently of decode.
    for (let index = 0; index < 30; index++) {
      TestImage.all[index].decode.mockImplementation(() => new Promise(() => {}));
      TestImage.all[index].onload!();
    }
    expect(loader.metrics()).toMatchObject({ networkCompleted: 30, activeNetwork: 0, activeDecode: 2, queuedDecode: 28 });
    await vi.advanceTimersByTimeAsync(16);
    expect(loader.metrics()).toMatchObject({ decodeSkipped: 28, queuedDecode: 0, activeDecode: 2 });
    await vi.advanceTimersByTimeAsync(234);
    expect(await Promise.all(loads)).toHaveLength(30);
    expect(loader.metrics()).toMatchObject({ decodeTimeouts: 2, failures: 0, activeDecode: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps a loaded image drawable when optional explicit decode rejects', async () => {
    const loader = new LocalImageLoader();
    const ready = loader.load('/a.webp');
    TestImage.all[0].decode.mockRejectedValue(new Error('Decode interrupted'));
    TestImage.all[0].onload!();
    expect(await ready).toBe(TestImage.all[0]);
    expect(loader.metrics()).toMatchObject({ networkCompleted: 1, decodeFallbacks: 1, failures: 0 });
  });

  it('times out failed network work, clears handlers, and advances without waiting indefinitely', async () => {
    const loader = new LocalImageLoader({ networkConcurrency: 1, networkTimeoutMs: 1000 });
    const first = loader.load('/a.webp'), rejection = expect(first).rejects.toThrow('download timed out');
    const second = loader.load('/b.webp');
    await vi.advanceTimersByTimeAsync(1000); await rejection;
    expect(TestImage.all[0].onload).toBeNull(); expect(TestImage.all[0].onerror).toBeNull();
    expect(TestImage.all[0].removeAttribute).toHaveBeenCalledWith('src');
    expect(TestImage.all).toHaveLength(2);
    TestImage.all[1].onload!(); await second;
    expect(loader.metrics()).toMatchObject({ failures: 1, networkCompleted: 1, activeNetwork: 0, activeDecode: 0 });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects zero-sized images and network errors but never requests another origin', async () => {
    const loader = new LocalImageLoader();
    await expect(loader.load('https://example.com/bird.webp')).rejects.toThrow('served locally');
    await expect(loader.load('data:image/png;base64,abc')).rejects.toThrow('served locally');
    expect(TestImage.all).toHaveLength(0);
    const empty = loader.load('/empty.webp'), failed = loader.load('/failed.webp');
    TestImage.all[0].naturalWidth = 0;
    TestImage.all[0].onload!(); TestImage.all[1].onerror!();
    await expect(empty).rejects.toThrow('no drawable pixels');
    await expect(failed).rejects.toThrow('could not be loaded');
    expect(loader.metrics()).toMatchObject({ failures: 2, activeNetwork: 0 });
  });

  it('disposes queued, network and decode work without leaving promises or timers behind', async () => {
    const loader = new LocalImageLoader({ networkConcurrency: 1, decodeConcurrency: 1 });
    const pending = ['a', 'b', 'c'].map(name => loader.load(`/${name}.webp`));
    const settled = Promise.allSettled(pending);
    TestImage.all[0].decode.mockImplementation(() => new Promise(() => {}));
    TestImage.all[0].onload!();
    loader.dispose(); loader.dispose();
    expect((await settled).map(result => result.status)).toEqual(['rejected', 'rejected', 'rejected']);
    await expect(loader.load('/later.webp')).rejects.toMatchObject({ name: 'AbortError' });
    expect(loader.metrics()).toMatchObject({ cancelled: 3, activeNetwork: 0, activeDecode: 0, queuedNetwork: 0, queuedDecode: 0 });
    expect(TestImage.all[1].removeAttribute).toHaveBeenCalledWith('src');
    expect(vi.getTimerCount()).toBe(0);
  });
});
