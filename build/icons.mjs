/* Renders the app icons.

   Each design is an SVG drawn at 1024 and rasterised by Chromium at every
   size the manifest asks for, so nothing is ever upscaled.

   Two rules the designs follow, both about how phones actually show an icon:

     full bleed    iOS applies its own squircle mask, so the source must be a
                   plain square. Rounding the corners here as well leaves the
                   art visibly inset inside the system's rounder corner.
     safe zone     Android adaptive icons crop to a circle of 80% width, so
                   the mark stays inside that circle and only background
                   reaches the edges.

     node build/icons.mjs --sheet     render every candidate + a contact sheet
     node build/icons.mjs --pick <id> write icons/ from one design
*/
import { chromium } from "playwright";
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const circuits = JSON.parse(readFileSync(ROOT + "data/circuits.json", "utf8")).circuits;
const track = (id) => circuits.find((c) => c.id === id).path;

const RED = "#E10600", DEEP = "#0A0C10", CARBON = "#161B23";

/* A circuit outline scaled into the safe zone, centred. */
function trackMark(id, { stroke = 46, colour = "#fff" } = {}) {
  return `<g transform="translate(512 512) scale(0.62) translate(-500 -500)">
    <path d="${track(id)}" fill="none" stroke="${colour}" stroke-width="${stroke}"
          stroke-linejoin="round" stroke-linecap="round"/>
  </g>`;
}

const backdrop = (a, b) => `
  <defs><linearGradient id="bg" x1="0" y1="0" x2="0.35" y2="1">
    <stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/>
  </linearGradient></defs>
  <rect width="1024" height="1024" fill="url(#bg)"/>`;

