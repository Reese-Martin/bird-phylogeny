import { useId, type ReactNode } from 'react';
import './Arboretum.css';
import './CountryGrowthGrid.css';

export interface CountryGrowthCard {
  key: string;
  countryCode?: string;
  name: string;
  count: number;
  total: number;
  undatedCount?: number;
  content: ReactNode;
}

export interface CountryGrowthGridProps {
  main: ReactNode;
  countries: CountryGrowthCard[];
  mainCount: number;
  mainTotal: number;
  mainUndatedCount?: number;
  mainControls?: ReactNode;
  playing: boolean;
  throughYear?: number | null;
  onOpenCountry?: (countryCode: string | null) => void;
}

function GrowthCard({ card, main = false, playing, controls, throughYear, onOpenCountry }: { card: CountryGrowthCard; main?: boolean; playing: boolean; controls?: ReactNode; throughYear?:number|null; onOpenCountry?: (countryCode: string | null) => void }) {
  const headingId = useId();
  const canOpen = Boolean(onOpenCountry && (main || card.countryCode));
  return <section className={`arboretum-card country-growth-card${main ? ' country-growth-card--main' : ''}${canOpen ? ' country-growth-card--clickable' : ''}`} aria-labelledby={headingId} data-country={card.countryCode || ''} data-growth-panel={card.key} data-growth-count={card.count} data-growth-total={card.total}>
    <div className="arboretum-card-art country-growth-art">
      <svg className="arboretum-preview country-growth-sizing" viewBox="0 0 200 200" aria-hidden="true" focusable="false"/>
      <div className="country-growth-plot" inert={canOpen}>
        {card.content}
        {!card.count && <span className="country-growth-empty">{card.total ? 'No birds yet' : 'No dated records'}</span>}
      </div>
    </div>
    <header className="arboretum-card-copy">
      <div><h3 id={headingId}>{card.name}</h3><p>{throughYear!=null?`Through ${throughYear}`:main?'All dated species':'Dated life list'}</p></div>
      <span className="arboretum-card-count country-growth-count" aria-live={playing ? 'off' : 'polite'} aria-atomic="true" aria-label={`${card.count.toLocaleString()} of ${card.total.toLocaleString()} dated species`}><strong>{card.count.toLocaleString()}</strong><small>of {card.total.toLocaleString()} species</small></span>
    </header>
    <div className="arboretum-card-open country-growth-card-status">
      <span>{card.undatedCount ? `${card.undatedCount.toLocaleString()} undated species excluded` : !card.total ? 'No dated records' : playing ? 'Growing' : card.count===card.total ? 'Complete' : 'Paused'}</span>
      {canOpen && <span className="country-growth-open-hint" aria-hidden="true">Open tree ↗</span>}
      {controls && <div className="country-growth-main-controls">{controls}</div>}
    </div>
    {canOpen && <button type="button" className="country-growth-open-button" onClick={() => onOpenCountry!(main ? null : card.countryCode!)} aria-label={`Open ${card.name} tree`} title={`Open ${card.name} as a single tree`}><span className="visually-hidden">Open {card.name} tree</span></button>}
  </section>;
}

/** One shared date controls every supplied tree; cards retain their own final layout. */
export function CountryGrowthGrid({ main, countries, mainCount, mainTotal, mainUndatedCount = 0, mainControls, playing, throughYear, onOpenCountry }: CountryGrowthGridProps) {
  return <section className="country-growth-view" aria-label="Synchronized country tree growth">
    <p className="country-growth-context">One shared date; first sightings are specific to each country{throughYear != null ? ` · through ${throughYear}` : ''}.</p>
    <div className="arboretum-grid country-growth-grid">
      <GrowthCard main playing={playing} controls={mainControls} throughYear={throughYear} onOpenCountry={onOpenCountry} card={{key:'all',name:'All countries',count:mainCount,total:mainTotal,undatedCount:mainUndatedCount,content:main}}/>
      {countries.map(card => <GrowthCard key={card.key} card={card} playing={playing} throughYear={throughYear} onOpenCountry={onOpenCountry}/>)}
    </div>
    {!countries.length && <p className="country-growth-no-countries">Import an eBird export with country information to add these trees.</p>}
  </section>;
}
