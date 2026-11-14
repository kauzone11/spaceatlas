// Performance probe: first paint and first usable screen, then frame times on the studio screen and during the launch film,
// for each quality tier. Headless Chromium renders WebGL on the CPU (SwiftShader), so absolute numbers are far slower than a
// real GPU; compare tiers and builds against each other, not against 60 fps.
// node scripts/perf.cjs   (needs: npx vite preview --port 4173)   PAGE=local.html TIERS=high,medium,low NET=slow
const { chromium } = require('playwright');
const E = process.env, BASE = 'http://localhost:4173/' + (E.PAGE || 'local.html');
const CODE = 'sa1-01001000000000000-0-0';
const frames = (p, ms) => p.evaluate(ms => new Promise(res => { const t = []; let last = performance.now(); const end = last + ms;
  const f = now => { t.push(now - last); last = now; if (now < end) requestAnimationFrame(f); else { t.sort((a, b) => a - b); res({ n: t.length, avg: +(t.reduce((a, b) => a + b, 0) / t.length).toFixed(1), p95: +t[Math.floor(t.length * 0.95)].toFixed(1) }); } };
  requestAnimationFrame(f); }), ms);
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  for (const q of (E.TIERS || 'high,medium,low').split(',')) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 });
    await ctx.route(/api\.nasa\.gov|eonet\.gsfc\.nasa\.gov/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', e => errs.push(e.message));
    if (E.NET === 'slow') { const s = await ctx.newCDPSession(p); await s.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 }); }
    const t0 = Date.now(); await p.goto(`${BASE}?q=${q}#${CODE}`, { waitUntil: 'commit' });
    await p.waitForSelector('.boot, #to-review', { timeout: 120000 }); const boot = Date.now() - t0;
    await p.waitForSelector('#to-review', { timeout: 180000 }); const ready = Date.now() - t0;
    await p.waitForTimeout(3000);
    const studio = await frames(p, 4000);
    await p.evaluate(() => { const d = window.__sa.scene.film; d.set({ key: 'perf' + Math.random(), films: ['launch'], hold: false, ops: false, phase: 'launch', mission: 'leo', ending: 'ok', arrive: 'orbit', post: null, fx: null, cruiseDays: 200, altKm: 400, plannedAltKm: 400 }); });
    await p.waitForFunction(() => window.__sa.scene.film.info.u >= 2, null, { timeout: 120000 }).catch(() => {});
    const launch = await frames(p, 6000);
    const perf = await p.evaluate(() => window.__sa.scene.three.perf());
    console.log(JSON.stringify({ q, bootMs: boot, readyMs: ready, studio, launch, perf, errs: errs.slice(0, 2) }));
    await ctx.close();
  }
  await b.close();
})();
