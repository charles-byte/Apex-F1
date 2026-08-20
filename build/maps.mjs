/* Regenerates the `path` on every circuit in data/circuits.json from the
   waypoint traces in tracks.mjs, and writes a contact sheet of all of them
   to build/shots/maps.html for eyeballing. */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { TRACES, toPath } from "./tracks.mjs";

const file = new URL("../data/circuits.json", import.meta.url);
const data = JSON.parse(readFileSync(file, "utf8"));

let n = 0;
for (const c of data.circuits) {
  const t = TRACES[c.id];
  if (!t) { console.warn("no trace for " + c.id); continue; }
  c.path = toPath(t.pts, { closed: !t.open });
  n++;
}
writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
console.log(`rewrote ${n} outlines`);

mkdirSync(new URL("./shots/", import.meta.url), { recursive: true });
const cells = data.circuits.map((c) => `
  <figure>
    <svg viewBox="0 0 1000 1000"><path d="${c.path}"/></svg>
    <figcaption>${c.short}<small>${c.turns} turns · ${c.direction === "clockwise" ? "CW" : "ACW"}</small></figcaption>
  </figure>`).join("");
writeFileSync(new URL("./shots/maps.html", import.meta.url), `<!doctype html>
<meta charset="utf-8"><title>Circuit outlines</title>
<style>
  body { background:#0B0D10; color:#EDF1F6; font:14px/1.4 system-ui, sans-serif; margin:24px; }
  h1 { font-size:18px; font-weight:600; }
  main { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:16px; }
  figure { margin:0; background:#151A21; border:1px solid #262E3A; border-radius:12px; padding:10px; text-align:center; }
  svg { width:100%; aspect-ratio:1; }
  path { fill:none; stroke:#EDF1F6; stroke-width:26; stroke-linecap:round; stroke-linejoin:round; }
  figcaption { font-size:12px; font-weight:600; margin-top:6px; }
  small { display:block; color:#6C7789; font-weight:400; font-size:10px; }
</style>
<h1>${data.circuits.length} circuit outlines</h1>
<main>${cells}</main>
`);
console.log("contact sheet at build/shots/maps.html");
