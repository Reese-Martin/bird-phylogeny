# Dataset coverage

Tree: Aves 1.7 · Clements 2025 (11,167 tips).

eBird v2026: 18,631 reportable taxa, 11,201 species.

| Mapping | Species |
| --- | ---: |
| exact | 10928 |
| renamed | 193 |
| broader | 70 |
| narrower | 4 |
| unresolved | 6 |

11195 current species map to 11164 distinct source tips. 6 current-species concepts remain visible but unmapped. 3 source-species tips lack a current mapping.

Artwork: 11027 species bundled at 128 and 384 px. All 174 local artwork gaps and source species gaps are enumerated in [coverage.json](../public/data/coverage.json).

- The official eBird v2026 reference taxonomy is complete for reportable categories; subspecies not reportable in eBird are not invented.
- All 11,201 current species are audited against the user-supplied official 2026 Clements integrated workbook. Persistent concept IDs determine exact identities independently of artwork metadata; every crosswalk entry cites its official worksheet row.
- The phylogeny remains the pinned Clements 2025 tree. Reviewed 2026 changes use honest source-tip containment or aggregates, without invented splits or dates. Newly ratified species and concepts that partly overlap older source species remain explicitly unresolved.
- All appropriate images available for the current eBird taxonomy at the pinned sticker revision are bundled locally at 128 and 384 px. Species without a safely mapped source illustration retain a fallback independent of tree placement.

Branch lengths are unchanged. Root-to-tip spread: 0.00001100000000064938 Ma, retained source rounding. Source age intervals and posteriors remain attached to dataset-scoped nodes.
