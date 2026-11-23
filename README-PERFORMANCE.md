# Local performance measurements

This report keeps the initial measurements as historical evidence. The final section, **Current layout, map and artwork release**, describes the current renderer and supersedes the earlier test counts and performance figures.

Measured 2026-11-18T04:06:15.507Z using v24.22.1, Windows_NT 10.0.26200 x64.
Hardware: AMD Ryzen 5 5600X 6-Core Processor; 12 logical processors; 31.9 GiB RAM.
Prepared dataset: `aves-1.7-clements2025-ebird2026-v1`; 18,631 reportable eBird 2026 taxa. Inputs are deterministic generated observations, with no personal data. The large CSV is generated in memory and is not committed.

## Historical Node import throughput

Each full-parse measurement is the median of five runs after one warm-up; includes building the complete taxon-name index, Papa Parse, concept reconciliation, aggregation, and report creation. CSV generation, module/data loading, file I/O, UI, and browser worker startup are excluded.

| Species | Rows | UTF-8 bytes | Full parse median (ms) | Range (ms) | 512 KiB chunk parse (ms) | Chunks | Duplicate species/checklist rows |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 100 | 7,153 | 37.6 | 31.1–48.1 | 41.8 | 1 | 0 |
| 1,000 | 1,000 | 73,598 | 45.4 | 36.5–47.9 | 34.9 | 1 | 0 |
| 5,000 | 5,000 | 376,288 | 65.5 | 64.3–72.4 | 71.7 | 1 | 0 |
| 100 | 100,000 | 7,299,952 | 492.4 | 438.0–587.3 | 542.0 | 14 | 90,000 |

The chunk test uses Papa Parse string chunks and the same aggregation class as the worker. All chunked results were byte-for-byte equal to full-parse normalized collections. This isolates parsing/aggregation from species count and checks chunk-boundary consistency. It does not measure browser FileReader, worker transfer, progress/cancellation latency, rendering, or navigation FPS. Those require the browser workflow checks.

Reproduce with `node --import tsx scripts/profile-import.ts`. Timings depend on system load and JavaScript warm-up. These are observations, not pass/fail performance promises.

## Historical browser measurements

Measured on November 17, 2026 (America/Los_Angeles), in the desktop in-app Chromium browser, Chrome 157, Windows, 1280 × 720, device pixel ratio 1, on the hardware above. The development-only harness is `http://127.0.0.1:5173/tests/browser-qa.html`; it uses real browser Files, the production importer worker, and the complete source tree. Synthetic CSVs are generated in memory and never saved.

The first complete scene appeared **413 ms after navigation** (42 ms after component mount); local data loading in the warm-cache harness took 60 ms. A separate app reload reported assets ready in 321 ms. These are local, warm-cache measurements, not cold internet-transfer promises.

| Species | Rows | CSV bytes | Browser worker time (ms) | Progress events | Result |
| ---: | ---: | ---: | ---: | ---: | --- |
| 100 | 100 | 11,901 | 80.9 | 2 | Passed |
| 1,000 | 1,000 | 120,646 | 90.4 | 2 | Passed |
| 5,000 | 5,000 | 611,336 | 139.4 | 3 | Passed |
| 100 | 100,000 | 12,000,000 | 657.1 | 24 | Passed |

Each visible-tab navigation run changed zoom on 180 animation frames, alternating six steps inward and outward. This deliberately exercises the real renderer, stable geometry and zoom-dependent labels.

| Recorded species | RAF callbacks/s | Canvas redraws/s | 95th percentile frame interval (ms) |
| ---: | ---: | ---: | ---: |
| 100 | 59.95 | 59.95 | 16.8 |
| 1,000 | 59.95 | 59.95 | 16.8 |
| 5,000 | 55.06 | 55.06 | 33.4 |

These exceed the initial 30 redraws/s desktop target. RAF callbacks and draw invocations are measured; compositor presentation FPS is not independently established. Visibility was `visible` throughout. The 5,000-species run had nine intervals above 33.3 ms. On the complete set of runs, the maximum measured single scene draw was 9.2 ms.

Immediate cancellation of a separate 12 MB real worker input returned AbortError in 22 ms and preserved the previous collection. The harness observed zero external resource requests, and all synthetic private markers were absent from normalized results. Code inspection additionally confirms no observation-data requests in the importer; Resource Timing alone cannot inspect request bodies.

## Historical workflow checks

- A full synthetic CSV was selected through the browser file picker. All input records reconciled; both current Willets shared the broader source tip, while the ambiguous legacy name stayed unresolved.
- Explicit IndexedDB save and browser reload restored the collection. Clear removed the saved synthetic collection. Downloaded backup contained normalized fields and no private fixture values.
- Scientific-name keyboard search, selection, family focus, reset, zoom, and keyboard pan were exercised. A source group with incomplete current coverage is labeled using its independently verified source clade, rather than inferred from a partial species count.
- The production build at localhost:4173 imported a user-provided export, displayed the personalized tree, selected species, and downloaded a **1928 × 1524 credited PNG**. All user-specific verification results, images, and the extracted export are in ignored `personal/`, absent from the production bundle.
- Mobile layout was inspected at 390 × 844 and the viewport override was reset afterward. No browser console errors were observed in production.
- Clean lockfile installation, all 37 focused tests, TypeScript checking, and the production build passed. Stop the development server before `npm ci` on Windows, because its native bundler module stays locked while Vite is running.

Those initial measurements preceded the expanded artwork release (56 illustrated species). The updated local release bundles all **11,027 available species**, comprising **22,054 WebP files / 235,863,538 image bytes**. Only visible stickers are loaded at runtime; the complete per-image manifest is fetched only when opened explicitly. Main source metadata remains compact, and the default canvas now suppresses unrecorded branches. Public hosting limits and transfer costs remain deferred.

## Historical personal-view update verification

The follow-up browser review verified that the default `data-background-branches` is zero. The tested personal collection retained its mapped source tips through the union of connecting branches. Order, family and genus selections filtered both the list and canvas; choosing a child correctly selected its parent ranks. Optional background context was restricted to the selected group. Clearing the selectors restored the full recorded collection.

Every recorded species in the supplied private export had local artwork. A previously missing illustration loaded its local 384px image successfully. The source tree and its independent audit were unchanged. Personal verification artifacts remain under ignored `personal/`.

All **48 tests**, TypeScript and the rebuilt production bundle passed after the update. A fresh production-preview tab verified the default sparse mode, taxonomy controls, local fonts/artwork, and the real import worker using the invented 56-species CSV; it reported zero browser warnings/errors. The mobile review found and corrected a report-link overlap and narrow taxonomy fields. The persistent development preview was left open with the private collection loaded; the temporary production-preview server was stopped after QA.

## Earlier layout, map and artwork release

Current browser evidence is in ignored `test-results/browser-performance-current.json`. These are individual local browser runs, rather than median timings. The environment was Chrome 157 on Windows, 12 logical processors and 32 GiB reported device memory, on the same Ryzen 5 5600X system described above. The visible QA viewport was **1280 × 720**, device pixel ratio **1**, with an actual **681 × 524 CSS/pixel canvas** beside the metrics panel. Local Manrope was confirmed ready.

The first scene rendered **305.7 ms after navigation**, or **34.5 ms after canvas mount**. Warm local data loading took **61.2 ms**, including a **0.7 ms** font wait. These measure local startup with prepared assets; they do not predict cold internet transfer times.

### Current browser imports

All generated Files were parsed and aggregated by the real browser worker, and every run passed the species/record reconciliation and synthetic privacy-marker checks.

