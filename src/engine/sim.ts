// Mission simulation: a deterministic chain of incidents (automatic consequences of the design) and
// situations (decisions). Outcomes depend only on the design, the picks and the data snapshot.
import { Design, Role, Field, AEROBRAKE_DV, INST, MISSION, OPTIONS } from './catalog';
import { evaluate, Metrics, CheckId, EvalOpts, Patch, findFix, instrumentWorks, neighbours, failing } from './engine';

export type Phase = 'launch' | 'cruise' | 'arrival' | 'ops' | 'end';
export const PHASES: Phase[] = ['launch', 'cruise', 'arrival', 'ops', 'end'];
export type Tone = 'good' | 'bad' | 'neutral';
export interface SimState { days: number; mult: number; lost: boolean; dv: number; extraCost: number }
interface Ctx { d: Design; m: Metrics; st: SimState; seed: number }
interface Out { v: string; tone: Tone; cause?: CheckId; patch?: Patch; vars?: Record<string, string | number> }
interface SitDef {
  id: string; phase: Phase; role: Role; kind: 'incident' | 'consequence' | 'weather' | 'opportunity';
  /** Drawn at random per flight (from the flight seed) among the eligible ones; never in the expected-value baseline. */
  random?: boolean;
  when: (c: Ctx) => boolean; opts?: { id: string; when?: (c: Ctx) => boolean }[];
  vars?: (c: Ctx) => Record<string, string | number>;
  run: (c: Ctx, pick: string) => Out;
}
export interface Entry {
  id: string; phase: Phase; role: Role; kind: SitDef['kind']; options: string[]; pick?: string; v?: string; tone?: Tone;
  vars: Record<string, string | number>; cause?: CheckId; patch?: Patch; delta: number; // science gained/lost by this entry
  /** Drawn for this flight only: another flight of the same design may not meet it. */
  random?: boolean;
}
export interface Result {
  pending: boolean; timeline: Entry[]; lost: boolean; days: number; mult: number; science: number; cost: number;
  verdict: 'fail' | 'min' | 'full'; overBudget: boolean; m: Metrics;
}

const has = (d: Design, id: string) => d.instruments.includes(id);
const margin = (c: Ctx) => c.st.dv;
const optShare = ({ d, m }: Ctx) => {
  let all = 0, opt = 0;
  for (const id of d.instruments) { const i = INST[id]; if (!i || !instrumentWorks(id, d, m.orbit)) continue; const v = i.rel[d.objective] ?? 0; all += v; if (i.optical) opt += v; }
  return all > 0 ? opt / all : 0;
};
/** Seeded draw in [0,1) for one flight and one key: the same flight gives the same draws whatever the design. */
export function roll(seed: number, key: string) {
  let h = 2166136261 ^ seed;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return mulberry32(h >>> 0)();
}
const dice = (c: Ctx, k: string) => roll(c.seed, k);
const lander = (c: Ctx) => c.m.orbit.kind === 'lander';
const fail = (c: Ctx, id: CheckId) => c.m.checks.some(k => k.id === id && k.status === 'fail');

