/* Invariants over the four data files. These are the checks that catch a
   dataset typo before it turns into a question with a wrong answer. */
import { readFileSync } from "node:fs";

const read = (p) => JSON.parse(readFileSync(new URL("../data/" + p, import.meta.url), "utf8"));
const champs = read("champions.json");
const lineups = read("lineups.json");
const circuits = read("circuits.json");
const season = read("season-2026.json");
const geo = read("f1-circuits.geojson");

let fails = 0;
function check(label, cond, extra = "") {
  console.log(`${cond ? "  ok  " : "FAIL  "}${label}${extra ? " — " + extra : ""}`);
  if (!cond) fails++;
}
const uniq = (a) => a.filter((x, i) => a.indexOf(x) === i);

/* ---------------------------------------------------------- championships */
const years = champs.seasons.map((s) => s.year);
check("seasons run 2008-2025 with no gaps",
  years.length === 18 && years.every((y, i) => y === 2008 + i), years.join(","));

for (const s of champs.seasons) {
  const dpos = s.drivers.map((d) => d.pos);
  check(`${s.year} driver positions are 1..n`, dpos.every((p, i) => p === i + 1), dpos.join(","));
  check(`${s.year} drivers are distinct`, uniq(s.drivers.map((d) => d.driver)).length === s.drivers.length);
  const pts = s.drivers.map((d) => d.points).filter((p) => p !== undefined);
  check(`${s.year} driver points never rise down the order`,
    pts.every((p, i) => i === 0 || p <= pts[i - 1]), pts.join(","));
  const cpts = s.constructors.map((c) => c.points).filter((p) => p !== undefined);
  check(`${s.year} constructor points never rise down the order`,
    cpts.every((p, i) => i === 0 || p <= cpts[i - 1]), cpts.join(","));
}
check("every margin refers to a real season and its actual top two",
  champs.margins.every((m) => {
    const s = champs.seasons.find((x) => x.year === m.year);
    return s && s.drivers[0].driver === m.champion && s.drivers[1].driver === m.runnerUp;
  }));

/* ---------------------------------------------------------------- lineups */
check("lineups cover 2008-2026", lineups.seasons.length === 19 &&
  lineups.seasons[0].year === 2008 && lineups.seasons[18].year === 2026);

for (const s of lineups.seasons) {
  check(`${s.year} every team has exactly two drivers`,
    s.teams.every((t) => t.drivers.length === 2),
    s.teams.filter((t) => t.drivers.length !== 2).map((t) => t.team).join(","));
  const all = s.teams.flatMap((t) => t.drivers);
  const dupes = all.filter((d, i) => all.indexOf(d) !== i);
  check(`${s.year} no driver appears in two seats`, dupes.length === 0, uniq(dupes).join(","));
  check(`${s.year} team names are distinct`, uniq(s.teams.map((t) => t.team)).length === s.teams.length);
}

/* the two files have to agree about who drove for whom */
for (const s of champs.seasons) {
  const grid = lineups.seasons.find((l) => l.year === s.year);
  const seats = grid.teams.flatMap((t) => t.drivers.map((d) => d + " @ " + t.team));
  const champ = s.drivers[0];
  check(`${s.year} champion's team matches the grid`,
    seats.includes(champ.driver + " @ " + champ.team), champ.driver + " @ " + champ.team);
  const teams = grid.teams.map((t) => t.team);
  check(`${s.year} constructors' champion is on the grid`,
    teams.includes(s.constructors[0].team), s.constructors[0].team);
}

/* --------------------------------------------------------------- circuits */
const ids = circuits.circuits.map((c) => c.id);
check("circuit ids are unique", uniq(ids).length === ids.length);
check("every circuit has survey geometry", circuits.circuits.every((c) => c.osmId && c.points > 0));
for (const c of circuits.circuits) {
  check(`${c.short} is fully described`,
    c.lengthKm > 2 && c.lengthKm < 8 && c.turns > 6 && c.turns < 30 &&
    c.laps > 30 && c.laps < 90 && c.firstGp >= 1950 && c.firstGp <= 2026 &&
    ["clockwise", "anti-clockwise"].includes(c.direction) && !!c.signature,
    `${c.lengthKm}km ${c.turns}t ${c.laps}laps ${c.firstGp} ${c.direction}`);
  check(`${c.short} outline is a closed polyline inside the 1000 box`,
    /^M [\d.]+ [\d.]+( L [\d.]+ [\d.]+)+ Z$/.test(c.path) &&
    (c.path.match(/[\d.]+/g) || []).every((n) => +n >= 0 && +n <= 1000));
  check(`${c.short} outline keeps every surveyed point`,
    c.points >= 60 && c.path.split(" L ").length === c.points);
  check(`${c.short} only claims seasons it could have raced`,
    c.used.every((y) => y >= 2020 && y <= 2026));
  if (c.round2026) check(`${c.short} is listed as racing in 2026`, c.used.includes(2026));
}
/* The outline has to be the right circuit, not just a plausible one: walking
   the traced ring has to come back within a couple of percent of the lap
   length published for it. */
const R = 6371008.8, rad = Math.PI / 180;
for (const c of circuits.circuits) {
  const f = geo.features.find((x) => x.properties.id === c.osmId);
  check(`${c.short} is linked to survey geometry`, !!f, c.osmId);
  if (!f) continue;
  const co = f.geometry.coordinates;
  const lat0 = co.reduce((a, p) => a + p[1], 0) / co.length;
  const k = Math.cos(lat0 * rad);
  const xy = co.map(([lon, lat]) => [R * rad * lon * k, R * rad * lat]);
  let len = 0;
  for (let i = 1; i < xy.length; i++) len += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
  const drift = Math.abs(len / 1000 - c.lengthKm) / c.lengthKm;
  check(`${c.short} traces to its published lap length`, drift < 0.02,
    `${(len / 1000).toFixed(3)} km traced vs ${c.lengthKm} km stated`);
}

const rounds = circuits.circuits.filter((c) => c.round2026).map((c) => c.round2026).sort((a, b) => a - b);
check("2026 rounds are exactly 1..24", rounds.length === 24 && rounds.every((r, i) => r === i + 1));

/* ----------------------------------------------------------------- season */
check("calendar has 24 rounds numbered in order",
  season.rounds.length === 24 && season.rounds.every((r, i) => r.round === i + 1));
check("every round points at a real circuit",
  season.rounds.every((r) => ids.includes(r.circuit)),
  season.rounds.filter((r) => !ids.includes(r.circuit)).map((r) => r.circuit).join(","));
check("calendar and circuit rounds agree", season.rounds.every((r) => {
  const c = circuits.circuits.find((x) => x.id === r.circuit);
  return c.round2026 === r.round;
}));
const dates = season.rounds.map((r) => Date.parse(r.date));
check("race dates run forwards", dates.every((d, i) => i === 0 || d > dates[i - 1]));
check("driver codes are unique", uniq(season.drivers.map((d) => d.code)).length === season.drivers.length);
check("car numbers are unique", uniq(season.drivers.map((d) => d.number)).length === season.drivers.length);
check("the 2026 entry list matches the 2026 grid", (() => {
  const grid = lineups.seasons.find((s) => s.year === 2026).teams.flatMap((t) => t.drivers);
  const entry = season.drivers.map((d) => d.name);
  return grid.length === entry.length && grid.every((d) => entry.includes(d));
})());

console.log(fails ? `\n${fails} failing check(s)` : "\nall data checks passed");
process.exit(fails ? 1 : 0);
