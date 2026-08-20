/* Drives the whole app in a real browser at phone dimensions.

   The clock is frozen at 20 August 2026, mid-season: round 13 (Hungary) has
   been run, round 14 (Zandvoort) is three days away. Everything the app does
   hangs off those two facts, so the test would be meaningless without a fixed
   date. Screenshots land in build/shots/. */
import { chromium, devices } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { mkdirSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const SHOTS = join(ROOT, "build", "shots");
mkdirSync(SHOTS, { recursive: true });

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".geojson": "application/json",
  ".png": "image/png", ".webmanifest": "application/manifest+json" };

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

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const ctx = await browser.newContext({ ...devices["iPhone 13"] });

/* Freeze the calendar: 20 Aug 2026, between Hungary and Zandvoort. */
await ctx.addInitScript(() => {
  const FIXED = new Date("2026-08-20T12:00:00").getTime();
  const Real = Date;
  function Fake(...a) {
    return a.length ? new Real(...a) : new Real(FIXED);
  }
  Fake.prototype = Real.prototype;
  Fake.now = () => FIXED;
  Fake.parse = Real.parse;
  Fake.UTC = Real.UTC;
  window.Date = Fake;
});

const page = await ctx.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
const external = [];
page.on("request", (r) => { if (new URL(r.url()).origin !== base) external.push(r.url()); });

const text = () => page.locator(".wrap").innerText();
const says = async (s) => (await text()).toLowerCase().includes(s.toLowerCase());

await page.goto(base + "/index.html");
await page.waitForSelector(".nextrace", { timeout: 8000 });

/* ---- the app knows where it is in the season ---- */
check("names the next race", (await text()).includes("Zandvoort"));
check("counts down to it", await says("This weekend"));
check("asks for the result of the race just run", await says("Enter the Budapest result"));
check("season strip has a cell per round", (await page.locator(".strip .cell").count()) === 24);
check("no daily framing anywhere on the page",
  !/day streak|due today|每|daily/i.test(await text()), await text().then((t) => t.match(/day\w*/gi)?.join(",") ?? ""));
await page.screenshot({ path: join(SHOTS, "01-race-week.png") });

/* ---- entering a result opens the check ---- */
async function enterResult(roundNumber, mode, picks) {
  await page.locator(".nav button", { hasText: "Season" }).click();
  await page.waitForSelector(".rounds");
  await page.locator(".round").nth(roundNumber - 1).click();
  await page.waitForSelector(".sheet");
  const label = mode === "quali" ? "Qualifying" : mode === "race" ? "Race" : "Sprint";
  await page.locator(".sheet .row.between", { hasText: label }).locator(".btn").click();
  await page.waitForSelector(".sheet .pool");
  for (const name of picks) await page.locator(".sheet .pool .btn", { hasText: name }).first().click();
  await page.locator(".sheet .btn.primary", { hasText: "Save" }).click();
  await page.waitForTimeout(120);
  await page.locator(".sheet .btn", { hasText: "Close" }).click();
  await page.waitForTimeout(80);
}

await enterResult(13, "race", ["Norris", "Verstappen", "Leclerc", "Russell", "Piastri", "Hamilton"]);
await enterResult(13, "quali", ["Verstappen", "Norris", "Piastri", "Leclerc"]);

await page.locator(".nav button", { hasText: "Race" }).click();
await page.waitForSelector(".hero");
check("check opens once the result is in", await says("Do you still have Budapest?"));
await page.screenshot({ path: join(SHOTS, "02-check-ready.png") });

/* ---- sit the check ---- */
const tagsSeen = new Set();
async function sit(label, { answer = "first" } = {}) {
  let asked = 0, guard = 0;
  while (guard++ < 80) {
    const tag = page.locator(".qtag");
    if (await tag.count()) tagsSeen.add((await tag.innerText()).trim().toLowerCase());
    if (await page.locator(".verdict").count()) {
      await page.locator(".qfoot .btn.primary").click();
      await page.waitForTimeout(60); continue;
    }
    if (await page.locator(".opts .opt, .opt-maps .opt").count()) {
      const opts = page.locator(".opts .opt, .opt-maps .opt");
      await opts.nth(answer === "first" ? 0 : (await opts.count()) - 1).click();
      asked++; await page.waitForTimeout(60); continue;
    }
    if (await page.locator(".pool .btn").count()) {
      const n = await page.locator(".order-slots .slot").count();
      for (let i = 0; i < n; i++) {
        await page.locator(".pool .btn:not(.used)").first().click();
        await page.waitForTimeout(25);
      }
      await page.locator(".qfoot .btn.primary", { hasText: "Check" }).click();
      asked++; await page.waitForTimeout(60); continue;
    }
    break;
  }
  check(`${label}: answered ${asked}`, asked >= 5, "wanted >= 5");
  return asked;
}

await page.locator(".hero .btn.primary").click();
await page.waitForSelector(".prompt");
await page.screenshot({ path: join(SHOTS, "03-check-question.png") });
const askedInCheck = await sit("round 13 check");
check("a check is short", askedInCheck <= 10, `${askedInCheck} questions`);
check("the check is labelled in parts", tagsSeen.has("the race just gone"), [...tagsSeen].join(" / "));
check("it points at the circuit coming up",
  [...tagsSeen].some((t) => t.includes("zandvoort")), [...tagsSeen].join(" / "));

check("summary names the round", await says("Round 13 checked"));
await page.screenshot({ path: join(SHOTS, "04-check-done.png") });
check("misses are promised back before the next race",
  /comes back before Zandvoort|Nothing carried forward/.test(await text()));
await page.locator(".btn.primary", { hasText: "Done" }).click();
await page.waitForSelector(".strip");

