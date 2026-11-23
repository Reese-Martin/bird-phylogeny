import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { captureColor, colorFamily, interiorColorSample, oklabToHex, predominantColor, rgbToOklab } from '../scripts/sticker-colors';
import { COLOR_FAMILY_ORDER, colorOrderedWithinGroups, compareStickerColors, type StickerColorsFile, type StickerColor } from '../src/tree/color-order';
import type { Taxon } from '../src/types';

const pixels = (colors: number[][]) => Uint8Array.from(colors.flat());
const swatch = (r: number, g: number, b: number): StickerColor => predominantColor(pixels([[r, g, b, 255]]), 1, 1)!;

describe('opaque illustration color measurement', () => {
  it('uses the published OKLab sRGB matrices and inverse without changing primary swatches', () => {
    expect(rgbToOklab(255, 255, 255)[0]).toBeCloseTo(1, 6);
    expect(rgbToOklab(0, 0, 0)).toEqual([0, 0, 0]);
    expect(rgbToOklab(255, 0, 0)).toEqual(expect.arrayContaining([expect.closeTo(0.627955, 5), expect.closeTo(0.224863, 5), expect.closeTo(0.125846, 5)]));
    for (const rgb of [[255, 0, 0], [0, 255, 0], [0, 0, 255], [120, 120, 120], [110, 75, 40]]) expect(oklabToHex(rgbToOklab(...rgb as [number, number, number]))).toBe('#' + rgb.map(v => v.toString(16).padStart(2, '0')).join(''));
  });

  it('excludes transparent backgrounds and faint shadow pixels, including the exact alpha boundary', () => {
    const body = [110, 75, 40, 255];
    const result = predominantColor(pixels([...Array.from({ length: 200 }, () => [255, 0, 255, 0]), ...Array.from({ length: 100 }, () => [0, 0, 0, 223]), body]), 301, 1)!;
    expect(result.family).toBe('brown'); expect(result.hex).toBe('#6e4b28'); expect(result.familyShare).toBe(1);
    expect(predominantColor(pixels([[255, 0, 0, 223]]), 1, 1)).toBeNull();
    expect(predominantColor(pixels([[255, 0, 0, 224]]), 1, 1)?.family).toBe('red');
  });

  it('selects opaque area rather than averaging unlike color patches into an invented middle hue', () => {
    const image = pixels([...Array.from({ length: 6 }, () => [230, 30, 30, 255]), ...Array.from({ length: 4 }, () => [30, 180, 70, 255])]);
    const result = predominantColor(image, 10, 1)!;
    expect(result.family).toBe('red'); expect(result.hex).toBe('#e61e1e'); expect(result.familyShare).toBe(0.6);
    expect(predominantColor(image, 10, 1)).toEqual(result);
  });

  it('removes a three-pixel opaque white outline while preserving white interiors and tiny/thin fallback', () => {
    const rgba = new Uint8Array(31 * 31 * 4);
    for (let y = 0; y < 31; y++) for (let x = 0; x < 31; x++) rgba.set(x < 3 || y < 3 || x >= 28 || y >= 28 ? [255, 255, 255, 255] : [230, 30, 30, 255], (y * 31 + x) * 4);
    const sample = interiorColorSample(rgba, 31, 31);
    expect(sample.fallback).toBe(false); expect(sample.sampledPixels).toBe(25 * 25);
    expect(predominantColor(sample.rgba, 31, 31)?.family).toBe('red');
    const white = pixels(Array.from({ length: 31 * 31 }, () => [255, 255, 255, 255]));
    expect(predominantColor(interiorColorSample(white, 31, 31).rgba, 31, 31)?.family).toBe('white');
    const thin = pixels(Array.from({ length: 3 * 40 }, () => [30, 70, 220, 255]));
    expect(interiorColorSample(thin, 3, 40).fallback).toBe(true);
    expect(predominantColor(interiorColorSample(thin, 3, 40).rgba, 3, 40)?.family).toBe('blue');
  });

  it('distinguishes neutral and brown surfaces from saturated warm/cool surfaces', () => {
    for (const [rgb, family] of [ [[10, 10, 10], 'black'], [[120, 120, 120], 'gray'], [[250, 250, 250], 'white'], [[110, 75, 40], 'brown'], [[230, 30, 30], 'red'], [[245, 130, 20], 'orange'], [[240, 220, 20], 'yellow'], [[30, 180, 70], 'green'], [[30, 70, 220], 'blue'], [[240, 140, 180], 'pink'] ] as const) expect(colorFamily(rgbToOklab(rgb[0], rgb[1], rgb[2]))).toBe(family);
  });

  it('rejects malformed RGBA input rather than silently measuring a partial buffer', () => {
    expect(() => predominantColor(new Uint8Array(3), 1, 1)).toThrow('RGBA dimensions');
  });
});

