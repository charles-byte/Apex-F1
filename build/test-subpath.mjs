/* GitHub Pages serves a project site from a sub-path, not the domain root, so
   the app has to work at /Apex-F1/ with nothing hard-coded to "/". This also
   exercises the part that matters once it is on a home screen: the service
   worker caching the shell, and the app opening again with the network gone. */
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname;
const PREFIX = "/Apex-F1";
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };

let served = 0;
const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (!p.startsWith(PREFIX)) { res.writeHead(404); res.end("outside the sub-path"); return; }
  p = p.slice(PREFIX.length) || "/";
  if (p === "/") p = "/index.html";
  try {
    const body = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, "")));
    served++;
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(0, r));
const origin = `http://127.0.0.1:${server.address().port}`;
const base = origin + PREFIX + "/";

let failures = 0;
const check = (label, cond, extra = "") => {
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
};

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
const bad = [];
page.on("requestfailed", (r) => bad.push(r.url()));
page.on("response", (r) => { if (r.status() === 404) bad.push(r.url()); });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));

await page.goto(base);
await page.waitForSelector(".nextrace", { timeout: 8000 });
check("app boots from a sub-path", true);
check("nothing 404s or is requested from the domain root", bad.length === 0, bad.slice(0, 3).join(", "));
check("circuit data loaded", (await page.locator(".nextrace-map path").count()) === 1);
check("no runtime errors", errors.length === 0, errors.slice(0, 2).join(" | "));

/* the manifest is what iOS reads on Add to Home Screen */
const manifest = await page.evaluate(async () => {
  const href = document.querySelector('link[rel="manifest"]').href;
  const r = await fetch(href);
  return { url: href, ok: r.ok, body: await r.json() };
});
check("manifest resolves inside the sub-path",
  manifest.ok && manifest.url.includes(PREFIX), manifest.url);
check("manifest start_url and scope are relative",
  manifest.body.start_url.startsWith(".") && manifest.body.scope.startsWith("."),
  `${manifest.body.start_url} / ${manifest.body.scope}`);
check("standalone display, so it opens without browser chrome",
  manifest.body.display === "standalone");
const icon = await page.evaluate(async () => {
  const r = await fetch(document.querySelector('link[rel="apple-touch-icon"]').href);
  return r.ok;
});
check("apple-touch-icon resolves", icon);

/* service worker: the thing that makes it work offline on a home screen */
const swScope = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.ready;
  return reg.scope;
});
check("service worker claims the sub-path", swScope.includes(PREFIX), swScope);
await page.waitForTimeout(1200);   // let the shell finish caching

/* context.setOffline does not intercept service worker fetches in Chromium,
   so "offline" there can quietly still be served over the network. Shut the
   server down instead — then a page that renders can only have come from the
   cache. */
server.close();
server.closeAllConnections();
await new Promise((r) => setTimeout(r, 300));
/* Probe a path the worker has never cached, so the request has to go to the
   network to be answered at all. */
const reachable = await page.evaluate((u) =>
  fetch(u).then(() => true).catch(() => false), origin + PREFIX + "/__ping");
check("the server is really gone", !reachable);

const before = served;
await page.reload();
await page.waitForSelector(".nextrace", { timeout: 8000 });
check("opens with the server shut down", true);
check("served entirely from cache", served === before, `${served - before} reached the server`);
check("questions still work offline",
  (await page.locator(".strip .cell").count()) === 24);
await page.locator(".nav button", { hasText: "Circuits" }).click();
await page.waitForSelector(".trackgrid");
check("circuit maps are cached too",
  (await page.locator(".trackcard").count()) === 24);

await browser.close();
console.log(failures ? `\n${failures} failing check(s)` : "\nall sub-path checks passed");
process.exit(failures ? 1 : 0);