| Layout at import | Recorded species | Rows | CSV bytes | Worker time (ms) | Progress events |
| --- | ---: | ---: | ---: | ---: | ---: |
| Compact | 100 | 100 | 11,901 | 91.7 | 2 |
| Compact | 1,000 | 1,000 | 120,646 | 100.4 | 2 |
| Compact | 5,000 | 5,000 | 611,336 | 143.8 | 3 |
| True distance | 100 | 100 | 11,901 | 80.9 | 2 |
| True distance | 1,000 | 1,000 | 120,646 | 94.3 | 2 |
| True distance | 100 | 100,000 | 12,000,000 | 713.0 | 24 |

The true-distance 5,000-species navigation run reused the already imported collection; no extra import time is inferred. Cancelling a separate 12 MB worker input returned AbortError in **15 ms** and preserved the prior collection.

### Current navigation

Each run alternated six zoom steps inward and six outward across 180 animation frames, with the tab visible. Drawing includes the real label/sticker scheduler. The compact and true-distance presentations have different geometry, label visibility and cache warmth, so the figures are observations rather than an isolated comparison of layout-algorithm cost.

| Layout | Recorded species | Canvas redraws/s | RAF callbacks/s | 95th percentile frame interval (ms) | Mean sampled draw (ms) | Max sampled draw (ms) |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Compact | 100 | 59.95 | 59.95 | 16.8 | 0.21 | 2.2 |
| Compact | 1,000 | 59.95 | 59.95 | 16.8 | 0.58 | 3.4 |
| Compact | 5,000 | 44.41 | 44.41 | 50.1 | 1.33 | 7.0 |
| True distance | 100 | 59.95 | 59.95 | 16.8 | 0.12 | 0.5 |
| True distance | 1,000 | 59.95 | 59.95 | 16.8 | 0.18 | 0.6 |
| True distance | 5,000 | 55.06 | 55.06 | 33.4 | 0.84 | 3.3 |

All average redraw rates exceeded the initial 30/s target for this canvas size. The 5,000-species compact run's 50.1 ms 95th-percentile interval still shows occasional pauses; the average is not a promise of uniformly smooth frames. RAF rate, draw invocation rate and sampled CPU drawing time do not independently establish compositor presentation FPS. Larger canvases and higher pixel densities need their own measurements.

### Image scheduling and memory

Visible artwork uses a queue capped at **six concurrent loads/decodes**, with **512 decoded entries retained by LRU**. The cache-churn defect found during this update was corrected: ready images are reused, obsolete queued requests can be discarded, and visible in-flight work is protected from eviction. Focused automated checks cover scheduling, retention and reuse.

The browser benchmark observed peak active decodes of 4, 6 and 6 for compact 100/1,000/5,000-species runs; the peak visible queues were 0, 2 and 10. These runs finished with zero decode failures and zero evictions. The cache held up to 50 ready images during the measured sequence; this browser run therefore does **not** stress the full 512-entry retention limit.

| Layout / recorded species | Visible-artwork wait (ms) | Visible ready | Visible failed | Visible queued/active on completion |
| --- | ---: | ---: | ---: | --- |
| Compact / 100 | 162.4 | 4 | 0 | 0 / 0 |
| Compact / 1,000 | 171.5 | 5 | 0 | 0 / 0 |
| Compact / 5,000 | 173.5 | 7 | 0 | 0 / 0 |
| True distance / 100, focused sticker | 171.1 | 3 | 0 | 0 / 0 |

The wait control requires 120 ms of stable zero visible pending work and has a 10-second timeout. Timings include that stability interval and may reuse decoded assets; they are not cold download/decode latency. Failed images are counted separately rather than treated as successful loading. Overview order representatives and zoomed species stickers have separate visible counters, so a sparse overview is not mistaken for full-species artwork loading.

Chromium's optional `performance.memory` reported **34.5–44.0 MB of used JavaScript heap** after the navigation runs. This is approximate JS heap only: decoded image storage, canvas backing stores, compositor/GPU memory and total process memory are not fully represented. No total-memory claim is made.

### Current workflow and delivery checks

- The single phylogenetic picker drills order → family → genus; its up-level button reverses that path. Order hover/click navigation, 240° order fans, larger early stickers and sparse recorded-ancestry rendering were verified. Compact explicitly reports no time scale; true-distance exposes the calibrated radial scale.
- The local Natural Earth country map, searchable list and country-filtered tree were verified using the supplied personal export. Country aggregates preserve distinct checklist totals and first precise dates without saving coordinates, exact location names, comments or checklist IDs. User-specific results and images remain under ignored `personal/`; no private export or country history is bundled.
- Legacy backups without country aggregates remain valid for the combined tree and prompt a fresh CSV import to enable the map. All-country and taxonomy resets were checked separately.
- The map's unassigned outlines remain unselected when **All countries** is active. Smaller territories not represented by a separate map outline remain available in the list.
- The profiling harness observed **zero external resource requests** across 110 recorded local resource entries. It does not inspect request bodies; code inspection also confirms that no observation data is sent by the importer and no remote map tile service is used.
- The final production preview imported the supplied export and selected a country, then an order, with zero browser warnings/errors. The narrow 390 × 844 layout and collection-panel toggle were checked; the viewport override was reset. The full personal collection was left open on the development server, and the temporary production preview was stopped.
- All **75 focused tests**, TypeScript checking and the final production build passed. The final build took **25.81 seconds**, including preparing the static output with the full local sticker set. Public hosting remains deferred.

The profiling harness is development-only and is not a normal production entry. The older Node profiling script regenerates this report; preserve these browser annotations when rerunning it.

## Earlier exterior spacing and experimental UMAP release

Verified November 18, 2026 (America/Los_Angeles), on the same local desktop. The previous navigation measurements above predate the exterior portrait layout and should not be treated as new profiling of this release.

The tree now reserves an exterior ring for equally spaced, source-ordered representative portraits. The complete enlarged hover card remains outside the branch/wedge exclusion circle. Source leader lines maintain the association with the actual order. When space is limited, orders are sampled evenly; wedges and the selector retain access to every order. Desktop and 390 × 844 browser checks confirmed the ring and order click/hover behavior. Placement regressions additionally cover short canvases, viewport boundaries, collision avoidance, stable hover positions, scale captions and navigation controls. The mobile canvas now honors its available height rather than clipping a taller internal drawing.

The UMAP worker uses the exact original source-tree patristic matrix and exact nearest neighbors; the algorithm and interpretation limits are in [UMAP-NOTES.md](UMAP-NOTES.md). The full source tree and taxonomy are unchanged. Private species names/codes and coordinates are absent from the committed performance report; aggregate verification files remain under ignored `test-results/`.

| Input | Mapped species/source concepts | Worker computation (ms) | Notes |
| --- | ---: | ---: | --- |
| Supplied collection, Node | 694 / 694 | 700.2 | 300 epochs; all coordinates finite; six placement gaps |
| Supplied collection, browser | 694 / 694 | 621.8 | All 694 points visible in the initial fit; 26 accepted stickers, zero pending/failed illustrations after settlement |
| Selected country, browser | 88 / 88 | 90.3 | Separate country fit; one source-placement gap |

These are single local runs, not median throughput or full view-transition timings. `elapsedMs` includes distance matrix construction, exact neighbor selection and optimization in the worker; worker startup, script download/parse, message transfer and canvas/image loading are outside that measure. Source patristic distances in the full verified collection ranged from approximately 0.307 to 197.980 Ma. UMAP output coordinates are unscaled and have no time units.

Filtering the full fit to an order and then a 13-species family retained its original 621.8 ms fit identity rather than recomputing coordinates. Hovering a marker revealed its species. Zoom, country switching, returning to the full collection, mobile fitting and Tree/Clusters switching were exercised. The production build loaded and computed the 24-species sample through its bundled worker with zero browser warnings/errors. A fresh performance FPS/memory stress test of the cluster renderer was not performed.

