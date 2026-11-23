import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { Collection, Taxon, TreeData } from './types';
import { makeDemo } from './demo';
import { TreeCanvas, type TreeCanvasHandle, type ViewInfo } from './tree/TreeCanvas';
import { startImport } from './import/client';
import { clearCollection, loadCollection, parseBackup, saveCollection, serializeBackup } from './storage/collection';
import { allTaxaSelection, genusOf, matchesTaxonomy, nextTaxonomicRank, parentTaxonomicSelection, selectTaxonomicGroup, taxonomicOptions, type TaxonomicRank, type TaxonomicSelection } from './taxonomy/groups';
import { CountryMap } from './components/CountryMap';
import { BirdMark } from './components/BirdMark';
import { ClusterCanvas } from './components/ClusterCanvas';
import { clearEmbeddingMemoryCache, startEmbedding, type EmbeddingResult, type EmbeddingProgress } from './embedding/client';
import { clearPackingMemoryCache } from './embedding/sticker-packing-client';
import { clearPersistentLayoutCache } from './storage/layout-cache';
import type { StickerGeometryData } from './embedding/sticker-types';
import type { StickerColorsFile } from './tree/color-order';
import type { StickerCollisionMasksFile } from './embedding/collision-masks';
import { useThemePreference } from './theme';
import { versionArtworkUrl } from './tree/sticker-delivery';
import { Arboretum, type ArboretumSelection } from './components/Arboretum';
import { availableYears, observationsForPeriod, yearHistoryAvailable, type YearMode } from './arboretum/history';
import { buildGrowthTimeline, codesThroughEvent, growthEventTransitionDuration } from './arboretum/growth';
import { buildCountryGrowth, countryGrowthFrame } from './arboretum/country-growth';
import { CountryGrowthGrid } from './components/CountryGrowthGrid';
import { SharedArtworkPool } from './tree/shared-artwork';
import { GrowthTimeline, usePrefersReducedMotion } from './components/GrowthTimeline';
import { SourcesBox } from './components/SourcesBox';
import { exportCredits as credit } from './sources';
import './components/ExplorerControls.css';

type Manifest = Record<string, unknown>;
type Modal = 'import' | 'report' | 'map' | 'view-settings' | 'animation-export' | null;
const AnimationExport=lazy(()=>import('./components/AnimationExport'));
const n = (value: number) => value.toLocaleString();
const mappingLabels = { exact: 'Matched to source tree', renamed: 'Name updated', broader: 'Shared branch in the source tree', narrower: 'Partial placement', unresolved: 'No placement in the source tree' };
const embeddingMethod = 'mds';

