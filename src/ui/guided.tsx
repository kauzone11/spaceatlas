// Guided build: one question per screen, each answer explained with the numbers it changed.
// The 3D viewport beside it can be explored: labels on every part, tap for a plain explanation, "separate parts" for an exploded view.
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, fmt } from '../i18n';
import { Design, Field, FIELD_ROLE, MISSION, INST, BUS } from '../engine/catalog';
import { evaluate, Metrics, optionsFor, instrumentWorks, findFix, solarFlux, lightTimeS, AUTO_FIELDS } from '../engine/engine';
import { GUIDED, Step, answer, suggest, stepOfPart } from '../engine/guided';
import { app, act, canEdit, derived, crewPerks, isHost, notify, toast } from './store';
import { Btn, Icon, Seg, Why, cx, checkText, optLabel, objKeyOf, eonetTargets, neoTarget, roleOwnerName, patchLabel } from './common';
import { Meter } from './meters';
import { encodeDesign } from '../engine/codec';
import { sfx } from './audio';
import type { Scene3D } from './scene';

const SRC: Partial<Record<Field, string>> = { bus: 'esa', power: 'rps', battery: 'smad', prop: 'smad', instruments: 'smad', launcher: 'smad', orbit: 'odmsp', antenna: 'dsn' };
const N = GUIDED.length;
let view: 'craft' | 'rocket' | null = null, exploded = false, picked: string | null = null;
/** What the 3D viewport shows while the guided build is open. */
export function guidedView(): 'craft' | 'rocket' { const s = GUIDED[app.step]; return view ?? (s?.view === 'rocket' ? 'rocket' : 'craft'); }
const fmtDelay = (s: number) => (s < 60 ? `${fmt(s)} s` : `${fmt(s / 60)} min`);

/** Apply a guided answer: the choice plus the automatic secondary decisions, limited to the stations this player may edit. */
function choose(f: Field, v: unknown) {
  const d = app.g.design, n = answer(d, f, v, { crew: crewPerks() }), patch: Partial<Design> = {};
  for (const k of Object.keys(n) as (keyof Design)[]) if (JSON.stringify(n[k]) !== JSON.stringify(d[k]) && k in FIELD_ROLE && canEdit(FIELD_ROLE[k as Field])) (patch as Record<string, unknown>)[k] = n[k];
  if (Object.keys(patch).length) act({ t: 'patch', patch });
}
const preview = new Map<string, Metrics>();
function previewOf(d: Design, f: Field, v: unknown): Metrics {
  const k = JSON.stringify([d, f, v, crewPerks()]); let m = preview.get(k);
  if (!m) { if (preview.size > 300) preview.clear(); m = evaluate(answer(d, f, v, { crew: crewPerks() }), { crew: crewPerks() }); preview.set(k, m); }
  return m;
}
/** Browser Back inside the guided build: close the part card, else the previous question. False on the first question. */
export function guidedBack(): boolean {
  if (picked) { picked = null; notify(); return true; }
  if (app.step > 0) { go(app.step - 1); return true; }
  return false;
}
const go = (i: number) => { app.step = Math.max(0, Math.min(N, i)); view = null; picked = null; exploded = false; notify(); document.querySelector('main.screen')?.scrollTo({ top: 0, behavior: 'smooth' }); };