All **99 tests**, TypeScript and the final production build passed. The build took **26.80 seconds**; its separate UMAP worker is **93.54 kB** before compression and loads only when the experimental view is requested. The personalized collection was left open in Clusters UMAP on localhost:5173. The temporary production-preview server was stopped after verification.

## Current all-sticker release

Verified November 18, 2026 (America/Los_Angeles). Everybird's exact mass/painted-area sizing and 24-cell alpha capture are documented in [STICKER-GEOMETRY-NOTES.md](STICKER-GEOMETRY-NOTES.md). All **11,027** local 384 px stickers were hash-verified and measured, independently of personal observations, in 18.4 seconds on the first capture and 15.6 seconds on a repeat. The local geometry artifact is **2,402,834 bytes** and is fetched only for the UMAP view. Of 11,027 upstream comparisons, 10,483 masks are identical and 544 have fully explained artwork-version differences; none is unexplained or missing.

Packing runs in a separate cancellable worker after the phylogenetic embedding. These are individual runs, not medians; they do not include loading the worker, transferring messages, loading images or drawing the canvas.

| Input / environment | Size mode | Mapped stickers | Packing computation (ms) | Mask overlaps |
| --- | --- | ---: | ---: | ---: |
| Supplied collection, Node | Evened out | 694 | 252.1 | 0 |
| Supplied collection, Node | True size | 694 | 171.9 | 0 |
| Supplied collection, browser | Evened out | 694 | 193.4 | 0 |
| Supplied collection, browser | True size | 694 | 158.8 | 0 |

The separate tray adds the six species lacking source placement. Both browser size modes reported **700 drawn stickers and 700 ready visible images**, with zero pending/failed images, zero missing measurements and zero measured mask overlaps. These checks establish complete rendering, rather than inferring completeness from the absence of a loading spinner. The original UMAP fit did not change when the size mode changed.

An order filter retained the full packing bounds and 2.6 g mass reference while drawing all 316 filtered birds: 313 mapped and three unplaced. A family with no mapped member still displayed its unplaced portrait and could be selected through search. A country view drew all 89 birds (88 mapped plus one unplaced) with zero missing measurements or overlaps. The 390 × 844 check also reported all 700 portraits drawn and all six tray birds within the viewport; the temporary viewport override was reset. Detailed user-specific verification remains in ignored `test-results/all-sticker-browser-verification.json`.

All visible images remain protected even above the normal 512-entry retention budget; the six-request decode limit still applies. Hiding birds makes their images eligible for LRU eviction. No new total-process memory or navigation FPS claim is made from these single-frame/count checks.

The production preview loaded the local measurements and both workers, drew all 24 sample portraits, and reported zero browser warnings/errors. All **115 tests**, TypeScript and the final production build passed. The build took **26.41 seconds**, including copying the full artwork library. The new packing worker is **4.53 kB** before compression. The personalized 700-sticker view was left open on localhost:5173; the temporary production preview was stopped.

## Official Clements 2026 integration

Verified November 18, 2026 (America/Los_Angeles). The supplied official workbook was extracted read-only and checked against every reportable code/category and all 11,201 species in the pinned eBird API. The global crosswalk now places **11,195 species**, resolving **233** prior gaps without withdrawing an existing placement. Six genuine source-concept limitations remain explicit. Official identities and worksheet evidence are retained for every species, independently of illustration metadata.

The independent R/ape/clootl audit was rerun and bound to the newly annotated browser tree. Source topology, leaf order, all edge lengths, source annotations and dates are unchanged. Automated checks additionally compare source geometry and test full-world imports and saved-collection refreshes. All **134 tests in 16 files**, TypeScript and the production build passed.

The actual supplied export retains exactly the same 700 species observations, dates, checklist counts, country aggregates and record reconciliation. All **700 now map to 700 distinct source tips**, replacing the prior 694 placements and six unplaced portraits. The sparse tree reported 700 recorded tips and zero background branches. The browser drew all 700 cluster portraits in both size modes, with 700 ready visible images, zero pending/failed images, zero missing measurements and zero measured mask overlaps. The selected-country check drew all 89 birds with no unplaced portraits. These are completeness checks, not a new navigation FPS or total-memory benchmark.

The separate production preview imported the same export using its bundled import worker and drew all 700 portraits through the UMAP and packing workers, with zero browser warnings/errors. Aggregate private verification remains in ignored `test-results/official-taxonomy-*.json`; no personal observations are bundled. The complete personalized view remains open on localhost:5173. Temporary production previews were stopped after verification.

## UMAP placement comparison controls

Verified November 18, 2026 (America/Los_Angeles). The UMAP algorithm and its source-tree distances are unchanged. **Original positions** is the new default and adds zero individual displacement. **Limited movement** caps each portrait's displacement at 0–3 times its own longest side, accepting residual overlap. **Full packing** retains the prior unlimited collision avoidance. All species remain in the layout in every mode; overlapping images can obscure one another.

The common 20–100% sticker-size control keeps transformed UMAP anchors fixed and preserves Everybird's relative mass/shape scaling. Size and movement-limit tuning preserve the current zoom. Changing placement mode refits the view. Selected and hovered portraits draw on top; alpha-aware selection follows the actual drawing order. A shifted highlighted portrait has a dashed line to its original position. Accessibility text and image exports disclose the active placement mode and scale.

The actual supplied collection retained all **700 mapped birds**, with zero missing measurements, zero failed images and 700 ready image entries after each fitted view settled. In individual browser worker runs at 100% size, Original positions reported **zero moved birds** and 7,791 painted-mask overlap pairs; a one-length limit reported a maximum displacement of **1.0000000000000016** lengths (floating-point rounding) and 1,963 overlap pairs; Full packing reported zero overlap pairs. Computation was approximately 27, 53 and 163 ms respectively. These are single runs, exclude worker startup/image loading/drawing, and do not establish navigation FPS or total memory use. Pair counts refer to the complete loaded collection, including when a taxonomy filter is displayed.

Independent Node checks verify that the default full-packing coordinates match the prior implementation exactly, that all finite caps hold within numerical tolerance, and that changing common image size leaves every anchor unchanged. Separate Node/browser UMAP runs can differ slightly; their overlap counts are not directly compared. A 390 × 844 browser check verified all 700 members and usable controls without horizontal overflow; the temporary viewport override was reset. The production preview exercised all three modes through the bundled worker, with zero warnings/errors. All **139 tests**, TypeScript and the production build passed. Detailed private evidence is retained in ignored `test-results/bounded-packing-verification.json` and `test-results/packing-controls-browser-verification.json`. The full personalized collection remains open in Original positions; the temporary preview was stopped.

## MDS from UMAP and radial portrait stacks

Verified November 18, 2026 (America/Los_Angeles). **Bird map** now defaults to uniform metric MDS initialized from the same seeded UMAP, with **Limited movement / 0.25 sticker lengths / 100%** portraits. UMAP remains selectable. The fit runs in a cancellable worker and its cache distinguishes algorithms; taxonomy filters retain its identity, while countries get separate fits. Full packing remains optional. The source tree, original patristic distances, species mapping and Everybird relative image sizing are unchanged.

The actual 700-species Node implementation reproduced the Python experiment's 463 iterations and coordinates within **2.63 × 10⁻⁹**, taking 1,216 ms. Browser UMAP initialization differs slightly from Node: the development fit took **2,247.5 ms**, and the production fit **2,006.6 ms**, both reaching the explicit 1,000-iteration limit. Their stress declined from **20,469.13 to 8,918.68**; the UI accurately reports the limit rather than claiming convergence. These are individual worker computations, excluding startup, image loading and drawing. They do not establish median throughput.

