/* Drives the whole app in a real browser at iPhone dimensions:
   a full session on each section, results entry, every tab.
   Screenshots land in build/shots/. */
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = join(ROOT, "build", "shots");
mkdirSync(SHOTS, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".png": "image/png", ".webmanifest": "application/manifest+json" };

const server = createServer(async (req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  try {
    const body = await readFile(join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, "")));
    res.writeHead(200, { "content-type": TYPES[extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("no"); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let failures = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? " — " + extra : ""}`);
  if (!cond) failures++;
}

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });
const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
/* Google Fonts is unreachable in a sandbox; the app has to survive that, so
   note those separately rather than counting them as app errors. */
const external = [];
page.on("requestfailed", (r) => { if (new URL(r.url()).origin !== base) external.push(r.url()); });

await page.goto(base + "/index.html");
await page.waitForSelector(".hero", { timeout: 8000 });
check("app boots", await page.locator(".hero").isVisible());
await page.screenshot({ path: join(SHOTS, "01-home.png") });

/* ---- how big is the bank, and does every question build? ---- */
const bankReport = await page.evaluate(() => {
  const out = { total: 0, bySection: {}, broken: [], kinds: {} };
  // reach into the closure by re-running a session repeatedly is fragile;
  // instead drive through the UI. This just reads what the DOM tells us.
  return out;
});

/* ---- a full mixed session ---- */
async function runSession(label, expectAtLeast = 8) {
  let asked = 0, guard = 0;
  while (guard++ < 60) {
    if (await page.locator(".verdict").count()) {
      const next = page.locator(".qfoot .btn.primary");
      if (await next.count()) { await next.click(); await page.waitForTimeout(60); continue; }
    }
    if (await page.locator(".opts .opt, .opt-maps .opt").count()) {
      await page.locator(".opts .opt, .opt-maps .opt").first().click();
      asked++; await page.waitForTimeout(60); continue;
    }
    if (await page.locator(".pool .btn").count()) {
      const n = await page.locator(".order-slots .slot").count();
      for (let i = 0; i < n; i++) {
        await page.locator(".pool .btn:not(.used)").first().click();
        await page.waitForTimeout(30);
      }
      await page.locator(".qfoot .btn.primary").click();
      asked++; await page.waitForTimeout(60); continue;
    }
    break;
  }
  check(`${label}: answered ${asked} questions`, asked >= expectAtLeast, `wanted >= ${expectAtLeast}`);
  return asked;
}

await page.locator(".hero .btn.primary").click();
await page.waitForSelector(".prompt");
await page.screenshot({ path: join(SHOTS, "02-question.png") });
await runSession("mixed session", 10);
check("session summary shows", await page.locator(".hero h2").first().isVisible());
await page.screenshot({ path: join(SHOTS, "03-summary.png") });
await page.locator(".btn.ghost", { hasText: "Done" }).click();

/* ---- each section on its own ---- */
for (const [i, name] of [["Championships"], ["Circuits"], ["Grids"]].entries()) {
  const card = page.locator(".sec", { hasText: name[0] });
  await card.click();
  await page.waitForSelector(".prompt", { timeout: 5000 });
  if (name[0] === "Circuits") await page.screenshot({ path: join(SHOTS, `04-circuit-q.png`) });
  await runSession(`${name[0]} session`, 8);
  await page.locator(".btn.ghost", { hasText: "Done" }).click();
  await page.waitForSelector(".hero");
}

/* ---- circuits tab ---- */
await page.locator(".nav button", { hasText: "Circuits" }).click();
await page.waitForSelector(".trackgrid");
const tiles = await page.locator(".trackcard").count();
check("2026 circuits listed", tiles === 24, `saw ${tiles}`);
await page.screenshot({ path: join(SHOTS, "05-circuits.png") });
await page.locator(".seg button", { hasText: "All 2020+" }).click();
const all = await page.locator(".trackcard").count();
check("all circuits listed", all === 33, `saw ${all}`);
const emptyMaps = await page.evaluate(() =>
  [...document.querySelectorAll(".trackcard path")].filter((p) => {
    const b = p.getBBox();
    return b.width < 200 || b.height < 200;
  }).map((p) => p.closest(".trackcard").querySelector("b").textContent));
check("every outline fills its box", emptyMaps.length === 0, emptyMaps.join(", "));
await page.locator(".trackcard").first().click();
await page.waitForSelector(".sheet .facts");
await page.screenshot({ path: join(SHOTS, "06-circuit-detail.png") });
await page.locator(".sheet .btn", { hasText: "Close" }).click();

/* ---- season tab: enter a result, then drill it ---- */
await page.locator(".nav button", { hasText: "Season" }).click();
await page.waitForSelector(".rounds");
const rounds = await page.locator(".round").count();
check("24 rounds on the calendar", rounds === 24, `saw ${rounds}`);
await page.screenshot({ path: join(SHOTS, "07-season-empty.png") });

async function enterResult(roundIndex, mode, picks) {
  await page.locator(".round").nth(roundIndex).click();
  await page.waitForSelector(".sheet");
  const label = mode === "quali" ? "Qualifying" : mode === "race" ? "Race" : "Sprint";
  const row = page.locator(".sheet .row.between", { hasText: label });
  await row.locator(".btn").click();
  await page.waitForSelector(".sheet .pool");
  for (const name of picks) await page.locator(".sheet .pool .btn", { hasText: name }).first().click();
  await page.locator(".sheet .btn.primary", { hasText: "Save" }).click();
  await page.waitForTimeout(150);
}
await enterResult(0, "race", ["Norris", "Verstappen", "Leclerc", "Russell", "Piastri", "Hamilton"]);
await page.screenshot({ path: join(SHOTS, "08-round-entered.png") });
await page.locator(".sheet .btn", { hasText: "Close" }).click();
await enterResult(0, "quali", ["Verstappen", "Norris", "Piastri", "Leclerc"]);
await page.locator(".sheet .btn", { hasText: "Close" }).click();
await enterResult(1, "race", ["Verstappen", "Piastri", "Norris", "Hamilton", "Antonelli", "Sainz"]);
await page.locator(".sheet .btn", { hasText: "Close" }).click();
await enterResult(1, "sprint", ["Piastri", "Norris", "Russell"]);
await page.locator(".sheet .btn", { hasText: "Close" }).click();
await enterResult(2, "race", ["Leclerc", "Norris", "Verstappen", "Albon", "Gasly", "Ocon"]);
await page.locator(".sheet .btn", { hasText: "Close" }).click();

const done = await page.locator(".round.done").count();
check("entered rounds marked done", done === 3, `saw ${done}`);
check("standings appear", await page.locator(".card .li").first().isVisible());
await page.screenshot({ path: join(SHOTS, "09-season-filled.png") });

await page.locator(".nav button", { hasText: "Train" }).click();
await page.waitForSelector(".secgrid");
const raceCard = page.locator(".sec", { hasText: "2026 season" });
check("race section now has questions", !(await raceCard.getAttribute("class") || "").includes("off"));
await raceCard.click();
await page.waitForSelector(".prompt");
await page.screenshot({ path: join(SHOTS, "10-race-q.png") });
await runSession("2026 season session", 8);
await page.locator(".btn.ghost", { hasText: "Done" }).click();

/* ---- record ---- */
await page.locator(".nav button", { hasText: "Record" }).click();
await page.waitForSelector(".heat");
check("record shows a streak", (await page.locator(".tile b").nth(1).textContent()) === "1");
const answered = Number(await page.locator(".tile b").first().textContent());
check("record counts every answer", answered > 30, `saw ${answered}`);
await page.screenshot({ path: join(SHOTS, "11-record.png") });

/* ---- settings, export, light theme ---- */
await page.locator(".top .btn.ghost").click();
await page.waitForSelector(".sheet .seg");
await page.locator(".sheet .seg button", { hasText: "Light" }).click();
await page.waitForTimeout(120);
check("light theme applies", await page.evaluate(() => document.documentElement.dataset.theme === "light"));
await page.screenshot({ path: join(SHOTS, "12-settings-light.png") });
await page.locator(".sheet .btn", { hasText: "Export the 2026 results" }).click();
await page.waitForSelector(".sheet textarea");
const exported = await page.locator(".sheet textarea").inputValue();
check("results export is valid JSON", (() => { try { return Object.keys(JSON.parse(exported)).length === 3; } catch { return false; } })());
await page.locator(".sheet .btn.ghost", { hasText: "Back" }).click();
await page.locator(".sheet .seg button", { hasText: "Dark" }).click();
await page.locator(".sheet .btn", { hasText: "Close" }).click();

/* ---- reload keeps everything ---- */
await page.reload();
await page.waitForSelector(".hero");
await page.locator(".nav button", { hasText: "Season" }).click();
await page.waitForSelector(".rounds");
check("results survive a reload", (await page.locator(".round.done").count()) === 3);

/* ---- no horizontal scroll anywhere ---- */
for (const tab of ["Train", "Circuits", "Season", "Record"]) {
  await page.locator(".nav button", { hasText: tab }).click();
  await page.waitForTimeout(180);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${tab} fits the screen`, !over);
}

const appErrors = errors.filter((e) => !/Failed to load resource|ERR_CONNECTION|ERR_FAILED/.test(e));
check("no runtime errors", appErrors.length === 0, appErrors.slice(0, 3).join(" | "));
check("nothing but fonts went to the network", external.every((u) => /fonts\.(googleapis|gstatic)/.test(u)),
  external.filter((u) => !/fonts\./.test(u)).join(", "));
check("app renders without its webfont", await page.locator(".title").first().isVisible());

await browser.close();
server.close();
console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
