/* Builds the circuit outlines in data/circuits.json from real survey
   coordinates — data/f1-circuits.geojson, which is OpenStreetMap circuit
   geometry collected by Tomislav Bacinger (github.com/bacinger/f1-circuits,
   MIT). Nothing here is drawn by hand.

   The only transforms applied are the ones you cannot avoid when putting a
   piece of the round earth on a flat screen:

     project   lon/lat to metres, equirectangular with a cos(latitude)
               correction, so the circuit keeps its true proportions
     orient    north stays up; no rotation to match a broadcast graphic
     fit       scale and centre into the shared 1000-unit box, one uniform
               scale factor for both axes so nothing is stretched

   Every surveyed point is kept. No simplification, no smoothing.

     node build/maps.mjs [--report]
*/
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

const circuitsFile = new URL("../data/circuits.json", import.meta.url);
const data = JSON.parse(readFileSync(circuitsFile, "utf8"));
const geo = JSON.parse(readFileSync(new URL("../data/f1-circuits.geojson", import.meta.url), "utf8"));
const report = process.argv.includes("--report");

const byId = new Map(geo.features.map((f) => [f.properties.id, f]));

const R = 6371008.8;                       // mean earth radius, metres
function project(coords) {
  const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  const rad = Math.PI / 180;
  return coords.map(([lon, lat]) => [R * rad * lon * k, -R * rad * lat]);
}

/* Length of the projected ring, as a check against the published lap length. */
function perimetre(pts) {
  let d = 0;
  for (let i = 1; i < pts.length; i++) d += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  return d;
}

function fit(pts, box = 1000, pad = 60) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const w = maxX - minX, h = maxY - minY;
  const scale = (box - 2 * pad) / (Math.max(w, h) || 1);
  const ox = pad + ((box - 2 * pad) - w * scale) / 2;
  const oy = pad + ((box - 2 * pad) - h * scale) / 2;
  return {
    pts: pts.map(([x, y]) => [
      +(ox + (x - minX) * scale).toFixed(1),
      +(oy + (y - minY) * scale).toFixed(1)
    ]),
    aspect: w / h
  };
}

const rows = [];
let done = 0;
for (const c of data.circuits) {
  const f = byId.get(c.osmId);
  if (!f) { console.error(`  no geometry for ${c.short} (osmId ${c.osmId})`); continue; }

  const raw = f.geometry.type === "LineString"
    ? f.geometry.coordinates
    : f.geometry.coordinates.reduce((a, b) => (b.length > a.length ? b : a), []);

  const flat = project(raw);
  const closed = Math.hypot(flat[0][0] - flat.at(-1)[0], flat[0][1] - flat.at(-1)[1]) < 1;
  const ring = closed ? flat.slice(0, -1) : flat;
  const { pts, aspect } = fit(ring);

  c.path = "M " + pts.map((p) => p[0] + " " + p[1]).join(" L ") + " Z";
  c.points = pts.length;
  done++;

  const measured = perimetre(closed ? flat : flat.concat([flat[0]]));
  rows.push({
    short: c.short, pts: pts.length,
    stated: c.lengthKm, measured: +(measured / 1000).toFixed(3),
    drift: +(((measured / 1000 - c.lengthKm) / c.lengthKm) * 100).toFixed(1),
    aspect: +aspect.toFixed(2)
  });
}

writeFileSync(circuitsFile, JSON.stringify(data, null, 2) + "\n");
console.log(`${done} outlines built from surveyed coordinates`);

if (report) {
  console.log("\n  circuit           pts   stated  traced   drift");
  for (const r of rows.sort((a, b) => Math.abs(b.drift) - Math.abs(a.drift))) {
    console.log(`  ${r.short.padEnd(16)} ${String(r.pts).padStart(4)}  ${String(r.stated).padStart(6)}  ${String(r.measured).padStart(6)}  ${String(r.drift).padStart(5)}%`);
  }
  console.log("\n  Traced length is the polyline through the surveyed points, so it reads\n" +
    "  a little short on circuits with long fast curves - the chords cut the\n" +
    "  corners. A large gap means the wrong geometry, not a rounding error.");
}

/* contact sheet, for looking at all of them at once */
mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });
const cells = data.circuits.map((c) => `
  <figure>
    <svg viewBox="0 0 1000 1000"><path d="${c.path}"/></svg>
    <figcaption>${c.short}<small>${c.points} surveyed points</small></figcaption>
  </figure>`).join("");
writeFileSync(new URL("./shots/maps.html", import.meta.url), `<!doctype html>
<meta charset="utf-8"><title>Circuit outlines</title>
<style>
  body { background:#0B0D10; color:#EDF1F6; font:14px/1.4 Verdana, sans-serif; margin:24px; }
  h1 { font-size:16px; }
  main { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:16px; }
  figure { margin:0; background:#151A21; border:1px solid #262E3A; border-radius:12px; padding:10px; text-align:center; }
  svg { width:100%; aspect-ratio:1; }
  path { fill:none; stroke:#EDF1F6; stroke-width:22; stroke-linecap:round; stroke-linejoin:round; }
  figcaption { font-size:11px; font-weight:700; margin-top:6px; }
  small { display:block; color:#6C7789; font-weight:400; font-size:10px; }
</style>
<h1>${data.circuits.length} circuits, traced from OpenStreetMap survey data</h1>
<main>${cells}</main>
`);
console.log("contact sheet at build/shots/maps.html");