The production map drew all **700** mapped stickers with **700 ready images**, zero pending/failed images and zero missing measurements. Its 0.25-length displacement bound held within floating-point tolerance (maximum 0.2500000000000012); **7,443** painted-mask overlap pairs remain deliberately allowed by this cap. Drawing every bird does not imply every silhouette is unobscured. A regional benchmark fit contained all **89** birds, used 232 MDS iterations and took 121.3 ms in the development browser. A 316-species order filter retained the complete 700-species fit. Switching between UMAP and MDS restored the appropriate cached result.

**Tree portraits → Radial stacks** places upright portraits on their displayed tree-tip rays, moving only outward to avoid rectangle overlap. An independent exhaustive pair check found **zero overlaps among all 700 portraits** in both branch layouts, with angular error below **4.45 × 10⁻¹⁶ radians**. Node placement took 7.7 ms in True distance and 2.9 ms in Compact. Camera fitting includes the entire halo; species focus, order fans, compact/true-distance switching, sparse ancestry and the previous representative view were exercised. Dense true-distance angles require tall stacks, so a complete fit on a short canvas makes portraits small; Compact, order filtering and zoom improve readability. Portrait radii are decorative and carry no evolutionary-time meaning.

The production tree likewise drew all 700 portraits, reported 700 ready images, zero pending/failed images, 700 recorded tips and zero background branches. Individual settled production draws measured **4.4 ms for the tree** and **4.7 ms for the map**; image-loading transitions were slower. These samples are not a fresh navigation FPS or total-memory benchmark. The 390 × 844 production check found no horizontal overflow; the map now reserves a 340 px drawing area and allows vertical page scrolling, and the tree retained a 312 px canvas. The temporary viewport was reset.

All **147 tests in 17 files**, TypeScript and the final production build passed; the build took **28.54 seconds** including the full artwork library. The bundled embedding worker is **96.48 kB** before compression. The final production preview imported the actual personal export and exercised both new views with zero browser warnings/errors. Private evidence remains in ignored `test-results/mds-production-verification.json`, `radial-stacks-verification.json` and `mds-radial-browser-verification.json`. The personalized MDS view remains available on localhost:5173; the temporary production preview was stopped.

## Birds&trees interface refinements

Verified November 18, 2026 (America/Los_Angeles). The app is now **Birds&trees**. The tree uses radial portraits exclusively, with shared **Averaged size / True size** controls based on Everybird's mass and silhouette-area formulas. **Show tree** changes rendering only: browser checks confirmed identical portrait-layout signatures and camera transforms before and after hiding the branches. The hidden-tree center correctly counted all **700 unique recorded species**. Both size modes rendered all 700 portraits with zero rectangle overlaps, zero failed images and angular errors within floating-point tolerance. Source topology and distances remain unchanged.

Bird map now presents only MDS with **full packing** and a common sticker-size slider. At 100% and 20% size, the personal collection retained all **700 species**, zero missing measurements and zero painted-mask overlaps. Selecting **Passeriformes (316)**, **Corvidae (20)** and **Corvus (5)** changed highlighting while retaining all 700 birds, the same fitted embedding, packing bounds and camera. Nonmembers remain visible at reduced opacity. Clearing highlights and changing common size preserved the camera. These are membership and geometry checks, not a new navigation FPS or total-memory benchmark.

A small regional benchmark counted all **7** birds, offered only its two represented orders, and highlighted **5** perching birds while retaining all seven. Empty order, family and genus choices are omitted, including when recorded species lack source placement. Both canvases show species counts; the radial count uses species rather than the number of potentially repeated source-tip portraits.

At **390 × 844**, both views retained all 700 ready portraits without horizontal overflow. The MDS drawing area was 340 px high; the radial canvas was 293 px high. The viewport override was reset. The production preview exercised true-size radial portraits with hidden branches, MDS full packing, a 9-of-24 order highlight, correct counts and zero browser warnings/errors. The full personal collection was verified on the development server. Private browser evidence is retained in ignored `test-results/refinements-browser-verification.json`.

All **152 tests in 17 files**, TypeScript and the final production build passed; the build took **31.16 seconds**. The main JavaScript bundle is **426.18 kB** before compression. The temporary production preview was stopped; the complete personalized map remains open on localhost:5173 with the perching birds highlighted.

## Color arrangement, presentation audit and overlap sweep

Verified November 19, 2026 (America/Los_Angeles). The separate [PERFORMANCE-AUDIT.md](<PERFORMANCE-AUDIT.md>) records generation, image memory, worker copying, cache lifetime, import and drawing costs, with a ranked improvement backlog. [VISUAL-AUDIT.md](<VISUAL-AUDIT.md>) records presentation defects, completed safeguards, validation limits and remaining design work. Persistent caching was still proposed at this audit stage; the implementation and later measurements follow below.

Predominant illustration colors were captured for all **11,027** bundled species. Two full interior-sampling captures produced identical **2,273,339-byte** JSON; capture took 46.1 and 34.5 seconds. A separate conservative collision capture unions native 128/384 px alpha footprints, with a one-source-pixel guard, for all 11,027 species. Two captures produced identical **1,073,914-byte** JSON; its offline gzip estimate is 274,466 bytes. Both artifacts are general library data, not derived from personal observations, and load only when the corresponding presentation needs them. Original Everybird sizing data, illustrations, source tree and raw MDS coordinates remain unchanged. Color methodology and reproducibility are in [COLOR-NOTES.md](<COLOR-NOTES.md>).

The personal **700-species** color overview and **316-species** order fan retained one portrait per species, with zero independently checked tile overlaps in both size modes. The original phylogenetic presentation retained its source angles and zero tile overlaps. Independent MDS native-alpha checks found zero intersections across **eight configurations**: 128/384 px assets × Averaged/True size × 20/100% common scale. Collision occupancy is intentionally more conservative than the sizing mask and can expand decorative packing extents; it does not redefine body-size ratios or the fitted phylogenetic coordinates.

Browser checks verified all 700 portraits and ready images in the color overview and both MDS size modes, with no missing geometry or failed images. The new MDS full-packing worker took **217.6 ms averaged / 124.4 ms true size** in individual local runs. These are worker-computation samples, not complete transition latency or a sustained frame-rate benchmark. Taxonomic highlights retained the full fit, packed bounds and camera. Name labels now use whitespace placement; leaders skip complete image tiles; count information and interface controls have reserved space.

At **390 × 844**, the mobile color overview retained all 700 ready portraits with no horizontal page overflow. The canvas was **319 × 340** CSS pixels beside a separate controls column. Selected-species details flowed below the canvas, including with the collection panel expanded; their rectangles did not intersect the drawing area. These remain desktop viewport checks, not actual-phone CPU, memory or touch measurements.

The final production preview loaded both new data artifacts, rendered the 24-species sample in color mode and MDS, retained all 24 while highlighting nine, and reported zero browser warnings/errors. Its color PNG was visually inspected: the count and portraits fit, source credits remained legible, and the caption explicitly distinguished decorative color angles from evolutionary distances. Export timing was not benchmarked. Detailed private browser evidence remains in ignored `test-results/polish-browser-verification.json`.

All **175 tests in 19 files**, TypeScript and the final production build passed. The build took **28.13 seconds**; its main JavaScript bundle is **435.32 kB** before compression. The temporary production preview was stopped, and the personalized collection remains open in **Color within orders** on localhost:5173.

## Persistent layouts and smaller overview artwork

