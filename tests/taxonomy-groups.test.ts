import { describe, expect, it } from 'vitest';
import type { Taxon } from '../src/types';
import { allTaxaSelection, genusOf, matchesTaxonomy, nextTaxonomicRank, parentTaxonomicSelection, selectTaxonomicGroup, taxonomicOptions } from '../src/taxonomy/groups';

const taxa: Taxon[] = [
  { code: 'fulmar', commonName: 'Northern Fulmar', scientificName: 'Fulmarus glacialis', category: 'species', order: 'Procellariiformes', family: 'Procellariidae', treeTip: 1, mappingStatus: 'exact' },
  { code: 'shearwater', commonName: 'Sooty Shearwater', scientificName: 'Ardenna grisea', category: 'species', order: 'Procellariiformes', family: 'Procellariidae', treeTip: 2, mappingStatus: 'exact' },
  { code: 'petrel', commonName: 'Giant Petrel', scientificName: 'Macronectes giganteus', category: 'species', order: 'Procellariiformes', family: 'Procellariidae', mappingStatus: 'unresolved' },
  { code: 'albatross', commonName: 'Albatross', scientificName: 'Diomedea exulans', category: 'species', order: 'Procellariiformes', family: 'Diomedeidae', treeTip: 3, mappingStatus: 'exact' },
  { code: 'crow', commonName: 'Crow', scientificName: 'Corvus brachyrhynchos', category: 'species', order: 'Passeriformes', family: 'Corvidae', treeTip: 4, mappingStatus: 'exact' },
  { code: 'group', commonName: 'Crow group', scientificName: 'Corvus sp.', category: 'spuh', order: 'Passeriformes', family: 'Corvidae', mappingStatus: 'unresolved' },
];

describe('taxonomic navigation', () => {
  it('drills through one picker and moves back one selected level at a time', () => {
    expect(nextTaxonomicRank(allTaxaSelection)).toBe('order');
    const order = selectTaxonomicGroup(taxa, allTaxaSelection, 'order', 'Procellariiformes');
    expect(nextTaxonomicRank(order)).toBe('family');
    const family = selectTaxonomicGroup(taxa, order, 'family', 'Procellariidae');
    expect(nextTaxonomicRank(family)).toBe('genus');
    const genus = selectTaxonomicGroup(taxa, family, 'genus', 'Ardenna');
    expect(parentTaxonomicSelection(genus)).toEqual(family);
    expect(parentTaxonomicSelection(family)).toEqual(order);
    expect(parentTaxonomicSelection(order)).toEqual(allTaxaSelection);
  });
  it('filters an order and then its family without including other birds', () => {
    const order = selectTaxonomicGroup(taxa, allTaxaSelection, 'order', 'Procellariiformes');
    expect(taxa.filter(t => matchesTaxonomy(t, order)).map(t => t.code)).toEqual(['fulmar', 'shearwater', 'petrel', 'albatross']);
    const family = selectTaxonomicGroup(taxa, order, 'family', 'Procellariidae');
    expect(taxa.filter(t => matchesTaxonomy(t, family)).map(t => t.code)).toEqual(['fulmar', 'shearwater', 'petrel']);
  });
  it('infers parents when selecting a genus directly and clears descendants when changing order', () => {
    const selection = selectTaxonomicGroup(taxa, allTaxaSelection, 'genus', 'Ardenna');
    expect(selection).toEqual({ order: 'Procellariiformes', family: 'Procellariidae', genus: 'Ardenna' });
    expect(taxa.filter(t => matchesTaxonomy(t, selection)).map(t => t.code)).toEqual(['shearwater']);
    expect(selectTaxonomicGroup(taxa, selection, 'order', 'Passeriformes')).toEqual({ order: 'Passeriformes', family: '', genus: '' });
  });
  it('counts recorded species separately from source coverage and excludes non-species categories', () => {
    const options = taxonomicOptions(taxa, 'family', allTaxaSelection, new Set(['fulmar', 'petrel', 'group']));
    expect(options.find(o => o.value === 'Procellariidae')).toEqual({ value: 'Procellariidae', recorded: 2, total: 3 });
    expect(options.find(o => o.value === 'Corvidae')).toBeUndefined();
  });
  it('keeps other parent choices available and avoids impossible genus guesses', () => {
    const selection = { order: 'Procellariiformes', family: 'Procellariidae', genus: 'Ardenna' };
    const recorded = new Set(['crow', 'fulmar', 'albatross']);
    expect(taxonomicOptions(taxa, 'order', selection, recorded).map(o => o.value)).toEqual(['Passeriformes', 'Procellariiformes']);
    expect(taxonomicOptions(taxa, 'family', selection, recorded).map(o => o.value)).toEqual(['Diomedeidae', 'Procellariidae']);
    expect(genusOf({ ...taxa[0], scientificName: 'unidentified bird' })).toBe('');
    expect(selectTaxonomicGroup(taxa, selection, 'genus', 'NotInTaxonomy')).toEqual(selection);
  });
  it('only offers ranks represented in the active country, including unresolved source placements', () => {
    const recorded = new Set(['petrel']);
    expect(taxonomicOptions(taxa, 'order', allTaxaSelection, recorded).map(o => o.value)).toEqual(['Procellariiformes']);
    expect(taxonomicOptions(taxa, 'family', allTaxaSelection, recorded).map(o => o.value)).toEqual(['Procellariidae']);
    expect(taxonomicOptions(taxa, 'genus', allTaxaSelection, recorded).map(o => o.value)).toEqual(['Macronectes']);
    expect(taxonomicOptions(taxa, 'order', allTaxaSelection, new Set())).toEqual([]);
  });
});
