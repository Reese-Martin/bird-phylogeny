# Everybird size and silhouette measurements

The all-sticker UMAP presentation uses Everybird's **mass-based painted-area scaling** and the same alpha-mask capture procedure. The sizes describe relative illustration area derived from bird mass, not measured wingspans, body lengths, or identification marks.

The reference revision is [`50510c2209280b9f259545d8ab08e13970d5f8e6`](https://github.com/yusuftaleb/everybird/tree/50510c2209280b9f259545d8ab08e13970d5f8e6), which already supplies this project's pinned species/mass input. This is distinct from the older styling-reference revision in STYLE-NOTES.md. The actual local artwork remains pinned separately to `everybird-stickers` revision `b7749a623585b18320cb0e0271da63ee20c701c0`.

## Capture and provenance

`scripts/sticker-geometry.ts` reads **all 11,027 bundled 384 px WebP assets**, independently of any personal collection. It verifies every file's SHA-256 and Git blob SHA against `data/sources.lock.json`, decodes RGBA with Sharp, and extracts alpha. The images are already trimmed to their nonzero-alpha bounds by Everybird's source pipeline; this script measures the exact bundled files and does not edit or resize the artwork.

As in Everybird's [`mask.ts`](https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/mask.ts), the mask's longest side is **24 cells**, and its shorter side is the image aspect rounded to the nearest cell. Alpha is resized by exact area-average **BOX** weighting, rounded to an 8-bit value, and a cell is occupied only when that value is **greater than 40**. The row-major bits are packed MSB first. `shape` is occupied cells divided by **24² = 576**, including the transparent part of the long-side square. Native image dimensions/aspect are recorded too. Everybird's packer uses `longSide × mask.w / 24` and `longSide × mask.h / 24` for the tile; the rounded mask aspect can differ slightly from the native image aspect.

The output is `public/data/sticker-geometry.json`; its hash, input mass hash, full image-catalog hash, source URLs, algorithm settings and coverage are recorded in `data/sticker-geometry-source.json`. The measured file is served locally only when needed. No observation rows, locations, checklists or user-selected species list enter the capture script.

For independent comparison the script can fetch Everybird's pinned `masks.v2.json`. **10,483 masks match bit for bit.** The remaining **544** are explained by artwork-version differences: the local pinned bundle has an unversioned illustration while the newer Everybird mask references its `<code>.<sv>.webp` replacement. Every difference has that documented version mismatch; there are **zero unexplained differences and zero missing mask references**. We keep masks measured from the illustration actually displayed, rather than substituting a newer silhouette. The exact differing codes are in the source manifest, and both source-file mappings remain in their pinned inputs.

## Mass and relative size

Masses and `massSource` are retained exactly from the pinned Everybird species file. Among the bundled images, **10,417** masses are AVONET, **449** BIRDBASE, **152** genus estimates, **1** family estimate, and **8** explicit overrides. Estimates retain their labels; none is relabeled as a measured mass. Everybird's [`build-species.ts`](https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/scripts/build-data/build-species.ts) documents the source hierarchy: explicit override, matched AVONET, BIRDBASE, then genus/family/order/global median. Estimate pools contain only source masses and overrides, so estimates do not recursively feed other estimates.

The underlying mass references credited by Everybird are [AVONET](https://doi.org/10.1111/ele.13898) and [BIRDBASE](https://doi.org/10.1038/s41597-025-05615-3); their dataset attribution remains distinct from Everybird's software license and the illustration license.

The exact [`relSizes`](https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/pack.ts) formula is:

```
relative tile long side = (mass / lightest mass in the loaded list)^exponent
                       × sqrt((215 / 576) / max(0.05, shape))
```

Mass is floored at 0.1 g before exponentiation. The default **Evened out** exponent is **0.2**, making painted area proportional to mass^0.4. **True size** uses **1/3**, making painted area proportional to mass^(2/3). This means length inferred from mass rather than a measured length. The shape correction gives a long-legged or long-tailed illustration more tile space than a compact illustration of the same mass, so its painted body does not disappear. The reference shape is **215/576**. The whole loaded collection/country defines the lightest mass, and these relative sizes are retained when taxonomy filters hide some birds; they are not recalculated from each filtered subset. These constants and the default are in [`constants.ts`](https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/constants.ts) and [`layout.worker.ts`](https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/layout.worker.ts).

The UMAP collision arrangement is specific to this app: it preserves UMAP neighborhoods as targets and moves drawings to avoid overlap. That movement is a display adjustment, not a new UMAP fit or new phylogenetic distance. Everybird's native collage layout itself is not a phylogenetic UMAP.

## Reproduce

```
.\npm.cmd run artwork:measure
```

This recomputes every local mask without network access and compares against the cached reference if present. On a new checkout, use the existing `data:fetch` task to restore any missing pinned raw inputs first. For a fresh pinned upstream reference, run `node --import tsx scripts/sticker-geometry.ts --fetch-reference`; its Git blob SHA is checked before use. Sharp is a pinned development dependency. The capture algorithm is adapted from Everybird under MIT; the original copyright/license is retained in `data/licenses/Everybird-MIT.txt`. Artwork retains its separate CC BY 4.0 attribution.
