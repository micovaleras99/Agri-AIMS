/**
 * Downloads the Philippine Standard Geographic Code hierarchy for one region
 * and writes data/psgc.json in the shape scripts/seed-locations.js expects.
 *
 *   npm run fetch:psgc              # Region V (Bicol), the default
 *   node scripts/fetch-psgc.js 050000000
 *   node scripts/fetch-psgc.js all  # every region in the country
 *
 * Source: https://psgc.gitlab.io/api — a free, static mirror of the PSA's PSGC
 * publication. It is community-maintained, so treat it as a convenience rather
 * than the authority: before an official submission, check the counts against
 * the current PSGC publication on psa.gov.ph.
 *
 * Region codes: 010000000 Ilocos · 020000000 Cagayan Valley · 030000000 Central Luzon
 * 040000000 CALABARZON · 170000000 MIMAROPA · 050000000 Bicol · 060000000 Western Visayas
 * 070000000 Central Visayas · 080000000 Eastern Visayas · 090000000 Zamboanga
 * 100000000 Northern Mindanao · 110000000 Davao · 120000000 SOCCSKSARGEN
 * 130000000 NCR · 140000000 CAR · 160000000 Caraga · 190000000 BARMM
 */

const fs = require('fs');
const path = require('path');

const API = 'https://psgc.gitlab.io/api';
const OUT = path.join(__dirname, '..', 'data', 'psgc.json');
const DEFAULT_REGION = '050000000'; // Region V — Bicol

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} for ${url}`);
  return res.json();
}

/**
 * PSGC labels a barangay's parent as either cityCode or municipalityCode,
 * and NCR adds sub-municipalities. Take whichever is present.
 */
function parentOfBarangay(b) {
  return b.municipalityCode || b.cityCode || b.subMunicipalityCode || null;
}

async function collectRegion(regionCode) {
  const region = await getJson(`${API}/regions/${regionCode}/`);
  const provinces = await getJson(`${API}/regions/${regionCode}/provinces/`);
  const munis = await getJson(`${API}/regions/${regionCode}/cities-municipalities/`);
  const barangays = await getJson(`${API}/regions/${regionCode}/barangays/`);

  const entries = [];

  // regionName ("Region V") is what the rest of the system already uses; name
  // ("Bicol Region") is the descriptive form. Keep the one the app displays.
  entries.push({
    psgcCode: region.code,
    level: 'region',
    name: region.regionName || region.name,
    parentCode: null,
  });

  for (const p of provinces) {
    entries.push({ psgcCode: p.code, level: 'province', name: p.name, parentCode: p.regionCode });
  }

  for (const m of munis) {
    entries.push({
      psgcCode: m.code,
      level: 'municipality',
      name: m.name,
      parentCode: m.provinceCode,
      type: m.isCity ? 'city' : 'municipality',
    });
  }

  let orphans = 0;
  for (const b of barangays) {
    const parent = parentOfBarangay(b);
    if (!parent) { orphans += 1; continue; }
    entries.push({ psgcCode: b.code, level: 'barangay', name: b.name, parentCode: parent });
  }

  return {
    entries,
    summary: {
      region: region.regionName || region.name,
      provinces: provinces.length,
      cities: munis.filter((m) => m.isCity).length,
      municipalities: munis.filter((m) => !m.isCity).length,
      barangays: barangays.length - orphans,
      orphans,
    },
  };
}

async function main() {
  const arg = process.argv[2] || DEFAULT_REGION;
  let regionCodes;

  if (arg === 'all') {
    const regions = await getJson(`${API}/regions/`);
    regionCodes = regions.map((r) => r.code);
    console.log(`Fetching all ${regionCodes.length} regions — this takes a while.`);
  } else {
    regionCodes = [arg];
  }

  const all = [];
  for (const code of regionCodes) {
    process.stdout.write(`Fetching ${code} ... `);
    const { entries, summary } = await collectRegion(code);
    all.push(...entries);
    console.log(
      `${summary.region}: ${summary.provinces} provinces, ${summary.cities} cities, ` +
      `${summary.municipalities} municipalities, ${summary.barangays} barangays` +
      (summary.orphans ? ` (${summary.orphans} skipped with no parent)` : '')
    );
  }

  fs.writeFileSync(OUT, JSON.stringify(all, null, 2));
  console.log(`\nWrote ${all.length} entries to ${path.relative(process.cwd(), OUT)}`);
  console.log('Load them with: npm run seed:locations');
}

main().catch((err) => {
  console.error('Fetch failed:', err.message);
  process.exit(1);
});
