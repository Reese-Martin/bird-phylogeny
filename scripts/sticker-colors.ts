/** Numerical color capture of the complete pinned local artwork library. */
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { COLOR_FAMILY_ORDER, type StickerColor, type StickerColorFamily, type StickerColorsFile } from '../src/tree/color-order';

export const COLOR_ALGORITHM = 'opaque-family-oklab-kmeans-v1';
export const COLOR_SETTINGS = {
  inputLongSide: 384, alphaMinimumInclusive: 224, interiorErosionPixels: 3,
  interiorErosionMetric: 'Manhattan distance to alpha<224 or outside image',
  interiorFallbackMinimumPixels: 16, interiorFallbackMinimumShare: 0.1, histogramBitsPerChannel: 4,
  weights: 'alpha / 255', paletteClustersWithinDominantFamily: 3, kmeansIterations: 12,
  neutralChromaMaximum: 0.035, blackLightnessMaximumExclusive: 0.32, whiteLightnessMinimumInclusive: 0.82,
  brownHueMinimumInclusive: 30, brownHueMaximumExclusive: 105,
  brownConditions: [{ lightnessMaximumExclusive: 0.82, chromaMaximumExclusive: 0.1 }, { lightnessMaximumExclusive: 0.68, chromaMaximumExclusive: 0.16 }],
  pinkMinimumLightness: 0.62, hueBounds: { red: 'h < 40 or h >= 350, unless pink', orange: '[40,80)', yellow: '[80,115)', green: '[115,180)', cyan: '[180,235)', blue: '[235,290)', purple: '[290,330)', pink: '[330,350) or light h < 25 / h >= 330' },
  familyTieOrder: COLOR_FAMILY_ORDER, roundingDecimals: 6,
} as const;
const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const round = (value: number) => Math.round(value * 1e6) / 1e6;
const linear = (v: number) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
const gamma = (v: number) => Math.max(0, Math.min(1, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055));

