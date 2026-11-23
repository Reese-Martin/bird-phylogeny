// Maintainer bootstrap for the initial reviewed source lock. Do not rerun this
// to upgrade revisions blindly; fetch-sources.ts is the normal reproducible fetch.
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
try {
  const current = JSON.parse(await fs.readFile('data/sources.lock.json', 'utf8'));
  if (current.artworkScope === 'all-available-current-species') throw new Error('The global artwork lock is already prepared. Use fetch-sources.ts to reproduce it; do not overwrite it with the initial sample bootstrap.');
} catch (error) { if (error.code !== 'ENOENT') throw error; }
const revisions = { aves: '4af84f14f8f3df26bd4480202689b08ea0fc2c48', everybird: '50510c2209280b9f259545d8ab08e13970d5f8e6', stickers: 'b7749a623585b18320cb0e0271da63ee20c701c0', huashu: '3b42ef839501b93166e578075c4ea97adb4c4fa5' };
const raw = 'https://raw.githubusercontent.com/';
const specs = [
  ['tree', 'tree.nex', `${raw}McTavishLab/AvesData/${revisions.aves}/Tree_versions/Aves_1.7/Clements2025/summary_dated_clements.nex`, revisions.aves, 'CC BY 4.0'],
  ['tree-documentation', 'aves-readme.md', `${raw}McTavishLab/AvesData/${revisions.aves}/README.md`, revisions.aves, 'CC BY 4.0'],
  ['tree-history', 'aves-history.txt', `${raw}McTavishLab/AvesData/${revisions.aves}/Tree_versions/Aves_1.7/Clements2025/history.txt`, revisions.aves, 'CC BY 4.0'],
  ['source-taxonomy', 'ott2025.csv', `${raw}McTavishLab/AvesData/${revisions.aves}/Taxonomy_versions/Clements2025/OTT_crosswalk_2025.csv`, revisions.aves, 'CC BY 4.0 (AvesData); Clements attribution retained'],
  ['target-taxonomy', 'ebird2026.json', 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&version=2026', '2026', 'Cornell Lab reference taxonomy; no open license specified in response'],
  ['artwork-concepts-and-quality', 'huashu-species.json', `${raw}alchaincyf/huashu-bird-sticker/${revisions.huashu}/data/species.json`, revisions.huashu, 'CC BY 4.0 data/artwork'],
  ['artwork-mapping', 'everybird-species.json', `${raw}yusuftaleb/everybird/${revisions.everybird}/public/data/species.v1.json`, revisions.everybird, 'MIT metadata; artwork CC BY 4.0'],
  ['artwork-versions', 'sticker-versions.json', `${raw}yusuftaleb/everybird/${revisions.everybird}/data/sticker-versions.json`, revisions.everybird, 'MIT metadata; artwork CC BY 4.0'],
  ['everybird-license', 'everybird-LICENSE', `${raw}yusuftaleb/everybird/${revisions.everybird}/LICENSE`, revisions.everybird, 'MIT'],
  ['stickers-license', 'stickers-LICENSE', `${raw}yusuftaleb/everybird-stickers/${revisions.stickers}/LICENSE`, revisions.stickers, 'CC BY 4.0'],
  ['stickers-documentation', 'stickers-README.md', `${raw}yusuftaleb/everybird-stickers/${revisions.stickers}/README.md`, revisions.stickers, 'CC BY 4.0'],
];
const hash = b => createHash('sha256').update(b).digest('hex');
const retrievedAt = new Date().toISOString();
const sources = [];
await fs.mkdir('data/raw', { recursive: true });
for (const [id, file, url, revision, license] of specs) {
  const path = `data/raw/${file}`;
  let b;
  try { b = await fs.readFile(path); } catch {
    const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
    b = Buffer.from(await r.arrayBuffer()); await fs.writeFile(path, b);
  }
  sources.push({ id, path, url, revision, sha256: hash(b), bytes: b.length, retrievedAt, license });
}
const species = JSON.parse(await fs.readFile('data/raw/everybird-species.json')).species;
const stickerIndex = JSON.parse(await fs.readFile('data/raw/everybird-stickers-files.json'));
const availablePaths = new Set(stickerIndex.tree.map(x => x.path));
const names = ['California Quail','Mallard','Wood Duck','Wild Turkey',"Anna's Hummingbird",'Rufous Hummingbird','American Coot','Sandhill Crane','Killdeer','Saltmarsh Willet','Prairie Willet','Black-necked Stilt','American Avocet','Western Gull','Atlantic Puffin','Brown Pelican','Great Blue Heron','Snowy Egret','Green Heron','Double-crested Cormorant','Turkey Vulture','Bald Eagle','Golden Eagle','Red-tailed Hawk','Great Horned Owl','Downy Woodpecker','Acorn Woodpecker','Northern Flicker','American Kestrel','Peregrine Falcon','Blue Jay',"Steller's Jay",'American Crow','Common Raven','Black-capped Chickadee','Bushtit','Ruby-crowned Kinglet',"Bewick's Wren",'American Robin','Western Bluebird','Cedar Waxwing','Dark-eyed Junco','White-crowned Sparrow','Song Sparrow','Red-winged Blackbird','Western Meadowlark','Northern Cardinal','House Finch','American Goldfinch','Emperor Penguin','Common Ostrich','Hoatzin','Resplendent Quetzal','Keel-billed Toucan','Scarlet Macaw','Blue-footed Booby'];
const assets = [];
await fs.mkdir('public/stickers/128', { recursive: true });
await fs.mkdir('public/stickers/384', { recursive: true });
for (let i = 0; i < names.length; i += 6) {
  const batch = await Promise.all(names.slice(i, i + 6).map(async name => {
    const s = species.find(s => s.com === name); if (!s?.st || s.q === false) { console.log('No suitable sample artwork', name); return null; }
    const desiredFile = s.code + (s.sv ? `.${s.sv}` : '') + '.webp';
    const file = availablePaths.has(`v1/384/${desiredFile}`) ? desiredFile : `${s.code}.webp`;
    if (!availablePaths.has(`v1/384/${file}`)) { console.log('No published sample artwork', name); return null; }
    const files = [];
    for (const size of [128, 384]) {
      const url = `${raw}yusuftaleb/everybird-stickers/${revisions.stickers}/v1/${size}/${file}`;
      const path = `public/stickers/${size}/${s.code}.webp`;
      let b; try { b = await fs.readFile(path); } catch {
        const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`);
        b = Buffer.from(await r.arrayBuffer()); await fs.writeFile(path, b);
      }
      files.push({ path, url, sha256: hash(b), bytes: b.length, longSide: size, retrievedAt });
    }
    return { code: s.code, name: s.com, localPath: `/stickers/384/${s.code}.webp`, smallPath: `/stickers/128/${s.code}.webp`,
      revision: revisions.stickers, sourceFile: file, license: 'CC BY 4.0', quality: file === desiredFile && s.q === true ? 'meets-source-quality-bar' : 'unknown', files };
  }));
  assets.push(...batch.filter(Boolean)); console.log('Sample assets', assets.length);
}
await fs.writeFile('data/sources.lock.json', JSON.stringify({ schemaVersion: 1, revisions, sources, assets }, null, 2) + '\n');
await fs.copyFile('data/raw/stickers-LICENSE', 'public/data/LICENSE-stickers.txt');
await fs.copyFile('data/raw/everybird-LICENSE', 'public/data/LICENSE-everybird.txt');
console.log('Pinned sources', sources.length, 'artwork species', assets.length);
