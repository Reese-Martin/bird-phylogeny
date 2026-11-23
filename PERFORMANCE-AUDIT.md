# Performance and overlap audit

Reviewed **19 November 2026**, against the local MDS Bird map and radial-portrait implementation. This is an engineering audit and improvement backlog, not a claim that every proposal has been implemented. Source locations below identify the inspected symbols; line numbers can move during subsequent edits.

The expensive work is generating a new fit and loading its illustrations. Exploring an existing fit is substantially cheaper. Workers isolate CSV import, UMAP/MDS and map packing from the UI thread, and taxonomy highlighting retains the current map's coordinates, packing and camera. Backlog priorities **1 and 2 are now implemented**: smaller resolution tiers and byte-aware image retention, plus bounded persistent fit/packing caches. Cold uncached quadratic MDS, real-device memory behavior and repeated main-thread preparation/drawing remain concerns. A phone viewport has been checked on desktop; actual phone performance has not been established. The historical measurements below retain their original scope and do not become new timings for these optimizations.

## Evidence and measurement boundaries

**Fresh in this audit:** local file sizes, offline gzip sizes, single-pass Node JSON decoding/parsing, complete conservative collision-mask capture, and independent map collision diagnostics using existing production-engine coordinates. The machine reported Node **24.22.3**, Windows, Ryzen 5 5600X, 12 logical processors and approximately 31.9 GiB RAM. Diagnostic timestamps, source hashes and environment are in ignored `test-results/audit-static-assets.json`, `audit-map-native-overlaps-{128,384}.json` (original masks), and `audit-map-native-overlaps-{128,384}-conservative.json` (corrected collision masks). These are individual observations, not medians or mobile benchmarks.

**Earlier browser evidence:** `test-results/refinements-browser-verification.json` and `mds-radial-browser-verification.json` checked the 700-species personal collection in local desktop Chromium before the conservative-mask/HUD/annotation changes. `browser-performance-current.json` measured an earlier tree renderer/import workflow. Their aggregate results are useful context, but their old navigation FPS and heap figures do not establish performance of the latest all-portrait map/tree release. Private species codes and coordinates remain in ignored files; none are reproduced here.

**Follow-up asset evidence:** all 22,054 new 32/64px derivatives were regenerated and byte-verified, and all 44,108 native image-tier masks were checked against the final four-tier collision union. The 700-bird encoded/native-RGBA sums below come from ignored `test-results/overview-artwork-profile.json`. They measure image assets, not browser process memory, phone speed or presentation FPS.

Current local-browser cold/persistent-load and artwork-settlement observations are recorded in [README-PERFORMANCE.md](<README-PERFORMANCE.md>). They are individual desktop/narrow-viewport runs, separate from the earlier timing table and from real-phone benchmarks.

**Not measured:** real iPhone/Android hardware, cold internet loading, HTTP compression actually served by a deployed host, full-process/GPU/decoded-image memory, current 3,000-placement MDS time, sustained battery/thermal behavior, or current full-view compositor FPS. A canvas CPU draw duration and a RAF callback rate are not independently measured presentation FPS. No new large embedding benchmark was run for this audit.

| Earlier desktop observation | Result | Boundary |
| --- | ---: | --- |
| Full 700-placement browser fit | 2.0–2.25 s | Worker computation; startup/transfer/artwork outside this measure |
| Latest 700-bird full packing | 206.8 ms | Worker computation; averaged size, 100% common scale |
| Same layout, 20% sticker scale | 55.3 ms | Same embedding; packing changed |
| Settled map snapshots | 4–10 ms per draw | Individual snapshots, not a frame-time distribution |
| Some first/highlight snapshots | Up to 260.4 ms | Shows possible hitches; cause not isolated |
| Synthetic import, 100,000 rows / 12 MB | 713 ms | Earlier importer/browser run; not a current phone result |
| Latest 390px viewport map snapshot | 9.8 ms draw | Desktop Chrome viewport override, not phone hardware |

## Startup and data transfer

[App.tsx:127](<src/App.tsx:127>) fetches and parses the complete tree, taxonomy, manifest and coverage in parallel before preparing the main collection. Geometry is fetched separately at [App.tsx:171](<src/App.tsx:171>), including in tree mode because both presentations now use it. Conservative collision masks are fetched only for Bird map; illustration colors only for color ordering; world outlines only when the country dialog mounts. Images are requested individually when needed; the whole image library is not downloaded on startup.

The following JSON/gzip/parse table is the **original audit snapshot**, before the four-tier mask refresh. Unchanged source assets retain those observations; the current collision union has the same raw length but its gzip/parse values have not been remeasured here.

| JSON asset in original audit snapshot | Raw bytes | Offline gzip bytes | Node UTF-8 decode + parse |
| --- | ---: | ---: | ---: |
| Tree | 6,264,338 | 1,139,208 | 26.5 ms |
| Taxonomy | 7,599,500 | 655,307 | 27.9 ms |
| Manifest | 14,154 | 4,288 | 0.15 ms |
| Coverage | 27,595 | 4,730 | 0.14 ms |
| Sticker geometry | 2,402,834 | 501,090 | 10.2 ms |
| World outlines, lazy | 155,686 | 57,574 | 0.25 ms |
| Conservative collision masks, lazy | 1,073,914 | 274,466 | 3.37 ms |
| Illustration colors, lazy | 2,273,339 | 509,845 | 10.7 ms |

The first four total **13.91 MB raw**; with geometry, **16.31 MB raw**. Their offline gzip total is **2.30 MB** with geometry, showing substantial compression potential. Entering Bird map adds **1.07 MB raw** for separate conservative masks; the table's **0.274 MB gzip estimate** belongs to the earlier two-tier artifact. Color ordering adds **2.27 MB raw / 0.510 MB gzip estimate** for measured illustration colors. These lazy artifacts retain their parsed objects while the app remains open. This is not evidence that Vite preview or any future host is sending those compressed sizes. Node timings exclude file reading and do not predict browser `response.json()`, React startup or rendering time.