const DEFS: SitDef[] = [
  // ---------------- launch
  { id: 'overmass', phase: 'launch', role: 'ops', kind: 'incident', when: c => fail(c, 'mass'),
    vars: c => ({ mass: c.m.launchMass, cap: c.m.cap }), run: c => { c.st.lost = true; return { v: 'lost', tone: 'bad', cause: 'mass' }; } },
  { id: 'licence', phase: 'launch', role: 'sys', kind: 'incident', when: c => fail(c, 'deorbit'),
    vars: c => ({ alt: c.m.orbit.alt ?? 0 }), run: c => { c.st.lost = true; return { v: 'lost', tone: 'bad', cause: 'deorbit' }; } },
  // launch-day winds are decided on the pad, before liftoff (a random event: drawn only on some flights)
  { id: 'scrub', phase: 'launch', role: 'ops', kind: 'weather', random: true, when: () => true, opts: [{ id: 'hold' }, { id: 'go' }],
    run: (c, p) => {
      if (p === 'hold') {
        if (c.d.mission === 'mars') { if (margin(c) >= 0.02) { c.st.dv -= 0.02; return { v: 'hold_window', tone: 'neutral' }; } c.st.days *= 0.93; return { v: 'hold_late', tone: 'bad', patch: { propKg: c.d.propKg + 10 } }; }
        c.st.extraCost += 0.4; return { v: 'hold', tone: 'neutral', vars: { cost: 0.4 } };
      }
      if (dice(c, 'scrub') < 0.3) { c.st.mult *= 0.88; return { v: 'go_bad', tone: 'bad' }; }
      return { v: 'go_ok', tone: 'neutral' };
    } },
  { id: 'rideorbit', phase: 'launch', role: 'ops', kind: 'incident', when: c => fail(c, 'rideorbit'),
    vars: c => ({ alt: c.m.orbit.alt ?? 0 }), run: c => { c.st.mult *= 0.8; return { v: 'off', tone: 'bad', cause: 'rideorbit' }; } },
  { id: 'liftoff', phase: 'launch', role: 'ops', kind: 'incident', when: c => !c.st.lost,
    vars: c => ({ mass: c.m.launchMass, margin: c.m.massMargin * 100 }), run: () => ({ v: 'ok', tone: 'good' }) },
  // ---------------- cruise
  { id: 'flare', phase: 'cruise', role: 'sc', kind: 'weather', when: () => true, opts: [{ id: 'safe' }, { id: 'ride' }],
    run: (c, p) => {
      const sev = c.m.def.flareSev, sl = { light: 0, std: 1, heavy: 2 }[c.d.shield] ?? 0;
      if (p === 'safe') {
        c.st.days -= Math.min(6, c.st.days * 0.1);
        if (sl === 0 && sev >= 2) { c.st.mult *= 0.95; return { v: 'safe_worn', tone: 'neutral', patch: { shield: 'std' } }; }
        return { v: 'safe', tone: 'neutral' };
      }
      if (sl === 2) { c.st.mult *= 1.03; return { v: 'ride_good', tone: 'good' }; }
      if (sl === 1) { c.st.mult *= sev >= 2 ? 0.9 : 0.96; return { v: 'ride_ok', tone: 'bad', patch: { shield: 'heavy' } }; }
      c.st.mult *= sev >= 2 ? 0.7 : 0.85;
      if (c.d.redund === 'single') { c.st.days -= Math.min(20, c.st.days * 0.25); return { v: 'ride_latch', tone: 'bad', patch: { shield: 'std' } }; }
      return { v: 'ride_bad', tone: 'bad', patch: { shield: 'std' } };
    } },
  { id: 'wearcruise', phase: 'cruise', role: 'sys', kind: 'incident', when: c => c.m.lifeYears * 365 <= c.m.cruiseDays,
    vars: c => ({ life: c.m.lifeYears, cruise: c.m.cruiseDays }), run: c => { c.st.lost = true; return { v: 'lost', tone: 'bad', cause: 'life' }; } },
  { id: 'ionlate', phase: 'cruise', role: 'sc', kind: 'incident', when: c => fail(c, 'ionpower'),
    vars: c => ({ have: Math.max(0, c.m.gen - c.m.load) }), run: c => { c.st.days *= 0.7; return { v: 'late', tone: 'bad', cause: 'ionpower' }; } },
  // ---------------- arrival
  { id: 'dvshort', phase: 'arrival', role: 'sc', kind: 'incident', when: c => c.d.mission !== 'leo' && (fail(c, 'dv') || fail(c, 'proptype')),
    vars: c => ({ have: c.m.dvAvail * 1000, need: c.m.dvNeed * 1000 }),
    run: c => {
      const cause: CheckId = fail(c, 'proptype') ? 'proptype' : 'dv';
      if (c.d.mission === 'neo') { c.st.mult *= c.m.orbit.kind === 'flyby' ? 0.6 : 0.25; return { v: 'miss', tone: 'bad', cause }; }
      c.st.lost = true; return { v: 'lost', tone: 'bad', cause };
    } },
  { id: 'aerobrake', phase: 'arrival', role: 'ops', kind: 'consequence', when: c => c.d.mission === 'mars' && c.m.orbit.kind === 'orbiter',
    opts: [{ id: 'aero' }, { id: 'burn', when: c => margin(c) >= AEROBRAKE_DV }],
    vars: c => ({ margin: Math.max(0, margin(c)) * 1000, need: AEROBRAKE_DV * 1000 }),
    run: (c, p) => {
      if (p === 'burn') { c.st.dv -= AEROBRAKE_DV; return { v: 'burn', tone: 'good' }; }
      c.st.days *= 0.88; return { v: 'aero', tone: 'neutral' };
    } },
  { id: 'landing', phase: 'arrival', role: 'sc', kind: 'consequence', when: lander, opts: [{ id: 'precise' }, { id: 'safe' }],
    run: (c, p) => {
      if (p === 'safe') { c.st.mult *= 0.9; return { v: 'safe', tone: 'neutral' }; }
      if (c.d.avionics === 'auto') { c.st.mult *= 1.15; return { v: 'precise_good', tone: 'good' }; }
      c.st.mult *= 0.55; return { v: 'precise_bad', tone: 'bad', patch: { avionics: 'auto' } };
    } },
  { id: 'nav', phase: 'arrival', role: 'ops', kind: 'consequence', when: c => c.d.mission === 'neo', opts: [{ id: 'auto' }, { id: 'ground' }],
    vars: c => ({ delay: c.m.lightDelayS * 2 }),
    run: (c, p) => {
      if (p === 'auto') {
        if (c.d.avionics === 'auto') { c.st.mult *= 1.05; return { v: 'auto_good', tone: 'good' }; }
        c.st.mult *= 0.7; return { v: 'auto_bad', tone: 'bad', patch: { avionics: 'auto' } };
      }
      if (c.m.orbit.kind === 'flyby') { c.st.mult *= 0.8; return { v: 'ground_flyby', tone: 'bad', patch: { avionics: 'auto' } }; }
      c.st.days -= Math.min(10, c.st.days * 0.2); return { v: 'ground', tone: 'neutral' };
    } },
  // ---------------- operations
  { id: 'brownout', phase: 'ops', role: 'sc', kind: 'incident', when: c => fail(c, 'power'),
    vars: c => ({ gen: c.m.gen, load: c.m.load }),
    run: c => {
      const f = c.m.gen / c.m.load;
      if (f < 0.2) { c.st.days = Math.min(c.st.days, 1); c.st.mult *= 0.1; return { v: 'dead', tone: 'bad', cause: 'power' }; }
      c.st.mult *= f; return { v: 'duty', tone: 'bad', cause: 'power', vars: { pct: f * 100 } };
    } },
  { id: 'cold', phase: 'ops', role: 'sc', kind: 'incident', when: c => fail(c, 'thermal'),
    vars: c => ({ heat: c.m.heat }),
    run: c => {
      if (c.m.heat >= 25) { c.st.days = Math.min(c.st.days, c.d.orbit === 'ridge' ? 10 : 2); return { v: 'freeze', tone: 'bad', cause: 'thermal' }; }
      c.st.mult *= 0.7; return { v: 'drift', tone: 'bad', cause: 'thermal' };
    } },
  { id: 'eclipse', phase: 'ops', role: 'sc', kind: 'consequence', when: c => !lander(c) && fail(c, 'battery'), opts: [{ id: 'duty' }, { id: 'deep' }],
    vars: c => ({ have: c.m.battUsable, need: c.m.nightNeed, min: c.m.orbit.nightH * 60 }),
    run: (c, p) => {
      const ratio = c.m.battUsable / c.m.nightNeed, sun = c.m.orbit.sun;
      if (p === 'duty') { c.st.mult *= sun + (1 - sun) * ratio; return { v: 'duty', tone: 'bad', cause: 'battery' }; }
      if (ratio >= 0.6) { c.st.days *= 0.7; return { v: 'deep_short', tone: 'bad', cause: 'battery' }; }
      c.st.mult *= sun * 0.9; return { v: 'deep_dead', tone: 'bad', cause: 'battery' };
    } },
  { id: 'night', phase: 'ops', role: 'sc', kind: 'consequence', when: c => lander(c) && fail(c, 'battery'), opts: [{ id: 'hibernate' }, { id: 'heaters' }],
    vars: c => ({ have: c.m.battUsable, need: c.m.nightNeed, hours: c.m.orbit.nightH }),
    run: (c, p) => {
      const warm = c.d.thermal === 'rhu', ratio = c.m.battUsable / c.m.nightNeed, first = c.d.orbit === 'ridge' ? 10 : 1;
      if (p === 'hibernate') {
        if (warm) { c.st.mult *= 0.85; return { v: 'hib_ok', tone: 'neutral', cause: 'battery' }; }
        c.st.days = Math.min(c.st.days, first); return { v: 'hib_freeze', tone: 'bad', cause: 'battery' };
      }
      if (ratio >= 0.5 || warm) { c.st.mult *= 0.7; return { v: 'heat_partial', tone: 'bad', cause: 'battery' }; }
      c.st.days = Math.min(c.st.days, first); return { v: 'heat_dead', tone: 'bad', cause: 'battery' };
    } },
  { id: 'decay', phase: 'ops', role: 'sc', kind: 'incident', when: c => c.d.mission === 'leo' && fail(c, 'dv'),
    vars: c => ({ alt: c.m.orbit.alt ?? 0 }), run: c => { c.st.days = Math.min(c.st.days, 300); return { v: 'reentry', tone: 'bad', cause: 'dv' }; } },
  { id: 'clouds', phase: 'ops', role: 'sci', kind: 'consequence', when: c => c.d.mission === 'leo' && optShare(c) > 0,
    opts: [{ id: 'wait' }, { id: 'through' }, { id: 'retask', when: c => c.d.instruments.some(i => INST[i]?.allWeather) }],
    run: (c, p) => {
      const s = optShare(c);
      if (p === 'retask') { c.st.mult *= 1 - 0.04 * s; return { v: 'retask', tone: 'good' }; }
      if (p === 'wait') { c.st.mult *= 1 - 0.2 * s; return { v: 'wait', tone: 'neutral', patch: addInst(c.d, ['tir', 'sar', 'mw']) }; }
      c.st.mult *= 1 - 0.32 * s; return { v: 'through', tone: 'bad', patch: addInst(c.d, ['tir', 'sar', 'mw']) };
    } },
  { id: 'drag', phase: 'ops', role: 'sc', kind: 'weather', when: c => c.d.mission === 'leo' && (c.m.orbit.alt ?? 999) <= 525,
    opts: [{ id: 'boost', when: c => margin(c) >= 0.015 }, { id: 'ride' }], vars: c => ({ alt: c.m.orbit.alt ?? 0 }),
    run: (c, p) => {
      if (p === 'boost') { c.st.dv -= 0.015; return { v: 'boost', tone: 'good' }; }
      if ((c.m.orbit.alt ?? 0) <= 400) { c.st.days *= 0.7; return { v: 'ride_low', tone: 'bad', patch: { orbit: 'sso525' } }; }
      c.st.days *= 0.95; return { v: 'ride_mid', tone: 'neutral' };
    } },
  { id: 'mascon', phase: 'ops', role: 'ops', kind: 'consequence', when: c => c.d.orbit === 'lpo',
    opts: [{ id: 'maintain', when: c => margin(c) >= 0.03 }, { id: 'raise' }],
    run: (c, p) => {
      if (p === 'maintain') { c.st.dv -= 0.03; return { v: 'maintain', tone: 'good' }; }
      c.st.mult *= 0.85; return { v: 'raise', tone: 'neutral' };
    } },
  { id: 'micro', phase: 'ops', role: 'sc', kind: 'consequence', when: c => c.d.mission === 'neo' && c.m.orbit.kind !== 'flyby', opts: [{ id: 'low' }, { id: 'high' }],
    run: (c, p) => {
      if (p === 'high') { c.st.mult *= 0.88; return { v: 'high', tone: 'neutral' }; }
      if (c.d.avionics === 'auto' && margin(c) >= 0.015) { c.st.dv -= 0.015; c.st.mult *= 1.15; return { v: 'low_good', tone: 'good' }; }
      c.st.mult *= 0.8; return { v: 'low_bad', tone: 'bad', patch: c.d.avionics === 'auto' ? undefined : { avionics: 'auto' } };
    } },
  { id: 'storage', phase: 'ops', role: 'ops', kind: 'incident', when: c => c.m.orbit.kind === 'flyby' && c.m.linkFrac < 1,
    vars: c => ({ have: c.m.storage, need: c.m.dataGen * 2 }), run: c => { c.st.mult *= c.m.linkFrac; return { v: 'full', tone: 'bad', cause: 'storage' }; } },
  { id: 'backlog', phase: 'ops', role: 'ops', kind: 'consequence', when: c => c.m.orbit.kind !== 'flyby' && c.m.linkFrac < 1, opts: [{ id: 'compress' }, { id: 'priority' }],
    vars: c => ({ gen: c.m.dataGen, down: c.m.dataDown, pct: c.m.linkFrac * 100 }),
    run: (c, p) => {
      const f = c.m.linkFrac;
      if (p === 'compress') { c.st.mult *= Math.min(1, f * 3) * 0.88; return { v: 'compress', tone: 'bad', cause: 'link' }; }
      c.st.mult *= Math.min(0.95, f * 1.8); return { v: 'priority', tone: 'bad', cause: 'link' };
    } },
  { id: 'newevent', phase: 'ops', role: 'sys', kind: 'opportunity', when: c => c.d.mission === 'leo', opts: [{ id: 'accept' }, { id: 'decline' }],
    run: (c, p) => {
      if (p === 'decline') return { v: 'decline', tone: 'neutral' };
      if (c.m.dataDown >= c.m.dataGen * 1.2 && c.m.powerMargin >= 0.1) { c.st.mult *= 1.12; return { v: 'accept_good', tone: 'good' }; }
      c.st.mult *= 0.94; return { v: 'accept_bad', tone: 'bad', cause: c.m.powerMargin < 0.1 ? 'power' : 'link' };
    } },
  { id: 'ice', phase: 'ops', role: 'sci', kind: 'opportunity', when: c => c.d.mission === 'moon' && (has(c.d, 'neut') || has(c.d, 'irs') || has(c.d, 'drill')),
    opts: [{ id: 'pursue' }, { id: 'decline' }],
    run: (c, p) => {
      if (p === 'decline') return { v: 'decline', tone: 'neutral' };
      if (!lander(c)) {
        if (margin(c) >= 0.04) { c.st.dv -= 0.04; c.st.mult *= 1.2; return { v: 'orb_good', tone: 'good' }; }
        c.st.days *= 0.75; return { v: 'orb_bad', tone: 'bad', cause: 'dv' };
      }
      if (c.m.powerMargin >= 0.15) { c.st.mult *= 1.2; return { v: 'land_good', tone: 'good' }; }
      c.st.mult *= 0.9; return { v: 'land_bad', tone: 'bad', cause: 'power' };
    } },
  { id: 'conj', phase: 'ops', role: 'ops', kind: 'consequence', when: c => c.d.mission === 'mars' && c.m.opsDays >= 300, opts: [{ id: 'pause' }, { id: 'auto' }],
    run: (c, p) => {
      if (p === 'pause') { c.st.days -= 14; return { v: 'pause', tone: 'neutral' }; }
      if (c.d.avionics === 'auto') return { v: 'auto_good', tone: 'good' };
      c.st.days -= 40; return { v: 'auto_bad', tone: 'bad', patch: { avionics: 'auto' } };
    } },
  { id: 'dust', phase: 'ops', role: 'sc', kind: 'weather', when: c => c.d.mission === 'mars' && lander(c), opts: [{ id: 'hibernate' }, { id: 'operate' }],
    vars: c => ({ gen: c.m.gen * 0.2, load: c.m.load }),
    run: (c, p) => {
      if (c.d.power === 'rtg') { if (p === 'operate') { c.st.mult *= 1.04; return { v: 'rtg_op', tone: 'good' }; } c.st.days -= 30; return { v: 'rtg_hib', tone: 'neutral' }; }
      if (p === 'hibernate') {
        if (c.m.battUsable >= c.m.nightNeed * 1.5 || c.d.thermal === 'rhu') { c.st.days -= Math.min(45, c.st.days * 0.3); return { v: 'hib_ok', tone: 'neutral' }; }
        c.st.days *= 0.4; return { v: 'hib_dead', tone: 'bad', patch: { thermal: 'rhu' } };
      }
      if (c.m.powerMargin >= 1) { c.st.days -= Math.min(15, c.st.days * 0.1); return { v: 'op_ok', tone: 'good' }; }
      c.st.days *= 0.4; return { v: 'op_dead', tone: 'bad', patch: { power: 'rtg' } };
    } },
  { id: 'dustorb', phase: 'ops', role: 'sci', kind: 'weather', when: c => c.d.mission === 'mars' && !lander(c),
    opts: [{ id: 'atmos', when: c => has(c.d, 'sounder') }, { id: 'wait' }],
    run: (c, p) => {
      if (p === 'atmos') { c.st.mult *= 1.1; return { v: 'atmos', tone: 'good' }; }
      c.st.mult *= 1 - 0.15 * optShare(c); return { v: 'wait', tone: 'neutral', patch: addInst(c.d, ['sounder']) };
    } },
  { id: 'wear', phase: 'ops', role: 'sys', kind: 'incident', when: c => fail(c, 'life') && c.m.lifeYears * 365 > c.m.cruiseDays,
    vars: c => ({ life: c.m.lifeYears, total: c.m.totalYears }),
    run: c => { c.st.days = Math.min(c.st.days, c.m.lifeYears * 365 - c.m.cruiseDays); return { v: 'fail', tone: 'bad', cause: 'life' }; } },

  // ---------------- random events (a different draw every flight; outcomes still depend on the design)
  { id: 'array', phase: 'launch', role: 'sc', kind: 'consequence', random: true, when: c => c.d.power !== 'rtg',
    opts: [{ id: 'shake', when: c => c.d.prop !== 'none' && margin(c) >= 0.003 }, { id: 'accept' }],
    run: (c, p) => {
      const short = () => { const f = (c.m.gen * 0.8) / Math.max(1, c.m.load); if (f >= 1) return null; c.st.mult *= f; return f; };
      if (p === 'shake') { c.st.dv -= 0.003; if (dice(c, 'array') < 0.65) return { v: 'shake_ok', tone: 'good' }; const f = short(); return f ? { v: 'shake_fail', tone: 'bad', vars: { pct: f * 100 }, patch: upgrade(c.d, 'power', ['solarS', 'solarM', 'solarL', 'solarXL']) } : { v: 'shake_fail_ok', tone: 'neutral' }; }
      const f = short(); return f ? { v: 'accept_short', tone: 'bad', vars: { pct: f * 100 }, patch: upgrade(c.d, 'power', ['solarS', 'solarM', 'solarL', 'solarXL']) } : { v: 'accept_ok', tone: 'good' };
    } },
  { id: 'meteoroid', phase: 'cruise', role: 'sc', kind: 'consequence', random: true, when: c => c.d.mission !== 'leo', opts: [{ id: 'inspect' }, { id: 'continue' }],
    run: (c, p) => {
      if (c.d.shield === 'heavy') return { v: 'shielded', tone: 'good' };
      if (p === 'inspect') { c.st.days -= 3; c.st.mult *= 0.98; return { v: 'inspect', tone: 'neutral' }; }
      if (c.m.powerMargin >= 0.2) return { v: 'cont_ok', tone: 'neutral' };
      c.st.mult *= 0.88; return { v: 'cont_bad', tone: 'bad', patch: upgrade(c.d, 'shield', ['light', 'std', 'heavy']) };
    } },
  { id: 'cme', phase: 'cruise', role: 'sc', kind: 'weather', random: true, when: c => c.d.mission !== 'leo', opts: [{ id: 'safe' }, { id: 'ride' }],
    run: (c, p) => {
      if (p === 'safe') { c.st.days -= 3; return { v: 'safe', tone: 'neutral' }; }
      if (c.d.shield === 'heavy') { c.st.mult *= 1.02; return { v: 'ride_ok', tone: 'good' }; }
      c.st.mult *= c.d.shield === 'std' ? 0.95 : 0.85; return { v: 'ride_hit', tone: 'bad', patch: upgrade(c.d, 'shield', ['light', 'std', 'heavy']) };
    } },
  { id: 'contam', phase: 'cruise', role: 'sci', kind: 'consequence', random: true, when: c => optShare(c) > 0, opts: [{ id: 'bake' }, { id: 'live' }],
    run: (c, p) => {
      const s = optShare(c);
      if (p === 'bake') { c.st.days -= 5; if (c.m.powerMargin >= 0.1) return { v: 'bake_ok', tone: 'good' }; c.st.mult *= 1 - 0.06 * s; return { v: 'bake_weak', tone: 'bad', cause: 'power' }; }
      c.st.mult *= 1 - 0.12 * s; return { v: 'live', tone: 'bad' };
    } },
  { id: 'upset', phase: 'ops', role: 'sc', kind: 'consequence', random: true, when: () => true, opts: [{ id: 'reboot' }, { id: 'patch' }],
    run: (c, p) => {
      if (p === 'reboot') { const lost = ({ single: 10, selective: 4, full: 1 } as Record<string, number>)[c.d.redund] ?? 10; c.st.days -= lost; return { v: 'reboot', tone: lost > 4 ? 'bad' : 'neutral', vars: { n: lost }, patch: upgrade(c.d, 'redund', ['single', 'selective', 'full']) }; }
      if (c.d.avionics === 'auto' || dice(c, 'upset') < 0.5) { c.st.days -= 1; return { v: 'patch_good', tone: 'good' }; }
      c.st.days -= 20; return { v: 'patch_bad', tone: 'bad', patch: { avionics: 'auto' } };
    } },
  { id: 'wheel', phase: 'ops', role: 'sc', kind: 'consequence', random: true, when: c => !lander(c),
    opts: [{ id: 'spare', when: c => c.d.redund !== 'single' }, { id: 'thrusters', when: c => c.d.prop !== 'none' && margin(c) >= 0.01 }, { id: 'degraded' }],
    run: (c, p) => {
      if (p === 'spare') return { v: 'spare', tone: 'good' };
      if (p === 'thrusters') { c.st.dv -= 0.01; c.st.days *= 0.9; return { v: 'thrusters', tone: 'neutral' }; }
      c.st.mult *= 0.85; return { v: 'degraded', tone: 'bad', patch: upgrade(c.d, 'redund', ['single', 'selective', 'full']) };
    } },
  { id: 'debris', phase: 'ops', role: 'ops', kind: 'consequence', random: true, when: c => c.d.mission === 'leo',
    opts: [{ id: 'dodge', when: c => c.d.prop !== 'none' && margin(c) >= 0.002 }, { id: 'accept' }],
    run: (c, p) => {
      if (p === 'dodge') { c.st.dv -= 0.002; c.st.days -= 1; return { v: 'dodge', tone: 'good' }; }
      if (dice(c, 'debris') < 0.1) { c.st.mult *= 0.6; return { v: 'hit', tone: 'bad', patch: c.d.prop === 'none' ? { prop: 'mono' } : undefined }; }
      return { v: 'miss', tone: 'neutral', patch: c.d.prop === 'none' ? { prop: 'mono' } : undefined };
    } },
  { id: 'shower', phase: 'ops', role: 'sc', kind: 'weather', random: true, when: c => (c.d.mission === 'leo' || c.d.mission === 'moon') && !lander(c), opts: [{ id: 'edge' }, { id: 'ignore' }],
    run: (c, p) => {
      if (p === 'edge') { c.st.days -= 1; return { v: 'edge', tone: 'neutral' }; }
      if (dice(c, 'shower') < 0.2) { c.st.mult *= 0.9; return { v: 'ignore_hit', tone: 'bad' }; }
      return { v: 'ignore_ok', tone: 'neutral' };
    } },
  { id: 'dsn', phase: 'ops', role: 'ops', kind: 'consequence', random: true, when: c => c.d.mission !== 'leo', opts: [{ id: 'store' }, { id: 'yield' }, { id: 'buy' }],
    run: (c, p) => {
      if (p === 'buy') { c.st.extraCost += 1.5; return { v: 'buy', tone: 'good', vars: { cost: 1.5 } }; }
      if (p === 'yield') { c.st.mult *= 0.96; return { v: 'yield', tone: 'neutral' }; }
      if (c.m.storage >= c.m.dataGen * 5) return { v: 'store_ok', tone: 'good' };
      c.st.mult *= 0.93; return { v: 'store_full', tone: 'bad', patch: { avionics: 'auto' } };
    } },
  { id: 'discovery', phase: 'ops', role: 'sci', kind: 'opportunity', random: true, when: () => true, opts: [{ id: 'follow' }, { id: 'log' }],
    run: (c, p) => {
      if (p === 'log') return { v: 'log', tone: 'neutral' };
      if (c.m.dataDown >= c.m.dataGen * 1.1 || c.m.orbit.kind === 'flyby') { c.st.mult *= 1.1; return { v: 'follow_good', tone: 'good' }; }
      c.st.mult *= 0.96; return { v: 'follow_bad', tone: 'bad', cause: 'link' };
    } },
  { id: 'cleaning', phase: 'ops', role: 'sc', kind: 'opportunity', random: true, when: c => c.d.mission === 'mars' && lander(c) && c.d.power !== 'rtg', opts: [{ id: 'campaign' }, { id: 'bank' }],
    run: (c, p) => {
      if (p === 'campaign') { c.st.mult *= 1.08; return { v: 'campaign', tone: 'good' }; }
      c.st.days += 30; return { v: 'bank', tone: 'good' };
    } },
  { id: 'budget', phase: 'ops', role: 'sys', kind: 'consequence', random: true, when: () => true, opts: [{ id: 'cutops' }, { id: 'cutsci' }, { id: 'appeal' }],
    run: (c, p) => {
      if (p === 'cutops') { c.st.days *= 0.85; return { v: 'cutops', tone: 'bad' }; }
      if (p === 'cutsci') { c.st.mult *= 0.9; return { v: 'cutsci', tone: 'bad' }; }
      if (dice(c, 'budget') < 0.5) return { v: 'appeal_won', tone: 'good' };
      c.st.days *= 0.8; c.st.mult *= 0.95; return { v: 'appeal_lost', tone: 'bad' };
    } },
  // ---------------- end of mission
  { id: 'extend', phase: 'end', role: 'sys', kind: 'opportunity',
    when: c => c.m.orbit.kind !== 'flyby' && c.m.powerMargin >= c.m.margin && c.m.lifeYears >= c.m.totalYears * 1.25 && c.st.dv >= 0 && c.st.days >= c.m.opsDays * 0.6,
    opts: [{ id: 'accept' }, { id: 'decline' }],
    run: (c, p) => {
      if (p === 'decline') return { v: 'decline', tone: 'neutral' };
      const add = c.m.costParts.ops * 0.25; c.st.days *= 1.25; c.st.extraCost += add; return { v: 'accept', tone: 'good', vars: { cost: add } };
    } },
  { id: 'noextend', phase: 'end', role: 'sys', kind: 'incident',
    when: c => c.m.orbit.kind !== 'flyby' && !(c.m.powerMargin >= c.m.margin && c.m.lifeYears >= c.m.totalYears * 1.25 && c.st.dv >= 0 && c.st.days >= c.m.opsDays * 0.6),
    run: c => {
      if (c.m.lifeYears < c.m.totalYears * 1.25) return { v: 'life', tone: 'neutral', patch: upgrade(c.d, 'redund', ['single', 'selective', 'full']) };
      if (c.m.powerMargin < c.m.margin) return { v: 'power', tone: 'neutral', cause: undefined };
      return { v: 'health', tone: 'neutral' };
    } },
];

