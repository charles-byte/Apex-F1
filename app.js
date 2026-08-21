/* =====================================================================
   Apex — a memory trainer for Formula 1.

   It runs on the race calendar, not on the clock. There is no daily
   streak to keep and nothing goes stale overnight.

   The loop is one check per Grand Prix. After a race, a short test on the
   race just gone — plus whatever you missed at an earlier check, plus a
   couple of questions on the circuit you are about to watch. Miss something
   and it comes back before the next race, not tomorrow.

   Results are official. They ship in data/season-2026.json, generated from
   F1DB by build/f1db.mjs, and the app has no way to edit them. An earlier
   version had you type the results in and then graded you against your own
   entry, which meant a misremembered result was marked correct forever.

   Recall is current season only. The championships, circuits and grids
   sit behind a Practice tab for when you feel like it, and never nag.

   Nothing leaves the device. State lives in localStorage and can be
   exported as JSON from Settings.
   ===================================================================== */
(function () {
  "use strict";

  var KEY = "apex.f1.v3";
  var SEASON = 2026;
  /* The pre-race check is the point of the app. These three are for the
     odd idle evening, and never nag. */
  var PRACTICE = [
    { id: "track",  name: "Circuits",      blurb: "Maps and facts, every layout since 2020" },
    { id: "champs", name: "Championships", blurb: "Titles and final standings, 2008-2025" },
    { id: "grid",   name: "Grids",         blurb: "Who drove for whom, 2008-2026" }
  ];

  var DATA = { champs: null, lineups: null, circuits: null, season: null };
  var CIRC = {};        // id -> circuit
  var state = null;
  var view = "race";
  var seasonTab = "races";
  var session = null;
  var sheet = null;
  var browseTrack = null;
  var openRound = null;
  var entry = null;     // in-progress results entry
  var toastTimer = null;

  var TEAM_COLOR = {
    "McLaren": "#FF8000", "Ferrari": "#E8002D", "Mercedes": "#27F4D2", "Red Bull": "#3671C6",
    "Racing Bulls": "#6692FF", "RB": "#6692FF", "AlphaTauri": "#5E8FAA", "Toro Rosso": "#469BFF",
    "Aston Martin": "#229971", "Alpine": "#00A1E8", "Williams": "#1868DB", "Haas": "#B6BABD",
    "Audi": "#4CE04C", "Kick Sauber": "#52E252", "Alfa Romeo": "#C92D4B", "Sauber": "#9B9B9B",
    "Cadillac": "#C0A15E", "Racing Point": "#F596C8", "Force India": "#FF5F0F", "Renault": "#FFF500",
    "Lotus": "#FFB800", "Brawn": "#B8FD6E", "BMW Sauber": "#3A55C8", "Toyota": "#CC1E1E",
    "Honda": "#D8D8D8", "Super Aguri": "#E60012", "Virgin": "#B10000", "Marussia": "#B10000",
    "Caterham": "#078F4D", "HRT": "#B2945B", "Manor": "#F8B0AD", "Toyota F1": "#CC1E1E"
  };
  function teamColor(t) { return TEAM_COLOR[t] || "#7C8797"; }

  /* ---------------------------------------------------------------- dom */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === "class") n.className = v;
      else if (k === "html") n.innerHTML = v;
      else if (k === "text") n.textContent = v;
      else if (k === "style") n.setAttribute("style", v);
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      n.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return n;
  }
  function icon(path) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  }
  var ICON = {
    train: '<path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>',
    track: '<path d="M4 14c0-4 2-7 6-7s5 2 5 4-1 3-3 3-3-1-3-3 2-4 5-4c4 0 6 3 6 7s-3 5-8 5-8-1-8-5Z"/>',
    season: '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M8 3v4M16 3v4M3 10h18"/>',
    record: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    gear: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
    back: '<path d="M15 19l-7-7 7-7"/>',
    close: '<path d="M18 6L6 18M6 6l12 12"/>',
    tick: '<path d="M20 6L9 17l-5-5"/>',
    cross: '<path d="M18 6L6 18M6 6l12 12"/>',
    flag: '<path d="M4 22V4M4 4h13l-2 4 2 4H4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>'
  };

  /* -------------------------------------------------------------- utils */
  function todayISO(d) {
    var t = d ? new Date(d) : new Date();
    return new Date(t.getTime() - t.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  }
  function addDays(iso, n) { return todayISO(new Date(Date.parse(iso) + n * 864e5)); }
  function daysBetween(a, b) { return Math.round((Date.parse(b) - Date.parse(a)) / 864e5); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  function sample(arr, n) { return shuffle(arr.slice()).slice(0, n); }
  function pickOne(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
  function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function pct(c, n) { return n ? Math.round(100 * c / n) : 0; }
  function ordinal(n) {
    var s = ["th", "st", "nd", "rd"], v = n % 100;
    return n + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function niceDate(iso) {
    var d = new Date(iso + "T12:00:00");
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  }
  function surname(name) {
    var p = String(name).split(" ");
    return p.length > 1 ? p.slice(1).join(" ") : name;
  }

  /* -------------------------------------------------------------- state */
  function freshState() {
    return {
      v: 3,
      theme: "system",
      /* No results here. They are official, they ship in data/, and the app
         has no way to edit them - that is the whole point. */
      checks: {},       // round -> { done, n, c, onTime }
      carry: [],        // question keys you missed, re-asked at the next check
      practice: {},     // key -> { n, c }
      log: [],
      created: todayISO()
    };
  }
  function load() {
    try {
      var s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 3) return s;
      /* v2 graded you against results you had typed in, so its check scores
         were measured against the wrong answer key. Keep the theme, drop the
         scores, and let every check open again against the official result. */
      if (s && s.v === 2) {
        var moved = freshState();
        moved.theme = s.theme || "system";
        return moved;
      }
    } catch (e) {}
    return freshState();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); }
    catch (e) { toast("Could not save — storage is full"); }
  }

  /* ---------------------------------------------------------- the season */
  function rounds() { return DATA.season.rounds; }
  function roundNo(n) {
    return rounds().filter(function (r) { return r.round === +n; })[0] || null;
  }
  /* The next race on the calendar — the thing you are getting ready for. */
  function nextRace() {
    var t = todayISO();
    return rounds().filter(function (r) { return r.date >= t; })[0] || null;
  }
  /* The last race that has actually been run, by the calendar. */
  function lastRun() {
    var t = todayISO();
    var past = rounds().filter(function (r) { return r.date < t; });
    return past.length ? past[past.length - 1] : null;
  }
  function checkFor(n) { return state.checks[String(n)] || null; }
  /* The last round you have entered a result for. */
  function lastRaced() {
    var done = racedRounds();
    return done.length ? done[done.length - 1] : null;
  }

  /* The check you owe: the most recent round you have results for and have
     not been through yet. Usually the last race; if you skipped one, it is
     the one you skipped, so nothing quietly disappears. */
  function pendingRound() {
    var done = racedRounds();
    for (var i = done.length - 1; i >= 0; i--) {
      if (!checkFor(done[i].round)) return done[i];
    }
    return null;
  }
  /* A check counts as on time if you did it before the next race started. */
  function onTimeFor(n) {
    var nxt = roundNo(+n + 1);
    return !nxt || todayISO() < nxt.date;
  }
  /* Consecutive races checked before the next one got going. */
  function raceStreak() {
    var done = racedRounds(), n = 0;
    for (var i = done.length - 1; i >= 0; i--) {
      var c = checkFor(done[i].round);
      if (c && c.onTime) n++; else break;
    }
    return n;
  }
  function checkedRounds() {
    return Object.keys(state.checks).map(Number).sort(function (a, b) { return a - b; });
  }

  /* ---------------------------------------------------------------- score */
  function grade(key, ok) {
    var p = state.practice[key] || { n: 0, c: 0 };
    p.n++; if (ok) p.c++;
    state.practice[key] = p;
    state.log.push({ t: Date.now(), k: key, s: key.split(":")[0], ok: !!ok,
      m: session ? session.mode : "practice" });
    if (state.log.length > 3000) state.log = state.log.slice(-2000);
    save();
  }
  function accuracyOf(key) {
    var p = state.practice[key];
    return p && p.n ? p.c / p.n : 1;
  }
  function sectionStats(id) {
    var n = 0, c = 0;
    state.log.forEach(function (e) { if (e.s === id) { n++; if (e.ok) c++; } });
    return { n: n, c: c, pct: pct(c, n) };
  }
  function totals() {
    var n = state.log.length, c = 0;
    state.log.forEach(function (e) { if (e.ok) c++; });
    return { n: n, c: c, pct: pct(c, n) };
  }

  /* --------------------------------------------------------------- 2026 */
  /* Results are official. They ship in data/season-2026.json, generated from
     F1DB by build/f1db.mjs, and nothing you do in the app can change them —
     the whole point is that the answer key is not your own memory. */
  function officialResults() { return DATA.season.results || {}; }
  function roundResult(r) { return officialResults()[String(r)] || null; }
  /* Rounds that have actually been run, in calendar order. */
  function racedRounds() {
    return DATA.season.rounds.filter(function (r) {
      var x = roundResult(r.round);
      return x && x.race && x.race.length >= 3;
    });
  }
  var driverIndex = null;
  function driverById(id) {
    if (!driverIndex) {
      driverIndex = {};
      (DATA.season.drivers || []).forEach(function (d) { driverIndex[d.id] = d; });
    }
    return driverIndex[id] || { id: id, name: prettyId(id), code: "", team: "" };
  }
  function driverName(id) { return driverById(id).name; }
  /* A driver who has left the grid still appears in an earlier result. */
  function prettyId(id) {
    return String(id).split("-").map(function (w) {
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }
  var teamIndex = null;
  function teamName(id) {
    if (!teamIndex) {
      teamIndex = {};
      (DATA.season.teams || []).forEach(function (t) { teamIndex[t.id] = t.name; });
    }
    return teamIndex[id] || prettyId(id);
  }

  /* -------------------------------------------------------- 2026 standings */
  /* Also official: the championship after each round comes from F1DB rather
     than being re-added from points here, so a penalty or an appeal that
     changed the table is reflected exactly as it happened. */
  function standingsNow() { return (DATA.season.standings || {}).drivers || []; }
  function constructorsNow() { return (DATA.season.standings || {}).constructors || []; }
  function standingsAfter(round) {
    var r = roundResult(round);
    return r && r.standingsAfter ? r.standingsAfter : [];
  }

  /* ==================================================================
     Question bank.

     Every question has a stable key so its Leitner box survives across
     sessions; the distractors are re-drawn each time it is asked, so
     the answer cannot be memorised by position.
     ================================================================== */

  function mcq(o) {
    var opts = shuffle([{ id: o.correct, label: o.correct, sub: o.correctSub }].concat(
      o.wrong.map(function (w) { return typeof w === "string" ? { id: w, label: w } : w; })
    ));
    return {
      key: o.key, section: o.key.split(":")[0], kind: "mcq",
      prompt: o.prompt, sub: o.sub, mapId: o.mapId, maps: !!o.maps,
      options: opts, answer: o.correct, explain: o.explain
    };
  }
  function order(o) {
    return {
      key: o.key, section: o.key.split(":")[0], kind: "order",
      prompt: o.prompt, sub: o.sub, mapId: o.mapId,
      options: shuffle(o.items.slice()).map(function (x) { return { id: x, label: x }; }),
      answer: o.items.slice(), explain: o.explain
    };
  }

  var BANK = null;
  function bank() { return BANK || (BANK = buildBank()); }
  function rebuildBank() { BANK = null; }

  function buildBank() {
    var qs = [];
    qs = qs.concat(bankChamps(), bankTrack(), bankGrid(), bankRace());
    var seen = {};
    return qs.filter(function (q) { if (seen[q.key]) return false; seen[q.key] = 1; return true; });
  }

  /* ------------------------------------------------------- championships */
  function bankChamps() {
    var out = [], seasons = DATA.champs.seasons;
    var allChamps = uniq(seasons.map(function (s) { return s.drivers[0].driver; }));
    var allCTeams = uniq(seasons.map(function (s) { return s.constructors[0].team; }));
    var allDrivers = uniq([].concat.apply([], seasons.map(function (s) {
      return s.drivers.map(function (d) { return d.driver; });
    })));

    seasons.forEach(function (s) {
      var y = s.year, champ = s.drivers[0], team = s.constructors[0];

      out.push({ key: "champs:" + y + ":champ", make: function () {
        return mcq({
          key: "champs:" + y + ":champ",
          prompt: "Who won the drivers' championship in " + y + "?",
          correct: champ.driver,
          wrong: sample(allChamps.filter(function (d) { return d !== champ.driver; }), 3),
          explain: champ.driver + " took the " + y + " title with " + team.team +
            (champ.points ? " on " + champ.points + " points" : "") + ", ahead of " + s.drivers[1].driver + "."
        });
      } });

      out.push({ key: "champs:" + y + ":cchamp", make: function () {
        return mcq({
          key: "champs:" + y + ":cchamp",
          prompt: "Which team won the constructors' championship in " + y + "?",
          correct: team.team,
          wrong: sample(allCTeams.concat(s.constructors.slice(1).map(function (c) { return c.team; }))
            .filter(function (t) { return t !== team.team; }), 3),
          explain: team.team + " won the " + y + " constructors' title" +
            (team.points ? " with " + team.points + " points" : "") + "; " + s.constructors[1].team + " were second."
        });
      } });

      out.push({ key: "champs:" + y + ":p2", make: function () {
        var right = s.drivers[1].driver;
        return mcq({
          key: "champs:" + y + ":p2",
          prompt: "Who finished runner-up in the " + y + " drivers' championship?",
          sub: champ.driver + " won it.",
          correct: right,
          wrong: sample(s.drivers.slice(2).map(function (d) { return d.driver; }), 3),
          explain: right + " was second" + (s.drivers[1].points ? " on " + s.drivers[1].points + " points" : "") +
            ", with " + s.drivers[2].driver + " third."
        });
      } });

      out.push({ key: "champs:" + y + ":team", make: function () {
        return mcq({
          key: "champs:" + y + ":team",
          prompt: "Which team did the " + y + " world champion drive for?",
          sub: "The champion was " + champ.driver + ".",
          correct: champ.team,
          wrong: sample(allCTeams.filter(function (t) { return t !== champ.team; }), 3),
          explain: champ.driver + " won the " + y + " title driving for " + champ.team + "."
        });
      } });

      out.push({ key: "champs:" + y + ":order", make: function () {
        return order({
          key: "champs:" + y + ":order",
          prompt: "Final " + y + " drivers' standings",
          sub: "Put the top five in order, starting with the champion.",
          items: s.drivers.slice(0, 5).map(function (d) { return d.driver; }),
          explain: s.drivers.slice(0, 5).map(function (d) {
            return d.pos + ". " + d.driver + (d.points ? " (" + d.points + ")" : "");
          }).join("   ")
        });
      } });

      if (s.constructors.length >= 4) out.push({ key: "champs:" + y + ":corder", make: function () {
        return order({
          key: "champs:" + y + ":corder",
          prompt: "Final " + y + " constructors' standings",
          sub: "Put these four in order.",
          items: s.constructors.slice(0, 4).map(function (c) { return c.team; }),
          explain: s.constructors.slice(0, 4).map(function (c) {
            return c.pos + ". " + c.team + (c.points ? " (" + c.points + ")" : "");
          }).join("   ")
        });
      } });

      [3, 5].forEach(function (n) {
        if (s.drivers.length < n) return;
        out.push({ key: "champs:" + y + ":p" + n, make: function () {
          var right = s.drivers[n - 1].driver;
          return mcq({
            key: "champs:" + y + ":p" + n,
            prompt: "Who finished " + ordinal(n) + " in the " + y + " drivers' championship?",
            correct: right,
            wrong: sample(s.drivers.filter(function (d) { return d.driver !== right; })
              .map(function (d) { return d.driver; }), 3),
            explain: right + " was " + ordinal(n) + " in " + y +
              (s.drivers[n - 1].points ? " on " + s.drivers[n - 1].points + " points" : "") + "."
          });
        } });
      });
    });

    /* how many titles in the 2008-2025 window */
    var titleCount = {};
    seasons.forEach(function (s) { titleCount[s.drivers[0].driver] = (titleCount[s.drivers[0].driver] || 0) + 1; });
    Object.keys(titleCount).forEach(function (d) {
      out.push({ key: "champs:titles:" + d, make: function () {
        var n = titleCount[d];
        var wrong = uniq([n + 1, n - 1, n + 2, n - 2, n + 3].filter(function (x) { return x > 0 && x !== n; })).slice(0, 3);
        return mcq({
          key: "champs:titles:" + d,
          prompt: "How many drivers' titles did " + d + " win between 2008 and 2025?",
          correct: String(n),
          wrong: wrong.map(String),
          explain: d + " won " + plural(n, "title") + " in that span: " +
            seasons.filter(function (s) { return s.drivers[0].driver === d; })
              .map(function (s) { return s.year; }).join(", ") + "."
        });
      } });
    });

    /* Title margins, subtracted from the official points rather than
       remembered as trivia. */
    seasons.forEach(function (s) {
      if (s.margin == null) return;
      out.push({ key: "champs:" + s.year + ":margin", make: function () {
        var n = s.margin;
        var near = uniq([n + 1, n + 3, n - 1, n + 5, n + 2, n + 7]
          .filter(function (x) { return x > 0 && x !== n; })).slice(0, 3);
        return mcq({
          key: "champs:" + s.year + ":margin",
          prompt: "By how many points did " + s.drivers[0].driver + " beat " +
            s.drivers[1].driver + " in " + s.year + "?",
          correct: String(n),
          wrong: near.map(String),
          explain: s.drivers[0].driver + " " + s.drivers[0].points + ", " +
            s.drivers[1].driver + " " + s.drivers[1].points + " — " + plural(n, "point") + "."
        });
      } });
    });

    /* which season is this? */
    seasons.forEach(function (s) {
      out.push({ key: "champs:" + s.year + ":which", make: function () {
        var others = sample(seasons.filter(function (x) { return x.year !== s.year; }), 3)
          .map(function (x) { return String(x.year); });
        return mcq({
          key: "champs:" + s.year + ":which",
          prompt: "Which season finished like this?",
          sub: s.drivers.slice(0, 3).map(function (d, i) { return (i + 1) + ". " + surname(d.driver); }).join("   ") +
            "   ·   constructors: " + s.constructors[0].team,
          correct: String(s.year),
          wrong: others,
          explain: s.year + ": " + s.drivers.slice(0, 3).map(function (d) { return d.driver; }).join(", ") +
            ", with " + s.constructors[0].team + " taking the constructors' title."
        });
      } });
    });

    return out;
  }

  /* -------------------------------------------------------------- tracks */
  function bankTrack() {
    var out = [], list = DATA.circuits.circuits;
    var names = list.map(function (c) { return c.name; });

    list.forEach(function (c) {
      var others = function (n) {
        return sample(list.filter(function (x) { return x.id !== c.id; }), n);
      };

      out.push({ key: "track:" + c.id + ":map", make: function () {
        return mcq({
          key: "track:" + c.id + ":map",
          prompt: "Which circuit is this?",
          mapId: c.id,
          correct: c.name,
          wrong: others(3).map(function (x) { return x.name; }),
          explain: c.name + " — " + c.city + ", " + c.country + ". " + c.signature
        });
      } });

      out.push({ key: "track:" + c.id + ":pick", make: function () {
        var ws = others(3);
        return mcq({
          key: "track:" + c.id + ":pick",
          prompt: c.name,
          sub: "Pick the layout.",
          maps: true,
          correct: c.id,
          correctSub: null,
          wrong: ws.map(function (x) { return { id: x.id, label: x.id }; }),
          explain: c.short + " is " + c.lengthKm + " km, " + c.turns + " turns, " + c.direction + "."
        });
      } });

      out.push({ key: "track:" + c.id + ":country", make: function () {
        return mcq({
          key: "track:" + c.id + ":country",
          prompt: "Where is " + c.name + "?",
          mapId: c.id,
          correct: c.country,
          wrong: uniq(others(6).map(function (x) { return x.country; })
            .filter(function (x) { return x !== c.country; })).slice(0, 3),
          explain: c.name + " is at " + c.city + ", " + c.country + ", and hosts the " + c.gp + "."
        });
      } });

      out.push({ key: "track:" + c.id + ":len", make: function () {
        var right = c.lengthKm.toFixed(3) + " km";
        var pool = uniq(list.filter(function (x) { return Math.abs(x.lengthKm - c.lengthKm) > 0.03; })
          .map(function (x) { return x.lengthKm.toFixed(3) + " km"; }));
        return mcq({
          key: "track:" + c.id + ":len",
          prompt: "How long is a lap of " + c.short + "?",
          mapId: c.id,
          correct: right,
          wrong: sample(pool, 3),
          explain: c.name + " is " + c.lengthKm + " km over " + c.turns + " turns, raced over " + c.laps + " laps."
        });
      } });

      out.push({ key: "track:" + c.id + ":turns", make: function () {
        var pool = uniq(list.map(function (x) { return x.turns; })
          .filter(function (t) { return t !== c.turns; }));
        return mcq({
          key: "track:" + c.id + ":turns",
          prompt: "How many corners does " + c.short + " have?",
          mapId: c.id,
          correct: String(c.turns),
          wrong: sample(pool, 3).map(String),
          explain: c.short + " has " + c.turns + " corners over " + c.lengthKm + " km."
        });
      } });

      out.push({ key: "track:" + c.id + ":dir", make: function () {
        return mcq({
          key: "track:" + c.id + ":dir",
          prompt: "Which way round does " + c.short + " go?",
          mapId: c.id,
          correct: c.direction,
          wrong: [c.direction === "clockwise" ? "anti-clockwise" : "clockwise"],
          explain: c.short + " runs " + c.direction + "."
        });
      } });

      out.push({ key: "track:" + c.id + ":first", make: function () {
        var pool = uniq(list.map(function (x) { return x.firstGp; })
          .concat([c.firstGp - 4, c.firstGp + 3, c.firstGp - 9, c.firstGp + 7])
          .filter(function (y) { return y !== c.firstGp && y >= 1950 && y <= 2026; }));
        return mcq({
          key: "track:" + c.id + ":first",
          prompt: "When did " + c.short + " first hold a World Championship race?",
          mapId: c.id,
          correct: String(c.firstGp),
          wrong: sample(pool, 3).map(String),
          explain: c.short + " first appeared on the calendar in " + c.firstGp + "."
        });
      } });

      out.push({ key: "track:" + c.id + ":laps", make: function () {
        var pool = uniq(list.map(function (x) { return x.laps; })
          .filter(function (l) { return Math.abs(l - c.laps) > 2; }));
        return mcq({
          key: "track:" + c.id + ":laps",
          prompt: "How many laps is the race at " + c.short + "?",
          mapId: c.id,
          correct: String(c.laps),
          wrong: sample(pool, 3).map(String),
          explain: c.gp + " runs to " + c.laps + " laps of the " + c.lengthKm + " km lap."
        });
      } });

      if (c.round2026) out.push({ key: "track:" + c.id + ":round", make: function () {
        var pool = uniq(list.filter(function (x) { return x.round2026 && x.id !== c.id; })
          .map(function (x) { return String(x.round2026); }));
        return mcq({
          key: "track:" + c.id + ":round",
          prompt: "Which round of the 2026 season is " + c.short + "?",
          mapId: c.id,
          correct: String(c.round2026),
          wrong: sample(pool, 3),
          explain: c.gp + " is round " + c.round2026 + " of 24 in 2026."
        });
      } });
    });

    /* order a handful of 2026 rounds by calendar position */
    var cal = list.filter(function (c) { return c.round2026; })
      .sort(function (a, b) { return a.round2026 - b.round2026; });
    for (var g = 0; g < 6; g++) {
      (function (g) {
        out.push({ key: "track:calendar:" + g, make: function () {
          var picks = sample(cal, 4).sort(function (a, b) { return a.round2026 - b.round2026; });
          return order({
            key: "track:calendar:" + g,
            prompt: "2026 calendar order",
            sub: "Earliest in the season first.",
            items: picks.map(function (c) { return c.short; }),
            explain: picks.map(function (c) { return "R" + c.round2026 + " " + c.short; }).join("   ")
          });
        } });
      })(g);
    }

    /* which of these did not host a race in a given year */
    [2020, 2021, 2022, 2024, 2026].forEach(function (y) {
      out.push({ key: "track:used:" + y, make: function () {
        var inYear = list.filter(function (c) { return c.used.indexOf(y) >= 0; });
        var notIn = list.filter(function (c) { return c.used.indexOf(y) < 0; });
        if (!inYear.length || notIn.length < 1) return null;
        var right = pickOne(notIn);
        return mcq({
          key: "track:used:" + y,
          prompt: "Which of these did NOT host a Grand Prix in " + y + "?",
          correct: right.short,
          wrong: sample(inYear, 3).map(function (c) { return c.short; }),
          explain: right.short + (right.used.length
            ? " was raced in " + right.used.join(", ") + " — but not " + y + "."
            : " has not held a championship race since 2020.")
        });
      } });
    });

    return out;
  }

  /* --------------------------------------------------------------- grids */
  function pairLabel(t) { return surname(t.drivers[0]) + " / " + surname(t.drivers[1]); }

  function bankGrid() {
    var out = [], seasons = DATA.lineups.seasons;

    seasons.forEach(function (s) {
      var y = s.year;

      s.teams.forEach(function (t, ti) {
        out.push({ key: "grid:" + y + ":" + t.team, make: function () {
          var wrong = sample(s.teams.filter(function (x) { return x.team !== t.team; }), 3)
            .map(pairLabel);
          return mcq({
            key: "grid:" + y + ":" + t.team,
            prompt: "Who drove for " + t.team + " in " + y + "?",
            correct: pairLabel(t),
            wrong: uniq(wrong).slice(0, 3),
            explain: t.drivers[0] + " and " + t.drivers[1] + " were the " + y + " " + t.team + " pairing."
          });
        } });

        /* alternate the two follow-up shapes so each key stays stable */
        if (ti % 2 === 0) {
          out.push({ key: "grid:" + y + ":" + t.drivers[0] + ":mate", make: function () {
            var pool = [];
            s.teams.forEach(function (x) { pool = pool.concat(x.drivers); });
            return mcq({
              key: "grid:" + y + ":" + t.drivers[0] + ":mate",
              prompt: "Who was " + t.drivers[0] + "'s team-mate in " + y + "?",
              correct: t.drivers[1],
              wrong: sample(pool.filter(function (d) { return d !== t.drivers[0] && d !== t.drivers[1]; }), 3),
              explain: t.drivers[0] + " and " + t.drivers[1] + " shared the " + t.team + " garage in " + y + "."
            });
          } });
        } else {
          out.push({ key: "grid:" + y + ":" + t.drivers[1] + ":team", make: function () {
            return mcq({
              key: "grid:" + y + ":" + t.drivers[1] + ":team",
              prompt: "Which team did " + t.drivers[1] + " drive for in " + y + "?",
              correct: t.team,
              wrong: sample(s.teams.filter(function (x) { return x.team !== t.team; }), 3)
                .map(function (x) { return x.team; }),
              explain: t.drivers[1] + " drove for " + t.team + " in " + y + ", alongside " + t.drivers[0] + "."
            });
          } });
        }
      });

      /* which of these was not on the grid that year */
      out.push({ key: "grid:" + y + ":odd", make: function () {
        var here = [];
        s.teams.forEach(function (x) { here = here.concat(x.drivers); });
        var elsewhere = [];
        seasons.forEach(function (o) {
          if (Math.abs(o.year - y) < 3) return;
          o.teams.forEach(function (x) { elsewhere = elsewhere.concat(x.drivers); });
        });
        var outsiders = uniq(elsewhere).filter(function (d) { return here.indexOf(d) < 0; });
        if (!outsiders.length) return null;
        var right = pickOne(outsiders);
        return mcq({
          key: "grid:" + y + ":odd",
          prompt: "Which of these did NOT start a race in " + y + "?",
          correct: right,
          wrong: sample(uniq(here), 3),
          explain: right + " was not on the " + y + " grid."
        });
      } });

      /* team count */
      out.push({ key: "grid:" + y + ":teams", make: function () {
        var n = s.teams.length;
        var wrong = uniq([n + 1, n - 1, n + 2, n - 2].filter(function (x) { return x > 6 && x !== n; })).slice(0, 3);
        return mcq({
          key: "grid:" + y + ":teams",
          prompt: "How many teams contested the " + y + " season?",
          correct: String(n),
          wrong: wrong.map(String),
          explain: y + " had " + n + " teams: " + s.teams.map(function (t) { return t.team; }).join(", ") + "."
        });
      } });
    });

    /* which season was this grid? */
    seasons.forEach(function (s) {
      out.push({ key: "grid:" + s.year + ":which", make: function () {
        var clue = sample(s.teams, 3).map(function (t) { return t.team + ": " + pairLabel(t); });
        return mcq({
          key: "grid:" + s.year + ":which",
          prompt: "Which season is this grid from?",
          sub: clue.join("   ·   "),
          correct: String(s.year),
          wrong: sample(seasons.filter(function (x) { return x.year !== s.year; }), 3)
            .map(function (x) { return String(x.year); }),
          explain: "That is " + s.year + "." + (s.changes && s.changes[0] ? " " + s.changes[0] : "")
        });
      } });
    });

    return out;
  }

  /* ------------------------------------------------------ the 2026 season */
  /* Every answer below is read out of the official result. Nothing here is
     graded against anything you typed — you cannot enter a result at all. */
  function bankRace() {
    var out = [], done = racedRounds();
    if (!done.length) return out;

    var field = (DATA.season.drivers || []).map(function (d) { return d.name; });

    done.forEach(function (rd) {
      var r = roundResult(rd.round);
      var c = CIRC[rd.circuit] || { short: rd.gp };
      var tag = "R" + rd.round + " " + c.short;
      var K = "race:2026:" + rd.round + ":";

      var finish = r.race.map(function (x) { return driverName(x.driver); });
      var quali = (r.quali || []).map(function (x) { return driverName(x.driver); });
      /* Distractors come from the field plus whoever was actually in this
         race, so a plausible name is never a giveaway. */
      var pool = uniq(field.concat(finish));
      var others = function (right) {
        return sample(pool.filter(function (n) { return n !== right; }), 3);
      };

      out.push({ key: K + "win", make: function () {
        return mcq({
          key: K + "win", mapId: rd.circuit,
          prompt: "Who won the " + rd.gp + "?",
          sub: "Round " + rd.round + ", " + niceDate(rd.date),
          correct: finish[0], wrong: others(finish[0]),
          explain: finish[0] + " won " + tag + " from " + finish[1] + " and " + finish[2] + "."
        });
      } });

      out.push({ key: K + "podium", make: function () {
        return order({
          key: K + "podium", mapId: rd.circuit,
          prompt: rd.gp + " podium", sub: "Winner first.",
          items: finish.slice(0, 3),
          explain: finish.slice(0, 3).map(function (n, i) { return (i + 1) + ". " + n; }).join("   ")
        });
      } });

      if (finish.length >= 6) out.push({ key: K + "top6", make: function () {
        return order({
          key: K + "top6", mapId: rd.circuit,
          prompt: rd.gp + " — top six", sub: "Put the first six finishers in order.",
          items: finish.slice(0, 6),
          explain: finish.slice(0, 6).map(function (n, i) { return (i + 1) + ". " + surname(n); }).join("   ")
        });
      } });

      [4, 7, 10].forEach(function (n) {
        if (finish.length < n) return;
        out.push({ key: K + "p" + n, make: function () {
          var right = finish[n - 1];
          return mcq({
            key: K + "p" + n, mapId: rd.circuit,
            prompt: "Who finished " + ordinal(n) + " at " + tag + "?",
            correct: right, wrong: others(right),
            explain: right + " was " + ordinal(n) + " in the " + rd.gp + "."
          });
        } });
      });

      if (quali.length) {
        out.push({ key: K + "pole", make: function () {
          var right = quali[0];
          return mcq({
            key: K + "pole", mapId: rd.circuit,
            prompt: "Who took pole for the " + rd.gp + "?",
            correct: right, wrong: others(right),
            explain: right + " qualified on pole at " + tag +
              (finish[0] === right ? ", and converted it." : " — the race went to " + finish[0] + ".")
          });
        } });

        if (quali.length >= 4) out.push({ key: K + "front2", make: function () {
          return order({
            key: K + "front2", mapId: rd.circuit,
            prompt: rd.gp + " — the front two rows", sub: "Grid order, pole first.",
            items: quali.slice(0, 4),
            explain: quali.slice(0, 4).map(function (n, i) { return "P" + (i + 1) + " " + surname(n); }).join("   ")
          });
        } });
      }

      /* The official grid position is on the result row, so this is the real
         move through the field, not one inferred from qualifying order. */
      out.push({ key: K + "mover", make: function () {
        var best = null;
        r.race.forEach(function (x) {
          if (!x.grid || !x.pos) return;
          var gain = x.grid - x.pos;
          if (!best || gain > best.gain) best = { name: driverName(x.driver), gain: gain, from: x.grid, to: x.pos };
        });
        if (!best || best.gain <= 0) return null;
        return mcq({
          key: K + "mover", mapId: rd.circuit,
          prompt: "Who gained the most places at " + tag + "?",
          sub: "Grid position to finishing position.",
          correct: best.name, wrong: others(best.name),
          explain: best.name + " went from P" + best.from + " to P" + best.to +
            " — " + plural(best.gain, "place") + "."
        });
      } });

      if (r.sprint && r.sprint.length) out.push({ key: K + "sprint", make: function () {
        var right = driverName(r.sprint[0].driver);
        return mcq({
          key: K + "sprint", mapId: rd.circuit,
          prompt: "Who won the sprint at " + tag + "?",
          correct: right, wrong: others(right),
          explain: right + " won the " + c.short + " sprint" +
            (finish[0] === right ? " and the Grand Prix." : "; " + finish[0] + " won the Grand Prix.")
        });
      } });

      /* The championship as it stood that weekend, which is the thing you
         actually watched — not as it stands now. */
      if (r.standingsAfter && r.standingsAfter.length > 1) {
        out.push({ key: K + "leader", make: function () {
          var right = driverName(r.standingsAfter[0].driver);
          return mcq({
            key: K + "leader", mapId: rd.circuit,
            prompt: "Who led the championship after " + tag + "?",
            correct: right, wrong: others(right),
            explain: "After round " + rd.round + ": " + r.standingsAfter.slice(0, 3).map(function (s) {
              return surname(driverName(s.driver)) + " " + s.points;
            }).join(", ") + "."
          });
        } });
      }
    });

    /* where it stands now */
    var latest = done[done.length - 1];
    var table = standingsNow();
    if (table.length > 3) {
      out.push({ key: "race:2026:leader", make: function () {
        var right = driverName(table[0].driver);
        return mcq({
          key: "race:2026:leader",
          prompt: "Who leads the 2026 championship?",
          sub: "After round " + latest.round + ".",
          correct: right,
          wrong: sample(table.slice(1).map(function (s) { return driverName(s.driver); }), 3),
          explain: table.slice(0, 3).map(function (s, i) {
            return (i + 1) + ". " + driverName(s.driver) + " " + s.points;
          }).join("   ")
        });
      } });

      out.push({ key: "race:2026:top4", make: function () {
        return order({
          key: "race:2026:top4",
          prompt: "The championship, top four",
          sub: "After round " + latest.round + ".",
          items: table.slice(0, 4).map(function (s) { return driverName(s.driver); }),
          explain: table.slice(0, 4).map(function (s) {
            return s.pos + ". " + surname(driverName(s.driver)) + " " + s.points;
          }).join("   ")
        });
      } });
    }

    var ctors = constructorsNow();
    if (ctors.length > 3) out.push({ key: "race:2026:ctor", make: function () {
      var right = teamName(ctors[0].team);
      return mcq({
        key: "race:2026:ctor",
        prompt: "Which team leads the constructors' championship?",
        sub: "After round " + latest.round + ".",
        correct: right,
        wrong: sample(ctors.slice(1).map(function (s) { return teamName(s.team); }), 3),
        explain: ctors.slice(0, 3).map(function (s, i) {
          return (i + 1) + ". " + teamName(s.team) + " " + s.points;
        }).join("   ")
      });
    } });

    /* kept for the check's "wins" slot */
    out.push({ key: "race:2026:wins", make: function () {
      var tally = {};
      done.forEach(function (rd) {
        var w = driverName(roundResult(rd.round).race[0].driver);
        tally[w] = (tally[w] || 0) + 1;
      });
      var names = Object.keys(tally).sort(function (a, b) { return tally[b] - tally[a]; });
      if (!names.length) return null;
      var right = names[0];
      return mcq({
        key: "race:2026:wins",
        prompt: "Who has won the most races in 2026?",
        sub: "After round " + latest.round + ".",
        correct: right,
        wrong: sample(field.filter(function (n) { return n !== right; }), 3),
        explain: names.slice(0, 4).map(function (n) {
          return surname(n) + " " + plural(tally[n], "win");
        }).join(", ") + "."
      });
    } });

    return out;
  }

  /* ==================================================================
     Sessions

     Two shapes, and neither of them is a daily habit:

       check     the one that matters. Before the next race, a short test
                 on the race just gone — plus anything you missed at an
                 earlier check, plus a look at the circuit coming up.
       practice  open drilling of the circuits, championships and grids,
                 for when you feel like it. Weakest questions first.
     ================================================================== */

  var CHECK_RECALL = 6;    // questions about the race just gone
  var CHECK_CARRY = 3;     // misses brought forward from earlier checks
  var CHECK_AHEAD = 2;     // the circuit you are about to watch

  function tagged(list, tag) {
    return list.map(function (entry) { return { entry: entry, tag: tag }; });
  }

  /* The pre-race check for one round. */
  function checkQueue(rd) {
    var all = bank();
    var prefix = "race:" + SEASON + ":" + rd.round + ":";
    var recall = shuffle(all.filter(function (q) { return q.key.indexOf(prefix) === 0; }));

    var carried = all.filter(function (q) { return state.carry.indexOf(q.key) >= 0; });
    var ahead = [];
    var nxt = nextRace();
    if (nxt) {
      var tp = "track:" + nxt.circuit + ":";
      ahead = shuffle(all.filter(function (q) {
        return q.key.indexOf(tp) === 0 && q.key.indexOf(":pick") < 0;
      })).slice(0, CHECK_AHEAD);
    }
    var picture = all.filter(function (q) {
      return q.key === "race:" + SEASON + ":leader" || q.key === "race:" + SEASON + ":wins";
    });

    var q = tagged(recall.slice(0, CHECK_RECALL), "The race just gone")
      .concat(tagged(shuffle(carried).slice(0, CHECK_CARRY), "You missed this last time"))
      .concat(tagged(ahead, nxt ? "Coming up: " + (CIRC[nxt.circuit] || {}).short : "Coming up"))
      .concat(racedRounds().length >= 3 ? tagged(sample(picture, 1), "The championship") : []);
    return q;
  }

  function startCheck(rd) {
    var queue = checkQueue(rd);
    if (!queue.length) { toast("Enter the result first"); return; }
    session = {
      mode: "check", round: rd.round, rd: rd, queue: queue,
      i: 0, cur: null, tag: null, picked: null, revealed: false,
      ordered: [], ok: 0, n: 0, misses: [], hits: []
    };
    nextQuestion();
    view = "session";
    render();
  }

  function startPractice(section) {
    var pool = bank().filter(function (q) {
      return section ? q.key.split(":")[0] === section : q.key.split(":")[0] !== "race";
    });
    if (!pool.length) { toast("Nothing to practise there yet"); return; }
    var fresh = shuffle(pool.filter(function (q) { return !state.practice[q.key]; }));
    var seen = pool.filter(function (q) { return state.practice[q.key]; })
      .sort(function (a, b) { return accuracyOf(a.key) - accuracyOf(b.key); });
    var want = 10;
    var chosen = seen.slice(0, Math.ceil(want / 2)).concat(fresh.slice(0, want));
    session = {
      mode: "practice", section: section || null,
      queue: tagged(shuffle(uniq(chosen)).slice(0, want), null),
      i: 0, cur: null, tag: null, picked: null, revealed: false,
      ordered: [], ok: 0, n: 0, misses: [], hits: []
    };
    nextQuestion();
    view = "session";
    render();
  }

  function nextQuestion() {
    session.picked = null; session.revealed = false; session.ordered = [];
    while (session.i < session.queue.length) {
      var slot = session.queue[session.i];
      var built = null;
      try { built = slot.entry.make(); } catch (e) { built = null; }
      if (built && built.options && built.options.length >= 2) {
        session.cur = built; session.tag = slot.tag; return;
      }
      session.i++;    // a generator with nothing to say today
    }
    session.cur = null;
  }

  function record(ok) {
    session.n++;
    if (ok) { session.ok++; session.hits.push(session.cur.key); }
    else session.misses.push(session.cur.key);
    grade(session.cur.key, ok);
  }
  function answerMcq(id) {
    if (session.revealed) return;
    session.picked = id;
    session.revealed = true;
    record(id === session.cur.answer);
    render();
  }
  function checkOrder() {
    if (session.revealed) return;
    var a = session.cur.answer;
    if (session.ordered.length < a.length) return;
    session.revealed = true;
    record(a.every(function (x, i) { return session.ordered[i] === x; }));
    render();
  }
  function advance() {
    session.i++;
    nextQuestion();
    if (!session.cur) finishSession();
    render();
  }

  function finishSession() {
    if (session.mode === "check") {
      state.checks[String(session.round)] = {
        done: todayISO(), n: session.n, c: session.ok, onTime: onTimeFor(session.round)
      };
      /* What you got right leaves the carry list; what you missed joins it,
         and comes back before the next race rather than tomorrow. */
      state.carry = state.carry.filter(function (k) { return session.hits.indexOf(k) < 0; });
      session.misses.forEach(function (k) {
        if (state.carry.indexOf(k) < 0) state.carry.push(k);
      });
      save();
    }
    view = "done";
  }
  function quitSession() { session = null; view = "race"; render(); }

  /* ==================================================================
     Pieces
     ================================================================== */
  function mapNode(id, cls) {
    var c = CIRC[id];
    var box = el("div", { class: "mapbox" + (cls ? " " + cls : "") });
    if (!c) return box;
    box.innerHTML = '<svg class="map" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" ' +
      'role="img" aria-label="Circuit outline"><path d="' + c.path + '"/></svg>';
    return box;
  }
  function meter(v, cls) {
    return el("div", { class: "meter" }, [el("i", { class: cls || "", style: "width:" + Math.max(2, v) + "%" })]);
  }
  function toast(msg) {
    var t = $(".toast");
    if (t) t.remove();
    document.body.appendChild(el("div", { class: "toast", text: msg }));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { var x = $(".toast"); if (x) x.remove(); }, 2200);
  }
  function openSheet(node) { sheet = node; render(); }
  function closeSheet() { sheet = null; render(); }
  function applyTheme() {
    var t = state.theme;
    if (t === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", t);
  }

  /* ==================================================================
     Views
     ================================================================== */

  function countdown(rd) {
    if (!rd) return "Season over";
    var d = daysBetween(todayISO(), rd.date);
    if (d < 0) return "Under way";
    if (d === 0) return "Race day";
    if (d === 1) return "Tomorrow";
    if (d <= 3) return "This weekend";
    if (d <= 7) return "In " + d + " days";
    return niceDate(rd.date);
  }

  function viewRace() {
    var wrap = el("div", { class: "wrap" });
    var nxt = nextRace();
    var pending = pendingRound();
    var past = lastRun();

    wrap.appendChild(el("div", { class: "top" }, [
      el("div", {}, [
        el("p", { class: "kicker", text: "Apex" }),
        el("h1", { class: "title", text: nxt ? "Round " + nxt.round : "Season over" })
      ]),
      el("button", { class: "btn sm ghost", "aria-label": "Settings", html: icon(ICON.gear), onclick: settingsSheet })
    ]));

    /* what you are getting ready for */
    if (nxt) {
      var c = CIRC[nxt.circuit] || {};
      wrap.appendChild(el("div", { class: "nextrace" }, [
        el("div", { class: "nextrace-map" }, [mapNode(nxt.circuit)]),
        el("div", { class: "grow" }, [
          el("p", { class: "tag", text: countdown(nxt) }),
          el("h2", { text: c.short || nxt.gp }),
          el("p", { class: "muted small", text: nxt.gp + (nxt.sprint ? " · sprint weekend" : "") })
        ])
      ]));
    }

    /* the check */
    if (pending) {
      var pc = CIRC[pending.circuit] || {};
      wrap.appendChild(el("div", { class: "hero" }, [
        el("p", { class: "kicker", text: "Before you watch" }),
        el("h2", { text: "Do you still have " + (pc.short || pending.gp) + "?" }),
        el("p", { text: "A short test on round " + pending.round + " — the order, the pole, who went backwards — " +
          "and a look at what is coming up." }),
        el("button", { class: "btn primary wide", text: "Start the check",
          onclick: function () { startCheck(pending); } })
      ]));
    } else if (past && !roundResult(past.round)) {
      /* The race has happened but the official result has not reached this
         copy of the app yet — results refresh with a new build, they are
         never typed in. */
      wrap.appendChild(el("div", { class: "hero" }, [
        el("p", { class: "kicker", text: "Round " + past.round + " has been run" }),
        el("h2", { text: "Waiting on the official result" }),
        el("p", { text: (CIRC[past.circuit] || {}).short + " is not in the results file yet. " +
          "It lands with the next update, and the check opens by itself — there is nothing to enter." }),
        el("button", { class: "btn wide", text: "See the season",
          onclick: function () { view = "season"; render(); } })
      ]));
    } else {
      var lastDone = lastRaced();
      var chk = lastDone ? checkFor(lastDone.round) : null;
      wrap.appendChild(el("div", { class: "hero" }, [
        el("p", { class: "kicker", text: chk ? "Round " + lastDone.round + " checked" : "Nothing to check yet" }),
        el("h2", { text: chk ? chk.c + " of " + chk.n + " right" : "Waiting on a race" }),
        el("p", { text: chk
          ? "You are square with the season. The next check opens by itself once " +
            (nxt ? (CIRC[nxt.circuit] || {}).short : "the next round") + " has been run."
          : "The first check opens as soon as a round has been run." }),
        chk ? el("button", { class: "btn wide", text: "Take it again",
          onclick: function () { startCheck(lastDone); } })
          : el("button", { class: "btn wide", text: "See the season",
            onclick: function () { view = "season"; render(); } })
      ]));
    }

    /* the season so far, one cell a round */
    wrap.appendChild(el("p", { class: "kicker", style: "margin:20px 0 8px", text: "The season" }));
    var strip = el("div", { class: "strip" });
    rounds().forEach(function (rd) {
      var chk = checkFor(rd.round);
      var cls = "cell";
      if (chk) cls += pct(chk.c, chk.n) >= 70 ? " good" : " part";
      else if (roundResult(rd.round)) cls += " open";
      else if (nxt && rd.round === nxt.round) cls += " next";
      strip.appendChild(el("button", {
        class: cls, title: (CIRC[rd.circuit] || {}).short,
        onclick: function () { view = "season"; render(); roundSheet(rd); }
      }, [el("span", { text: String(rd.round) })]));
    });
    wrap.appendChild(strip);

    var checked = checkedRounds().length;
    wrap.appendChild(el("div", { class: "tiles", style: "margin-top:12px" }, [
      el("div", { class: "tile" }, [el("b", { text: String(raceStreak()) }), el("span", { text: "races in a row" })]),
      el("div", { class: "tile" }, [el("b", { text: String(checked) }), el("span", { text: "checked" })]),
      el("div", { class: "tile" }, [el("b", { text: String(state.carry.length) }), el("span", { text: "still owing" })])
    ]));

    /* practice, deliberately quiet and down the page */
    wrap.appendChild(el("p", { class: "kicker", style: "margin:22px 0 8px", text: "Practice, if you feel like it" }));
    var grid = el("div", { class: "secgrid" });
    PRACTICE.forEach(function (s) {
      var stat = sectionStats(s.id);
      grid.appendChild(el("button", {
        class: "sec", onclick: function () { startPractice(s.id); }
      }, [
        el("b", { text: s.name }),
        el("span", { text: s.blurb }),
        el("div", { class: "meter", style: "margin-top:10px" }, [
          el("i", { class: stat.pct >= 80 ? "good" : "", style: "width:" + Math.max(2, stat.pct) + "%" })
        ])
      ]));
    });
    wrap.appendChild(grid);
    return wrap;
  }

  /* ------------------------------------------------------------ session */
  function viewSession() {
    var q = session.cur;
    var wrap = el("div", { class: "wrap session" });
    var total = session.queue.length;

    wrap.appendChild(el("div", { class: "qhead" }, [
      el("button", { class: "btn sm ghost", html: icon(ICON.close), "aria-label": "End session", onclick: quitSession }),
      el("div", { class: "progress" }, [el("i", { style: "width:" + Math.round(100 * session.i / total) + "%" })]),
      el("span", { class: "tag", text: (session.i + 1) + " / " + total })
    ]));

    if (session.tag) wrap.appendChild(el("p", { class: "qtag", text: session.tag }));

    if (q.mapId && !q.maps) wrap.appendChild(mapNode(q.mapId, "lg"));

    wrap.appendChild(el("h2", { class: "prompt", text: q.prompt, style: q.mapId ? "margin-top:14px" : "" }));
    if (q.sub) wrap.appendChild(el("p", { class: "prompt-sub", text: q.sub }));

    if (q.kind === "mcq") wrap.appendChild(mcqBody(q));
    else wrap.appendChild(orderBody(q));

    if (session.revealed) {
      var right = q.kind === "mcq"
        ? session.picked === q.answer
        : q.answer.every(function (x, i) { return session.ordered[i] === x; });
      wrap.appendChild(el("div", { class: "card", style: "margin-top:14px" }, [
        el("div", { class: "verdict " + (right ? "ok" : "no") }, [
          el("span", { html: icon(right ? ICON.tick : ICON.cross), class: "row" }),
          el("span", { text: right ? "Right" : "Not quite" })
        ]),
        el("p", { class: "explain", text: q.explain || "" })
      ]));
    }

    var foot = el("div", { class: "qfoot" }, [el("div", { class: "qfoot-inner" }, [
      session.revealed
        ? el("button", { class: "btn primary wide", text: session.i + 1 >= total ? "Finish" : "Next", onclick: advance })
        : (q.kind === "order"
          ? el("button", { class: "btn primary wide", text: "Check",
              disabled: session.ordered.length < q.answer.length, onclick: checkOrder })
          : el("div", { class: "small muted center grow", text: "Pick an answer" }))
    ])]);
    wrap.appendChild(foot);
    return wrap;
  }

  function mcqBody(q) {
    var box = el("div", { class: q.maps ? "opt-maps" : "opts" });
    q.options.forEach(function (o, i) {
      var cls = "opt";
      if (session.revealed) {
        if (o.id === q.answer) cls += " right";
        else if (o.id === session.picked) cls += " wrong";
        else cls += " dim";
      }
      var label = q.maps ? (CIRC[o.id] ? CIRC[o.id].name : o.label) : o.label;
      var kids = [el("span", { class: "key", text: "ABCD"[i] || String(i + 1) })];
      if (q.maps) {
        kids = [mapNode(o.id), el("span", { class: "small", text: session.revealed ? label : "" }),
          el("span", { class: "key", text: "ABCD"[i] })];
      } else {
        kids.push(el("span", { class: "grow", text: label }));
      }
      box.appendChild(el("button", { class: cls, onclick: function () { answerMcq(o.id); } }, kids));
    });
    return box;
  }

  function orderBody(q) {
    var box = el("div", {});
    var slots = el("div", { class: "order-slots" });
    q.answer.forEach(function (ans, i) {
      var have = session.ordered[i];
      var cls = "slot" + (have ? " filled" : "");
      var extra = null;
      if (session.revealed) {
        if (have === ans) cls += " right";
        else { cls += " wrong"; extra = el("span", { class: "corr", text: ans }); }
      }
      slots.appendChild(el("div", {
        class: cls,
        onclick: function () {
          if (session.revealed || !have) return;
          session.ordered.splice(i, 1);
          render();
        }
      }, [
        el("span", { class: "pos", text: String(i + 1) }),
        el("span", { class: "grow", text: have || "" }),
        extra
      ]));
    });
    box.appendChild(slots);

    if (!session.revealed) {
      var pool = el("div", { class: "pool" });
      q.options.forEach(function (o) {
        var used = session.ordered.indexOf(o.id) >= 0;
        pool.appendChild(el("button", {
          class: "btn sm" + (used ? " used" : ""),
          text: o.label,
          onclick: function () {
            if (session.ordered.length >= q.answer.length) return;
            session.ordered.push(o.id);
            render();
            if (session.ordered.length === q.answer.length) { /* wait for Check */ }
          }
        }));
      });
      box.appendChild(pool);
    }
    return box;
  }

  function viewDone() {
    var wrap = el("div", { class: "wrap" });
    var p = pct(session.ok, session.n);
    var isCheck = session.mode === "check";
    var rd = isCheck ? session.rd : null;
    var c = rd ? (CIRC[rd.circuit] || {}) : null;
    var nxt = nextRace();

    wrap.appendChild(el("div", { class: "top" }, [el("div", {}, [
      el("p", { class: "kicker", text: isCheck ? "Round " + rd.round + " checked" : "Practice" }),
      el("h1", { class: "title", text: p >= 80 ? "You still have it" : p >= 50 ? "Patchy" : "That has gone" })
    ])]));

    wrap.appendChild(el("div", { class: "hero" }, [
      el("h2", { text: session.ok + " of " + session.n + " right" }),
      el("p", { text: isCheck
        ? (session.misses.length
          ? "What you missed comes back before " + (nxt ? (CIRC[nxt.circuit] || {}).short : "the next race") + "."
          : "Nothing carried forward. Enjoy the race.")
        : "Practice does not carry anything forward — it is just reps." }),
      meter(p, p >= 80 ? "good" : "")
    ]));

    if (session.misses.length) {
      wrap.appendChild(el("p", { class: "kicker", style: "margin:18px 0 6px",
        text: isCheck ? "Coming back before the next race" : "Worth another look" }));
      var card = el("div", { class: "card" });
      var list = el("div", { class: "list" });
      session.misses.forEach(function (k) {
        list.appendChild(el("div", { class: "li" }, [el("b", { text: keyLabel(k) })]));
      });
      card.appendChild(list);
      wrap.appendChild(card);
    }

    var actions = [];
    if (isCheck && nxt) actions.push(el("div", { class: "card tight row", style: "gap:12px" }, [
      el("div", { style: "width:52px;flex:none" }, [mapNode(nxt.circuit)]),
      el("div", { class: "grow" }, [
        el("p", { class: "tag", text: countdown(nxt) }),
        el("b", { text: (CIRC[nxt.circuit] || {}).short })
      ])
    ]));
    actions.push(el("button", { class: "btn primary wide", text: "Done", onclick: quitSession }));
    if (!isCheck) actions.push(el("button", { class: "btn wide ghost", text: "Another ten",
      onclick: function () { startPractice(session.section); } }));
    wrap.appendChild(el("div", { class: "stack", style: "margin-top:14px" }, actions));
    return wrap;
  }

  function keyLabel(k) {
    var p = k.split(":");
    if (p[0] === "track") {
      var c = CIRC[p[1]];
      var what = { map: "identify the map", pick: "pick the map", country: "country", len: "lap length",
        turns: "corner count", dir: "direction", first: "first Grand Prix", laps: "race distance",
        round: "2026 round" }[p[2]] || p[2];
      if (p[1] === "calendar") return "2026 calendar order";
      if (p[1] === "used") return "Which circuits raced in " + p[2];
      return (c ? c.short : p[1]) + " — " + what;
    }
    if (p[0] === "champs") {
      if (p[1] === "titles") return p[2] + " — title count";
      var w = { champ: "champion", cchamp: "constructors' champion", p2: "runner-up", team: "champion's team",
        order: "top five", corder: "constructors' order", margin: "title margin", which: "identify the season",
        p3: "third place", p5: "fifth place" }[p[2]] || p[2];
      return p[1] + " — " + w;
    }
    if (p[0] === "grid") {
      if (p[2] === "odd") return p[1] + " — who was not on the grid";
      if (p[2] === "teams") return p[1] + " — number of teams";
      if (p[2] === "which") return "Identify the grid";
      if (p[3] === "mate") return p[2] + "'s team-mate in " + p[1];
      if (p[3] === "team") return p[2] + "'s team in " + p[1];
      return p[1] + " " + p[2];
    }
    if (p[0] === "race") {
      var rd = DATA.season.rounds.filter(function (r) { return String(r.round) === p[2]; })[0];
      var w2 = { win: "winner", podium: "podium order", top6: "top six", pole: "pole", front2: "front two rows",
        mover: "biggest mover", sprintwin: "sprint winner", where: "which round" }[p[3]] || p[3];
      if (p[2] === "leader") return "2026 championship leader";
      if (p[2] === "wins") return "2026 most wins";
      if (p[2] === "winners") return "2026 winners in order";
      return (rd ? rd.gp : "Round " + p[2]) + " — " + w2;
    }
    return k;
  }

  /* ----------------------------------------------------------- circuits */
  var trackFilter = "2026";
  function viewTrack() {
    var wrap = el("div", { class: "wrap" });
    wrap.appendChild(el("div", { class: "top" }, [
      el("div", {}, [
        el("p", { class: "kicker", text: "Circuits" }),
        el("h1", { class: "title", text: "The maps" })
      ]),
      el("button", { class: "btn sm", text: "Practise", onclick: function () { startPractice("track"); } })
    ]));

    var filters = [
      { id: "2026", label: "2026" },
      { id: "all", label: "All 2020+" },
      { id: "gone", label: "Off the calendar" }
    ];
    var seg = el("div", { class: "seg", style: "margin-bottom:14px" });
    filters.forEach(function (f) {
      seg.appendChild(el("button", {
        class: trackFilter === f.id ? "on" : "", text: f.label,
        onclick: function () { trackFilter = f.id; render(); }
      }));
    });
    wrap.appendChild(seg);

    var list = DATA.circuits.circuits.slice();
    if (trackFilter === "2026") list = list.filter(function (c) { return c.round2026; })
      .sort(function (a, b) { return a.round2026 - b.round2026; });
    else if (trackFilter === "gone") list = list.filter(function (c) { return !c.round2026; });

    var grid = el("div", { class: "trackgrid" });
    list.forEach(function (c) {
      var it = state.practice["track:" + c.id + ":map"];
      grid.appendChild(el("button", {
        class: "trackcard" + (it && it.n >= 2 && it.c / it.n >= 0.8 ? " seen" : ""),
        onclick: function () { trackSheet(c); }
      }, [
        mapNode(c.id),
        el("b", { text: c.short }),
        el("span", { text: c.round2026 ? "R" + c.round2026 : c.used.length ? String(c.used[c.used.length - 1]) : "—" })
      ]));
    });
    wrap.appendChild(grid);
    wrap.appendChild(el("p", { class: "small muted center", style: "margin-top:14px",
      text: list.length + " circuits. A green edge means the map is sticking." }));
    return wrap;
  }

  function trackSheet(c) {
    var body = el("div", {}, [
      el("div", { class: "sheet-grip" }),
      mapNode(c.id, "lg"),
      el("h2", { class: "title", style: "font-size:22px;margin:14px 0 2px", text: c.name }),
      el("p", { class: "sub", text: c.city + ", " + c.country + " · " + c.gp }),
      el("div", { class: "facts", style: "margin:14px 0" }, [
        fact("Length", c.lengthKm + " km"),
        fact("Corners", String(c.turns)),
        fact("Direction", c.direction === "clockwise" ? "Clockwise" : "Anti-clockwise"),
        fact("Race", c.laps + " laps"),
        fact("First GP", String(c.firstGp)),
        fact("2026", c.round2026 ? "Round " + c.round2026 : "Not on it")
      ]),
      el("p", { class: "explain", text: c.signature }),
      el("p", { class: "small muted", style: "margin-top:12px",
        text: c.used.length ? "Raced since 2020: " + c.used.join(", ") : "No championship race since 2020." }),
      el("button", { class: "btn wide", style: "margin-top:14px", text: "Close", onclick: closeSheet })
    ]);
    openSheet(body);
  }
  function fact(label, value) {
    return el("div", { class: "fact" }, [el("span", { text: label }), el("b", { text: value })]);
  }

  /* ------------------------------------------------------------- season */
  /* Read-only. The results are official and arrive with the app; there is
     nothing here to type in, and nothing you could type that would change
     what a check marks as correct. */
  function viewSeason() {
    var wrap = el("div", { class: "wrap" });
    var done = racedRounds();
    var nxt = nextRace();

    wrap.appendChild(el("div", { class: "top" }, [
      el("div", {}, [
        el("p", { class: "kicker", text: "Season " + DATA.season.year }),
        el("h1", { class: "title", text: done.length + " of " + DATA.season.rounds.length + " run" })
      ]),
      el("button", { class: "btn sm ghost", html: icon(ICON.gear), "aria-label": "Settings", onclick: settingsSheet })
    ]));

    var seg = el("div", { class: "seg" });
    [["races", "Races"], ["drivers", "Drivers"], ["teams", "Teams"]].forEach(function (p) {
      seg.appendChild(el("button", {
        class: seasonTab === p[0] ? "on" : "", text: p[1],
        onclick: function () { seasonTab = p[0]; render(); }
      }));
    });
    wrap.appendChild(seg);

    if (seasonTab === "races") {
      var list = el("div", { class: "rounds" });
      DATA.season.rounds.forEach(function (rd) {
        var r = roundResult(rd.round);
        var c = CIRC[rd.circuit] || {};
        var chk = checkFor(rd.round);
        list.appendChild(el("button", {
          class: "round" + (r ? " has" : "") + (nxt && nxt.round === rd.round ? " next" : ""),
          onclick: function () { roundSheet(rd); }
        }, [
          el("span", { class: "num", text: String(rd.round) }),
          el("div", { style: "width:32px;flex:none" }, [mapNode(rd.circuit)]),
          el("div", { class: "grow" }, [
            el("b", { text: c.short || rd.gp }),
            el("div", { class: "small muted", text: r
              ? driverName(r.race[0].driver) + " won"
              : (nxt && nxt.round === rd.round ? countdown(rd) : niceDate(rd.date)) })
          ]),
          chk ? el("span", { class: "chip " + (pct(chk.c, chk.n) >= 70 ? "good" : ""),
            text: chk.c + "/" + chk.n }) : (r ? el("span", { class: "chip warn", text: "not checked" }) : null)
        ]));
      });
      wrap.appendChild(list);
    } else if (seasonTab === "drivers") {
      wrap.appendChild(standingsCard("Drivers' championship", standingsNow().map(function (s) {
        var d = driverById(s.driver);
        return { pos: s.pos, name: d.name, sub: teamName(d.team), points: s.points };
      })));
    } else {
      wrap.appendChild(standingsCard("Constructors' championship", constructorsNow().map(function (s) {
        return { pos: s.pos, name: teamName(s.team), sub: "", points: s.points };
      })));
    }

    wrap.appendChild(el("p", { class: "small muted", style: "margin-top:14px",
      text: "Official results from F1DB, current to round " +
        (done.length ? done[done.length - 1].round : 0) + "." }));
    return wrap;
  }

  function standingsCard(title, rows) {
    var card = el("div", { class: "card" }, [
      el("p", { class: "kicker", style: "margin-bottom:4px", text: title })
    ]);
    if (!rows.length) {
      card.appendChild(el("p", { class: "small muted", text: "Nothing yet — no rounds have been run." }));
      return card;
    }
    var list = el("div", { class: "list" });
    rows.forEach(function (r) {
      list.appendChild(el("div", { class: "li" }, [
        el("span", { class: "num", text: String(r.pos) }),
        el("div", { class: "grow" }, [
          el("b", { text: r.name }),
          r.sub ? el("div", { class: "small muted", text: r.sub }) : null
        ]),
        el("span", { class: "pts", text: String(r.points) })
      ]));
    });
    card.appendChild(list);
    return card;
  }

  /* One round, in full. This is the revision material for its check. */
  function roundSheet(rd) {
    var c = CIRC[rd.circuit] || {};
    var r = roundResult(rd.round);
    var body = el("div", {}, [
      el("div", { class: "sheet-grip" }),
      el("div", { class: "row", style: "gap:14px;align-items:center" }, [
        el("div", { style: "width:74px;flex:none" }, [mapNode(rd.circuit)]),
        el("div", { class: "grow" }, [
          el("p", { class: "kicker", text: "Round " + rd.round }),
          el("h2", { style: "margin:2px 0 2px;font-size:19px", text: c.short || rd.gp }),
          el("p", { class: "small muted", text: rd.gp + " · " + niceDate(rd.date) +
            (rd.sprint ? " · sprint" : "") })
        ])
      ])
    ]);

    if (!r) {
      body.appendChild(el("p", { class: "explain", style: "margin-top:16px",
        text: nextRace() && nextRace().round === rd.round
          ? "Not run yet — " + countdown(rd).toLowerCase() + ". The check for it opens once the result is published."
          : "Not run yet." }));
      body.appendChild(el("button", { class: "btn wide", style: "margin-top:14px",
        text: "Close", onclick: closeSheet }));
      openSheet(body);
      return;
    }

    var chk = checkFor(rd.round);
    if (chk) body.appendChild(el("p", { class: "explain", style: "margin-top:14px",
      text: "You scored " + chk.c + " of " + chk.n + " on this one." }));

    function table(label, rows, render) {
      if (!rows || !rows.length) return;
      body.appendChild(el("p", { class: "kicker", style: "margin:16px 0 4px", text: label }));
      var list = el("div", { class: "list" });
      rows.forEach(function (x, i) { list.appendChild(render(x, i)); });
      body.appendChild(list);
    }

    table("Race", r.race.slice(0, 10), function (x) {
      var moved = x.grid ? x.grid - x.pos : 0;
      return el("div", { class: "li" }, [
        el("span", { class: "num", text: String(x.pos) }),
        el("div", { class: "grow" }, [
          el("b", { text: driverName(x.driver) }),
          el("div", { class: "small muted", text: teamName(x.team) })
        ]),
        x.grid ? el("span", { class: "chip " + (moved > 0 ? "good" : moved < 0 ? "bad" : ""),
          text: moved > 0 ? "+" + moved : moved < 0 ? String(moved) : "—" }) : null,
        el("span", { class: "pts", text: x.points ? String(x.points) : "" })
      ]);
    });

    table("Qualifying", (r.quali || []).slice(0, 10), function (x) {
      return el("div", { class: "li" }, [
        el("span", { class: "num", text: String(x.pos) }),
        el("div", { class: "grow" }, [el("b", { text: driverName(x.driver) })])
      ]);
    });

    table("Sprint", (r.sprint || []).slice(0, 8), function (x) {
      return el("div", { class: "li" }, [
        el("span", { class: "num", text: String(x.pos) }),
        el("div", { class: "grow" }, [el("b", { text: driverName(x.driver) })])
      ]);
    });

    table("Did not finish", r.retired || [], function (x) {
      return el("div", { class: "li" }, [
        el("div", { class: "grow" }, [
          el("b", { text: driverName(x.driver) }),
          el("div", { class: "small muted", text: x.reason })
        ])
      ]);
    });

    table("Championship after this round", (r.standingsAfter || []).slice(0, 5), function (x) {
      return el("div", { class: "li" }, [
        el("span", { class: "num", text: String(x.pos) }),
        el("div", { class: "grow" }, [el("b", { text: driverName(x.driver) })]),
        el("span", { class: "pts", text: String(x.points) })
      ]);
    });

    if (!chk) body.appendChild(el("button", {
      class: "btn primary wide", style: "margin-top:18px", text: "Check this round",
      onclick: function () { closeSheet(); startCheck(rd); }
    }));
    body.appendChild(el("button", { class: "btn wide ghost", style: "margin-top:10px",
      text: "Close", onclick: closeSheet }));

    openSheet(body);
  }

  /* ------------------------------------------------------------- record */
  function viewRecord() {
    var wrap = el("div", { class: "wrap" });
    var checked = checkedRounds();
    var t = totals();

    var scored = checked.map(function (n) { return checkFor(n); });
    var totalN = scored.reduce(function (a, c) { return a + c.n; }, 0);
    var totalC = scored.reduce(function (a, c) { return a + c.c; }, 0);

    wrap.appendChild(el("div", { class: "top" }, [
      el("div", {}, [
        el("p", { class: "kicker", text: "Record" }),
        el("h1", { class: "title", text: checked.length ? pct(totalC, totalN) + "% recalled" : "No checks yet" })
      ]),
      el("button", { class: "btn sm ghost", html: icon(ICON.gear), "aria-label": "Settings", onclick: settingsSheet })
    ]));

    if (!checked.length) {
      wrap.appendChild(el("div", { class: "empty" }, [
        el("b", { text: "Nothing recorded" }),
        el("span", { text: "Enter a race result, sit the check before the next race, and this fills up: " +
          "what you recalled race by race, and what keeps slipping." })
      ]));
      return wrap;
    }

    wrap.appendChild(el("div", { class: "tiles" }, [
      el("div", { class: "tile" }, [el("b", { text: String(checked.length) }), el("span", { text: "races checked" })]),
      el("div", { class: "tile" }, [el("b", { text: String(raceStreak()) }), el("span", { text: "in a row" })]),
      el("div", { class: "tile" }, [el("b", { text: String(state.carry.length) }), el("span", { text: "still owing" })])
    ]));

    /* race by race */
    var card = el("div", { class: "card" }, [
      el("p", { class: "kicker", style: "margin-bottom:4px", text: "Race by race" })
    ]);
    var list = el("div", { class: "list" });
    checked.slice().reverse().forEach(function (n) {
      var rd = roundNo(n), chk = checkFor(n), c = CIRC[rd.circuit] || {};
      var p = pct(chk.c, chk.n);
      list.appendChild(el("div", { class: "li" }, [
        el("span", { class: "num", text: String(n) }),
        el("div", { style: "width:34px;flex:none" }, [mapNode(rd.circuit)]),
        el("div", { class: "grow" }, [
          el("b", { text: c.short || rd.gp }),
          el("div", { class: "small muted", text: chk.onTime ? "before the next race" : "after the next race started" })
        ]),
        el("span", { class: "chip " + (p >= 70 ? "good" : p >= 40 ? "" : "bad"), text: chk.c + "/" + chk.n })
      ]));
    });
    card.appendChild(list);
    wrap.appendChild(card);

    /* what is still owed */
    if (state.carry.length) {
      var cc = el("div", { class: "card" }, [
        el("p", { class: "kicker", style: "margin-bottom:4px", text: "Comes back at the next check" })
      ]);
      var cl = el("div", { class: "list" });
      state.carry.slice(0, 10).forEach(function (k) {
        cl.appendChild(el("div", { class: "li" }, [el("b", { text: keyLabel(k) })]));
      });
      cc.appendChild(cl);
      if (state.carry.length > 10) cc.appendChild(el("p", { class: "small muted",
        text: "and " + (state.carry.length - 10) + " more" }));
      wrap.appendChild(cc);
    }

    /* practice, kept separate from the record that matters */
    if (t.n) {
      var pc = el("div", { class: "card" }, [
        el("p", { class: "kicker", style: "margin-bottom:4px", text: "Practice" })
      ]);
      PRACTICE.forEach(function (s) {
        var st = sectionStats(s.id);
        pc.appendChild(el("div", { class: "barrow" }, [
          el("span", { class: "lab", text: s.name }),
          el("div", { class: "meter grow" }, [
            el("i", { class: st.pct >= 80 ? "good" : "", style: "width:" + Math.max(2, st.pct) + "%" })
          ]),
          el("span", { class: "val", text: st.n ? st.c + "/" + st.n : "—" })
        ]));
      });
      wrap.appendChild(pc);
    }

    return wrap;
  }

  /* ----------------------------------------------------------- settings */
  function settingsSheet() {
    var body = el("div", {}, [el("div", { class: "sheet-grip" })]);
    body.appendChild(el("h2", { class: "title", style: "font-size:21px;margin:0 0 14px", text: "Settings" }));

    body.appendChild(el("p", { class: "kicker", text: "Theme" }));
    var themes = [["system", "System"], ["dark", "Dark"], ["light", "Light"]];
    var seg = el("div", { class: "seg", style: "margin:6px 0 18px" });
    themes.forEach(function (t) {
      seg.appendChild(el("button", {
        class: state.theme === t[0] ? "on" : "", text: t[1],
        onclick: function () { state.theme = t[0]; save(); applyTheme(); settingsSheet(); }
      }));
    });
    body.appendChild(seg);

    body.appendChild(el("div", { class: "stack", style: "margin-top:20px" }, [
      el("button", { class: "btn wide", text: "Export your record", onclick: exportSheet }),
      el("button", { class: "btn wide", text: "Import from JSON", onclick: importSheet }),
      el("button", { class: "btn wide ghost", text: "Reset progress", onclick: confirmReset })
    ]));

    body.appendChild(el("p", { class: "small muted", style: "margin-top:18px", text:
      "Apex runs on the race calendar. There is no daily streak and nothing expires overnight. " +
      "Results are official — they come from F1DB with the app, so a check can never be graded " +
      "against a mistake of your own. Your scores are stored on this device only." }));

    body.appendChild(el("button", { class: "btn wide", style: "margin-top:14px", text: "Close", onclick: closeSheet }));
    openSheet(body);
  }

  function exportSheet() {
    var payload = JSON.stringify(state, null, 2);
    var ta = el("textarea", { style: "width:100%;height:220px;border-radius:10px;padding:10px;background:var(--surface2);border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:12px" });
    ta.value = payload;
    var body = el("div", {}, [
      el("div", { class: "sheet-grip" }),
      el("h2", { class: "title", style: "font-size:20px;margin:0 0 4px", text: "Your record" }),
      el("p", { class: "sub", style: "margin-bottom:12px",
        text: "Check scores and what you still owe. Results are not in here — they are official " +
          "and ship with the app." }),
      ta,
      el("div", { class: "stack", style: "margin-top:12px" }, [
        el("button", { class: "btn primary wide", text: "Copy", onclick: function () {
          ta.select();
          if (navigator.clipboard) navigator.clipboard.writeText(payload).then(function () { toast("Copied"); },
            function () { toast("Select and copy manually"); });
          else { document.execCommand("copy"); toast("Copied"); }
        } }),
        el("button", { class: "btn wide ghost", text: "Back", onclick: settingsSheet })
      ])
    ]);
    openSheet(body);
  }

  function importSheet() {
    var ta = el("textarea", { placeholder: "Paste exported JSON here",
      style: "width:100%;height:200px;border-radius:10px;padding:10px;background:var(--surface2);border:1px solid var(--line);color:var(--ink);font-family:var(--mono);font-size:12px" });
    var body = el("div", {}, [
      el("div", { class: "sheet-grip" }),
      el("h2", { class: "title", style: "font-size:20px;margin:0 0 4px", text: "Import" }),
      el("p", { class: "sub", style: "margin-bottom:12px",
        text: "Replaces your check record on this device." }),
      ta,
      el("div", { class: "stack", style: "margin-top:12px" }, [
        el("button", { class: "btn primary wide", text: "Import", onclick: function () {
          var parsed;
          try { parsed = JSON.parse(ta.value); } catch (e) { toast("That is not valid JSON"); return; }
          if (parsed && parsed.v === 3 && parsed.checks) {
            state = parsed;
            save(); rebuildBank(); applyTheme(); closeSheet(); render();
            toast("Imported");
          } else toast("That is not an Apex record");
        } }),
        el("button", { class: "btn wide ghost", text: "Back", onclick: settingsSheet })
      ])
    ]);
    openSheet(body);
  }

  function confirmReset() {
    var body = el("div", {}, [
      el("div", { class: "sheet-grip" }),
      el("h2", { class: "title", style: "font-size:20px;margin:0 0 6px", text: "Reset progress?" }),
      el("p", { class: "explain", style: "margin-bottom:16px",
        text: "This clears every check score and everything you owe. The official results are " +
          "untouched, so every check simply opens again." }),
      el("div", { class: "stack" }, [
        el("button", { class: "btn wide", style: "color:var(--bad)", text: "Reset", onclick: function () {
          state = freshState();
          save(); rebuildBank(); closeSheet(); view = "race"; render();
          toast("Reset");
        } }),
        el("button", { class: "btn wide ghost", text: "Keep it", onclick: settingsSheet })
      ])
    ]);
    openSheet(body);
  }

  /* ---------------------------------------------------------------- nav */
  function nav() {
    var items = [
      { id: "race", label: "Race", ic: ICON.flag },
      { id: "track", label: "Circuits", ic: ICON.track },
      { id: "season", label: "Season", ic: ICON.season },
      { id: "record", label: "Record", ic: ICON.record }
    ];
    var bar = el("div", { class: "nav" });
    var inner = el("div", { class: "nav-inner" });
    items.forEach(function (it) {
      inner.appendChild(el("button", {
        class: view === it.id ? "on" : "",
        onclick: function () { session = null; view = it.id; render(); }
      }, [
        el("span", { html: icon(it.ic), class: "row" }),
        el("span", { text: it.label }),
        el("span", { class: "nav-dot" })
      ]));
    });
    bar.appendChild(inner);
    return bar;
  }

  /* -------------------------------------------------------------- render */
  function render() {
    var root = $("#app");
    root.innerHTML = "";
    root.removeAttribute("aria-busy");

    var body;
    if (view === "session" && session && session.cur) body = viewSession();
    else if (view === "done" && session) body = viewDone();
    else if (view === "track") body = viewTrack();
    else if (view === "season") body = viewSeason();
    else if (view === "record") body = viewRecord();
    else { view = "race"; body = viewRace(); }

    root.appendChild(body);
    if (view !== "session" && view !== "done") root.appendChild(nav());

    if (sheet) {
      var back = el("div", { class: "sheet-back", onclick: function (e) { if (e.target === back) closeSheet(); } });
      var panel = el("div", { class: "sheet" });
      panel.appendChild(sheet);
      back.appendChild(panel);
      root.appendChild(back);
    }
    window.scrollTo(0, 0);
  }

  /* ---------------------------------------------------------------- boot */
  function fetchJSON(path) {
    return fetch(path, { cache: "no-cache" }).then(function (r) {
      if (!r.ok) throw new Error(path + " — " + r.status);
      return r.json();
    });
  }
  function boot() {
    state = load();
    applyTheme();
    Promise.all([
      fetchJSON("data/champions.json"),
      fetchJSON("data/lineups.json"),
      fetchJSON("data/circuits.json"),
      fetchJSON("data/season-2026.json")
    ]).then(function (d) {
      DATA.champs = d[0]; DATA.lineups = d[1]; DATA.circuits = d[2]; DATA.season = d[3];
      DATA.circuits.circuits.forEach(function (c) { CIRC[c.id] = c; });

      rebuildBank();
      render();
    }).catch(function (e) {
      $("#app").innerHTML = '<div class="wrap"><div class="empty"><b>Could not load the data</b>' +
        '<span>' + String(e.message || e) + '. This app has to be served over http — opening index.html ' +
        'straight off the filesystem will not work.</span></div></div>';
    });

    if ("serviceWorker" in navigator && location.protocol !== "file:") {
      window.addEventListener("load", function () {
        navigator.serviceWorker.register("sw.js").catch(function () {});
      });
    }
    window.addEventListener("keydown", function (e) {
      if (view !== "session" || !session || !session.cur) return;
      var q = session.cur;
      if (session.revealed && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); advance(); return; }
      if (q.kind === "mcq" && !session.revealed) {
        var i = "abcd".indexOf(String(e.key).toLowerCase());
        if (i >= 0 && q.options[i]) { e.preventDefault(); answerMcq(q.options[i].id); }
      }
    });
  }

  boot();
})();
