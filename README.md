# SpaceAtlas: Mission Control

A mission-design game for the NASA Space Apps Challenge. Sign a mission contract, design the spacecraft and its science payload, choose
launcher and orbit, close the budgets (cost, mass, power, delta-v, data, lifetime), pass a Go/No-Go review, fly the mission through
real-world situations, and read a debrief that traces every loss to a number.

**Play:** https://spaceatlas-ten.vercel.app (hosted on Vercel; every push to `main` deploys automatically)

- Guided build (default): one question per screen (objective, duration, instruments, orbit, size, power, battery, propulsion, comms, rocket).
  Each answer is explained with the numbers it changed, a hint shows the smallest change that fixes a failing check, and secondary decisions
  (thermal, computer, redundancy, shielding, radio band, ground network) are settled automatically.
- Explorable 3D: labels on every part of the spacecraft and the rocket, tap for a plain-language explanation, "Separate parts" for an exploded view
  (stages, boosters, the fairing opening around your spacecraft). The interaction idea is inspired by Fred Lima's Sistema Solar Web hangar
  (https://github.com/fredhlima/sistema-solar-web, CC BY-NC 4.0); no code or assets were copied.
- 4 missions: Earth observation (LEO), lunar south pole, a real near-Earth asteroid, Mars.
- 4 stations with asymmetric ownership: Systems & Budget, Spacecraft, Science, Comms & Ops. Solo, or up to 4 players in a room.
- 3 difficulties, 3 languages (EN, PT, ES), fully 3D (three.js), sounds synthesised in the browser.
- Result screen in plain words: the verdict against the minimum and full goals, a waterfall of where the science came from (expected, then each flight event, then final), a comparison with ~70 other valid spacecraft for the same mission (value for money = distance to the science-vs-cost Pareto frontier), and a one-change rerun with suggested fixes.

## Run

```bash
npm install
npm test          # physics, sizing model, simulation, translations (vitest)
npm run build     # dist/index.html + dist/assets/ (hashed JS/CSS) + dist/textures/: the web build, deployed by Vercel (vercel.json)
                  # dist/artifact.html (one-file page for a Claude artifact, standard maps inlined), dist/local.html (web build for local tests)
npx vite preview --port 4173   # then open http://localhost:4173/local.html
node scripts/e2e.cjs           # browser play-through of every mission (needs Playwright + Chromium; E2E_URL=http://localhost:4173/ tests index.html)
node scripts/guided-shots.cjs  # screenshots of every guided question and the 3D part explorer
node scripts/audit-shots.cjs   # every screen at 390 px and 1440 px, flags horizontal overflow and console errors
node scripts/perf.cjs          # first paint, time to usable screen and frame times per quality tier (add ?q=low|medium|high to force a tier)
```

## Layout

| Path | What |
|---|---|
| `src/engine/catalog.ts` | Parts, missions, constants, sources. Pure data. |
| `src/engine/engine.ts` | Physics helpers, sizing model, Go/No-Go checks, sizing assistant. No DOM. |
| `src/engine/sim.ts` | Deterministic mission simulation (incidents and decisions), Pareto sampler. |
| `src/engine/codec.ts` | Design <-> share code (URL hash). |
| `src/engine/guided.ts` | Guided-build question order, answer (choice plus automatic secondary decisions), per-step hint. |
| `src/i18n/` | English source plus Portuguese and Spanish; tests enforce identical keys and placeholders. |
| `src/data/` | Generated: NASA textures, portraits, Bennu shape model, data snapshot (`scripts/build_assets.py`). |
| `src/net/room.ts` | Team rooms over the artifact `room` capability; BroadcastChannel stand-in for local tabs. |
| `src/ui/` | Preact screens, three.js scene, store (host-authoritative shared state), audio. |
| `src/ui/cine.ts` | Flight films. Smoke and steam are lit, depth-sorted billows; exhaust plumes differ by propellant (kerosene, solid, hydrogen); a solar storm is shown as it is observed (flare, particle tracks on the camera sensor, the plasma cloud, aurora), not as explosions. The launch has selectable cameras. |
| `src/ui/quality.ts` | Quality tiers (pixel ratio, shadows, particle density, bush count, 4096-px maps, 30 fps menus on the low tier). Starts from the device's memory, cores and pointer; a frame-time governor steps down when frames run long and remembers it. |
| `public/textures/` | Planet maps (WebP, greyscale JPEG), standard set up to 2048 px plus `hd/` 4096-px maps; built by `scripts/build_worlds.py`. |
| `src/ui/env.ts` | Procedural image-based lighting (space, clear day) so metal, foil, glass and paint reflect their surroundings. |
| `src/ui/pad.ts`, `src/ui/livery.ts` | Launch complex, sky, ocean; vehicle paint with frost, soot, stringers and weld rings. |

## Model (first-order, for learning trade-offs, not for flight)

- Rocket equation: dv = Isp g0 ln(m0/mf); propellant and tank mass grow with dry mass.
- Solar power: 1361 W/m2 / r^2, 29 % cells, yearly degradation, eclipse or night fraction per orbit; RTG 110 W with decay.
- Battery: capacity x allowed depth of discharge against the longest dark period.
- Link: rate proportional to antenna gain and band, falling with distance squared; data per day = rate x contact time.
- Margins: 10 / 15 / 20 % by difficulty (ESA uses 20 % system margin in early phases).
- Every flight draws 2–3 random events (13 kinds: launch-day winds, a stuck solar wing, micrometeoroid, coronal mass ejection, fogged optics, computer reset, reaction-wheel failure, debris conjunction, meteor shower, lost antenna time, an unexpected discovery, a dust devil on Mars, a budget cut) among those that fit the mission and design. The draw comes from a flight seed shared by the whole team; outcomes still depend on the design and the decision taken. A one-change rerun keeps the seed, so the comparison is fair. The expected-value baseline (Pareto frontier, planning) has no random events.

## Data and credits

Live NASA data: when the page can reach NASA's APIs (a normal web host), it loads today's DONKI coronal mass ejections and geomagnetic storms, NeoWs close approaches and EONET events (`src/net/live.ts`, cached 3 h, DEMO_KEY); inside a Claude artifact outside requests are blocked and it uses the snapshot in `src/data/nasa.ts` (`node scripts/fetch-nasa.mjs` refreshes it). Live data changes texts and briefing cards only, never the simulation.

Snapshot of 2026-11-12: NASA EONET v3 (natural events), NASA/JPL NHATS and Close-Approach Data (asteroid 2000 SG344 trajectory).
Space-weather situations use documented historical events (May 2024 storm, August 1972 event, July 2012 CME, September 2017 flare,
February 2022 Starlink loss). Moon colour and elevation (NASA SVS CGI Moon Kit, LRO), the Bennu shape model and astronaut portraits
are NASA public-domain media (NASA 3D Resources, Scientific Visualization Studio, NASA Image and Video Library). Earth day/clouds/night
lights/water mask, Mars, the Sun, Mercury, Venus, Jupiter, Saturn (and rings), Uranus and Neptune use Solar System Scope textures
(https://www.solarsystemscope.com/textures/, CC BY 4.0, based on NASA data); Mars is re-coloured to the NASA Viking mosaic.
Textures are built by `scripts/build_worlds.py` into `src/data/worlds.ts`. NASA does not endorse this game.
Crew members are fictional; mentors are real NASA astronauts described with verifiable facts only.

## Performance

- Download: the web build's first load is about 0.7 MB (code, styles, portraits, the asteroid shape); planet maps (1.5 MB standard set) are fetched the first time each body is shown, and the 4096-px Earth, cloud, Moon and Mars maps (2.7 MB) only on capable desktops. The one-file artifact is 2.7 MB with the standard maps inlined.
- A static splash is painted before the script runs. The launch complex and film effects are built in idle time after the first screen, not at start-up.
- Rendering adapts at run time (`src/ui/quality.ts`); the per-frame film logic costs under 1 ms of CPU, so the levers are pixel ratio, shadows and particle overdraw.
