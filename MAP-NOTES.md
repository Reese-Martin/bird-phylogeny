# Country map

The world map is served locally from [`public/data/world-countries.json`](public/data/world-countries.json). It is prepared from the **Natural Earth 1:110m Admin 0 countries** dataset at maintainer revision [`ca96624a56bd078437bca8184e78163e5039ad19`](https://github.com/nvkelso/natural-earth-vector/tree/ca96624a56bd078437bca8184e78163e5039ad19). Natural Earth data is [public domain](https://www.naturalearthdata.com/about/terms-of-use/).

Run `node scripts/fetch-map.mjs` to reproduce the compact outline file. The script verifies the exact pinned GeoJSON SHA-256, retains an ignored raw copy, projects the country rings, and writes source/output hashes to [`data/map-source.json`](data/map-source.json). There are 177 outlines, with 175 source ISO2 identifiers.

The SVG uses an equirectangular world projection. Rings crossing the antimeridian are unwrapped, copied and clipped at ±180° before projection. Holes use SVG even-odd filling; Antarctica retains its polar boundary. Coordinates are rounded to 0.01 SVG pixels for a compact display asset. No mapping service, remote tile, or runtime geocoding is used.

Country identifiers use `ISO_A2_EH` before `ISO_A2`. This preserves France and Norway, whose ordinary ISO_A2 values are `-99` in the pinned source. Kosovo uses the source's `XK`. Northern Cyprus and Somaliland have no source ISO2 value and are not silently assigned to another country. Generalized outlines omit some smaller countries and territories; every country supplied by the observation importer remains selectable through the searchable list, and missing outlines are explicitly marked there.

Shading reflects each country's count of resolved recorded species. A species recorded in multiple countries contributes once to each country's total; the all-country summary deduplicates across countries. Selecting a country calls the app's country filter, which constructs the tree from those aggregates. The map receives no coordinates, location names or checklist identifiers.

Available countries are focusable SVG buttons supporting Enter/Space. The country list, search, all-country control and map zoom/reset controls provide keyboard alternatives; map pan/pinch uses the existing D3 zoom dependency. Older collections lacking country aggregates are prompted to reimport their full export.
