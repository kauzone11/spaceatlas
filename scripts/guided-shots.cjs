// Visual review of the guided build: every question, the part explorer and the exploded views, at desktop and phone width.
const { chromium } = require('playwright');
const URL = process.env.URL || 'http://localhost:4173/local.html', OUT = process.env.OUT || 'shots/guided';
(async () => {
  require('fs').mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const errs = [];
  for (const [tag, vp] of (process.env.ONLY === 'm' ? [['m', { width: 390, height: 844 }]] : process.env.ONLY === 'd' ? [['d', { width: 1440, height: 900 }]] : [['d', { width: 1440, height: 900 }], ['m', { width: 390, height: 844 }]])) {
    const p = await b.newPage({ viewport: vp });
    p.on('console', m => { if (m.type() === 'error') errs.push(tag + ' ' + m.text()); }); p.on('pageerror', e => errs.push(tag + ' PAGEERR ' + e.message));
    const shot = async (n, full) => { await p.waitForTimeout(1200); await p.screenshot({ path: `${OUT}/${tag}-${n}.png`, fullPage: !!full }); };
    await p.goto(URL); await p.waitForTimeout(1500); await p.click('#lang button:has-text("PT")');
    await p.click('#play-solo'); await p.click('#crew-sofia'); await p.click('#crew-enter'); await p.click('#mission-select'); await p.waitForSelector('#question');
    await shot('01objective');
    await p.click('#q-next'); await shot('02ambition');
    await p.click('#q-next'); await p.click('#inst-tir'); await shot('03instruments');
    for (const n of ['04orbit', '05bus', '06power']) { await p.click('#q-next'); await shot(n); }
    if (tag === 'd') { await p.click('#opt-power-solarM').catch(() => {}); await shot('06power-b'); }
    await p.click('#q-next'); await shot('07battery');
    await p.click('#explode'); await shot('07battery-exploded');
    const lab = await p.$('.plabel[data-part="antenna"]:visible'); if (lab) { await lab.click(); await shot('07part-antenna'); }
    await p.click('#explode');
    await p.click('#q-next'); await shot('08prop'); await p.click('#q-next'); await shot('09antenna'); await p.click('#q-next'); await shot('10launcher');
    await p.click('#explode'); await shot('10rocket-exploded');
    const fl = await p.$('.plabel[data-part="fairing"]:visible'); if (fl) { await fl.click(); await shot('10part-fairing'); }
    await p.click('#explode');
    await p.click('#q-next'); await shot('11summary');
    const missing = await p.evaluate(() => (document.body.innerText.match(/\b(gd|part|st|chk|opt|optd)\.[a-z0-9_.]+\b/) || [null])[0]);
    const overflow = await p.evaluate(() => { if (document.documentElement.scrollWidth <= innerWidth + 1) return false; const o = []; for (const e of document.querySelectorAll('body *')) { const r = e.getBoundingClientRect(); if (r.right > innerWidth + 1 && r.width > 0) o.push(e.tagName + '.' + e.className + ':' + Math.round(r.right)); } return o.slice(0, 6).join(' | '); });
    console.log(tag, 'missing key:', missing, 'h-overflow:', overflow);
    await p.close();
  }
  console.log('errors:', errs.slice(0, 10)); await b.close();
})();