The taxonomy and source tree are general library data, so caching their versioned static files is safe and useful. A smaller runtime schema could separate aliases, provenance, full source annotations and inspector-only fields from fields needed for first drawing, provided all scientific/source information remains available when requested. Validate payload reduction against taxonomy reconciliation, source-date display and inspector/export requirements; do not remove fields simply to improve a file-size score.

## Generation, allocation and worker boundaries

Let **n** be distinct source placements, **s** displayed species, **V** source nodes and **k=15** UMAP neighbors. Shared source concepts can make s greater than n. The current hard limit is **3,000 placements**, checked before matrix allocation in [distance.ts:24](<src/embedding/distance.ts:24>); it is not a total memory or packing-time limit.

| Stage | Current work and storage | Consequence |
| --- | --- | --- |
| Source distances | Binary-lifting index O(V log V), then O(n² log V) ancestor work for ordinary single-tip mappings; multi-tip concepts average all cross-tip pairs | Uses published source branches, independently of display geometry |
| Exact neighbors | Fully sort n−1 candidates per row: O(n² log n); retain O(nk) neighbor arrays | An exact top-k selection can avoid sorting every candidate |
| UMAP initialization | Precomputed exact neighbors bypass approximate neighbor search; sparse graph and 300 epochs, approximately O(epochs × nk) for fixed negative sampling | Runs in pure `umap-js`, not a Python runtime |
| Metric MDS | Up to 1,000 SMACOF updates, O(iterations × n²); a single dense distance matrix plus two O(n) coordinate buffers | Largest predictable CPU cost as n increases |
| Full sticker packing | Largest-first insertion, spatial grid, 24-cell mask intersections, outward probes until a free location is found | Typical cost benefits from the grid; no finite full-mode probe budget or simple linear worst-case promise |
| Radial portraits | Country-reference footprint weights and weighted source-leaf prefix intervals, then three deterministic main-thread insertion passes with spatial queries/outward collision-interval jumps; choose strictly lower maximum radius. Hidden views may repeat packing once for the adaptive center | True-distance node radii and source sequence/topology stay intact; visible-tree angles are now footprint-spaced. Work occurs when membership/geometry/layout changes, not on ordinary pan or theme changes |

The MDS loop [engine.ts:65](<src/embedding/engine.ts:65>) visits each unordered pair once per pass. Including the initial pass, 1,000 updates require about **244.9 million** pair evaluations at n=700 and **4.503 billion** at n=3,000: **18.4 times** as many. This is a work ratio, not a measured runtime projection; iteration counts, JIT behavior and device speed vary.

| Named typed-array payload | n=700 | n=3,000 |
| --- | ---: | ---: |
| Full Float64 distance matrix, 8n² bytes | 3,920,000 bytes / 3.74 MiB | 72,000,000 bytes / 68.66 MiB |
| Two MDS xy buffers, 32n bytes total | 22,400 bytes | 96,000 bytes |
| Source LCA index, fixed 22,333 nodes / 15 levels | 1,607,976 bytes | 1,607,976 bytes |

The LCA index is needed during distance construction and becomes reclaimable afterward. These counts exclude the source-tree object clone, taxonomy, JavaScript neighbor arrays and sparse maps, output objects, temporary sorting arrays and all image/canvas memory. MDS avoids allocating another n² ratio/distance matrix or normalized copy. A triangular matrix could nearly halve its dominant payload without changing numeric precision, at the cost of changing and validating all distance lookups.

[client.ts:44](<src/embedding/client.ts:44>) posts the complete source tree and relevant taxa to a newly created worker for each uncached fit. There is no transfer list, persistent source worker or shared tree index. The distance matrix is constructed inside that worker and is not sent back; only points and metadata are returned. Successful completion and cancellation terminate the worker, allowing its matrix and optimizer storage to be reclaimed. This avoids retaining 72 MB matrices in the result cache. `shouldCancel` checks support direct engine tests; actual browser cancellation uses worker termination, so it does not depend on a busy synchronous loop servicing a message.

## Earlier radial spacing follow-up

The long true-size spokes in the earlier full-global-angle presentation were primarily a portrait-packing constraint, not additional evolutionary branch length. Regional benchmark's ten recorded Pelecaniformes occupied only about **3.4° between their first/last source tips** (the complete source order wedge was about 3.87°). Several large upright portraits therefore stacked almost collinearly when those angles were retained. The branch tree has unit outer radius in this display; portrait centers and extents beyond it are decorative. The exact-angle numbers in this section precede the accepted visible-tree footprint allocation below.

[radial-sticker-placement.ts](<src/tree/radial-sticker-placement.ts>) now evaluates three deterministic candidate packings: increasing angle, decreasing angle and largest-first insertion. It selects a candidate only when the maximum radius is strictly smaller, and returns portraits in source-angle order. Every candidate retains the input angles, dimensions, identities and complete rectangle collision exclusion. This is a bounded three-pass improvement over the former single sweep, not a globally optimal packing solver. It minimizes the farthest extent; mean radius can increase. For the full true-size collection, mean center radius increased from approximately **3.245 to 3.673**, while the longest extent shortened.

| True-distance / True size fixture | Former maximum radius | Three-pass maximum radius | Reduction |
| --- | ---: | ---: | ---: |
| Regional benchmark, 193 species | 6.4882 | 5.4125 | 16.6% |
| Combined collection, 700 species | 15.4162 | 12.2396 | 20.6% |

These are `maxRadius` diagnostics in display world units, including portrait extent, rather than divergence dates. In local desktop Node experiments, median complete three-pass computation was about **1.3 ms** for the Regional benchmark true-size fixture and **10.4 ms** for all 700 true-size birds. The ignored `test-results/radial-spacing-experiments.json` records candidate comparisons and timings. Twenty-four independently checked layout combinations had zero rectangle intersections and unchanged dimensions. Those are geometry/CPU checks, not browser frame, image-settlement or phone measurements.