Verified November 19, 2026, after the audit. Completed MDS/UMAP fits and sticker packing now persist in a separate optional IndexedDB cache, bounded to **24 results / 16 MiB serialized payload** with LRU eviction. SHA-256 keys include the actual complete source tree, mapping/membership, algorithm versions and parameters; packing identity includes all coordinates, dimensions, collision masks and settings. Stored results are validated before use. Unsupported, blocked, corrupt or full storage falls back to computation. Cancellation and clearing invalidate outstanding reads/writes. The stored payload contains derived species coordinates, packing geometry and numeric metadata, never observations or a pairwise distance matrix. Collection saving remains explicit. The collection menu clears the session, saved collection and layout caches together.

The following are individual local desktop-browser client timings for the supplied **700 species**. They include request snapshot/hash/cache preparation, with original worker time shown separately. They are not complete page-ready, internet-transfer, median or phone benchmarks. Reimporting the same CSV after a page reload exercised persistent storage without silently saving observations.

| Result | First load, computed | Reload, persistent | Original worker time |
| --- | ---: | ---: | ---: |
| MDS from UMAP | 2,408.0 ms | 284.5 ms | 2,020.6 ms |
| Full sticker packing | 185.8 ms | 27.3 ms | 153.3 ms |

A later reload of the final code reported **290.2 ms / 43.5 ms** respectively. Both reused persistent results; packed bounds, fitted stress and species membership matched the first generation. The cache metadata preserves original computation durations and reports current `cacheSource`, `cacheReadMs` and `loadMs` separately. Source fingerprinting/validation still costs time on cache hits.

All **11,027** illustrated species now have **32/64/128/384 px** tiers. The new lossless 32/64 px derivatives retain full canvas/alpha and verified source provenance. Resolution follows physical on-screen size with DPR capped at two and hysteresis. A ready tier remains drawable until its replacement decodes; missing tiers try alternatives once. Unneeded large duplicates are released. The artwork cache tracks native RGBA estimates with a **32 MiB soft byte budget**, retaining every wanted image even above that budget or the soft 512-entry target. Pending packing retains the previous wanted set to avoid transient decode churn. No species sampling was introduced.

For the full 700-bird desktop overview, **649 images at 32 px + 51 at 64 px** used **2,729,600 estimated RGBA bytes**. At **390 × 844**, both radial and MDS views drew all **700 ready portraits at 32 px**, with no failed images or horizontal page overflow. Their base artwork cost was **2,267,392 bytes**, compared with **36,265,984 bytes** for all corresponding 128 px assets: **93.75% fewer decoded pixels/bytes**. Compressed 32 px files total **871,640 bytes**, versus **3,026,284 bytes** at 128 px. These figures exclude browser/GPU/decoder/JavaScript memory; they are not measured total RAM.

The final MDS layout reported **zero collision-mask overlaps**, no missing geometry and all 700 portraits. Four-tier collision capture independently contains every guarded native-alpha footprint for all **44,108 images**, preserving the original Everybird sizing/hit data. This conservative packing footprint can expand decorative spacing; it does not change fitted MDS coordinates. Zoom promotion retained **190 drawable images out of 190 on-screen portraits while 126 target-tier requests were pending**, then settled with 32/64/128/384 px images and zero pending requests.

Selecting **Passeriformes (316)** retained all 700 birds, bounds and camera; all **384 nonmembers** became gray, with **zero group boxes**. Clearing the group released gray variants. The mobile gray overview used **3,499,264 estimated bytes** including variants. New gray conversion is spread over frames with a four-millisecond conversion budget; already converted birds remain immediate, pending birds stay visible using dimmed originals, and a failed conversion does not loop. One conversion is uninterruptible and can exceed the budget. A first conversion-batch snapshot drew all 700 in **14.0 ms**, versus **406.5 ms** when all variants were created synchronously during development; the final settled snapshot was **11.3 ms**. These are single frames, not sustained FPS claims. Export completes pending gray conversion before capture; export timing was not measured.

The production preview rendered all **24** sample birds, retained them while highlighting nine and graying 15, reused both persistent layouts, and reported **zero browser warnings/errors**. Subsequent camera integration uses one completed-scene effect to handle both initial fitting and resize, retaining the explored world center and relative zoom. The browser's 700-bird overview fitted its entire packed extent inside both a **319 × 340** mobile canvas and a **904 × 360** desktop canvas after resizing. A development hot-reload dependency-array warning is preserved in the private log; it occurred during the code edit, and the final component was remounted before resize validation.

Final checks passed **218 tests in 22 files**, TypeScript and the production build. The final build took **49.18 seconds**; most build time copied the expanded static artwork library. The main JavaScript bundle is **452.91 kB** uncompressed / **146.00 kB** reported gzip. Private browser evidence is in ignored `test-results/layout-cache-browser-verification.json`; tier sums are in `test-results/overview-artwork-profile.json`. The temporary preview was stopped. The personalized map remains open on localhost:5173. Actual phone CPU/memory-pressure/touch/background behavior remains unmeasured.

## Radial spacing and simplified map controls

Verified November 19, 2026, after persistent caching. Bird map no longer presents the Sticker size slider or its tuning panel. It uses a fixed common scale of one while retaining **Averaged size / True size**. Changing relative size mode still reuses the fitted MDS coordinates and computes/caches the appropriate decorative packing. The map's scientific method and distance matrix are unchanged.

The long outward tree spokes were mainly a portrait-spacing issue: Regional benchmark's ten recorded Pelecaniformes occupy roughly **3.4 degrees** of the full source-tree angular allocation. Large true-size portraits cannot fit beside each other in that small arc, so they stack along almost parallel rays. Their decorative radius is not a divergence date. True radial branch dates and angular allocation are separate display choices.

Visible-tree packing now compares three deterministic greedy passes (angular ascending, descending and largest rectangle first), retaining the smallest maximum radius with a stable tie rule. All plotted tip angles, portrait dimensions, relative body-size ratios, branches and dates remain unchanged. Regional benchmark's 193-bird true-distance/true-size maximum decorative radius fell **6.4882 to 5.4125** (16.6%); the full 700 fell **15.4162 to 12.2396** (20.6%). These are world-space portrait extents around a unit-radius tree, not times. Minimizing the farthest portrait can move other portraits farther out; the mean does not necessarily improve. Wider angular allocation for bird-heavy orders remains a possible further refinement without changing radial branch distances.

With branches hidden, the app preserves phylogenetic sequence (or the selected illustration-color sequence within orders) and closes unused angular space. Slots are weighted by **(portrait width × height)^0.625**, a display heuristic that gives larger portraits more angular room. A provisional layout reserves a 0.36-unit center; the final count disk uses **max(0.36, 12% of provisional maximum radius)** and repacks only if needed. This keeps the center small while leaving the number readable in larger collections. The count text stays inside the protected disk. These angles and radii are decorative; re-enabling the tree restores its original displayed angles and radial distances and refits the view. Branch-length controls are hidden while the branches are hidden.

| Birds-only fixture | Center radius | Maximum portrait radius | Layout CPU median |
| --- | ---: | ---: | ---: |
| Regional benchmark, averaged, 193 | 0.360 | 1.8154 | 1.30 ms |
| Regional benchmark, true size, 193 | 0.360 | 2.3636 | 1.58 ms |
| All countries, averaged, 700 | 0.4108 | 3.5171 | 16.70 ms |
| All countries, true size, 700 | 0.5515 | 4.6632 | 19.37 ms |

Those seven-run desktop Node medians include weighted angular allocation, initial packing and the conditional second pack. They are not phone/browser-interaction benchmarks. The initial fixed-center/equal-slot experiment produced larger hidden extents (3.0605 Regional benchmark true / 6.8939 all true); final weighted/adaptive values above replace those prototypes. Independent pairwise checks found zero tile overlaps in every tested fixture, including all 36 weighted-slot trials; every input portrait and its dimensions were retained. Algorithms, inputs and diagnostics are in ignored `test-results/radial-spacing-experiments.{ts,json}` and `test-results/radial-weighted-slots.{ts,json}`.

