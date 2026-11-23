import assert from 'node:assert/strict';

export interface OfficialTaxonRow {
  sourceRow: number;
  sort2026?: number | string | null;
  sort2025?: number | string | null;
  category: string | null;
  code: string | null;
  conceptId: string | null;
  commonName: string | null;
  scientificName: string | null;
  order?: string | null;
  family?: string | null;
  familySciName?: string | null;
  changes?: string | null;
  changeText?: string | null;
  parentSpeciesCode?: string | null;
  parentSpeciesConceptId?: string | null;
}
export interface OfficialTaxonomy {
  version: number;
  taxonomyVersion: string;
  sheet: string;
  rows: OfficialTaxonRow[];
}
export interface CurrentTaxon {
  speciesCode: string;
  sciName: string;
  comName: string;
  category: string;
  order?: string;
  familySciName?: string;
}
export interface SourceTaxon extends Record<string, string> {
  TAXON_ORDER: string;
  TAXON_CONCEPT_ID: string;
  SPECIES_CODE: string;
  SCI_NAME: string;
  PRIMARY_COM_NAME: string;
}
export interface CrosswalkOverride extends Record<string, string> {
  targetScientificName: string;
  sourceScientificNames: string;
  status: string;
  evidence: string;
  reviewStatus: string;
}
export type CrosswalkStatus = 'exact' | 'renamed' | 'broader' | 'narrower' | 'unresolved';
export interface OfficialMapping {
  targetConceptId: string;
  officialRow: OfficialTaxonRow;
  sourceRecords: SourceTaxon[];
  status: CrosswalkStatus;
  evidence: string;
  reviewStatus: string;
  mappingNote: string;
  aliases: string[];
  method: 'official-concept-id' | 'reviewed-change' | 'unresolved';
  previousSourceConceptIds: string[];
  previousSourceRows: number[];
  candidateSourceRecords: SourceTaxon[];
  officialEvidenceRows: number[];
}

const conceptId = (value: string | null | undefined) => typeof value === 'string' && /^avibase-[0-9A-F]{8}$/i.test(value);
const oldOrder = (row: OfficialTaxonRow) => row.sort2025 === null || row.sort2025 === undefined || row.sort2025 === '' ? null : Number(row.sort2025);

/** These two Cornell inputs must agree before any placement can be generated. */
export function officialSpeciesIndex(official: OfficialTaxonomy, current: CurrentTaxon[]) {
  assert.equal(official.taxonomyVersion, '2026', 'Official concept workbook must be v2026');
  const byCode = new Map<string, OfficialTaxonRow>();
  const byConcept = new Map<string, OfficialTaxonRow>();
  for (const row of official.rows) {
    if (row.category !== 'species') continue;
    assert.ok(row.code && row.scientificName && row.commonName && conceptId(row.conceptId), `Incomplete official species at worksheet row ${row.sourceRow}`);
    assert.ok(!byCode.has(row.code), `Duplicate official species code: ${row.code}`);
    assert.ok(!byConcept.has(row.conceptId!), `Duplicate official species concept: ${row.conceptId}`);
    byCode.set(row.code, row); byConcept.set(row.conceptId!, row);
  }
  const species = current.filter(taxon => taxon.category === 'species');
  assert.equal(byCode.size, species.length, 'Official workbook and eBird API species counts differ');
  for (const taxon of species) {
    const row = byCode.get(taxon.speciesCode);
    assert.ok(row, `Species absent from official workbook: ${taxon.speciesCode}`);
    assert.equal(row.scientificName, taxon.sciName, `Workbook/API scientific-name disagreement: ${taxon.speciesCode}`);
    assert.equal(row.commonName, taxon.comName, `Workbook/API common-name disagreement: ${taxon.speciesCode}`);
    if (taxon.order) assert.equal(row.order, taxon.order, `Workbook/API order disagreement: ${taxon.speciesCode}`);
    if (taxon.familySciName) assert.equal(row.familySciName, taxon.familySciName, `Workbook/API family disagreement: ${taxon.speciesCode}`);
  }
  return byCode;
}

