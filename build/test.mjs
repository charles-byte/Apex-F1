/* Drives the whole app in a real browser at phone dimensions.

   The clock is frozen at 20 August 2026, mid-season: round 11 (Hungary) has
   been run, round 12 (Zandvoort) is three days away. Everything the app does
   hangs off those two facts, so the test would be meaningless without a fixed
   date.

   Results are official and ship with the app, so there is nothing to enter —
   the check opens on its own. The tests that used to type a result in now
   assert that you cannot. Screenshots land in build/shots/. */
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
/* The old app asked you to type the result in and then graded you against
   it. Nothing should ask for one now. */
check("does not ask you to enter a result", !(await says("Enter the")));
check("the last race run is already available to check", await says("Budapest"));
check("season strip has a cell per round", (await page.locator(".strip .cell").count()) === 23);
check("no daily framing anywhere on the page",
  !/day streak|due today|每|daily/i.test(await text()), await text().then((t) => t.match(/day\w*/gi)?.join(",") ?? ""));
await page.screenshot({ path: join(SHOTS, "01-race-week.png") });

/* ---- the check is already open: the result came with the app ---- */
check("the check is offered without any data entry",
  await says("Do you still have Budapest?"));
check("nothing anywhere invites you to enter a result",
  !/enter the .* result|add result/i.test(await text()));
await page.screenshot({ path: join(SHOTS, "02-check-ready.png") });

const official = await page.evaluate(async () => {
  const r = await fetch("data/season-2026.json");
  return await r.json();
});
const round11 = official.results["11"];
const winner = official.drivers.find((d) => d.id === round11.race[0].driver).name;
check("the official winner of round 11 is known to the app", !!winner, winner);

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
const askedInCheck = await sit("round 11 check");
check("a check is short", askedInCheck <= 10, `${askedInCheck} questions`);
check("the check is labelled in parts", tagsSeen.has("the race just gone"), [...tagsSeen].join(" / "));
check("it points at the circuit coming up",
  [...tagsSeen].some((t) => t.includes("zandvoort")), [...tagsSeen].join(" / "));

check("summary names the round", await says("Round 11 checked"));
await page.screenshot({ path: join(SHOTS, "04-check-done.png") });
check("misses are promised back before the next race",
  /comes back before Zandvoort|Nothing carried forward/.test(await text()));
await page.locator(".btn.primary", { hasText: "Done" }).click();
await page.waitForSelector(".strip");

const store = async () => JSON.parse(await page.evaluate(() => localStorage.getItem("apex.f1.v3")));
let s = await store();
check("the check is recorded against the round", !!s.checks["11"], JSON.stringify(s.checks));
check("it counts as on time", s.checks["11"].onTime === true);
check("misses are carried, not scheduled by date", s.carry.length > 0 &&
  !JSON.stringify(s).includes("due"), `${s.carry.length} carried`);
const carried = s.carry.slice();

/* ---- a second check brings the carried misses back ---- */
await page.locator(".nav button", { hasText: "Race" }).click();
await page.waitForSelector(".hero");
check("the round before it is offered next", await says("Spa"));
await page.locator(".hero .btn.primary").click();
await page.waitForSelector(".prompt");
await sit("round 10 check", { answer: "last" });
check("carried misses come back at the next check",
  tagsSeen.has("you missed this last time"), [...tagsSeen].join(" / "));
await page.locator(".btn.primary", { hasText: "Done" }).click();

s = await store();
check("carry list changes as you answer",
  JSON.stringify(s.carry) !== JSON.stringify(carried), `${carried.length} -> ${s.carry.length}`);
check("two races now checked", Object.keys(s.checks).length === 2);

/* ---- a round opens and shows the official result ---- */
await page.locator(".nav button", { hasText: "Season" }).click();
await page.waitForSelector(".rounds");
await page.locator(".round").nth(10).click();
await page.waitForSelector(".sheet", { timeout: 5000 });
await page.waitForTimeout(350);          // let the sheet finish sliding in
const sheetText = await page.locator(".sheet").innerText();
check("a round sheet opens", sheetText.length > 0);
check("it shows the official finishing order",
  /\brace\b/i.test(sheetText) && sheetText.includes(winner), winner);
check("it shows qualifying and the championship after that round",
  /Qualifying/i.test(sheetText) && /Championship after/i.test(sheetText));
check("it shows retirements with reasons", /Did not finish/i.test(sheetText));
await page.screenshot({ path: join(SHOTS, "08-round-official.png") });
await page.locator(".sheet .btn", { hasText: "Close" }).click();
await page.waitForTimeout(120);