const DESIGNS = {
  /* A corner: in on the straight, tight to the kerb, out the other side. */
  apex: {
    name: "Apex line",
    blurb: "A corner taken properly, kerb and all — what the app is named after",
    svg: `${backdrop("#1B2029", "#070A0E")}
      <defs>
        <clipPath id="kerbclip"><rect x="150" y="150" width="480" height="480"/></clipPath>
      </defs>
      <!-- kerb on the inside of the corner -->
      <g clip-path="url(#kerbclip)">
        <circle cx="286" cy="286" r="196" fill="none" stroke="#fff" stroke-width="56"/>
        <circle cx="286" cy="286" r="196" fill="none" stroke="${RED}" stroke-width="56"
                stroke-dasharray="52 52"/>
      </g>
      <!-- the line: down the straight, clipping the apex, away -->
      <path d="M 168 214 L 470 214 C 690 214, 812 336, 812 556 L 812 870"
            fill="none" stroke="#fff" stroke-width="104"
            stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="596" cy="330" r="30" fill="${RED}"/>`
  },

  /* The app's own geometry, at icon size. */
  suzuka: {
    name: "Suzuka",
    blurb: "Real survey geometry, drawn heavy enough to survive at 60px",
    svg: `${backdrop("#1A1F27", "#06080B")}
      <g transform="translate(512 512) scale(0.80) translate(-500 -500)">
        <path d="${track("suzuka")}" fill="none" stroke="#fff" stroke-width="74"
              stroke-linejoin="round" stroke-linecap="round"/>
      </g>`
  },

  monza: {
    name: "Monza on red",
    blurb: "The temple of speed, white on F1 red",
    svg: `${backdrop("#E10600", "#8E0400")}
      <g transform="translate(512 512) scale(0.74) translate(-500 -500)">
        <path d="${track("monza")}" fill="none" stroke="#fff" stroke-width="72"
              stroke-linejoin="round" stroke-linecap="round"/>
      </g>`
  },

  /* The letter, with the apex of the A doing the work. */
  monogram: {
    name: "Apex A",
    blurb: "A hard monogram; the crossbar is the racing line",
    svg: `${backdrop("#161B23", "#06080B")}
      <path d="M 512 196 L 828 838 L 690 838 L 512 462 L 334 838 L 196 838 Z"
            fill="#fff" stroke="#fff" stroke-width="26" stroke-linejoin="round"/>
      <rect x="366" y="612" width="292" height="74" rx="37" fill="${RED}"/>
      <circle cx="512" cy="252" r="40" fill="${RED}"/>`
  },

  /* Five reds, then out. Nothing says F1 faster. */
  lights: {
    name: "Start lights",
    blurb: "The gantry at five — instantly readable at any size",
    svg: `${backdrop("#171C24", "#06080B")}
      <defs><radialGradient id="glow"><stop offset="0" stop-color="${RED}" stop-opacity=".55"/>
        <stop offset="1" stop-color="${RED}" stop-opacity="0"/></radialGradient></defs>
      <rect x="196" y="356" width="632" height="312" rx="70" fill="#0B0E13" stroke="#252C37" stroke-width="10"/>
      ${[0, 1, 2, 3, 4].map((i) => {
        const x = 276 + i * 118;
        return `<circle cx="${x}" cy="512" r="92" fill="url(#glow)"/>
                <circle cx="${x}" cy="512" r="46" fill="${RED}"/>
                <circle cx="${x - 13}" cy="497" r="15" fill="#fff" opacity=".38"/>`;
      }).join("")}`
  },

  /* Needle past the red. The gauge ring gives it a circular silhouette,
     which is what makes it findable among a screen of square icons. */
  redline: {
    name: "Redline",
    blurb: "A tacho swung into the red",
    svg: `${backdrop("#1C222B", "#05070A")}
      <defs>
        <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#FF3B30"/><stop offset="1" stop-color="#B00400"/>
        </linearGradient>
        <filter id="soft" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="26"/>
        </filter>
      </defs>
      <g transform="translate(512 528)">
        <!-- the dial -->
        <circle r="318" fill="none" stroke="#2A323E" stroke-width="84"/>
        <!-- the run up to the limit -->
        <path d="M ${318 * Math.cos(Math.PI * 0.80)} ${318 * Math.sin(Math.PI * 0.80)}
                 A 318 318 0 1 1 ${318 * Math.cos(Math.PI * 0.07)} ${318 * Math.sin(Math.PI * 0.07)}"
              fill="none" stroke="#48525F" stroke-width="84" stroke-linecap="round"/>
        <!-- the red -->
        <path d="M ${318 * Math.cos(Math.PI * -0.38)} ${318 * Math.sin(Math.PI * -0.38)}
                 A 318 318 0 0 1 ${318 * Math.cos(Math.PI * 0.07)} ${318 * Math.sin(Math.PI * 0.07)}"
              fill="none" stroke="${RED}" stroke-width="84" stroke-linecap="round"
              filter="url(#soft)" opacity=".85"/>
        <path d="M ${318 * Math.cos(Math.PI * -0.38)} ${318 * Math.sin(Math.PI * -0.38)}
                 A 318 318 0 0 1 ${318 * Math.cos(Math.PI * 0.07)} ${318 * Math.sin(Math.PI * 0.07)}"
              fill="none" stroke="url(#sweep)" stroke-width="84" stroke-linecap="round"/>
        <!-- needle, buried in the red -->
        <!-- the needle reaches into the red band, not short of it -->
        <g transform="rotate(-22)">
          <path d="M -34 50 L 268 -22 L 268 22 L -34 -50 Z" fill="#fff"/>
        </g>
        <circle r="66" fill="#0A0C10"/>
        <circle r="66" fill="none" stroke="#fff" stroke-width="30"/>
      </g>`
  },

  /* Chequer, cut on the diagonal. */
  chequer: {
    name: "Chequered sweep",
    blurb: "The flag, taken at speed",
    svg: `${backdrop("#12161D", "#06080B")}
      <defs>
        <pattern id="chq" width="128" height="128" patternUnits="userSpaceOnUse"
                 patternTransform="rotate(-22 512 512)">
          <rect width="128" height="128" fill="#fff"/>
          <rect width="64" height="64" fill="#0A0C10"/>
          <rect x="64" y="64" width="64" height="64" fill="#0A0C10"/>
        </pattern>
        <clipPath id="band">
          <path d="M -140 700 L 620 -140 L 1010 -140 L 250 700 Z"
                transform="translate(90 180)"/>
        </clipPath>
      </defs>
      <rect width="1024" height="1024" fill="url(#chq)" clip-path="url(#band)"/>
      <path d="M 150 880 C 420 700, 600 470, 700 150" fill="none"
            stroke="${RED}" stroke-width="86" stroke-linecap="round"/>`
  }
};

