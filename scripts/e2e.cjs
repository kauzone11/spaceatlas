// End-to-end play-through in a real browser: every mission, three languages, desktop and phone, plus a two-tab team room.
const { chromium } = require('playwright');
// NASA APIs are answered locally (empty lists = the game keeps its snapshot) so runs do not depend on the network or the DEMO_KEY rate limit
const offline = async (ctx) => { await ctx.route(/api\.nasa\.gov|eonet\.gsfc\.nasa\.gov/, r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' })); return ctx; };
const URL = process.env.E2E_URL || 'http://localhost:4173/local.html', ARGS = ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
const results = []; const ok = (name, pass, info = '') => { results.push({ name, pass, info }); console.log(pass ? 'PASS' : 'FAIL', name, info); };
async function play(page, { mission, lang, diff, shots, tag, landerOrbit }) {
  const errs = []; page.on('console', m => { if (m.type() === 'error') errs.push(m.text()); }); page.on('pageerror', e => errs.push('PAGEERR ' + e.message));
  const shot = async n => { if (shots) { await page.waitForTimeout(900); await page.screenshot({ path: `shots/${tag}-${n}.png` }); } };
  await page.goto(URL); await page.waitForTimeout(1200);
  await page.click(`#lang button:has-text("${lang.toUpperCase()}")`);
  await shot('1home');
  await page.click('#play-solo'); await page.click('#crew-sofia'); await page.waitForSelector('#crew-name'); await shot('2crew');
  await page.click('#crew-enter'); await page.waitForSelector('#mission-' + mission);
  await page.click('#mission-' + mission); await page.waitForTimeout(300);
  if (await page.$('#unlock-all')) await page.click('#unlock-all');
  await page.click(`#difficulty button >> nth=${['cadet', 'engineer', 'director'].indexOf(diff)}`); await shot('3mission');
  await page.click('#mission-select'); await page.waitForSelector('#question'); await page.click('#q-next'); await page.click('#amb-1'); await shot('4ambition');
  let fails = 0;
  // answer every question the way a player would: pick the best-fitting instrument, follow the hints, ask for help at the summary
    await page.click('#q-next');
    await page.evaluate(() => { const bs = [...document.querySelectorAll('[id^="inst-"]:not(.off)')]; bs.sort((a, b) => parseFloat(b.querySelector('.relbar span').style.width) - parseFloat(a.querySelector('.relbar span').style.width)); bs[0].click(); });
    for (let k = 0; k < 7; k++) { // orbit … launcher
      await page.click('#q-next'); await page.waitForTimeout(120);
      if (landerOrbit && await page.$('#opt-orbit-' + landerOrbit)) await page.click('#opt-orbit-' + landerOrbit);
      for (let j = 0; j < 3 && await page.$('#try-tip'); j++) { await page.click('#try-tip'); await page.waitForTimeout(150); }
      if (k === 4) await shot('5guided-question');
    }
    await page.click('#q-next'); await page.waitForSelector('#to-review');
    for (let j = 0; j < 8; j++) { const h = await page.$('.feedback.fail .btn.plain'); if (!h) break; await h.click(); await page.waitForTimeout(200); }
    fails = await page.$$eval('.feedback.fail', e => e.length); await shot('5guided-summary');
  await page.click('#to-review'); await page.waitForSelector('#launch'); await shot('6review');
  for (const b of await page.$$('[id^="vote-go-"]')) await b.click();
  await page.waitForTimeout(200);
  if (await page.isEnabled('#launch')) await page.click('#launch'); else await page.click('#force');
  await page.waitForSelector('#film-skip, #live-card'); if (await page.$('#film-skip')) await page.click('#film-skip'); await page.waitForSelector('#live-card');
  let steps = 0, shotSit = false;
  for (; steps < 40; steps++) {
    await page.waitForTimeout(150);
    if (await page.$('#sim-finish')) break; if (await page.$('#film-skip')) { await page.click('#film-skip'); await page.waitForTimeout(100); }
    const ch = await page.$$('#live-card .choice');
    if (ch.length) { if (!shotSit) { await shot('7sim-decision'); shotSit = true; } await ch[steps % ch.length].click(); await page.waitForTimeout(150); continue; }
    if (await page.$('#sim-next')) await page.click('#sim-next');
  }
  await shot('7sim-end');
  await page.click('#sim-finish'); await page.waitForSelector('#verdict');
  await page.waitForFunction(() => document.getElementById('rp-eff')?.textContent !== '…', null, { timeout: 20000 });
  const verdict = await page.getAttribute('#verdict', 'data-verdict'), eff = await page.textContent('#rp-eff'), sci = await page.textContent('#rp-sci');
  await shot('8report');
  const rows = await page.$$eval('.wf [data-row]', e => e.length); if (rows < 2) throw new Error('waterfall missing');
  const chip = await page.$('#sugg-0'); if (chip) { await chip.click(); await page.waitForSelector('#alt-verdict'); }
  // change one thing
  await page.selectOption('#rerun-field', 'battery'); const vals = await page.$$eval('#rerun-value option', o => o.map(x => x.value).filter(Boolean)); await page.selectOption('#rerun-value', vals[vals.length - 1]);
  const alt = await page.textContent('#alt-verdict');
  await page.evaluate(() => document.getElementById('rerun').scrollIntoView()); await shot('9rerun');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1 || [...document.querySelectorAll('.screen')].some(e => e.scrollWidth > e.clientWidth + 1));
  const missing = await page.evaluate(() => /\b(sit|chk|opt|optd|inst|instd|mis|con|st|rp|rv|sim|f|why|role|crew|lobby|home|nav|obj|diff|cost|bot|wx|cr|unit|perk|mentor|step)\.[a-z0-9_.]+\b/i.test(document.body.innerText) ? document.body.innerText.match(/\b(sit|chk|opt|optd|inst|instd|mis|con|rp|rv|sim|why|role|crew|lobby|home|nav|obj|diff|bot|wx|cr|unit|perk|mentor|step)\.[a-z0-9_.]+\b/i)?.[0] : null);
  ok(`${tag} ${mission}/${lang}/${diff}`, !errs.length && !overflow && !missing && !!verdict && !!alt, `verdict=${verdict} sci=${sci?.trim()} eff=${eff} steps=${steps} studioFails=${fails} alt=${alt} overflow=${overflow} missingKey=${missing} errs=${errs.slice(0, 3).join(' | ')}`);
}
(async () => {
  const b = await chromium.launch({ args: ARGS });
  const only = process.env.ONLY; const cases0 = [
    { mission: 'leo', lang: 'en', diff: 'cadet', shots: true, tag: 'd-leo' }, { mission: 'moon', lang: 'es', diff: 'engineer', shots: true, tag: 'd-moon-guided', landerOrbit: 'ridge' },
    { mission: 'mars', lang: 'pt', diff: 'engineer', shots: false, tag: 'd-mars-guided' }, { mission: 'moon', lang: 'pt', diff: 'cadet', shots: true, tag: 'd-moon', landerOrbit: 'ridge' },
    { mission: 'neo', lang: 'es', diff: 'cadet', shots: true, tag: 'd-neo' }, { mission: 'mars', lang: 'en', diff: 'cadet', shots: true, tag: 'd-mars', landerOrbit: 'eq' },
    { mission: 'mars', lang: 'pt', diff: 'cadet', shots: false, tag: 'd-mars-orb' }, { mission: 'moon', lang: 'en', diff: 'cadet', shots: false, tag: 'd-moon-orb' },
  ], cases = cases0.filter(c => !only || only.split(',').includes(c.tag));
  for (const c of cases) { const ctx = await offline(await b.newContext({ viewport: { width: 1440, height: 900 } })); try { await play(await ctx.newPage(), c); } catch (e) { ok(c.tag, false, String(e).slice(0, 300)); } await ctx.close(); }
  for (const c of [{ mission: 'leo', lang: 'pt', diff: 'cadet', shots: true, tag: 'm-leo' }, { mission: 'mars', lang: 'es', diff: 'cadet', shots: true, tag: 'm-mars', landerOrbit: 'polar' }]) {
    const ctx = await offline(await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true })); try { await play(await ctx.newPage(), c); } catch (e) { ok(c.tag, false, String(e).slice(0, 300)); } await ctx.close(); }
  // a bad design, flown over a No-Go, must fail with a traced cause
  { const ctx = await offline(await b.newContext({ viewport: { width: 1440, height: 900 } })); const p = await ctx.newPage(); try {
    await p.goto(URL); await p.click('#play-solo'); await p.click('#crew-lucas'); await p.waitForSelector('#crew-name'); await p.click('#crew-enter'); await p.click('#mission-select');
    await p.click('#q-next'); await p.click('#q-next'); await p.click('#inst-sar'); await p.click('.qnav li:last-child button'); await p.click('#to-review'); for (const x of await p.$$('[id^="vote-go-"]')) await x.click();
    const blocked = !(await p.isEnabled('#launch')); await p.click('#force');
    for (let i = 0; i < 60 && !(await p.$('#sim-finish')); i++) { if (await p.$('#film-skip')) await p.click('#film-skip').catch(() => {}); const ch = await p.$$('#live-card .choice'); if (ch.length) await ch[0].click(); else if (await p.$('#sim-next')) await p.click('#sim-next'); await p.waitForTimeout(120); }
    await p.click('#sim-finish'); await p.waitForSelector('#verdict'); const v = await p.getAttribute('#verdict', 'data-verdict');
    const losses = await p.$$eval('.wf-row.loss', e => e.map(x => x.getAttribute('data-row'))); const cause = await p.$$eval('#wf-detail .k', e => e.length);
    await p.waitForTimeout(1500); await p.screenshot({ path: 'shots/x-fail-report.png' });
    ok('forced launch of a bad design', blocked && v === 'fail' && losses.length > 0 && cause > 0, `verdict=${v} losses=${losses.join(',')} explained=${cause}`);
  } catch (e) { ok('forced launch', false, String(e).slice(0, 300)); } await ctx.close(); }
  // team room: two tabs in one browser context (BroadcastChannel stand-in for the artifact room)
  { const ctx = await offline(await b.newContext({ viewport: { width: 1280, height: 800 } })); const A = await ctx.newPage(), B = await ctx.newPage(); try {
    for (const p of [A, B]) { await p.goto(URL); await p.click('#play-team'); await p.click(p === A ? '#crew-lucas' : '#crew-rin'); await p.waitForSelector('#crew-name'); await p.click('#crew-enter'); }
    await A.click('#room-create'); await A.waitForSelector('#room-code-show'); const code = (await A.textContent('#room-code-show')).trim();
    await B.fill('#room-code', code); await B.click('#room-join'); await B.waitForSelector('#room-code-show'); await B.waitForTimeout(2500);
    await A.click('#seat-sys'); await B.waitForSelector('#seat-sc'); await B.click('#seat-sc'); await A.waitForTimeout(800);
    await A.fill('#chat-input', 'Need 20 W more margin'); await A.keyboard.press('Enter'); await B.waitForTimeout(500);
    const chat = await B.textContent('.chatbox'); await A.screenshot({ path: 'shots/t-lobby.png' });
    await A.click('#lobby-start'); await B.waitForSelector('#mission-leo'); const bCanSelect = await B.$('#mission-select');
    await A.click('#mission-select'); await B.waitForSelector('#obj-air'); const bObjDisabled = await B.isDisabled('#obj-air'); await A.click('#obj-air');
    const q = (p, k) => p.click(`.qnav li:nth-child(${k + 1}) button`);
    await q(A, 6); await q(B, 6); await B.click('#opt-battery-L'); await A.waitForTimeout(700);
    const synced = await A.getAttribute('#opt-battery-L', 'aria-checked'), aLocked = await A.isDisabled('#opt-battery-M');
    await q(B, 4); const bLocked = await B.isDisabled('#opt-bus-M'); await B.screenshot({ path: 'shots/t-studio-b.png' });
    await q(A, 10);
    await A.click('#to-review'); await B.waitForSelector('#vote-go-sc'); const pendingBlocks = await A.isDisabled('#launch');
    await A.click('#vote-go-sys'); await B.click('#vote-go-sc'); await A.waitForTimeout(800); await A.screenshot({ path: 'shots/t-review.png' });
    ok('team room (2 tabs)', chat.includes('Need 20 W') && !bCanSelect && bObjDisabled && synced === 'true' && aLocked && bLocked && pendingBlocks,
      `code=${code} chat=${chat.includes('Need 20 W')} guestCannotSelectMission=${!bCanSelect} contractLockedForNonSys=${bObjDisabled} designSynced=${synced} A_locked_out_of_SC=${aLocked} B_locked_out_of_SYS=${bLocked} launchWaitsForVotes=${pendingBlocks}`);
  } catch (e) { ok('team room', false, String(e).slice(0, 400)); } await ctx.close(); }
  // share code via URL hash
  { const ctx = await offline(await b.newContext({ viewport: { width: 1280, height: 800 } })); const p = await ctx.newPage(); try {
    let code = process.env.SA_CODE;
    if (!code) { await p.goto(URL); await p.click('#play-solo'); await p.click('#crew-lucas'); await p.waitForSelector('#crew-name'); await p.click('#crew-enter'); await p.click('#mission-select'); await p.click('.qnav li:last-child button');
      await p.click('#share'); await p.waitForTimeout(300); code = (await p.evaluate(() => location.hash)).slice(1); }
    const q = await ctx.newPage(); await q.goto(URL + '#' + code); await q.waitForSelector('#to-review', { timeout: 5000 }); ok('design link opens the build summary', true, 'code=' + code);
  } catch (e) { ok('design link opens the studio', false, String(e).slice(0, 200)); } await ctx.close(); }
  await b.close();
  const bad = results.filter(r => !r.pass).length; console.log(`\n${results.length - bad}/${results.length} passed`); process.exit(bad ? 1 : 0);
})();
