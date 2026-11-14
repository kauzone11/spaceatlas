// Visual audit of every screen at phone and desktop width, guided path, PT. Long screens are also captured unrolled (-full).
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/local.html', OUT = process.env.OUT || 'shots/audit', LANG = process.env.LANG_UI || 'PT';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [], report = [];
  const vps = { m: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }, s: { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true }, d: { viewport: { width: 1440, height: 900 } } };
  for (const tag of (process.env.ONLY || 'm,d').split(',')) {
    const ctx = await b.newContext(vps[tag]); const p = await ctx.newPage();
    p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' ' + m.text()); }); p.on('pageerror', e => errs.push(tag + ' PAGEERR ' + e.message));
    const shot = async n => {
      await p.waitForTimeout(1000); await p.screenshot({ path: `${OUT}/${tag}-${n}.png` });
      const ov = await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.screen')].some(e => e.scrollWidth > e.clientWidth + 1));
      if (ov) report.push(`${tag}-${n}: horizontal overflow`);
      const tall = await p.evaluate(() => { const s = document.querySelector('.screen'); return s && s.scrollHeight > s.clientHeight + 40; });
      if (tall) {
        await p.evaluate(() => { const s = document.querySelector('.screen'); s.dataset.k = s.getAttribute('style') || ''; s.style.cssText += ';height:auto;max-height:none;overflow:visible;position:relative;inset:auto'; document.body.style.height = 'auto'; document.body.style.overflow = 'visible'; document.documentElement.style.overflow = 'visible'; });
        await p.waitForTimeout(300); await p.screenshot({ path: `${OUT}/${tag}-${n}-full.png`, fullPage: true });
        await p.evaluate(() => { const s = document.querySelector('.screen'); s.setAttribute('style', s.dataset.k); document.body.style.height = ''; document.body.style.overflow = ''; document.documentElement.style.overflow = ''; });
      }
    };
    await p.goto(URL); await p.waitForTimeout(1500); await p.click(`#lang button:has-text("${LANG}")`); await shot('01home');
    await p.click('#play-solo'); await p.click('#crew-sofia'); await p.waitForSelector('#crew-name'); await shot('02crew');
    await p.click('#crew-enter'); await p.waitForSelector('#mission-select'); await shot('03missions');
    await p.click('#mission-select'); await p.waitForSelector('#question'); await shot('04objective');
    await p.click('#q-next'); await p.click('#amb-1'); await p.click('#q-next');
    await p.evaluate(() => { const bs = [...document.querySelectorAll('[id^="inst-"]:not(.off)')]; bs.sort((a, b) => parseFloat(b.querySelector('.relbar span').style.width) - parseFloat(a.querySelector('.relbar span').style.width)); bs[0].click(); });
    await shot('05instruments');
    for (let k = 0; k < 7; k++) { await p.click('#q-next'); await p.waitForTimeout(120); for (let j = 0; j < 3 && await p.$('#try-tip'); j++) { await p.click('#try-tip'); await p.waitForTimeout(150); } if (k === 2) await shot('06power'); }
    await p.click('#q-next'); await p.waitForSelector('#to-review'); await shot('07summary');
    await p.click('#to-review'); await p.waitForSelector('#launch'); await shot('08review');
    for (const x of await p.$$('[id^="vote-go-"]')) await x.click(); await p.waitForTimeout(200);
    if (await p.isEnabled('#launch')) await p.click('#launch'); else await p.click('#force');
    await p.waitForTimeout(6000); await shot('09sim-launch'); await p.click('#film-skip').catch(() => {}); await p.waitForSelector('#live-card');
    let shotDec = false;
    for (let s = 0; s < 40; s++) { await p.waitForTimeout(150); if (await p.$('#sim-finish')) break; if (await p.$('#film-skip')) { await p.click('#film-skip'); await p.waitForTimeout(100); }
      const ch = await p.$$('#live-card .choice'); if (ch.length) { if (!shotDec) { await shot('10sim-decision'); shotDec = true; } await ch[0].click(); await p.waitForTimeout(150); continue; }
      if (await p.$('#sim-next')) await p.click('#sim-next'); }
    await shot('11sim-end');
    await p.click('#sim-finish'); await p.waitForSelector('#verdict');
    await p.waitForFunction(() => !document.querySelector('[data-computing]'), null, { timeout: 20000 }).catch(() => {});
    await shot('12report');
    if (process.env.EXTRA) await eval(process.env.EXTRA);
    await ctx.close();
  }
  console.log('issues:', report); console.log('errors:', errs.slice(0, 10)); await b.close();
})();
