/* Regenerates every factual file in data/ from F1DB, the official-results
   database at github.com/f1db/f1db (CC BY 4.0).

   This exists because the app used to grade you against results you had typed
   in yourself. If you misremembered while entering, the check confirmed the
   mistake — a memory trainer whose ground truth was your own memory. Nothing
   in data/ is written by hand any more, and the season calendar, the results,
   the standings and the lineups all come from here.

     node build/f1db.mjs            # regenerate from the local clone
     node build/f1db.mjs --fetch    # clone or update F1DB first
     node build/f1db.mjs --check    # report what would change, write nothing

   The clone lives in vendor/ and is not committed; only the generated JSON is.
*/
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
const yaml = createRequire(import.meta.url)("js-yaml");

const ROOT = new URL("..", import.meta.url).pathname;
const VENDOR = ROOT + "vendor/f1db";
const SRC = VENDOR + "/src/data";
const SEASON = 2026;
const FIRST_CHAMPIONSHIP_YEAR = 2008;

const fetchFirst = process.argv.includes("--fetch");
const checkOnly = process.argv.includes("--check");

if (fetchFirst) {
  mkdirSync(ROOT + "vendor", { recursive: true });
  if (existsSync(VENDOR)) {
    console.log("updating vendor/f1db");
    execFileSync("git", ["-C", VENDOR, "pull", "--depth", "1", "-q"], { stdio: "inherit" });
  } else {
    console.log("cloning f1db");
    execFileSync("git", ["clone", "--depth", "1", "-q", "https://github.com/f1db/f1db.git", VENDOR],
      { stdio: "inherit" });
  }
}
if (!existsSync(SRC)) {
  console.error("no F1DB clone at vendor/f1db — run: node build/f1db.mjs --fetch");
  process.exit(1);
}

const load = (p) => yaml.load(readFileSync(SRC + "/" + p, "utf8"));
const maybe = (p) => (existsSync(SRC + "/" + p) ? load(p) : null);

/* F1DB writes a classified finish as a number and everything else as a code:
   DNF, DNS, NC (not classified), DSQ, and PL for a pit-lane start. Treating
   those as positions would put a retirement on the podium, so only integers
   count as a finishing position. */
const placed = (v) => (Number.isInteger(v) ? v : null);

/* ------------------------------------------------------------- lookups */
const driverCache = new Map();
function driver(id) {
  if (!driverCache.has(id)) {
    const d = load(`drivers/${id}.yml`);
    driverCache.set(id, { id, name: d.name, code: d.abbreviation, number: d.permanentNumber });
  }
  return driverCache.get(id);
}
const gpCache = new Map();
/* officialName carries the sponsor ("Formula 1 AWS Hungarian Grand Prix 2026");
   the grand-prix record has the plain name that does not change year to year. */
function grandPrix(id) {
  if (!gpCache.has(id)) gpCache.set(id, load(`grands-prix/${id}.yml`).fullName);
  return gpCache.get(id);
}
const teamCache = new Map();
function team(id) {
  if (!teamCache.has(id)) teamCache.set(id, load(`constructors/${id}.yml`).name);
  return teamCache.get(id);
}

/* ------------------------------------------------- the current season */
const raceDirs = readdirSync(`${SRC}/seasons/${SEASON}/races`).sort();
const rounds = [];
const results = {};
const seen = new Set();

for (const dir of raceDirs) {
  const base = `seasons/${SEASON}/races/${dir}`;
  const r = load(`${base}/race.yml`);
  rounds.push({
    round: r.round,
    gp: grandPrix(r.grandPrixId),
    circuit: r.circuitId,
    date: r.date,
    laps: r.laps,
    sprint: existsSync(`${SRC}/${base}/sprint-race-results.yml`)
  });
  seen.add(r.circuitId);

  const race = maybe(`${base}/race-results.yml`);
  if (!race) continue;                       // not run yet

  const finish = race
    .filter((x) => placed(x.position))
    .map((x) => ({
      pos: x.position, driver: x.driverId, team: x.constructorId,
      grid: placed(x.gridPosition),                 // null for a pit-lane start
      fromPits: x.gridPosition === "PL" || undefined,
      points: x.points ?? 0
    }));
  /* Anyone who started and is not in the classified order. */
  const out = race
    .filter((x) => !placed(x.position) && x.position !== "DNS")
    .map((x) => ({ driver: x.driverId, status: x.position, reason: x.reasonRetired || null }));

  const quali = (maybe(`${base}/qualifying-results.yml`) || [])
    .filter((x) => placed(x.position))
    .map((x) => ({ pos: x.position, driver: x.driverId }));

  const sprint = (maybe(`${base}/sprint-race-results.yml`) || [])
    .filter((x) => placed(x.position))
    .map((x) => ({ pos: x.position, driver: x.driverId }));

  const standing = maybe(`${base}/driver-standings.yml`);

  results[r.round] = {
    race: finish, quali, sprint, retired: out,
    /* the championship as it stood after this round, not as it stands now */
    standingsAfter: (standing || []).filter((s) => placed(s.position)).slice(0, 10)
      .map((s) => ({ pos: s.position, driver: s.driverId, points: s.points }))
  };
}