function context(s: Step, d: Design, m: Metrics): string {
  const def = MISSION[d.mission];
  switch (s.id) {
    case 'objective': { const target = d.mission === 'leo' ? eonetTargets(d).main.title : d.mission === 'neo' ? neoTarget().des : t(`mis.${d.mission}.dest`, { target: neoTarget().des });
      return t('gd.objective.ctx', { target, min: Math.round(m.sciMin), full: Math.round(m.sciFull) }); }
    case 'ambition': return t('gd.ambition.ctx', { team: def.teamCost, budget: Math.round(m.budget) });
    case 'instruments': return t('gd.instruments.ctx', { obj: t(objKeyOf(d.mission, d.objective)), cap: BUS[d.bus].payload });
    case 'orbit': return t('gd.orbit.ctx.' + d.mission);
    case 'bus': return t('gd.bus.ctx', { pay: Math.round(m.payloadMass) });
    case 'power': return t('gd.power.ctx', { flux: Math.round(solarFlux(def.sunAu)), pct: Math.round(100 / (def.sunAu * def.sunAu)), load: Math.round(m.load) });
    case 'battery': return m.orbit.nightH > 0 ? t('gd.battery.ctx', { hours: m.orbit.nightH, need: Math.round(m.nightNeed) }) : t('gd.battery.ctx0');
    case 'prop': return m.dvNeed > 0 ? t('gd.prop.ctx', { dv: Math.round(m.dvNeed * 1000) }) : t('gd.prop.ctx0');
    case 'antenna': return t('gd.antenna.ctx', { delay: fmtDelay(lightTimeS(def.earthAu)), gen: fmt(m.dataGen) });
    case 'launcher': return t('gd.launcher.ctx', { mass: Math.round(m.launchMass), dest: t('gd.dest.' + def.dest) });
  }
  return '';
}
function optionText(d: Design, f: Field, v: string, m: Metrics): string {
  const def = MISSION[d.mission];
  if (f === 'objective') return t(objKeyOf(d.mission, v) + '.d');
  if (f === 'ambition') return t('con.ambd', { days: def.days[Number(v)] });
  if (f === 'orbit') return t('optd.orbit.' + v);
  if (f === 'power') return v === 'rtg' ? t('optd.power.rtg') : t('gd.opt.power', { w: Math.round(m.gen) });
  if (f === 'battery') return t('gd.opt.battery', { wh: Math.round(m.battUsable) });
  if (f === 'launcher') return m.cap > 0 ? t('optd.launcher', { cap: Math.round(m.cap) }) : t('optd.launcher.none');
  if (f === 'antenna') return t('gd.opt.antenna', { gb: fmt(m.dataDown) });
  if (f === 'prop') return v === 'none' ? t('optd.prop.none') : t('gd.opt.prop', { dv: Math.round(m.dvAvail * 1000) });
  return t(`optd.${f}.${v}`);
}
const delta = (a: number, b: number, unit: string, digits = 1) => { const x = a - b; return Math.abs(x) < 10 ** -digits ? null : `${x > 0 ? '+' : '−'}${unit === '$' ? '$' + fmt(Math.abs(x), digits) + 'M' : fmt(Math.abs(x), digits) + ' ' + unit}`; };

function Options({ s, d, m, edit }: { s: Step; d: Design; m: Metrics; edit: boolean }) {
  if (s.field === 'instruments') return <div class="qopts">{(optionsFor(d, 'instruments') as string[]).map(id => {
    const i = INST[id], on = d.instruments.includes(id), works = instrumentWorks(id, d, m.orbit), rel = i.rel[d.objective] ?? 0;
    return <button type="button" id={'inst-' + id} class={cx('qopt', on && 'on', !works && 'off')} aria-pressed={on} disabled={!edit}
      onClick={() => { sfx.tap(); choose('instruments', on ? d.instruments.filter(x => x !== id) : [...d.instruments, id]); }}>
      <span class="box" aria-hidden="true">{on && <Icon n="ok" />}</span>
      <b>{t('inst.' + id)}</b><span>{works ? t('instd.' + id) : t('inst.inactive')}</span>
      <span class="fit"><span class="small dim">{t('gd.fit')}</span><span class="relbar"><span style={`width:${Math.min(100, (rel / 2.2) * 100)}%`} /></span></span>
      <i>{fmt(i.mass, 0)} kg · {fmt(i.power, 0)} W · ${fmt(i.cost)}M</i>
    </button>; })}</div>;
  return <div class="qopts" role="radiogroup" aria-label={t('gd.' + s.id + '.q')}>{(optionsFor(d, s.field) as (string | number)[]).map(v0 => {
    const v = String(v0), on = String(d[s.field]) === v, alt = on ? m : previewOf(d, s.field, s.field === 'ambition' ? Number(v) : v);
    const pills = on ? [] : [delta(alt.cost, m.cost, '$'), delta(alt.launchMass, m.launchMass, 'kg', 0)].filter(Boolean);
    return <button type="button" role="radio" aria-checked={on} id={`${s.field === 'objective' ? 'obj' : s.field === 'ambition' ? 'amb' : 'opt-' + s.field}-${v}`}
      class={cx('qopt', on && 'on')} disabled={!edit} onClick={() => { if (!on) { sfx.tap(); choose(s.field, s.field === 'ambition' ? Number(v) : v); } }}>
      <span class="box round" aria-hidden="true">{on && <Icon n="ok" />}</span>
      <b>{optLabel(d, s.field, s.field === 'ambition' ? Number(v) : v)}</b><span>{optionText(d, s.field, v, alt)}</span>
      {pills.length > 0 && <i>{pills.join(' · ')}</i>}
    </button>; })}</div>;
}

