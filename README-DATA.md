# Published tree and taxonomy preparation

The browser uses committed, prepared data. Starting the local app does not need R, an eBird API key, an external image server, or a personal export.

The source tree is **Aves 1.7 / Clements 2025**, pinned to AvesData commit `4af84f14f8f3df26bd4480202689b08ea0fc2c48`. It contains **11,167 tips and 22,333 nodes**. [Source repository and documentation](https://github.com/McTavishLab/AvesData/tree/4af84f14f8f3df26bd4480202689b08ea0fc2c48), [McTavish et al. (2025), PNAS](https://www.pnas.org/doi/10.1073/pnas.2409658122).

Each input URL, revision, SHA-256 digest, byte size, retrieval timestamp and reuse notice is in [data/sources.lock.json](<data/sources.lock.json>). The generated [manifest](<public/data/manifest.json>) carries that provenance into the browser. Source files belong in the ignored `data/raw/` directory. Personal exports should be selected in the browser or kept in the ignored `personal/` directory.

## Reproduce the prepared files

Use Node 24 or later and install the exact package-lock dependencies with `npm ci`.

```powershell
npm run data:fetch
npm run taxonomy:import
npm run data:build
npm test
npm run test:provenance
```

`data:fetch` downloads only the locked files and fails if their hashes differ. Existing files with the correct hash are reused. The global artwork library covers **11,027 species at both 128 and 384 px**, with **22,054 WebP files totaling 235,863,538 bytes** (about 225 MiB). `--no-assets` skips artwork fetching. Source regeneration needs internet access; ordinary app startup does not. The 2026 eBird reference response is year-specific and hash-pinned: if Cornell changes its response formatting or content, review the change and update the lock deliberately.

`taxonomy:import` extracts the pinned official integrated workbook without changing it. It uses the bundled Codex Python when available, or Python 3 with **openpyxl 3.1.5**. Set `EVERYBIRD_PYTHON` to select another compatible executable. The direct equivalent is `python scripts/import-clements2026.py`; an optional workbook path imports an existing official download, for example `npm run taxonomy:import -- "C:\path\eBird-Clements_v2026_integrated-checklist-October-2026.xlsx"`. With no argument it reads `data/raw/clements2026-integrated.xlsx`. The original bytes must match the locked SHA-256 digest; a different release requires an explicit reviewed source update.

The extractor retains every nonempty worksheet row, including subspecies and groups, with source-row numbers, concept IDs, ranges, previous-year sort positions and annual-change text in `data/raw/clements2026-integrated.json`. These extra rows are evidence for reviewing species boundaries, not additional reportable species. Only the workbook's expected internal name-and-authority formulas are accepted; their cached values are checked against their input cells, and no formulas are executed. [data/clements2026-source.json](<data/clements2026-source.json>) records the original workbook, extractor and normalized-output hashes, sheet, headers, counts and API agreement. `data:build` verifies that provenance before producing browser data.

On this machine npm is bootstrapped inside the checkout; the [root README](<README.md>) explains the `npm.cmd` wrapper. The TypeScript preparation scripts also run directly using `node --experimental-strip-types scripts/fetch-sources.ts` and `node --experimental-strip-types scripts/build-data.ts` after dependencies have been installed.

`scripts/pin-initial-sources.mjs` records the initial reviewed pins. It is a maintainer bootstrap, not the upgrade command. It also expects the initial ignored GitHub sticker tree inventory. A future upgrade should review source release documentation, revise the input lock, inspect the crosswalk and its overrides, rebuild, and rerun tests. Never replace a source hash merely to make a failed verification pass.

`scripts/expand-artwork.ts` expanded the original demonstration subset into the **whole available global artwork library**, using 16 bounded download workers. It selects assets only from the public taxonomy, never from a personal collection. Each download is checked against its exact source Git blob hash, byte size and WebP signature before SHA-256 metadata is recorded. All source URLs and hashes are in the lock and the separate [artwork manifest](<public/data/artwork-manifest.json>); the small primary manifest links that file by hash so startup does not fetch all per-image provenance. Existing valid images are reused when the expansion script is rerun.

## Tree preservation and dates

The NEXUS file has literal species labels and exactly one tree. `scripts/tree-parser.ts` keeps its child order, root, topology, every branch length, source label, source node index, posterior annotation, and 95% age interval. It rejects TRANSLATE blocks and malformed or negative branch lengths. Node numbers are scoped to this dataset; collections store taxon codes rather than node numbers. Leaf intervals use **`[leafStart, leafEnd)` with an exclusive end**.

The root-to-tip distances range from `98.990001` to `98.99001200000001` million years. Their `0.000011` Ma spread comes from the source's rounded branch lengths and is retained. Node ages are computed from the maximum source root-to-tip distance. Validation uses a `1e-10` Ma branch-distance tolerance and a `0.001` Ma ultrametric tolerance. Parent ages never decrease toward the root.

The source README warns about a calibration error in **v1.6**; this preparation uses **v1.7**. The approximate root here is 98.99 Ma, and the source root's 95% interval spans 72–133 Ma. This app does not independently recalibrate the tree. Source posterior annotations are summary-tree annotations; they should not be read as independent molecular support for every taxonomy-added species. Study-level placement support remains unknown in this app.

The initial conversion uses the validated TypeScript reader. Its result has also been independently checked with the authors' [`clootl`](https://github.com/eliotmiller/clootl) package and `ape`. R was installed outside PATH at `C:\Program Files\R\R-4.5.0\bin\Rscript.exe`; the audit used **R 4.5.0, ape 5.8-1, and clootl 0.1.5**. The audit script supports **R >= 4.3 and ape >= 5.8**, with jsonlite and digest (their dependencies). It reads the exact pinned local NEXUS and compares it with clootl's packaged **Aves 1.7 / 2025** tree, without a mutable latest-tree download.

```r
install.packages(c("ape", "clootl"))
```

```powershell
Rscript scripts/prepare-tree.R
```

The R audit **passed**. All 11,167 tips, every rooted clade, leaf order, and all branch lengths agree. Every browser tip's cumulative root distance agrees exactly with ape; maximum incoming branch-length difference is `8.88e-16` Ma. The authors' packaged tree agrees with the pinned NEXUS after converting underscores in scientific labels to spaces. Evidence is saved in [tree-audit.json](<public/data/tree-audit.json>) and the manifest, bound to both source and prepared-tree SHA-256 hashes. Rebuilding a changed tree invalidates that evidence until the audit is rerun. The audit also writes ignored per-tip distances to `data/raw/ape-audit.csv`.

The authors' `clootl::getCitations` helper supplies **301 supporting citation entries**, including the taxonomic-additions entry. These are retained in [tree-citations.csv](<public/data/tree-citations.csv>), with their hash in the audit. They document contributions to the source tree; they do not establish molecular support for each displayed tip.

On this machine the added R packages reside in the ignored checkout-local `data/raw/R-library`; dependencies also use the existing Windows user R library. The script discovers both locations. No system R installation was modified. File hashes are computed from bytes read directly, avoiding a Windows sandbox ACL precheck that can report an otherwise readable file as inaccessible. R emitted locale and newer-patch-build warnings; the structural and numerical assertions all passed.

## Taxonomy and conservative coverage

The official [eBird v2026 reference taxonomy](https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&version=2026) supplies **18,631 reportable taxa**, including **11,201 species**, names, categories, families/orders and `reportAs` parents. Subspecies that are not reportable in eBird are not invented.

The supplied official [eBird/Clements v2026 integrated checklist](https://www.birds.cornell.edu/clementschecklist/download/) now provides authoritative Avibase Taxon Concept IDs for **all 11,201 current species**, including birds outside the test collection. Its species codes, scientific/common names, orders and families agree with the pinned official eBird API. Its **18,631 reportable codes and categories** also agree exactly. Cornell's [2026 release documentation](https://www.birds.cornell.edu/clementschecklist/introduction/updateindex/october-2026/) describes these persistent IDs as the preferred cross-release identifiers.

Species identity is joined directly from the official 2026 concept ID to AvesData's pinned Clements 2025 concept ID, independently of illustration metadata. This yields **11,121 same-ID matches**: **10,928 exact** and **193 renamed** species. A renamed match retains its species concept even when its common or scientific name changed. Name agreement, artwork availability and previous-year sort position alone never establish concept identity.

The remaining annual changes are explicitly reviewed against the workbook's species/subspecies membership, retained `sort_v2025`, change narratives and Cornell's documented [splits](https://www.birds.cornell.edu/clementschecklist/updates-and-corrections-october-2026/) and [lumps](https://www.birds.cornell.edu/clementschecklist/updates-and-corrections-october-2026-page-2/). The relationships are recorded in [data/crosswalk-overrides.csv](<data/crosswalk-overrides.csv>).

| Relationship to the 2025 source | Current species | Meaning |
| --- | ---: | --- |
| Exact | 10,928 | Same official concept and names |
| Renamed | 193 | Same official concept, changed common or scientific name |
| Source broader (`broader`) | 70 | One older tip contains the narrower current species |
| Current broader (`narrower`) | 4 | The current species contains multiple narrower older tips |
| Unresolved | 6 | Complete source placement is not established |

**11,195 current species have a verified source placement.** Multiple source tips for a lump are preserved in `treeTips`. A split highlights the containing source tip; it does not acquire a fabricated daughter-species divergence date. The tree's original topology, branch lengths and dates remain intact.

The six genuine source-placement gaps are *Crypturellus resonans*, *Ptilorrhoa urrissia*, *Edolisoma incertum*, *Corypha kabalii*, *Mixornis gularis* and *Basileuterus melanogenys*. They are newly ratified species without a verified older containing concept, or changed concepts whose full membership partly overlaps older tips or lacks documented prior ancestry. Their official identity and evidence remain visible, but audit-only candidate tips are never silently used as placements. These global gaps are distinct from the six previously missing birds in the supplied life list, which now resolve through official same-ID matches.

The two current Willets, Saltmarsh Willet (`willet2`, *Tringa semipalmata*) and Prairie Willet (`willet3`, *Tringa inornata*), have different concept IDs but share the broader 2025 *Tringa semipalmata* tip. A bare legacy “Willet” is not an alias of Saltmarsh Willet. Current `willet1` is a slash identification.

The generated [coverage report](<data/coverage-report.md>) summarizes all statuses. [coverage.json](<public/data/coverage.json>) enumerates every current-species gap, source-species gap, and local artwork gap. [crosswalk.json](<public/data/crosswalk.json>) records every current species' official concept ID, worksheet/evidence rows, previous source membership, candidate sources, relationship and review status. The manifest marks this audit `official-full-species`.

## Artwork, demo and attribution

All **11,027 current species with appropriate available source illustrations** have locally served WebP artwork at 128 and 384 px from pinned Everybird stickers commit `b7749a623585b18320cb0e0271da63ee20c701c0`. Original metadata is pinned at huashu commit `3b42ef839501b93166e578075c4ea97adb4c4fa5`; Everybird mapping metadata is pinned at `50510c2209280b9f259545d8ab08e13970d5f8e6`. The original repository and resize repository still had these same revisions when this expansion was checked. Everybird's later application revision was inspected separately; the pinned artwork mappings already cover the available source library.

Original v1 images were based on huashu revision `f9e63a0ffd780edeb463b36cf1858f2e593f6099`, as documented by Everybird. A versioned replacement is used only if it exists at the pinned sticker revision. **544 species** use the original v1 image where a newer metadata variant was not published at that revision; their review status stays unknown, and a newer drawing's quality score is not falsely attributed to them. The other **10,483 species** use their current available variant. The **174 remaining eBird species** have no suitable image in the pinned Everybird mapping and no exact code/scientific-name image in the linked huashu metadata. Their fallback remains visible; taxonomy matching is independent.

Credit: **Stickers: huashu-bird-sticker, CC BY 4.0. Resized and trimmed by Everybird.** [Original source](https://github.com/alchaincyf/huashu-bird-sticker), [resized source](https://github.com/yusuftaleb/everybird-stickers), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

These are AI-generated illustrations. Available source review scores are preserved as artwork metadata; quality status and tree mapping status are independent. Missing or questionable illustrations use the app's fallback. `sticker` points to the 384 px card asset and `stickerSmall` to the 128 px tree thumbnail. They are not identification photographs. No Everybird parser implementation was copied; its MIT license is retained alongside metadata attribution in `public/data/LICENSE-everybird.txt`. The sticker license is in `public/data/LICENSE-stickers.txt`.

Cornell's reference response does not declare an open-data redistribution license. Attribution is preserved, and its terms should be checked before the later public-release milestone. This does not affect the explicitly local development and review workflow.

`public/demo/MyEBirdData-sample.csv` contains real taxon names and wholly invented dates, counts and checklist identifiers. It contains no personal observations.