const entrants = load(`seasons/${SEASON}/entrants.yml`);
const drivers = [];
const teams = [];
for (const e of entrants) {
  const racing = (e.drivers || []).filter((d) => !d.testDriver && d.rounds !== null);
  teams.push({ id: e.constructorId, name: team(e.constructorId),
    drivers: racing.map((d) => d.driverId) });
  for (const d of racing) {
    const info = driver(d.driverId);
    if (!drivers.some((x) => x.id === info.id)) drivers.push({ ...info, team: e.constructorId });
  }
}

const season = {
  year: SEASON,
  source: "F1DB (github.com/f1db/f1db), CC BY 4.0. Generated by build/f1db.mjs — do not edit by hand.",
  generated: new Date().toISOString().slice(0, 10),
  drivers, teams, rounds, results,
  standings: {
    drivers: (load(`seasons/${SEASON}/driver-standings.yml`) || [])
      .map((s) => ({ pos: s.position, driver: s.driverId, points: s.points })),
    constructors: (load(`seasons/${SEASON}/constructor-standings.yml`) || [])
      .map((s) => ({ pos: s.position, team: s.constructorId, points: s.points }))
  }
};

/* ------------------------------------------------ seats, season by season */
/* Which constructor a driver actually raced for that year, and how much of
   the year each driver covered - "1-11" style round ranges, so a mid-season
   replacement can be told from a full-season seat. */
function seatsFor(year) {
  const es = maybe(`seasons/${year}/entrants.yml`);
  if (!es) return null;
  const rounds = existsSync(`${SRC}/seasons/${year}/races`)
    ? readdirSync(`${SRC}/seasons/${year}/races`).length : 0;
  const span = (r) => {
    if (!r) return rounds;                              // no range given = all season
    return String(r).split(",").reduce((n, part) => {
      const [a, b] = part.split("-").map(Number);
      return n + (b ? b - a + 1 : 1);
    }, 0);
  };
  /* A team that is renamed mid-season appears as two entrants against one
     constructor - Sahara and Racing Point Force India in 2018 - which would
     otherwise read as the same driver holding two seats. */
  const byConstructor = new Map();
  for (const e of es) {
    const racing = (e.drivers || []).filter((d) => !d.testDriver && d.rounds !== null);
    if (!racing.length) continue;
    if (!byConstructor.has(e.constructorId)) byConstructor.set(e.constructorId, new Map());
    const seats = byConstructor.get(e.constructorId);
    for (const d of racing) {
      const prev = seats.get(d.driverId) || { id: d.driverId, name: driver(d.driverId).name, span: 0, parts: [] };
      prev.span += span(d.rounds);
      if (d.rounds) prev.parts.push(String(d.rounds));
      seats.set(d.driverId, prev);
    }
  }
  return [...byConstructor.entries()].map(([id, seats]) => ({
    team: team(id), id,
    seats: [...seats.values()]
      .map((s) => ({ ...s, rounds: s.parts.length ? s.parts.join(",") : null }))
      .sort((a, b) => b.span - a.span)
  }));
}

/* --------------------------------------------------- past championships */
const champSeasons = [];
for (let y = FIRST_CHAMPIONSHIP_YEAR; y < SEASON; y++) {
  const ds = maybe(`seasons/${y}/driver-standings.yml`);
  const cs = maybe(`seasons/${y}/constructor-standings.yml`);
  if (!ds || !cs) continue;
  const races = readdirSync(`${SRC}/seasons/${y}/races`)
    .filter((d) => existsSync(`${SRC}/seasons/${y}/races/${d}/race-results.yml`)).length;
  const seats = seatsFor(y) || [];
  const teamOf = (id) => {
    const t = seats.find((x) => x.seats.some((s) => s.id === id));
    return t ? t.team : "";
  };
  const drivers = ds.slice(0, 10).map((s) => ({
    pos: s.position, driver: driver(s.driverId).name,
    team: teamOf(s.driverId), points: s.points
  }));
  champSeasons.push({
    year: y, races, drivers,
    constructors: cs.slice(0, 10).map((s) => ({
      pos: s.position, team: team(s.constructorId), points: s.points
    })),
    /* The title margin, subtracted rather than remembered. */
    margin: drivers.length > 1 && drivers[0].points != null && drivers[1].points != null
      ? +(drivers[0].points - drivers[1].points).toFixed(1) : null
  });
}
const champions = {
  source: season.source,
  generated: season.generated,
  seasons: champSeasons
};

