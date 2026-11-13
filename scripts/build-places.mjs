// Builds lib/geo/places.json from GeoNames "cities5000" (towns of 5,000+ people and
// administrative seats; CC BY 4.0, https://www.geonames.org/). The app uses it to turn a
// position into the nearest town on our own server, so coordinates never go to an outside
// service. Run: node scripts/build-places.mjs <path to cities5000.txt>
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/build-places.mjs <cities5000.txt>");
  process.exit(1);
}
const rows = [];
for (const line of readFileSync(source, "utf8").split("\n")) {
  if (!line) continue;
  // geonameid, name, asciiname, alternatenames, latitude, longitude, feature class, feature code, country code, …
  const f = line.split("\t");
  const lat = Number(f[4]);
  const lon = Number(f[5]);
  // Populated places only; not sections of a bigger town (PPLX) or abandoned ones.
  if (f[6] !== "P" || f[7] === "PPLX" || f[7] === "PPLH" || f[7] === "PPLW" || f[7] === "PPLQ") continue;
  if (!f[1] || !f[8] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
  rows.push([f[1], f[8], Math.round(lat * 1000) / 1000, Math.round(lon * 1000) / 1000]);
}
rows.sort((a, b) => a[2] - b[2]);
mkdirSync("lib/geo", { recursive: true });
writeFileSync("lib/geo/places.json", `[\n${rows.map((r) => JSON.stringify(r)).join(",\n")}\n]\n`);
console.log(`${rows.length} places written to lib/geo/places.json`);