With branches hidden, [TreeCanvas.tsx](<src/tree/TreeCanvas.tsx>) instead closes unused angular gaps while retaining source-tip sequence. Color mode retains its measured order/color sequence. Both birds-only styles assign angular slots proportional to **(portrait width × height)^0.625**, so large illustrations receive more room without altering their dimensions or relative body-size ratios. This is a tuned display heuristic, not a biological angular distance or an optimization of phylogenetic distances. The exponent was compared across 36 geometry experiments; preference for a rounder, shorter arrangement does not establish a general optimum.

The first hidden packing uses a **0.36** center exclusion radius. The final radius is **max(0.36, 0.12 × provisional maxRadius)**; if larger, packing runs once more with that center. This adapts the protected count disk to large collections rather than leaving the count unreadably small or always reserving the tree's fixed **1.14** radius. Count text remains constrained to that disk. Hidden angles/radii are explicitly decorative; branch-length controls are omitted. Showing the tree restores the selected branch-distance mode with the current footprint-spaced angles. No source topology, branch lengths, dates, Everybird size ratios or MDS coordinates are edited.

The initial equal-slot, fixed-0.36 experiment measured Regional benchmark's maximum decorative radius at **2.1552 averaged / 3.0605 true size**, and all 700 at **4.4187 / 6.8939**. Those values describe the superseded uniform-slot experiment, not the final weighted/adaptive arrangement. Mobile review found that its 700-bird true-size layout still had long arms and an approximately 8.3 px count. Footprint weighting and the adaptive center address those two separate presentation problems.

The final weighted/adaptive geometry is recorded in ignored `test-results/radial-weighted-slots.json`:

| Birds-only fixture | Relative size | Center radius | Maximum decorative radius | CPU median |
| --- | --- | ---: | ---: | ---: |
| Regional benchmark, 193 species | Averaged | 0.3600 | 1.8154 | 1.30 ms |
| Regional benchmark, 193 species | True | 0.3600 | 2.3636 | 1.58 ms |
| Combined collection, 700 species | Averaged | 0.4108 | 3.5171 | 16.70 ms |
| Combined collection, 700 species | True | 0.5515 | 4.6632 | 19.37 ms |

All four final fixtures retained every portrait, with unchanged dimensions/sequence and zero independently checked rectangle overlaps. Seven-run CPU medians include weighted angle allocation, provisional packing and conditional second packing on the desktop Node environment. They exclude browser preparation, image decode, annotation drawing and phone performance; the additional pass is a one-off layout cost, not ordinary pan/zoom work. Final overview count legibility and rendered-scene behavior remain browser QA, recorded separately in [README-PERFORMANCE.md](<README-PERFORMANCE.md>).

Hidden-circle layouts do not claim to preserve the source's angular gaps. The later visible-tree decision was to adopt pure portrait-footprint angular allocation, described next. The earlier three-pass and uniform-slot measurements above must not be presented as current visible-tree extents.

## Accepted portrait-footprint angular layout

The visible tree now implements the user's preferred **portrait-footprint** draft. [TreeCanvas.tsx](<src/tree/TreeCanvas.tsx>) derives tip weights proportional to **tile area^0.625** from the complete selected-country Everybird size reference. Aliases sharing a historical source tip use its maximum associated footprint once, retaining one branch anchor. [buildLayout](<src/tree/geometry.ts>) normalizes finite positive weights, constructs a weighted prefix in original source-leaf order and assigns each internal node the midpoint of its weighted descendant interval. Unrecorded tips collectively retain a baseline weight of **1e-4 of recorded weight**, rather than collapsing to zero-width background slots. Source topology, leaf sequence and data files are not rewritten.

True-distance radii remain **bit-identical** to `source distance / maximum distance`; only angle and the corresponding Cartesian display coordinates change. Compact retains its existing radial compression and is still labeled not to scale. Full-circle weighting ignores transient visibility, so selecting taxonomy or drawing background ancestry cannot silently reallocate the country reference. The optional `angularTips` fan domain is separate from the `visibleTips` scope used for Compact radial normalization; this keeps fan angles stable when background/context drawing changes. Switching Averaged/True size can intentionally change footprint spacing. This implementation has **no minimum order width and no count/footprint blend**.

After angular allocation, the existing three-pass outward portrait packer still preserves displayed rays and dimensions. Independent production-geometry checks found zero dated-radius error, unchanged source hash/leaf order and zero pairwise portrait intersections in all four country/size fixtures:

| Current True-distance fixture | Pelecaniformes wedge | Maximum portrait radius |
| --- | ---: | ---: |
| Regional benchmark, 193, Averaged size | 32.4390° | 2.2075 |
| Regional benchmark, 193, True size | 41.7117° | 2.6568 |
| Combined, 700, Averaged size | 18.5298° | 3.5940 |
| Combined, 700, True size | 22.8178° | 4.9824 |

Regional benchmark's true-size result closely matches the pure-footprint draft (**41.7155° / 2.6567**); the tiny difference is the positive background-slot reserve. These are decorative extents around a unit-radius branch tree, not divergence times. Weighted source-tree allocation was observed at approximately **5.6–8.5 ms** in individual local Node samples; those are not browser page-ready, sustained draw or phone timings. The country-reference weight table and layout are memoized independently of appearance; ordinary pan/zoom and Light/Dark switching do not rerun this preparation. The hidden circle and MDS fitting/packing methods remain separate and unchanged.

## Appearance and redraw

[theme.ts](<src/theme.ts>) resolves System/Light/Dark appearance, stores only an explicit appearance string in localStorage and preserves a session choice if storage fails. The initial page applies saved/system appearance and critical background before React paints. The header toggle selects Light/Dark; **Use system theme** in the collection menu restores OS tracking. Cross-tab storage updates and OS changes are subscribed separately from collection/layout persistence.

