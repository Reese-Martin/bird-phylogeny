/** Predominant illustration colors, not a species/sex/plumage classification. */
export const COLOR_FAMILY_ORDER = ['black', 'gray', 'white', 'brown', 'red', 'orange', 'yellow', 'green', 'cyan', 'blue', 'purple', 'pink'] as const;
export type StickerColorFamily = typeof COLOR_FAMILY_ORDER[number];
export type StickerNeutralClass = 'black' | 'gray' | 'white' | 'brown' | 'chromatic';
export interface StickerColor {
  hex: string;
  oklab: [number, number, number];
  hue: number;
  lightness: number;
  chroma: number;
  neutralClass: StickerNeutralClass;
  family: StickerColorFamily;
  familyShare: number;
  clusterShare: number;
}
export interface StickerColorsFile {
  version: 1;
  algorithm: string;
  species: Record<string, StickerColor>;
}
export type StickerColorTable = Readonly<Record<string, StickerColor | undefined>>;
const ranks = new Map<string, number>(COLOR_FAMILY_ORDER.map((family, index) => [family, index]));
const codeCompare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;

/** Neutrals, browns, then warm-to-cool hues; missing artwork stays last. */
export function compareStickerColors(a: string, b: string, colors: StickerColorTable): number {
  if (a === b) return 0;
  const aa = colors[a], bb = colors[b];
  if (!aa || !bb) return aa ? -1 : bb ? 1 : codeCompare(a, b);
  const family = (ranks.get(aa.family) ?? 99) - (ranks.get(bb.family) ?? 99);
  if (family) return family;
  // Achromatic hue is unstable; lightness is the meaningful neutral ordering.
  if (aa.neutralClass !== 'chromatic') return aa.lightness - bb.lightness || aa.chroma - bb.chroma || codeCompare(a, b);
  // Pink/red straddle 0 degrees. Unwrap their hue inside the selected family.
  const hue = (value: StickerColor) => (value.family === 'red' || value.family === 'pink') && value.hue < 180 ? value.hue + 360 : value.hue;
  return hue(aa) - hue(bb) || aa.lightness - bb.lightness || aa.chroma - bb.chroma || codeCompare(a, b);
}

/** Keep the first-seen group sequence and color-sort only inside each group. */
export function colorOrderedWithinGroups<T>(values: readonly T[], codeOf: (value: T) => string, groupOf: (value: T) => string, colors: StickerColorTable): T[] {
  const groups = new Map<string, Array<{ value: T; index: number }>>();
  values.forEach((value, index) => { const key = groupOf(value), group = groups.get(key) || []; group.push({ value, index }); groups.set(key, group); });
  return [...groups.values()].flatMap(group => group.sort((a, b) => compareStickerColors(codeOf(a.value), codeOf(b.value), colors) || a.index - b.index).map(row => row.value));
}