function Feedback({ s, d, m, edit }: { s: Step; d: Design; m: Metrics; edit: boolean }) {
  if (s.id === 'objective') return null;
  const cs = m.checks.filter(c => s.checks.includes(c.id)), worst = cs.some(c => c.status === 'fail') ? 'fail' : cs.some(c => c.status === 'warn') ? 'warn' : 'ok';
  const tip = worst === 'fail' && edit ? suggest(d, s, { crew: crewPerks() }) : null;
  const empty = s.id === 'instruments' && d.instruments.length === 0;
  return <div class={cx('feedback', empty ? 'idle' : worst)} aria-live="polite" id="feedback">
    <p class="head"><Icon n={empty ? 'info' : worst} /> <b>{empty ? t('gd.fb.pick') : t('gd.fb.' + worst)}</b></p>
    {!empty && cs.map(c => <p class="line"><span class={cx('dot', c.status)} aria-hidden="true" /><span><b>{t(`chk.${c.id}.t`)}.</b> {checkText(c)}</span></p>)}
    {tip && <div class="tip"><span>{t('gd.tip', { opt: optLabel(d, s.field, tip) })}</span><Btn kind="ghost" id="try-tip" onClick={() => choose(s.field, tip)}>{t('gd.tip.apply')}</Btn></div>}
  </div>;
}

/** Put the design code in the address and copy the link, so the same spacecraft can be reopened or sent to someone. */
function shareDesign(d: Design) {
  const code = encodeDesign(d); try { history.replaceState(history.state, '', '#' + code); } catch { /* address not writable (sandboxed frame) */ }
  const url = (() => { try { return location.href.split('#')[0] + '#' + code; } catch { return code; } })();
  (navigator.clipboard?.writeText(url) ?? Promise.reject()).then(() => toast(t('st.copied')), () => toast(t('st.copyfail', { code })));
}
function Summary({ d, m }: { d: Design; m: Metrics }) {
  const fails = m.checks.filter(c => c.status === 'fail'), warns = m.checks.filter(c => c.status === 'warn'), host = app.mode === 'solo' || isHost();
  const stepOf = (id: string) => GUIDED.findIndex(s => (s.checks as string[]).includes(id));
  return <div class="col" style="gap:14px">
    <div><h1 class="h-l q">{fails.length ? t('gd.sum.fail', { n: fails.length }) : t('gd.sum.ok')}</h1><p class="lead">{fails.length ? t('gd.sum.faild') : t('gd.sum.okd')}</p></div>
    {fails.length > 0 && <div class="col" style="gap:8px">{fails.map(c => { const i = stepOf(c.id), fix = findFix(d, c.id, { crew: crewPerks() });
      return <div class="feedback fail" data-check={c.id}><p class="head"><Icon n="fail" /> <b>{t(`chk.${c.id}.t`)}</b></p><p class="line"><span>{checkText(c)}</span></p>
        <div class="row" style="gap:8px">{i >= 0 && <Btn kind="ghost" onClick={() => go(i)}>{t('gd.sum.goto', { q: t('gd.' + GUIDED[i].id + '.short') })}</Btn>}
          {fix && <Btn kind="plain" onClick={() => { choose(Object.keys(fix)[0] as Field, Object.values(fix)[0]); toast(patchLabel(d, fix)); }}>{t('gd.sum.help')}</Btn>}</div></div>; })}</div>}
    {warns.length > 0 && <details class="more"><summary>{t('st.warns', { n: warns.length })}</summary>{warns.map(c => <p class="small mut"><b>{t(`chk.${c.id}.t`)}.</b> {checkText(c)}</p>)}</details>}
    <div class="recap">{GUIDED.map((s, i) => <button type="button" class="recap-row" onClick={() => go(i)}><span class="dim">{t('gd.' + s.id + '.short')}</span><b>{optLabel(d, s.field, d[s.field])}</b></button>)}</div>
    <details class="more"><summary>{t('gd.sum.auto')}</summary><p class="small mut">{t('gd.sum.autod')}</p>
      <div class="recap">{AUTO_FIELDS.map(f => <div class="recap-row"><span class="dim">{t('f.' + f)}</span><b>{optLabel(d, f, d[f])}</b></div>)}</div></details>
    <div><Btn kind="plain" id="share" onClick={() => shareDesign(d)}>{t('st.share')}</Btn></div>
    <div class="row qfoot"><span class="sp" />
      {host ? <Btn big id="to-review" sound="select" onClick={() => act({ t: 'nav', screen: 'review' })}>{t('st.review')}</Btn> : <span class="mut small">{t('lobby.wait')}</span>}</div>
  </div>;
}

