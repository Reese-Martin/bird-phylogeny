import type { Taxon } from '../types';
import type { ArtworkCache, ArtworkRequest } from './artwork-cache';
import type { ArtworkImage } from './artwork-image-loader';
import { artworkDimensions } from './sticker-delivery';

export const ARTWORK_TIERS = [32, 64, 128, 384] as const;
export interface ArtworkSelection { key?: string; fallbackKeys: string[]; tier: number }
export function baseArtworkPath(taxon: Taxon, large = false): string | undefined {
  if (/questionable|rejected|unsafe|quality-fallback/i.test(taxon.artworkStatus || '')) return undefined;
  return large ? taxon.sticker || taxon.stickerSmall : taxon.stickerSmall || taxon.sticker;
}

/** Physical-pixel tiers with hysteresis; only image resolution changes, never geometry. */
export class ArtworkResolver {
  private tiers = new Map<string, number>();
  select(taxon: Taxon, cssPixels: number, dpr = 1): ArtworkSelection {
    const source = baseArtworkPath(taxon, cssPixels > 150);
    if (!source) return { fallbackKeys: [], tier: 0 };
    const required = Math.max(1, cssPixels) * Math.max(1, Math.min(2, dpr || 1));
    const ideal = ARTWORK_TIERS.find(tier => tier >= required) || 384;
    const previous = this.tiers.get(taxon.code);
    let tier: number = ideal;
    if (previous !== undefined) {
      const lower = ARTWORK_TIERS[Math.max(0, ARTWORK_TIERS.indexOf(previous as typeof ARTWORK_TIERS[number]) - 1)];
      if (ideal > previous && required <= previous * 1.1) tier = previous;
      else if (ideal < previous && required >= lower * .75) tier = previous;
    }
    this.tiers.set(taxon.code, tier);
    if (!/^\/stickers\/(?:32|64|128|384)\/[^/]+\.webp$/.test(source)) return { key: source, fallbackKeys: [], tier };
    const path = (size: number) => source.replace(/\/stickers\/\d+\//, `/stickers/${size}/`);
    const fallbackTiers = [...ARTWORK_TIERS.filter(size => size < tier).reverse(), ...ARTWORK_TIERS.filter(size => size > tier)];
    return { key: path(tier), fallbackKeys: [...new Set([...fallbackTiers.map(path), taxon.stickerSmall, taxon.sticker].filter((p): p is string => !!p && p !== path(tier)))], tier };
  }
}

/** Protect a ready previous tier while the requested tier is loading. */
export function artworkRequests<T>(cache: Pick<ArtworkCache<T>, 'peek' | 'getReady'>, selection: ArtworkSelection, priority = 300, variants: readonly string[] = []): ArtworkRequest[] {
  if (!selection.key) return [];
  const candidates=[selection.key,...selection.fallbackKeys];
  const preview=selection.fallbackKeys.find(key=>/^\/stickers\/32\//.test(key));
  if(preview && !cache.getReady(candidates) && cache.peek(preview)?.state!=='failed') {
    // Fill the whole overview before spending slots on higher-resolution copies.
    return [{key:preview,priority:priority+400,fallbackKeys:candidates.filter(key=>key!==preview),variants}];
  }
  const requests: ArtworkRequest[] = [{ key: selection.key, priority, fallbackKeys: selection.fallbackKeys, variants }];
  if (cache.peek(selection.key)?.state !== 'ready') {
    const ready = cache.getReady(selection.fallbackKeys);
    if (ready) requests.push({ key: ready.key, priority: priority - 1, variants });
  }
  return requests;
}

export function readyArtwork<T>(cache: Pick<ArtworkCache<T>, 'getReady'>, selection: ArtworkSelection) {
  return cache.getReady(selection.key ? [selection.key, ...selection.fallbackKeys] : []);
}

/** Pure, alpha-preserving neutralization; no Canvas filter support is required. */
export function grayscalePixels(pixels: Uint8ClampedArray): void {
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = Math.round(pixels[i] * .2126 + pixels[i + 1] * .7152 + pixels[i + 2] * .0722);
    pixels[i] = gray; pixels[i + 1] = gray; pixels[i + 2] = gray;
  }
}

export function grayscaleArtwork(image: ArtworkImage): HTMLCanvasElement {
  const {width,height}=artworkDimensions(image);
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Could not prepare neutral artwork.');
  ctx.drawImage(image, 0, 0); const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  grayscalePixels(data.data); ctx.putImageData(data, 0, 0); return canvas;
}
