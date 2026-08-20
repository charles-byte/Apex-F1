# Apex

A memory trainer for Formula 1, built for the phone and paced by the race
calendar.

## The loop is one check per Grand Prix

After a race you enter the result. Before the next one, the app asks whether
you still have it — a short test, eight to eleven questions, in three parts:

| | |
|---|---|
| **The race just gone** | Winner, podium order, pole, the front two rows, who finished where, the biggest mover, the sprint |
| **You missed this last time** | Anything you got wrong at an earlier check. Misses come back **before the next race**, not tomorrow |
| **Coming up** | The circuit you are about to watch — its map, its length, which way round it goes — plus where the championship stands |

Recall is **current season only**. That is the whole point: it tests what you
watched three weeks ago, not what you read about in 2013.

A check opens when you enter a result and stays open until you take it. Sit it
before the next race starts and it counts as on time; the streak is *races in a
row*, and it only moves when a race does.

## Practice, if you feel like it

Three background sections sit under the check and never nag:

| Section | What it asks |
|---|---|
| **Circuits** | Every layout raced from 2020 onwards, plus Sepang: identify the map, pick the map, length, corners, direction, lap count, first Grand Prix, calendar position |
| **Championships** | Drivers' and constructors' titles 2008–2025, runners-up, final top-five order, title margins, and "which season finished like this?" |
| **Grids** | Who drove for whom, 2008–2026 — team-mates, seats, team counts, and identifying a season from three lineups |

Practice is just reps: ten questions, weakest first. It carries nothing
forward and touches nothing in your race record.

It runs on the race calendar, not the clock. There is no daily streak to keep
and nothing goes stale overnight — you pick it up in the days before a Grand
Prix and put it down again.

It is a Progressive Web App: no install, no account, no build step, and it
pulls **nothing** from the network, not even a font. Open it in a browser, add
it to the home screen, and it runs full-screen and offline. Everything stays on
that phone.

## The maps are real

The circuit outlines are not illustrations. Every one is traced from
OpenStreetMap survey coordinates — the same data that draws the track on a
map — via [`bacinger/f1-circuits`](https://github.com/bacinger/f1-circuits)
(MIT), vendored into `data/f1-circuits.geojson`.

`build/maps.mjs` applies only the transforms you cannot avoid when putting a
piece of the round earth on a flat screen:

- **project** — lon/lat to metres, equirectangular with a cos(latitude)
  correction, so each circuit keeps its true proportions
- **orient** — north stays up. No rotation to match a broadcast graphic
- **fit** — one uniform scale into a shared 1000-unit box, so nothing is
  stretched. Jeddah renders at 4.7:1 because Jeddah *is* 4.7:1

Every surveyed point is kept — 80 to 200 per circuit. No simplification, no
smoothing, nothing redrawn by hand.

The check that this is the right geometry and not merely plausible geometry:
walking each traced ring and comparing it to the lap length F1 publishes for
that circuit. All 32 land within 1%, and `build/test-data.mjs` fails the build
if any drifts past 2%.

```bash
node build/maps.mjs --report    # rebuild every outline, with the length check
```

`build/shots/maps.html` is a contact sheet of all 32.

The one casualty: the **Bahrain Outer Circuit**, used once for the 2020 Sakhir
GP, has no survey geometry of its own, and drawing it by hand would be exactly
the thing this section refuses to do. It is left out.

## Why there is no daily schedule

Nothing here is measured in days. A miss is not "due tomorrow", it is *owed at
the next check* — it sits on a carry list until you get it right, however long
that takes. Skip three weeks and you have missed nothing; the next race brings
it all back.

If you skip a round entirely, its check is still the one you are offered next,
so a race cannot quietly disappear.

Distractors are re-drawn every time a question is asked, so you cannot learn
"the answer is the third one". Ordering questions are all-or-nothing: one place
out is a miss, and the right order is shown against yours.

## Entering the results

The season file ships with the calendar and the entry list but no results —
that is the part you keep up to date, and it is what opens the next check.
**Season → a round → Add**, then tap drivers in order. Three deep is enough for
podium and winner questions; go to ten if you want to be tested that far down.
Qualifying and sprint are separate and optional.

The standings on the Season tab are computed from whatever you have entered,
sprint points included.

To keep results with the repo rather than only on the phone,
**Settings → Export the 2026 results** and paste the JSON into the `results`
field of `data/season-2026.json`. Anything there seeds a fresh device without
overwriting what that device already has.

## Type

Samsung Sans where it exists, Verdana everywhere else. Both are already on the
device, which is why the app has no webfont and no external requests at all —
a test asserts it.

## About the rest of the data

The standings, grids and circuit facts were written by hand into `data/` — no
timing feed was reachable when this was built. Facts that overlap with the
survey data are cross-checked against it. If you find something wrong, it is
one line in `data/`, and it flows straight through to the questions;
`node build/test-data.mjs` will tell you if the fix contradicts something else.

Some seasons carry more detail than others: standings 2008–2024 include points,
2025 is order only.

## Open it

**<https://charles-byte.github.io/Apex-F1/>**

On the iPhone, open that in **Safari** — iOS only offers the install from
Safari, not Chrome — then **Share → Add to Home Screen**. It opens full-screen
with no browser chrome, and works with no signal: the service worker caches the
shell, the circuit outlines and every question, and your results live in that
phone's storage.

Every push to `main` redeploys it. `.github/workflows/pages.yml` runs the data
checks first, so a circuit outline that no longer matches its published lap
length never reaches the phone.

### Running it locally

Any static file server. The app fetches the files in `data/`, so opening
`index.html` off the filesystem will not work.

```bash
python3 -m http.server 8000
```

The service worker needs a secure context, which `127.0.0.1` counts as; over a
LAN address it will not register.

## Layout

```
index.html               app shell
app.css                  all styling; tokens for dark, light and system
app.js                   question bank, scheduling, and every view
data/champions.json      final standings 2008-2025, plus the famous title margins
data/lineups.json        every team's pairing 2008-2026, with mid-season changes
data/circuits.json       32 circuits: facts, and outlines built from the geojson
data/f1-circuits.geojson OpenStreetMap survey coordinates (MIT, see above)
data/season-2026.json    the 2026 calendar and entry list; results land here
manifest.webmanifest     name, icons, standalone display
sw.js                    offline cache. Bump CACHE when you change an asset.
icons/                   app icons, generated by build/icons.mjs
build/                   map builder and the test suite
```

### Working on it

```bash
npm install playwright         # only needed for the browser tests
node build/test-data.mjs       # data invariants, including the lap-length check
node build/test.mjs            # full flow in a real browser: every section, entry, every tab
node build/test-subpath.mjs    # served under /Apex-F1/, then with the server killed
node build/maps.mjs --report   # rebuild outlines from survey coordinates
node build/icons.mjs           # regenerate the app icons
```

`test.mjs` drives headless Chromium at phone dimensions and writes screenshots
to `build/shots/`. It runs against a **frozen clock of 20 August 2026** —
between Hungary and Zandvoort — because every behaviour in the app hangs off
where the calendar says you are, and a suite that drifted with the real date
would test something different every week.

Playwright is the only dependency, and only for `test.mjs`; `test-data.mjs`,
`maps.mjs` and the app itself run on a bare Node and a bare browser.

**After changing `app.css`, `app.js` or anything in `data/`, bump `CACHE` in
`sw.js`** — otherwise phones that already installed the app keep serving the
cached copy.

Circuit geometry © OpenStreetMap contributors, via
[bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT).
Not affiliated with Formula 1.