/** Species identities come from the official Clements concept column, never from artwork metadata. */
export function buildOfficialCrosswalk(current: CurrentTaxon[], source: SourceTaxon[], official: OfficialTaxonomy, overrides: CrosswalkOverride[]) {
  const officialByCode = officialSpeciesIndex(official, current);
  const sourceByConcept = new Map<string, SourceTaxon>();
  const sourceByName = new Map<string, SourceTaxon>();
  for (const row of source) {
    assert.ok(conceptId(row.TAXON_CONCEPT_ID), `Invalid source species concept: ${row.SCI_NAME}`);
    assert.ok(!sourceByConcept.has(row.TAXON_CONCEPT_ID), `Duplicate source species concept: ${row.TAXON_CONCEPT_ID}`);
    assert.ok(!sourceByName.has(row.SCI_NAME), `Duplicate source species name: ${row.SCI_NAME}`);
    sourceByConcept.set(row.TAXON_CONCEPT_ID, row); sourceByName.set(row.SCI_NAME, row);
  }
  const oldSpecies = [...source].sort((a, b) => Number(a.TAXON_ORDER) - Number(b.TAXON_ORDER));
  for (let index = 0; index < oldSpecies.length; index++) {
    assert.ok(Number.isFinite(Number(oldSpecies[index].TAXON_ORDER)), 'Non-numeric source taxonomy order');
    if (index) assert.ok(Number(oldSpecies[index - 1].TAXON_ORDER) < Number(oldSpecies[index].TAXON_ORDER), 'Duplicate source species order');
  }
  // This retained workbook column indexes the complete 2025 integrated list,
  // including its subspecies. Validate its meaning against every direct concept
  // match before using species intervals as annual-change evidence.
  for (const row of officialByCode.values()) {
    const exact = sourceByConcept.get(row.conceptId!);
    if (exact) assert.equal(oldOrder(row), Number(exact.TAXON_ORDER), `Previous-sort alignment changed: ${row.code}`);
  }
  const previousParent = (row: OfficialTaxonRow) => {
    const value = oldOrder(row);
    if (value === null) return undefined;
    assert.ok(Number.isFinite(value), `Non-numeric previous order at worksheet row ${row.sourceRow}`);
    let left = 0, right = oldSpecies.length;
    while (left < right) {
      const mid = Math.floor((left + right) / 2);
      if (Number(oldSpecies[mid].TAXON_ORDER) <= value) left = mid + 1;
      else right = mid;
    }
    return left ? oldSpecies[left - 1] : undefined;
  };
  const childrenByCode = new Map<string, OfficialTaxonRow[]>();
  for (const row of official.rows) {
    if (!row.parentSpeciesCode) continue;
    assert.ok(officialByCode.has(row.parentSpeciesCode), `Unknown official parent: ${row.parentSpeciesCode}`);
    const children = childrenByCode.get(row.parentSpeciesCode) || [];
    children.push(row); childrenByCode.set(row.parentSpeciesCode, children);
  }
  const overridesByName = new Map(overrides.map(row => [row.targetScientificName, row]));
  assert.equal(overridesByName.size, overrides.length, 'Duplicate reviewed taxonomic overrides');
  const mappings = new Map<string, OfficialMapping>();
  for (const taxon of current.filter(row => row.category === 'species')) {
    const row = officialByCode.get(taxon.speciesCode)!;
    const exact = sourceByConcept.get(row.conceptId!);
    const lineageRows = [row, ...(childrenByCode.get(taxon.speciesCode) || [])];
    const previousParents = [...new Map(lineageRows.map(previousParent).filter((entry): entry is SourceTaxon => Boolean(entry)).map(parent => [parent.TAXON_CONCEPT_ID, parent])).values()];
    const sourceRecords: SourceTaxon[] = [];
    let status: CrosswalkStatus = 'unresolved', method: OfficialMapping['method'] = 'unresolved';
    let evidence = `Official Clements v2026 worksheet row ${row.sourceRow} identifies this species, but its concept is absent from the 2025 species-level source tree.`;
    let reviewStatus = 'official-concept-unresolved';
    let mappingNote = 'The official 2026 species concept has no verified corresponding 2025 source tip or reviewed source-tip aggregate.';
    let candidateSourceRecords: SourceTaxon[] = [];
    let officialEvidenceRows = [row.sourceRow];
    const aliases: string[] = [];
    if (exact) {
      sourceRecords.push(exact);
      const renamed = exact.SCI_NAME !== taxon.sciName || exact.PRIMARY_COM_NAME !== taxon.comName;
      status = renamed ? 'renamed' : 'exact'; method = 'official-concept-id';
      evidence = `Official Clements v2026 worksheet row ${row.sourceRow} has the same persistent Avibase concept ID as the pinned Clements 2025 source species.`;
      reviewStatus = 'official-concept-id-match';
      mappingNote = renamed ? 'Same official Clements species concept; a scientific or common name changed.' : 'The official Clements 2026 species concept exactly matches the 2025 source species.';
      for (const name of [exact.SCI_NAME, exact.PRIMARY_COM_NAME]) if (![taxon.sciName, taxon.comName].includes(name)) aliases.push(name);
    } else {
      const override = overridesByName.get(taxon.sciName);
      if (override) {
        assert.equal(override.reviewStatus, 'reviewed', `Annual-change relationship has not been reviewed: ${taxon.sciName}`);
        assert.ok(['broader', 'narrower', 'unresolved', 'exact', 'renamed'].includes(override.status), `Invalid reviewed override relationship: ${taxon.sciName}`);
        const reviewedSources = override.sourceScientificNames.split('|').filter(Boolean).map(name => {
          const sourceRow = sourceByName.get(name); assert.ok(sourceRow, `Reviewed source species absent: ${name}`); return sourceRow;
        });
        status = override.status as CrosswalkStatus;
        candidateSourceRecords = (override.candidateScientificNames || '').split('|').filter(Boolean).map(name => {
          const candidate = sourceByName.get(name); assert.ok(candidate, `Unknown audit-only source candidate: ${name}`); return candidate;
        });
        officialEvidenceRows = [...new Set([row.sourceRow, ...(override.evidenceRows || '').split('|').filter(Boolean).map(Number)])];
        for (const evidenceRow of officialEvidenceRows) assert.ok(official.rows.some(record => record.sourceRow === evidenceRow), `Unknown official evidence row: ${evidenceRow}`);
        assert.ok(status === 'unresolved' ? reviewedSources.length === 0 : reviewedSources.length > 0, `Invalid reviewed source cardinality: ${taxon.sciName}`);
        if (status === 'broader') assert.equal(reviewedSources.length, 1, `Source-broader placement needs one containing source species: ${taxon.sciName}`);
        if (status === 'broader' || status === 'narrower') {
          // Reviewed relationships are not inferred from a name or sort number.
          // Where old membership is retained, it must corroborate every claimed
          // source. Newly described daughters can instead be explicitly named
          // in the official change narrative (e.g. laguceria and tiganada).
          const claimed = new Set(reviewedSources.map(sourceRow => sourceRow.TAXON_CONCEPT_ID));
          assert.ok(previousParents.every(parent => claimed.has(parent.TAXON_CONCEPT_ID)), `Reviewed relationship omits prior source membership: ${taxon.sciName}`);
          const normalizedText = (row.changeText || '').normalize('NFKC').replace(/\s+/g, ' ');
          for (const reviewedSource of reviewedSources) {
            assert.ok(previousParents.some(parent => parent.TAXON_CONCEPT_ID === reviewedSource.TAXON_CONCEPT_ID) || normalizedText.includes(reviewedSource.SCI_NAME), `Reviewed source lacks official annual-change evidence: ${taxon.sciName} / ${reviewedSource.SCI_NAME}`);
          }
          assert.ok(row.changes || row.changeText, `Reviewed relationship has no official change record: ${taxon.sciName}`);
        }
        if (status === 'exact' || status === 'renamed') {
          assert.equal(reviewedSources.length, 1, `Exact override must have one source: ${taxon.sciName}`);
          assert.equal(reviewedSources[0].TAXON_CONCEPT_ID, row.conceptId, `Exact override changes a species concept: ${taxon.sciName}`);
        }
        sourceRecords.push(...reviewedSources);
        method = status === 'unresolved' ? 'unresolved' : 'reviewed-change';
        evidence = `${override.evidence}; official Clements v2026 worksheet row ${row.sourceRow}. ${row.changes || ''}. ${row.changeText || ''}${previousParents.length ? ` Retained sort_v2025 membership: ${previousParents.map(parent => `${parent.SCI_NAME} (${parent.TAXON_CONCEPT_ID})`).join('; ')}.` : ''}`.trim();
        reviewStatus = status === 'unresolved' ? 'official-source-limit-unresolved' : 'official-change-reviewed';
        mappingNote = status === 'broader'
          ? 'The 2025 source tip includes this current species and other 2026 species. Shown as a source-tip aggregate; no daughter-species divergence date is invented.'
          : status === 'narrower'
            ? `This official 2026 species includes ${sourceRecords.length} narrower 2025 source tips. All source ancestries are retained; their splits are not current-species divergence dates.`
            : status === 'unresolved'
              ? `A complete source-tree placement is not established. ${override.evidence}.`
              : 'The official Clements species concept has a reviewed equivalent source placement.';
      }
    }
    if (status === 'unresolved') assert.equal(sourceRecords.length, 0, `An unresolved concept cannot silently receive a tip: ${taxon.sciName}`);
    mappings.set(taxon.speciesCode, { targetConceptId: row.conceptId!, officialRow: row, sourceRecords, status, evidence, reviewStatus, mappingNote, aliases: [...new Set(aliases)], method,
      previousSourceConceptIds: previousParents.map(parent => parent.TAXON_CONCEPT_ID), previousSourceRows: lineageRows.filter(member => oldOrder(member) !== null).map(member => member.sourceRow), candidateSourceRecords, officialEvidenceRows });
  }
  return mappings;
}
