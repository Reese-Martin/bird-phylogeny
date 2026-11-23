import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { Collection, Taxon, TreeData } from '../src/types';
import { TreeCanvas, type ArtworkStatus, type TreeCanvasHandle, type ViewInfo } from '../src/tree/TreeCanvas';
import type { LayoutMode } from '../src/tree/geometry';
import { startImport } from '../src/import/client';

interface LoadedData { tree: TreeData; taxa: Taxon[]; datasetVersion: string; taxonomyVersion: string }
type Metrics = Record<string, unknown>;
const round = (value: number) => Number(value.toFixed(2));
const frame = () => new Promise<number>(resolve => requestAnimationFrame(resolve));
const readTreeMetrics = () => ({ ...((window as unknown as { __phylogenyPerformance?: Record<string, number> }).__phylogenyPerformance ?? {}) });
const pause = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));
function memoryMetrics() {
  const memory = (performance as Performance & { memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number } }).memory;
  return memory ? {
    supported: true, usedJSHeapBytes: memory.usedJSHeapSize, totalJSHeapBytes: memory.totalJSHeapSize, jsHeapLimitBytes: memory.jsHeapSizeLimit,
    note: 'Chromium performance.memory is optional and approximate. Decoded images, canvas backing stores, compositor/GPU memory and total process memory are not fully represented.',
  } : { supported: false, note: 'This browser does not expose performance.memory. No process-memory estimate is inferred.' };
}
function viewportMetrics() {
  const element = document.querySelector<HTMLCanvasElement>('.tree canvas');
  const keys = ['artworkQueued', 'artworkActive', 'artworkReady', 'artworkFailed', 'artworkHits', 'artworkVisibleReady', 'artworkVisiblePending', 'artworkVisibleFailed', 'artworkEvictions', 'orderRepresentatives', 'orderRepresentativesTotal', 'speciesStickers', 'requestedArtwork', 'layoutMode', 'timeScale'];
  return { window: `${innerWidth} × ${innerHeight}`, canvasCss: element ? `${element.clientWidth} × ${element.clientHeight}` : 'not mounted', canvasPixels: element ? `${element.width} × ${element.height}` : 'not mounted', devicePixelRatio, visibility: document.visibilityState, rendererAttributes: element ? Object.fromEntries(keys.map(key => [key, element.dataset[key] ?? null])) : {} };
}
const quote = (value: string) => `"${value.replace(/"/g, '""')}"`;
const eligibleTaxa = (taxa: Taxon[]) => taxa.filter(taxon => taxon.category === 'species' && taxon.treeTip !== undefined && ['exact', 'renamed'].includes(taxon.mappingStatus));

/** Generated synthetic CSVs stay in memory and never pass through a server or storage. */
function syntheticFile(taxa: Taxon[], speciesCount: number, rowCount = speciesCount): File {
  const eligible = eligibleTaxa(taxa);
  const rows = ['Submission ID,Common Name,Scientific Name,Count,Date,Location,Latitude,Longitude,Observation Details'];
  for (let i = 0; i < rowCount; i++) {
    const taxon = eligible[i % speciesCount];
    rows.push([`QA-${i % 10000}`, taxon.commonName, taxon.scientificName, i % 7 ? '1' : 'X', '2024-06-01', 'SYNTHETIC QA PLACE', '0', '0', 'SYNTHETIC QA COMMENT'].map(quote).join(','));
  }
  return new File([rows.join('\n')], `synthetic-${speciesCount}-species-${rowCount}-rows.csv`, { type: 'text/csv' });
}

function privacyMetrics() {
  const resources = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
  const external = resources.filter(resource => {
    try { return new URL(resource.name).origin !== location.origin; } catch { return true; }
  });
  return {
    observedResourceRequests: resources.length,
    externalResourceRequests: external.length,
    externalResourceUrls: external.map(resource => resource.name),
    note: 'Resource timing covers page/worker assets, not request bodies. The harness never saves collections or uploads files. Import worker source performs no network requests.',
  };
}

