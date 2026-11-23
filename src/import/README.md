# Import rules

The importer is an independent implementation, not copied from Everybird. The full
export uses Submission ID, Common Name, Scientific Name, Count, and Date headers;
common or scientific name alone can identify a taxon. Header case, whitespace,
underscores, and a UTF-8 BOM are normalized. Papa Parse handles quoted commas and
multiline cells. eBird exports often omit empty optional trailing metadata cells;
these are accepted when all columns used by the importer remain present. Broken
quoting, extra cells, or omitted required fields reject the whole file.

`startImport` reads 512 KiB chunks in a dedicated Web Worker. It only publishes a
completed collection. Cancellation terminates that worker and rejects with an
`AbortError`; the calling UI retains its prior collection.

Name matching uses the bundled taxonomy and documented aliases, without fuzzy
matching. Identifiable groups follow parent species links. Hybrid, slash,
unidentified, domestic, and intergrade categories are excluded. A scientific name
that persists across a changed concept is insufficient to resolve an older common
name; legacy Willet therefore remains unresolved rather than becoming Saltmarsh
Willet silently. Current named Willets can highlight their broader 2025 source
aggregate, without assigning new divergence dates.

One species/checklist pair counts once. Repeated rows still appear in input and
record totals. A positive whole number or `X` is a presence; zero and invalid
counts are excluded. Missing submission IDs retain presence without inventing a
checklist. IDs are held transiently in worker sets and never enter the returned
collection.

Supported dates are `YYYY-MM-DD`, `YYYY/MM/DD`, and U.S. `M/D/YYYY` or `M-D-YYYY`.
Impossible dates are rejected rather than rolled into another month. Missing and
invalid dates retain the presence. `1900-01-01` means an unspecified historical
date and is excluded from precise earliest-date comparisons.

Every input row has exactly one primary disposition: accepted, excluded, or
unresolved. Warnings can overlap those dispositions. `duplicateRecords` counts
repeated species/checklist presences, including group rollups. Unresolved names
are retained with a dataset-independent `unresolved:` identifier for inspection,
and do not contribute to the UI's resolved species total.

Country-level aggregates use a recognized two-letter country code, an explicit
country name, or the country prefix of an eBird `State/Province` region code.
Conflicting or unknown country values remain in the global collection and add to
`countryUnassignedRecords`. No location or coordinate inference is used. Each
country independently retains species dates, record counts, and distinct
checklist counts; checklist identifiers remain transient. Excluded records do not
contribute to country aggregates or the unassigned-presence count.

Precise locations, coordinates, and free-text columns are ignored. Backups and
IndexedDB hold only whitelisted species/country aggregates and the reconciliation report.
Backup validation happens before replacement. Taxonomy version changes require
a fresh CSV; source-dataset changes recompute mappings from current taxa rather
than reusing stored source node numbers.

Country aggregates are optional additions to schema version 1. Old saved
collections and backups restore without inventing country data; reimporting the
CSV enables geography. New imports always include `countries` (possibly empty)
and account for retained presences without a recognized country. Backup validation
checks country codes/names, per-country membership and totals against the global
collection, while rejecting precise-location fields.