/* ------------------------------------------------------------- lineups */
const lineupSeasons = [];
for (let y = FIRST_CHAMPIONSHIP_YEAR; y <= SEASON; y++) {
  const seats = seatsFor(y);
  if (!seats) continue;
  lineupSeasons.push({
    year: y,
    teams: seats.map((t) => ({
      team: t.team, id: t.id,
      /* the pairing that covered most of the year */
      drivers: t.seats.slice(0, 2).map((s) => s.name),
      /* anyone else who took that seat mid-season */
      changes: t.seats.slice(2).map((s) => ({ driver: s.name, rounds: s.rounds }))
    })).filter((t) => t.drivers.length === 2)
  });
}
const lineups = { source: season.source, generated: season.generated, seasons: lineupSeasons };

/* ------------------------- cross-check the circuit facts we already ship */
const circuits = JSON.parse(readFileSync(ROOT + "data/circuits.json", "utf8"));

/* Which round each circuit holds this year comes from the official calendar,
   so a circuit dropped from the calendar loses its round rather than keeping
   a stale one. Bahrain kept a 2026 round in the hand-written data long after
   it left the calendar; that is the sort of thing this replaces. */
const roundOf = {};
rounds.forEach((r) => { roundOf[r.circuit] = r.round; });

/* And the seasons each circuit has actually appeared in, from 2020 on. */
const MODERN_FROM = 2020;
const usedBy = {};
for (let y = MODERN_FROM; y <= SEASON; y++) {
  const dir = `${SRC}/seasons/${y}/races`;
  if (!existsSync(dir)) continue;
  for (const d of readdirSync(dir)) {
    const f = `${dir}/${d}/race.yml`;
    if (!existsSync(f)) continue;
    const id = yaml.load(readFileSync(f, "utf8")).circuitId;
    (usedBy[id] = usedBy[id] || new Set()).add(y);
  }
}
for (const c of circuits.circuits) {
  if (roundOf[c.id]) c.round2026 = roundOf[c.id];
  else delete c.round2026;
  c.used = usedBy[c.id] ? [...usedBy[c.id]].sort() : [];
}
writeFileSync(ROOT + "data/circuits.json", JSON.stringify(circuits, null, 2) + "\n");
const factDrift = [];
for (const c of circuits.circuits) {
  const f = maybe(`circuits/${c.id}.yml`);
  if (!f) { factDrift.push(`${c.id}: not in F1DB`); continue; }
  if (f.direction && c.direction) {
    const dir = { CLOCKWISE: "clockwise", ANTI_CLOCKWISE: "anti-clockwise" }[f.direction];
    if (dir && dir !== c.direction) factDrift.push(`${c.short}: direction ${c.direction} vs ${dir}`);
  }
}
/* lap counts and lengths come from the race entries, which are per-layout */
for (const rd of rounds) {
  const c = circuits.circuits.find((x) => x.id === rd.circuit);
  if (!c) { factDrift.push(`round ${rd.round}: no circuit ${rd.circuit}`); continue; }
  /* Race distance is per race, not per circuit - a shortened race is not a
     wrong fact - so only flag a round that has actually been run. */
  if (results[rd.round] && rd.laps && c.laps && rd.laps !== c.laps) {
    factDrift.push(`${c.short}: circuits.json says ${c.laps} laps, round ${rd.round} ran ${rd.laps}`);
  }
}

/* ------------------------------------------------------------- write */
function put(file, value) {
  const path = ROOT + "data/" + file;
  const next = JSON.stringify(value, null, 2) + "\n";
  const prev = existsSync(path) ? readFileSync(path, "utf8") : "";
  const changed = prev !== next;
  if (changed && !checkOnly) writeFileSync(path, next);
  console.log(`  ${changed ? (checkOnly ? "would change" : "written") : "unchanged"}  ${file}`);
  return changed;
}

const done = Object.keys(results).length;
console.log(`F1DB → data/  (${SEASON}: ${rounds.length} rounds, ${done} with official results)`);
let changed = false;
changed = put(`season-${SEASON}.json`, season) || changed;
changed = put("champions.json", champions) || changed;
changed = put("lineups.json", lineups) || changed;

if (factDrift.length) {
  console.log("\ncircuit facts that disagree with F1DB:");
  factDrift.forEach((d) => console.log("  " + d));
}
if (checkOnly) process.exit(changed ? 1 : 0);
