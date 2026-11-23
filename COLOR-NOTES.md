# Illustration colors and order-grouped arrangement

**Color within orders** is an optional birds-only radial arrangement. It keeps taxonomic orders together and sorts portraits inside each order by measured illustration color. Its angular slots and outward packing are decorative; they are not phylogenetic distances or dates. The tree is hidden in this arrangement, and the MDS Bird map is unchanged. Each recorded species gets one portrait, including birds without source-tree placement. Missing artwork/color measurements sort last by species code.

These measurements describe the bundled AI illustrations. They do not establish a species' definitive plumage, sex, age, season or diagnostic field marks. A large pale breast can determine an illustration's predominant color even when a smaller colored patch is more useful for identification. No bird-name rules, observation data or inferred sex metadata enter the analysis.

## Reproduce the capture

After installing the project's pinned dependencies, run from the project directory:

```powershell
.\node_modules\.bin\tsx.cmd scripts/sticker-colors.ts
```

[scripts/sticker-colors.ts](<scripts/sticker-colors.ts>) reads every **384 px** local WebP listed in `data/sources.lock.json`, verifies its SHA-256 and measures it with Sharp **0.35.5**. It reads no personal collection and makes no network requests. It writes:

- [public/data/sticker-colors.json](<public/data/sticker-colors.json>): versioned species-code table of representative hex, OKLab coordinates, hue, lightness, chroma, neutral class, color family and area shares.
- [data/sticker-colors-source.json](<data/sticker-colors-source.json>): exact thresholds, source revisions, input/catalog/script/output hashes, coverage and timing.

The image catalog SHA-256 is `5563dbf4150aaa25a294c8b9e9eb61236d3d688dc5228943f726b26e040cb161`, matching the separate geometry capture. The capture changes no images, size measurements or collision masks.

## Measurement

1. Decode to sRGB RGBA. Keep only pixels with **alpha ≥ 224**, excluding transparency, faint shadows and most antialiasing.
2. Remove a **three-pixel interior border** at the 384 px source size, measured by Manhattan distance to an excluded pixel or the image edge. This prevents opaque white sticker edging from dominating narrow illustrations while keeping white interiors. If fewer than **16 pixels** or **10%** of eligible pixels remain, use the original opaque sample instead. Faint pixels stay excluded in that fallback.
3. Quantize RGB to **4 bits per channel**. Each occupied bin retains its actual alpha-weighted mean RGB and weight `alpha / 255`; no image background is composited into the colors.
4. Convert those means to **OKLab** using the sRGB transfer function and Ottosson's 2021 D65 matrices. Classify area into black, gray, white, brown and chromatic hue families. Pick the family with the greatest total weight, rather than averaging unrelated patches into a new hue.
5. Find a representative tone inside that family with deterministic weighted **three-center OKLab k-means**, or fewer centers when fewer distinct bins exist. Start from the most populous bin, then choose weighted farthest seeds using `squared distance × sqrt(weight)`. Run **12 updates** and select the largest cluster. The representative hex is its centroid converted back to sRGB; numerical values are rounded to six decimals.

Neutral pixels have chroma ≤ **0.035**. Among them, lightness < **0.32** is black, lightness ≥ **0.82** is white, and the remainder is gray. Brown uses hue **[30°,105°)** and either lightness < **0.82** with chroma < **0.10**, or lightness < **0.68** with chroma < **0.16**. The manifest records all remaining hue-family boundaries and deterministic tie rules. These are practical display bins, not biological categories or universal color-name definitions.

`familyShare` is the selected family's fraction of sampled opaque area. `clusterShare` is the winning tone cluster's fraction of that same area. The hex therefore represents one predominant tone, not the complete multicolor palette. Achromatic hue is numerically unstable and is ignored when sorting neutrals.

The OKLab implementation follows [Björn Ottosson's primary description and conversion code](https://bottosson.github.io/posts/oklab/). The source code is offered under public-domain/MIT terms; illustration attribution remains huashu-bird-sticker / Everybird-stickers under CC BY 4.0, with exact repository pins in the manifest.

## Arrangement and verification

[src/tree/color-order.ts](<src/tree/color-order.ts>) exports the typed artifact and stable comparator. Within each existing group, it orders **black → gray → white → brown → red → orange → yellow → green → cyan → blue → purple → pink**, then missing colors. Neutrals and browns sort by lightness; chromatic families sort by hue and lightness. Species code breaks ties. `colorOrderedWithinGroups` preserves the first-seen group sequence and sorts only within each group. Tree integration uses source order sequence, with unmapped-only orders last, equal angular slots and small order gaps; its existing outward packing and Everybird size modes remain separate steps.

The complete capture measured **all 11,027 local artwork species**, with no empty opaque samples and no erosion fallback needed. It retained **484,000,665** of **528,707,681** eligible pixels. Two complete passes took **46.1 and 34.5 seconds** on this computer and produced byte-identical **2,273,339-byte** JSON artifacts. The artifact SHA-256 is `62c80b80404e8a794528e24fc297a9dd3331d82b98eb0f5590755aa900892b44`. Timing and provenance metadata are recorded separately from that deterministic artifact.

The original source images and these swatches were visually checked together:

| Illustration | Representative | Family | Predominant-family area |
| --- | --- | --- | --- |
| Blue Jay | `#88a3d6` | blue | 32.3% |
| House Sparrow | `#8a7c6f` | gray | 52.1% |
| Northern Cardinal | `#cb3022` | red | 52.3% |
| Monk Parakeet | `#708931` | green | 45.4% |
| American Crow | `#191a18` | black | 57.4% |
| Snowy Owl | `#dfdddc` | white | 85.9% |
| Scarlet Macaw | `#de392d` | red | 49.3% |

Removing the sticker border changed Blue Jay from white to blue, while Snowy Owl remained white. House Sparrow's gray/brown breast remains the largest sampled area; its smaller brown patches are not forced to determine the result.

[tests/sticker-colors.test.ts](<tests/sticker-colors.test.ts>) checks color conversion, alpha boundaries, outline removal, thin-sample fallback, multicolor predominance, neutral/brown/hue separation, stable within-group ordering, full species coverage, source hashes and repeated capture of real bird swatches. Historical embedding/packing experiments are unchanged.
