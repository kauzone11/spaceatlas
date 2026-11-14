// Captures frames of the flight films (launch, cruise, arrival, operations) for visual review.
// MISSION=leo|moon|neo|mars  OUT=dir  VP=d|m  T=comma-separated seconds for the launch frames
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/local.html', OUT = process.env.OUT || 'shots/film', MIS = process.env.MISSION || 'leo', VP = process.env.VP || 'd';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(VP === 'm' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL); await p.waitForTimeout(1200); await p.click('#lang button:has-text("PT")');
  await p.click('#play-solo'); await p.click('#crew-sofie'); await p.waitForSelector('#crew-name'); await p.click('#crew-enter'); await p.waitForSelector('#mission-select');
  if (MIS !== 'leo') { await p.click('#mission-' + MIS); if (await p.$('#unlock-all')) await p.click('#unlock-all'); await p.waitForTimeout(200); }
  await p.click('#mission-select'); await p.waitForSelector('#question');
  for (let k = 0; k < 16 && !(await p.$('#to-review')); k++) {
    for (let j = 0; j < 3 && await p.$('#try-tip'); j++) { await p.click('#try-tip'); await p.waitForTimeout(100); }
    if (await p.$('#q-next:disabled')) { const o = await p.$$('.qopt:not(:disabled)'); if (o.length) await o[0].click(); }
    await p.click('#q-next').catch(() => {}); await p.waitForTimeout(120);
  }
  await p.click('#to-review'); await p.waitForSelector('#launch');
  for (const x of await p.$$('[id^="vote-go-"]')) await x.click(); await p.waitForTimeout(200);
  if (await p.isEnabled('#launch')) await p.click('#launch'); else await p.click('#force');
  if (process.env.SPEED) await p.click('#film-speed button:has-text("' + process.env.SPEED + '×")');
  const times = (process.env.T || '0.5,2.6,4.5,7,9,10.5,12.4,15,19').split(',').map(Number); const t0 = Date.now();
  for (const t of times) { const w = t * 1000 - (Date.now() - t0); if (w > 0) await p.waitForTimeout(w); await p.screenshot({ path: `${OUT}/${VP}-${MIS}-launch-${String(t).replace('.', '_')}.png` }); }
  for (let s = 0; s < 14; s++) {
    if (await p.$('#sim-finish')) break;
    await p.waitForSelector('.fpanel.in', { timeout: 30000 }).catch(() => {});
    const ch = await p.$$('#live-card .choice');
    if (ch.length) await ch[0].click(); else if (await p.$('#sim-next')) await p.click('#sim-next'); else { await p.waitForTimeout(300); continue; }
    await p.waitForTimeout(3200); await p.screenshot({ path: `${OUT}/${VP}-${MIS}-seg${s}-a.png` });
    await p.waitForSelector('.fpanel.in', { timeout: 30000 }).catch(() => {}); await p.waitForTimeout(600); await p.screenshot({ path: `${OUT}/${VP}-${MIS}-seg${s}-b.png` });
  }
  console.log('errors:', errs.slice(0, 8)); await b.close();
})();