function addInst(d: Design, ids: string[]): Patch | undefined {
  const id = ids.find(i => !d.instruments.includes(i) && INST[i].mission === d.mission);
  return id ? { instruments: [...d.instruments, id] } : undefined;
}
function upgrade(d: Design, f: Field, order: string[]): Patch | undefined {
  const i = order.indexOf(d[f] as string);
  return i >= 0 && i < order.length - 1 ? ({ [f]: order[i + 1] } as Patch) : undefined;
}

export function simulate(d: Design, picks: Record<string, string>, opts: EvalOpts = {}): Result {
  const m = evaluate(d, opts);
  const st: SimState = { days: m.opsDays, mult: 1, lost: false, dv: m.dvAvail - m.dvNeed, extraCost: 0 };
  const c: Ctx = { d, m, st, seed: opts.flight ?? 0 };
  const drawn = drawEvents(c, opts);
  const timeline: Entry[] = [];
  let pending = false;
  const pot = () => (st.lost ? 0 : m.sciRate * Math.max(0, st.days) * st.mult);
  const phaseOf = (def: SitDef): Phase => (def.id === 'flare' && (d.mission === 'leo' || d.mission === 'moon') ? 'ops' : def.phase);
  const ordered = DEFS.map((def, i) => ({ def, i })).sort((a, b) => PHASES.indexOf(phaseOf(a.def)) - PHASES.indexOf(phaseOf(b.def)) || a.i - b.i).map(x => x.def);
  for (const def of ordered) {
    if (st.lost) break;
    if (def.random && !drawn.has(def.id)) continue;
    if (!def.when(c)) continue;
    const options = (def.opts ?? []).filter(o => !o.when || o.when(c)).map(o => o.id);
    const e: Entry = { id: def.id, phase: phaseOf(def), role: def.role, kind: def.kind, options, vars: def.vars?.(c) ?? {}, delta: 0, ...(def.random ? { random: true } : {}) };
    if (options.length && !(picks[def.id] && options.includes(picks[def.id]))) { timeline.push(e); pending = true; break; }
    const before = pot();
    const out = def.run(c, picks[def.id] ?? '');
    st.days = Math.max(0, st.days);
    e.pick = picks[def.id]; e.v = out.v; e.tone = out.tone; e.cause = out.cause; e.delta = pot() - before;
    if (out.vars) e.vars = { ...e.vars, ...out.vars };
    e.patch = out.patch ?? (out.cause ? findFix(d, out.cause, opts) ?? undefined : undefined);
    timeline.push(e);
  }
  const science = st.lost ? 0 : m.sciRate * st.days * st.mult;
  const cost = m.cost + st.extraCost, overBudget = m.cost > m.budget + 1e-9;
  let verdict: Result['verdict'] = science >= m.sciFull && !overBudget ? 'full' : science >= m.sciMin ? 'min' : 'fail';
  if (pending) verdict = 'fail';
  return { pending, timeline, lost: st.lost, days: st.days, mult: st.mult, science, cost, verdict, overBudget, m };
}

