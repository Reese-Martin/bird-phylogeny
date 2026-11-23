import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

// Exact revisions and hashes are deliberately immutable inputs. Updating a source
// requires reviewing a new lock and regenerating coverage, not silently following main.
const lock = JSON.parse(await readFile('data/sources.lock.json', 'utf8'));
const includeAssets = !process.argv.includes('--no-assets');
const inputs = [...lock.sources, ...(includeAssets ? lock.assets.flatMap((a: any) => a.files) : [])];
let done = 0, nextReport = 500;
for (let start = 0; start < inputs.length; start += 6) {
  await Promise.all(inputs.slice(start, start + 6).map(async (source: any) => {
    const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
    try { const local = await readFile(source.path); if (hash(local) === source.sha256) { done++; return; } } catch { /* fetch below */ }
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`${source.path}: HTTP ${response.status}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.equal(hash(bytes), source.sha256, `Hash mismatch for ${source.path}; source may have changed. Review before updating the lock.`);
    await mkdir(dirname(source.path), { recursive: true });
    await writeFile(source.path, bytes); done++;
  }));
  if (done >= nextReport || done === inputs.length) {
    console.log(`Verified ${done}/${inputs.length} pinned source files`); nextReport = done + 500;
  }
}
