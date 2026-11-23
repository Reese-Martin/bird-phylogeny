# Personal bird phylogeny implementation plan

Drafted November 17, 2026. The first release runs on this computer through localhost. Public hosting follows local review as a separate milestone.

## Intended result

Build a website that places a person's eBird observations on an interactive radial phylogeny of birds. The opening view shows the global tree, with the branches leading to recorded species highlighted. Users can zoom into clades, find a species, and explore their observations alongside bird stickers from the resource used by Everybird.

Use the dated tree data published with McTavish et al., *A complete and dynamic tree of birds*, and its subsequent releases. The personal component comes from mapping observations onto that tree. Preserve the source relationships, dates, and uncertainty when preparing the display. [Paper and Figure 2](https://www.pnas.org/doi/10.1073/pnas.2409658122), [AvesData](https://github.com/McTavishLab/AvesData)

## Working decisions

These are proposed implementation defaults and can be revised during local review.

| Decision | Initial implementation |
| --- | --- |
| Delivery | A locally served browser app with a production build that can later be hosted as static files |
| First screen | A full-circle global tree and clearly identified sample observations, with an import control |
| Personal data input | The full `MyEBirdData.csv` export, selected or dropped into the page |
| Data processing | Browser parsing and aggregation of personal observations |
| Tree source | Start by evaluating Aves 1.7 in Clements 2025 taxonomy, pinned to a source commit |
| Current taxonomy | Prepare a versioned crosswalk to eBird/Clements 2026, with explicit handling of changed concepts |
| Artwork | Locally served WebP stickers derived from huashu-bird-sticker, initially using Everybird's resized assets |
| Personal storage | Keep an import in memory for the session. Provide an explicit option to save the normalized collection on this device |
| Presentation | Muted global branches, highlighted observed ancestry, labels and stickers appearing with zoom |
| Sharing | Download a credited PNG of the current view in the local release |
| Public release | Review the working local version before choosing a host and publishing |

## Local release scope

- Full radial tree with approximate divergence-time rings and a visible source-version label.
- Pan, wheel or pinch zoom, zoom buttons, reset, and clade focus with a route back to the whole tree.
- Search by common or scientific name, with selection moving the view to the relevant species.
- eBird export import with progress, cancellation, validation, and a readable reconciliation report.
- Highlight the union of branches connecting recorded species to the root.
- Species cards with a sticker, names, earliest recorded date, and number of distinct checklists containing the species.
- A keyboard-accessible species list that supports the same selection actions as the tree.
- Local save, clear, and restore of a normalized collection through browser storage and a versioned backup file.
- A credited PNG export, source information, and a concise explanation of approximate dates and taxonomic placements.

After the core local experience works, consider the quick eBird life-list export, date and region filters, a pruned personal-tree view, and a large print export. Account sync, public collection links, additional observation platforms, and analytical diversity scores can be evaluated during later planning.

## Data sources and reuse

### Published tree

The Aves 1.7 Clements 2025 summary NEXUS file was verified during feasibility review and declares 11,167 tips. Download it and its associated taxonomy and citation files from a pinned revision. Record the source URL, commit, hash, retrieval date, tree version, taxonomy year, and license in a manifest. Recheck the release documentation during implementation before selecting the final pinned revision. [Verified summary tree](https://raw.githubusercontent.com/McTavishLab/AvesData/main/Tree_versions/Aves_1.7/Clements2025/summary_dated_clements.nex)

AvesData identifies `summary_dated_clements.nex` as its complete dated summary and provides other tree samples and supporting metadata. Its README declares CC BY 4.0 and reports a calibration problem in version 1.6 affecting the root and some deep dates. Check the chosen release's date calibration and preserve the manifest with every generated dataset. Keep age labels approximate. [Dataset documentation and license](https://github.com/McTavishLab/AvesData)

Use the authors' R package `clootl` and established tree-reading tools during data preparation. Convert the selected tree to compact JSON for the browser. Runtime navigation should use the prepared local data. [clootl](https://github.com/eliotmiller/clootl)

### eBird observations and taxonomy

Provide instructions linking users to My eBird's Download My Data page. Build the first importer around the full CSV export. A ZIP containing that CSV can be supported if sample exports show it is needed for a smooth workflow. Cornell describes the public API as providing limited recent and summary outputs, so collection updates initially happen by importing a fresh export. [eBird download instructions](https://support.ebird.org/en/support/solutions/articles/48000838205-download-ebird-data)

The full export contains scientific and common names, submission IDs, dates, and location fields. The reviewed format has no species-code, category, or countable column. Resolve names through the appropriate taxonomy table before assigning internal species identifiers. Treat taxonomic order as specific to its taxonomy release. [Everybird's export fixture](https://github.com/yusuftaleb/everybird/blob/11ebea195dd2c353f82d3236895f46f08bf42efd/tests/fixtures/ebird/mydata-basic.csv)

Bundle the eBird taxonomy needed to resolve reportable categories and parent species, together with the Clements concept identifiers and documented annual changes. Avibase Taxon Concept IDs are the preferred cross-release identifiers. Cornell notes that eBird species codes and names can persist while their biological circumscription changes. [Clements 2026 fields and identifiers](https://www.birds.cornell.edu/clementschecklist/introduction/updateindex/october-2026/)

### Stickers and existing implementation

Everybird publishes transparent WebP images at 128 px and 384 px, indexed by eBird species code. Start with these display sizes, with larger source artwork considered for a later print export. Download a pinned asset revision and serve the files locally. Include source attribution, license links, and an indication of resizing in the interface and exported images. [Everybird stickers](https://github.com/yusuftaleb/everybird-stickers), [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)

The original huashu dataset includes AI-generated artwork, eBird and Avibase identifiers, and image review metadata. Display an AI illustration disclosure and preserve the quality information where available. A missing or questionable image uses a consistent fallback marker. Image availability must have its own status, independent of whether a species maps to the tree. [Original sticker resource](https://github.com/alchaincyf/huashu-bird-sticker)

Review Everybird's MIT-licensed parsers, taxon resolver, and fixtures for reusable logic. Preserve license notices for copied code and inspect the behavior before adapting it. [Everybird source](https://github.com/yusuftaleb/everybird)

## Taxonomy matching and observation rules

Complete this work before treating personal totals as reliable.

1. Normalize CSV headers, whitespace, UTF-8 BOM, scientific-name formatting, and supported dates. Keep quoted commas and multiline cells intact through a CSV parser.
2. Resolve each original reported taxon against a versioned eBird taxonomy. Preserve its original name and the mapping result. Use documented aliases for older exports and report ambiguous matches.
3. Roll identifiable subspecies and groups into their parent species using taxonomy relationships such as `reportAs` where applicable. Deduplicate the resulting species.
4. Record hybrids, slash identifications, unidentified birds, domestic forms, and unresolved records in the import report with a reason for their treatment.
5. Match the resolved species concept to a source-tree tip through the crosswalk. Distinguish exact concept matches, documented changes of name, broader or narrower concepts, and unresolved relationships.
6. For changed concepts, retain the current observed species and explain the source tree's coverage. A species whose exact placement is unavailable remains visible in the collection report. A broader source tip can show an explicitly labeled aggregate without assigning a new divergence date to its descendant species.
7. Aggregate one presence per species and distinct submission ID. Preserve the earliest valid observation date and separately count records with missing dates. Treat `X` as a reported presence and support zero-count rows through an explicit exclusion rule.
8. Replacing the full export recomputes the collection from that file. Reimporting the same file produces the same species and checklist totals. Publish the completed result atomically so cancellation or a failed parse preserves the prior collection.

Willet is a required regression example. The 2025 *Tringa semipalmata* tip represents the broader pre-split species. In 2026, that scientific name refers to Saltmarsh Willet and Prairie Willet is *Tringa inornata*. Test the name that persists, the newly recognized species, and an older unresolved observation. [Documented 2026 split](https://www.birds.cornell.edu/clementschecklist/updates-and-corrections-october-2026/)

Label the initial total as species recorded in the export. The full CSV does not supply all information needed to reproduce eBird's official life-list eligibility rules, including location-dependent exotic status. If exact life-list agreement becomes a requirement, use the quick life-list export's eligibility information in an additional import path and document how it reconciles with observation records. Keep earliest recorded dates distinct from eBird's eligibility-based first-record dates. [eBird exotic and counting rules](https://support.ebird.org/en/support/solutions/articles/48001218430-exotic-and-introduced-species-in-ebird)

List-building checklists can use January 1, 1900 as a placeholder. Display this as an unspecified historical date in affected records and exclude it from precise timeline claims. [eBird historical life-list instructions](https://support.ebird.org/en/support/solutions/articles/48000804866-enter-your-pre-ebird-life-list)

## Technical design

| Layer | Proposed implementation and purpose |
| --- | --- |
| App | React, TypeScript, and Vite for the interface, local development server, and static production output |
| Tree display | Canvas 2D for branches and visible stickers, with a small HTML or SVG label layer |
| Interaction | D3 zoom and geometry helpers, plus a spatial index for pointer selection |
| Import | Papa Parse in a Web Worker for streaming, cancellation, and progress |
| Source preparation | Node scripts for pinned downloads and crosswalk preparation, with R and `ape` / `clootl` for tree parsing and metadata extraction |
| Saved collection | Versioned IndexedDB records and a downloadable normalized JSON backup |
| Verification | Focused parser and crosswalk regression tests, tree invariants, and browser workflow checks |

Lock package versions when scaffolding the app and document the required Node and R versions. Commit generated public data and its manifest so ordinary local startup needs only Node and the prepared assets. Source regeneration is a separate maintainer workflow. [Vite documentation](https://vite.dev/guide/), [D3 zoom](https://d3js.org/d3-zoom), [Papa Parse documentation](https://www.papaparse.com/docs)

### Prepared data model

- **Source manifest** holds release versions, hashes, license information, citations, and build schema version.
- **Tree nodes** hold a dataset-scoped node ID, parent and children, branch length, cumulative root distance, leaf interval, and source references where available.
- **Taxon records** hold taxonomy version, eBird code, concept ID, names, category, parent species, family, and order.
- **Crosswalk records** hold source and target concept IDs, the relationship between them, mapping evidence, and review status.
- **Species assets** hold a sticker path, asset revision, image dimensions, credit, and quality status.
- **Observation aggregates** hold the resolved species, tree mapping status, earliest date, distinct checklist count, and optional coarse region summaries.
- **Import reports** hold input counts, matched and ambiguous records, exclusions, tree gaps, artwork gaps, and parsing errors.

Keep node IDs scoped to the tree release. Store personal collections against versioned taxon identifiers and recompute their tree mapping when datasets change. Node numbers can change between releases.

### Radial layout and navigation

Use a deterministic leaf order and angles. Derive radial distances from the dated tree's branch lengths. Preserve the root, branching order, and distances when converting the source tree. Keep branch direction consistent with the time rings.

At the overview scale, show selected major clade labels and counts while suppressing crowded species labels and stickers. As users zoom, reveal labels and images according to available screen space. Apply collision detection, cache decoded images, cap the image cache, and load only visible assets. Keep the global layout stable during selection and highlighting.

Compute highlighted ancestry by walking from matched tips to the root and combining those paths. Cache the result for the current collection. Expose a legend distinguishing recorded species, background diversity, and unresolved source coverage.

Fit a selected clade into the viewport and show its ancestor trail. Verify named family or order membership against the source topology before treating it as a single clade. If membership spans multiple clades, preserve those relationships and label the result accurately.

Carry source provenance into the interface only where it can be mapped reliably to the displayed tree. Preserve unavailable support as unknown. Any later pruned view must retain ancestry and sum branch lengths when suppressing nodes with a single surviving child. Any clade refitting must update the displayed time scale.

Provide keyboard search, next and previous species navigation, visible focus, zoom buttons, and reduced-motion behavior. Species names, records, and source status must remain accessible through the list and detail panel.

### Privacy and persistence

Serve tree data, artwork, fonts, and scripts from the local app. Perform file parsing in the browser. Avoid recording raw CSV contents in logs. Read only the columns required for the collection and requested summaries.

The initial collection stores species aggregates. Exact coordinates, location names, free-text comments, and checklist IDs stay out of saved collections and image exports. Submission IDs can be used transiently for deduplication. If checklist links become a requested feature, revise that storage decision explicitly.

Saving on this device is an explicit action. Include a clear-collection action, storage-failure feedback, and a versioned backup and restore flow. Validate a backup before replacing an existing collection. Track the source taxonomy and app-data schema so upgrades can migrate or request a fresh import.

## Repository layout

```text
data/
  sources.lock.json
  crosswalk-overrides.csv
  raw/                         # ignored downloaded sources
scripts/
  fetch-sources.ts
  prepare-tree.R
  build-data.ts
src/
  components/
  tree/
  taxonomy/
  import/
  storage/
  workers/
public/
  data/                        # prepared tree, taxa, crosswalk, manifest
  stickers/                    # pinned local artwork
  demo/                        # clearly identified sample observations
tests/
  fixtures/                    # synthetic or deliberately redacted inputs
plan.md
README.md
```

Keep personal exports in a git-ignored working directory or select them directly from the browser. The public demo uses invented observation history mapped to the actual published tree.

## Implementation sequence

### Milestone 1 — Source preparation and first local tree

- Scaffold the app and define localhost startup scripts.
- Fetch pinned tree, taxonomy, and sticker metadata sources and generate the manifest.
- Parse the source tree, validate its structure and dates, and export browser data.
- Generate a crosswalk coverage report for the selected releases.
- Render the real full radial tree at localhost with a small sample collection highlighted.
- Add zoom, reset, search, basic species cards, and locally served sample stickers.

**Completion condition** — The user can open the app on this computer, explore the published tree, select a sample species, and inspect its source information. The report identifies all source-species and artwork gaps.

### Milestone 2 — Personal checklist import

- Build the CSV worker, header validation, progress, cancellation, and error recovery.
- Implement taxonomy resolution, group rollup, crosswalk statuses, and deduplication.
- Highlight the imported collection and populate real species cards.
- Show the reconciliation report and make unresolved species inspectable.
- Add explicit local save, clear, backup, and restore.

**Completion condition** — A user-provided export produces a usable personal tree, repeated imports agree, and every input record is accounted for. Work with synthetic fixtures until a personal export is available.

### Milestone 3 — Local review and polish

- Refine label density, clade navigation, stickers, and mobile-sized layouts.
- Add the accessible species list, keyboard navigation, and reduced-motion behavior.
- Add PNG download with credits, tree version, and a scale matching the exported view.
- Verify import, navigation, storage, and export in the actual local browser.
- Build the production bundle and verify it through a localhost preview server.
- Record observed performance and resolve issues found during local review.

**Completion condition** — The development and production-preview versions both work locally, and the user can evaluate their own collection before public hosting is considered.

### Milestone 4 — Public availability after local review

- Confirm the requested public feature set and choose a static host, such as Cloudflare Pages, GitHub Pages, or Netlify.
- Check the selected host's current limits and costs against the measured asset size and expected traffic.
- Publish the same prepared data and client-side import flow, using HTTPS and appropriate asset caching.
- Verify asset paths, deep links if introduced, mobile behavior, credits, and production import/export.
- Provide a public URL and retain the localhost development workflow.

**Completion condition** — After the user requests publication, the deployed URL supports the reviewed workflow. Public collection links or account sync require their own design for the data users choose to share.

## Local startup contract

The following commands describe the scripts to implement. They become runnable after the app is scaffolded.

```powershell
npm ci
npm run dev -- --host 127.0.0.1 --port 5173 --strictPort
```

Open `http://127.0.0.1:5173`. Bind the development server to loopback for the first review. On a port conflict, explain the conflict and use a known available port. Provide a short README covering prerequisites, launch, stop, import, and source regeneration.

Check the production bundle locally with the following commands.

```powershell
npm run build
npm run preview -- --host 127.0.0.1 --port 4173 --strictPort
```

Open `http://127.0.0.1:4173`. A later phone review over the local network can use an explicit network binding once requested.

## Validation and acceptance

Use focused automated checks for the parts where an incorrect result would be hard to notice visually.

| Area | Acceptance check |
| --- | --- |
| Tree conversion | Tip count agrees with the pinned source. Every non-root node has a valid parent, the tree is connected and acyclic, names map unambiguously, and branch lengths and root-to-tip distances agree within documented numerical tolerance |
| Dates | Parent and child ages are consistent, time rings match radial distances, and any source anomalies are reported for review |
| Taxonomy | Fixtures cover an exact concept, a rename, a group rollup, a split retaining the old name, a lump, a hybrid, and an unmatched species |
| Import | Quoted and multiline cells, BOM, missing columns, invalid dates, repeated rows, placeholder dates, and cancellation behave predictably |
| Reconciliation | Every record has a disposition. Distinct collection species, mapped species, source-tip aggregates, and excluded records have clearly defined counts |
| Counting | Duplicate observations of one species on one checklist count once. Zero and `X` counts follow the stated rule. Reimporting an export is deterministic |
| Storage | Save, clear, restore, invalid backup, and dataset-version changes preserve consistent state |
| Artwork | Missing or failed images use a fallback. Visible images resolve to the intended versioned species mapping |
| Interaction | Pointer, touch, keyboard, search, clade focus, reset, and list selection select the same underlying taxa |
| Export | The PNG matches the chosen view, includes credits and versions, and contains the requested species presentation |
| Privacy | Personal import and navigation create no requests carrying observation data. Raw files and personal data are absent from the production bundle |
| Local delivery | A clean dependency install and prepared assets launch successfully. Both localhost entry points complete the import-to-export workflow |

Profile the full source tree and synthetic collections of approximately 100, 1,000, and 5,000 recorded species. Use a large CSV fixture to test streaming independently of species count. Record hardware, browser, input size, import time, initial render time, and navigation responsiveness. Initial targets are a usable demo within three seconds after local assets are available and at least 30 frames per second during ordinary desktop navigation. Refine these targets using actual measurements.

## Decisions to revisit during local review

| Decision | Proposed starting point | Evidence needed |
| --- | --- | --- |
| Source taxonomy alignment | Preserve the pinned tree and explicitly report changed species concepts | Coverage report and the user's export |
| Reusing Everybird | Adapt useful parser and resolver modules with attribution | Review of dependencies and behavior |
| Default emphasis | Whole-tree context with observed ancestry highlighted | Feedback on readability and navigation |
| Persistent data | Explicitly save normalized aggregates on this device | User preference after trying import |
| Additional views | Add date/region filters and a pruned view after the core review | Which exploration tasks users actually perform |
| Public hosting | Static delivery using the same browser processing | Working local build, measured asset size, and a request to publish |

The first implementation task is Milestone 1. Its deliverables are the locally navigable published tree, pinned data manifest, sample sticker integration, and taxonomy coverage report.
