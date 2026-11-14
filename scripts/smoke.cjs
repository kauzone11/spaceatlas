const { chromium } = require('playwright');
(async () => {
const b = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
const errs = []; p.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); p.on('pageerror', e => errs.push('PAGEERR ' + e.message));
await p.goto('http://localhost:4173/local.html'); await p.waitForTimeout(2500);
await p.screenshot({ path: 'shots/01-home.png' });
await p.click('#play-solo'); await p.waitForTimeout(1800); await p.screenshot({ path: 'shots/02-crew.png' });
await p.click('#crew-enter'); await p.waitForTimeout(1500); await p.screenshot({ path: 'shots/03-missions.png' });
await p.click('#mission-select'); await p.waitForTimeout(1200); await p.screenshot({ path: 'shots/04-contract.png' });
await p.click('#sign'); await p.waitForTimeout(1500); await p.screenshot({ path: 'shots/05-studio.png' });
console.log(errs.slice(0, 10)); await b.close();
})();