Browser checks verified all **193 Regional benchmark portraits** in true-size Tree and birds-only views, zero missing geometry/failed images/packing overlaps, and an identical visible-tree layout signature after hiding and restoring branches. At **390 × 844**, all **700** true-size birds remained drawn and ready in the final compact circle with zero overlaps or horizontal overflow; the center number was **16.1 CSS pixels**, compared with 8.3 px in the equal-slot/fixed-center trial. The color arrangement retained all 700 with zero branches/overlaps. Bird map retained all 700 true-size portraits, fixed scale one and zero packing overlaps; it exposed zero sliders and both relative-size controls. Private browser evidence is in ignored `test-results/radial-refinement-browser-verification.json`. These are desktop browser viewport checks, not physical-phone tests.

All **224 tests in 22 files**, TypeScript and the final production build passed. The build took **61.2 seconds**, largely copying static artwork; the main JavaScript bundle is **454.00 kB** before compression / **146.44 kB** reported gzip, and CSS is **45.01 kB**. The local app remains open on the personalized Regional benchmark true-size birds-only view.

## Portrait-footprint tree and dark appearance

Verified November 19, 2026, after approval of the portrait-footprint draft. Visible Tree now allocates angular slots with **(portrait width × height)^0.625**, anchored to the complete current-country collection. Internal node angles follow weighted descendant intervals. A shared historical source tip receives the largest mapped footprint once. Unobserved source tips share a tiny positive reserve totaling **0.01%** of recorded weight, allowing background branches to appear without reallocating observed birds. Source-tip sequence, topology and dated radii are preserved; original full-global-tree angles are no longer the display layout. **True distance** still uses the original radial branch distances. The minimum-width hybrid remains a draft.

The live Regional benchmark true-size tree matches the approved draft: its Pelecaniformes wedge is **41.7117°** and maximum decorative radius **2.65676**, compared with **41.7155° / 2.65673** in the draft without the background reserve. The full 700-bird true-size tree has a **22.8178°** Pelecaniformes wedge and maximum radius **4.98244**. Averaged-size values are **32.4390° / 2.20753** for Regional benchmark and **18.5298° / 3.59404** for all countries. These radii describe portrait spacing around a unit-radius tree, not divergence times. Relative size mode can intentionally change angular weights; ordinary visibility, theme and background changes do not.

Independent checks in ignored `test-results/verify-footprint-implementation.{ts,json}` cover **8 full configurations** (193/700 × averaged/true × True distance/Compact) and **184 represented order fans**. All retained their portraits/dimensions and source leaf order, with zero independent rectangle or spacing-gap overlaps. True-distance node-radius error was **zero**; Compact radii matched the previous radial transform under the same visible scope. Source object/file hashes were unchanged. Full-circle and explicit-domain fan angles remained identical under background/context changes. Single Node geometry calls ranged **3.08–11.85 ms**, and packing **1.44–9.01 ms** on the local desktop; these are neither medians nor phone benchmarks.

Appearance now defaults to **System**, with an explicit **Light / Dark** header toggle and **Use system theme** in the collection menu. The tiny preference is stored in localStorage independently of personal observations and layout caches. Blocked storage retains a session choice. OS and cross-tab updates are supported; a prepaint initializer applies the saved/system appearance before app loading. Dark colors use charcoal surfaces, warm light ink and coral accents. CSS controls, the country-map SVG, both canvases, labels, placeholders, counts and PNG export footers use matching palettes. Illustration colors are never inverted. Export takes its palette snapshot after asynchronous artwork loading.

Browser checks confirmed that an explicit Dark choice survives reload, with the saved preference and dark canvas palette restored. Light/Dark switching preserved the tree portrait-layout signature, camera and ready-image count. Both the complete **700-bird tree** and **700-bird MDS map** rendered all images in Dark, with zero packing overlaps. MDS reused **persistent** fit and packing results; theme changes retained its packed bounds, camera and all ready images. Selecting Passeriformes retained 700 birds, grayed all **384 nonmembers**, and drew zero group boxes. The zoomed 10-bird Pelecaniformes fan retained its portrait layout and camera when its **120** background tips were revealed.

At **390 × 844** and **320 × 844**, all 700 map portraits remained ready in Dark, with no horizontal page overflow. The theme button remained **44 × 44 CSS pixels**. At 320px the import button ended at x=293 inside the 305px usable page width. These are desktop browser viewport checks, not physical-phone CPU, memory-pressure or touch benchmarks. Detailed private browser snapshots are in ignored `test-results/footprint-dark-mode-browser-verification.json`.

Final checks passed **241 tests in 24 files**, TypeScript and the production build. The build took **52.47 seconds**, largely copying the static artwork library. Main JavaScript is **459.18 kB** uncompressed / **148.27 kB** reported gzip; CSS is **46.39 kB**. Theme changes trigger redraw only and do not invalidate embedding or packing caches. The local personalized Regional benchmark true-size footprint tree remains open in Dark appearance.

## Sticker delivery and progressive population

The subsequent loading pass adds versioned immutable artwork URLs, a shared 32 MiB encoded-resource LRU, compressed production text, a production launcher with build reuse, lossless 16-bird overview sheets, and separate HTTP/decode scheduling. It preserves all source illustrations, measured dimensions, layout coordinates and scientific distances. See the sticker-delivery follow-up in [PERFORMANCE-AUDIT.md](<PERFORMANCE-AUDIT.md>) for the original cold/warm HTTP investigation and measurement boundaries.

All **11,027 species / 22,054 32px and 64px crops** were checked for exact alpha, visible RGB and full-canvas dimensions. Repeated generation produced identical assets. The planner uses a shared sheet only for at least two wanted members and within an 8× per-group encoded-byte allowance. A pure 700-species 32px pass uses **152 sheets + 155 individual images = 307 image requests**, plus the cached manifest. It transfers **2,923,390 image bytes**, versus 871,640 for individual files; reduced request overhead trades extra neighboring-artwork bytes. Requested crops remain in the main image cache; unused sheets are evicted toward a separate 8 MiB decoded-retention target.

In one desktop in-app Chromium run on the existing development origin, the scene first reported 700 imported species **822 ms** after selecting the 9,177-row CSV and reached **700 drawable / zero pending / zero failed** at **4,581 ms**, including import and resolution upgrades. This could reuse 24-species demo artwork and a warmed filesystem; it is not a controlled cold Chrome or phone benchmark. The new loader's actual totals for that run included the demo/upgrades, so they differ from the pure-pass planner count.

The production build separately rendered all **700** in Tree and True-size MDS, with no image/catalog/sheet failures or model packing overlaps. The fresh MDS artwork cache used **307 image loads** and retained **2,267,392 estimated crop RGBA bytes + 8,360,192 sheet RGBA bytes**. Those are not whole browser/GPU memory. All 384 nonmembers became gray when Passeriformes was selected, with zero group boxes; PNG export completed. At 390 × 844 all 700 remained ready, with no horizontal page overflow. Production and development browser consoles reported zero warnings/errors. Private observations/snapshots are in ignored `test-results/sticker-loading-browser-verification.json`.

All **268 tests in 28 files**, TypeScript and the production build passed. New tests cover shared-sheet deduplication and fallback, crop bounds, complete public coverage and hashes, pixel identity, progressive overview retention, finite network/decode/crop behavior, late bitmap disposal, immutable-cache validation, compression, conditional requests and static-root isolation. The build took **102.1 seconds**, mostly copying the static image library; unchanged launcher starts reuse that build. The JavaScript bundle is **468.47 kB / 151.18 kB reported gzip**. A temporary production verification server was stopped after checks; the existing 5173 app remains running with the optimized loader and sticker middleware.