/** Random events of one flight: 2 or 3 of those that can happen to this mission and design, chosen by the flight seed. */
function drawEvents(c: Ctx, opts: EvalOpts): Set<string> {
  if (opts.events) return new Set(opts.events);
  if (opts.flight == null) return new Set();
  const ok = DEFS.filter(x => x.random && x.when(c)).map(x => x.id).sort((a, b) => roll(c.seed, a) - roll(c.seed, b));
  return new Set(ok.slice(0, roll(c.seed, '#n') < 0.5 ? 2 : 3));
}
export const RANDOM_EVENTS = DEFS.filter(x => x.random).map(x => x.id);

/** Greedy policy used by bot crew members and by the Pareto sampler: at each decision take the option with the best final science. */
export function autoPicks(d: Design, opts: EvalOpts = {}, base: Record<string, string> = {}): Record<string, string> {
  const picks = { ...base };
  for (let guard = 0; guard < 20; guard++) {
    const r = simulate(d, picks, opts);
    if (!r.pending) break;
    const e = r.timeline[r.timeline.length - 1];
    let best = e.options[0], bestSci = -1;
    for (const o of e.options) {
      const s = finish(d, { ...picks, [e.id]: o }, opts).science;
      if (s > bestSci) { bestSci = s; best = o; }
    }
    picks[e.id] = best;
  }
  return picks;
}
function finish(d: Design, picks: Record<string, string>, opts: EvalOpts): Result {
  const p = { ...picks };
  for (let guard = 0; guard < 20; guard++) {
    const r = simulate(d, p, opts);
    if (!r.pending) return r;
    const e = r.timeline[r.timeline.length - 1]; p[e.id] = e.options[0];
  }
  return simulate(d, p, opts);
}
/** Run to completion: keep the given picks, fill the rest with the greedy policy. */
export const complete = (d: Design, picks: Record<string, string>, opts: EvalOpts = {}) => simulate(d, autoPicks(d, opts, picks), opts);