function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.5"/><path d="m16 16 4.5 4.5"/></>,
    upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 15v5h16v-5"/></>,
    download: <><path d="M12 3v13m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
    plus: <path d="M5 12h14M12 5v14"/>, minus: <path d="M5 12h14"/>,
    reset: <><path d="M4 10a8 8 0 1 1 1 7M4 4v6h6"/></>,
    arrow: <path d="m9 5 7 7-7 7"/>, close: <path d="m6 6 12 12M6 18 18 6"/>,
    leaf: <><path d="M20 3c0 12-3 17-10 17a6 6 0 0 1-6-6C4 7 12 3 20 3Z"/><path d="M3 22 16 8"/></>,
    save: <><path d="M4 3h13l4 4v14H3V3h1ZM7 3v6h10V3M7 21v-8h10v8"/></>,
    shield: <><path d="m12 2 8 3v6c0 5-4 9-8 11-4-2-8-6-8-11V5l8-3Z"/><path d="m8 12 3 3 5-6"/></>,
    info: <><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7v1"/></>,
    list: <><path d="M8 6h13M8 12h13M8 18h13M3 6h.1M3 12h.1M3 18h.1"/></>,
    branch: <><path d="M5 3v12a4 4 0 0 0 4 4h10M5 12h7a4 4 0 0 0 4-4V3"/><circle cx="5" cy="3" r="2"/><circle cx="16" cy="3" r="2"/><circle cx="20" cy="19" r="2"/></>,
    globe: <><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c5 5 5 13 0 18-5-5-5-13 0-18Z"/></>,
    moon: <path d="M20.8 13.1A8.7 8.7 0 0 1 10.9 3.2 8.8 8.8 0 1 0 20.8 13.1Z"/>,
    sun: <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.info}</svg>;
}
function Sticker({ taxon, size = 'small' }: { taxon?: Taxon; size?: 'small' | 'large' }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [taxon?.sticker]);
  return <span className={`sticker ${size}`}>
    {taxon?.sticker && !/questionable|rejected|unsafe|quality-fallback/i.test(taxon.artworkStatus || '') && !failed ? <img src={versionArtworkUrl(size === 'small' ? taxon.stickerSmall || taxon.sticker : taxon.sticker)} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)}/> : <BirdMark/>}
  </span>;
}
function Dialog({ title, children, onClose, wide = false, map = false }: { title: string; children: ReactNode; onClose: () => void; wide?: boolean; map?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const dialog = ref.current!; dialog.showModal(); return () => dialog.close(); }, []);
  return <dialog ref={ref} aria-label={title} className={`dialog ${wide ? 'wide' : ''} ${map ? 'map-dialog' : ''}`} onCancel={e => { e.preventDefault(); onClose(); }} onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
    <header className="dialog-heading"><h2>{title}</h2><button className="icon-button" onClick={onClose} aria-label="Close dialog"><Icon name="close"/></button></header>
    <div className="dialog-body">{children}</div>
  </dialog>;
}
function downloadFile(contents: string, filename: string, type: string) {
  const url = URL.createObjectURL(new Blob([contents], { type }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function sourceValue(manifest: Manifest, keys: string[], fallback: string): string {
  for (const key of keys) {
    const value = manifest[key];
    if (typeof value === 'string') return value;
    if (value && typeof value === 'object' && 'version' in value) return String(value.version);
  }
  return fallback;
}

function TreeScaleLegend({ mode, rootAge, scale }: { mode: 'compact' | 'true-distance'; rootAge: number; scale: ViewInfo['branchScale'] }) {
  return <div className="tree-scale-legend" aria-label="Tree scale">
    <span>Aves · {mode === 'compact' ? 'Compact' : 'True distance'}</span>
    {mode === 'compact' ? <span>Branch lengths not to scale</span> : <>
      <span>≈{Math.round(rootAge)} Ma at root · approximate dates</span>
      {scale && <span className="branch-distance-scale" title="Scale applies to radial branches, not portrait positions">
        <svg width={scale.width + 2} height="9" aria-hidden="true"><path d={`M1 1v7M1 4.5h${scale.width}M${scale.width + 1} 1v7`} fill="none" stroke="currentColor"/></svg>
        ≈{scale.age} million years
      </span>}
    </>}
  </div>;
}

export default function App() {
  const { theme, preference: themePreference, setPreference: setThemePreference } = useThemePreference();
  const [data, setData] = useState<{ tree: TreeData; taxa: Taxon[]; manifest: Manifest; coverage: unknown } | null>(null);
  const [loadError, setLoadError] = useState('');
  const [collection, setCollection] = useState<Collection | null>(null);
  const [section, setSection] = useState<'explore' | 'arboretum'>('explore');
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [yearMode, setYearMode] = useState<YearMode>('cumulative');
  const [growthActive, setGrowthActive] = useState(false);
  const [growthView,setGrowthView] = useState<'single'|'countries'>('single');
  const growthComparisonActive=growthActive&&growthView==='countries';
  const [growthIndex, setGrowthIndex] = useState(-1);
  const [growthPlaying, setGrowthPlaying] = useState(false);
  const [growthSpeed, setGrowthSpeed] = useState(1);
  const [exporting, setExporting] = useState(false);
  const reducedMotion = usePrefersReducedMotion();
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [scope, setScope] = useState<'collection' | 'all'>('collection');
  const [limit, setLimit] = useState(60);
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ bytes: 0, totalBytes: 0, records: 0 });
  const [saved, setSaved] = useState(false);
  const [importError, setImportError] = useState('');
  const [view, setView] = useState<ViewInfo>({ zoom: 1, visibleSpecies: 0, focusLabel: null });
  const [taxonomicSelection, setTaxonomicSelection] = useState<TaxonomicSelection>({ ...allTaxaSelection });
  const [showAllBranches, setShowAllBranches] = useState(false);
  const [layoutMode, setLayoutMode] = useState<'true-distance' | 'compact'>('true-distance');
  const [displayMode, setDisplayMode] = useState<'tree' | 'umap'>('tree');
  const [showTree, setShowTree] = useState(true);
  const [portraitOrder, setPortraitOrder] = useState<'phylogeny' | 'color'>('phylogeny');
  const [stickerSizeMode, setStickerSizeMode] = useState<'even' | 'true'>('even');
  const [stickerGeometry, setStickerGeometry] = useState<StickerGeometryData | null>(null);
  const [geometryError, setGeometryError] = useState('');
  const [geometryAttempt, setGeometryAttempt] = useState(0);
  const [stickerColors, setStickerColors] = useState<StickerColorsFile | null>(null);
  const [colorError, setColorError] = useState('');
  const [colorAttempt, setColorAttempt] = useState(0);
  const [collisionMasks, setCollisionMasks] = useState<StickerCollisionMasksFile | null>(null);
  const [collisionError, setCollisionError] = useState('');
  const [collisionAttempt, setCollisionAttempt] = useState(0);
  const [embedding, setEmbedding] = useState<{ key: string; result: EmbeddingResult } | null>(null);
  const [embeddingProgress, setEmbeddingProgress] = useState<EmbeddingProgress | null>(null);
  const [embeddingPhase, setEmbeddingPhase] = useState<'idle' | 'running' | 'ready' | 'cancelled' | 'error'>('idle');
  const [embeddingError, setEmbeddingError] = useState('');
  const [embeddingAttempt, setEmbeddingAttempt] = useState(0);
  const cancelEmbedding = useRef<(() => void) | null>(null);
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [collectionExpanded, setCollectionExpanded] = useState(false);
  const [artworkStatus, setArtworkStatus] = useState({ queued: 0, active: 0, ready: 0, failed: 0, cacheHits: 0 });
  const reportArtworkStatus = useCallback((next: typeof artworkStatus) => setArtworkStatus(old => old.queued === next.queued && old.active === next.active && old.ready === next.ready && old.failed === next.failed ? old : next), []);
  const canvas = useRef<TreeCanvasHandle>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backupInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const cancelImport = useRef<(() => void) | null>(null);
  const startTime = useRef(performance.now());

  const focusSpeciesSearch = useCallback(() => {
    setSection('explore');
    setCollectionExpanded(true);
    requestAnimationFrame(() => searchInput.current?.focus());
  }, []);

  useEffect(() => {
    let alive = true;
    Promise.all(['tree', 'taxa', 'manifest', 'coverage'].map(async name => {
      const response = await fetch(`/data/${name}.json`); if (!response.ok) throw new Error(`Could not load ${name} (${response.status}).`); return response.json();
    })).then(async ([tree, taxa, manifest, coverage]) => {
      if (!alive) return;
      const loaded = { tree: tree as TreeData, taxa: taxa as Taxon[], manifest, coverage };
      setData(loaded);
      const demo = makeDemo(taxa, sourceValue(manifest, ['datasetVersion'], tree.version), sourceValue(manifest, ['taxonomyVersion', 'taxonomy'], '2026'));
      setCollection(demo);
      setSelectedCode(null);
      try {
        const restored = await loadCollection({ datasetVersion: demo.datasetVersion, taxonomyVersion: demo.taxonomyVersion, taxa });
        if (restored && alive) { setCollection(restored); setSelectedCode(null); setSaved(true); setNotice('Restored the collection you saved on this device.'); }
      } catch (error) { if (alive) setNotice(`Saved collection: ${error instanceof Error ? error.message : 'Storage is unavailable.'}`); }
      performance.mark('everybird-data-ready');
      console.info(`phyloBirds local assets ready in ${Math.round(performance.now() - startTime.current)} ms`);
    }).catch(error => { if (alive) setLoadError(error.message); });
    return () => { alive = false; };
  }, []);
  useEffect(() => { setLimit(60); }, [query, scope, taxonomicSelection, selectedCountry, selectedYear, yearMode]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(''), 8000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === '/' && !event.repeat && !event.ctrlKey && !event.altKey && !event.metaKey && !modal && !exporting &&
          !(event.target instanceof HTMLElement && (event.target.matches('input, textarea, select') || event.target.isContentEditable))) {
        event.preventDefault();
        focusSpeciesSearch();
      }
    };
    window.addEventListener('keydown', handler); return () => window.removeEventListener('keydown', handler);
  }, [modal, exporting, focusSpeciesSearch]);
  useEffect(() => () => cancelImport.current?.(), []);

  const taxaByCode = useMemo(() => new Map(data?.taxa.map(t => [t.code, t])), [data]);
  const countryCollection = growthComparisonActive ? undefined : collection?.countries?.find(country => country.code === selectedCountry);
  const countryGrowth=useMemo(()=>collection&&growthComparisonActive?buildCountryGrowth(collection,{year:selectedYear}):null,[collection,growthComparisonActive,selectedYear]);
  const sharedArtworkPool=useMemo(()=>new SharedArtworkPool(),[countryGrowth]);
  const scopeObservations = useMemo(() => collection ? observationsForPeriod(collection, {countryCode:growthComparisonActive?null:selectedCountry,year:selectedYear,mode:yearMode}) : undefined, [collection,selectedCountry,selectedYear,yearMode,growthComparisonActive]);
  const singleGrowthTimeline = useMemo(() => buildGrowthTimeline(scopeObservations || []), [scopeObservations]);
  const canAnimate = useMemo(() => {
    if (!collection) return false;
    if (yearMode !== 'annual' || selectedYear === null) return singleGrowthTimeline.datedCount > 0;
    const cumulative = observationsForPeriod(collection, { countryCode: selectedCountry, year: selectedYear, mode: 'cumulative' });
    return buildGrowthTimeline(cumulative).datedCount > 0;
  }, [collection, selectedCountry, selectedYear, singleGrowthTimeline.datedCount, yearMode]);
  const growthTimeline=countryGrowth?.timeline??singleGrowthTimeline;
  const growthFinalCodes = useMemo(() => codesThroughEvent(growthTimeline,growthTimeline.events.length-1), [growthTimeline]);
  const growthRevealedCodes = useMemo(() => codesThroughEvent(growthTimeline,growthIndex), [growthTimeline,growthIndex]);
  const growthNewCodes = useMemo(() => new Set(growthTimeline.events[growthIndex]?.codes || []), [growthTimeline,growthIndex]);
  const growthDate = growthTimeline.events[growthIndex]?.date || null;
  const growthDuration=growthEventTransitionDuration(growthTimeline,growthIndex,growthSpeed);
  const growthStartedAt=useMemo(()=>performance.now(),[growthTimeline,growthIndex]);
  const growthFrame = useMemo(() => growthActive ? {
    revealedCodes: growthRevealedCodes, newCodes: growthNewCodes, date: growthDate,
    progress: growthPlaying ? undefined : 1, durationMs: growthDuration, startedAt: growthStartedAt,
  } : undefined, [growthActive, growthRevealedCodes, growthNewCodes, growthDate, growthPlaying, growthDuration, growthStartedAt]);
  const countryFrames=useMemo(()=>countryGrowth?.panels.filter(panel=>panel.countryCode!==null).map(panel=>({panel,frame:countryGrowthFrame(panel,growthDate)}))||[],[countryGrowth,growthDate]);
  const activeObservations = useMemo(() => growthActive ? scopeObservations?.filter(observation=>growthRevealedCodes.has(observation.code)) : scopeObservations, [growthActive,scopeObservations,growthRevealedCodes]);
  const yearOptions = useMemo(() => collection ? availableYears(collection) : [], [collection]);
  const hasYearHistory = collection ? yearHistoryAvailable(collection) : false;
  const legacyYearView = selectedYear !== null && !hasYearHistory;
  const periodLabel = selectedYear === null ? '' : yearMode === 'annual' ? `During ${selectedYear}` : `Through ${selectedYear}`;
  const periodCountries = useMemo(() => collection?.countries?.map(country => ({...country,species:observationsForPeriod(collection,{countryCode:country.code,year:selectedYear,mode:yearMode})})).filter(country => country.species.length) || [], [collection,selectedYear,yearMode]);
  const observations = useMemo(() => new Map(activeObservations?.map(s => [s.code, s])), [activeObservations]);
  const observedCodes = useMemo(() => new Set(activeObservations?.map(s => s.code)), [activeObservations]);
  const embeddingKey = useMemo(() => `${data?.tree.version || ''}:${embeddingMethod}:${[...observedCodes].sort().join(',')}`, [data?.tree.version, observedCodes, embeddingMethod]);
  const currentEmbedding = embedding?.key === embeddingKey ? embedding.result : null;
  useEffect(() => {
    if (stickerGeometry) return;
    const controller = new AbortController();
    setGeometryError('');
    fetch('/data/sticker-geometry.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Could not load sticker measurements (${response.status}).`);
      const measurements = await response.json();
      if (measurements.version !== 1 || !measurements.species || typeof measurements.species !== 'object') throw new Error('The local sticker measurements are invalid.');
      if (!controller.signal.aborted) setStickerGeometry(measurements as StickerGeometryData);
    }).catch(error => { if (!controller.signal.aborted) setGeometryError(error instanceof Error ? error.message : 'Could not load sticker measurements.'); });
    return () => controller.abort();
  }, [stickerGeometry, geometryAttempt]);
  useEffect(() => {
    if (displayMode !== 'tree' || portraitOrder !== 'color' || stickerColors) return;
    const controller = new AbortController(); setColorError('');
    fetch('/data/sticker-colors.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Could not load illustration colors (${response.status}).`);
      const colors = await response.json();
      if (colors.version !== 1 || !colors.species || typeof colors.species !== 'object') throw new Error('The local illustration colors are invalid.');
      if (!controller.signal.aborted) setStickerColors(colors as StickerColorsFile);
    }).catch(error => { if (!controller.signal.aborted) setColorError(error instanceof Error ? error.message : 'Could not load illustration colors.'); });
    return () => controller.abort();
  }, [displayMode, portraitOrder, stickerColors, colorAttempt]);
  useEffect(() => {
    if (displayMode !== 'umap' || collisionMasks) return;
    const controller = new AbortController(); setCollisionError('');
    fetch('/data/sticker-collision-masks.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Could not load collision outlines (${response.status}).`);
      const masks = await response.json();
      if (masks.version !== 1 || !masks.species || typeof masks.species !== 'object') throw new Error('The local collision outlines are invalid.');
      if (!controller.signal.aborted) setCollisionMasks(masks as StickerCollisionMasksFile);
    }).catch(error => { if (!controller.signal.aborted) setCollisionError(error instanceof Error ? error.message : 'Could not load collision outlines.'); });
    return () => controller.abort();
  }, [displayMode, collisionMasks, collisionAttempt]);
  useEffect(() => {
    if (section !== 'explore' || displayMode !== 'umap' || !data || currentEmbedding) return;
    let active = true;
    setEmbeddingPhase('running'); setEmbeddingProgress(null); setEmbeddingError('');
    const task = startEmbedding(data.tree, data.taxa, observedCodes, { method: embeddingMethod, onProgress: next => { if (active) setEmbeddingProgress(next); } });
    cancelEmbedding.current = task.cancel;
    task.promise.then(result => {
      if (active) { setEmbedding({ key: embeddingKey, result }); setEmbeddingPhase('ready'); }
    }).catch(error => {
      if (!active) return;
      if (error instanceof Error && error.name === 'AbortError') setEmbeddingPhase('cancelled');
      else { setEmbeddingError(error instanceof Error ? error.message : 'Could not build this cluster view.'); setEmbeddingPhase('error'); }
    }).finally(() => { if (active) cancelEmbedding.current = null; });
    return () => { active = false; task.cancel(); cancelEmbedding.current = null; };
  }, [section, displayMode, data, observedCodes, embeddingKey, embeddingAttempt, currentEmbedding, embeddingMethod]);
  const speciesTaxa = useMemo(() => data?.taxa.filter(t => t.category === 'species') || [], [data]);
  const groupSpecies = useMemo(() => speciesTaxa.filter(t => matchesTaxonomy(t, taxonomicSelection)), [speciesTaxa, taxonomicSelection]);
  const collectionTaxa = useMemo(() => activeObservations?.map(s => {
    const known = taxaByCode.get(s.code); if (known) return known;
    const scientific = s.originalNames.find(name => /^[A-Z][a-z]+ [a-z]+(?: [a-z]+)?$/.test(name));
    const common = s.originalNames.find(name => name !== scientific) || s.originalNames[0];
    return { code: s.code, scientificName: scientific || s.originalNames[0] || 'Unknown taxon', commonName: common || 'Unresolved record', category: 'unresolved', mappingStatus: 'unresolved' as const };
  }).sort((a, b) => a.commonName.localeCompare(b.commonName)) || [], [activeObservations, taxaByCode]);
  const results = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (scope === 'collection' ? collectionTaxa : speciesTaxa).filter(t => matchesTaxonomy(t, taxonomicSelection) && (!q || `${t.commonName} ${t.scientificName}`.toLocaleLowerCase().includes(q)));
  }, [scope, query, speciesTaxa, collectionTaxa, taxonomicSelection]);
  const visibleCollection = useMemo(() => collectionTaxa.filter(t => matchesTaxonomy(t, taxonomicSelection)), [collectionTaxa, taxonomicSelection]);
  const unplacedTaxa = useMemo(() => {
    const excluded = new Set(currentEmbedding?.excludedCodes);
    return collectionTaxa.filter(taxon => !taxon.code.startsWith('unresolved:') && excluded.has(taxon.code));
  }, [collectionTaxa, currentEmbedding]);
  const visibleCodes = useMemo(() => new Set(visibleCollection.map(t => t.code)), [visibleCollection]);
  const groupFocusCodes = useMemo(() => displayMode === 'tree' && (taxonomicSelection.order || taxonomicSelection.family || taxonomicSelection.genus) ? visibleCollection.filter(t => t.treeTip !== undefined && t.mappingStatus !== 'unresolved').map(t => t.code) : null, [visibleCollection, taxonomicSelection, displayMode]);
  const groupRecordedCount = visibleCollection.filter(t => t.category === 'species').length;
  const groupMappedCount = visibleCollection.filter(t => t.treeTip !== undefined && t.mappingStatus !== 'unresolved').length;
  const activeGroup = taxonomicSelection.genus || taxonomicSelection.family || taxonomicSelection.order;
  const backgroundCodes = useMemo(() => activeGroup ? new Set(groupSpecies.map(t => t.code)) : undefined, [groupSpecies, activeGroup]);
  const orderOptions = useMemo(() => taxonomicOptions(speciesTaxa, 'order', taxonomicSelection, observedCodes), [speciesTaxa, taxonomicSelection, observedCodes]);
  const familyOptions = useMemo(() => taxonomicOptions(speciesTaxa, 'family', taxonomicSelection, observedCodes), [speciesTaxa, taxonomicSelection, observedCodes]);
  const genusOptions = useMemo(() => taxonomicOptions(speciesTaxa, 'genus', taxonomicSelection, observedCodes), [speciesTaxa, taxonomicSelection, observedCodes]);
  const pickerRank = nextTaxonomicRank(taxonomicSelection);
  const rankOptions = pickerRank === 'order' ? orderOptions : pickerRank === 'family' ? familyOptions : genusOptions;
  const pickerOptions = rankOptions.filter(option => option.value !== activeGroup);
  const pickerPrompt = pickerRank === 'order' ? 'Choose an order' : pickerRank === 'family' ? `Families in ${taxonomicSelection.order}` : `Genera in ${taxonomicSelection.family}`;
  const selected = selectedCode ? taxaByCode.get(selectedCode) || collectionTaxa.find(t => t.code === selectedCode) : undefined;
  const selectedObservation = selectedCode ? observations.get(selectedCode) : undefined;
  const recordedSpecies = useMemo(() => activeObservations?.filter(s => !s.code.startsWith('unresolved:')).length || 0, [activeObservations]);
  const exactCount = useMemo(() => collection?.species.filter(s => ['exact', 'renamed'].includes(taxaByCode.get(s.code)?.mappingStatus || '')).length || 0, [collection, taxaByCode]);
  const highlightedSourceTips = useMemo(() => new Set(activeObservations?.flatMap(s => { const t = taxaByCode.get(s.code); return t && t.mappingStatus !== 'unresolved' ? t.treeTips || (t.treeTip !== undefined ? [t.treeTip] : []) : []; })).size, [activeObservations, taxaByCode]);
  const reportRecordedSpecies = useMemo(() => collection?.species.filter(s => !s.code.startsWith('unresolved:')).length || 0, [collection]);
  const reportMappedSpecies = useMemo(() => collection?.species.filter(s => { const t = taxaByCode.get(s.code); return t?.treeTip !== undefined && t.mappingStatus !== 'unresolved'; }).length || 0, [collection, taxaByCode]);
  useEffect(() => { if(modal || section !== 'explore')setGrowthPlaying(false); }, [modal,section]);
  useEffect(() => { if(section !== 'explore')setGrowthActive(false); }, [section]);
  useEffect(() => {setGrowthActive(false);setGrowthPlaying(false);}, [collection]);
  const empty = useCallback(() => {
    if (!data) return;
    const next = makeDemo(data.taxa, sourceValue(data.manifest, ['datasetVersion'], data.tree.version), collection?.taxonomyVersion || '2026');
    next.species = []; next.countries = []; next.years = []; next.isDemo = false; next.label = 'Your collection';
    for (const key of Object.keys(next.report)) if (key !== 'issues') (next.report as unknown as Record<string, unknown>)[key] = 0;
    next.report.issues = [];
    setGrowthActive(false); setGrowthPlaying(false); setCollection(next); setSelectedCode(null); setSaved(false); setSelectedCountry(null); setSelectedYear(null); canvas.current?.reset(); setTaxonomicSelection({ ...allTaxaSelection });
  }, [data, collection?.taxonomyVersion]);
  const chooseSpecies = useCallback((code: string, focus = true) => {
    if (exporting || (growthActive && !growthRevealedCodes.has(code))) return;
    if (growthActive) setGrowthPlaying(false);
    setSelectedCode(code);
    if (focus) canvas.current?.focusSpecies(code);
  }, [exporting,growthActive,growthRevealedCodes]);
  const reset = () => { canvas.current?.reset(); setTaxonomicSelection({ ...allTaxaSelection }); };

  function applyTaxonomy(next: TaxonomicSelection) {
    setGrowthActive(false); setGrowthPlaying(false);
    setTaxonomicSelection(next); setQuery('');
    const name = next.genus || next.family || next.order;
    if (selected && !matchesTaxonomy(selected, next)) setSelectedCode(null);
    if (displayMode === 'umap') return;
    const members = speciesTaxa.filter(t => matchesTaxonomy(t, next));
    const recorded = members.filter(t => observedCodes.has(t.code));
    const mapped = recorded.filter(t => t.treeTip !== undefined && t.mappingStatus !== 'unresolved');
    if (!name) canvas.current?.reset();
    else if (mapped.length) canvas.current?.focusClade(mapped.map(t => t.code));
    else if (showAllBranches) canvas.current?.focusClade(members.filter(t => t.treeTip !== undefined).map(t => t.code));
    else canvas.current?.reset();
  }
  function chooseGroup(rank: TaxonomicRank, value: string) {
    applyTaxonomy(selectTaxonomicGroup(speciesTaxa, taxonomicSelection, rank, value));
  }
  function chooseCountry(code: string | null) {
    if (code !== null && !collection?.countries?.some(country => country.code === code)) return;
    if (growthActive) {
      setModal(null);
      chooseGrowthView('single', code);
      return;
    }
    setGrowthActive(false); setGrowthPlaying(false); setSection('explore'); setSelectedCountry(code); setSelectedCode(null); setQuery(''); setScope('collection');
    setTaxonomicSelection({ ...allTaxaSelection }); setModal(null); canvas.current?.reset();
  }

  function chooseYear(year: number | null, mode: YearMode = yearMode) {
    setGrowthActive(false); setGrowthPlaying(false);
    setSelectedYear(year); setYearMode(hasYearHistory ? mode : 'cumulative'); setSelectedCode(null); setQuery(''); setScope('collection');
    setTaxonomicSelection({...allTaxaSelection}); canvas.current?.reset();
  }

  function openArboretumTree(selection: ArboretumSelection) {
    setGrowthActive(false); setGrowthPlaying(false);
    setSelectedCountry(selection.country); setSelectedYear(selection.year); setYearMode(selection.yearMode);
    setSelectedCode(null); setQuery(''); setScope('collection'); setTaxonomicSelection({...allTaxaSelection});
    setDisplayMode('tree'); setPortraitOrder('phylogeny'); setShowTree(true); setSection('explore');
    requestAnimationFrame(()=>document.getElementById('period-year')?.focus());
  }

  function returnToExplorer() {
    setSection('explore');
    requestAnimationFrame(()=>document.getElementById('period-year')?.focus());
  }

  function animateGrowth(selection?: ArboretumSelection) {
    if(selection){setSelectedCountry(selection.country);setSelectedYear(selection.year);}
    setYearMode('cumulative');setSelectedCode(null);setQuery('');setScope('collection');setTaxonomicSelection({...allTaxaSelection});
    setDisplayMode('tree');setPortraitOrder('phylogeny');setShowTree(true);setShowAllBranches(false);setSection('explore');
    setGrowthView('single');setGrowthIndex(-1);setGrowthActive(true);setGrowthPlaying(!reducedMotion);
  }

  function chooseGrowthView(next: 'single' | 'countries', countryCode = selectedCountry) {
    if (!collection || (next === growthView && countryCode === selectedCountry)) return;
    const target = next === 'countries'
      ? buildCountryGrowth(collection, { year: selectedYear }).timeline
      : buildGrowthTimeline(observationsForPeriod(collection, { countryCode, year: selectedYear, mode: 'cumulative' }));
    setGrowthPlaying(false);
    setSelectedCode(null);
    setSelectedCountry(countryCode);
    setGrowthView(next);
    setCollectionExpanded(false);
    let index = growthDate ? target.events.length - 1 : -1;
    while (growthDate && index >= 0 && target.events[index].date > growthDate) index--;
    setGrowthIndex(index);
  }

  const closeGrowth = () => {setGrowthPlaying(false);setGrowthActive(false);};
  const seekGrowth = (index:number) => {setSelectedCode(null);setGrowthIndex(index);};

  async function importFile(file?: File, isDemo = false) {
    if (!file || !data || busy) return;
    if (!file.name.toLowerCase().endsWith('.csv')) { setImportError('Choose the full MyEBirdData.csv export. Extract a ZIP before selecting its CSV.'); return; }
    setGrowthPlaying(false);setGrowthActive(false);setBusy(true); setImportError(''); setProgress({ bytes: 0, totalBytes: file.size, records: 0 });
    try {
      const task = startImport(file, data.taxa, { datasetVersion: sourceValue(data.manifest, ['datasetVersion'], data.tree.version), taxonomyVersion: collection?.taxonomyVersion || '2026', onProgress: setProgress });
      cancelImport.current = task.cancel;
      const next = await task.promise;
      if (isDemo) { next.isDemo = true; next.label = 'Sample collection'; }
      setCollection(next); setSelectedCode(null); setScope('collection'); setQuery(''); setSaved(false); setSelectedCountry(null); setSelectedYear(null); setTaxonomicSelection({ ...allTaxaSelection }); canvas.current?.reset();
      setModal('report'); setNotice(`Imported ${n(next.species.filter(s => !s.code.startsWith('unresolved:')).length)} species. Review the reconciliation report.`);
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') setNotice('Import cancelled. Your previous collection is intact.');
      else setImportError(error instanceof Error ? error.message : 'Could not import that file.');
    } finally { setBusy(false); cancelImport.current = null; if (fileInput.current) fileInput.current.value = ''; }
  }
  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file || !data) return;
    setGrowthPlaying(false);setGrowthActive(false);
    try {
      const restored = parseBackup(await file.text(), { datasetVersion: sourceValue(data.manifest, ['datasetVersion'], data.tree.version), taxonomyVersion: collection?.taxonomyVersion || '2026', taxa: data.taxa });
      setCollection(restored); setSelectedCode(null); setSaved(false); setSelectedCountry(null); setSelectedYear(null); setScope('collection'); setQuery(''); setTaxonomicSelection({ ...allTaxaSelection }); canvas.current?.reset();
      setNotice('Backup restored for this session. Use Save on device to keep it.'); setModal('report');
    } catch (error) { setNotice(`Backup not restored: ${error instanceof Error ? error.message : 'Invalid backup.'}`); }
    event.target.value = '';
  }
  async function save() {
    if (!collection) return;
    try { await saveCollection(collection); setSaved(true); setNotice('Saved species aggregates on this device. Raw records and locations are not saved.'); }
    catch (error) { setNotice(`Could not save: ${error instanceof Error ? error.message : 'Browser storage unavailable.'} You can still download a backup.`); }
  }
  async function clear() {
    cancelEmbedding.current?.(); clearEmbeddingMemoryCache(); clearPackingMemoryCache();
    const layouts = clearPersistentLayoutCache();
    empty();
    const [savedCopy, cachedLayouts] = await Promise.allSettled([clearCollection(), layouts]);
    const failures = [savedCopy.status === 'rejected' ? 'the saved collection' : '', cachedLayouts.status === 'rejected' || !cachedLayouts.value ? 'cached layouts' : ''].filter(Boolean);
    setNotice(failures.length ? `Session cleared. Browser storage could not clear ${failures.join(' and ')}.` : 'Cleared the collection, its saved copy and cached layouts from this device.');
  }
  function focusGroup(rank: TaxonomicRank) {
    if (!selected) return;
    const value = rank === 'genus' ? genusOf(selected) : selected[rank];
    if (value) chooseGroup(rank, value);
  }
  async function exportImage() {
    if(exporting)return;
    setExporting(true);
    setGrowthPlaying(false);
    // Commit the paused frame before the exporter awaits any artwork loads.
    await new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
    try {
      const subtitle = [
        `${n(displayMode === 'umap' ? recordedSpecies : groupRecordedCount)} species`,
        countryCollection?.name || 'All countries',
        periodLabel || 'All years',
        activeGroup && (displayMode === 'umap' ? `${n(groupRecordedCount)} highlighted in ${activeGroup}` : activeGroup),
        growthActive && (growthDate ? `As of ${growthDate}` : 'Before the first recorded bird'),
        selected?.commonName,
      ].filter(Boolean).join(' · ');
      await canvas.current?.exportPng({ title: collection?.isDemo ? 'phyloBirds · sample collection' : 'phyloBirds · my birds', subtitle });
      setNotice('View downloaded.');
    } catch { setNotice('Could not create the image. Try resetting the view and exporting again.'); }
    finally {setExporting(false);}
  }

  if (!data || !collection) return <div className="loading-screen"><BirdMark tree/><h1>phyloBirds</h1><p>{loadError || 'Unfolding the tree of birds…'}</p>{loadError && <button className="primary" onClick={() => window.location.reload()}>Try again</button>}</div>;
  const selectedIndex = results.findIndex(t => t.code === selectedCode);
  const date = selectedObservation?.earliestDate ? new Intl.DateTimeFormat('en', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${selectedObservation.earliestDate}T00:00:00Z`)) : selectedObservation?.historicalDateCount ? 'Unspecified historical date' : 'No precise date';

  const mainTree = <TreeCanvas ref={canvas} interactive={!growthComparisonActive} backgroundTone={growthComparisonActive?'surface':'paper'} artworkPool={growthComparisonActive?sharedArtworkPool:undefined} tree={data.tree} taxa={data.taxa} observedCodes={growthActive ? growthFinalCodes : observedCodes} visibleCodes={growthActive ? growthFinalCodes : visibleCodes} growth={growthFrame} backgroundCodes={backgroundCodes} showAllBranches={showAllBranches} layoutMode={layoutMode} showTree={showTree} portraitOrder={portraitOrder} stickerColors={stickerColors || undefined} sizeMode={stickerSizeMode} stickerGeometry={stickerGeometry || undefined} focusedOrder={taxonomicSelection.order || null} focusCodes={groupFocusCodes} selectedCode={selectedCode} onSelect={code => chooseSpecies(code, false)} onSelectGroup={chooseGroup} onArtworkStatus={reportArtworkStatus} onViewChange={growthComparisonActive?undefined:setView} credits={credit}/>;
  const countryCards=countryFrames.map(({panel,frame})=>({key:panel.key,countryCode:panel.countryCode!,name:panel.name,count:frame.revealedCodes.size,total:panel.timeline.datedCount,undatedCount:panel.timeline.undatedCount,content:<TreeCanvas tree={data.tree} taxa={data.taxa} observedCodes={panel.finalCodes} visibleCodes={panel.finalCodes} growth={{...frame,date:growthDate,progress:growthFrame?.progress,durationMs:growthDuration,startedAt:growthStartedAt}} interactive={false} backgroundTone="surface" artworkPool={sharedArtworkPool} layoutMode={layoutMode} showTree sizeMode={stickerSizeMode} stickerGeometry={stickerGeometry||undefined} selectedCode={null} onSelect={()=>{}} credits={credit}/>}));
  return <div className={`app-shell app-section-${section} ${growthComparisonActive?'country-growth-open':''} ${collectionExpanded ? 'collection-open' : ''} ${exporting ? 'exporting' : ''}`} data-theme={theme}>
    <a className="skip-link" href={section === 'arboretum' ? '#arboretum-main' : '#species-search'} onClick={event => {
      if (section === 'explore') { event.preventDefault(); if (!exporting) focusSpeciesSearch(); }
    }}>{section === 'arboretum' ? 'Skip to Arboretum' : 'Skip to species search'}</a>
    <header className="masthead" inert={exporting}>
      <a className="brand" href="#" onClick={e => { e.preventDefault(); setSection('explore'); reset(); }} aria-label="phyloBirds, whole tree"><BirdMark tree/><span>phyloBirds</span><span className="brand-caption">PHYLOGENY</span></a>
      <div className="header-actions">{section === 'arboretum' && <button className="text-button map-button" onClick={() => setModal('map')}><Icon name="globe" size={17}/> World map</button>}<button className="theme-toggle" onClick={() => setThemePreference(theme === 'dark' ? 'light' : 'dark')} aria-label={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`} title={`${themePreference === 'system' ? 'Following system appearance. ' : ''}Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={19}/></button><button className="primary" aria-label="Import eBird data" onClick={() => { setModal('import'); setImportError(''); }}><Icon name="upload" size={17}/><span className="import-label-wide">Import eBird data</span><span className="import-label-narrow">Import</span></button></div>
    </header>
    <nav className="section-navigation" aria-label="Main sections"><button disabled={exporting} aria-current={section === 'explore' ? 'page' : undefined} onClick={() => setSection('explore')}>Explore</button><button disabled={exporting} aria-current={section === 'arboretum' ? 'page' : undefined} onClick={() => setSection('arboretum')}>Arboretum</button></nav>

    {section === 'arboretum' ? <main className="arboretum-main" id="arboretum-main" tabIndex={-1}><Arboretum collection={collection} tree={data.tree} taxa={data.taxa} stickerGeometry={stickerGeometry || undefined} sizeMode={stickerSizeMode} initialSelection={{country:selectedCountry,year:selectedYear,yearMode}} onOpen={openArboretumTree} onAnimate={animateGrowth} onBack={returnToExplorer} onSave={save} saved={saved} onDownloadBackup={() => downloadFile(serializeBackup(collection), 'phylobirds-collection.json', 'application/json')}/></main> : <main className="explorer">
      <aside className="collection-panel" inert={exporting} id="collection-panel" aria-label="Species collection">
        <div className="collection-intro">
          <h1>Your collection</h1>
          <button type="button" className="icon-button collection-close" aria-label="Close collection" onClick={() => {
            setCollectionExpanded(false);
            requestAnimationFrame(() => document.getElementById('find-bird')?.focus());
          }}><Icon name="close" size={16}/></button>
          {collection.isDemo && <p>Real species, sample sightings.</p>}
          <div className="collection-stats"><div><strong>{n(recordedSpecies)}</strong><span>species recorded</span></div><div><strong>{n(highlightedSourceTips)}<small> / {n(data.tree.tips.length)}</small></strong><span>source tips highlighted</span></div></div>
          <button className="report-link" onClick={() => setModal('report')}>Full import report <Icon name="arrow" size={13}/></button>
        </div>
        <div className="collection-tools">
          <div className="segmented" aria-label="Species list scope"><button aria-pressed={scope === 'collection'} onClick={() => setScope('collection')}>My birds <span>{n(activeObservations?.length || 0)}</span></button><button aria-pressed={scope === 'all'} onClick={() => {closeGrowth();setScope('all');}}>All species</button></div>
          <label className="search-box" htmlFor="species-search"><Icon name="search" size={17}/><input ref={searchInput} id="species-search" aria-label="Find a bird" type="search" value={query} placeholder="Find a bird…" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === 'ArrowDown') && results[0]) { e.preventDefault(); chooseSpecies(results[0].code); document.getElementById(`species-${results[0].code}`)?.focus(); } }}/><kbd aria-hidden="true">/</kbd></label>
          <div className="list-heading"><span>{query ? `${n(results.length)} RESULTS` : scope === 'all' ? 'GLOBAL BIRD DIVERSITY' : (activeObservations?.length || 0) > recordedSpecies ? 'SPECIES & UNRESOLVED TAXA' : 'SPECIES RECORDED'}</span><span>A–Z</span></div>
        </div>
        <div className="species-list" aria-label="Species" role="list">
          {results.slice(0, limit).map(t => <div role="listitem" key={t.code}><button id={`species-${t.code}`} className={`species-row ${selectedCode === t.code ? 'selected' : ''}`} aria-pressed={selectedCode === t.code} onClick={() => chooseSpecies(t.code)}>
            <Sticker taxon={t}/><span className="species-row-names"><strong>{t.commonName}</strong><em>{t.scientificName}</em></span><span className={`presence-dot ${observations.has(t.code) ? 'recorded' : ''} ${t.treeTip === undefined ? 'unresolved' : ''}`} title={t.treeTip === undefined ? 'Source placement unavailable' : observations.has(t.code) ? 'Recorded' : 'Not in collection'}/>
          </button></div>)}
          {!results.length && <div className="list-empty"><Icon name="search"/><p>{growthActive ? query ? 'No birds recorded by this date match your search.' : 'No birds recorded yet at this date.' : query ? 'No matching birds.' : activeGroup ? `No recorded species in ${activeGroup}.` : selectedYear !== null ? `No birds recorded ${yearMode === 'annual' ? 'during' : 'through'} ${selectedYear}${countryCollection ? ` in ${countryCollection.name}` : ''}.` : 'No birds in this collection yet.'}</p>{!growthActive && <button className="text-button" onClick={() => activeGroup ? reset() : query ? setScope('all') : selectedYear !== null ? chooseYear(null) : setModal('import')}>{activeGroup ? 'Show all recorded birds' : query ? 'Search all species' : selectedYear !== null ? 'Show all years' : 'Import eBird data'}</button>}</div>}
          {results.length > limit && <button className="load-more" onClick={() => setLimit(limit + 100)}>Show 100 more · {n(results.length - limit)} remaining</button>}
        </div>
        <div className="collection-actions"><button className="text-button" onClick={save} disabled={!collection.species.length || saved}><Icon name="save" size={15}/>{saved ? 'Saved on device' : 'Save on device'}</button><details className="more-menu"><summary aria-label="Collection options">•••</summary><div><button onClick={() => downloadFile(serializeBackup(collection), 'phylobirds-collection.json', 'application/json')}>Download backup</button><button onClick={() => backupInput.current?.click()}>Restore backup</button><button onClick={() => { closeGrowth(); setCollection(makeDemo(data.taxa, sourceValue(data.manifest, ['datasetVersion'], data.tree.version), collection.taxonomyVersion)); setScope('collection'); setQuery(''); setSaved(false); setSelectedCountry(null); setSelectedYear(null); setSelectedCode(null); reset(); }}>Load sample collection</button><button onClick={() => setThemePreference('system')} disabled={themePreference === 'system'}>{themePreference === 'system' ? 'Using system theme' : 'Use system theme'}</button><button className="danger" onClick={clear}>Clear collection, saved copy & layouts</button></div></details></div>
      </aside>

      <section className={`tree-stage display-${displayMode} ${growthComparisonActive?'country-growth-stage':''}`} aria-label={displayMode === 'tree' ? portraitOrder === 'color' ? 'Birds grouped by illustration color' : 'Interactive tree of birds' : 'Phylogenetic bird map'} data-country={countryCollection?.code || ''} data-year={selectedYear ?? ''} data-year-mode={selectedYear === null ? 'all' : yearMode} data-embedding-method={displayMode === 'umap' ? currentEmbedding?.metadata.method : undefined} data-embedding-fit-ms={displayMode === 'umap' ? currentEmbedding?.metadata.elapsedMs.toFixed(1) : undefined} data-embedding-cache-source={displayMode === 'umap' ? currentEmbedding?.metadata.cacheSource : undefined} data-embedding-cache-read-ms={displayMode === 'umap' ? currentEmbedding?.metadata.cacheReadMs?.toFixed(1) : undefined} data-embedding-load-ms={displayMode === 'umap' ? currentEmbedding?.metadata.loadMs?.toFixed(1) : undefined} data-embedding-concepts={displayMode === 'umap' ? currentEmbedding?.metadata.sourceGroupCount : undefined}>
        <div className="stage-topbar">
          <div className="view-switch" role="group" aria-label="Bird visualization">
            <button disabled={exporting} aria-pressed={displayMode === 'tree'} onClick={() => { closeGrowth(); setDisplayMode('tree'); }}>Tree</button>
            <button disabled={exporting} aria-pressed={displayMode === 'umap'} onClick={() => { closeGrowth(); setDisplayMode('umap'); }}>Bird map</button>
          </div>
          <div className="explorer-utilities">
            <button id="find-bird" className="export-button find-bird-button" disabled={exporting} aria-controls="collection-panel" aria-expanded={collectionExpanded} onClick={focusSpeciesSearch}>
              <Icon name="search" size={15}/>Find a bird
            </button>
            {!growthActive && <button id="view-settings-button" className="export-button" disabled={exporting} aria-haspopup="dialog" onClick={() => setModal('view-settings')}>View settings</button>}
          </div>
          <div className="explorer-view-actions">
            {displayMode === 'tree' && !growthActive && <button className="export-button" disabled={exporting || !canAnimate}
              title={activeGroup ? 'Animate the whole life list in this country and period' : undefined} onClick={() => animateGrowth()}>
              {selectedYear === null ? 'Animate growth' : `Animate through ${selectedYear}`}
            </button>}
            {growthActive && <button className="export-button" disabled={exporting || !stickerGeometry} onClick={() => { setGrowthPlaying(false); setModal('animation-export'); }}>
              <Icon name="download" size={16}/>Export animation
            </button>}
            <button className="export-button" onClick={exportImage} disabled={exporting || (displayMode === 'umap' ? !currentEmbedding || !stickerGeometry || !collisionMasks : portraitOrder === 'color' && !stickerColors)}>
              <Icon name="download" size={16}/>
              <span>{exporting ? 'Exporting…' : growthComparisonActive ? 'Export main frame' : growthActive ? 'Export frame' : 'Export view'}</span>
            </button>
          </div>
        </div>
        {growthActive && <fieldset className="growth-controls-wrap" disabled={exporting}>
          <GrowthTimeline timeline={growthTimeline} index={growthIndex} playing={growthPlaying} speed={growthSpeed}
            onIndexChange={seekGrowth} onPlayingChange={setGrowthPlaying} onSpeedChange={setGrowthSpeed} onClose={closeGrowth}
            countryName={countryCollection?.name} throughYear={selectedYear} title={growthComparisonActive ? 'Life lists together' : undefined}
            prominentCount={!growthComparisonActive} reducedMotion={reducedMotion}
            viewControls={<div className="growth-view-toggle" role="group" aria-label="Animation view">
              <button aria-pressed={growthView === 'single'} onClick={() => chooseGrowthView('single')}>Single tree</button>
              <button aria-pressed={growthView === 'countries'} onClick={() => chooseGrowthView('countries')}>All countries together</button>
            </div>}/>
        </fieldset>}
        {!growthActive && <fieldset className="explore-scope" aria-label="View scope" disabled={exporting}>
          <div className="scope-row">
            <label className="scope-field" htmlFor="period-year">
              <span className="scope-label">Year</span>
              <select id="period-year" className="scope-input" value={selectedYear === null ? '' : `${yearMode}:${selectedYear}`}
                disabled={!yearOptions.length} aria-describedby={legacyYearView ? 'legacy-year-note' : undefined} onChange={event => {
                  const [mode, year] = event.target.value.split(':');
                  chooseYear(year ? Number(year) : null, mode === 'annual' ? 'annual' : 'cumulative');
                }}>
                <option value="">All years</option>
                <optgroup label="Growing life list">
                  {yearOptions.map(year => <option key={year} value={`cumulative:${year}`}>Through {year}</option>)}
                </optgroup>
                {hasYearHistory && <optgroup label="Each year">
                  {yearOptions.map(year => <option key={year} value={`annual:${year}`}>During {year}</option>)}
                </optgroup>}
              </select>
            </label>
            <div className="scope-taxon">
              <label className="scope-field" htmlFor="phylogenetic-level">
                <span className="scope-label">{displayMode === 'umap' ? 'Highlight birds' : 'Filter tree'}</span>
                <select id="phylogenetic-level" className="scope-input" title={activeGroup || pickerPrompt} value=""
                  onChange={event => {
                    if (event.target.value === '@all') applyTaxonomy({ ...allTaxaSelection });
                    else if (event.target.value) chooseGroup(pickerRank, event.target.value);
                  }}>
                  <option value="">{activeGroup || 'All groups'}</option>
                  {activeGroup && <option value="@all">All groups</option>}
                  {pickerOptions.length > 0 && <optgroup label={pickerPrompt}>
                    {pickerOptions.map(option => <option key={option.value} value={option.value}>{option.value} ({n(option.recorded)})</option>)}
                  </optgroup>}
                </select>
              </label>
              {activeGroup && <button type="button" className="level-up" title="Zoom out one level" aria-label="Zoom out one phylogenetic level"
                onClick={() => {
                  applyTaxonomy(parentTaxonomicSelection(taxonomicSelection));
                  document.getElementById('phylogenetic-level')?.focus();
                }}><Icon name="arrow" size={15}/></button>}
            </div>
          </div>
          <div className="scope-summary" role="status">
            {countryCollection && `${countryCollection.name} · `}
            {displayMode === 'umap' && activeGroup
              ? `${n(groupRecordedCount)} of ${n(recordedSpecies)} species highlighted`
              : `${n(groupRecordedCount)} species${groupMappedCount < groupRecordedCount ? ` · ${n(groupMappedCount)} with source coverage` : ''}`}
          </div>
          {legacyYearView && <p className="scope-summary" id="legacy-year-note">Year uses first sightings. Checklist counts cover the full export. Reimport your eBird CSV for annual history.</p>}
        </fieldset>}
        {displayMode === 'umap' && <div className="embedding-notes">
          <details><summary>How to read Bird map</summary>
            <p>Birds are placed on the map using phylogenetic data, with closely related birds being placed together. Try selecting a group to see how it is distributed on the map!</p>
            {unplacedTaxa.length > 0 && <p>Birds without a tree placement appear separately.</p>}
          </details>
        </div>}
        {growthComparisonActive ? <CountryGrowthGrid main={mainTree} countries={countryCards} onOpenCountry={countryCode => {
          chooseGrowthView('single', countryCode);
          requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('.growth-play')?.focus());
        }} mainCount={growthRevealedCodes.size} mainTotal={growthTimeline.datedCount} mainUndatedCount={growthTimeline.undatedCount} playing={growthPlaying} throughYear={selectedYear}/> : <div className={`plot-region ${selected ? 'has-details' : ''}`} inert={exporting}>
        <div className="tree-controls" aria-label="View navigation"><button onClick={() => canvas.current?.zoomIn()} aria-label="Zoom in" title="Zoom in"><Icon name="plus"/></button><button onClick={() => canvas.current?.zoomOut()} aria-label="Zoom out" title="Zoom out"><Icon name="minus"/></button><span/><button onClick={reset} aria-label={displayMode === 'tree' ? 'Reset to whole tree' : 'Reset to all clusters'} title="All birds"><Icon name="reset" size={18}/></button></div>
        <div className="tree-canvas-wrap">{displayMode === 'tree' ? portraitOrder === 'color' && !stickerColors ? <div className="embedding-state" role="status"><strong>{colorError ? 'Illustration colors unavailable' : 'Preparing illustration colors…'}</strong>{colorError && <><p>{colorError}</p><button className="text-button" onClick={() => setColorAttempt(attempt => attempt + 1)}>Retry colors</button></>}</div> : mainTree : currentEmbedding && stickerGeometry && collisionMasks ? <ClusterCanvas ref={canvas} points={currentEmbedding.points} embeddingMetadata={currentEmbedding.metadata} collisionMasks={collisionMasks || undefined} taxa={data.taxa} unplacedTaxa={unplacedTaxa} stickerGeometry={stickerGeometry} sizeMode={stickerSizeMode} placementMode="full" portraitScale={1} highlightedCodes={activeGroup ? visibleCodes : undefined} highlightedLabel={activeGroup || undefined} selectedCode={selectedCode} onSelect={code => chooseSpecies(code, false)} onArtworkStatus={reportArtworkStatus} onViewChange={setView} credits={credit}/> : <div className="embedding-state" role="status">{!stickerGeometry || !collisionMasks ? <><strong>{geometryError || collisionError ? 'Sticker measurements unavailable' : 'Loading sticker sizes and collision outlines…'}</strong>{(geometryError || collisionError) && <><p>{geometryError || collisionError}</p><button className="text-button" onClick={() => { setGeometryAttempt(attempt => attempt + 1); setCollisionAttempt(attempt => attempt + 1); }}>Retry measurements</button></>}</> : embeddingPhase === 'running' || embeddingPhase === 'idle' ? <><strong>Finding your birds’ neighborhoods…</strong><span>{embeddingProgress?.stage === 'distances' ? 'Measuring distances along the source tree' : embeddingProgress?.stage === 'neighbors' ? 'Finding nearby species' : embeddingProgress?.stage === 'mds' ? 'Refining all evolutionary distances with MDS' : 'Finding UMAP starting positions'}</span><progress max="100" value={embeddingProgress?.percent || 0}/><button className="text-button" onClick={() => cancelEmbedding.current?.()}>Cancel</button></> : <><strong>{embeddingPhase === 'cancelled' ? 'Map cancelled' : 'Map unavailable'}</strong>{embeddingError && <p>{embeddingError}</p>}<button className="text-button" onClick={() => setEmbeddingAttempt(attempt => attempt + 1)}>Try again</button></>}</div>}</div>
        {displayMode === 'tree' && activeGroup && !groupMappedCount && !showAllBranches && <div className="tree-empty"><p>{groupRecordedCount ? 'The recorded birds in this group have no source placement yet.' : `No birds recorded in ${activeGroup}.`}</p><button className="text-button" onClick={reset}>Show all recorded birds</button></div>}
        {selected && <article className="species-card" aria-label={`Details for ${selected.commonName}`}>
          <div className="card-top"><span className="eyebrow">{selectedObservation ? countryCollection ? `RECORDED IN ${countryCollection.name.toLocaleUpperCase()}` : 'IN YOUR COLLECTION' : 'DISCOVER THE TREE'}</span><button className="icon-button" aria-label="Close species details" onClick={() => setSelectedCode(null)}><Icon name="close" size={15}/></button></div>
          <div className="species-card-identity"><Sticker taxon={selected} size="large"/><div><h3>{selected.commonName}</h3><em>{selected.scientificName}</em></div></div>
          <p className="mapping-status">{mappingLabels[selected.mappingStatus]}</p>
          {selected.mappingNote && selected.mappingStatus !== 'exact' && <details className="placement-details"><summary>Placement details</summary><p className="mapping-note">{selected.mappingNote}</p></details>}
          {displayMode === 'umap' && currentEmbedding && !currentEmbedding.points.some(point => point.code === selected.code) && <p className="mapping-note">{unplacedTaxa.some(taxon => taxon.code === selected.code) ? 'Shown in the separate unplaced area. No phylogenetic position is assigned.' : 'This bird is outside the current country’s cluster view.'}</p>}
          {selectedObservation ? <div className="observation-stats"><div><span>EARLIEST IN VIEW</span><strong>{date}</strong></div><div><span>{legacyYearView ? 'CHECKLISTS · FULL EXPORT' : growthActive ? 'CHECKLISTS · FULL PERIOD' : 'CHECKLISTS IN VIEW'}</span><strong>{n(selectedObservation.checklistCount)}</strong></div></div> : <p className="not-recorded">This species is not in the current view.</p>}
          {selectedObservation && (selectedObservation.missingDateCount > 0 || selectedObservation.historicalDateCount > 0) && <p className="date-note">{n(selectedObservation.missingDateCount)} missing or invalid dates · {n(selectedObservation.historicalDateCount)} historical placeholders</p>}
          <div className="card-clades">{selected.order && <button title={selected.order} onClick={() => focusGroup('order')}>Order <Icon name="arrow" size={12}/></button>}{selected.family && <button title={selected.family} onClick={() => focusGroup('family')}>Family <Icon name="arrow" size={12}/></button>}{genusOf(selected) && <button title={genusOf(selected)} onClick={() => focusGroup('genus')}>Genus <Icon name="arrow" size={12}/></button>}</div>
          <div className="card-footer"><span>{selected.sticker ? 'AI illustration · CC BY 4.0' : 'Artwork unavailable · fallback marker'}</span><div><button aria-label="Previous species" className="icon-button previous" onClick={() => results.length && chooseSpecies(results[(selectedIndex - 1 + results.length) % results.length].code)}><Icon name="arrow" size={14}/></button><button aria-label="Next species" className="icon-button" onClick={() => results.length && chooseSpecies(results[(selectedIndex + 1) % results.length].code)}><Icon name="arrow" size={14}/></button></div></div>
        </article>}
        </div>}
        <div className="stage-bottom">
          <div className="legend">
            {displayMode === 'tree' && <>
              <span>{showTree ? <><i className="recorded"/>Recorded ancestry</> : portraitOrder === 'color' ? 'Color within orders' : 'Birds in phylogenetic order'}</span>
              {showTree && showAllBranches && <span><i/>Other branches</span>}
              {growthActive && <span><i className="growing-branch"/>New branches</span>}
            </>}
          </div>
          <span className="artwork-loading" role="status">{artworkStatus.queued + artworkStatus.active > 0 ? 'Loading bird illustrations…' : artworkStatus.failed ? `${n(artworkStatus.failed)} illustrations unavailable` : ''}</span>
          <div className="stage-bottom-tools">
            {displayMode === 'tree' && showTree && <TreeScaleLegend mode={layoutMode} rootAge={data.tree.maxDistance} scale={growthComparisonActive ? undefined : view.branchScale}/>}
            <button id="country-map-shortcut" type="button" className="world-map-shortcut" disabled={exporting}
              aria-label={`Open world map · ${countryCollection?.name || 'All countries'}`} aria-haspopup="dialog" onClick={() => setModal('map')}>
              <span className="world-map-land" aria-hidden="true"/>
              <span>{countryCollection?.name || 'All countries'}</span>
            </button>
          </div>
        </div>
      </section>
    </main>}
    <footer className="site-footer" inert={exporting}>
      <span><Icon name="shield" size={13}/> Processed on this device</span>
      <SourcesBox taxonomyVersion={collection.taxonomyVersion} onExpand={() => setGrowthPlaying(false)}/>
      <span>eBird/Clements {collection.taxonomyVersion}</span>
    </footer>
    <input ref={backupInput} type="file" accept=".json,application/json" className="visually-hidden" aria-label="Restore collection backup" onChange={restore}/>
    {notice && <div className="toast" role="status"><span>{notice}</span><button aria-label="Dismiss notification" onClick={() => setNotice('')}><Icon name="close" size={16}/></button></div>}

    {modal === 'animation-export' && <Dialog title="Export animation" wide onClose={()=>setModal(null)}><Suspense fallback={<p role="status">Preparing animation export…</p>}><AnimationExport collection={collection} tree={data.tree} taxa={data.taxa} geometry={stickerGeometry||undefined} sizeMode={stickerSizeMode} layoutMode={layoutMode} theme={theme} year={selectedYear} includeCountriesByDefault={growthComparisonActive}/></Suspense></Dialog>}
    {modal === 'view-settings' && <Dialog title="View settings" onClose={() => {
      setModal(null);
      requestAnimationFrame(() => document.getElementById('view-settings-button')?.focus({ preventScroll: true }));
    }}>
      {displayMode === 'tree' && showTree && <p className="view-settings-help">True distance shows the estimated divergence timelines, compact makes the tree visually smaller and clearer.</p>}
      <div className="view-settings-options">
        {displayMode === 'tree' && showTree && portraitOrder === 'phylogeny' && <div className="layout-control">
          <span>Branch lengths</span>
          <div className="layout-toggle" role="group" aria-label="Branch length layout">
            <button aria-pressed={layoutMode === 'compact'} onClick={() => setLayoutMode('compact')} title="Shortened branches; not a time scale">Compact</button>
            <button aria-pressed={layoutMode === 'true-distance'} onClick={() => setLayoutMode('true-distance')} title="Published divergence distances">True distance</button>
          </div>
        </div>}
        <div className="layout-control sticker-size-control">
          <span>Bird sizes</span>
          <div className="layout-toggle" role="group" aria-label="Sticker size scaling">
            <button aria-pressed={stickerSizeMode === 'even'} onClick={() => setStickerSizeMode('even')} title="Body-mass differences evened out, with silhouette-area correction">Averaged size</button>
            <button aria-pressed={stickerSizeMode === 'true'} onClick={() => setStickerSizeMode('true')} title="Cube-root mass scaling, with silhouette-area correction">True size</button>
          </div>
        </div>
        {displayMode === 'tree' && <>
          <label className="bird-order-control">
            <span>Bird order</span>
            <select value={portraitOrder} onChange={event => {
              const order = event.target.value as 'phylogeny' | 'color';
              setPortraitOrder(order);
              if (order === 'color') setShowTree(false);
            }}>
              <option value="phylogeny">Phylogenetic</option>
              <option value="color">Color within orders</option>
            </select>
          </label>
          <label className="branch-toggle">
            <input type="checkbox" checked={showTree} onChange={event => {
              setShowTree(event.target.checked);
              if (event.target.checked) setPortraitOrder('phylogeny');
            }}/><span>Show tree</span>
          </label>
          {portraitOrder === 'phylogeny' && <label className="branch-toggle">
            <input type="checkbox" checked={showAllBranches} disabled={!showTree} onChange={event => setShowAllBranches(event.target.checked)}/><span>Show other branches</span>
          </label>}
        </>}
      </div>
    </Dialog>}
    {modal === 'map' && <Dialog title={`Birds by country${periodLabel ? ` · ${periodLabel}` : ''}`} map onClose={() => {
      setModal(null);
      requestAnimationFrame(() => document.getElementById('country-map-shortcut')?.focus({ preventScroll: true }));
    }}><CountryMap countries={periodCountries} selectedCountry={countryCollection?.code ?? null} onSelectCountry={chooseCountry} hasCountryData={collection.countries !== undefined} onImport={() => { setModal('import'); setImportError(''); }}/></Dialog>}

    {modal === 'import' && <Dialog title="Bring your birds into the tree" onClose={() => { if (!busy) setModal(null); }}>
      <p className="dialog-lead">Start with your full eBird observation export. Your file is read here, on this device.</p>
      <ol className="import-steps"><li>Open <a href="https://ebird.org/downloadMyData" target="_blank" rel="noreferrer">My eBird → Download My Data ↗</a>.</li><li>Request your data, then download and extract the ZIP.</li><li>Choose <strong>MyEBirdData.csv</strong> below.</li></ol>
      <div className={`dropzone ${busy ? 'busy' : ''}`} onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; }} onDrop={e => { e.preventDefault(); void importFile(e.dataTransfer.files[0]); }}>
        <Icon name="upload" size={30}/><strong>{busy ? `Reading ${n(progress.records)} records…` : 'Drop your eBird CSV here'}</strong><span>{busy ? `${Math.min(100, Math.round(progress.bytes / Math.max(1, progress.totalBytes) * 100))}% read` : 'or choose a file from your computer'}</span>
        <input ref={fileInput} id="csv-file" type="file" accept=".csv,text/csv" className="visually-hidden" aria-label="Choose MyEBirdData.csv" disabled={busy} onChange={e => void importFile(e.target.files?.[0])}/>
        {busy ? <><progress max={progress.totalBytes || 1} value={progress.bytes}/><button className="secondary" onClick={() => cancelImport.current?.()}>Cancel import</button></> : <button className="primary" onClick={() => fileInput.current?.click()}>Choose CSV file</button>}
      </div>
      {importError && <p className="error-message" role="alert">{importError}</p>}
      <p className="privacy-note"><Icon name="shield" size={18}/>Coordinates, location names, comments and checklist IDs are never saved. Country-level species summaries support the map. Importing replaces the session collection when it finishes. Use Save on device to keep the result.</p>
      <p className="fine-print">The total is species recorded in your export. It may differ from eBird’s official life list, which applies additional eligibility rules. <a href="https://support.ebird.org/en/support/solutions/articles/48000838205-download-ebird-data" target="_blank" rel="noreferrer">Export help ↗</a></p>
      <button className="text-button" disabled={busy} onClick={async () => { try { const response = await fetch('/demo/MyEBirdData-sample.csv'); if (!response.ok) throw new Error('Sample file unavailable.'); await importFile(new File([await response.blob()], 'MyEBirdData-sample.csv', { type: 'text/csv' }), true); } catch { setImportError('Could not read the local sample CSV.'); } }}>Try the invented sample CSV instead <Icon name="arrow" size={12}/></button>
    </Dialog>}
    {modal === 'report' && <Dialog title="Full import report" onClose={() => setModal(null)} wide>
      <p className="report-scope">Results for your full import.</p>
      <div className="report-summary"><div><strong>{n(collection.report.totalRecords)}</strong><span>input records</span></div><div><strong>{n(collection.species.length)}</strong><span>distinct reported taxa</span></div><div><strong>{n(reportMappedSpecies)}</strong><span>with source coverage</span></div><div><strong>{n(collection.report.excludedRecords)}</strong><span>excluded records</span></div></div>
      {collection.isDemo && <p className="info-box">Real species, sample sightings.</p>}
      <p>{n(collection.report.acceptedRecords)} accepted · {n(collection.report.excludedRecords)} excluded · {n(collection.report.unresolvedRecords)} unresolved</p>
      <dl className="report-counts"><div><dt>Resolved species recorded</dt><dd>{n(reportRecordedSpecies)}</dd></div><div><dt>Exact concepts or documented renames</dt><dd>{n(exactCount)}</dd></div><div><dt>Changed concepts with source coverage</dt><dd>{n(reportMappedSpecies - exactCount)}</dd></div><div><dt>Distinct highlighted source tips</dt><dd>{n(new Set(collection.species.flatMap(s => { const t = taxaByCode.get(s.code); return t?.treeTips || (t?.treeTip !== undefined ? [t.treeTip] : []); })).size)}</dd></div><div><dt>Taxa without a source placement</dt><dd>{n(collection.species.length - reportMappedSpecies)}</dd></div><div><dt>Duplicate species / checklist rows</dt><dd>{n(collection.report.duplicateRecords)}</dd></div><div><dt>Invalid / missing / historical dates</dt><dd>{n(collection.report.invalidDateRecords)} / {n(collection.report.missingDateRecords)} / {n(collection.report.historicalDateRecords)}</dd></div><div><dt>Species without local artwork</dt><dd>{n(collection.species.filter(s => !taxaByCode.get(s.code)?.sticker).length)}</dd></div><div><dt>Countries represented</dt><dd>{collection.countries === undefined ? 'Reimport to enable' : n(collection.countries.length)}</dd></div>{collection.report.countryUnassignedRecords !== undefined && <div><dt>Accepted/unresolved records without a reliable country</dt><dd>{n(collection.report.countryUnassignedRecords)}</dd></div>}</dl>
      <details className="report-counting-help">
        <summary>How records are counted</summary>
        <p>Each checklist counts once per species. Repeated rows still count toward the file total. Species totals may differ from eBird.</p>
        <p>Checklist counts use positive counts or “X”. January 1, 1900 is treated as an unknown date. Birds grouped together in the source tree share a placement.</p>
      </details>
      <h3>Import messages <span className="muted">({n(collection.report.issues.length)})</span></h3>
      <p className="fine-print">Coverage uses current taxonomy. Reimport to refresh row messages.</p>
      {collection.report.issues.length ? <div className="report-table-wrap"><table><thead><tr><th>CSV row</th><th>Reported taxon</th><th>Treatment</th><th>Reason</th></tr></thead><tbody>{collection.report.issues.slice(0, 300).map((issue, i) => <tr key={i}><td>{issue.row}</td><td>{issue.name || '—'}</td><td><span className="treatment">{issue.disposition}</span></td><td>{issue.reason}{issue.count && issue.count > 1 ? ` (${n(issue.count)} records)` : ''}</td></tr>)}</tbody></table>{collection.report.issues.length > 300 && <p>Showing the first 300 issues. Download the report for all recorded issues.</p>}</div> : <p className="info-box">No records need attention.</p>}
      <div className="dialog-actions"><button className="secondary" onClick={() => downloadFile(JSON.stringify(collection.report, null, 2), 'phylobirds-import-report.json', 'application/json')}><Icon name="download" size={15}/>Download report</button><button className="secondary" onClick={() => {setModal(null);setSection('arboretum');}}>Open Arboretum</button><button className="primary" onClick={() => {setModal(null);setSection('explore');}}>Explore the tree</button></div>
    </Dialog>}
  </div>;
}