CSS and canvas palettes now cover page controls, dialogs, the country map, branch/date/selection layers, MDS counts and export captions/backgrounds. Dark paper is **#17191c**, raised surface **#22262b**, ink **#ecebe7** and accent **#ef9a85**. Stickers are not inverted or recolored by theme. Changing appearance requests a redraw while retaining existing fitted coordinates, packing, image cache and camera; it is excluded from MDS/packing cache identities. Exports snapshot the selected palette after artwork settlement so their scene and footer agree. Theme correctness/contrast tests do not substitute for separate browser checks of both themes, controls and narrow layouts; current verification results belong in [README-PERFORMANCE.md](<README-PERFORMANCE.md>).

## Exploration, React and images

The map's [prepared input and packing dependencies](<src/components/ClusterCanvas.tsx:90>) exclude taxonomic highlighting. Selecting an order/family/genus changes draw emphasis/counts only. The common scale is now fixed at 1 and the Sticker size slider is removed; changing **Averaged size / True size** retains the fit but changes packing. Country changes can require a new fit. Ordinary pan/zoom transforms existing world coordinates. Earlier 20/100% measurements below remain historical engine/layout experiments, not current UI choices.

Every map draw currently projects all s birds, allocates plan objects, filters offscreen plans, and sorts visible plans by attention/area at [ClusterCanvas.tsx:161](<src/components/ClusterCanvas.tsx:161>). Tree drawing likewise projects radial portraits and scans visible tips. Culling reduces drawing and image requests but does not avoid this initial scan. Both canvases coalesce redraws through RAF and cap backing resolution at device-pixel-ratio 2, which are useful existing protections. Current annotation placement also scans occupied rectangles for whitespace; clipped leaders intersect tile rectangles and sort blocked intervals. Active hover/selection usually limits these operations to a few annotations, but dense/no-whitespace scenes should be included in profiles. Color ordering sorts precomputed color features within orders; it does not decode/analyze artwork colors in the browser.

Each frame also rebuilds the artwork wanted set. [ArtworkCache.setWanted](<src/tree/artwork-cache.ts:32>), `trim`, `pump` and `metrics` scan entries and construct arrays/maps; the queued list is sorted during pumping. This can create repeated work and garbage even when all portraits are already ready. When a decode completes, the cache requests another frame. These are plausible contributors to image-settlement hitches, but CPU profiles are needed before attributing the observed long draw snapshots to any one function.

The cache permits **six concurrent loads/decodes**. [artwork-resolution.ts](<src/tree/artwork-resolution.ts>) now selects **32/64/128/384px** artwork from physical display size, with DPR capped at **2** and hysteresis around tier changes. A ready old tier remains paintable and protected while a replacement loads; unused resolution copies become evictable once the new tier is ready. This changes resolution only, never species membership, portrait geometry or fitted positions.

Retention now has a **32 MiB estimated decoded-byte budget** as well as the **soft 512-entry target**. Every currently wanted image is protected, so neither is a hard limit when a complete collection is visible. Grayscale variants count toward the estimate and are dropped when no longer requested. Metrics expose estimated total/visible decoded bytes, variant bytes, over-budget bytes and visible tiers. These are native `width × height × 4` image/canvas estimates, not measured browser/GPU/process RAM; decoder copies, textures and other overhead are outside them.

| Same 700-bird collection, complete asset sums | Encoded bytes | Native RGBA estimate |
| --- | ---: | ---: |
| 32px | 871,640 | 2,267,392 |
| 64px | 2,514,280 | 9,064,448 |
| 128px | 3,026,284 | 36,265,984 |
| 384px | 11,544,816 | 326,370,816 |

The 32px tier reduces those sums by **71.2% encoded / 93.75% RGBA** versus 128px; 64px reduces them by **16.9% / 75.0%**. Actual mixed-tier cache cost depends on zoom, DPR, ready fallbacks and gray variants. Real phone memory-pressure/background tests remain required; the smaller buffers do not establish a total-RAM ceiling.

Tree preparation is memoized, but [TreeCanvas.tsx:182](<src/tree/TreeCanvas.tsx:182>) still rebuilds genus membership/monophyly and scans current members for candidate clades when selection/visibility/layout dependencies change. Branch paths depend on the whole `visibility` object, so a selection change can rebuild recorded/background paths even if those memberships did not change. These are main-thread interaction costs, distinct from worker fitting.

Canvas view information is reported at approximately 100 ms intervals into App state. Most expensive derived data uses `useMemo`, but the App and un-memoized canvas components still render to update that state and artwork status. The country map separately puts each zoom event into React state at [CountryMap.tsx:74](<src/components/CountryMap.tsx:74>), reconciling its SVG paths. Neither is automatically a defect; profile React commits alongside event/frame traces before choosing isolation boundaries.

Map picking checks visible hit boxes in reverse paint order and then the original Everybird 24-cell hit mask; conservative packing masks do not replace hit masks. Tree pointer picking currently copies/reverses the complete hit-box array for every event at [TreeCanvas.tsx:543](<src/tree/TreeCanvas.tsx:543>); its quadtree is a fallback for clicks, not a general rectangle/alpha picking index. A rectangle-aware spatial index can retain topmost/alpha semantics while reducing scans. The current map uses mouse hover handlers; touch users rely on tap selection/list access rather than hover. Device testing should cover those paths explicitly.

## Import, persistence and cache lifetime

The CSV worker reads **512 KiB chunks** at [import.worker.ts:8](<src/workers/import.worker.ts:8>), validates/reconciles each row, and returns only normalized aggregates. It does not parse the whole CSV into one persistent row array. However, [aggregate.ts:178](<src/import/aggregate.ts:178>) retains distinct checklist IDs per species, both globally and in country aggregates. Those transient sets can grow with distinct species/checklist incidences, up to order R for R records, even with chunked parsing. Taxon/name indexes are rebuilt per import. Repeated exact reported name pairs could be memoized within an import, with all ambiguity and warning semantics preserved.

