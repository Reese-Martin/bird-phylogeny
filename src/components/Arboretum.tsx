import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { Collection, SpeciesObservation, Taxon, TreeData } from '../types';
import type { StickerGeometryData, StickerSizeMode } from '../embedding/sticker-types';
import { availableYears, observationsForPeriod, undatedSpeciesCount, yearHistoryAvailable, type YearMode } from '../arboretum/history';
import { ancestryPreview } from '../arboretum/preview';
import { buildLayout, mappedTipIds, type TreeLayout } from '../tree/geometry';
import './Arboretum.css';

export type { YearMode } from '../arboretum/history';
export interface ArboretumSelection { country: string | null; year: number | null; yearMode: YearMode }
export interface ArboretumProps {
  collection: Collection;
  tree: TreeData;
  taxa: Taxon[];
  stickerGeometry?: StickerGeometryData;
  sizeMode?: StickerSizeMode;
  initialSelection?: Partial<ArboretumSelection>;
  onOpen: (selection: ArboretumSelection) => void;
  onAnimate?: (selection: ArboretumSelection) => void;
  onBack: () => void;
  onSave?: () => void;
  onDownloadBackup?: () => void;
  saved?: boolean;
}
interface TreeCardData {
  key: string;
  title: string;
  description: string;
  observations: SpeciesObservation[];
  selection: ArboretumSelection;
}
const PAGE_SIZE = 12;
const speciesLabel = (count: number) => `${count.toLocaleString()} species`;
const recordedSpeciesCount = (observations: SpeciesObservation[]) => observations.filter(observation => !observation.code.startsWith('unresolved:')).length;

function BranchPreview({ tree, layout, observations, taxaByCode }: { tree: TreeData; layout: TreeLayout; observations: SpeciesObservation[]; taxaByCode: Map<string, Taxon> }) {
  const target = useRef<SVGSVGElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!target.current || typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '160px' });
    observer.observe(target.current);
    return () => observer.disconnect();
  }, []);
  const preview = useMemo(() => visible ? ancestryPreview(tree, layout, observations.flatMap(observation => mappedTipIds(taxaByCode.get(observation.code)))) : null, [visible, tree, layout, observations, taxaByCode]);
  return <svg ref={target} className="arboretum-preview" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
    <circle className="arboretum-preview-ring" cx="100" cy="100" r="82"/>
    {preview?.path ? <path className="arboretum-preview-branches" d={preview.path}/> : preview && <text x="100" y="104" textAnchor="middle">{observations.length ? 'No source placement' : 'No recorded birds'}</text>}
  </svg>;
}

