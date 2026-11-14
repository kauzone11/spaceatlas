import { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { t, fmt, fmtDate } from '../i18n';
import { Design, Field, MISSION, WEATHER, Role, INST, SOURCES } from '../engine/catalog';
import { Check, Patch } from '../engine/engine';
import { Entry } from '../engine/sim';
import { SNAPSHOT } from '../data/snapshot';
import { NASA } from '../data/nasa';
import { nasa, cmeFor } from '../net/live';
import { CREW_BY_ID } from '../data/crew';
import { app, subscribe } from './store';
import { sfx } from './audio';

export function useApp() { const [, set] = useState(0); useEffect(() => { const off = subscribe(() => set(n => n + 1)); set(n => n + 1); return off; }, []); return app; }
export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

export function Btn(p: { children: ComponentChildren; onClick?: () => void; kind?: 'primary' | 'ghost' | 'danger' | 'plain'; disabled?: boolean; title?: string; big?: boolean; id?: string; sound?: keyof typeof sfx }) {
  return <button id={p.id} type="button" class={cx('btn', p.kind ?? 'primary', p.big && 'big')} disabled={p.disabled} title={p.title}
    onClick={() => { sfx[p.sound ?? 'tap'](); p.onClick?.(); }}>{p.children}</button>;
}
export function Seg<T extends string>(p: { value: T; options: { v: T; label: string }[]; onChange: (v: T) => void; label: string; disabled?: boolean; id?: string }) {
  return <div class="seg" role="radiogroup" aria-label={p.label} id={p.id}>
    {p.options.map(o => <button type="button" role="radio" aria-checked={o.v === p.value} class={cx(o.v === p.value && 'on')} disabled={p.disabled}
      onClick={() => { if (o.v !== p.value) { sfx.tap(); p.onChange(o.v); } }}>{o.label}</button>)}
  </div>;
}
export const Chip = (p: { tone?: 'ok' | 'warn' | 'fail' | 'info' | 'mute'; children: ComponentChildren }) => <span class={cx('chip', p.tone ?? 'mute')}>{p.children}</span>;
export function Icon({ n }: { n: 'ok' | 'warn' | 'fail' | 'lock' | 'sound' | 'mute' | 'info' | 'chat' | 'x' | 'arrow' | 'spark' }) {
  const d: Record<string, string> = {
    ok: 'M5 12.5l4.2 4.2L19 7', warn: 'M12 4l9 16H3zM12 10v4.5M12 17.4v.2', fail: 'M6 6l12 12M18 6L6 18', lock: 'M7 11V8a5 5 0 0110 0v3M5 11h14v9H5z',
    sound: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM15.5 9a4 4 0 010 6M18 6.5a7.5 7.5 0 010 11', mute: 'M4 9.5v5h3.5L12 18V6L7.5 9.5zM16 9.5l5 5M21 9.5l-5 5',
    info: 'M12 8v.2M12 11v5.5M12 3a9 9 0 110 18 9 9 0 010-18z', chat: 'M4 5h16v11H9l-5 4z', x: 'M6 6l12 12M18 6L6 18', arrow: 'M5 12h14M13 6l6 6-6 6', spark: 'M12 3v5M12 16v5M3 12h5M16 12h5M6 6l3 3M15 15l3 3M18 6l-3 3M9 15l-3 3',
  };
  return <svg class="ic" viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={d[n]} /></svg>;
}

// ---------- labels ----------
export const objKey = (d: Design) => (d.mission === 'mars' && d.objective === 'geo' ? 'obj.geo.mars' : 'obj.' + d.objective);
export const objKeyOf = (mission: string, o: string) => (mission === 'mars' && o === 'geo' ? 'obj.geo.mars' : 'obj.' + o);
export function optLabel(d: Design, f: Field, v: unknown): string {
  if (f === 'propKg') return `${fmt(Number(v), 0)} kg`;
  if (f === 'objective') return t(objKeyOf(d.mission, String(v)));
  if (f === 'ambition') return t('con.amb' + v);
  if (f === 'instruments') return (v as string[]).map(i => t('inst.' + i)).join(', ') || '–';
  return t(`opt.${f}.${v}`);
}
export function patchLabel(d: Design, patch: Patch): string {
  return (Object.entries(patch) as [Field, unknown][]).map(([f, v]) => {
    if (f === 'instruments') {
      const now = new Set(d.instruments), next = new Set(v as string[]);
      const add = [...next].filter(i => !now.has(i)).map(i => '+ ' + t('inst.' + i)), rem = [...now].filter(i => !next.has(i)).map(i => '− ' + t('inst.' + i));
      return [...add, ...rem].join(', ');
    }
    return `${t('f.' + f)} → ${optLabel(d, f, v)}`;
  }).join(' · ');
}
export const checkText = (c: Check) => t(`chk.${c.id}.d`, { actual: c.actual, needed: c.needed, n: c.actual, ...(c.vars ?? {}) });
export const crewName = (id?: string | null) => (id && CREW_BY_ID[id]?.name) || '–';

/** The real EONET events used as the Earth-observation target and the retasking opportunity. */
export function eonetTargets(d: Design) {
  const want = { hot: 'wildfires', air: 'severeStorms', land: 'seaLakeIce' }[d.objective] ?? 'wildfires';
  // solo players see today's events when live data loaded; a team uses the shared snapshot so everyone reads the same target
  const pool = app.mode === 'team' ? NASA.eonet : nasa.data.eonet, ev = pool.length ? pool : SNAPSHOT.eonet, main = ev.find(e => e.cat === want) ?? ev[0];
  const second = ev.find(e => e.id !== main.id && e.cat !== main.cat) ?? ev.find(e => e.id !== main.id) ?? main;
  return { main, second };
}
export const neoTarget = () => SNAPSHOT.nhats[0];
export function sitVars(d: Design, e: Entry): Record<string, string | number> {
  const { main, second } = eonetTargets(d);
  const c = e.id === 'cme' ? cmeFor(app.g.flight ?? 1) : null;
  const donki = c ? t('wx.donki.cme', { date: fmtDate(c.date), speed: c.speed }) : t('wx.donki.none');
  return { ...e.vars, wx: t('wx.' + WEATHER[d.mission].key), event: main.title, event2: second.title, donki };
}
export const roleOwnerName = (role: Role) => { const s = app.g.seats[role]; return s ? crewName(s.crew) : t('lobby.bot'); };
export const instName = (id: string) => (INST[id] ? t('inst.' + id) : id);

/** Collapsible explanation with its source. */
export function Why({ k, src }: { k: string; src?: string }) {
  const [open, setOpen] = useState(false); const s = SOURCES.find(x => x.id === src);
  return <span class="why">
    <button type="button" class="whybtn" aria-expanded={open} onClick={() => { sfx.tap(); setOpen(!open); }}>{t('st.why')}</button>
    {open && <span class="whybox"><span>{t(k)}</span>{s && <span class="src">{t('st.source')}: <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a></span>}</span>}
  </span>;
}
/** Number that shows its last change for a moment: the live dependency map. */
export function useDelta(value: number, key: string) {
  const prev = useRef<{ v: number; k: string }>({ v: value, k: key }); const [d, setD] = useState<{ d: number; n: number } | null>(null);
  useEffect(() => {
    if (prev.current.k !== key) { prev.current = { v: value, k: key }; return; }
    const diff = value - prev.current.v; prev.current.v = value;
    if (Math.abs(diff) > Math.max(1e-6, Math.abs(value) * 0.0005)) { const n = Date.now(); setD({ d: diff, n }); const id = setTimeout(() => setD(x => (x?.n === n ? null : x)), 2200); return () => clearTimeout(id); }
  }, [value, key]);
  return d;
}

/** Today's NASA open data (live when the page may reach NASA's APIs, else the dated snapshot). */
export function NasaNow() {
  const n = nasa.data, g = n.gst[0], o = n.neo[0];
  const fast = n.cme.find(x => x.speed >= 500) ?? [...n.cme].sort((a, b) => b.speed - a.speed)[0];
  return <div class="live col" id="nasa-now" data-live={nasa.live ? '1' : '0'} style="gap:6px">
    <div class="row" style="gap:8px"><b style="color:var(--cyan)">{t('nasa.title')}</b><Chip tone={nasa.live ? 'ok' : 'info'}>{nasa.live ? t('nasa.live') : t('nasa.snap', { date: fmtDate(n.date) })}</Chip></div>
    {fast && <span class="small">{t('nasa.cme', { date: fmtDate(fast.date), speed: fast.speed })}</span>}
    <span class="small">{g ? t('nasa.gst', { date: fmtDate(g.date), kp: g.kp }) : t('nasa.gst.none')}</span>
    {o && <span class="small">{t('nasa.neo', { name: o.name, ld: o.ld, date: fmtDate(o.date), dmin: o.dMin, dmax: o.dMax })}</span>}
    <span class="small mut">{t('nasa.eonet', { n: n.eonet.length })}</span>
  </div>;
}