The original fit and packing clients retained four completed results each in RAM only. **Completed-layout persistence is now implemented** in [layout-cache.ts](<src/storage/layout-cache.ts>): a separate IndexedDB database retains a combined **24 layouts / 16 MiB of canonical JSON payload**, with persistent LRU eviction. The four-entry memory caches remain the first tier. SHA-256 keys cover the complete source tree content, species membership/mappings, algorithm versions/parameters, and every packing coordinate/dimension/collision-mask/setting. Immutable request snapshots keep the hash and worker inputs consistent if caller objects change during asynchronous lookup. Hash creation and snapshotting still incur main-thread work and are included in the current request's `loadMs`.

Only completed coordinates, source groups, packing geometry and fit metadata are stored: no observation rows, dates, checklist IDs or distance matrices. Cached schema, exact code coverage, source-group mappings, finite values, metadata/settings and anchor relationships are validated before reuse; stale/corrupt entries are discarded. Storage/hash unavailability, blocked opens, quota and write failures fall back to computation. Clearing increments an epoch synchronously and rejects writes from computations started before clearing, including writes not yet issued when clearing began. The clear API reports whether disk clearing succeeded; callers also clear both memory tiers. Storage belongs to the current browser origin/device, so it does not transfer a layout to another phone or another localhost port.

Runtime `cacheSource` distinguishes **computed**, **memory** and **persistent** results. `cacheReadMs` measures the optional disk lookup, `loadMs` measures the current request, and existing `elapsedMs` retains the original computation duration. A warm read must not be reported as a new fit taking that original duration. Module-reload, worker-skip, key invalidation, corruption, storage-failure, cancellation and clear-race tests passed with fake IndexedDB; the final focused engine/client/storage run passed **50 tests** with clean TypeScript. These are correctness tests, not actual phone/reload latency measurements. Collection backups remain separate and do not contain layout caches; desktop-generated layout transfer remains a possible future feature.

Collection saving at [collection.ts:180](<src/storage/collection.ts:180>) remains **explicit** and separate from automatic completed-layout caching. It validates, serializes, parses and validates again before IndexedDB writes. Restoring also serializes a stored object and parses/validates it. Large backups therefore incur transient string/object copies on the main thread. The backup size guard applies to backup JSON text, not CSV import. The menu's **Clear collection, saved copy & layouts** clears session/saved collection and memory/persistent layout caches, reporting storage failures. A desktop-generated layout package remains a possible future feature; no matrices are transferred or persisted by the current cache.

## Overlap correctness: what was checked

The **original map packing** used the Everybird sizing masks: 24-cell-long-side grids captured from bundled 384px images with area-average BOX sampling and occupied alpha **>40** after rounding. The map draws images stretched to the same rounded-mask tile aspect, so its tile transform and mask transform agree. Native image aspect and rounded-mask aspect are not identical. The tree draws native-aspect images contained within its rectangle tiles; rectangle collision exclusion is conservative for those images. The follow-up below separates packing occupancy from those unchanged Everybird measurements.

The full map packer searches until each inserted tile has no occupied-mask intersection with previously inserted tiles. Its returned `overlapCount` is **set to zero for unlimited/full mode**, rather than computed independently at [sticker-packing.ts:221](<src/embedding/sticker-packing.ts:221>). This follows the insertion invariant; it is not an independently measured browser-pixel overlap count. The radial layout has a similar construction-time zero indicator. Independent checks are still useful when geometry/drawing rules change.

The baseline diagnostic reuses the existing 700-point **Node production MDS coordinates**, performs fresh full packing with original sizing masks, then independently checks both 24-cell masks and native alpha>40 pixel rectangles in the bundled 128px and 384px images. Native pixels are transformed exactly like the map tiles. Every bounding-box-intersecting pair is tested; boxes intersecting through transparent corners are not counted as bird overlap. This checks eight native-artwork/layout combinations, without generating another embedding.

| Relative sizing / common scale | 24-cell overlap pairs | Native 128px alpha>40 pairs | Native 384px alpha>40 pairs |
| --- | ---: | ---: | ---: |
| Averaged / 100% | 0 | 0 | 0 |
| Averaged / 20% | 0 | 0 | 0 |
| True size / 100% | 0 | 2 | 0 |
| True size / 20% | 0 | 0 | 0 |

The largest of the two 128px intersections has world area **0.00024463**, corresponding to approximately **0.0064 CSS pixel²** in a modeled 1000×850 fitted desktop canvas and **0.00071 CSS pixel²** in a modeled 375×340 canvas. Neither reaches one CSS pixel². These are tiny threshold/resampling differences, not evidence of a material overlapping-body defect in the tested overview. At extreme zoom, screen-space size changes; this is not a universal zero-pixel-overlap proof.

The baseline diagnostic treats thresholded source pixels as occupied rectangles. It does not reproduce Canvas interpolation/antialiasing, faint alpha≤40 fringes, actual browser screenshots, or a different browser's MDS initialization basin. Coarse mask averaging can discard thin features, and the 128/384 assets can differ slightly after resizing. A model-level zero must not be described as a whole-scene overlap sweep.

Fresh single-run packing durations in this diagnostic were **247 ms averaged / 142 ms true size** at 100%, and **16 / 11 ms** at 20%. They are Node computation observations for this particular fit, not browser navigation or end-to-end times. Collision checking and image decoding for the diagnostic are outside the returned packer durations.

### Earlier 128/384px conservative correction and measurements

[sticker-collision-masks.ts](<scripts/sticker-collision-masks.ts>) first added a separate **packing-only** grid for every bundled species, unioning **128px and 384px assets**. It retained **every nonzero-alpha pixel**, expanded each occupied source-pixel rectangle by **one source pixel per side**, clipped that guard to the drawable tile, and marked **every intersected 24-cell grid cell**. This is conservative max pooling rather than area averaging or center sampling. The original rounded tile dimensions, Everybird shape/mass formula, original sizing masks and hit masks were unchanged. Missing conservative masks use a full tile rectangle in the renderer's packing input.

That earlier artifact contained **11,027 species** and **22,054 pinned input images**. Complete capture took **34.1 s**, then **22.0 s** on repetition; both produced SHA-256 `a877dde6b613f1aa1a49b80159513a47d84194849f51bfe783a96de6acef13e7`. These timings and the following layout checks belong to that two-tier version, not the final four-tier artifact.

