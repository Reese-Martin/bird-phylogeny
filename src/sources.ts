export const sources = {
  treePaper: 'https://doi.org/10.1073/pnas.2409658122',
  avesData: 'https://github.com/McTavishLab/AvesData/tree/4af84f14f8f3df26bd4480202689b08ea0fc2c48',
  taxonomy: 'https://www.birds.cornell.edu/clementschecklist/introduction/updateindex/october-2025/2026-citation-checklist-downloads/',
  map: 'https://www.naturalearthdata.com/downloads/110m-cultural-vectors/110m-admin-0-countries/',
  mapTerms: 'https://www.naturalearthdata.com/about/terms-of-use/',
  stickers: 'https://github.com/alchaincyf/huashu-bird-sticker',
  resizedStickers: 'https://github.com/yusuftaleb/everybird-stickers/tree/b7749a623585b18320cb0e0271da63ee20c701c0',
  everybird: 'https://github.com/yusuftaleb/everybird',
  sizing: 'https://github.com/yusuftaleb/everybird/blob/50510c2209280b9f259545d8ab08e13970d5f8e6/src/lib/layout/pack.ts',
  avonet: 'https://doi.org/10.1111/ele.13898',
  birdbase: 'https://doi.org/10.1038/s41597-025-05615-3',
  radialInspiration: 'https://doi.org/10.1016/j.cub.2026.10.056',
  creativeCommons: 'https://creativecommons.org/licenses/by/4.0/',
} as const;

export const exportCredits = [
  'Tree: McTavish et al. (2025), Aves 1.7 · doi.org/10.1073/pnas.2409658122.',
  'AI portraits: huashu-bird-sticker · github.com/alchaincyf/huashu-bird-sticker · resized by Everybird · github.com/yusuftaleb/everybird-stickers.',
  'CC BY 4.0 · creativecommons.org/licenses/by/4.0/.',
  'Taxonomy: eBird/Clements 2026. Sizing: Everybird method, AVONET and BIRDBASE masses.',
].join(' ');