export function Arboretum({ collection, tree, taxa, initialSelection, onOpen, onAnimate, onBack, onSave, onDownloadBackup, saved = false }: ArboretumProps) {
  const [section, setSection] = useState<'countries' | 'years'>(initialSelection?.year == null ? 'countries' : 'years');
  const [country, setCountry] = useState<string | null>(initialSelection?.country ?? null);
  const [yearMode, setYearMode] = useState<YearMode>(initialSelection?.yearMode ?? 'cumulative');
  const [limit, setLimit] = useState(PAGE_SIZE);
  const countryId = useId();
  const annualAvailable = yearHistoryAvailable(collection);
  const effectiveMode = annualAvailable ? yearMode : 'cumulative';
  const countries = useMemo(() => [...(collection.countries || [])].sort((a, b) => a.name.localeCompare(b.name)), [collection]);
  const countryName = country ? countries.find(item => item.code === country)?.name || 'Selected country' : 'All countries';
  const years = useMemo(() => availableYears(collection, country), [collection, country]);
  const undated = useMemo(() => undatedSpeciesCount(collection, country), [collection, country]);
  const taxaByCode = useMemo(() => new Map(taxa.map(taxon => [taxon.code, taxon])), [taxa]);
  const layout = useMemo(() => buildLayout(tree), [tree]);
  useEffect(() => { setLimit(PAGE_SIZE); }, [section, country, effectiveMode, collection]);
  useEffect(() => {
    // Import/restore can replace the collection while this gallery stays open.
    if (country && !countries.some(item => item.code === country)) setCountry(null);
  }, [countries, country]);

  const cards = useMemo<TreeCardData[]>(() => section === 'countries' ? [
    { key: 'all-countries', title: 'All countries', description: 'Your complete collection', observations: collection.species, selection: { country: null, year: null, yearMode: 'cumulative' } },
    ...countries.map(item => ({ key: item.code, title: item.name, description: 'All recorded years', observations: item.species, selection: { country: item.code, year: null, yearMode: 'cumulative' as const } })),
  ] : [...years].reverse().map(year => ({
    key: `${country || 'all'}-${effectiveMode}-${year}`,
    title: effectiveMode === 'annual' ? String(year) : `Through ${year}`,
    description: effectiveMode === 'annual' ? `Birds recorded in ${year}` : 'Life list at year end',
    observations: observationsForPeriod(collection, { countryCode: country, year, mode: effectiveMode }),
    selection: { country, year, yearMode: effectiveMode },
  })), [section, collection, countries, years, country, effectiveMode]);
  const shown = cards.slice(0, limit);

  return <section className="arboretum" aria-labelledby="arboretum-title">
    <header className="arboretum-heading">
      <div><h1 id="arboretum-title">Arboretum</h1></div>
      <div className="arboretum-heading-actions">
        {onSave && <button type="button" className="secondary" onClick={onSave} disabled={saved || !collection.species.length} title="Save your full collection on this device">{saved ? 'Saved on device' : 'Save on device'}</button>}
        {onDownloadBackup && <button type="button" className="secondary" onClick={onDownloadBackup} title="Download a backup of your full collection">Download backup</button>}
        <button type="button" className="secondary arboretum-back" onClick={onBack}><span aria-hidden="true">←</span> Back to explorer</button>
      </div>
    </header>
    <div className="arboretum-toolbar">
      <div className="arboretum-tabs" role="group" aria-label="Browse trees by">
        <button type="button" aria-pressed={section === 'countries'} onClick={() => { setSection('countries'); setLimit(PAGE_SIZE); }}>Countries</button>
        <button type="button" aria-pressed={section === 'years'} onClick={() => { setSection('years'); setLimit(PAGE_SIZE); }}>Years</button>
      </div>
      {section === 'years' && <>
        <label className="arboretum-country" htmlFor={countryId}><span>Country</span><select id={countryId} value={country || ''} onChange={event => { setCountry(event.target.value || null); setLimit(PAGE_SIZE); }}><option value="">All countries</option>{countries.map(item => <option key={item.code} value={item.code}>{item.name}</option>)}</select></label>
        <div className="arboretum-tabs arboretum-year-modes" role="group" aria-label="Year tree type">
          <button type="button" aria-pressed={effectiveMode === 'cumulative'} onClick={() => { setYearMode('cumulative'); setLimit(PAGE_SIZE); }}>Growing life list</button>
          <button type="button" aria-pressed={effectiveMode === 'annual'} disabled={!annualAvailable} title={!annualAvailable ? 'Reimport your CSV to enable annual trees.' : undefined} onClick={() => { setYearMode('annual'); setLimit(PAGE_SIZE); }}>Each year</button>
        </div>
        {effectiveMode === 'cumulative' && onAnimate && <button type="button" className="secondary" disabled={!years.length} onClick={() => onAnimate({country,year:null,yearMode:'cumulative'})}>Animate growth</button>}
      </>}
    </div>
    <div className="arboretum-context">
      <div><h2>{section === 'countries' ? 'Trees by country' : countryName}</h2><p>{section === 'countries' ? 'Your life list, together and by country.' : effectiveMode === 'annual' ? 'Birds recorded in each calendar year.' : 'Your life list at the end of each year.'}</p></div>
      <span>{section === 'countries' ? `${countries.length.toLocaleString()} ${countries.length === 1 ? 'country' : 'countries'}` : `${years.length.toLocaleString()} ${years.length === 1 ? 'year' : 'years'}`}{collection.isDemo ? ' · invented sample' : ''}</span>
    </div>
    {section === 'years' && <p className="arboretum-period-note">Year views use dated records and current species names. Unplaced species still count.</p>}
    {section === 'years' && (!annualAvailable || undated > 0) && <p className="arboretum-note">{!annualAvailable ? 'Reimport your CSV for annual trees. This collection supports first-seen life lists only. ' : ''}{undated > 0 ? `${speciesLabel(undated)} without usable dates appear only in all-time views.` : ''}</p>}
    {section === 'countries' && !countries.length && <p className="arboretum-note">{collection.isDemo ? 'These trees use invented observations. Import your CSV to see yours.' : 'Import an eBird export with country information to add country trees.'}</p>}
    {shown.length ? <div className="arboretum-grid">{shown.map(card => <button type="button" className="arboretum-card" key={card.key} onClick={() => onOpen(card.selection)} aria-label={`Open ${card.title} tree${section === 'years' && country ? ` for ${countryName}` : ''}, ${speciesLabel(recordedSpeciesCount(card.observations))}`}>
      <div className="arboretum-card-art"><BranchPreview tree={tree} layout={layout} observations={card.observations} taxaByCode={taxaByCode}/></div>
      <div className="arboretum-card-copy"><div><h3>{card.title}</h3><p>{card.description}</p></div><span className="arboretum-card-count">{recordedSpeciesCount(card.observations).toLocaleString()}<small>species</small></span></div>
      <span className="arboretum-card-open">Explore tree <span aria-hidden="true">↗</span></span>
    </button>)}</div> : <div className="arboretum-empty"><h3>No dated records</h3><p>Try another country or import a CSV with observation dates.</p></div>}
    {limit < cards.length && <div className="arboretum-more"><button type="button" className="secondary" onClick={() => setLimit(value => value + PAGE_SIZE)}>Show {Math.min(PAGE_SIZE, cards.length - limit)} more trees</button><span>{shown.length.toLocaleString()} of {cards.length.toLocaleString()} shown</span></div>}
    <p className="arboretum-preview-note">Open a tree to see its birds. Branch-length and bird-size settings carry over.</p>
  </section>;
}
