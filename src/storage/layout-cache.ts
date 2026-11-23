/** Optional completed-layout storage, separate from saved personal collections. */
export type PersistentLayoutKind = 'embedding' | 'packing';
export const LAYOUT_CACHE_DATABASE = 'birds-and-trees-layout-cache';
export const LAYOUT_CACHE_STORE = 'layouts';
export const LAYOUT_CACHE_LIMITS = Object.freeze({ maxEntries: 24, maxBytes: 16 * 1024 * 1024 });
const STORAGE_VERSION = 1;
const OPEN_TIMEOUT_MS = 1000, TRANSACTION_TIMEOUT_MS = 2000;
let generation = 0;

interface LayoutRecord {
  key: string;
  kind: PersistentLayoutKind;
  value: unknown;
  /** Canonical JSON payload bytes, excluding small IndexedDB record overhead. */
  bytes: number;
  touched: number;
  storageVersion: 1;
}
interface Entry { primaryKey: IDBValidKey; record: LayoutRecord }
const encoder = new TextEncoder();

/** JSON-compatible key material, with sorted object keys and stable array order. */
function canonicalJson(value: unknown, seen = new Set<object>()): string | undefined {
  if (value === undefined) return undefined;
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Layout cache keys require finite numbers.');
    return JSON.stringify(value);
  }
  if (typeof value !== 'object') throw new Error('Layout cache values must contain only JSON data.');
  if (seen.has(value)) throw new Error('Layout cache values cannot contain cycles.');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${Array.from(value, entry => canonicalJson(entry, seen) ?? 'null').join(',')}]`;
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) throw new Error('Layout cache values must contain plain JSON objects.');
    return `{${Object.keys(value).sort().flatMap(key => {
      const text = canonicalJson((value as Record<string, unknown>)[key], seen);
      return text === undefined ? [] : [`${JSON.stringify(key)}:${text}`];
    }).join(',')}}`;
  } finally { seen.delete(value); }
}

function serialized(value: unknown): { text: string; bytes: number } {
  const text = canonicalJson(value);
  if (text === undefined) throw new Error('A completed layout is required.');
  return { text, bytes: encoder.encode(text).byteLength };
}

/** Callers include source/algorithm/settings identity in payload; no human label is trusted. */
export async function deterministicLayoutKey(kind: PersistentLayoutKind, payload: unknown): Promise<string> {
  if (kind !== 'embedding' && kind !== 'packing') throw new Error('Unsupported layout cache kind.');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Cryptographic layout key hashing is unavailable.');
  const input = serialized({ storageVersion: STORAGE_VERSION, kind, payload }).text;
  const hash = await subtle.digest('SHA-256', encoder.encode(input));
  const hex = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
  return `layout-v${STORAGE_VERSION}:${kind}:${hex}`;
}

function keyKind(key: string): PersistentLayoutKind | null {
  const match = /^layout-v1:(embedding|packing):[a-f0-9]{64}$/.exec(key);
  return match ? match[1] as PersistentLayoutKind : null;
}

function validRecord(value: unknown, primaryKey: IDBValidKey): value is LayoutRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as LayoutRecord;
  if (Object.keys(item).some(key => !['key', 'kind', 'value', 'bytes', 'touched', 'storageVersion'].includes(key))) return false;
  if (typeof item.key !== 'string' || item.key !== primaryKey || item.storageVersion !== STORAGE_VERSION || keyKind(item.key) !== item.kind) return false;
  if (!Number.isSafeInteger(item.bytes) || item.bytes < 1 || item.bytes > LAYOUT_CACHE_LIMITS.maxBytes || !Number.isSafeInteger(item.touched) || item.touched < 0) return false;
  try { return serialized(item.value).bytes === item.bytes; } catch { return false; }
}

function openDatabase(): Promise<IDBDatabase | null> {
  return new Promise(resolve => {
    if (typeof indexedDB === 'undefined') { resolve(null); return; }
    let request: IDBOpenDBRequest, settled = false;
    const finish = (database: IDBDatabase | null) => {
      if (settled) { database?.close(); return; }
      settled = true; clearTimeout(timer); resolve(database);
    };
    const timer = setTimeout(() => finish(null), OPEN_TIMEOUT_MS);
    try { request = indexedDB.open(LAYOUT_CACHE_DATABASE, STORAGE_VERSION); }
    catch { finish(null); return; }
    request.onupgradeneeded = () => {
      try {
        if (!request.result.objectStoreNames.contains(LAYOUT_CACHE_STORE)) request.result.createObjectStore(LAYOUT_CACHE_STORE, { keyPath: 'key' });
      } catch { try { request.transaction?.abort(); } catch { /* optional storage */ } }
    };
    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => database.close();
      finish(database);
    };
    request.onerror = () => finish(null);
    request.onblocked = () => finish(null);
  });
}

async function transaction<T>(fallback: T, expectedGeneration: number, operation: (store: IDBObjectStore, finish: (value: T) => void) => void): Promise<T> {
  const database = await openDatabase();
  if (!database || generation !== expectedGeneration) { database?.close(); return fallback; }
  return new Promise(resolve => {
    let tx: IDBTransaction, result = fallback, settled = false;
    const done = () => {
      if (settled) return;
      settled = true; clearTimeout(timer); database.close();
      resolve(generation === expectedGeneration ? result : fallback);
    };
    const timer = setTimeout(() => { result = fallback; try { tx?.abort(); } catch { /* unavailable transaction */ } done(); }, TRANSACTION_TIMEOUT_MS);
    try {
      tx = database.transaction(LAYOUT_CACHE_STORE, 'readwrite');
      tx.oncomplete = done;
      tx.onerror = tx.onabort = () => { result = fallback; done(); };
      operation(tx.objectStore(LAYOUT_CACHE_STORE), value => { result = value; });
    } catch { result = fallback; try { tx!.abort(); } catch { /* optional storage */ } done(); }
  });
}

/** Read/repair in the same transaction used for touches and bounded LRU eviction. */
function entries(store: IDBObjectStore, expectedGeneration: number, callback: (values: Entry[]) => void) {
  const values: Entry[] = [], request = store.openCursor();
  request.onsuccess = () => {
    try {
      if (generation !== expectedGeneration) { store.transaction.abort(); return; }
      const cursor = request.result;
      if (!cursor) { callback(values); return; }
      if (validRecord(cursor.value, cursor.primaryKey)) values.push({ primaryKey: cursor.primaryKey, record: cursor.value });
      else cursor.delete();
      cursor.continue();
    } catch { try { store.transaction.abort(); } catch { /* optional storage */ } }
  };
}

function boundEntries(store: IDBObjectStore, values: Entry[]) {
  let bytes = 0, count = 0;
  values.sort((a, b) => b.record.touched - a.record.touched || a.record.key.localeCompare(b.record.key, 'en'));
  for (const item of values) {
    if (count >= LAYOUT_CACHE_LIMITS.maxEntries || bytes + item.record.bytes > LAYOUT_CACHE_LIMITS.maxBytes) store.delete(item.primaryKey);
    else { count++; bytes += item.record.bytes; }
  }
}

export async function getPersistentLayout<T>(key: string, validate: (value: unknown) => value is T): Promise<T | null> {
  if (!keyKind(key)) return null;
  const expectedGeneration = generation;
  try {
    return await transaction<T | null>(null, expectedGeneration, (store, finish) => entries(store, expectedGeneration, values => {
      const found = values.find(item => item.record.key === key);
      if (found) {
        let accepted = false;
        try { accepted = validate(found.record.value); } catch { /* corrupt caller payload */ }
        if (accepted) {
          found.record.touched = Math.max(Date.now(), ...values.map(item => item.record.touched + 1));
          store.put(found.record); finish(found.record.value as T);
        } else {
          store.delete(found.primaryKey); values.splice(values.indexOf(found), 1);
        }
      }
      boundEntries(store, values);
    }));
  } catch { return null; }
}

/** Capture when generation starts, so clearing also invalidates not-yet-completed computations. */
export function persistentLayoutCacheEpoch(): number { return generation; }

export async function putPersistentLayout(key: string, kind: PersistentLayoutKind, value: unknown, expectedEpoch = generation): Promise<void> {
  if (keyKind(key) !== kind) return;
  const expectedGeneration = expectedEpoch;
  if (expectedGeneration !== generation) return;
  try {
    const payload = serialized(value);
    if (payload.bytes > LAYOUT_CACHE_LIMITS.maxBytes) return;
    const copy = JSON.parse(payload.text) as unknown;
    await transaction(undefined, expectedGeneration, store => entries(store, expectedGeneration, values => {
      const retained = values.filter(item => item.record.key !== key);
      const record: LayoutRecord = { key, kind, value: copy, bytes: payload.bytes, touched: Math.max(Date.now(), ...values.map(item => item.record.touched + 1)), storageVersion: STORAGE_VERSION };
      store.put(record); retained.push({ primaryKey: key, record }); boundEntries(store, retained);
    }));
  } catch { /* optional cache: quota, blocked storage and serialization never break generation */ }
}

export async function discardPersistentLayout(key: string): Promise<void> {
  const expectedGeneration = generation;
  try { await transaction(undefined, expectedGeneration, store => { store.delete(key); }); } catch { /* optional cache */ }
}

/** Increment synchronously, so older queued reads/writes cannot repopulate a cleared cache. */
export async function clearPersistentLayoutCache(): Promise<boolean> {
  const expectedGeneration = ++generation;
  try { return await transaction(false, expectedGeneration, (store, finish) => { store.clear(); finish(true); }); }
  catch { return false; }
}
