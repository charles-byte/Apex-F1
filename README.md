# Apex

A memory trainer for Formula 1, built for the phone. It drills four things:

| Section | What it asks |
|---|---|
| **Championships** | Drivers' and constructors' titles 2008–2025, runners-up, final top-five order, title margins, and "which season finished like this?" |
| **The 2026 season** | Finishing orders, poles, front rows, sprint winners and biggest movers — from results you enter as each race happens |
| **Circuits** | Every layout raced from 2020 onwards in its latest form, plus Sepang: identify the map, pick the map, length, corners, direction, lap count, first Grand Prix, calendar position |
| **Grids** | Who drove for whom, 2008–2026 — team-mates, seats, team counts, and identifying a season from three lineups |

Around 930 questions before a single race is entered, and it is a Progressive
Web App: no install, no account, no build step. Open it in Safari, add it to
the home screen, and it runs full-screen and offline. Everything stays in that
phone's local storage.

## How the drilling works

Every question has a stable key, and every key carries its own Leitner box.
Get one right and it moves out — **1 day, then 3, 7, 16, 35**. Miss it and it
drops straight back to tomorrow, however well you knew it before.

A session pulls **what is due first**, then **what has never been asked**, then
the **weakest of everything else**. So the queue drains before it grows, and
nothing you already know keeps coming back.

The distractors are re-drawn every time a question is asked, so you cannot
learn "the answer is the third one". Ordering questions are all-or-nothing:
one place out is a miss, and the correct order is shown against yours.

Tap a section to drill it alone. Long-press to drop it out of mixed sessions.

## Entering the 2026 results

The season file ships with the calendar and the entry list but no results —
that is the part you keep up to date. **Season → a round → Add**, then tap
drivers in order. Three deep is enough to generate podium and winner
questions; go to ten if you want to be tested that far down. Qualifying and
sprint are separate and optional.

Everything you enter becomes questions in the next session, and the championship
table on the Season tab is computed from it — including sprint points, so it
stays honest about what you have actually entered.

To keep the results with the repo rather than only on the phone,
**Settings → Export the 2026 results** and paste the JSON into the `results`
field of `data/season-2026.json`. Anything in there seeds a fresh device
without overwriting what that device already has.

## About the data

There is no timing feed behind this. The championship standings, grids and
circuit facts were written by hand into `data/`, and **the circuit outlines are
stylised traces** — they get the topology right (Suzuka crosses itself, Baku
has its two-kilometre straight, Monza is a triangle, Vegas runs out and back)
but they are not survey-accurate, and a few are only loosely evocative of the
real thing. They are drawn to be told apart from one another, which is what
the map quiz needs; they are not a reference.

Two ways to make it better:

- **Fix a shape by hand.** `build/tracks.mjs` holds each circuit as a list of
  waypoints in lap order. Move a point, run `node build/maps.mjs`, and check
  `build/shots/maps.html` — a contact sheet of all 33.
- **Replace them all with real geometry.** If you can reach a public GeoJSON of
  circuit centrelines, `node build/import-maps.mjs circuits.geojson` projects,
  simplifies and fits each one into the same 1000-unit box. It matches features
  to circuits by name and city, skips what it cannot match, and tells you what
  it left alone — so a partial import is safe. Add `--dry` to see the matches
  without writing.

If you find a fact wrong, it is one line in `data/` and it flows straight
through to the questions. `node build/test-data.mjs` will tell you if the fix
contradicts something else.

Some seasons carry more detail than others: standings 2008–2024 include points,
2025 is order only.

## Running it

Any static file server. The app fetches the files in `data/`, so opening
`index.html` off the filesystem will not work.

```bash
python3 -m http.server 8000
# then open http://localhost:8000/f1/
```

## Putting it on your phone

It needs **HTTPS from a real domain** for the service worker — and therefore
offline mode and home-screen install — to work at all.

1. Deploy the repo to Cloudflare Pages, Netlify or Vercel. No build command,
   output directory `/`. This app lives at `/f1/`.
2. Open that URL in **Safari** on the phone — iOS only offers the install from
   Safari — then **Share → Add to Home Screen.**

## Layout

```
index.html            app shell
app.css               all styling; tokens for dark, light and system
app.js                question bank, scheduling, and every view
data/champions.json   final standings 2008-2025, plus the famous title margins
data/lineups.json     every team's driver pairing 2008-2026, with mid-season changes
data/circuits.json    33 circuits: facts and outlines
data/season-2026.json the 2026 calendar and entry list; results land here
manifest.webmanifest  name, icons, standalone display
sw.js                 offline cache. Bump CACHE when you change an asset.
icons/                app icons
build/                map tooling and the test suite
```

### Working on it

```bash
npm install playwright        # only needed for the browser tests
node build/test-data.mjs      # data invariants, and the two files agreeing with each other
node build/test.mjs           # full flow in a real browser: every section, entry, every tab
node build/maps.mjs           # rebuild the outlines from build/tracks.mjs
node build/icons.mjs          # regenerate the app icons
```

`test.mjs` drives headless Chromium at iPhone dimensions and writes
screenshots to `build/shots/`.

**After changing `app.css`, `app.js` or anything in `data/`, bump `CACHE` in
`sw.js`** — otherwise phones that already installed the app keep serving the
cached copy.

This is a personal study tool and is not affiliated with Formula 1.
