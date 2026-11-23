import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import { parseNexus, validateTree } from './tree-parser.ts';
import { buildOfficialCrosswalk, type SourceTaxon, type CrosswalkOverride } from './taxonomy-crosswalk.ts';

const out = 'public/data';
const lock = JSON.parse(await readFile('data/sources.lock.json', 'utf8'));
for (const source of lock.sources) {
  const bytes = await readFile(source.path);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256, `Source hash changed: ${source.path}`);
}
const parseCsv = async (path: string) => {
  const result = Papa.parse<Record<string, string>>(await readFile(path, 'utf8'), { header: true, skipEmptyLines: true });
  assert.equal(result.errors.length, 0, `${path}: CSV errors`); return result.data;
};
const tree = parseNexus(await readFile('data/raw/tree.nex', 'utf8'));
const validation = validateTree(tree);
let independentAudit: any = null;
try { independentAudit = JSON.parse(await readFile('public/data/tree-audit.json', 'utf8')); } catch { /* Optional R audit can be run after initial preparation. */ }
const sourceTaxa = await parseCsv('data/raw/ott2025.csv');
const ebird = JSON.parse(await readFile('data/raw/ebird2026.json', 'utf8'));
const officialProvenance = JSON.parse(await readFile('data/clements2026-source.json', 'utf8'));
const officialSource = lock.sources.find((source: any) => source.id === 'clements2026-integrated-xlsx');
assert.ok(officialSource, 'Original official Clements workbook must be a pinned source');
assert.equal(officialProvenance.source.path, officialSource.path, 'Official workbook provenance path changed');
assert.equal(officialProvenance.source.sha256, officialSource.sha256, 'Official workbook provenance hash differs from pinned source');
assert.equal(officialProvenance.source.bytes, officialSource.bytes, 'Official workbook provenance byte count differs from pinned source');
const extractorBytes = await readFile(officialProvenance.extractor.path);
assert.equal(createHash('sha256').update(extractorBytes).digest('hex'), officialProvenance.extractor.sha256, 'Official workbook extractor changed; rerun extraction to refresh provenance');
const officialBytes = await readFile(officialProvenance.output.path);
assert.equal(createHash('sha256').update(officialBytes).digest('hex'), officialProvenance.output.sha256, 'Normalized official workbook changed; rerun its checked extractor');
assert.equal(officialBytes.byteLength, officialProvenance.output.bytes, 'Normalized official workbook byte count changed');
const official = JSON.parse(officialBytes.toString('utf8'));
const huashu = JSON.parse(await readFile('data/raw/huashu-species.json', 'utf8')).species;
const everybird = JSON.parse(await readFile('data/raw/everybird-species.json', 'utf8')).species;
const overrides = await parseCsv('data/crosswalk-overrides.csv');
const officialMappings = buildOfficialCrosswalk(ebird, sourceTaxa as SourceTaxon[], official, overrides as CrosswalkOverride[]);
const tipByName = new Map(tree.tips.map(id => [tree.nodes[id].name!, id]));
assert.equal(sourceTaxa.length, tree.tips.length);
for (const source of sourceTaxa) assert.ok(tipByName.has(source.SCI_NAME), `Source taxonomy tip missing: ${source.SCI_NAME}`);
// Named clades must be verified against complete source taxonomy membership,
// not the partial current crosswalk or the subset of recorded species.
const sourceClades: { name: string; rank: 'order' | 'family'; nodeId: number; tipCount: number }[] = [];
const sourceTopologyGaps: { name: string; rank: 'order' | 'family'; memberCount: number; mrcaTipCount: number }[] = [];
for (const rank of ['order', 'family'] as const) {
  const groups = new Map<string, number[]>();
  for (const taxon of sourceTaxa) {
    const name = (rank === 'order' ? taxon.ORDER : taxon.FAMILY.split(' (')[0]).trim();
    const ids = groups.get(name) || []; ids.push(tipByName.get(taxon.SCI_NAME)!); groups.set(name, ids);
  }
  for (const [name, ids] of groups) {
    const positions = ids.map(id => tree.nodes[id].leafStart);
    const min = Math.min(...positions), max = Math.max(...positions);
    let nodeId = ids[0];
    while (!(tree.nodes[nodeId].leafStart <= min && tree.nodes[nodeId].leafEnd > max)) {
      const parent = tree.nodes[nodeId].parent; assert.notEqual(parent, null); nodeId = parent!;
    }
    const count = tree.nodes[nodeId].leafEnd - tree.nodes[nodeId].leafStart;
    if (count === ids.length) sourceClades.push({ name, rank, nodeId, tipCount: count });
    else sourceTopologyGaps.push({ name, rank, memberCount: ids.length, mrcaTipCount: count });
  }
}
Object.assign(tree, { sourceClades });
const huashuByCode = new Map<string, any>();
const huashuByName = new Map<string, any>();
for (const h of huashu) {
  if (h.ids?.ebird) huashuByCode.set(h.ids.ebird, h);
  huashuByName.set(h.scientificName, h);
}
const everybirdByCode = new Map<string, any>(everybird.map((e: any) => [e.code, e]));
const crosswalk: any[] = [];
const taxa: any[] = [];
const localAssets = new Map<string, any>(lock.assets.map((s: any) => [s.code, s]));