/** Björn Ottosson's 2021 matrices, sRGB transfer function, D65. */
export function rgbToOklab(red: number, green: number, blue: number): [number, number, number] {
  const r = linear(red / 255), g = linear(green / 255), b = linear(blue / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
export function oklabToHex([L, a, b]: readonly number[]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return '#' + [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(v => Math.round(gamma(v) * 255).toString(16).padStart(2, '0')).join('');
}
export function colorFamily([L, a, b]: readonly number[]): StickerColorFamily {
  const C = Math.hypot(a, b), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (C <= COLOR_SETTINGS.neutralChromaMaximum) return L < 0.32 ? 'black' : L >= 0.82 ? 'white' : 'gray';
  if (h >= 30 && h < 105 && ((L < 0.82 && C < 0.1) || (L < 0.68 && C < 0.16))) return 'brown';
  if (L >= 0.62 && (h < 25 || h >= 330)) return 'pink';
  if (h < 40 || h >= 350) return 'red';
  if (h < 80) return 'orange';
  if (h < 115) return 'yellow';
  if (h < 180) return 'green';
  if (h < 235) return 'cyan';
  if (h < 290) return 'blue';
  if (h < 330) return 'purple';
  return 'pink';
}
interface Bin { key: number; weight: number; rgb: [number, number, number]; lab: [number, number, number]; family: StickerColorFamily }
const squared = (a: readonly number[], b: readonly number[]) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;

export function predominantColor(rgba: Uint8Array, width: number, height: number): StickerColor | null {
  assert.equal(rgba.length, width * height * 4, 'RGBA dimensions must match');
  const histogram = new Map<number, { weight: number; r: number; g: number; b: number }>();
  let total = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const alpha = rgba[i + 3];
    if (alpha < COLOR_SETTINGS.alphaMinimumInclusive) continue;
    const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2], weight = alpha / 255, key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    const bin = histogram.get(key) || { weight: 0, r: 0, g: 0, b: 0 };
    bin.weight += weight; bin.r += r * weight; bin.g += g * weight; bin.b += b * weight; histogram.set(key, bin); total += weight;
  }
  if (!total) return null;
  const bins: Bin[] = [...histogram.entries()].map(([key, bin]) => {
    const rgb: [number, number, number] = [bin.r / bin.weight, bin.g / bin.weight, bin.b / bin.weight], lab = rgbToOklab(...rgb);
    return { key, weight: bin.weight, rgb, lab, family: colorFamily(lab) };
  }).sort((a, b) => b.weight - a.weight || a.key - b.key);
  const areas = new Map<StickerColorFamily, number>(COLOR_FAMILY_ORDER.map(f => [f, 0]));
  for (const bin of bins) areas.set(bin.family, areas.get(bin.family)! + bin.weight);
  const family = [...COLOR_FAMILY_ORDER].sort((a, b) => areas.get(b)! - areas.get(a)! || COLOR_FAMILY_ORDER.indexOf(a) - COLOR_FAMILY_ORDER.indexOf(b))[0];
  const chosen = bins.filter(bin => bin.family === family), centers: number[][] = [[...chosen[0].lab]];
  while (centers.length < COLOR_SETTINGS.paletteClustersWithinDominantFamily && centers.length < chosen.length) {
    let candidate = chosen[0], best = -1;
    for (const bin of chosen) { const score = Math.min(...centers.map(center => squared(bin.lab, center))) * Math.sqrt(bin.weight); if (score > best) { best = score; candidate = bin; } }
    if (best <= 1e-16) break;
    centers.push([...candidate.lab]);
  }
  let weights: number[] = [];
  for (let iteration = 0; iteration <= COLOR_SETTINGS.kmeansIterations; iteration++) {
    weights = centers.map(() => 0); const sums = centers.map(() => [0, 0, 0]);
    for (const bin of chosen) {
      let nearest = 0, distance = Infinity;
      centers.forEach((center, index) => { const d = squared(bin.lab, center); if (d < distance) { nearest = index; distance = d; } });
      weights[nearest] += bin.weight; for (let axis = 0; axis < 3; axis++) sums[nearest][axis] += bin.lab[axis] * bin.weight;
    }
    if (iteration < COLOR_SETTINGS.kmeansIterations) for (let index = 0; index < centers.length; index++) if (weights[index]) centers[index] = sums[index].map(v => v / weights[index]);
  }
  const winner = weights.reduce((best, weight, index) => weight > weights[best] ? index : best, 0), lab = centers[winner] as [number, number, number], chroma = Math.hypot(lab[1], lab[2]);
  return { hex: oklabToHex(lab), oklab: lab.map(round) as [number, number, number], hue: round((Math.atan2(lab[2], lab[1]) * 180 / Math.PI + 360) % 360) % 360, lightness: round(lab[0]), chroma: round(chroma), neutralClass: family === 'black' || family === 'gray' || family === 'white' || family === 'brown' ? family : 'chromatic', family, familyShare: round(areas.get(family)! / total), clusterShare: round(weights[winner] / total) };
}

/** Exclude the opaque sticker edging without removing white interiors. */
export function interiorColorSample(rgba: Uint8Array, width: number, height: number) {
  assert.equal(rgba.length, width * height * 4, 'RGBA dimensions must match');
  const distance = new Uint16Array(width * height); let opaquePixels = 0;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * width + x;
    if (rgba[i * 4 + 3] < COLOR_SETTINGS.alphaMinimumInclusive) continue;
    opaquePixels++; distance[i] = Math.min(x ? distance[i - 1] + 1 : 1, y ? distance[i - width] + 1 : 1);
  }
  let interiorPixels = 0;
  for (let y = height - 1; y >= 0; y--) for (let x = width - 1; x >= 0; x--) {
    const i = y * width + x; if (!distance[i]) continue;
    distance[i] = Math.min(distance[i], x + 1 < width ? distance[i + 1] + 1 : 1, y + 1 < height ? distance[i + width] + 1 : 1);
    if (distance[i] > COLOR_SETTINGS.interiorErosionPixels) interiorPixels++;
  }
  const fallback = interiorPixels < COLOR_SETTINGS.interiorFallbackMinimumPixels || interiorPixels < opaquePixels * COLOR_SETTINGS.interiorFallbackMinimumShare;
  if (fallback) return { rgba, opaquePixels, sampledPixels: opaquePixels, interiorPixels, fallback: true };
  const sample = new Uint8Array(rgba);
  for (let i = 0; i < distance.length; i++) if (distance[i] <= COLOR_SETTINGS.interiorErosionPixels) sample[i * 4 + 3] = 0;
  return { rgba: sample, opaquePixels, sampledPixels: interiorPixels, interiorPixels, fallback: false };
}
async function captureColorDetails(bytes: Buffer) {
  const { data, info } = await sharp(bytes).toColourspace('srgb').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const sample = interiorColorSample(data, info.width, info.height);
  return { color: predominantColor(sample.rgba, info.width, info.height), opaquePixels: sample.opaquePixels, sampledPixels: sample.sampledPixels, fallback: sample.fallback };
}
export async function captureColor(bytes: Buffer): Promise<StickerColor | null> {
  return (await captureColorDetails(bytes)).color;
}
type Asset = { code: string; files: Array<{ path: string; sha256: string; gitBlobSha: string; longSide: number }> };
async function main() {
  const started = performance.now(), lockBytes = await readFile('data/sources.lock.json'), lock = JSON.parse(lockBytes.toString('utf8'));
  const assets = [...lock.assets as Asset[]].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
  const records: Record<string, StickerColor> = {}, hashes: string[] = [], missing: string[] = [], interiorFallbackCodes: string[] = [], familyCounts: Record<string, number> = {};
  let index = 0, completed = 0, opaquePixels = 0, sampledPixels = 0; sharp.concurrency(1);
  await Promise.all(Array.from({ length: 8 }, async () => {
    while (index < assets.length) {
      const asset = assets[index++], image = asset.files.find(file => file.longSide === 384);
      assert.ok(image, `${asset.code}: pinned 384px image required`);
      const bytes = await readFile(image.path); assert.equal(sha256(bytes), image.sha256, `${asset.code}: image hash mismatch`);
      const details = await captureColorDetails(bytes), color = details.color; hashes.push(`${asset.code}:${image.sha256}`);
      opaquePixels += details.opaquePixels; sampledPixels += details.sampledPixels;
      if (details.fallback) interiorFallbackCodes.push(asset.code);
      if (color) { records[asset.code] = color; familyCounts[color.family] = (familyCounts[color.family] || 0) + 1; } else missing.push(asset.code);
      if (++completed % 1000 === 0 || completed === assets.length) console.log(JSON.stringify({ completed, total: assets.length, elapsedMs: Math.round(performance.now() - started) }));
    }
  }));
  const artifact: StickerColorsFile = { version: 1, algorithm: COLOR_ALGORITHM, species: Object.fromEntries(Object.entries(records).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) }, output = JSON.stringify(artifact) + '\n';
  await writeFile('public/data/sticker-colors.json', output);
  const source = {
    version: 1, algorithm: COLOR_ALGORITHM, settings: COLOR_SETTINGS,
    scope: 'Predominant colors of the bundled illustrations, not definitive species/sex/season plumage metadata.',
    inputLock: { path: 'data/sources.lock.json', sha256: sha256(lockBytes) }, artworkRevision: lock.revisions.stickers, originalArtworkRevision: lock.revisions.huashu, everybirdRevision: lock.revisions.everybird,
    inputImageCount: assets.length, inputImageCatalogSha256: sha256(hashes.sort().join('\n')),
    script: { path: 'scripts/sticker-colors.ts', sha256: sha256(await readFile('scripts/sticker-colors.ts')) },
    sources: ['https://bottosson.github.io/posts/oklab/', `https://github.com/alchaincyf/huashu-bird-sticker/tree/${lock.revisions.huashu}`, `https://github.com/yusuftaleb/everybird-stickers/tree/${lock.revisions.stickers}`, `https://github.com/yusuftaleb/everybird/tree/${lock.revisions.everybird}`],
    colorMath: 'sRGB transfer to linear RGB, Ottosson 2021 D65 OKLab matrices. Cluster centroid inverse-converted to sRGB and clipped to [0,1].',
    capture: { completed, measured: Object.keys(records).length, noOpaquePixels: missing.sort(), interiorFallbackCodes: interiorFallbackCodes.sort(), opaquePixels, sampledPixels, familyCounts: Object.fromEntries(COLOR_FAMILY_ORDER.map(f => [f, familyCounts[f] || 0])), elapsedMs: Math.round(performance.now() - started) },
    output: { path: 'public/data/sticker-colors.json', sha256: sha256(output), bytes: Buffer.byteLength(output), species: Object.keys(records).length },
    sharpVersion: sharp.versions.sharp, license: 'Numerical artwork measurements; source illustrations CC BY 4.0. OKLab conversion code public domain / MIT by Björn Ottosson.',
  };
  await writeFile('data/sticker-colors-source.json', JSON.stringify(source, null, 2) + '\n');
  console.log(JSON.stringify({ complete: true, ...source.capture, bytes: source.output.bytes }));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(error => { console.error(error); process.exitCode = 1; });
