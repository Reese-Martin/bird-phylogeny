/** ISO 3166-1 alpha-2 territories, plus the region code XK recognized by Intl. */
const CODES = `AD AE AF AG AI AL AM AO AQ AR AS AT AU AW AX AZ
BA BB BD BE BF BG BH BI BJ BL BM BN BO BQ BR BS BT BV BW BY BZ
CA CC CD CF CG CH CI CK CL CM CN CO CR CU CV CW CX CY CZ
DE DJ DK DM DO DZ EC EE EG EH ER ES ET FI FJ FK FM FO FR
GA GB GD GE GF GG GH GI GL GM GN GP GQ GR GS GT GU GW GY
HK HM HN HR HT HU ID IE IL IM IN IO IQ IR IS IT JE JM JO JP
KE KG KH KI KM KN KP KR KW KY KZ LA LB LC LI LK LR LS LT LU LV LY
MA MC MD ME MF MG MH MK ML MM MN MO MP MQ MR MS MT MU MV MW MX MY MZ
NA NC NE NF NG NI NL NO NP NR NU NZ OM PA PE PF PG PH PK PL PM PN PR PS PT PW PY
QA RE RO RS RU RW SA SB SC SD SE SG SH SI SJ SK SL SM SN SO SR SS ST SV SX SY SZ
TC TD TF TG TH TJ TK TL TM TN TO TR TT TV TW TZ UA UG UM US UY UZ
VA VC VE VG VI VN VU WF WS XK YE YT ZA ZM ZW`.split(/\s+/);

export interface CountryIdentity { code: string; name: string }
const displayNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
const countries = new Map<string, CountryIdentity>(CODES.map(code => [code, { code, name: displayNames.of(code) || code }]));
const normalize = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLocaleLowerCase('en');
const names = new Map<string, string>([...countries.values()].map(country => [normalize(country.name), country.code]));
const aliases: Record<string, string> = {
  'usa': 'US', 'u.s.': 'US', 'u.s.a.': 'US', 'united states of america': 'US',
  'uk': 'GB', 'u.k.': 'GB', 'great britain': 'GB',
  'russian federation': 'RU', 'republic of korea': 'KR', 'democratic people\'s republic of korea': 'KP',
  'viet nam': 'VN', 'turkey': 'TR', 'czech republic': 'CZ', 'swaziland': 'SZ',
  'cape verde': 'CV', 'ivory coast': 'CI', 'cote d\'ivoire': 'CI', 'côte d’ivoire': 'CI',
  'bolivia (plurinational state of)': 'BO', 'venezuela (bolivarian republic of)': 'VE',
  'tanzania, united republic of': 'TZ', 'iran (islamic republic of)': 'IR',
  'taiwan, province of china': 'TW', 'moldova, republic of': 'MD',
  'lao people\'s democratic republic': 'LA', 'brunei darussalam': 'BN',
  'syrian arab republic': 'SY', 'holy see': 'VA', 'palestine, state of': 'PS',
};
for (const [name, code] of Object.entries(aliases)) names.set(normalize(name), code);

export function countryByCode(value: string): CountryIdentity | undefined {
  return countries.get(value.trim().toUpperCase());
}

export function resolveCountryNameOrCode(value: string): CountryIdentity | undefined {
  const direct = countryByCode(value);
  if (direct) return direct;
  const code = names.get(normalize(value));
  return code ? countries.get(code) : undefined;
}

/** Only explicit country values or an eBird region-code prefix are used. */
export function countryForRow(row: Record<string, string | undefined>): CountryIdentity | undefined {
  const code = resolveCountryNameOrCode(row['country code'] ?? '');
  const name = resolveCountryNameOrCode(row.country ?? '');
  if (code && name && code.code !== name.code) return undefined;
  const region = /^([A-Z]{2})(?:-|$)/.exec((row['state/province'] ?? '').trim().toUpperCase());
  const state = region ? countryByCode(region[1]) : undefined;
  const explicit = code ?? name;
  if (explicit && state && explicit.code !== state.code) return undefined;
  return explicit ?? state;
}