/* ------------------------------------------------------------------ render */
const page512 = (svg) =>
  `<!doctype html><meta charset="utf-8">
   <style>html,body{margin:0;padding:0;background:transparent}svg{display:block}</style>
   <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024"
        width="SIZE" height="SIZE">${svg}</svg>`;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });

async function raster(svg, size) {
  const p = await browser.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page512(svg).replaceAll("SIZE", String(size)));
  const buf = await p.screenshot({ omitBackground: true });
  await p.close();
  return buf;
}

const pickArg = process.argv.indexOf("--pick");
if (pickArg > -1) {
  const id = process.argv[pickArg + 1];
  const d = DESIGNS[id];
  if (!d) { console.error(`unknown design "${id}". one of: ${Object.keys(DESIGNS).join(", ")}`); process.exit(1); }
  mkdirSync(ROOT + "icons", { recursive: true });
  for (const [file, size] of [["icon-512.png", 512], ["icon-192.png", 192], ["apple-touch-icon.png", 180]]) {
    writeFileSync(ROOT + "icons/" + file, await raster(d.svg, size));
    console.log(`  ${file}  ${size}px`);
  }
  writeFileSync(ROOT + "icons/icon.svg",
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">${d.svg}</svg>\n`);
  console.log(`icons written from "${d.name}"`);
} else {
  mkdirSync(ROOT + "build/shots/icons", { recursive: true });
  const cells = [];
  for (const [id, d] of Object.entries(DESIGNS)) {
    writeFileSync(`${ROOT}build/shots/icons/${id}.png`, await raster(d.svg, 512));
    cells.push(`<figure>
      <div class="row">
        <img class="big" src="${id}.png" alt="">
        <div class="stack"><img class="sm" src="${id}.png" alt=""><span>on a home screen</span></div>
      </div>
      <figcaption><b>${d.name}</b><code>${id}</code><span>${d.blurb}</span></figcaption>
    </figure>`);
  }
  writeFileSync(ROOT + "build/shots/icons/index.html", `<!doctype html>
<meta charset="utf-8"><title>Apex icon candidates</title>
<style>
 body{background:#0B0D10;color:#EDF1F6;font:14px/1.5 Verdana,sans-serif;margin:26px;}
 h1{font-size:17px;margin:0 0 4px}p.lead{color:#78849A;margin:0 0 22px;font-size:12.5px}
 main{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:20px}
 figure{margin:0;background:#141922;border:1px solid #242C38;border-radius:14px;padding:16px}
 .row{display:flex;align-items:center;gap:18px}
 img.big{width:150px;height:150px;border-radius:34px}
 img.sm{width:62px;height:62px;border-radius:14px;display:block}
 .stack{text-align:center}.stack span{font-size:9.5px;color:#68738A;display:block;margin-top:6px}
 figcaption{margin-top:14px}
 figcaption b{font-size:14px}
 figcaption code{font-family:ui-monospace,monospace;font-size:11px;color:${RED};margin-left:8px}
 figcaption span{display:block;color:#78849A;font-size:12px;margin-top:3px}
</style>
<h1>Apex — icon candidates</h1>
<p class="lead">Large as you would see it in the gallery, small as it sits on a home screen.
Corners are rounded here for the preview only; the files are full-bleed squares, because iOS masks them itself.</p>
<main>${cells.join("")}</main>
`);
  console.log(`${Object.keys(DESIGNS).length} candidates → build/shots/icons/index.html`);
}
await browser.close();
