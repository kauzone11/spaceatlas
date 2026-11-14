import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { t, fmt } from '../i18n';
import { Design, Field, Role, ROLES } from '../engine/catalog';
import { CheckId, Patch, optionsFor } from '../engine/engine';
import { complete, pareto, frontierAt, Pareto, PHASES, Result, Entry } from '../engine/sim';
import { app, act, canEdit, derived, crewPerks, simOpts, isHost, recordResult, toast, Vote } from './store';
import { Btn, Chip, Icon, Seg, cx, checkText, patchLabel, roleOwnerName, sitVars, optLabel } from './common';
import type { Scene3D } from './scene';
import type { FilmSpec, Film, Ending, Arrive, Fx, CamId } from './cine';
import { Meters } from './meters';
import { sfx } from './audio';

// ---------------- Go/No-Go ----------------
export function effectiveVote(role: Role): Vote | null {
  const g = app.g, { m } = derived();
  if (g.seats[role]) return g.votes[role];
  const f = m.checks.find(c => c.role === role && c.status === 'fail');
  return f ? { go: false, reason: f.id } : { go: true };
}
export function Review() {
  const g = app.g, { m } = derived(), host = app.mode === 'solo' || isHost();
  const votes = ROLES.map(r => ({ r, v: effectiveVote(r) })).sort((a, b) => Number(g.seats[b.r]?.peer === app.me) - Number(g.seats[a.r]?.peer === app.me)), nogo = votes.filter(x => x.v && !x.v.go).length, pending = votes.filter(x => !x.v).length;
  return <div class="wrap col enter">
    <div><h1 class="h-l">{t('rv.title')}</h1><p class="lead">{t('rv.sub')}</p></div>
    <div style="max-width:900px"><Meters m={m} k="rv" /></div>
    <div class="rgrid">{votes.map(({ r, v }) => {
      const cs = m.checks.filter(c => c.role === r && c.status !== 'ok'), fails = cs.filter(c => c.status === 'fail'), seat = g.seats[r], mine = seat?.peer === app.me;
      return <div class={cx('panel vote', v && (v.go ? 'go' : 'nogo'), mine && 'soft')} data-role={r}>
        <div class="row"><h2 class="h-m">{t('role.' + r)}</h2><span style="flex:1" />{v ? <Chip tone={v.go ? 'ok' : 'fail'}>{t(v.go ? 'rv.go' : 'rv.nogo')}</Chip> : <Chip tone="warn">{t('rv.pending')}</Chip>}</div>
        <div class="small mut">{roleOwnerName(r)}</div>
        {!seat && <p class="say">{fails.length ? t('bot.nogo') : cs.length ? t('bot.warn') : t(`bot.${r}.go`)}</p>}
        {cs.length ? <ul class="clean">{cs.map(c => <li style={v && !v.go && v.reason === c.id ? 'color:var(--ink)' : ''}><b>{t(`chk.${c.id}.t`)}.</b> {checkText(c)}</li>)}</ul> : seat && <p class="say">{t('rv.clean')}</p>}
        {mine && <div class="col" style="gap:8px"><h3 class="h-s">{t('rv.vote')}</h3>
          <div class="row"><Btn id={'vote-go-' + r} kind="primary" sound="select" onClick={() => act({ t: 'vote', role: r, go: true })}>{v?.go ? '✓ ' : ''}{t('rv.go')}</Btn>
            {cs.map(c => <Btn kind={v && !v.go && v.reason === c.id ? 'danger' : 'ghost'} onClick={() => act({ t: 'vote', role: r, go: false, reason: c.id as CheckId })} title={t('rv.reason')}>{t('rv.nogo')}: {t(`chk.${c.id}.t`)}</Btn>)}</div></div>}
      </div>; })}</div>
    <div class="row stickybar" style="max-width:900px">
      <Btn kind="ghost" id="back-studio" disabled={!host} onClick={() => act({ t: 'nav', screen: 'studio' })}>{t('rv.back')}</Btn>
      <span class="mut small" id="review-status">{pending ? t('rv.pending') : nogo ? t('rv.blocked', { n: nogo }) : t('rv.allgo')}</span><span style="flex:1" />
      {host && nogo > 0 && !pending && <Btn kind="danger" id="force" sound="alert" onClick={() => act({ t: 'launch', forced: true })}>{t('rv.force')}</Btn>}
      {host ? <Btn big id="launch" disabled={pending > 0 || nogo > 0} sound="launch" onClick={() => act({ t: 'launch', forced: false })}>{t('rv.launch')}</Btn> : <span class="mut small">{t('lobby.wait')}</span>}
    </div>
  </div>;
}