## Arboretum and central Bird map count

The Arboretum derives country, annual and cumulative trees from the current normalized collection. It initially mounts up to **12 cards**, adds another 12 when requested, lazily prepares one branch-only SVG path for each visible card, and reuses one source layout. It creates **zero sticker images, nested canvases or fitting workers** for previews. Explorer and gallery are separate mounted sections; leaving the explorer disposes its decoded artwork/crop cache, and returning can reuse immutable HTTP assets and completed layout caches. MDS does not start while the gallery is active.

CSV import now retains annual summaries and exact cumulative snapshots, both combined and by country. Checklist IDs remain transient: annual sets feed one incremental cumulative sweep, then only normalized summaries leave the worker. Storage grows with annual/cumulative species-country incidences. The supplied **9,177-row / 700-species / 7-country** fixture spans **2022–2026**. Its normalized pretty backup grows from **476,875 to 2,555,697 bytes**; one fresh desktop Node run imported in **160.2 ms**, serialized in **32.6 ms**, and restored/validated in **30.0 ms**. These exclude file I/O and browser rendering, are not medians or phone results, and do not establish peak memory. Exact diagnostics are in ignored `test-results/arboretum-history-profile.json`.

Browser checks found the combined card plus seven regional cards. Annual and cumulative card counts matched the explorer, including period/country labels; an empty regional/year intersection offered a useful All years action. A replacement import cleared an unavailable prior gallery-country filter. Gallery checks at **320px** found no horizontal overflow and zero image/canvas previews. Light and Dark were visually checked. Older backups retain first-seen cumulative membership, with full-export checklist totals labeled; annual history requires a fresh CSV. Unknown, invalid and 1900 dates are never assigned invented years.

The Bird map now reserves a central **world-space rectangle** during decorative packing. It excludes complete bird tiles from this area and keeps names, source leaders and anchor markers outside it. The total includes valid unplaced species, with a secondary highlighted total when relevant; synthetic unresolved identification rows do not count as species. The number, labels and highlighted line stay within the slot at every zoom, with capped text offsets for sparse/zoomed views. The former **64px top HUD is removed**. The packing cache version changes, while the MDS embedding cache, source matrix, fitted coordinates and original portrait dimensions remain unchanged. Occupied-area accumulation is now canonical by species code to match the content-sorted cache identity.

Independent existing-700-fixture checks retained all portraits/dimensions/raw source anchors with **zero bird-mask overlaps and zero count-slot tile intersections** in both size modes. Browser checks retained all **700** ready images and a **32px** center number. Selecting Passeriformes showed **316 highlighted**, retained the 700 total and all positions, and left the camera unchanged. Empty and one-species periods rendered zero/one correctly. At **390 × 844**, all 700 remained visible and ready, with a **24.1px** number and no horizontal overflow. PNG export completed with the counter. The browser console reported no warnings/errors. These are desktop viewport checks, not physical-phone benchmarks. Private browser evidence is in ignored `test-results/arboretum-browser-verification.json`; independent geometry evidence is `test-results/verify-center-count.json`.

The full suite passed **283 tests in 31 files**; affected count checks were rerun after the final typography adjustment. TypeScript and the final production build passed. Build time was **57.45 s**, primarily static-artwork copying; the launcher reuses the prepared build until source changes. Main JavaScript is **487.20 kB / 156.47 kB reported gzip**, CSS **55.13 kB / 10.58 kB**. The source/embedding worker remains the same content-hashed chunk; import and packing workers include the new summaries/reserved-center support. The local app is left on the personalized Arboretum.

## Growing life list playback

The tree animation prepares geometry, footprint weights, portrait packing and the camera once for the final dated scope. Each first-seen date changes membership and the paths needed to connect those species; it does not rerun MDS, packing or camera fitting. Newly added paths and portraits fade for 100 ms, with no continuous drawing between additions. Pausing, scrubbing and reduced-motion preferences use complete frames. A single cancellable timer advances dates; hidden tabs, dialogs, scope changes and exports stop playback. Exports pause the frame and lock scene controls while artwork settles.

Artwork prefetch is limited to the final dated scope at 32px, prioritizing newly revealed and current birds before future additions. Existing cached imagery and delivery sheets are reused. This keeps upcoming birds ready without requesting the full global catalog. The local growth benchmark covers a 700-species collection and a smaller regional subset. Regional and annual playback were checked for correct transitions between period scopes; personal travel locations and dates are omitted from this public benchmark history. Unknown dates receive no invented animation timing.

Browser verification found the same full-list portrait-layout signature and camera at blank, first and final frames; recorded ancestry grew from zero to **3,288 branches / 700 tips**. All **700** illustrations were drawable at completion, with zero packing overlaps. Timed replay completed without looping, dialogs paused it, backward scrubbing restored earlier membership, and PNG frame export completed. At **320 × 844**, all 700 illustrations remained drawable with no horizontal page overflow. Light/Dark were checked, and the browser's reduced-motion preference correctly started paused. These are desktop browser checks, not physical-phone benchmarks. Private evidence is in ignored `test-results/growth-browser-verification.json`.

All **302 tests in 33 files**, TypeScript and the production build passed. New tests cover date grouping and validation, cutoff/country chronology, cancellation, shared ancestry, future hit targets, prefetched scope, fixed geometry and rendering opacity. The build took **52.56 s**, primarily static artwork copying. Main JavaScript is **499.78 kB / 160.60 kB reported gzip**; CSS is **58.06 kB / 11.09 kB**. No new dependency or worker was added.

## Continuous branch growth

The subsequent animation refinement replaces the short whole-path fade with continuous drawing. Each date prepares a plan of only its new edges; each edge follows its angular connector and then its radial line. Scheduling uses cumulative displayed path length from existing ancestry, so children wait for their parent and independent attachments grow together. Existing branches stay opaque. The plan is reused across animation frames; neither geometry nor packing changes. A requestAnimationFrame clock eases the reveal and brings in each portrait only after its own branch arrives. Smooth motion spans 90% of a date interval, leaving time for the frame to settle. At normal speed, intervals target 54 seconds across a list, bounded to 320–1,200 ms per date; the four speeds remain available. These durations are decorative and do not represent evolutionary time.

The final date now holds for its complete transition before playback stops. Speed changes preserve current progress; paused, exported or scrubbed frames latch as complete and cannot retract on resume. Future portraits have no picking fallback while growing. Reduced-motion users can explicitly opt in with **Grow branches**, which otherwise starts disabled. No dependency, fitting worker or new image tier was added.

The independent 700-species sweep checked all **170 dates / 3,288 new edges** in True distance and Compact, finding finite intermediate paths, correct parent-before-child ordering and exact completed geometry. Browser sampling caught one event progressing from **0.060 to 0.293**, with reached edges increasing **2 → 6** and a partially drawn edge at both samples. The last date remained playing during its partial path, then finished with **700 drawable portraits**, zero packing overlaps and the original layout signature/camera. At **320 × 844**, all 700 remained drawable, the motion control had a **44px** target height, and there was no horizontal overflow. These are desktop browser checks; no physical-phone benchmark is claimed. Private evidence is in ignored `test-results/smooth-growth-browser-verification.json`.

All **321 tests in 35 files**, TypeScript and the production build passed. The build took **57.31 s**, mostly static artwork copying; the prepared launcher build can be reused. Main JavaScript is **503.73 kB / 161.89 kB reported gzip**, CSS **58.33 kB / 11.12 kB**. Vite reports its 500 kB chunk-size advisory for the main bundle; splitting existing features remains a separate delivery optimization.

## Country comparison and activity-based pacing

