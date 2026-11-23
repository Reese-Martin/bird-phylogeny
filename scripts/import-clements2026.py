"""Read-only extraction of the user-supplied official eBird/Clements workbook.

The original workbook is preserved byte-for-byte; no cells, formulas, styles,
macros, links or workbook properties are executed or changed. Run with the
bundled Python runtime (openpyxl is required):

  python scripts/import-clements2026.py [path-to-original.xlsx]

With no argument, regeneration uses the pinned copy under ignored data/raw/.
The JSON keeps all categories, source rows, change/range notes and the species
hierarchy so a later crosswalk can explicitly review splits/lumps/overlaps.
"""

from __future__ import annotations

import argparse
from collections import Counter
import hashlib
import json
from pathlib import Path
import re
import shutil

import openpyxl


ROOT = Path(__file__).resolve().parents[1]
PINNED_SHA256 = "69c5e6dc79989a604930d314e51fb13d777369511c265347b067807c780714af"
PINNED_PATH = ROOT / "data/raw/clements2026-integrated.xlsx"
OUTPUT_PATH = ROOT / "data/raw/clements2026-integrated.json"
MANIFEST_PATH = ROOT / "data/clements2026-source.json"
DOWNLOAD_URL = "https://www.birds.cornell.edu/clementschecklist/wp-content/uploads/2026/11/eBird-Clements_v2026_integrated-checklist-October-2026.xlsx"
SOURCE_SHEET = "eBird-Clements v2026"
EXPECTED_HEADERS = [
    "sort v2026", "species_code", "taxon concept ID", "Clements v2026 change",
    "text for website v2026", "category", "English name", "scientific name",
    "authority", "name and authority", "range", "order", "family", "extinct",
    "extinct year", "sort_v2025", "range revision 2026", "range revision details_2026",
]
FIELDS = [
    "sort2026", "code", "conceptId", "changes", "changeText", "category",
    "commonName", "scientificName", "authority", "nameAndAuthority", "range",
    "order", "family", "extinct", "extinctYear", "sort2025", "rangeRevision",
    "rangeRevisionDetails",
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def clean(value):
    if isinstance(value, str):
        return value.strip() or None
    return value


def write_json(path: Path, value) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_text(json.dumps(value, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    temporary.replace(path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", nargs="?", type=Path, default=PINNED_PATH)
    args = parser.parse_args()
    supplied = args.workbook.resolve()
    if digest(supplied) != PINNED_SHA256:
        raise ValueError("Workbook differs from the pinned supplied 2026 release; review a new source revision explicitly.")
    PINNED_PATH.parent.mkdir(parents=True, exist_ok=True)
    if supplied != PINNED_PATH.resolve():
        shutil.copyfile(supplied, PINNED_PATH)
    assert digest(PINNED_PATH) == PINNED_SHA256

    workbook = openpyxl.load_workbook(PINNED_PATH, read_only=True, data_only=False, keep_links=False)
    cached_workbook = openpyxl.load_workbook(PINNED_PATH, read_only=True, data_only=True, keep_links=False)
    if workbook.sheetnames != [SOURCE_SHEET]:
        raise ValueError(f"Unexpected source sheets: {workbook.sheetnames}")
    sheet = workbook[SOURCE_SHEET]
    iterator = sheet.iter_rows(values_only=False)
    cached_iterator = cached_workbook[SOURCE_SHEET].iter_rows(min_row=2, values_only=True)
    headers = [cell.value for cell in next(iterator)]
    if headers != EXPECTED_HEADERS:
        raise ValueError(f"Unexpected 2026 workbook columns: {headers}")

    rows = []
    formulas = 0
    parent = None
    categories = Counter()
    for source_row, (cells, cached_values) in enumerate(zip(iterator, cached_iterator, strict=True), start=2):
        formula_cells = [(index, cell.value) for index, cell in enumerate(cells) if cell.data_type == "f"]
        formulas += len(formula_cells)
        if any(index != 9 or formula != f'=CONCATENATE(H{source_row}," ",I{source_row})' for index, formula in formula_cells):
            raise ValueError(f"Unexpected formula at source row {source_row}; no source formulas are executed.")
        if formula_cells:
            expected = f'{cells[7].value or ""} {cells[8].value or ""}'
            if cached_values[9] != expected:
                raise ValueError(f"Source name/authority formula cache does not agree with its direct input cells at row {source_row}")
        values = [clean(cached_values[index] if cell.data_type == "f" else cell.value) for index, cell in enumerate(cells)]
        if not any(value is not None for value in values):
            continue
        record = {"sourceRow": source_row, **dict(zip(FIELDS, values))}
        record["nameAndAuthorityFormula"] = formula_cells[0][1] if formula_cells else None
        family = record["family"]
        record["familySciName"] = family.split(" (")[0].strip() if isinstance(family, str) else None
        category = record["category"]
        if category:
            categories[category] += 1
        if category == "family":
            parent = None
        if category == "species":
            parent = record
        is_child = category == "subspecies" or (isinstance(category, str) and category.startswith("group ("))
        record["parentSpeciesCode"] = parent["code"] if parent and is_child else None
        record["parentSpeciesConceptId"] = parent["conceptId"] if parent and is_child else None
        rows.append(record)
    dimensions = {"rows": sheet.max_row, "columns": sheet.max_column}
    workbook.close()
    cached_workbook.close()

    species = [row for row in rows if row["category"] == "species"]
    if len(species) != 11201:
        raise ValueError(f"Expected 11,201 2026 species, received {len(species)}")
    codes = [row["code"] for row in species]
    concepts = [row["conceptId"] for row in species]
    if len(set(codes)) != len(codes) or not all(codes):
        raise ValueError("Species codes are missing or duplicated")
    if len(set(concepts)) != len(concepts) or not all(re.fullmatch(r"avibase-[A-Fa-f0-9]{8}", value or "") for value in concepts):
        raise ValueError("Species concept IDs are invalid or duplicated")
    api = json.loads((ROOT / "data/raw/ebird2026.json").read_text(encoding="utf-8"))
    reportable = [row for row in rows if row["category"] not in [None, "family", "subspecies"]]
    if len({row["code"] for row in reportable}) != len(reportable):
        raise ValueError("Reportable taxon codes are missing or duplicated")
    api_by_code = {row["speciesCode"]: row for row in api}
    if {row["code"] for row in reportable} != set(api_by_code):
        raise ValueError("Workbook reportable codes do not cover the pinned official eBird 2026 API exactly")
    for row in reportable:
        category = "issf" if row["category"].startswith("group (") else row["category"]
        if category != api_by_code[row["code"]]["category"]:
            raise ValueError(f"Reportable category disagreement for {row['code']}")
    api_species = {row["speciesCode"]: row for row in api if row["category"] == "species"}
    if set(codes) != set(api_species):
        raise ValueError("Workbook species codes do not cover the pinned official eBird 2026 API species exactly")
    mismatches = []
    for row in species:
        official = api_species[row["code"]]
        differences = {field: [row[field], official[api_field]] for field, api_field in [("scientificName", "sciName"), ("commonName", "comName"), ("order", "order"), ("familySciName", "familySciName")] if row[field] != official[api_field]}
        if differences:
            mismatches.append({"code": row["code"], "sourceRow": row["sourceRow"], "differences": differences})
    summary = {
        "physicalDimensions": dimensions, "nonemptyRowsAfterHeader": len(rows),
        "categoryCounts": dict(sorted(categories.items())), "species": len(species),
        "uniqueSpeciesCodes": len(set(codes)), "uniqueSpeciesConceptIds": len(set(concepts)),
        "formulaCells": formulas, "formulaPolicy": "Only exact name-and-authority CONCATENATE formulas accepted; caches independently checked against H/I input cells; no formulas executed", "apiSpecies": len(api_species),
        "apiReportableTaxa": len(api), "apiReportableCodeAndCategoryCoverageExact": True,
        "apiSpeciesCodeCoverageExact": True, "apiFieldMismatches": mismatches,
        "childRowsWithoutSpeciesParent": sum(bool(row["category"] == "subspecies" or (isinstance(row["category"], str) and row["category"].startswith("group ("))) and not row["parentSpeciesCode"] for row in rows),
    }
    output = {"version": 1, "taxonomyVersion": "2026", "sheet": SOURCE_SHEET, "headers": headers, "rows": rows, "summary": summary}
    write_json(OUTPUT_PATH, output)
    manifest = {
        "version": 1, "taxonomyVersion": "2026", "authority": "Cornell Lab of Ornithology, eBird/Clements",
        "acquisition": "User supplied the official 2026 integrated checklist workbook; original bytes retained unchanged.",
        "source": {"path": "data/raw/clements2026-integrated.xlsx", "originalFilename": "eBird-Clements_v2026_integrated-checklist-October-2026.xlsx", "sha256": PINNED_SHA256, "bytes": PINNED_PATH.stat().st_size, "url": DOWNLOAD_URL, "downloadPage": "https://www.birds.cornell.edu/clementschecklist/download/"},
        "sheet": SOURCE_SHEET, "headerRow": 1, "sourceRows": len(rows), "headers": headers,
        "extractor": {"path": "scripts/import-clements2026.py", "sha256": digest(Path(__file__)), "library": "openpyxl", "libraryVersion": openpyxl.__version__, "mode": "read_only=True,keep_links=False; raw/cached values checked; only internal CONCATENATE(Hrow,space,Irow) formulas accepted, never executed"},
        "output": {"path": "data/raw/clements2026-integrated.json", "sha256": digest(OUTPUT_PATH), "bytes": OUTPUT_PATH.stat().st_size},
        "summary": summary,
    }
    write_json(MANIFEST_PATH, manifest)
    print(json.dumps({"workbookSha256": PINNED_SHA256, **summary}, ensure_ascii=False))
    wanted = {"brnowl", "bulori", "carcro1", "purswa6", "rudduc", "yebmag"}
    print(json.dumps([{key: row[key] for key in ["sourceRow", "code", "commonName", "scientificName", "conceptId", "changes", "changeText"]} for row in species if row["code"] in wanted], ensure_ascii=False))


if __name__ == "__main__":
    main()