The independent 700-bird sweep was repeated with these masks at **native alpha>0**. All **eight combinations** (128/384px × averaged/true × 20/100% common scale) had **zero native pixel-rectangle intersections**, plus zero independently counted conservative-grid intersections. Five new tests cover faint/thin features, complete pixel-rectangle coverage, multi-resolution union/edge guards, actual packing, and every public species/grid/original-mask cell; **21 collision/packing tests** and TypeScript checking passed.

Conservatism costs additional spacing and a **1.07 MB raw** runtime file. The packer's global decorative `anchorScale` uses decoded mask occupancy, so replacing its input mask changes that scale as well as collision decisions; no conservative mask enters the Everybird portrait-size formula. In this Node fit, the modeled averaged-size 100% overview fit scale fell from 10.83 to 9.57 because the packed extent grew. Repacking can move portraits; raw fitted MDS coordinates and relative bird sizes remain unchanged. Fresh corrected-mask packer snapshots ranged approximately **267–361 ms averaged / 141–174 ms true size** at 100%, and **13–23 ms** at 20%; those checks ran concurrently with other diagnostics, so they are not a controlled speed comparison. The new grid retains small silhouettes by allocating their cells; it does not run a more expensive native-pixel solver during interaction.

### Current overview tiers and four-tier collision union

[sticker-overviews.ts](<scripts/sticker-overviews.ts>) generated **32px and 64px lossless WebPs for all 11,027 species** from the pinned 384px source. Lanczos3 fit-inside resizing retains the full canvas, transparency and aspect within **0.5 source-scaled pixel** of rounding; it never trims/crops or changes layout. Every output retained transparent pixels and nonempty alpha, and a synthetic thin-line check retained visible alpha. Repeated full capture/verification produced identical files. [sticker-overviews-source.json](<data/sticker-overviews-source.json>) records settings, per-file hashes and complete coverage.

The final collision artifact unions **32/64/128/384px**, retaining the same nonzero-alpha, one-native-pixel guard and common 24-cell grid. All **44,108 tier masks** are contained in the shared species masks. SHA-256 is `0f59a91f507854b726244ab9822ae9a7750659949e97a87d88cf55bf6d59ad11`; repeated captures matched. [Collision provenance](<data/sticker-collision-masks-source.json>) ties original inputs to pinned hashes and generated tiers to their verified overview manifest. The 32/64px support adds **376,601 cells** across all species, at most **62 per species**, compared with the two-tier union. This can change decorative packing and extents; the earlier timings and eight native layout sweeps have not been relabeled as four-tier measurements. Original artwork, Everybird sizing/hit masks and raw MDS coordinates are unchanged.

Current scene integration places the count in a protected **world-space center slot**, finds unoccupied label space rather than painting names across bird tiles, and clips source leaders outside image tiles and the count. This replaces the earlier 64px top HUD; packing excludes complete bird tiles from the counter and its cache identity has changed, while the original MDS fit remains reusable. Taxonomy emphasis leaves members in color and renders nonmembers gray, without group tint boxes; nonmembers stay gray during hover or individual selection. Gray canvases are reused through the byte-aware artwork cache, with alpha preserved. Navigation/details occupy their own App region. These protections require browser visual/export checks at different viewports and zooms. Native grid coverage does not establish arbitrary browser filtering kernels, presentation FPS or every possible overlay state.

## Ranked improvements and acceptance checks

### Sticker-delivery follow-up

The reported Chrome placeholder delay led to a distinct delivery investigation. Serving 700 tiny 32px files (889,720 encoded bytes) through the former Vite public-file path took **38.23 s** on first touch and **0.292 s** immediately afterward. These are local HTTP observations, excluding browser decode/drawing; filesystem caching and other machine activity were uncontrolled. The cause was not isolated to antivirus, disk or Vite alone.

Implemented afterward:

- A shared static-delivery path retains up to **32 MiB of encoded resources**, coalesces simultaneous reads, and avoids repeated metadata/read work on retained files. Current-revision individual URLs and verified hash-named sheets/indexes receive immutable caching. Production text is served with reusable Brotli/gzip variants. Unversioned runtime data remains revalidated; this is not a replacement compact taxonomy schema.
- The local launcher uses a **production build**, rebuilding only after source/catalog changes, with a content fingerprint. It keeps the same loopback port and refuses to replace an occupied server. Development also uses the new sticker middleware. Only the production artifact is exposed by the production server.
- **1,380 lossless 16-bird sheets** cover all 11,027 species at 32/64px. Every one of 22,054 crops retains its original dimensions, alpha and visible RGB. The loader fetches a sheet only for at least two wanted members and at most 8× their individual encoded bytes; sparse requests stay individual. The complete library is not decoded. Only requested crops enter the original soft-budget artwork cache, with a separate **8 MiB decoded-sheet retention target**, temporarily exceeded by active crops when needed.
- Overview pixels are requested first and protected during sharper upgrades. Loading is bounded at **12 HTTP tasks** and **2 explicit decode preparations**, independent of each other. Onload-valid images can bypass a busy decode queue after 16 ms; explicit decode preparation has a 250 ms fallback and bitmap cropping a 100 ms Canvas fallback. Failed sheets/catalogs fall back to versioned individual art. Obsolete bitmap crops are closed on eviction/disposal, including late completions.

The source-order sheet planner reduces a pure 32px full-list pass from **700 to 307 image requests**, with **2,923,390 image bytes** instead of 871,640; Regional benchmark goes from **193 to 143**, with 800,668 instead of 247,262. These trade neighboring artwork bytes for request count. The catalog adds **1,337,114 raw / 272,460 gzip-estimated bytes** once, under a content-hashed URL. The 24-species demo stays individual. These are planner estimates, not browser transfer traces or exact totals after sharper upgrades.

