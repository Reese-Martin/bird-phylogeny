import type { Taxon } from '../types';

export type TaxonomicRank = 'order' | 'family' | 'genus';
export interface TaxonomicSelection { order: string; family: string; genus: string }
export const allTaxaSelection: TaxonomicSelection = { order: '', family: '', genus: '' };

/** The single picker offers the children of the currently selected group. */
export function nextTaxonomicRank(selection: TaxonomicSelection): TaxonomicRank {
  return selection.family ? 'genus' : selection.order ? 'family' : 'order';
}

export function parentTaxonomicSelection(selection: TaxonomicSelection): TaxonomicSelection {
  if (selection.genus) return { ...selection, genus: '' };
  if (selection.family) return { order: selection.order, family: '', genus: '' };
  return { ...allTaxaSelection };
}

export function genusOf(taxon: Taxon): string {
  const genus = taxon.scientificName.trim().split(/\s+/)[0] || '';
  return /^[A-Z][a-z]+$/.test(genus) ? genus : '';
}

export function rankValue(taxon: Taxon, rank: TaxonomicRank): string {
  return rank === 'genus' ? genusOf(taxon) : taxon[rank] || '';
}

export function matchesTaxonomy(taxon: Taxon, selection: TaxonomicSelection): boolean {
  return (!selection.order || taxon.order === selection.order)
    && (!selection.family || taxon.family === selection.family)
    && (!selection.genus || genusOf(taxon) === selection.genus);
}

/** Lower ranks never restrict the choices for a parent rank. */
export function taxonomicOptions(taxa: Taxon[], rank: TaxonomicRank, selection: TaxonomicSelection, recorded: Set<string>): Array<{ value: string; recorded: number; total: number }> {
  const parents = rank === 'order' ? allTaxaSelection
    : rank === 'family' ? { order: selection.order, family: '', genus: '' }
    : { order: selection.order, family: selection.family, genus: '' };
  const options = new Map<string, { value: string; recorded: number; total: number }>();
  for (const taxon of taxa) {
    if (taxon.category !== 'species' || !matchesTaxonomy(taxon, parents)) continue;
    const value = rankValue(taxon, rank); if (!value) continue;
    const item = options.get(value) || { value, recorded: 0, total: 0 };
    item.total++; if (recorded.has(taxon.code)) item.recorded++;
    options.set(value, item);
  }
  return [...options.values()].filter(option => option.recorded > 0).sort((a, b) => a.value.localeCompare(b.value));
}

/** Selecting a child identifies its unique parents; clearing a parent clears its descendants. */
export function selectTaxonomicGroup(taxa: Taxon[], current: TaxonomicSelection, rank: TaxonomicRank, value: string): TaxonomicSelection {
  if (rank === 'order') return { order: value, family: '', genus: '' };
  if (!value) return rank === 'family' ? { order: current.order, family: '', genus: '' } : { ...current, genus: '' };
  const members = taxa.filter(t => t.category === 'species' && rankValue(t, rank) === value);
  if (!members.length) return { ...current };
  const uniqueParent = (parent: 'order' | 'family'): string => {
    const values = new Set(members.map(t => t[parent]).filter((v): v is string => !!v));
    return values.size === 1 ? [...values][0] : '';
  };
  return rank === 'family'
    ? { order: uniqueParent('order'), family: value, genus: '' }
    : { order: uniqueParent('order'), family: uniqueParent('family'), genus: value };
}
