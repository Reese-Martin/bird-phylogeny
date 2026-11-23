import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { countrySearchMatches, isCountrySelected, recordedCountrySpecies } from '../src/components/CountryMap';
import type { CountryCollection, SpeciesObservation } from '../src/types';

const require = createRequire(import.meta.url);
const { countryCode, projectRing } = require('../scripts/fetch-map.mjs');
const prepared = readFileSync(new URL('../public/data/world-countries.json', import.meta.url));
const world = JSON.parse(prepared.toString());
const manifest = JSON.parse(readFileSync(new URL('../data/map-source.json', import.meta.url), 'utf8'));
const observation = (code: string): SpeciesObservation => ({ code, originalNames: [code], earliestDate: null, checklistCount: 1, recordCount: 1, missingDateCount: 1, historicalDateCount: 0 });

describe('local country map', () => {
  it('agrees with its pinned output hash and retains all source outlines', () => {
    expect(createHash('sha256').update(prepared).digest('hex')).toBe(manifest.prepared.sha256);
    expect(world.countries).toHaveLength(177);
    expect(new Set(world.countries.map((country: {id: string}) => country.id)).size).toBe(177);
    expect(world.countries.filter((country: {code: string | null}) => country.code)).toHaveLength(175);
  });

  it('keeps France and Norway through the source EH identifiers', () => {
    expect(countryCode({ ISO_A2: '-99', ISO_A2_EH: 'FR' })).toBe('FR');
    expect(countryCode({ ISO_A2: '-99', ISO_A2_EH: 'NO' })).toBe('NO');
    expect(countryCode({ ISO_A2: '-99', ISO_A2_EH: '-99' })).toBeNull();
    expect(world.countries.find((country: {name: string}) => country.name === 'France').code).toBe('FR');
    expect(world.countries.find((country: {name: string}) => country.name === 'Norway').code).toBe('NO');
  });

  it('clips a country crossing the antimeridian into short independent outlines', () => {
    const paths: string[] = projectRing([[179, -10], [-179, -10], [-179, 10], [179, 10], [179, -10]]);
    expect(paths).toHaveLength(2);
    for (const path of paths) {
      const points = [...path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
      const xs = points.map(point => point[0]);
      expect(Math.max(...xs) - Math.min(...xs)).toBeLessThan(3);
      expect(path.endsWith('Z')).toBe(true);
    }
  });

  it('has finite, bounded projected paths for every prepared country', () => {
    for (const country of world.countries) {
      expect(country.path).not.toMatch(/NaN|Infinity/);
      expect(country.path).toMatch(/^M/);
      expect(country.path).toMatch(/Z$/);
      for (const match of country.path.matchAll(/[ML]([\d.-]+),([\d.-]+)/g)) {
        expect(Number(match[1])).toBeGreaterThanOrEqual(0);
        expect(Number(match[1])).toBeLessThanOrEqual(1000);
        expect(Number(match[2])).toBeGreaterThanOrEqual(0);
        expect(Number(match[2])).toBeLessThanOrEqual(500);
      }
    }
  });

  it('reports resolved species separately from unresolved taxa in country totals', () => {
    const country: CountryCollection = { code: 'FR', name: 'France', species: [observation('mallar3'), observation('unresolved:unknown')] };
    expect(recordedCountrySpecies(country)).toBe(1);
  });

  it('searches country names and codes with accent-insensitive matching', () => {
    const country: CountryCollection = { code: 'CI', name: 'Côte d’Ivoire', species: [] };
    expect(countrySearchMatches(country, 'cote')).toBe(true);
    expect(countrySearchMatches(country, 'CI')).toBe(true);
    expect(countrySearchMatches(country, 'Canada')).toBe(false);
  });

  it('does not paint unassigned outlines as selected when all countries are shown', () => {
    const unassigned = world.countries.filter((country: {code: string | null}) => country.code === null);
    expect(unassigned).toHaveLength(2);
    expect(unassigned.every((country: {code: null}) => !isCountrySelected(country.code, null))).toBe(true);
    expect(isCountrySelected('NZ', null)).toBe(false);
    expect(isCountrySelected('NZ', 'NZ')).toBe(true);
    expect(isCountrySelected('AU', 'NZ')).toBe(false);
  });
});
