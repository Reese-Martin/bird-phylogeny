import type { StickerMask } from './sticker-types';

/** Packing-only conservative occupancy; never use this for mass/shape sizing. */
export interface StickerCollisionMasksFile {
  version: 1;
  maskLongSide: 24;
  alphaThresholdExclusive: 0;
  sourcePixelGuard: 1;
  species: Record<string, StickerMask>;
}