// ---------- Pareto frontier: science vs cost over the space of valid designs ----------
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export interface Pareto { points: { cost: number; sci: number }[]; front: { cost: number; sci: number }[]; n: number }
export function pareto(base: Design, opts: EvalOpts = {}, n = 1500, seed = 7): Pareto {
  const rnd = mulberry32(seed + base.mission.length * 131 + base.ambition * 17 + base.objective.length);
  const def = MISSION[base.mission];
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)];
  const pts: { cost: number; sci: number }[] = [];
  const instIds = Object.values(INST).filter(i => i.mission === base.mission).map(i => i.id);
  for (let k = 0; k < n; k++) {
    let d: Design = { ...base };
    for (const f of ['bus', 'redund', 'shield', 'power', 'battery', 'thermal', 'prop', 'avionics', 'launcher', 'antenna', 'band', 'ground'] as const)
      d[f] = pick(OPTIONS[f]);
    d.orbit = pick(def.orbits).id;
    d.instruments = instIds.filter(() => rnd() < 0.4);
    d.propKg = 0;
    const need = evaluate(d, opts).propNeed;
    d.propKg = d.prop === 'none' || !isFinite(need) ? 0 : Math.ceil(need);
    // local repair makes the sample dense in the feasible region
    if (failing(evaluate(d, opts)).length) d = repair(d, opts);
    if (failing(evaluate(d, opts)).length) continue;
    const r = complete(d, {}, opts);
    pts.push({ cost: r.cost, sci: r.science });
  }
  // plus spacecraft one or two decisions away from the base design, so there is always something to compare at the player's price
  const seen = new Set([JSON.stringify(base)]);
  const add = (d: Design) => { const k = JSON.stringify(d); if (seen.has(k)) return; seen.add(k); if (failing(evaluate(d, opts)).length) return; const r = complete(d, {}, opts); pts.push({ cost: r.cost, sci: r.science }); };
  const near = neighbours(base, opts);
  near.forEach(x => add(x.design));
  for (let k = 0; k < Math.min(60, n / 8); k++) { const a = pick(near); if (!a) break; const b2 = pick(neighbours(a.design, opts)); if (b2) add(b2.design); }
  const sorted = [...pts].sort((a, b) => a.cost - b.cost || b.sci - a.sci);
  const front: Pareto['front'] = [];
  let best = -1;
  for (const p of sorted) if (p.sci > best + 1e-9) { front.push(p); best = p.sci; }
  return { points: pts, front, n };
}
function repair(d: Design, opts: EvalOpts): Design {
  let cur = d;
  for (let i = 0; i < 6; i++) {
    const f = failing(evaluate(cur, opts));
    if (!f.length) break;
    const patch = findFix(cur, f[0].id, opts);
    if (!patch) break;
    cur = { ...cur, ...patch };
  }
  return cur;
}
/** Best science reachable on the frontier at or below a given cost. */
export function frontierAt(p: Pareto, cost: number) {
  let s = 0;
  for (const f of p.front) if (f.cost <= cost + 1e-9) s = Math.max(s, f.sci);
  return s;
}
export { neighbours };