describe('stable color ordering within existing groups', () => {
  const colors = { black: swatch(10, 10, 10), gray: swatch(120, 120, 120), white: swatch(250, 250, 250), brown: swatch(110, 75, 40), red: swatch(230, 30, 30), blue: swatch(30, 70, 220), twin: swatch(30, 70, 220) };
  it('orders neutrals, browns and hues with deterministic ties and missing artwork last', () => {
    expect(['missingZ', 'blue', 'white', 'brown', 'red', 'gray', 'black', 'missingA', 'twin'].sort((a, b) => compareStickerColors(a, b, colors))).toEqual(['black', 'gray', 'white', 'brown', 'red', 'blue', 'twin', 'missingA', 'missingZ']);
    expect(compareStickerColors('blue', 'blue', colors)).toBe(0);
    expect(compareStickerColors('blue', 'twin', colors)).toBeLessThan(0);
  });
  it('retains group order and membership instead of mixing colors across orders', () => {
    const rows = [{ code: 'blue', order: 'B' }, { code: 'white', order: 'B' }, { code: 'red', order: 'A' }, { code: 'black', order: 'A' }];
    expect(colorOrderedWithinGroups(rows, r => r.code, r => r.order, colors).map(r => `${r.order}:${r.code}`)).toEqual(['B:white', 'B:blue', 'A:black', 'A:red']);
    expect(rows.map(r => r.code)).toEqual(['blue', 'white', 'red', 'black']);
  });
});

describe('complete pinned local color artifact', () => {
  const bytes = readFileSync('public/data/sticker-colors.json'), artifact: StickerColorsFile = JSON.parse(bytes.toString('utf8'));
  const source = JSON.parse(readFileSync('data/sticker-colors-source.json', 'utf8'));
  it('covers all 11,027 artwork species and retains the same pinned image catalog as geometry capture', () => {
    const taxa: Taxon[] = JSON.parse(readFileSync('public/data/taxa.json', 'utf8'));
    expect(Object.keys(artifact.species).sort()).toEqual(taxa.filter(t => t.category === 'species' && t.sticker).map(t => t.code).sort());
    expect(Object.keys(artifact.species)).toHaveLength(11027); expect(source.capture.noOpaquePixels).toEqual([]);
    const geometrySource = JSON.parse(readFileSync('data/sticker-geometry-source.json', 'utf8'));
    expect(source.inputImageCatalogSha256).toBe(geometrySource.inputImageCatalogSha256);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.output.sha256);
    expect(createHash('sha256').update(readFileSync(source.script.path)).digest('hex')).toBe(source.script.sha256);
    expect(createHash('sha256').update(readFileSync(source.inputLock.path)).digest('hex')).toBe(source.inputLock.sha256);
    expect(source.output.species).toBe(11027);
  });
  it('has finite bounded measurements and explicit family shares for every portrait', () => {
    expect(artifact.version).toBe(1);
    for (const color of Object.values(artifact.species)) {
      expect(color.hex).toMatch(/^#[0-9a-f]{6}$/); expect(COLOR_FAMILY_ORDER).toContain(color.family);
      for (const value of [...color.oklab, color.hue, color.lightness, color.chroma, color.familyShare, color.clusterShare]) expect(Number.isFinite(value)).toBe(true);
      expect(color.hue).toBeGreaterThanOrEqual(0); expect(color.hue).toBeLessThan(360);
      expect(color.lightness).toBeGreaterThanOrEqual(0); expect(color.lightness).toBeLessThanOrEqual(1);
      expect(color.clusterShare).toBeGreaterThan(0); expect(color.clusterShare).toBeLessThanOrEqual(color.familyShare + 1e-6); expect(color.familyShare).toBeLessThanOrEqual(1);
    }
  });
  it('reproduces several pinned real bird swatches from their source WebPs', async () => {
    const lock = JSON.parse(readFileSync('data/sources.lock.json', 'utf8'));
    for (const code of ['mallar3', 'norcar', 'blujay', 'houspa', 'amecro']) {
      const asset = lock.assets.find((a: {code: string}) => a.code === code);
      expect(asset, code).toBeDefined();
      expect(await captureColor(readFileSync(asset.files.find((f: {longSide: number}) => f.longSide === 384).path))).toEqual(artifact.species[code]);
    }
  });
});
