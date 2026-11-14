// Captures the home screen and the mission carousel (each target body) for visual review of the planets and the Sun.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/local.html', OUT = process.env.OUT || 'shots/v8', VP = process.env.VP || 'd';
(async () => {
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const ctx = await b.newContext(VP === 'm' ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } : { viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage(); const errs = [];
  p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  await p.goto(URL); await p.waitForTimeout(3500); await p.click('#lang button:has-text("PT")');
  await p.screenshot({ path: `${OUT}/${VP}-home.png` });
  await p.click('#play-solo'); await p.click('#crew-sofia'); await p.waitForSelector('#crew-name'); await p.click('#crew-enter'); await p.waitForSelector('#mission-select');
  for (const m of ['leo', 'moon', 'neo', 'mars']) {
    await p.click('#mission-' + m); if (await p.$('#unlock-all')) await p.click('#unlock-all'); await p.waitForTimeout(2600);
    await p.screenshot({ path: `${OUT}/${VP}-missions-${m}.png` });
  }
  console.log('errors:', errs.slice(0, 8)); await b.close();
})();
