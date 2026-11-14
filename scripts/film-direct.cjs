// Plays one film directly through the scene director (no game flow) and captures frames at given film times. Dev aid for visual review.
// FILM=launch|cruise|arrival MISSION=leo|moon|neo|mars ARRIVE=orbit|land|nav|aero|flyby|miss T=comma-separated film seconds OUT=dir VP=d|m
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/local.html', OUT = process.env.OUT || 'shots/dbg', VP = process.env.VP || 'd';
const FILM = process.env.FILM || 'arrival', MIS = process.env.MISSION || 'mars', ARR = process.env.ARRIVE || 'orbit';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(VP === 'm' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  // a design link gives the scene a spacecraft and a launcher to fly
  await p.goto(URL + '#' + (process.env.CODE || 'sa1-01001000000000000-0-0')); await p.waitForSelector('#to-review', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2500);
  await p.evaluate(([f, m, a]) => { const d = window.__sa.scene.film; d.set({ key: 'dbg' + Math.random(), films: [f], hold: false, ops: false, phase: f, mission: m, ending: 'ok', arrive: a, post: null, fx: null, cruiseDays: 200, altKm: 400, plannedAltKm: 400 }); d.pause(true); }, [FILM, MIS, ARR]);
  let cur = 0;
  for (const t of (process.env.T || '1,3,5').split(',').map(Number)) {
    // step through time so particles and released parts evolve (one rendered frame per step)
    for (; cur < t; cur = Math.min(t, cur + 0.2)) { await p.evaluate(x => window.__sa.scene.film.seek(x), cur); await p.waitForTimeout(60); }
    await p.evaluate(x => window.__sa.scene.film.seek(x), t); await p.waitForTimeout(700);
    await p.screenshot({ path: `${OUT}/${VP}-${FILM}-${MIS}-${ARR}-${String(t).replace('.', '_')}.png` });
  }
  console.log('errors:', errs.slice(0, 8)); await b.close();
})();