A separate fresh production-server encoded-cache smoke served 700 individual files in **323 ms**, repeat **106 ms**, with no HTTP failures. OS file cache was uncontrolled, so this is not a matched before/after speed ratio against 38.23 s. A complete in-app development-origin sample, timed from selecting the supplied 9,177-row CSV, first reported the new 700-species scene at **822 ms** and all 700 drawable with upgrades settled at **4,581 ms**. The sample could reuse illustrations from the demo and warmed filesystem data; it is one desktop browser observation, not a cold Chrome/device guarantee.

Production-browser checks retained all **700** portraits in Tree and True-size MDS, with zero failed images, missing geometry or model packing overlaps. The clean MDS artwork cache made **307 image loads**, cropped 545 birds from 152 shared sheets, and loaded 155 individual files. Its settled sheet estimate was **8,360,192 bytes**, plus **2,267,392 bytes** for the requested crops; these are native-RGBA estimates, not browser/GPU process RAM. Passeriformes highlighting rendered all 384 nonmembers gray with no boxes, and PNG export completed successfully. At 390px, all 700 remained ready with no horizontal overflow. The production-browser console reported no warnings/errors.

The final **268 tests in 28 files**, TypeScript and production build passed. Full sheet regeneration repeated byte-identically. The build took **102.1 s**, mostly copying the static artwork library; unchanged launches reuse it. Main JavaScript is **468.47 kB / 151.18 kB reported gzip**. Private browser diagnostics and HTTP probes remain under ignored `test-results/`; phone hardware and the user's native Chrome retest remain separate validation.

Priority reflects expected user impact and evidence, not an instruction to implement every item immediately. Effort estimates are relative engineering scope: small is a localized change; medium spans a subsystem; large changes a runtime/data protocol or scientific method.

| Rank | Location and finding | Concrete improvement | Impact / effort | Validation before shipping |
| --- | --- | --- | --- | --- |
| 1 | [artwork-cache.ts](<src/tree/artwork-cache.ts>), [artwork-resolution.ts](<src/tree/artwork-resolution.ts>) | **Implemented:** 32/64/128/384px DPR-aware tiers, hysteresis, ready fallbacks, estimated byte/variant metrics and a soft 32 MiB budget. All wanted birds remain protected. Remaining work is actual-device memory/thermal and settlement/frame profiling; a soft budget cannot bound a larger wanted set or total RAM. | High phone memory value; medium | Real phone memory-pressure/background tests; 700+ visible artwork settles with zero failures/disappearing birds; zoom retains appropriate resolution |
| 2 | [engine.ts:65](<src/embedding/engine.ts:65>): exact uncached MDS still has quadratic work | **Implemented:** persistent versioned fit/packing caching and provenance/timing, bounded to 24 layouts / 16 MiB. Next measure real-phone cold/warm latency; optional desktop-generated layout transfer remains unimplemented. Retain immediate cancellation and optional-storage fallback. | High repeat-visit/phone value; medium | Cache hit skips workers; source/mapping/parameter changes invalidate; real-device cold/warm timing; privacy/local-storage review |
| 3 | [TreeCanvas.tsx:182](<src/tree/TreeCanvas.tsx:182>): clade verification and broad visibility dependencies run on the UI thread | Preindex fixed source/taxon clades by data version; separate selected paths from stable recorded/background paths. Measure radial preparation separately and move large radial work to a worker only if traces warrant it. | Potentially high selection latency; medium | Profile selected-species/group/country transitions; source-clade verification and exact geometry remain identical; no unexpected reset/repacking |
| 4 | [ClusterCanvas.tsx:161](<src/components/ClusterCanvas.tsx:161>), [artwork-cache.ts:87](<src/tree/artwork-cache.ts:87>): repeated draw/cache arrays, sorting and scans | Precompute stable paint order; only reorder active attention; avoid wanted-set rebuild when membership/resolution did not change; maintain queue/status counts incrementally. | Likely smoother settlement/pan; medium | Browser CPU/GC profiles before/after; frame-time distribution under rapid zoom with decoding active; picking order and wanted-image protections unchanged |
| 5 | [engine.ts:114](<src/embedding/engine.ts:114>): sort all candidates to retain 15 | Use exact bounded top-k selection with the same distance/index tie order. | Faster preprocessing at high n; small/medium | Exact neighbor arrays identical across ties, zero/shared distances and random matrices; unchanged seeded UMAP/MDS output within numerical tolerance |
| 6 | [distance.ts:79](<src/embedding/distance.ts:79>), [client.ts:44](<src/embedding/client.ts:44>): dense symmetric storage and repeated source cloning | Consider triangular Float64 storage and a persistent worker with a flat transferable source representation/index. Keep the current exact numerical objective. | High-n memory/startup benefit; medium/large | Distances/stress/coordinates match; cancel and rapid country switching cannot produce stale results; worker lifecycle and retained-memory tests |
| 7 | [App.tsx:127](<src/App.tsx:127>): large general JSON payload | Verify production HTTP compression/cache headers; consider a versioned compact runtime schema with inspector-only detail loaded separately. | High cold mobile-transfer value; medium | Real transfer sizes/cache-hit traces, all inspector/alias/export fields retained, cold-start long-task measurements |
| 8 | [sticker-packing.ts:191](<src/embedding/sticker-packing.ts:191>): full search has no probe budget | Instrument attempts/candidate counts and progress by work. The common-size slider is removed; retain cancellable complete packing for relative-size and country changes. | Dense-layout transition responsiveness; small/medium | Rapid country/relative-size changes do not leave stale layouts; final positions deterministic and all species present; independent mask/native checks remain within stated contract |
| 9 | [TreeCanvas.tsx:543](<src/tree/TreeCanvas.tsx:543>), [ClusterCanvas.tsx:268](<src/components/ClusterCanvas.tsx:268>): linear picking and tree reverse-array allocation | First remove reverse-copy allocation; add rectangle-aware spatial picking if event traces show a bottleneck. Coalesce hover work to RAF while preserving click correctness. | Pointer responsiveness; small/medium | Topmost variable-size/concave portraits select correctly at every zoom; pointer/touch/keyboard behavior and overlays tested |
| 10 | [aggregate.ts:178](<src/import/aggregate.ts:178>), [collection.ts:180](<src/storage/collection.ts:180>): checklist sets and backup copies | Memoize exact name-pair resolution per import; consider integer interning for transient checklist sets and worker backup validation for large files. | Large-record imports, not ordinary 700-species exploration; medium | Duplicate/country counts and ambiguity warnings identical; memory measured against distinct incidences as well as raw rows; cancellation preserves prior collection |
| 11 | [CountryMap.tsx:74](<src/components/CountryMap.tsx:74>) and canvas view reporting | Isolate frequent transform/status state from static SVG/sidebar content if React profiling shows meaningful commits. | Secondary responsiveness; small/medium | React commit trace, keyboard/focus correctness, unchanged map transforms and count announcements |
| 12 | [sticker-packing.ts:221](<src/embedding/sticker-packing.ts:221>): zero indicator is an invariant, not independent scene measurement | Conservative masks and independent native diagnostics are now implemented. Retain diagnostic scope labels and continue label/HUD/halo/export scene QA separately. | Honest QA and future regression detection; small | Exact pair tests plus native artwork checks; avoid claiming all browser pixels/overlays were checked from a coarse-model counter |