for (const e of ebird) {
  const t: any = { code: e.speciesCode, scientificName: e.sciName, commonName: e.comName, category: e.category,
    order: e.order, family: e.familySciName, mappingStatus: 'unresolved' };
  if (e.reportAs) t.parentCode = e.reportAs;
  if (e.category !== 'species') {
    t.mappingNote = e.reportAs ? 'Reportable group resolves through the official eBird REPORT_AS parent.' : 'Non-species reportable category; see import report for treatment.';
    taxa.push(t); continue;
  }
  // Artwork provenance and quality remain independent of species placement.
  const art = huashuByCode.get(e.speciesCode) || huashuByName.get(e.sciName);
  const corroborated = art && art.scientificName === e.sciName && art.ids?.ebird === e.speciesCode;
  const mapping = officialMappings.get(t.code)!;
  const sourceRecords = mapping.sourceRecords;
  t.conceptId = mapping.targetConceptId;
  t.mappingStatus = mapping.status; t.mappingNote = mapping.mappingNote;
  if (mapping.aliases.length) t.aliases = mapping.aliases;
  const ids = sourceRecords.map(s => tipByName.get(s.SCI_NAME)!);
  if (ids.length) { t.treeTip = ids[0]; if (ids.length > 1) t.treeTips = ids; }
  const ea = everybirdByCode.get(t.code);
  const local = localAssets.get(t.code);
  if (local && ea?.q !== false && art?.sticker?.meetsQualityBar !== false) {
    t.sticker = local.localPath;
    t.stickerSmall = local.smallPath;
    t.artworkStatus = local.quality === 'meets-source-quality-bar' && corroborated && art?.sticker?.meetsQualityBar === true ? 'reviewed-available' : 'available-review-unknown';
  } else if (ea?.q === false || art?.sticker?.meetsQualityBar === false) t.artworkStatus = 'quality-fallback';
  else t.artworkStatus = ea?.st ? 'not-bundled' : 'missing-source';
  if (local?.quality === 'meets-source-quality-bar' && art?.sticker?.reviewScore !== undefined && corroborated) t.artworkReviewScore = art.sticker.reviewScore;
  crosswalk.push({ targetCode: t.code, targetScientificName: t.scientificName, targetConceptId: t.conceptId,
    targetConceptSource: 'official-clements2026-integrated', officialSourceRow: mapping.officialRow.sourceRow,
    officialEvidenceRows: mapping.officialEvidenceRows, officialPreviousSort: mapping.officialRow.sort2025 ?? null, method: mapping.method,
    previousSourceConceptIds: mapping.previousSourceConceptIds, previousSourceRows: mapping.previousSourceRows,
    candidateSources: mapping.candidateSourceRecords.map(source => ({ conceptId: source.TAXON_CONCEPT_ID, scientificName: source.SCI_NAME })),
    sourceConceptIds: sourceRecords.map(s => s.TAXON_CONCEPT_ID), sourceNames: sourceRecords.map(s => s.SCI_NAME),
    sourceTips: ids, relationship: t.mappingStatus, evidence: mapping.evidence, reviewStatus: mapping.reviewStatus });
  taxa.push(t);
}
const species = taxa.filter(t => t.category === 'species');
// A source tip can represent several split descendants. Give hit testing a
// deterministic representative while retaining the full many-to-many crosswalk.
// No representative is assigned to an unresolved concept.
for (const t of [...species].sort((a,b) => ({ exact:0, renamed:1, broader:2, narrower:3, unresolved:4 }[a.mappingStatus as 'exact'] ?? 4) - ({ exact:0, renamed:1, broader:2, narrower:3, unresolved:4 }[b.mappingStatus as 'exact'] ?? 4))) {
  for (const id of t.treeTips || (t.treeTip !== undefined ? [t.treeTip] : [])) tree.nodes[id].taxonCode ||= t.code;
}
const mappedSourceIds = new Set(crosswalk.flatMap(c => c.sourceTips));
const statuses = Object.fromEntries(['exact', 'renamed', 'broader', 'narrower', 'unresolved'].map(s => [s, species.filter(t => t.mappingStatus === s).length]));
const officialConceptAudit = { status: 'official-full-species', speciesAudited: officialMappings.size,
  directConceptMatches: crosswalk.filter(mapping => mapping.method === 'official-concept-id').length,
  reviewedAnnualChanges: crosswalk.filter(mapping => mapping.method === 'reviewed-change').length,
  unresolvedSourceConcepts: statuses.unresolved, previousSortAnchorMatches: statuses.exact + statuses.renamed,
  workbookPath: officialSource.path, workbookSha256: officialSource.sha256, sheet: official.sheet,
  normalizedPath: officialProvenance.output.path, normalizedSha256: officialProvenance.output.sha256,
  provenancePath: 'data/clements2026-source.json', crosswalkPath: '/data/crosswalk.json',
  scope: 'Every current species has an official concept ID and worksheet-row evidence. Exact identity is joined by persistent concept ID; reviewed source containment is distinct from identity. All source-tree branch lengths remain 2025 values.' };
