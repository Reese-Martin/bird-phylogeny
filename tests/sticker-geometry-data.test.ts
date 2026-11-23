import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { maskDims, maskFromAlpha, maskShape } from '../scripts/sticker-geometry';
import type { StickerGeometryData } from '../src/embedding/sticker-types';
import type { Taxon } from '../src/types';

const bytes = readFileSync('public/data/sticker-geometry.json');
const measured: StickerGeometryData = JSON.parse(bytes.toString('utf8'));
const source = JSON.parse(readFileSync('data/sticker-geometry-source.json', 'utf8'));

describe('Everybird silhouette capture', () => {
  it('retains the 24-cell long side, aspect rounding, MSB ordering and square-area denominator', () => {
    expect(maskDims(384, 192)).toEqual([24, 12]);
    expect(maskDims(160, 384)).toEqual([10, 24]);
    const alpha = new Uint8Array(24 * 12); alpha[0] = 255;
    const mask = maskFromAlpha(alpha, 24, 12);
    expect([...Buffer.from(mask[2], 'base64')].slice(0, 2)).toEqual([128, 0]);
    expect(maskShape(mask)).toBe(1 / 576);
  });

  it('uses BOX averaging and rounds to 8 bits before the exclusive alpha threshold', () => {
    const alpha = new Uint8Array(48 * 24);
    alpha[0] = alpha[1] = alpha[48] = alpha[49] = 40;
    alpha[2] = alpha[3] = 40; alpha[50] = alpha[51] = 41;
    const mask = maskFromAlpha(alpha, 48, 24);
    expect(Buffer.from(mask[2], 'base64')[0]).toBe(0x40);
  });
});

describe('complete local geometry artifact', () => {
  it('covers every bundled species and retains the sizing formula', () => {
    const taxa: Taxon[] = JSON.parse(readFileSync('public/data/taxa.json', 'utf8'));
    const stickerCodes = taxa.filter(taxon => taxon.category === 'species' && taxon.sticker).map(taxon => taxon.code).sort();
    expect(Object.keys(measured.species).sort()).toEqual(stickerCodes);
    expect(stickerCodes).toHaveLength(11027);
    expect(measured.exponents).toEqual({ even: 0.2, true: 1 / 3 });
    expect(measured.shapeRef).toBe(215 / 576);
  });

  it('contains valid measured masks and reports upstream image-version differences rather than borrowing masks', () => {
    for (const geometry of Object.values(measured.species)) {
      const [width, height, bits] = geometry.mask;
      expect(Number.isFinite(geometry.massG) && geometry.massG > 0).toBe(true);
      expect(geometry.massSource.length).toBeGreaterThan(0);
      expect(Math.max(width, height)).toBe(24);
      expect(Buffer.from(bits, 'base64')).toHaveLength(Math.ceil(width * height / 8));
      expect(geometry.shape).toBe(maskShape(geometry.mask));
      expect(geometry.shape).toBeGreaterThan(0);
      expect(geometry.aspect).toBe(Math.round(geometry.imageWidth / geometry.imageHeight * 10000) / 10000);
    }
    expect(source.comparison.compared).toBe(11027);
    expect(source.comparison.identical).toBe(10483);
    expect(source.comparison.expectedArtworkVersionDifferences).toBe(544);
    expect(source.comparison.unexpectedDifferentCodes).toEqual([]);
    expect(source.comparison.absentCodes).toEqual([]);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(source.output.sha256);
  });
});
