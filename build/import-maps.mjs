/* Replaces the hand-drawn outlines with real ones, from a GeoJSON of circuit
   centrelines. The outlines in data/circuits.json are traced by hand and are
   stylised: right topology, wrong survey. If you can reach the network, a
   public dataset of F1 circuit geometry beats them outright.

     node build/import-maps.mjs circuits.geojson [--dry]

   Expects a FeatureCollection whose features are LineString or
   MultiLineString, each with a name somewhere in its properties (any of
   name/Name/title/id/Location). Features are matched to circuits by name,
   then by city; anything unmatched is listed and left alone, so a partial
   import is safe. */
import { readFileSync, writeFileSync } from "node:fs";

const [src, ...flags] = process.argv.slice(2);
if (!src) { console.error("usage: node build/import-maps.mjs <circuits.geojson> [--dry]"); process.exit(2); }
const dry = flags.includes("--dry");

const file = new URL("../data/circuits.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));
const geo = JSON.parse(readFileSync(src, "utf8"));

const norm = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
const nameOf = (f) => {
  const p = f.properties || {};
  return p.name || p.Name || p.title || p.Location || p.id || "";
};

/* lon/lat -> flat x/y. At the scale of one circuit an equirectangular
   projection with a cos(lat) correction is exact enough; nothing here is
   navigating by it. */
function project(coords) {
  const lat0 = coords.reduce((a, c) => a + c[1], 0) / coords.length;
  const k = Math.cos((lat0 * Math.PI) / 180);
  return coords.map(([lon, lat]) => [lon * k, -lat]);
}

/* Ramer-Douglas-Peucker, so a 3,000-point trace becomes a path you can ship.
   A closed ring has to be cut in half first: with the first and last point in
   the same place there is no baseline to measure deviation against, and every
   point looks equally redundant. */
function simplifyRing(pts, tol) {
  const closed = pts.length > 2 &&
    Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < tol;
  if (!closed) return simplify(pts, tol);
  const half = Math.floor(pts.length / 2);
  return simplify(pts.slice(0, half + 1), tol).slice(0, -1)
    .concat(simplify(pts.slice(half), tol).slice(0, -1));
}
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  let far = 0, idx = 0;
  const [ax, ay] = pts[0], [bx, by] = pts[pts.length - 1];
  const dx = bx - ax, dy = by - ay, len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / len;
    if (d > far) { far = d; idx = i; }
  }
  if (far <= tol) return [pts[0], pts[pts.length - 1]];
  return simplify(pts.slice(0, idx + 1), tol).slice(0, -1).concat(simplify(pts.slice(idx), tol));
}

function toPath(pts, box = 1000, pad = 90) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const span = Math.max(maxX - minX, maxY - minY) || 1;
  const scale = (box - 2 * pad) / span;
  const ox = pad + ((box - 2 * pad) - (maxX - minX) * scale) / 2;
  const oy = pad + ((box - 2 * pad) - (maxY - minY) * scale) / 2;
  const q = pts.map((p) => [
    +(ox + (p[0] - minX) * scale).toFixed(1),
    +(oy + (p[1] - minY) * scale).toFixed(1)
  ]);
  return "M " + q.map((p) => p[0] + " " + p[1]).join(" L ") + " Z";
}

const features = (geo.features || []).filter((f) =>
  f.geometry && /LineString/.test(f.geometry.type));

function coordsOf(f) {
  return f.geometry.type === "LineString"
    ? f.geometry.coordinates
    : f.geometry.coordinates.reduce((a, b) => (b.length > a.length ? b : a), []);
}

let matched = 0;
const missed = [];
for (const c of data.circuits) {
  const keys = [c.name, c.short, c.city].map(norm).filter(Boolean);
  const hit = features.find((f) => {
    const n = norm(nameOf(f));
    return n && keys.some((k) => n.includes(k) || k.includes(n));
  });
  if (!hit) { missed.push(c.short); continue; }
  const flat = project(coordsOf(hit));
  /* tolerance relative to the circuit's own size, so it works whether the
     source counts in degrees or metres */
  const xs = flat.map((p) => p[0]), ys = flat.map((p) => p[1]);
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const pts = simplifyRing(flat, span / 1200);
  if (pts.length < 8) { missed.push(c.short + " (too few points)"); continue; }
  if (!dry) c.path = toPath(pts);
  matched++;
  console.log(`  ${c.short.padEnd(16)} <- ${nameOf(hit)}  (${pts.length} points)`);
}

if (!dry) writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`\n${matched} of ${data.circuits.length} circuits imported${dry ? " (dry run, nothing written)" : ""}`);
if (missed.length) console.log("still hand-drawn: " + missed.join(", "));
