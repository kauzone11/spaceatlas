// Resource meters shared by the build and the launch review.
import { t, fmt } from '../i18n';
import { Metrics } from '../engine/engine';
import { cx, useDelta } from './common';

export function Meter(p: { label: string; value: number; of?: number; unit: string; frac: number; status: 'ok' | 'warn' | 'fail'; sub: string; k: string; digits?: number }) {
  const d = useDelta(p.value, p.k);
  return <div class={cx('meter', d && 'pulse')} key={d ? d.n : 'm'}>
    <label>{p.label}</label><b>{fmt(p.value, p.digits)} <span class="small mut">{p.unit}</span></b><small>{p.sub}</small>
    <div class={cx('bar', p.status)}><div style={`width:${Math.max(3, Math.min(100, p.frac * 100))}%`} /></div>
    {d && <span class="delta">{d.d > 0 ? '+' : '−'}{fmt(Math.abs(d.d), p.digits)}</span>}
  </div>;
}
const st = (m: Metrics, ids: string[]) => { const cs = m.checks.filter(c => ids.includes(c.id)); return cs.some(c => c.status === 'fail') ? 'fail' : cs.some(c => c.status === 'warn') ? 'warn' : 'ok'; };
export function Meters({ m, k }: { m: Metrics; k: string }) {
  const pct = (x: number) => `${fmt(x * 100, 0)}% ${t('st.margin')}`;
  return <div class="meters" aria-live="polite">
    <Meter k={k} label={t('st.cost')} value={m.cost} unit="$M" frac={m.cost / m.budget} status={st(m, ['budget'])} sub={`${t('st.of')} ${fmt(m.budget, 0)}`} />
    <Meter k={k} label={t('st.mass')} value={m.launchMass} unit="kg" frac={m.cap ? m.launchMass / m.cap : 1} status={st(m, ['mass', 'payload'])} sub={m.cap ? pct(m.massMargin) : '–'} digits={0} />
    <Meter k={k} label={t('st.power')} value={m.load} unit="W" frac={m.gen ? m.load / m.gen : 1} status={st(m, ['power', 'battery', 'thermal', 'ionpower'])} sub={`${t('st.of')} ${fmt(m.gen, 0)} W`} digits={0} />
    <Meter k={k} label={t('st.dv')} value={m.dvAvail * 1000} unit="m/s" frac={m.dvNeed ? Math.min(1, m.dvAvail / m.dvNeed) : 1} status={st(m, ['dv', 'deorbit', 'proptype'])} sub={`${t('st.need')} ${fmt(m.dvNeed * 1000, 0)}`} digits={0} />
    <Meter k={k} label={t('st.data')} value={m.dataGen} unit="Gb" frac={m.dataDown ? m.dataGen / m.dataDown : 1} status={st(m, ['link', 'storage'])} sub={`${t('st.of')} ${fmt(m.dataDown)} ${t('unit.gbd')}`} />
    <Meter k={k} label={t('st.sci')} value={m.sciPred} unit={t('unit.su')} frac={m.sciPred / m.sciFull} status={st(m, ['scimin', 'relevance', 'compat'])} sub={`${fmt(m.sciMin, 0)} / ${fmt(m.sciFull, 0)}`} digits={0} />
  </div>;
}