/** True on phone-width layouts (single column). */
function useNarrow() {
  const q = () => typeof matchMedia === 'function' && matchMedia('(max-width: 900px)').matches;
  const [n, setN] = useState(q()); useEffect(() => { const on = () => setN(q()); addEventListener('resize', on); return () => removeEventListener('resize', on); }, []); return n;
}
/** Part labels drawn over the WebGL canvas; positions update every frame without re-rendering. */
function Labels({ scene, area, sel, only, onPick }: { scene: Scene3D | null; area: { current: HTMLDivElement | null }; sel: string | null; only: string[] | null; onPick: (c: string) => void }) {
  const [cats, setCats] = useState<string[]>([]); const refs = useRef<Record<string, HTMLButtonElement | null>>({}), box = useRef<HTMLDivElement>(null);
  useEffect(() => { let id = 0; const loop = () => {
    const ls = scene?.labels() ?? [], key = ls.map(l => l.cat).join();
    if (key !== cats.join()) setCats(ls.map(l => l.cat));
    const r = area.current?.getBoundingClientRect(), placed: { x: number; y: number }[] = [];
    const o = box.current?.getBoundingClientRect() ?? { left: 0, top: 0 }; // the layer may sit inside a transformed ancestor
    const top = area.current?.querySelector('.vtop')?.getBoundingClientRect(), info = area.current?.querySelector('.pinfo')?.getBoundingClientRect();
    for (const l of [...ls].sort((a, b) => a.y - b.y)) { const el = refs.current[l.cat]; if (!el || !r) continue;
      if (only && !only.includes(l.cat)) { el.style.visibility = 'hidden'; continue; }
      let y = l.y; for (const q of placed) if (Math.abs(q.x - l.x) < 150 && y < q.y + 26) y = q.y + 26; placed.push({ x: l.x, y });
      const hit = (b?: DOMRect) => !!b && l.x + 150 > b.left && l.x < b.right && y + 14 > b.top && y - 14 < b.bottom;
      const inside = l.x > r.left + 8 && l.x < r.right - 8 && y > r.top + 20 && y < r.bottom - 8 && !hit(top) && !hit(info);
      el.style.transform = `translate(${Math.round(l.x - o.left)}px, ${Math.round(y - o.top)}px) translateY(-50%)`; el.style.setProperty('--dy', `${Math.round(y - l.y)}px`); el.style.visibility = inside ? 'visible' : 'hidden'; }
    id = requestAnimationFrame(loop); }; id = requestAnimationFrame(loop); return () => cancelAnimationFrame(id); }, [scene, cats.join(), only?.join()]);
  return <div class="labels" ref={box} aria-label={t('gd.x.parts')}>{cats.map(c => <button type="button" ref={el => { refs.current[c] = el; }} class={cx('plabel', sel === c && 'on')} data-part={c}
    onClick={() => { sfx.tap(); onPick(c); }}><span>{t('part.' + c + '.n')}</span></button>)}</div>;
}