Do not replace exact MDS with a landmark/approximate algorithm merely to satisfy a timing target. That is a separate scientific/display decision requiring neighbor/global-distance metrics, visible comparison and explicit disclosure. A precomputed global map filtered to a personal list is likewise a **global reference map**, not the same result as an independently fitted personal/country MDS map.

## Mobile validation sequence

### Recommended public-beta preparation

Following the external tree-legend refinement, the next pass should prioritize delivery and interaction overhead before changing the fitting method:

1. **Establish real-device limits.** Test current Safari on an actual iPhone and Chrome on a midrange Android. Measure cold and cached startup, import, fitting, packing, artwork settlement, frame-time distributions, memory pressure and background/resume for the demo, country, 700-species and near-limit fixtures. Desktop narrow viewports establish layout only.
2. **Prepare production delivery.** Serve text assets with Brotli/gzip and use content-versioned data/artwork URLs before enabling long immutable cache headers. The historical 16.31 MB raw / 2.30 MB offline-gzip startup data estimate is a reason to verify real HTTP transfer, not proof that a host serves compression. Ship only the production `dist/` artifact; validate workers, data, fonts, artwork and version invalidation over HTTPS.
3. **Reduce repeated drawing/cache work.** Profile projected-array allocation, paint-order sorting, wanted-image rebuilds, queue/metrics scans and per-frame diagnostic serialization/DOM writes. Precompute stable work and gate or throttle detailed diagnostics while retaining complete artwork, correct picking and deterministic coordinates.
4. **Make unchanged source preparation reusable.** Preindex fixed source/taxonomic clades and separate selected ancestry from recorded/background paths. `embedding/client.ts` currently clones and canonically hashes the source before either cache lookup; memoize a verified immutable source snapshot/fingerprint so warm country/cache requests hash only their changing identity. Preserve actual-content invalidation, cancellation and stale-result protection.
5. **Make release checks repeatable.** Add production-artifact and deployed smoke checks for import, navigation, both canvases, exports, rapid cancellation/country changes, failed assets, blocked/quota-limited storage, empty/unmapped groups and attribution. Verify the artifact contains no private collection or diagnostic files.

Exact bounded top-k neighbors and triangular Float64 distances remain useful later scaling work: they reduce sorting and dense-matrix storage without changing the scientific objective. Prioritize them according to the real-device large-list traces. Persistent caches do not remove the first uncached quadratic MDS fit. Approximate/landmark MDS or a filtered global map requires a separate method decision and comparative validation.

**Earlier visual-QA finding and implemented follow-up:** changing MDS size mode temporarily produced an empty pending packing scene and could clear the wanted image set, triggering avoidable reloads above the soft target. The current draw path retains the previous wanted set while packing runs; resolution changes also protect a ready fallback until replacement. Continue testing rapid size changes for stale geometry/hit targets, cancellation and settlement, without imposing a hard image cap that recreates missing birds.

Use real Safari on iPhone and Chrome on a midrange Android, with device model/OS/browser, screen DPR and power state recorded. Start with the existing 24-species demo, a small country, the 700-species collection and then a deliberate near-limit case. Keep the private CSV/results local. Record cold and warm asset transfer, import elapsed/peak memory, per-stage fit/packing time, image settlement, frame-time percentiles and long tasks; test cancellation, rapid country changes, size changes, repeated view switching, background/resume, pan/pinch/tap selection and export. Verify every requested species remains accessible and no old fit replaces a newer selection.

Set budgets after those measurements, covering completion, responsiveness and memory separately. Do not infer phone capacity from desktop logical-core counts, viewport emulation, a 72 MB matrix calculation or an old sparse-tree FPS result. Workers make interaction possible during computation; they do not eliminate CPU time, heat or battery use. No deployment, account upload or server-side observation processing is required to perform these local checks.

## Reproduction

```powershell
node test-results/audit-static-assets.mjs
node --import tsx test-results/audit-map-native-overlaps.ts
node --import tsx test-results/audit-map-native-overlaps.ts --large
node --import tsx test-results/audit-map-native-overlaps.ts --conservative
node --import tsx test-results/audit-map-native-overlaps.ts --large --conservative
node --import tsx scripts/sticker-overviews.ts
node --import tsx scripts/sticker-overviews.ts --verify-only
node --import tsx scripts/sticker-collision-masks.ts
```

The `test-results` diagnostic scripts/results are deliberately ignored because the overlap check consumes a private collection's existing coordinate artifact. They do not alter the source tree, artwork, app algorithms or personal records. The public collision capture script is a separate reproducible development tool: it writes the collision artifact/provenance from public pinned artwork, without reading any private collection. The checked-in [README-PERFORMANCE.md](<README-PERFORMANCE.md>) retains earlier benchmark history; this audit distinguishes that history from fresh checks and unmeasured limits rather than replacing it with an end-to-end performance claim.