// ---------------- flight ----------------
const signed = (n: number) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n), 0)}`;
function EntryCard({ e, d, live, last }: { e: Entry; d: Design; live: boolean; last: boolean }) {
  const vars = sitVars(d, e), can = canEdit(e.role), host = app.mode === 'solo' || isHost();
  useEffect(() => { if (live && e.v) (e.tone === 'bad' ? sfx.bad : e.tone === 'good' ? sfx.good : sfx.tap)(); else if (live) sfx.alert(); }, [live, e.v]);
  if (!live) return <div class={cx('panel card past', e.tone)}><div class="row" style="flex-wrap:nowrap"><span class="tone" /><b>{t(`sit.${e.id}.t`)}</b><span style="flex:1" />{Math.abs(e.delta) >= 0.5 && <span class={cx('small num', e.delta > 0 ? 'up' : 'down')}>{signed(e.delta)} {t('unit.su')}</span>}</div>
    <p class="small mut">{t(`sit.${e.id}.r.${e.v}`, vars)}</p></div>;
  return <div class={cx('panel card col enter soft', e.v ? e.tone : 'live')} id="live-card" data-sit={e.id}>
    <div class="row"><Chip tone={e.kind === 'opportunity' ? 'ok' : e.kind === 'weather' ? 'warn' : 'info'}>{t('sim.kind.' + e.kind)}</Chip>{e.random && <Chip tone="info">{t('sim.random')}</Chip>}<span class="small mut">{t('sim.phase.' + e.phase)}</span></div>
    <h3>{t(`sit.${e.id}.t`)}</h3>
    {e.options.length > 0 && <p class="mut">{t(`sit.${e.id}.b`, vars)}</p>}
    {!e.v ? <div class="choices"><div class="small dim">{can ? t('sim.decide', { role: t('role.' + e.role) }) : t('sim.waiting', { name: roleOwnerName(e.role) })}</div>
      {e.options.map(o => <button type="button" class="choice" data-opt={o} disabled={!can} onClick={() => { sfx.select(); act({ t: 'pick', sit: e.id, opt: o }); }}>{t(`sit.${e.id}.o.${o}`)}</button>)}</div>
      : <>
        {e.pick && <div class="small dim">{t(`sit.${e.id}.o.${e.pick}`)}</div>}
        <p>{t(`sit.${e.id}.r.${e.v}`, vars)}</p>
        {Math.abs(e.delta) >= 0.5 && <div class={cx('num', e.delta > 0 ? 'up' : 'down')}>{t('sim.effect')}: {signed(e.delta)} {t('unit.su')}</div>}
        <div>{last ? (host ? <Btn big id="sim-finish" sound="select" onClick={() => act({ t: 'nav', screen: 'report' })}>{t('sim.finish')}</Btn> : <span class="mut">{t('lobby.wait')}</span>)
          : <Btn id="sim-next" onClick={() => act({ t: 'step' })}>{t('sim.next')}</Btn>}</div>
      </>}
  </div>;
}
export function currentEntry() { const { r } = derived(); const i = Math.min(app.g.shown, r.timeline.length - 1); return { r, i, e: r.timeline[i] }; }
// The flight is shown as a mission-control feed: the film owns the screen, a HUD shows clock and telemetry,
// hazards raise an alert, and the decision panel slides in when the vehicle reaches the moment that needs a call.
const FX: Record<string, Fx> = { flare: 'storm', eclipse: 'dark', night: 'dark', cold: 'dark', brownout: 'dark', dust: 'dust', dustorb: 'dust', micro: 'streaks', drag: 'plasma', decay: 'plasma', conj: 'sunblock', cme: 'storm', meteoroid: 'streaks', debris: 'streaks', shower: 'streaks', upset: 'dark', cleaning: 'dust' };
const POST: Record<string, true> = { landing: true, aerobrake: true, nav: true };
export function filmSpec(r: Result, i: number, d: Design): FilmSpec | null {
  const e = r.timeline[i]; if (!e) return null;
  const ids = new Set(r.timeline.map(x => x.id)), lander = r.m.orbit.kind === 'lander';
  const ending: Ending = ids.has('licence') ? 'hold' : ids.has('overmass') ? 'short' : ids.has('rideorbit') ? 'offorbit' : 'ok';
  const arrive: Arrive = e.id === 'dvshort' ? (r.lost || e.v === 'miss' ? 'miss' : 'orbit') : e.id === 'aerobrake' ? 'aero' : e.id === 'nav' ? 'nav' : e.id === 'landing' || lander ? 'land' : r.m.orbit.kind === 'flyby' ? 'flyby' : 'orbit';
  const FILMED: Film[] = d.mission === 'leo' ? ['launch', 'cruise'] : ['launch', 'cruise', 'arrival'];
  const post = POST[e.id] && e.v ? (e.id === 'aerobrake' ? e.pick ?? 'aero' : 'done') : null;
  // every filmed phase between the previous entry and this one plays once, in order
  const prev = i > 0 ? PHASES.indexOf(r.timeline[i - 1].phase) : -1, here = PHASES.indexOf(e.phase), own = FILMED.includes(e.phase as Film);
  const films = post ? [e.phase as Film] : FILMED.filter(f => { const k = PHASES.indexOf(f); return k > prev && k <= here; });
  const hold = !post && own && prev === here;
  if (hold) films.push(e.phase as Film);
  const ride = r.timeline.find(x => x.id === 'rideorbit');
  return {
    key: `${i}:${e.id}:${post ?? ''}`, films, hold, ops: !own, phase: e.phase, mission: d.mission, ending, arrive, post, fx: FX[e.id] ?? null,
    cruiseDays: r.m.cruiseDays, altKm: ride ? 525 : r.m.orbit.alt ?? 0, plannedAltKm: ride ? Number(ride.vars.alt) || 0 : r.m.orbit.alt ?? 0,
  };
}
const pad2 = (n: number) => String(Math.floor(n)).padStart(2, '0');
const tclock = (v: number) => { const a = Math.abs(Math.round(v)); return `T${v < 0 ? '−' : '+'} ${pad2(a / 3600)}:${pad2((a % 3600) / 60)}:${pad2(a % 60)}`; };
const compact = (n: number) => new Intl.NumberFormat(app.lang, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
const MINOR = new Set(['ignition', 'stagesep', 'ses', 'deluge']);
const ALERT: Record<string, 'fail' | 'warn' | 'ok' | 'info'> = { weather: 'fail', incident: 'fail', consequence: 'warn', opportunity: 'ok' };

export function Sim({ scene }: { scene: Scene3D | null }) {
  const d = app.g.design, { r, i, e } = currentEntry(), film = scene?.film ?? null;
  const seen = r.timeline.slice(0, i + 1), sciSoFar = seen.reduce((s, x) => s + (x.v ? x.delta : 0), 0) + r.m.sciRate * r.m.opsDays;
  const last = !r.pending && i >= r.timeline.length - 1, lostNow = r.lost && last;
  const pi = PHASES.indexOf(e?.phase ?? 'launch');
  const spec = useMemo(() => filmSpec(r, i, d), [r, i, d]);
  const [ready, setReady] = useState(true), [alert, setAlert] = useState(false), [, bump] = useState(0);
  const refs = { clock: useRef<HTMLElement>(null), warp: useRef<HTMLElement>(null), alt: useRef<HTMLElement>(null), vel: useRef<HTMLElement>(null), dist: useRef<HTMLElement>(null), bar: useRef<HTMLElement>(null), cap: useRef<HTMLElement>(null), labels: useRef<HTMLDivElement>(null), strip: useRef<HTMLOListElement>(null) };
  useEffect(() => { film?.set(spec); }, [spec?.key]);
  useEffect(() => () => film?.set(null), []);
  // per-frame HUD: written straight to the DOM so the film never waits on a re-render
  useEffect(() => {
    let raf = 0, lastLbl = '', lastCap = '', seq = -1;
    const opsDay = () => { const ops = r.timeline.filter(x => x.phase === 'ops' || x.phase === 'end'), k = ops.indexOf(e); return Math.round(r.m.cruiseDays + (r.m.opsDays * (k + 1)) / (ops.length + 1)); };
    const frame = () => {
      const f = film?.info, put = (el: HTMLElement | null, s: string) => { if (el && el.textContent !== s) el.textContent = s; };
      const row = (el: HTMLElement | null, v: number | null | undefined, s: string) => { if (!el) return; (el.parentElement as HTMLElement).hidden = v == null; if (v != null) put(el, s); };
      if (f?.active) {
        put(refs.clock.current, f.clock.kind === 'T' ? tclock(f.clock.v) : f.clock.kind === 'day' ? t('film.day', { n: fmt(f.clock.v, 0) }) + (f.clock.of ? ` / ${fmt(f.clock.of, 0)}` : '') : '');
        put(refs.warp.current, f.hold ? t('film.ev.hold') : t('film.warp', { n: compact(f.warp) }));
        row(refs.alt.current, f.alt, `${fmt(f.alt ?? 0, (f.alt ?? 0) < 10 ? 1 : 0)} km`); row(refs.vel.current, f.vel, `${fmt(f.vel ?? 0, 2)} km/s`); row(refs.dist.current, f.dist, `${compact(f.dist ?? 0)} km`);
        if (refs.bar.current) refs.bar.current.style.width = `${(100 * f.u) / Math.max(0.01, f.dur)}%`;
        refs.strip.current?.querySelectorAll('li').forEach((li, k) => li.classList.toggle('done', f.u >= (f.events[k]?.at ?? Infinity)));
        const now = [...f.events].reverse().find(x => f.u >= x.at && f.u - x.at < 2.6), cap = now ? t('film.ev.' + now.k) : '';
        if (cap !== lastCap && refs.cap.current) { lastCap = cap; refs.cap.current.textContent = cap; refs.cap.current.classList.toggle('on', !!cap); }
        const lk = f.labels.map(l => l.k).join();
        if (refs.labels.current) { if (lk !== lastLbl) { lastLbl = lk; refs.labels.current.innerHTML = f.labels.map(l => `<span data-k="${l.k}">${t('film.lbl.' + l.k)}</span>`).join(''); }
          f.labels.forEach((l, k) => { const s = refs.labels.current!.children[k] as HTMLElement; if (s) s.style.transform = `translate(${l.x}px, ${l.y}px) translate(-50%, 0)`; }); }
      } else {
        if (lastCap && refs.cap.current) { lastCap = ''; refs.cap.current.textContent = ''; refs.cap.current.classList.remove('on'); }
        put(refs.clock.current, t('film.day', { n: fmt(opsDay(), 0) })); put(refs.warp.current, '');
        const alt = r.m.orbit.alt; row(refs.alt.current, alt ?? null, `${fmt(alt ?? 0, 0)} km`); row(refs.vel.current, d.mission === 'leo' && alt ? 1 : null, `${fmt(Math.sqrt(398600 / (6371 + (alt ?? 0))), 2)} km/s`); row(refs.dist.current, null, '');
        if (refs.labels.current && refs.labels.current.firstChild) { lastLbl = ''; refs.labels.current.innerHTML = ''; }
      }
      if (f && f.seq !== seq) { seq = f.seq; bump(x => x + 1); }
      const rd = !film || !spec || film.info.ready, al = !!film && film.info.alert;
      setReady(x => (x === rd ? x : rd)); setAlert(x => (x === al ? x : al));
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame); return () => cancelAnimationFrame(raf);
  }, [spec?.key, e]);
  // look around: drag to orbit the camera, wheel or pinch to zoom
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const onDown = (ev: PointerEvent) => { if ((ev.target as HTMLElement).closest('button, a, input, .fpanel, details')) return; (ev.currentTarget as HTMLElement).setPointerCapture(ev.pointerId); pts.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY }); };
  const onMove = (ev: PointerEvent) => { const m = pts.current, p = m.get(ev.pointerId); if (!p) return;
    if (m.size === 2) { const [a, b] = [...m.values()], d0 = Math.hypot(a.x - b.x, a.y - b.y); p.x = ev.clientX; p.y = ev.clientY; const [c, dd] = [...m.values()], d1 = Math.hypot(c.x - dd.x, c.y - dd.y); if (d0 > 0) film?.zoom(d0 / d1); return; }
    film?.look(ev.clientX - p.x, ev.clientY - p.y); scene?.rotate(ev.clientX - p.x, 0); p.x = ev.clientX; p.y = ev.clientY; };
  const onUp = (ev: PointerEvent) => { pts.current.delete(ev.pointerId); };
  const st = film?.state, filmOn = !!film && film.info.active, events = filmOn ? film!.info.events : [];
  const set = (fn: () => void) => { fn(); bump(x => x + 1); };
  const tone = e ? (e.kind === 'incident' && e.tone !== 'bad' ? null : ALERT[e.kind]) : null;
  const showAlert = !!e && !!tone && (alert || (ready && (e.kind === 'weather' || (e.kind === 'incident' && e.tone === 'bad'))));
  return <div class={cx('flight', showAlert && tone === 'fail' && 'redalert')} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
    onWheel={ev => { if ((ev.target as HTMLElement).closest('.fpanel')) return; film?.zoom(ev.deltaY > 0 ? 1.08 : 0.93); }}>
    <div class="hud-labels" ref={refs.labels} aria-hidden="true" />
    <div class="hud-top">
      <div class="hud-clock"><span class="eyebrow">{t('sim.phase.' + ((filmOn && film!.info.film) || e?.phase || 'launch'))}</span>
        <b class="num" id="hud-clock" ref={refs.clock} /><small ref={refs.warp} /></div>
      <dl class="hud-tele" aria-label={t('film.tele')}>
        <div><dt>{t('film.alt')}</dt><dd class="num" ref={refs.alt} /></div><div><dt>{t('film.vel')}</dt><dd class="num" ref={refs.vel} /></div><div><dt>{t('film.dist')}</dt><dd class="num" ref={refs.dist} /></div>
      </dl>
    </div>
    {showAlert && <div class={cx('hud-alert', tone, e!.kind === 'weather' && 'blink')} role="alert" id="hud-alert"><Icon n={tone === 'ok' ? 'spark' : 'warn'} /><span><small>{t('sim.kind.' + e!.kind)}</small><b>{t(`sit.${e!.id}.t`)}</b></span></div>}
    <p class="hud-cap" ref={refs.cap as any} aria-live="polite" />
    <div class="hud-bottom">
      <ol class="phases" aria-label={t('sim.title')}>{PHASES.map((p, k) => <li class={cx(k === pi && 'on', k < pi && 'done')} aria-current={k === pi ? 'step' : undefined}>{t('sim.phase.' + p)}</li>)}</ol>
      {filmOn && events.length > 0 && <div class="hud-strip"><span class="bar"><i ref={refs.bar} /></span>
        <ol ref={refs.strip}>{events.map(x => <li class={cx(MINOR.has(x.k) && 'minor')} style={`left:${(100 * x.at) / Math.max(0.01, film!.info.dur)}%`}><span>{t('film.ev.' + x.k).split(' · ')[0]}</span></li>)}</ol></div>}
      <div class="hud-ctl">
        {filmOn && <>
          <button type="button" class="iconbtn" id="film-pause" aria-pressed={st?.paused} aria-label={st?.paused ? t('film.play') : t('film.pause')} title={st?.paused ? t('film.play') : t('film.pause')} onClick={() => set(() => film!.pause(!st?.paused))}>
            <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">{st?.paused ? <path d="M8 5v14l11-7z" fill="currentColor" /> : <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" />}</svg></button>
          <Seg id="film-speed" label={t('film.speed')} value={String(st?.speed ?? 1)} options={['1', '2', '4'].map(v => ({ v, label: v + '×' }))} onChange={v => set(() => film!.speed(Number(v)))} />
          {film!.info.film === 'launch' && <Seg id="film-view" label={t('film.view')} value={(st?.cam ?? 'auto') as string} options={['auto', 'ground', 'track', 'onboard'].map(v => ({ v, label: t('film.view.' + v) }))} onChange={v => set(() => film!.cam(v as CamId))} />}
          <button type="button" class="btn ghost" id="film-cam" aria-pressed={!st?.near} onClick={() => set(() => film!.near(!st?.near))}>{st?.near ? t('film.cam.far') : t('film.cam.near')}</button>
          {ready ? <button type="button" class="btn plain" id="film-replay" onClick={() => { sfx.tap(); set(() => film!.replay()); }}>{t('film.replay')}</button>
            : <button type="button" class="btn ghost" id="film-skip" onClick={() => { sfx.tap(); film!.skip(); }}>{t('film.skip')} ›</button>}
        </>}
        <span class="hud-hint small dim">{t('film.drag')}</span>
      </div>
    </div>
    <aside class={cx('fpanel', ready && 'in')} aria-hidden={!ready} inert={!ready as any}>
      <div class="tele">
        <div class="meter"><label>{t('sim.yield')}</label><b class="num">{fmt(lostNow ? 0 : Math.max(0, sciSoFar), 0)} <span class="small mut">{t('unit.su')}</span></b><small>{t('sim.goal', { min: Math.round(r.m.sciMin), full: Math.round(r.m.sciFull) })}</small></div>
        <div class="meter"><label>{t('sim.days')}</label><b class="num">{fmt(r.m.opsDays, 0)}</b><small>{t('sim.daysd', { n: Math.round(r.m.opsDays) })}</small></div>
        {(r.m.dvNeed > 0 || r.m.dvAvail > 0) && <div class="meter"><label>{t('sim.dvleft')}</label><b class="num">{fmt(Math.max(0, r.m.dvAvail - r.m.dvNeed) * 1000, 0)} <span class="small mut">m/s</span></b><small>{lostNow ? t('sim.lost') : ' '}</small></div>}
      </div>
      <div class="feed" aria-live="polite">
        {e && ready && <EntryCard key={e.id + (e.v ?? '')} e={e} d={d} live last={last} />}
        {seen.length > 1 && <details class="more flog"><summary>{t('film.log', { n: seen.length - 1 })}</summary>
          <div class="feed">{seen.slice(0, -1).reverse().map(x => <EntryCard key={x.id} e={x} d={d} live={false} last={false} />)}</div></details>}
      </div>
    </aside>
  </div>;
}

// ---------------- Mission result ----------------
// Three questions, in plain words: how did it go (verdict + one sentence), where did the science come from (waterfall),
// and was it a good design for the money (comparison with other spacecraft). Then: what if you changed one thing.
interface Row { id: string; label: string; from: number; to: number; kind: 'base' | 'gain' | 'loss' | 'final'; e?: Entry }
function rowsOf(r: Result): Row[] {
  const base = r.m.sciRate * r.m.opsDays; let run = base;
  const rows: Row[] = [{ id: 'plan', label: t('rp.wf.plan'), from: 0, to: base, kind: 'base' }];
  for (const e of r.timeline) {
    if (!e.v || (Math.abs(e.delta) < 0.5 && e.tone !== 'bad')) continue;
    rows.push({ id: e.id, label: t(`sit.${e.id}.t`), from: run, to: run + e.delta, kind: e.delta > 0.5 ? 'gain' : 'loss', e }); run += e.delta;
  }
  rows.push({ id: 'final', label: t('rp.wf.final'), from: 0, to: r.science, kind: 'final' });
  return rows;
}
function Waterfall({ r, rows, sel, onSel }: { r: Result; rows: Row[]; sel: string | null; onSel: (id: string) => void }) {
  const max = Math.max(r.m.sciFull, ...rows.map(x => Math.max(x.from, x.to))) * 1.06;
  const pct = (v: number) => (Math.max(0, v) / max) * 100;
  const goals = <><i class="g min" style={`left:${pct(r.m.sciMin)}%`} /><i class="g full" style={`left:${pct(r.m.sciFull)}%`} /></>;
  const label = (k: 'min' | 'full', v: number) => <em class={k} style={`left:${pct(v)}%`}>{t('con.' + k)} · {fmt(v, 0)}</em>;
  return <div class="wf">
    <div class="wf-row edge" aria-hidden="true"><span class="wf-track">{goals}{label('min', r.m.sciMin)}</span></div>
    {rows.map(x => {
      const lo = Math.min(x.from, x.to), hi = Math.max(x.from, x.to), d = x.to - x.from;
      const val = x.kind === 'gain' ? '+' + fmt(d, 0) : x.kind === 'loss' ? (Math.abs(d) < 0.5 ? '0' : '−' + fmt(-d, 0)) : fmt(x.to, 0);
      const inner = <><span class="wf-l">{x.label}</span><span class="wf-v num">{val}</span><span class="wf-track">{goals}<span class="wf-bar" style={`left:${pct(lo)}%;width:${pct(hi) - pct(lo)}%`} /></span></>;
      return x.e ? <button type="button" class={cx('wf-row', x.kind, sel === x.id && 'on')} data-row={x.id} aria-pressed={sel === x.id} onClick={() => { sfx.tap(); onSel(x.id); }}>{inner}</button>
        : <div class={cx('wf-row', x.kind)} data-row={x.id}>{inner}</div>;
    })}
    <div class="wf-row edge" aria-hidden="true"><span class="wf-track">{goals}{label('full', r.m.sciFull)}</span></div>
  </div>;
}
function Detail({ e, r, d, onTry }: { e: Entry | null; r: Result; d: Design; onTry: (p: Patch) => void }) {
  if (!e) return <p class="small dim">{t('rp.wf.pick')}</p>;
  const c = e.cause ? r.m.checks.find(x => x.id === e.cause) : null;
  return <div class={cx('wf-detail soft', e.delta > 0.5 ? 'gain' : 'loss')} id="wf-detail" aria-live="polite">
    <p class="row" style="gap:8px"><b>{t(`sit.${e.id}.t`)}</b><span class="small dim">{t('sim.phase.' + e.phase)}</span></p>
    <p class="mut">{t(`sit.${e.id}.r.${e.v}`, sitVars(d, e))}</p>
    {e.delta > 0.5 && !c && <p class="small up">{t('rp.good')}</p>}
    {c && <p class="small"><span class="k">{t('rp.why')}</span>{checkText(c)}</p>}
    {e.patch && <div class="fixrow"><p class="small"><span class="k">{t('rp.fix')}</span>{patchLabel(d, e.patch)}</p><Btn kind="ghost" onClick={() => onTry(e.patch!)}>{t('rp.try')}</Btn></div>}
  </div>;
}

/** Axis ticks at 1, 2, 2.5 or 5 × 10^k. */
function ticks(max: number, n: number) {
  const raw = max / n, p = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(k => k * p).find(s => s >= raw) ?? raw;
  const out: number[] = []; for (let v = 0; v <= max + 1e-9; v += step) out.push(v); return { out, top: out[out.length - 1] < max ? out[out.length - 1] + step : out[out.length - 1] };
}
function Compare({ p, you, m }: { p: Pareto; you: { cost: number; sci: number }; m: Result['m'] }) {
  const box = useRef<HTMLDivElement>(null); const [w, setW] = useState(480); const [tip, setTip] = useState<{ x: number; y: number; c: number; s: number; me?: boolean } | null>(null);
  useEffect(() => { const el = box.current; if (!el) return; const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth)))); ro.observe(el); return () => ro.disconnect(); }, []);
  const narrow = w < 420, H = narrow ? 230 : 280, L = 40, R = 12, T = 12, B = 30;
  const xs = ticks(Math.max(m.budget, you.cost, ...p.points.map(x => x.cost)) * 1.02, narrow ? 4 : 6), ys = ticks(Math.max(m.sciFull, you.sci, ...p.points.map(x => x.sci)) * 1.04, 4);
  const X = (c: number) => L + (c / xs.top) * (w - L - R), Y = (s: number) => H - B - (s / ys.top) * (H - B - T);
  const isBetter = (q: { cost: number; sci: number }) => q.cost <= you.cost + 1e-9 && q.sci > you.sci * 1.005 + 0.5;
  const pts = [...p.points].sort((a, b) => Number(isBetter(a)) - Number(isBetter(b)));
  const move = (e: PointerEvent) => {
    const r = (e.currentTarget as SVGElement).getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let best: typeof tip = null, bd = 22 * 22;
    for (const q of [...p.points, { ...you, me: true }]) { const dx = X(q.cost) - mx, dy = Y(q.sci) - my, dd = dx * dx + dy * dy; if (dd < bd || ('me' in q && dd < 30 * 30)) { bd = dd; best = { x: X(q.cost), y: Y(q.sci), c: q.cost, s: q.sci, me: 'me' in q }; } }
    setTip(best);
  };
  const k = (v: number) => (v >= 1000 ? fmt(v / 1000, 1) + 'k' : fmt(v, 0));
  return <div class="cmp" ref={box}>
    <svg class="chart" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label={t('rp.pareto')} onPointerMove={move} onPointerLeave={() => setTip(null)}>
      {X(m.budget) < w - R && <rect x={X(m.budget)} y={T} width={w - R - X(m.budget)} height={H - B - T} class="over" />}
      {ys.out.map(v => <g><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} class="grid" /><text x={L - 6} y={Y(v) + 4} text-anchor="end">{k(v)}</text></g>)}
      {xs.out.map(v => <text x={X(v)} y={H - B + 16} text-anchor={v === 0 ? 'start' : 'middle'}>{fmt(v, 0)}</text>)}
      <text x={w - R} y={H - 2} text-anchor="end" class="ax">{t('rp.ax.cost')}</text>
      {([['min', m.sciMin], ['full', m.sciFull]] as const).map(([g, v]) => <g><line x1={L} x2={w - R} y1={Y(v)} y2={Y(v)} class={'goal ' + g} /><text x={L + 6} y={Y(v) - 5} class={'gl ' + g}>{t('con.' + g)}</text></g>)}
      <line x1={X(m.budget)} x2={X(m.budget)} y1={T} y2={H - B} class="budget" /><text x={X(m.budget) - 5} y={T + 11} text-anchor="end" class="gl">{t('rp.budget')}</text>
      {pts.map(q => <circle cx={X(q.cost)} cy={Y(q.sci)} r={isBetter(q) ? 4.5 : 3.5} class={isBetter(q) ? 'pt better' : 'pt'} />)}
      <circle cx={X(you.cost)} cy={Y(you.sci)} r="8" class="me" />
      <text x={X(you.cost) + (X(you.cost) > w - 70 ? -13 : 13)} y={Y(you.sci) + 5} text-anchor={X(you.cost) > w - 70 ? 'end' : 'start'} class="melabel">{t('rp.you')}</text>
      {tip && <circle cx={tip.x} cy={tip.y} r={tip.me ? 12 : 7} class="hover" />}
    </svg>
    {tip && <div class="ctip" style={`left:${Math.min(w - 150, Math.max(0, tip.x - 70))}px;top:${Math.max(0, tip.y - 44)}px`}><b>{tip.me ? t('rp.lg.you') : ''}</b> {t('rp.tip', { cost: fmt(tip.c), sci: fmt(tip.s, 0) })}</div>}
    <p class="ax-y small dim">{t('rp.ax.sci')}</p>
  </div>;
}

const FIELDS: Field[] = ['bus', 'power', 'battery', 'prop', 'antenna', 'launcher', 'orbit', 'redund', 'shield', 'thermal', 'avionics', 'band', 'ground'];
export function Report() {
  const g = app.g, d = g.design, opts = simOpts(), host = app.mode === 'solo' || isHost();
  const r = useMemo(() => complete(d, g.picks, opts), [g.v]);
  const rows = useMemo(() => rowsOf(r), [r]);
  const worst = rows.filter(x => x.e).sort((a, b) => (a.to - a.from) - (b.to - b.from))[0];
  const [sel, setSel] = useState<string | null>(worst ? worst.id : null);
  const [par, setPar] = useState<Pareto | null>(null); const [patch, setPatch] = useState<Patch | null>(null); const [field, setField] = useState<Field | ''>(''); const [newly, setNewly] = useState(false);
  useEffect(() => { if (app.mode === 'solo') setNewly(recordResult(r)); (r.verdict === 'fail' ? sfx.bad : sfx.good)();
    const id = setTimeout(() => setPar(pareto(d, { crew: opts.crew }, 500)), 60); return () => clearTimeout(id); }, []);
  const eff = par ? Math.min(100, (r.science / Math.max(frontierAt(par, r.cost), r.science, 1)) * 100) : null;
  const better = par ? par.points.filter(q => q.cost <= r.cost + 1e-9 && q.sci > r.science * 1.005 + 0.5).length : 0;
  const suggestions = useMemo(() => { const seen = new Set<string>(), out: Patch[] = [];
    for (const x of [...rows].filter(x => x.e?.patch).sort((a, b) => (a.to - a.from) - (b.to - b.from))) { const k = JSON.stringify(x.e!.patch); if (!seen.has(k)) { seen.add(k); out.push(x.e!.patch!); } }
    return out.slice(0, 3); }, [rows]);
  const alt = useMemo(() => { if (!patch) return null; const nd = { ...d, ...patch } as Design; return { d: nd, r: complete(nd, g.picks, opts) }; }, [patch, g.v]);
  const tryPatch = (p: Patch) => { setPatch(p); setField(''); sfx.select(); setTimeout(() => document.getElementById('rerun')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50); };
  const share = () => { const tx = t('rp.sharetext', { mission: t(`mis.${d.mission}.name`), diff: t('diff.' + d.difficulty), verdict: t('rp.' + r.verdict), sci: Math.round(r.science), cost: r.cost, eff: eff === null ? '–' : Math.round(eff) });
    (navigator.clipboard?.writeText(tx) ?? Promise.reject()).then(() => toast(t('st.copied')), () => toast(tx)); };
  const cmp = (a: number, b: number, lowerBetter = false) => (Math.abs(b - a) < 0.05 ? '' : (b > a) !== lowerBetter ? 'up' : 'down');
  const days = (x: Result) => (x.lost ? 0 : x.days), rank = (v: string) => ['fail', 'min', 'full'].indexOf(v);
  const selRow = rows.find(x => x.id === sel)?.e ?? null;
  return <div class="wrap col enter report">
    <div class={cx('verdict', r.verdict)}>
      <p class="eyebrow">{t('rp.title')} · {t(`mis.${d.mission}.name`)} · {t('diff.' + d.difficulty)}</p>
      <h1 class="h-xl" id="verdict" data-verdict={r.verdict}>{t('rp.' + r.verdict)}</h1>
      <p class="lead">{r.lost ? t('rp.say.lost') : t('rp.say.' + r.verdict, { sci: Math.round(r.science), min: Math.round(r.m.sciMin), full: Math.round(r.m.sciFull) })} {r.overBudget ? t('rp.overbudget') : ''} {g.forced ? t('rp.forced') : ''}</p>
      {newly && <div><Chip tone="ok">{t('rp.unlocked')}</Chip></div>}
    </div>
    <div class="meters rpstats">
      <div class="meter"><label>{t('rp.sci')}</label><b id="rp-sci" class="num">{fmt(r.science, 0)} <span class="small mut">{t('unit.su')}</span></b><small>{t('rp.sci.sub', { min: Math.round(r.m.sciMin), full: Math.round(r.m.sciFull) })}</small>
        <div class={cx('bar', r.verdict === 'fail' ? 'fail' : r.verdict === 'min' ? 'warn' : 'ok')}><div style={`width:${Math.min(100, (r.science / r.m.sciFull) * 100)}%`} /></div></div>
      <div class="meter"><label>{t('rp.cost')}</label><b class="num">{t('rp.money', { n: fmt(r.cost) })}</b><small>{t('rp.cost.sub', { n: Math.round(r.m.budget) })}</small>
        <div class={cx('bar', r.overBudget ? 'fail' : 'ok')}><div style={`width:${Math.min(100, (r.cost / r.m.budget) * 100)}%`} /></div></div>
      <div class="meter"><label>{t('rp.days')}</label><b class="num">{fmt(days(r), 0)}</b><small>{t('sim.daysd', { n: Math.round(r.m.opsDays) })}</small>
        <div class={cx('bar', r.lost ? 'fail' : 'ok')}><div style={`width:${Math.min(100, (days(r) / Math.max(1, r.m.opsDays)) * 100)}%`} /></div></div>
    </div>
    <div class="rpgrid">
      <div class="col">
        <section class="panel col" aria-labelledby="wf-t">
          <div><h2 class="h-m" id="wf-t">{t('rp.wf.t')}</h2><p class="small mut">{t('rp.wf.d')}</p></div>
          <Waterfall r={r} rows={rows} sel={sel} onSel={id => setSel(id === sel ? null : id)} />
          {rows.length > 2 ? <Detail e={selRow} r={r} d={d} onTry={tryPatch} /> : <p class="small mut">{t('rp.wf.none')}</p>}
        </section>
        <section class="panel col" id="rerun" aria-labelledby="rr-t">
          <div><h2 class="h-m" id="rr-t">{t('rp.rerun')}</h2><p class="small mut">{t('rp.rerund')}</p></div>
          {suggestions.length > 0 && <div class="col" style="gap:8px"><p class="small dim">{t('rp.sugg')}</p>
            <div class="row" style="gap:8px">{suggestions.map((s, i) => { const on = !!patch && JSON.stringify(patch) === JSON.stringify(s);
              return <button type="button" id={'sugg-' + i} class={cx('sugg', on && 'on')} aria-pressed={on} onClick={() => { setField(''); setPatch(on ? null : s); sfx.select(); }}>{patchLabel(d, s)}</button>; })}</div></div>}
          <div class="col" style="gap:8px">{suggestions.length > 0 && <p class="small dim">{t('rp.own')}</p>}
            <div class="row" style="gap:8px">
              <select id="rerun-field" aria-label={t('rp.field')} value={field} onChange={e => { setField((e.target as HTMLSelectElement).value as Field); setPatch(null); }}>
                <option value="">{t('rp.field')}</option>{FIELDS.map(f => <option value={f}>{t('f.' + f)}</option>)}</select>
              {field && <select id="rerun-value" aria-label={t('rp.value')} value={(patch?.[field] as string) ?? ''} onChange={e => { const v = (e.target as HTMLSelectElement).value; setPatch(v ? ({ [field]: v } as Patch) : null); }}>
                <option value="">{t('rp.value')}</option>{(optionsFor(d, field) as string[]).filter(v => v !== d[field]).map(v => <option value={v}>{optLabel(d, field, v)}</option>)}</select>}
            </div></div>
          {alt ? <div class="col" style="gap:10px">
            <table class="diff"><caption class="small">{patchLabel(d, patch!)}</caption>
              <thead><tr><th /><th>{t('rp.before')}</th><th>{t('rp.after')}</th></tr></thead><tbody>
              <tr><td>{t('rp.verdict')}</td><td>{t('rp.' + r.verdict)}</td><td id="alt-verdict" class={cmp(rank(r.verdict), rank(alt.r.verdict))}>{t('rp.' + alt.r.verdict)}</td></tr>
              <tr><td>{t('rp.sci')}</td><td>{fmt(r.science, 0)}</td><td class={cmp(r.science, alt.r.science)}>{fmt(alt.r.science, 0)}</td></tr>
              <tr><td>{t('rp.cost')}</td><td>{t('rp.money', { n: fmt(r.cost) })}</td><td class={cmp(r.cost, alt.r.cost, true)}>{t('rp.money', { n: fmt(alt.r.cost) })}</td></tr>
              <tr><td>{t('rp.days')}</td><td>{fmt(days(r), 0)}</td><td class={cmp(days(r), days(alt.r))}>{fmt(days(alt.r), 0)}</td></tr>
            </tbody></table>
            {host && <div><Btn id="adopt" onClick={() => act({ t: 'adopt', design: alt.d })}>{t('rp.adopt')}</Btn></div>}
          </div> : <p class="small dim">{t('rp.nochange')}</p>}
        </section>
      </div>
      <section class="panel col" aria-labelledby="cmp-t" data-computing={par ? undefined : ''}>
        <div class="row" style="align-items:flex-start;flex-wrap:nowrap"><div style="flex:1;min-width:0"><h2 class="h-m" id="cmp-t">{t('rp.pareto')}</h2>
          <p class="small mut">{par ? t('rp.paretod', { n: par.points.length }) : t('rp.computing')}</p></div>
          <div class="effbox"><span class="small dim">{t('rp.eff')}</span><b id="rp-eff" class="num">{eff === null ? '…' : fmt(eff, 0) + '%'}</b></div></div>
        {par && <>
          <ul class="legend">
            <li><span class="sw me" />{t('rp.lg.you')}</li>
            {better > 0 && <li><span class="sw better" />{t('rp.lg.better')}</li>}
            <li><span class="sw pt" />{t('rp.lg.other')}</li>
          </ul>
          <Compare p={par} you={{ cost: r.cost, sci: r.science }} m={r.m} />
          <p class="insight">{better === 0 ? t('rp.better0') : better === 1 ? t('rp.better1') : t('rp.betterN', { n: better })} {eff !== null && t('rp.effd', { pct: Math.round(eff) })}</p>
        </>}
      </section>
    </div>
    <div class="row rpactions">
      {host && <Btn big id="again" onClick={() => act({ t: 'nav', screen: 'studio' })}>{t('rp.again')}</Btn>}
      {host && <Btn kind="ghost" id="new-mission" onClick={() => act({ t: 'nav', screen: 'missions' })}>{t('rp.new')}</Btn>}
      <Btn kind="plain" id="share-result" onClick={share}>{t('rp.shareres')}</Btn>
    </div>
  </div>;
}