const store = async () => JSON.parse(await page.evaluate(() => localStorage.getItem("apex.f1.v2")));
let s = await store();
check("the check is recorded against the round", !!s.checks["13"], JSON.stringify(s.checks));
check("it counts as on time", s.checks["13"].onTime === true);
check("misses are carried, not scheduled by date", s.carry.length > 0 &&
  !JSON.stringify(s).includes("due"), `${s.carry.length} carried`);
const carried = s.carry.slice();

/* ---- a second check brings the carried misses back ---- */
await enterResult(12, "race", ["Verstappen", "Piastri", "Norris", "Hamilton", "Antonelli", "Sainz"]);
await page.locator(".nav button", { hasText: "Race" }).click();
await page.waitForSelector(".hero");
check("the skipped round is offered next", await says("Spa"));
await page.locator(".hero .btn.primary").click();
await page.waitForSelector(".prompt");
await sit("round 12 check", { answer: "last" });
check("carried misses come back at the next check",
  tagsSeen.has("you missed this last time"), [...tagsSeen].join(" / "));
await page.locator(".btn.primary", { hasText: "Done" }).click();

s = await store();
check("carry list changes as you answer",
  JSON.stringify(s.carry) !== JSON.stringify(carried), `${carried.length} -> ${s.carry.length}`);
check("two races now checked", Object.keys(s.checks).length === 2);

/* ---- record ---- */
await page.locator(".nav button", { hasText: "Record" }).click();
await page.waitForSelector(".list");
check("record is race by race", await says("Race by race"));
check("record counts races, not days",
  (await says("races checked")) && !/\bday\b|daily|streak of days/i.test(await text()));
await page.screenshot({ path: join(SHOTS, "05-record.png") });

/* ---- practice is there but separate ---- */
await page.locator(".nav button", { hasText: "Race" }).click();
await page.waitForSelector(".secgrid");
check("practice offers the three background sections",
  (await page.locator(".secgrid .sec").count()) === 3);
await page.locator(".sec", { hasText: "Circuits" }).click();
await page.waitForSelector(".prompt");
const practised = await sit("circuits practice");
check("practice is a longer sitting than a check", practised === 10, `${practised}`);
check("practice carries nothing forward", await says("just reps"));
await page.locator(".btn.primary", { hasText: "Done" }).click();
s = await store();
check("practice does not touch the check record", Object.keys(s.checks).length === 2);

/* ---- circuits tab ---- */
await page.locator(".nav button", { hasText: "Circuits" }).click();
await page.waitForSelector(".trackgrid");
check("2026 circuits listed", (await page.locator(".trackcard").count()) === 24);
await page.locator(".seg button", { hasText: "All 2020+" }).click();
check("all circuits listed", (await page.locator(".trackcard").count()) === 32);
const badMaps = await page.evaluate(() =>
  [...document.querySelectorAll(".trackcard path")].map((p) => {
    const b = p.getBBox();
    return { name: p.closest(".trackcard").querySelector("b").textContent,
             long: Math.max(b.width, b.height), short: Math.min(b.width, b.height) };
  }).filter((m) => m.long < 780 || m.short < 40));
check("every outline fills its box on the long axis", badMaps.length === 0,
  badMaps.map((m) => m.name).join(", "));
const ribbon = await page.evaluate(() => {
  const p = [...document.querySelectorAll(".trackcard")]
    .find((c) => c.querySelector("b").textContent === "Jeddah").querySelector("path").getBBox();
  return +(Math.max(p.width, p.height) / Math.min(p.width, p.height)).toFixed(2);
});
check("true proportions are kept, not stretched", ribbon > 2, `Jeddah ${ribbon}:1`);
await page.screenshot({ path: join(SHOTS, "06-circuits.png") });

/* ---- state survives a reload ---- */
await page.reload();
await page.waitForSelector(".strip");
check("everything survives a reload", (await page.locator(".strip .cell.good, .strip .cell.part").count()) === 2);

/* ---- settings ---- */
await page.locator(".top .btn.ghost").click();
await page.waitForSelector(".sheet .seg");
check("settings has no session-length or section switches",
  (await page.locator(".sheet .seg").count()) === 1 && !(await page.locator(".sheet .switch").count()));
await page.locator(".sheet .seg button", { hasText: "Light" }).click();
await page.waitForTimeout(100);
check("light theme applies", await page.evaluate(() => document.documentElement.dataset.theme === "light"));
await page.screenshot({ path: join(SHOTS, "07-settings-light.png") });
await page.locator(".sheet .btn", { hasText: "Export the 2026 results" }).click();
await page.waitForSelector(".sheet textarea");
const exported = await page.locator(".sheet textarea").inputValue();
check("results export is valid JSON",
  (() => { try { return Object.keys(JSON.parse(exported)).length === 2; } catch { return false; } })());
await page.locator(".sheet .btn.ghost", { hasText: "Back" }).click();
await page.locator(".sheet .seg button", { hasText: "Dark" }).click();
await page.locator(".sheet .btn", { hasText: "Close" }).click();

/* ---- nothing overflows, nothing phones home ---- */
for (const tab of ["Race", "Season", "Circuits", "Record"]) {
  await page.locator(".nav button", { hasText: tab }).click();
  await page.waitForTimeout(160);
  const over = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(`${tab} fits the screen`, !over);
}
check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" | "));
check("the app makes no external requests at all", external.length === 0, external.slice(0, 3).join(", "));
check("text renders in the system font stack",
  /Samsung Sans|Verdana/.test(await page.evaluate(() => getComputedStyle(document.body).fontFamily)));

await browser.close();
server.close();
console.log(failures ? `\n${failures} failing check(s)` : "\nall checks passed");
process.exit(failures ? 1 : 0);