function BrowserQa() {
  const [loaded, setLoaded] = useState<LoadedData | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Loading prepared local data…');
  const [metrics, setMetrics] = useState<Metrics>({});
  const [layoutMode, setLayoutMode] = useState<LayoutMode>('compact');
  const canvas = useRef<TreeCanvasHandle>(null);
  const loadedRef = useRef<LoadedData | null>(null);
  const collectionRef = useRef<Collection | null>(null);
  const sceneReported = useRef(false);
  const navigationRunning = useRef(false);
  const navigationCancel = useRef(false);
  const cancelWorker = useRef<(() => void) | null>(null);
  const artworkStatus = useRef<ArtworkStatus | null>(null);
  const artworkUpdates = useRef(0);
  const mode = useRef(layoutMode);
  mode.current = layoutMode;
  loadedRef.current = loaded;
  collectionRef.current = collection;

  useEffect(() => {
    let active = true;
    const started = performance.now();
    Promise.all(['tree', 'taxa', 'manifest'].map(async name => {
      const response = await fetch(`/data/${name}.json`);
      if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
      return response.json();
    })).then(async ([tree, taxa, manifest]) => {
      const fontsStarted = performance.now();
      await document.fonts.load('500 14px Manrope');
      if (!active) return;
      setLoaded({ tree, taxa, datasetVersion: manifest.datasetVersion, taxonomyVersion: manifest.taxonomyVersion });
      setMetrics({
        environment: { userAgent: navigator.userAgent, platform: navigator.platform, hardwareConcurrency: navigator.hardwareConcurrency, deviceMemoryGiB: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 'unavailable', viewport: `${innerWidth} × ${innerHeight}`, devicePixelRatio, visibility: document.visibilityState },
        dataLoadMs: round(performance.now() - started), sourceTips: tree.tips.length, reportableTaxa: taxa.length,
        datasetVersion: manifest.datasetVersion, taxonomyVersion: manifest.taxonomyVersion,
        fontReady: document.fonts.check('500 14px Manrope'), fontWaitMs: round(performance.now() - fontsStarted),
        layoutMode: mode.current, memory: memoryMetrics(),
      });
      setStatus('Prepared data ready. Select a worker import or navigation test.');
    }).catch(error => { if (active) setStatus(`ERROR: ${error instanceof Error ? error.message : String(error)}`); });
    return () => { active = false; cancelWorker.current?.(); navigationCancel.current = true; };
  }, []);

  const observed = useMemo(() => new Set(collection?.species.map(species => species.code)), [collection]);
  const readArtwork = useCallback(() => artworkStatus.current ? { ...artworkStatus.current, statusUpdates: artworkUpdates.current } : { status: 'not reported', statusUpdates: artworkUpdates.current }, []);
  const onArtwork = useCallback((status: ArtworkStatus) => { artworkStatus.current = status; artworkUpdates.current++; }, []);
  const updateMetrics = useCallback(() => setMetrics(current => ({ ...current, layoutMode: mode.current, tree: readTreeMetrics(), artwork: readArtwork(), memory: memoryMetrics(), viewport: viewportMetrics(), privacy: privacyMetrics() })), [readArtwork]);
  const onView = useCallback((_view: ViewInfo) => {
    if (!sceneReported.current) {
      sceneReported.current = true;
      // Snapshot on the following paint so initial canvas metrics are present.
      requestAnimationFrame(() => updateMetrics());
    }
  }, [updateMetrics]);

  async function changeLayout(next: LayoutMode) {
    if (busy) return;
    setBusy(true); setLayoutMode(next);
    await frame(); await frame();
    canvas.current?.reset();
    await frame(); await frame();
    updateMetrics();
    setStatus(`${next === 'compact' ? 'Compact' : 'True-distance'} layout ready; ${observed.size.toLocaleString()} recorded species.`);
    setBusy(false);
  }

  async function waitForVisibleArtwork() {
    if (!loaded || busy) return;
    setBusy(true); setStatus('Waiting for visible artwork to decode (up to 10 seconds)…');
    const started = performance.now();
    const before = readArtwork();
    const beforeMemory = memoryMetrics();
    await frame(); await frame();
    let stableSince: number | null = null;
    let settled = false;
    while (performance.now() - started < 10000) {
      const current = artworkStatus.current;
      const idle = current && current.visibleQueued === 0 && current.visibleActive === 0;
      if (idle) {
        stableSince ??= performance.now();
        if (performance.now() - stableSince >= 120) { settled = true; break; }
      } else stableSince = null;
      await pause(40);
    }
    await frame();
    const after = readArtwork();
    const run = { test: 'visible-artwork-settlement', layoutMode: mode.current, recordedSpecies: observed.size, settled, timedOut: !settled, elapsedMs: round(performance.now() - started), before, after, memoryBefore: beforeMemory, memoryAfter: memoryMetrics(), tree: readTreeMetrics(), viewport: viewportMetrics(), privacy: privacyMetrics(), note: 'Settlement waits for the current visible queue and active decodes to reach zero. Failures are reported separately; zero pending does not mean every image exists. Already cached images can settle without a new request.' };
    setMetrics(current => ({ ...current, latestArtworkWait: run, artworkWaitRuns: [...((current.artworkWaitRuns as unknown[]) ?? []), run], layoutMode: mode.current, tree: readTreeMetrics(), artwork: after, memory: memoryMetrics(), viewport: viewportMetrics(), privacy: privacyMetrics() }));
    const status = artworkStatus.current;
    setStatus(`${settled ? 'PASS' : 'TIMEOUT'}: visible artwork ${settled ? 'settled' : 'still pending'} in ${run.elapsedMs} ms; ${status?.visibleReady ?? 0} ready, ${status?.visibleFailed ?? 0} failed, ${status?.visibleQueued ?? 0} queued, ${status?.visibleActive ?? 0} decoding.`);
    setBusy(false);
  }

  async function focusIllustratedSpecies() {
    if (!loaded || busy) return;
    const candidate = loaded.taxa.find(taxon => observed.has(taxon.code) && taxon.sticker && taxon.treeTip !== undefined);
    if (!candidate) { setStatus('Import a collection containing an illustrated species first.'); return; }
    setSelected(candidate.code); canvas.current?.focusSpecies(candidate.code);
    await frame(); await frame();
    updateMetrics(); setStatus('An illustrated recorded species is in view. Wait for visible artwork to check decode/cache state.');
  }

  async function runImport(speciesCount: number, rows = speciesCount, cancel = false) {
    const data = loadedRef.current;
    if (!data || busy) return;
    setBusy(true); setStatus(cancel ? 'Starting and cancelling a large real worker import…' : `Importing ${rows.toLocaleString()} generated rows in a browser worker…`);
    const previous = collectionRef.current;
    const file = syntheticFile(data.taxa, speciesCount, rows);
    const progressSamples: Array<{ elapsedMs: number; bytes: number; totalBytes: number; records: number }> = [];
    const started = performance.now();
    const task = startImport(file, data.taxa, {
      datasetVersion: data.datasetVersion, taxonomyVersion: data.taxonomyVersion,
      label: file.name, importedAt: '2026-11-17T12:00:00.000Z',
      onProgress: progress => progressSamples.push({ elapsedMs: round(performance.now() - started), ...progress }),
    });
    cancelWorker.current = task.cancel;
    if (cancel) task.cancel();
    try {
      const result = await task.promise;
      const elapsedMs = round(performance.now() - started);
      const json = JSON.stringify(result);
      const privateMarkersAbsent = !['SYNTHETIC QA PLACE', 'SYNTHETIC QA COMMENT', 'QA-0', 'Latitude', 'Longitude'].some(marker => json.includes(marker));
      const passed = !cancel && result.report.totalRecords === rows && result.species.length === speciesCount && result.report.unresolvedRecords === 0 && result.report.excludedRecords === 0 && privateMarkersAbsent;
      setCollection(result); setSelected(null); canvas.current?.reset();
      await frame(); await frame();
      const run = { test: 'worker-import', layoutMode: mode.current, passed, requestedSpecies: speciesCount, requestedRows: rows, inputBytes: file.size, workerElapsedMs: elapsedMs, normalizedSpecies: result.species.length, report: { ...result.report, issues: `${result.report.issues.length} grouped issues` }, privateMarkersAbsent, progressEvents: progressSamples.length, progressSamples, treeAfterImport: readTreeMetrics(), artworkAfterImport: readArtwork(), memoryAfterImport: memoryMetrics(), viewport: viewportMetrics(), privacyAfterImport: privacyMetrics() };
      setMetrics(current => ({ ...current, latestImport: run, importRuns: [...((current.importRuns as unknown[]) ?? []), run], layoutMode: mode.current, tree: readTreeMetrics(), artwork: readArtwork(), memory: memoryMetrics(), viewport: viewportMetrics(), privacy: privacyMetrics() }));
      setStatus(`${passed ? 'PASS' : 'FAIL'}: ${speciesCount.toLocaleString()} species / ${rows.toLocaleString()} rows in ${elapsedMs} ms. Real File + Web Worker completed.`);
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      const preserved = collectionRef.current === previous;
      const run = { test: 'cancel-worker-import', passed: cancel && aborted && preserved, inputBytes: file.size, elapsedMs: round(performance.now() - started), errorName: error instanceof Error ? error.name : 'unknown', priorCollectionPreserved: preserved };
      setMetrics(current => ({ ...current, latestCancellation: run, privacy: privacyMetrics() }));
      setStatus(`${run.passed ? 'PASS' : 'FAIL'}: ${aborted ? 'Worker cancelled' : String(error)}; prior collection ${preserved ? 'preserved' : 'CHANGED'}.`);
    } finally { cancelWorker.current = null; setBusy(false); }
  }

  async function runNavigation() {
    if (!loaded || busy) return;
    setBusy(true); setStatus('Running 180 animation-frame zoom changes. Keep this tab visible.');
    navigationRunning.current = true; navigationCancel.current = false;
    canvas.current?.reset();
    await frame(); await frame();
    const before = readTreeMetrics();
    const artworkBefore = readArtwork();
    const memoryBefore = memoryMetrics();
    const frameTimes: number[] = [];
    const drawSamples: number[] = [];
    let lastScene = before.sceneCount;
    let peakActiveDecodes = artworkStatus.current?.active ?? 0;
    let peakVisibleQueued = artworkStatus.current?.visibleQueued ?? 0;
    const visibilitySamples = new Set<string>();
    const started = await frame();
    let previous = started;
    for (let i = 0; i < 180 && !navigationCancel.current; i++) {
      const timestamp = await frame();
      frameTimes.push(timestamp - previous);
      previous = timestamp;
      visibilitySamples.add(document.visibilityState);
      const scene = readTreeMetrics();
      if (scene.sceneCount !== lastScene) { drawSamples.push(scene.latestDrawMs); lastScene = scene.sceneCount; }
      peakActiveDecodes = Math.max(peakActiveDecodes, artworkStatus.current?.active ?? 0);
      peakVisibleQueued = Math.max(peakVisibleQueued, artworkStatus.current?.visibleQueued ?? 0);
      // Six zoom steps in and six out keep every source branch and its geometry stable.
      if (i % 12 < 6) canvas.current?.zoomIn(); else canvas.current?.zoomOut();
    }
    await frame(); await frame();
    const elapsed = previous - started;
    const after = readTreeMetrics();
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const framesDrawn = (after.sceneCount ?? 0) - (before.sceneCount ?? 0);
    const run = {
      test: 'navigation-180-frames', layoutMode: mode.current, requestedFrames: 180, measuredFrameIntervals: frameTimes.length,
      elapsedMs: round(elapsed), rafFramesPerSecond: round(frameTimes.length * 1000 / Math.max(1, elapsed)),
      medianRafIntervalMs: round(sorted[Math.floor(sorted.length / 2)] ?? 0), p95RafIntervalMs: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] ?? 0),
      intervalsOver33_3Ms: frameTimes.filter(time => time > 1000 / 30).length,
      treeScenesDrawn: framesDrawn, sceneDrawsPerSecond: round(framesDrawn * 1000 / Math.max(1, elapsed)),
      visibilitySamples: [...visibilitySamples], sourceTips: loaded.tree.tips.length, recordedSpecies: observed.size,
      treeBefore: before, treeAfter: after,
      sampledDraws: drawSamples.length, meanSampledDrawMs: round(drawSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, drawSamples.length)), maxSampledDrawMs: round(Math.max(0, ...drawSamples)),
      peakActiveDecodes, peakVisibleQueued, artworkBefore, artworkAfter: readArtwork(), memoryBefore, memoryAfter: memoryMetrics(), viewport: viewportMetrics(),
      note: 'RAF rate measures callbacks on this visible page. Scene rate counts actual canvas draw invocations; neither alone proves compositor presentation FPS. Background/occluded tabs invalidate responsiveness interpretation.',
    };
    setMetrics(current => ({ ...current, latestNavigation: run, navigationRuns: [...((current.navigationRuns as unknown[]) ?? []), run], layoutMode: mode.current, tree: readTreeMetrics(), artwork: readArtwork(), memory: memoryMetrics(), viewport: viewportMetrics(), privacy: privacyMetrics() }));
    setStatus(`Navigation complete (${mode.current}): ${run.rafFramesPerSecond} RAF/s, ${run.sceneDrawsPerSecond} canvas scenes/s; ${observed.size.toLocaleString()} recorded species.`);
    navigationRunning.current = false; setBusy(false);
  }

  return <main>
    <style>{`@font-face{font-family:Manrope;font-style:normal;font-weight:400 700;font-display:swap;src:url('/fonts/manrope-latin.woff2') format('woff2')}main{font-family:Manrope,system-ui,sans-serif}.mode-controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.mode-controls button[aria-pressed=true]{border-color:#92140c;color:#92140c;font-weight:700}.artwork-readout{font:12px/1.5 ui-monospace,monospace;color:#5f5f69}`}</style>
    <h1>Everybird local browser QA</h1>
    <p>Development-only test page. Synthetic data, real prepared tree, real browser worker. Production Vite build includes only the app entry.</p>
    <div className="controls">
      <button disabled={!loaded || busy} onClick={() => void runImport(100)}>Import 100 species</button>
      <button disabled={!loaded || busy} onClick={() => void runImport(1000)}>Import 1,000 species</button>
      <button disabled={!loaded || busy} onClick={() => void runImport(5000)}>Import 5,000 species</button>
      <button disabled={!loaded || busy} onClick={() => void runImport(100, 100000)}>Import 100,000 rows</button>
      <button disabled={!loaded || busy} onClick={() => void runImport(100, 100000, true)}>Cancel large import</button>
      <button disabled={!loaded || busy} onClick={() => void runNavigation()}>Run navigation benchmark</button>
      <button disabled={!loaded || busy} onClick={() => { canvas.current?.reset(); updateMetrics(); }}>Reset view</button>
      <button onClick={updateMetrics}>Refresh metrics</button>
    </div>
    <div className="mode-controls" aria-label="Renderer profiling controls">
      <button disabled={!loaded || busy} aria-pressed={layoutMode === 'compact'} onClick={() => void changeLayout('compact')}>Compact layout</button>
      <button disabled={!loaded || busy} aria-pressed={layoutMode === 'true-distance'} onClick={() => void changeLayout('true-distance')}>True-distance layout</button>
      <button disabled={!loaded || busy || !observed.size} onClick={() => void focusIllustratedSpecies()}>Show a visible sticker</button>
      <button disabled={!loaded || busy} onClick={() => void waitForVisibleArtwork()}>Wait for visible artwork</button>
    </div>
    <p role="status" className="status">{status}</p>
    <p className="artwork-readout" aria-label="Renderer mode and artwork counters">Layout: {layoutMode} · Visible artwork: {artworkStatus.current?.visibleReady ?? 0} ready / {artworkStatus.current?.visibleFailed ?? 0} failed / {artworkStatus.current?.visibleQueued ?? 0} queued / {artworkStatus.current?.visibleActive ?? 0} decoding. Refresh metrics for the latest snapshot.</p>
    <div className="layout"><div className="tree">{loaded && <TreeCanvas ref={canvas} tree={loaded.tree} taxa={loaded.taxa} observedCodes={observed} selectedCode={selected} onSelect={setSelected} onViewChange={onView} layoutMode={layoutMode} onArtworkStatus={onArtwork}/>}</div><pre aria-label="Browser QA measurements" id="qa-results">{JSON.stringify(metrics, null, 2)}</pre></div>
  </main>;
}

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV) root.render(<BrowserQa/>);
else root.render(<p>This QA harness is available only from the localhost development server.</p>);
