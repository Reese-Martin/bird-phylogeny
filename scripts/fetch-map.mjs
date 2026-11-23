/** Prepare local SVG country outlines from a pinned, public-domain Natural Earth release. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = {
  name: 'Natural Earth 1:110m Admin 0 countries',
  repository: 'https://github.com/nvkelso/natural-earth-vector',
  revision: 'ca96624a56bd078437bca8184e78163e5039ad19',
  url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/ca96624a56bd078437bca8184e78163e5039ad19/geojson/ne_110m_admin_0_countries.geojson',
  sha256: '6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f',
  license: 'Public domain',
  licenseUrl: 'https://www.naturalearthdata.com/about/terms-of-use/',
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const round = number => Number(number.toFixed(2));

export function countryCode(properties) {
  // France and Norway deliberately use ISO_A2=-99 in this source; EH has their identifiers.
  for (const field of ['ISO_A2_EH', 'ISO_A2']) {
    const code = properties[field];
    if (typeof code === 'string' && /^[A-Z]{2}$/.test(code)) return code;
  }
  return null;
}

function clipRing(points, boundary, keepRight) {
  if (!points.length) return [];
  const clipped = [];
  const inside = point => keepRight ? point[0] >= boundary : point[0] <= boundary;
  let previous = points.at(-1);
  for (const point of points) {
    if (inside(point) !== inside(previous)) {
      const fraction = (boundary - previous[0]) / (point[0] - previous[0]);
      clipped.push([boundary, previous[1] + fraction * (point[1] - previous[1])]);
    }
    if (inside(point)) clipped.push(point);
    previous = point;
  }
  return clipped;
}

export function projectRing(ring, antarctica = false) {
  if (!Array.isArray(ring) || ring.length < 4) return [];
  const unwrapped = [];
  for (const [longitude, latitude] of ring) {
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) throw new Error('Non-finite Natural Earth coordinate.');
    let lon = longitude;
    if (!antarctica && unwrapped.length) {
      const previous = unwrapped.at(-1)[0];
      while (lon - previous > 180) lon -= 360;
      while (lon - previous < -180) lon += 360;
    }
    unwrapped.push([lon, latitude]);
  }
  const paths = [];
  // Copies crossing either antimeridian are clipped independently, so no edge crosses the map.
  for (const offset of antarctica ? [0] : [-360, 0, 360]) {
    let clipped = unwrapped.map(([lon, lat]) => [lon + offset, lat]);
    clipped = clipRing(clipRing(clipped, -180, true), 180, false);
    if (clipped.length < 3) continue;
    const points = clipped.map(([lon, lat]) => [round((lon + 180) / 360 * 1000), round((90 - lat) / 180 * 500)]);
    const area = points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + point[0] * next[1] - next[0] * point[1];
    }, 0);
    if (Math.abs(area) < .01) continue;
    paths.push(`M${points.map(point => point.join(',')).join('L')}Z`);
  }
  return paths;
}

export function prepareCountries(geojson) {
  if (geojson.type !== 'FeatureCollection' || geojson.features.length !== 177) throw new Error('Unexpected pinned Natural Earth country count.');
  return geojson.features.map(feature => {
    const properties = feature.properties;
    const polygons = feature.geometry.type === 'MultiPolygon' ? feature.geometry.coordinates : feature.geometry.type === 'Polygon' ? [feature.geometry.coordinates] : null;
    if (!polygons) throw new Error(`Unsupported country geometry: ${feature.geometry.type}`);
    return {
      id: String(properties.NE_ID),
      code: countryCode(properties),
      name: properties.NAME_EN || properties.NAME_LONG || properties.NAME,
      path: polygons.flatMap(polygon => polygon.flatMap(ring => projectRing(ring, properties.ADM0_A3 === 'ATA'))).join(''),
    };
  });
}

async function main() {
  const rawPath = resolve(root, 'data/raw/world-countries.geojson');
  let bytes;
  try { bytes = await readFile(rawPath); } catch { /* First source preparation downloads the pinned input. */ }
  if (!bytes || hash(bytes) !== source.sha256) {
    const response = await fetch(source.url);
    if (!response.ok) throw new Error(`Natural Earth download: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (hash(bytes) !== source.sha256) throw new Error('Natural Earth source hash changed. Review the pin before regeneration.');
  await mkdir(dirname(rawPath), { recursive: true });
  await writeFile(rawPath, bytes);
  const countries = prepareCountries(JSON.parse(bytes));
  const prepared = `${JSON.stringify({ schemaVersion: 1, source: 'Natural Earth 1:110m Admin 0', viewBox: [0, 0, 1000, 500], projection: 'Equirectangular', countries })}\n`;
  await mkdir(resolve(root, 'public/data'), { recursive: true });
  await writeFile(resolve(root, 'public/data/world-countries.json'), prepared);
  await writeFile(resolve(root, 'data/map-source.json'), `${JSON.stringify({
    schemaVersion: 1,
    source,
    prepared: { path: 'public/data/world-countries.json', sha256: hash(prepared), bytes: Buffer.byteLength(prepared), shapes: countries.length, mappedCountryCodes: countries.filter(country => country.code).length },
    geometry: { projection: 'Equirectangular', viewBox: [0, 0, 1000, 500], coordinatesRoundedToSvgPixels: .01, antimeridian: 'unwrapped rings clipped to the world boundary', countryCodeField: 'ISO_A2_EH, then ISO_A2', unknownCodes: countries.filter(country => !country.code).map(country => ({ name: country.name, reason: 'No ISO2 identifier in the source; outline is decorative and not assigned to another country.' })) },
  }, null, 2)}\n`);
  console.log(`Prepared ${countries.length} Natural Earth outlines (${Buffer.byteLength(prepared).toLocaleString()} bytes).`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