**All countries together** is an optional playback view beside **Single tree**. It renders the combined collection and each country's fixed final tree under one union calendar and event epoch. Country panels use their own first-recorded dates; country-only additions remain in the calendar even if the species was already recorded globally. Switching views pauses and maps the current date into the target timeline. The comparison uses the current cumulative year cutoff, retains undated-only panels with explicit counts, and omits empty year/country intersections. Inspection gestures stay in Single tree; comparison canvases allow page scrolling and expose accessible counts. Export main frame captures the combined tree.

A `SharedArtworkPool` supplies one decoded image cache, atlas cache and delivery queue to all panels. It unions each client's wanted images, merges priorities/fallbacks/variants and protects other panels' imagery when one disconnects. Semantic equality avoids rebuilding the pool's wanted set on every animation frame. The last disconnect releases the cache; reconnecting creates a fresh one, including under Strict Mode. Layouts and portrait packing are prepared once per panel and reused while their membership changes; no embedding workers start in this view. Definite grid row heights prevent canvas intrinsic dimensions feeding back into ever-growing cards.

Date intervals now use bounded sublinear activity weights: `100 + 110 × additions^0.65` milliseconds, clamped to 160–2,200 ms at 1×. A single addition gets 210 ms; 40 additions get 1,310 ms. Transitions use 99% of their interval to minimize settling gaps, and the final event holds for its complete transition. Bursts remain faster in additions/second while receiving more drawing time than quiet dates. Same-day records are not assigned invented within-day sighting times. In the comparison, activity is measured across panels, so a country-only date receives drawing time.

The local comparison fixture exercises both combined and country-only additions. Nominal event time at 1x is **58.423 s single / 87.790 s comparison**, excluding startup and rendering overhead. Browser replay completed with **700 combined species across seven regional panels**. All portraits were drawable in every panel, all reported zero packing overlaps, and every panel showed the same ending date. A country-only addition correctly advanced its regional counter while leaving the combined counter unchanged. Switching back to Single tree retained 700 species and the original portrait-layout signature. Both themes and main-frame PNG export were verified. At 320x844, the panels formed one column, retained every drawable bird and produced no horizontal overflow. These are desktop viewport checks, not physical-phone CPU or memory benchmarks. Private evidence is in ignored `test-results/country-growth-browser-verification.json` and `test-results/country-growth-profile.json`.

The full suite passed **342 tests in 37 files**, with **50 affected checks** rerun after final integration. TypeScript and the final production build passed. The build took **52.49 s**, mostly artwork copying; the launcher stamp permits reuse. Main JavaScript is **511.44 kB / 164.44 kB reported gzip** and CSS **62.70 kB / 11.78 kB**. The existing 500 kB chunk advisory remains; no new dependency or worker was introduced.

## Matching animated and Arboretum cards

Animated country panels now reuse the Arboretum's card, grid, artwork, count and copy classes, including its responsive breakpoints, gaps, padding and 9px corners. All panels, including the combined collection, have equal footprints. A hidden sizing SVG retains the static preview's intrinsic minimum height; the absolute canvas slot cannot feed bitmap dimensions back into card sizing. Both gallery scrollers reserve a stable gutter. Comparison canvases use the gallery surface color in Light and Dark, including PNG export; individual-tree backgrounds retain their existing paper color.

Browser measurements at 882px width found both card types 383.234px wide with 245.953px artwork boxes. Their heights differed by only 0.015625px of line-box rounding. At 320×844, both were 275px wide with 225px artwork boxes and the same subpixel height difference. Every panel retained all of its drawable portraits, with zero packing overlaps. Narrow screens had no horizontal overflow; Light/Dark and the final growth transition were verified. Sixteen existing theme/rendering tests, TypeScript and the production build pass. Private screenshots and measurements are in `test-results/arboretum-card-match-verification.json`.

## Combined animation export

The growth view's **Export animation** prepares a fixed canvas composition containing the combined tree and every represented country, independently of page scrolling, viewport width, selected country and UI playhead. Each panel reuses the radial geometry, footprint packing, branch growth and portrait renderer. Geometry and cameras are computed once, and paths are cached per addition date. Countries retain their own first-seen chronology, including country-only addition dates. A shared artwork pool loads the required illustration tiers before encoding, and every scene releases its cache client after success, cancellation or failure. The current theme, size mode, branch-distance mode and cumulative year cutoff are captured for the file. Attribution and the limits of the decorative spacing are embedded.

Video uses the browser's supported MP4 or WebM encoder at 24 fps. Composition drawing is throttled to that rate; recording is real-time and stops with a useful error if the tab becomes hidden. GIF uses 12 fps and the pinned MIT-licensed `gifenc` 1.0.3 in a separate worker, loaded only when requested. A palette derived from the completed scene is reused across frames, avoiding palette flicker and repeated quantization. Only one transferred RGBA frame waits for worker acknowledgment at a time; raw frames are not accumulated for the whole duration. Encoded data is bounded to 128 MiB for video / 64 MiB for GIF, and the composition is bounded to 4,096 pixels per side / 12 megapixels. Worker deadlines, abort handling and track cleanup cover stalled encoders. These limits are defensive bounds, not measured phone capacity.

Durations of 15, 30 and 60 seconds proportionally scale the existing addition-weighted timeline, including a short lead and a one-second completed hold. GIF centisecond rounding is distributed across frames so 12 fps retains the requested total duration. Same-day sightings remain grouped. Exports use local artwork and observations; neither encoding path uploads the collection or changes the page's playhead.

Production-browser verification with the provided 700-species / seven-country collection produced an **800×936 GIF with 180 frames, infinite looping and exactly 15,000 ms of decoded frame delays**. The completed file contains all eight trees with counts 700, 75, 193, 7, 4, 89, 76 and 401. A 1280×826 MP4 was also downloaded and played to its completed frame with those same counts and October 25, 2026 as the date. Cancellation was verified, including hiding the abandoned preview. At 320×844 the dialog had no horizontal overflow, and every format/duration/size control was 44px tall. These are desktop browser viewport checks, not physical-phone encoding benchmarks. Private sample files are in ignored `personal/country-growth-example.{mp4,gif}`; decoded GIF evidence and browser screenshots are in ignored `test-results/animation-export-*`.

All **374 tests in 40 files** pass; the 32 export checks also passed after the final UI cleanup. TypeScript and the production build pass. Main JavaScript is **514.83 kB / 165.74 kB reported gzip**; the lazy export component is **23.45 kB / 9.04 kB**, the lazy GIF client **2.65 kB / 1.33 kB**, and the GIF worker **10.37 kB**. Export CSS is a separate 1.99 kB chunk. The build took **53.65 seconds**, primarily static artwork copying. The existing main-bundle chunk-size advisory remains.

## Playback count and Steller's jay mark

Single-tree playback now shows a prominent unique-species count immediately above the plot, outside the branch canvas. It uses the existing date membership, so it changes only when dates change, follows backward seeks and remains fixed while paused. Live announcements are disabled during playback. The small SVG brand bird is now a stylized Steller's jay with a dark crest and blue plumage, retaining the toy phylogeny and perching tip. A desktop flex minimum that could force a 360px bitmap into a shorter plot was also removed; the canvas now fits its actual available height. The existing 340px mobile plot minimum remains.

Production-browser checks with the supplied collection verified 0 → 1 → 700 species, a backward seek to 694, a running count of 4 and a paused count of 180. At completion all 700 portraits were drawable with zero packing overlaps. The count and plot occupied separate rectangles; the desktop bitmap matched the plot's height. Light/Dark and 320×844 were checked, with no horizontal overflow and a 25px mobile count. There were no browser console warnings/errors. All **42 related playback tests**, TypeScript and the final production build passed. Private evidence is in ignored `test-results/growth-counter-jay-*`.