function yours(cat: string, d: Design, m: Metrics): string {
  const f: Partial<Record<string, Field>> = { bus: 'bus', power: 'power', battery: 'battery', thermal: 'thermal', prop: 'prop', avionics: 'avionics', antenna: 'antenna', inst: 'instruments', legs: 'orbit' };
  if (f[cat]) return optLabel(d, f[cat]!, d[f[cat]!]);
  if (cat === 'payload') return `${fmt(m.launchMass, 0)} kg`;
  return t('opt.launcher.' + d.launcher);
}

export function Guided({ scene }: { scene: Scene3D | null }) {
  const g = app.g, d = g.design, { m } = derived(), i = Math.min(app.step, N), s = GUIDED[i] as Step | undefined;
  const edit = s ? canEdit(FIELD_ROLE[s.field]) : true, area = useRef<HTMLDivElement>(null);
  const [, force] = useState(0); const refresh = () => force(n => n + 1);
  const [drag, setDrag] = useState<{ x: number; y: number; moved: number } | null>(null);
  const sel = picked;
  useEffect(() => { scene?.explode(exploded); scene?.focus(sel ?? s?.part ?? null); });
  useEffect(() => () => { scene?.explode(false); scene?.focus(null); }, []);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && picked) { picked = null; refresh(); } }; addEventListener('keydown', k); return () => removeEventListener('keydown', k); }, []);
  const pick = (c: string | null) => { picked = c; refresh(); };
  const v = guidedView(), narrow = useNarrow();
  const meters = <div class="meters four">
    <Meter k={d.mission} label={t('st.cost')} value={m.cost} unit="$M" frac={m.cost / m.budget} status={m.cost > m.budget ? 'fail' : m.cost > m.budget * 0.95 ? 'warn' : 'ok'} sub={`${t('st.of')} ${fmt(m.budget, 0)}`} />
    <Meter k={d.mission} label={t('gd.m.mass')} value={m.launchMass} unit="kg" frac={m.cap ? m.launchMass / m.cap : 1} status={m.cap === 0 || m.massMargin < 0 ? 'fail' : m.massMargin < m.margin ? 'warn' : 'ok'} sub={m.cap ? `${t('st.of')} ${fmt(m.cap, 0)} kg` : t('optd.launcher.none')} digits={0} />
    <Meter k={d.mission} label={t('gd.m.power')} value={m.load} unit="W" frac={m.gen ? m.load / m.gen : 1} status={m.powerMargin < 0 ? 'fail' : m.powerMargin < m.margin ? 'warn' : 'ok'} sub={`${t('gd.m.gen')} ${fmt(m.gen, 0)} W`} digits={0} />
    <Meter k={d.mission} label={t('st.sci')} value={m.sciPred} unit={t('unit.su')} frac={m.sciPred / m.sciFull} status={m.sciPred < m.sciMin ? 'fail' : m.sciPred < m.sciFull ? 'warn' : 'ok'} sub={`${t('gd.m.min')} ${fmt(m.sciMin, 0)}`} digits={0} />
  </div>;
  return <div class="wrap guided enter">
    <div class="qcol">
      <nav class="qnav" aria-label={t('gd.progress')}>
        <ol>{[...GUIDED, null].map((st, k) => <li><button type="button" class={cx(k === i && 'on', k < i && 'done')} aria-current={k === i ? 'step' : undefined}
          aria-label={st ? t('gd.' + st.id + '.short') : t('gd.sum.short')} title={st ? t('gd.' + st.id + '.short') : t('gd.sum.short')} onClick={() => go(k)} /></li>)}</ol>
        <span class="eyebrow" id="step-count">{s ? t('gd.count', { n: i + 1, total: N }) + ' · ' + t('gd.' + s.id + '.short') : t('gd.sum.short')}</span>
      </nav>
      {s ? <div class="col" style="gap:16px" key={s.id}>
        <div><h1 class="h-l q" id="question">{t('gd.' + s.id + '.q')}</h1><p class="lead">{t('gd.' + s.id + '.l')}</p></div>
        <p class="ctx"><Icon n="spark" /> <span>{context(s, d, m)}</span></p>
        {!edit && <p class="small mut">{t('lobby.otherstation', { name: roleOwnerName(FIELD_ROLE[s.field]) })}</p>}
        <Options s={s} d={d} m={m} edit={edit} />
        <Feedback s={s} d={d} m={m} edit={edit} />
        {t('why.' + s.field) !== 'why.' + s.field && <p class="small"><Why k={'why.' + s.field} src={SRC[s.field]} /></p>}
        <div class="row qfoot">
          {i > 0 && <Btn kind="ghost" id="q-back" onClick={() => go(i - 1)}>{t('nav.back')}</Btn>}<span class="sp" />
          <Btn big id="q-next" sound="select" disabled={s.id === 'instruments' && d.instruments.length === 0} onClick={() => go(i + 1)}>{i === N - 1 ? t('gd.sum.open') : t('gd.next')}</Btn>
        </div>
      </div> : <Summary d={d} m={m} />}
    </div>
    <div class="xcol">
      {meters}
      <div class="viewport big" ref={area} aria-label={t('gd.x.hint')}
        onPointerDown={e => { if ((e.target as HTMLElement).closest('button,.seg,.pinfo')) return; setDrag({ x: e.clientX, y: e.clientY, moved: 0 }); (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); }}
        onPointerMove={e => { if (drag) { const dx = e.clientX - drag.x, dy = e.clientY - drag.y; scene?.rotate(dx, dy); setDrag({ x: e.clientX, y: e.clientY, moved: drag.moved + Math.abs(dx) + Math.abs(dy) }); } }}
        onPointerUp={e => { if (drag && drag.moved < 6) { const c = scene?.pick(e.clientX, e.clientY) ?? null; if (c) sfx.tap(); pick(c); } setDrag(null); }} onPointerCancel={() => setDrag(null)}>
        <div class="vtop">
          <Seg id="view-toggle" label={t('st.view.craft') + ' / ' + t('st.view.rocket')} value={v} onChange={x => { view = x; picked = null; notify(); }}
            options={[{ v: 'craft', label: t('st.view.craft') }, { v: 'rocket', label: t('st.view.rocket') }]} />
          <button type="button" class={cx('btn ghost', exploded && 'on')} id="explode" aria-pressed={exploded} onClick={() => { sfx.whoosh(); exploded = !exploded; refresh(); }}>{exploded ? t('gd.x.assemble') : t('gd.x.explode')}</button>
        </div>
        {!sel && <span class="hint">{t(narrow ? 'gd.x.hintm' : 'gd.x.hint')}</span>}
      </div>
        {sel && <div class="pinfo" id="part-info" role="dialog" aria-label={t('part.' + sel + '.n')}>
          <div class="row" style="flex-wrap:nowrap;align-items:flex-start"><h2 class="h-s" style="flex:1">{t('part.' + sel + '.n')}</h2>
            <button type="button" class="iconbtn sm" aria-label={t('nav.close')} onClick={() => pick(null)}><Icon n="x" /></button></div>
          <p>{t('part.' + sel + '.d')}</p><p class="mut small">{t('part.' + sel + '.a')}</p>
          <p class="small"><span class="dim">{v === 'rocket' && sel !== 'payload' ? t('gd.x.rocket') : t('gd.x.yours')}:</span> <b>{yours(sel, d, m)}</b></p>
          {stepOfPart(sel) >= 0 && stepOfPart(sel) !== i && <Btn kind="ghost" id="part-goto" onClick={() => go(stepOfPart(sel))}>{t('gd.x.goto')}</Btn>}
        </div>}
      <Labels scene={scene} area={area} sel={sel} only={narrow && !exploded ? [sel, s?.part].filter((x): x is string => !!x) : null} onPick={c => pick(c === sel ? null : c)} />
    </div>
  </div>;
}
