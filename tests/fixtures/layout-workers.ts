import type { Taxon, TreeData } from '../../src/types';
import { LAYOUT_CACHE_DATABASE, LAYOUT_CACHE_STORE } from '../../src/storage/layout-cache';
export class FakeLayoutWorker {
  static instances: FakeLayoutWorker[] = [];
  onmessage?: (event: { data: any }) => void;
  onerror?: () => void;
  terminated = false;
  message?: any;
  constructor() { FakeLayoutWorker.instances.push(this); }
  postMessage(message: unknown) { this.message = message; }
  terminate() { this.terminated = true; }
}
export function embeddingFixture() {
  const tree: TreeData = { version: 'same-human-version', root: 0, tips: [1, 2], maxDistance: 1, nodes: [
    { id: 0, parent: null, children: [1, 2], length: 0, distance: 0, age: 1, leafStart: 0, leafEnd: 2 },
    { id: 1, parent: 0, children: [], length: 1, distance: 1, age: 0, leafStart: 0, leafEnd: 1 },
    { id: 2, parent: 0, children: [], length: 1, distance: 1, age: 0, leafStart: 1, leafEnd: 2 },
  ] };
  const taxa: Taxon[] = [1, 2].map(id => ({ code: `bird-${id}`, commonName: `Bird ${id}`, scientificName: `Testus bird${id}`, category: 'species', mappingStatus: 'exact', treeTip: id }));
  return { tree, taxa, codes: taxa.map(t => t.code) };
}
export async function cacheRecords() {
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LAYOUT_CACHE_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(LAYOUT_CACHE_STORE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  const records = await new Promise<any[]>((resolve, reject) => {
    const request = database.transaction(LAYOUT_CACHE_STORE, 'readonly').objectStore(LAYOUT_CACHE_STORE).getAll();
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
  });
  database.close(); return records;
}
