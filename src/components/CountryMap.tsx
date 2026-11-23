import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from 'd3-zoom';
import type { CountryCollection } from '../types';
import './CountryMap.css';

interface CountryShape { id: string; code: string | null; name: string; path: string }
interface WorldCountries { schemaVersion: 1; viewBox: [number, number, number, number]; projection: string; countries: CountryShape[] }
export interface CountryMapProps {
  countries: CountryCollection[];
  selectedCountry: string | null;
  onSelectCountry: (code: string | null) => void;
  hasCountryData: boolean;
  onImport?: () => void;
}

export function recordedCountrySpecies(country: CountryCollection) {
  return country.species.filter(species => !species.code.startsWith('unresolved:')).length;
}

export function countrySearchMatches(country: CountryCollection, query: string) {
  const clean = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase('en');
  return clean(`${country.name} ${country.code}`).includes(clean(query.trim()));
}

export function isCountrySelected(shapeCode: string | null, selectedCode: string | null) {
  return Boolean(shapeCode && selectedCode && shapeCode === selectedCode);
}

const number = (value: number) => value.toLocaleString();

export function CountryMap({ countries, selectedCountry, onSelectCountry, hasCountryData, onImport }: CountryMapProps) {
  const [map, setMap] = useState<WorldCountries | null>(null);
  const [mapError, setMapError] = useState('');
  const [query, setQuery] = useState('');
  const [hoveredCode, setHoveredCode] = useState<string | null>(null);
  const [transform, setTransform] = useState<ZoomTransform>(zoomIdentity);
  const svg = useRef<SVGSVGElement>(null);
  const zoomBehavior = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const id = useId().replace(/:/g, '');
  const clipId = `country-map-clip-${id}`;
  const titleId = `country-map-title-${id}`;
  const descriptionId = `country-map-description-${id}`;
  const inputId = `country-map-search-${id}`;
  const counts = useMemo(() => new Map(countries.map(country => [country.code.toUpperCase(), recordedCountrySpecies(country)])), [countries]);
  const byCode = useMemo(() => new Map(countries.map(country => [country.code.toUpperCase(), country])), [countries]);
  const maximum = Math.max(1, ...counts.values());
  const totalSpecies = useMemo(() => new Set(countries.flatMap(country => country.species.filter(species => !species.code.startsWith('unresolved:')).map(species => species.code))).size, [countries]);
  const sorted = useMemo(() => [...countries].sort((a, b) => recordedCountrySpecies(b) - recordedCountrySpecies(a) || a.name.localeCompare(b.name)), [countries]);
  const filtered = useMemo(() => sorted.filter(country => countrySearchMatches(country, query)), [sorted, query]);
  const mapCodes = useMemo(() => new Set(map?.countries.flatMap(country => country.code ? [country.code] : [])), [map]);
  const listOnly = useMemo(() => map ? countries.filter(country => !mapCodes.has(country.code.toUpperCase())) : [], [map, countries, mapCodes]);
  const focusedCountry = byCode.get(hoveredCode || selectedCountry || '');

  useEffect(() => {
    const controller = new AbortController();
    fetch('/data/world-countries.json', { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error(`Map data could not be loaded (${response.status}).`);
      const data = await response.json() as WorldCountries;
      if (data.schemaVersion !== 1 || !Array.isArray(data.countries) || data.countries.some(country => typeof country.path !== 'string')) throw new Error('The local country map has an unsupported format.');
      setMap(data);
    }).catch(error => { if (!controller.signal.aborted) setMapError(error instanceof Error ? error.message : 'Map data is unavailable.'); });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const element = svg.current;
    if (!element || !map) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .extent([[0, 0], [1000, 500]])
      .translateExtent([[-25, -15], [1025, 515]])
      .scaleExtent([1, 8])
      .clickDistance(5)
      .on('zoom', event => setTransform(event.transform));
    zoomBehavior.current = behavior;
    select(element).call(behavior).on('dblclick.zoom', null);
    return () => { select(element).on('.zoom', null); zoomBehavior.current = null; };
  }, [map]);

  function selectCountry(code: string) {
    onSelectCountry(selectedCountry === code ? null : code);
  }
  function zoomMap(factor: number) {
    if (svg.current && zoomBehavior.current) select(svg.current).call(zoomBehavior.current.scaleBy, factor);
  }
  function resetMap() {
    if (svg.current && zoomBehavior.current) select(svg.current).call(zoomBehavior.current.transform, zoomIdentity);
  }

  return <section className="country-map" aria-label="Choose a country from your observations">
    <div className="country-map-intro">
      <p>Choose a country to explore your birds there.</p>
      {hasCountryData && <span>{number(countries.length)} countries · {number(totalSpecies)} species</span>}
    </div>
    {!hasCountryData && <div className="country-map-import-note">
      <div><strong>Add your country trees</strong><p>Reimport your full eBird CSV to add country history.</p></div>
      {onImport && <button className="primary" onClick={onImport}>Import eBird data</button>}
    </div>}
    <div className="country-map-layout">
      <div className="country-map-figure">
        <div className="country-map-world">
          {map ? <svg ref={svg} viewBox="0 0 1000 500" role="group" aria-labelledby={`${titleId} ${descriptionId}`}>
            <title id={titleId}>World map of recorded bird species by country</title>
            <desc id={descriptionId}>Shaded countries have observations in this export. Select a shaded country, or choose it from the country list. Drag to pan and scroll to zoom.</desc>
            <defs><clipPath id={clipId}><rect width="1000" height="500"/></clipPath></defs>
            <g clipPath={`url(#${clipId})`}>
              <g transform={transform.toString()}>
                <g className="country-map-grid" aria-hidden="true">{[166.67, 333.33, 500, 666.67, 833.33].map(x => <line key={`x${x}`} x1={x} y1="0" x2={x} y2="500"/>)}{[125, 250, 375].map(y => <line key={`y${y}`} x1="0" y1={y} x2="1000" y2={y}/>)}</g>
                {map.countries.map(shape => {
                  const country = shape.code ? byCode.get(shape.code) : undefined;
                  const count = country ? counts.get(country.code.toUpperCase()) || 0 : 0;
                  const available = Boolean(country);
                  const selected = isCountrySelected(shape.code, selectedCountry);
                  const name = country?.name || shape.name;
                  const opacity = selected ? 1 : available ? .25 + .5 * Math.sqrt(count / maximum) : 1;
                  return <path key={shape.id} d={shape.path} fillRule="evenodd" vectorEffect="non-scaling-stroke"
                    className={`country-map-shape ${available ? 'has-records' : ''} ${selected ? 'is-selected' : ''}`}
                    style={{ fillOpacity: opacity }}
                    role={available ? 'button' : undefined} tabIndex={available ? 0 : undefined}
                    aria-hidden={!available || undefined} aria-pressed={available ? selected : undefined}
                    aria-label={available ? `Map: ${name}, ${number(count)} recorded species` : undefined}
                    onMouseEnter={() => setHoveredCode(country?.code || null)} onMouseLeave={() => setHoveredCode(null)}
                    onFocus={() => setHoveredCode(country?.code || null)} onBlur={() => setHoveredCode(null)}
                    onClick={available && shape.code ? () => selectCountry(shape.code!) : undefined}
                    onKeyDown={event => { if (available && shape.code && ['Enter', ' '].includes(event.key)) { event.preventDefault(); event.stopPropagation(); selectCountry(shape.code); } }}>
                    <title>{available ? `${name}: ${number(count)} recorded species` : `${shape.name}: no observations in this export`}</title>
                  </path>;
                })}
              </g>
            </g>
          </svg> : <div className="country-map-loading" role="status">{mapError || 'Loading the world map…'}</div>}
          {map && <div className="country-map-zoom" aria-label="World map navigation"><button onClick={() => zoomMap(1.6)} aria-label="Zoom map in" title="Zoom in">+</button><button onClick={() => zoomMap(1 / 1.6)} aria-label="Zoom map out" title="Zoom out">−</button><button onClick={resetMap} aria-label="Reset world map" title="Reset world map">↺</button></div>}
        </div>
        <div className="country-map-readout" role="status">{focusedCountry ? <><strong>{focusedCountry.name}</strong><span>{number(recordedCountrySpecies(focusedCountry))} recorded species</span></> : <span>Shaded countries contain birds from your export.</span>}</div>
        <div className="country-map-legend"><span><i className="country-map-key-recorded"/>Recorded here</span><span><i className="country-map-key-selected"/>Selected country</span><span>Drag to pan · Scroll to zoom</span></div>
        <p className="country-map-credit">Map by <a href="https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/" target="_blank" rel="noreferrer">Natural Earth</a> · Public domain</p>
        {listOnly.length > 0 && <p className="country-map-scale-note">Use the list to select small territories.</p>}
      </div>
      <div className="country-map-picker">
        <button className={`country-map-all ${selectedCountry === null ? 'is-selected' : ''}`} onClick={() => onSelectCountry(null)} aria-pressed={selectedCountry === null}><span>All countries</span><span>{number(totalSpecies)} species</span></button>
        <label className="country-map-search" htmlFor={inputId}><span>Find a country</span><input id={inputId} type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Country or code" autoComplete="off"/></label>
        <ul className="country-map-country-list" aria-label="Countries in your export">
          {filtered.map(country => <li key={country.code}><button onClick={() => selectCountry(country.code)} aria-pressed={selectedCountry === country.code} className={selectedCountry === country.code ? 'is-selected' : ''} aria-label={`${country.name}, ${number(recordedCountrySpecies(country))} recorded species`}><span className="country-map-country-name">{country.name}{map && !mapCodes.has(country.code.toUpperCase()) && <small>List only</small>}</span><span className="country-map-country-count">{number(recordedCountrySpecies(country))}</span></button></li>)}
        </ul>
        {!filtered.length && <p className="country-map-no-results">{query ? 'No matching countries in this export.' : hasCountryData ? 'No country records are available in this collection.' : 'Import a CSV to add your countries.'}</p>}
      </div>
    </div>
    <p className="country-map-privacy">Country totals only.</p>
  </section>;
}