/* the standings tabs are official too */
await page.locator(".seg button", { hasText: "Drivers" }).click();
await page.waitForTimeout(120);
check("drivers' championship is listed", (await page.locator(".wrap .li").count()) > 10);
await page.locator(".seg button", { hasText: "Teams" }).click();
await page.waitForTimeout(120);
check("constructors' championship is listed", (await page.locator(".wrap .li").count()) > 5);
await page.locator(".seg button", { hasText: "Races" }).click();
await page.waitForTimeout(120);

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
check("2026 circuits listed", (await page.locator(".trackcard").count()) === 23);
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
await page.locator(".sheet .btn", { hasText: "Export your record" }).click();
await page.waitForSelector(".sheet textarea");
const exported = await page.locator(".sheet textarea").inputValue();
check("the export is your record and holds no results",
  (() => {
    try {
      const e = JSON.parse(exported);
      return e.v === 3 && e.checks && Object.keys(e.checks).length === 2 && !("results" in e);
    } catch { return false; }
  })(), exported.slice(0, 80));
await page.locator(".sheet .btn.ghost", { hasText: "Back" }).click();
await page.locator(".sheet .seg button", { hasText: "Dark" }).click();
await page.locator(".sheet .btn", { hasText: "Close" }).click();

/* ---- the answer key is the official result, and only that ----
   This is the bug the app was built around getting wrong: it used to grade
   your recall against results you had typed in, so a misremembered result
   was marked correct forever. These checks pin the answer key to the file. */
await page.evaluate(() => localStorage.removeItem("apex.f1.v3"));
await page.reload();
await page.waitForSelector(".hero");

/* A check samples six of the round's questions, so "who won" is not
   guaranteed to come up in any one sitting. Start it, look for that
   question, and abandon the sitting and start again if it did not appear. */
let verdictClass = null, optionsSeen = "";
for (let attempt = 0; attempt < 10 && verdictClass === null; attempt++) {
  /* Wipe the record before each attempt so the same round is always the one
     pending. Otherwise a completed sitting checks that round off and the next
     attempt is asking about a different race. */
  await page.evaluate(() => localStorage.removeItem("apex.f1.v3"));
  await page.reload();
  await page.waitForSelector(".hero .btn.primary");
  await page.locator(".hero .btn.primary").click();
  await page.waitForSelector(".prompt");

  for (let i = 0; i < 40; i++) {
    if (await page.locator(".verdict").count()) {
      await page.locator(".qfoot .btn.primary").click();
      await page.waitForTimeout(50); continue;
    }
    const opts = page.locator(".opts .opt");
    if (!(await opts.count())) {
      /* an ordering question - answer it any old way; we are only hunting
         for the multiple-choice "who won" here */
      if (await page.locator(".pool .btn").count()) {
        const slots = await page.locator(".order-slots .slot").count();
        for (let k = 0; k < slots; k++) {
          await page.locator(".pool .btn:not(.used)").first().click();
          await page.waitForTimeout(20);
        }
        await page.locator(".qfoot .btn.primary", { hasText: "Check" }).click();
        await page.waitForTimeout(50);
        continue;
      }
      break;
    }
    const prompt = await page.locator(".prompt").innerText();
    if (/who won the .*grand prix/i.test(prompt)) {
      const labels = (await opts.allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
      optionsSeen = labels.join(" | ");
      const idx = labels.findIndex((t) => t.endsWith(winner));
      if (idx >= 0) {
        await opts.nth(idx).click();
        await page.waitForSelector(".verdict");
        verdictClass = await page.locator(".verdict").getAttribute("class");
      }
      break;
    }
    await opts.first().click();
    await page.waitForTimeout(50);
  }
}
check("the official winner was offered as an option", optionsSeen.includes(winner),
  optionsSeen || "the winner question never came up");
check("picking the official winner is marked correct",
  verdictClass !== null && /\bok\b/.test(verdictClass), String(verdictClass));

/* Results are not part of device state, so nothing written there can move
   the answer key. */
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem("apex.f1.v3")) || {};
  s.results = { 2026: { 11: { race: ["FAKE"], quali: ["FAKE"] } } };
  localStorage.setItem("apex.f1.v3", JSON.stringify(s));
});
await page.reload();
await page.waitForSelector(".strip");
const stillOfficial = await page.evaluate(() => {
  const q = [...document.querySelectorAll(".strip .cell")].length;
  return q;
});
check("a forged result in device storage changes nothing", stillOfficial === 23);
await page.locator(".nav button", { hasText: "Season" }).click();
await page.waitForSelector(".rounds");
check("the season still shows the official winner",
  (await page.locator(".wrap").innerText()).includes(winner.split(" ").pop()),
  `expected ${winner} to still be listed`);

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
