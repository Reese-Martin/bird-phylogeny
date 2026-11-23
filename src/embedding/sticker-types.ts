/** Measured from the pinned local 384px assets with Everybird's alpha-mask method. */
export type StickerMask = [width: number, height: number, msbFirstBase64: string];
export interface StickerGeometry {
  massG: number;
  massSource: string;
  /** Native trimmed image aspect. Everybird packs/draws using the rounded mask aspect. */
  aspect: number;
  imageWidth: number;
  imageHeight: number;
  mask: StickerMask;
  /** Set mask cells / 24², including transparent space from the image aspect. */
  shape: number;
}
export interface StickerGeometryFile {
  version: 1;
  maskLongSide: 24;
  alphaThreshold: 40;
  shapeRef: number;
  exponents: { even: number; true: number };
  species: Record<string, StickerGeometry>;
}
export type StickerSizeMode = 'even' | 'true';
export type StickerGeometryData = StickerGeometryFile;
export type StickerGeometryEntry = StickerGeometry;
