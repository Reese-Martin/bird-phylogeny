import type { ReactNode } from 'react';
import { sources } from '../sources';
import './SourcesBox.css';

function External({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noreferrer">{children}</a>;
}

export function SourcesBox({ taxonomyVersion, onExpand }: { taxonomyVersion: string; onExpand: () => void }) {
  return <details className="sources-box" onToggle={event => { if (event.currentTarget.open) onExpand(); }}>
    <summary>Sources</summary>
    <div className="sources-panel">
      <dl className="sources-list">
        <div>
          <dt>Tree</dt>
          <dd>Relationships and estimated dates from Aves 1.7, based on Clements 2025. <External href={sources.treePaper}>McTavish et al. (2025)</External> · <External href={sources.avesData}>AvesData</External> · <External href={sources.creativeCommons}>CC BY 4.0</External></dd>
        </div>
        <div>
          <dt>Taxonomy</dt>
          <dd>Species names follow eBird/Clements {taxonomyVersion}. <External href={sources.taxonomy}>Cornell Lab checklist and citation</External> · <External href="/data/coverage.json">Tree coverage</External></dd>
        </div>
        <div>
          <dt>World map</dt>
          <dd><External href={sources.map}>Natural Earth 1:110m country boundaries</External> · <External href={sources.mapTerms}>Public domain</External></dd>
        </div>
        <div>
          <dt>Illustrations</dt>
          <dd>AI portraits by <External href={sources.stickers}>huashu-bird-sticker</External>, resized and trimmed by <External href={sources.resizedStickers}>Everybird</External>. phyloBirds makes smaller thumbnails from that pack. <External href={sources.creativeCommons}>CC BY 4.0</External></dd>
        </div>
        <div>
          <dt>Bird sizes</dt>
          <dd>Relative sizes adapt <External href={sources.sizing}>Everybird’s mass and silhouette method</External>. Body masses come mainly from <External href={sources.avonet}>AVONET (Tobias et al., 2022)</External>, with values from <External href={sources.birdbase}>BIRDBASE (Şekercioğlu et al., 2025)</External> and estimates for some species.</dd>
        </div>
        <div>
          <dt>Inspiration</dt>
          <dd><External href={sources.everybird}>Everybird by Yusuf Taleb</External> inspired the illustrated life list and visual design. The stacked radial portraits were inspired by <External href={sources.radialInspiration}>McCullough et al. (2026)</External>.</dd>
        </div>
      </dl>
      <p className="sources-records"><External href="/data/manifest.json">Source manifest</External> · <External href="/data/tree-audit.json">Tree audit</External> · <a href="/data/tree-citations.csv" download>Supporting tree studies</a></p>
    </div>
  </details>;
}
