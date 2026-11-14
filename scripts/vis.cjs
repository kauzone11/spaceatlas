// Dev aid for visual review without the UI on top.
// MODE=film: FILM, MISSION, ARRIVE, ENDING, FX, T (film seconds), LOOK="dx,dy" ZOOM
// MODE=studio: SHOW=rocket|craft, CAM="x,y,z,lookx,looky,lookz" (optional close-up), YAW
// CODE = design link code, OUT, VP=d|m, NAME
const { chromium } = require('playwright');
const E = process.env, URL = E.URL || 'http://localhost:4173/local.html', OUT = E.OUT || 'shots/v9/dbg', VP = E.VP || 'd', MODE = E.MODE || 'film';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(VP === 'm' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL + '#' + (E.CODE || 'sa1-01001000000000000-0-0')); await p.waitForSelector('#to-review', { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(2000);
  if (E.HIDE !== '0') await p.addStyleTag({ content: '#app,#app *{visibility:hidden!important}' });
  const name = E.NAME || MODE;
  if (MODE === 'studio') {
    if (E.SHOW === 'rocket') await p.evaluate(() => [...document.querySelectorAll('button')].find(b => /^Rocket$/.test(b.textContent.trim()))?.click());
    await p.waitForTimeout(1500);
    if (E.CAM) await p.evaluate(c => { const [x, y, z, a, b2, c2] = c.split(',').map(Number), cam = window.__sa.scene.three.cam; cam.position.set(x, y, z); cam.lookAt(a, b2, c2); }, E.CAM);
    if (E.FOCUS) await p.evaluate(f => { const [d, ax, ay] = f.split(',').map(Number), T = window.__sa.scene.three, c = T.craft.position, cam = T.cam; cam.position.set(c.x + d * Math.sin(ax || 0), c.y + d * (ay || 0.25), c.z + d * Math.cos(ax || 0)); cam.lookAt(c.x, c.y, c.z); }, E.FOCUS);
    for (const y of (E.YAW || '0').split(',').map(Number)) { await p.evaluate(v => window.__sa.scene.rotate(v * 100, 0), y); await p.waitForTimeout(900); await p.screenshot({ path: `${OUT}/${VP}-${name}-y${y}.png` }); }
  } else {
    const F = E.FILM || 'launch';
    await p.evaluate(([f, m, a, en, fx]) => { const d = window.__sa.scene.film; d.set({ key: 'dbg' + Math.random(), films: f === 'ops' ? [] : [f], hold: false, ops: f === 'ops', phase: f, mission: m, ending: en, arrive: a, post: null, fx: fx || null, cruiseDays: 200, altKm: 400, plannedAltKm: 400 }); if (f !== 'ops' && window.__PAUSE) d.pause(true); }, [F, E.MISSION || 'leo', E.ARRIVE || 'orbit', E.ENDING || 'ok', E.FX || '']);
    if (E.CAMID) await p.evaluate(c => window.__sa.scene.film.cam?.(c), E.CAMID);
    if (E.LOOK) await p.evaluate(l => { const [x, y] = l.split(',').map(Number); window.__sa.scene.film.look(x, y); }, E.LOOK);
    if (E.ZOOM) await p.evaluate(z => window.__sa.scene.film.zoom(Number(z)), E.ZOOM);
    let cur = 0;
    for (const t of (E.T || '1,3,5').split(',').map(Number)) {
      if (F === 'ops') { await p.waitForTimeout(Math.max(0, (t - cur) * 1000)); cur = t; }
      else { if (E.SEEK0 && !cur) await p.evaluate(x => window.__sa.scene.film.seek(x), Number(E.SEEK0)); await p.waitForFunction(x => window.__sa.scene.film.info.u >= x || window.__sa.scene.film.info.u >= window.__sa.scene.film.info.dur - 0.05, t, { timeout: 90000, polling: 30 }); cur = t; }
      if (E.WAIT) await p.waitForTimeout(Number(E.WAIT));
      await p.screenshot({ path: `${OUT}/${VP}-${name}-${String(t).replace('.', '_')}.png` });
    }
  }
  console.log('errors:', errs.slice(0, 8)); await b.close();
})();