const coverage = {
  treeVersion: tree.version, taxonomyVersion: '2026', sourceTips: tree.tips.length,
  reportableTaxa: taxa.length, currentSpecies: species.length, mappingStatuses: statuses,
  mappedCurrentSpecies: species.filter(t => t.treeTip !== undefined).length,
  officialConceptAudit,
  representedSourceTips: mappedSourceIds.size,
  verifiedSourceClades: sourceClades.length, sourceTopologyGaps,
  sourceSpeciesGaps: sourceTaxa.filter(s => !mappedSourceIds.has(tipByName.get(s.SCI_NAME)!)).map(s => ({ name: s.SCI_NAME, code: s.SPECIES_CODE, conceptId: s.TAXON_CONCEPT_ID })),
  currentSpeciesGaps: species.filter(t => t.treeTip === undefined).map(t => {
    const mapping = officialMappings.get(t.code)!;
    return { code: t.code, scientificName: t.scientificName, commonName: t.commonName, conceptId: t.conceptId, reason: t.mappingNote,
      officialSourceRow: mapping.officialRow.sourceRow, officialEvidenceRows: mapping.officialEvidenceRows,
      candidateSources: mapping.candidateSourceRecords.map(source => ({ conceptId: source.TAXON_CONCEPT_ID, scientificName: source.SCI_NAME })) };
  }),
  artwork: {
    locallyBundledSpecies: species.filter(t => t.sticker).length,
    locallyBundledFiles: lock.assets.reduce((n: number, a: any) => n + a.files.length, 0),
    locallyBundledBytes: lock.assets.reduce((n: number, a: any) => n + a.files.reduce((bytes: number, f: any) => bytes + f.bytes, 0), 0),
    scope: lock.artworkScope || 'sample',
    availableAtPinnedEverybirdRevision: everybird.filter((t: any) => t.st).length,
    sourceMissingOrQuestionable: species.filter(t => t.artworkStatus === 'missing-source' || t.artworkStatus === 'quality-fallback').length,
    gaps: species.filter(t => !t.sticker).map(t => ({ code: t.code, name: t.commonName, status: t.artworkStatus })),
  },
  limitations: [
    'The official eBird v2026 reference taxonomy is complete for reportable categories; subspecies not reportable in eBird are not invented.',
    'All 11,201 current species are audited against the user-supplied official 2026 Clements integrated workbook. Persistent concept IDs determine exact identities independently of artwork metadata; every crosswalk entry cites its official worksheet row.',
    'The phylogeny remains the pinned Clements 2025 tree. Reviewed 2026 changes use honest source-tip containment or aggregates, without invented splits or dates. Newly ratified species and concepts that partly overlap older source species remain explicitly unresolved.',
    lock.artworkScope === 'all-available-current-species'
      ? 'All appropriate images available for the current eBird taxonomy at the pinned sticker revision are bundled locally at 128 and 384 px. Species without a safely mapped source illustration retain a fallback independent of tree placement.'
      : 'Only the bundled sample artwork is served. Other taxa have a consistent fallback and explicit independent artwork status.',
  ],
};
const preparedTreeHash = createHash('sha256').update(JSON.stringify(tree) + '\n').digest('hex');
if (independentAudit?.preparedTreeSha256 !== preparedTreeHash || independentAudit?.sourceSha256 !== lock.sources.find((s: any) => s.id === 'tree').sha256) independentAudit = null;
const artworkManifest = { schemaVersion: 1, scope: lock.artworkScope || 'sample', sourceRevision: lock.revisions.stickers,
  metadataRevision: lock.revisions.huashu, credit: 'Stickers: huashu-bird-sticker, CC BY 4.0. Resized and trimmed by Everybird.',
  licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', species: lock.assets.length, assets: lock.assets };
const artworkManifestText = JSON.stringify(artworkManifest) + '\n';
const manifest = {
  schemaVersion: 2, datasetVersion: 'aves-1.7-clements2025-ebird2026-v2',
  generatedAt: new Date().toISOString(), treeVersion: tree.version, treeTaxonomyVersion: '2025', taxonomyVersion: '2026',
  tree: { version: '1.7', taxonomy: 'Clements 2025', commit: lock.revisions.aves, tipCount: tree.tips.length,
    nodeCount: tree.nodes.length, rootAgeMya: tree.maxDistance, units: 'approximate million years before present',
    leafInterval: '[leafStart, leafEnd), exclusive end', license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    citation: 'McTavish et al. (2025). A complete and dynamic tree of birds. PNAS. doi:10.1073/pnas.2409658122',
    citationUrl: 'https://www.pnas.org/doi/10.1073/pnas.2409658122',
    supportingCitationsPath: '/data/tree-citations.csv', supportingCitationsSource: 'clootl 0.1.5 getCitations, Aves 1.7 packaged tree independently verified against the pinned NEXUS',
    url: lock.sources.find((s: any) => s.id === 'tree').url,
    calibrationNote: 'The source README reports a calibration error in v1.6. This pinned v1.7 tree has a root around 98.99 Ma; source uncertainty interval is retained (72–133 Ma). Dates remain approximate. This app does not recalibrate the source.',
    supportNote: 'Source posterior and age intervals are preserved verbatim on source nodes. Posterior values are summary-tree annotations and must not be interpreted as independent molecular support for every taxonomic placement. Study-level placement support is unknown here.' },
  taxonomy: { version: '2026', url: 'https://api.ebird.org/v2/ref/taxonomy/ebird?fmt=json&version=2026',
    citation: 'Clements et al. (2026). The eBird/Clements checklist of Birds of the World: v2026.',
    citationUrl: 'https://www.birds.cornell.edu/clementschecklist/download/',
    changesUrl: 'https://www.birds.cornell.edu/clementschecklist/updates-and-corrections-october-2026/',
    copyright: 'Cornell Lab of Ornithology. No open-data license was declared by the downloaded reference response; retain attribution and review terms before public redistribution.',
    conceptAudit: officialConceptAudit.status, conceptAuditDetails: officialConceptAudit,
    conceptSource: { url: officialSource.url, originalFilename: officialProvenance.source.originalFilename,
      sha256: officialSource.sha256, sheet: official.sheet, provenancePath: officialConceptAudit.provenancePath },
    conceptLimitation: coverage.limitations[2] },
  artwork: { revision: lock.revisions.stickers, metadataRevision: lock.revisions.huashu,
    originalV1Revision: 'f9e63a0ffd780edeb463b36cf1858f2e593f6099',
    url: 'https://github.com/yusuftaleb/everybird-stickers', originalUrl: 'https://github.com/alchaincyf/huashu-bird-sticker',
    license: 'CC BY 4.0', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/',
    credit: 'Stickers: huashu-bird-sticker, CC BY 4.0. Resized and trimmed by Everybird.',
    disclosure: 'AI-generated bird illustrations; quality metadata is preserved where available. Illustrations are not identification photographs.',
    sizes: [128, 384], bundledSpecies: lock.assets.length, scope: lock.artworkScope || 'sample',
    bundledFiles: coverage.artwork.locallyBundledFiles, bundledBytes: coverage.artwork.locallyBundledBytes },
  validation, independentAudit, coverageSummary: { currentSpecies: coverage.currentSpecies, mappedCurrentSpecies: coverage.mappedCurrentSpecies,
    representedSourceTips: coverage.representedSourceTips, mappingStatuses: statuses, localArtwork: coverage.artwork.locallyBundledSpecies },
  limitations: coverage.limitations, sources: lock.sources,
  assets: { manifestPath: '/data/artwork-manifest.json', sha256: createHash('sha256').update(artworkManifestText).digest('hex'),
    bytes: Buffer.byteLength(artworkManifestText), species: lock.assets.length, files: coverage.artwork.locallyBundledFiles },
};
await mkdir(out, { recursive: true });
async function json(path: string, value: unknown, pretty = false) { await writeFile(path, JSON.stringify(value, null, pretty ? 2 : undefined) + '\n'); }
await Promise.all([json(`${out}/tree.json`, tree), json(`${out}/taxa.json`, taxa), json(`${out}/crosswalk.json`, crosswalk),
  json(`${out}/manifest.json`, manifest, true), json(`${out}/coverage.json`, coverage, true),
  writeFile(`${out}/artwork-manifest.json`, artworkManifestText)]);
await writeFile('data/coverage-report.md', `# Dataset coverage\n\nTree: ${tree.version} (${tree.tips.length.toLocaleString()} tips).\n\neBird v2026: ${taxa.length.toLocaleString()} reportable taxa, ${species.length.toLocaleString()} species.\n\n| Mapping | Species |\n| --- | ---: |\n${Object.entries(statuses).map(([s,n])=>`| ${s} | ${n} |`).join('\n')}\n\n${coverage.mappedCurrentSpecies} current species map to ${coverage.representedSourceTips} distinct source tips. ${coverage.currentSpeciesGaps.length} current-species concepts remain visible but unmapped. ${coverage.sourceSpeciesGaps.length} source-species tips lack a current mapping.\n\nArtwork: ${coverage.artwork.locallyBundledSpecies} species bundled at 128 and 384 px. All ${coverage.artwork.gaps.length} local artwork gaps and source species gaps are enumerated in [coverage.json](../public/data/coverage.json).\n\n${coverage.limitations.map(x=>`- ${x}`).join('\n')}\n\nBranch lengths are unchanged. Root-to-tip spread: ${validation.tipDistanceSpread} Ma, retained source rounding. Source age intervals and posteriors remain attached to dataset-scoped nodes.\n`);
// Purely invented history. Taxon names are real; dates/checklists are synthetic.
const demoCodes: string[] = lock.demoCodes || lock.assets.map((a: any) => a.code);
const demo = demoCodes.map(code => species.find(t => t.code === code)).filter(Boolean);
const quote = (s: string) => `"${s.replaceAll('"', '""')}"`;
const demoRows = demo.map((t: any, i: number) => [`DEMO-${String(i + 1).padStart(3, '0')}`, t.commonName, t.scientificName, i % 6 === 0 ? 'X' : String(i % 5 + 1), `202${i % 3 + 3}-${String(i % 12 + 1).padStart(2, '0')}-${String(i % 27 + 1).padStart(2, '0')}`].map(quote).join(','));
await writeFile('public/demo/MyEBirdData-sample.csv', 'Submission ID,Common Name,Scientific Name,Count,Date\n' + demoRows.join('\n') + '\n');
await writeFile('public/demo/README.txt', 'Invented demonstration observations. Species names are real eBird v2026 names; dates, counts and submission IDs are synthetic. No personal data is included.\n');
console.log(JSON.stringify({ validation, mappingStatuses: statuses, mappedSpecies: coverage.mappedCurrentSpecies, artwork: coverage.artwork.locallyBundledSpecies, currentGaps: coverage.currentSpeciesGaps.length }));
