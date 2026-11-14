import { describe, it, expect } from 'vitest';
import { MISSIONS, MISSION, Design, INSTRUMENTS } from '../src/engine/catalog';
import { deltaV, propellantFor, orbitPeriodMin, orbitSpeed, eclipseFraction, solarFlux, lightTimeS, arrayPower, evaluate, defaultDesign, assist, failing, findFix, neighbours } from '../src/engine/engine';
import { simulate, autoPicks, complete, pareto, frontierAt } from '../src/engine/sim';
import { encodeDesign, decodeDesign } from '../src/engine/codec';

describe('physics', () => {
  it('rocket equation', () => {
    expect(deltaV(320, 2718.28, 1000)).toBeCloseTo(3.138, 2); // ln(e)=1 -> Isp*g0
    expect(deltaV(320, 1000, 1000)).toBe(0);
    const p = propellantFor(1, 220, 100, 0.08);
    expect(deltaV(220, 100 + 1.08 * p, 100 + 0.08 * p)).toBeCloseTo(1, 6);
  });
  it('low Earth orbit', () => {
    expect(orbitSpeed(400)).toBeCloseTo(7.67, 1);
    expect(orbitPeriodMin(400)).toBeGreaterThan(92); expect(orbitPeriodMin(400)).toBeLessThan(93);
    expect(eclipseFraction(400)).toBeCloseTo(0.39, 2);
  });
  it('sunlight and light time', () => {
    expect(solarFlux(1.524)).toBeCloseTo(586, 0);
    expect(lightTimeS(1)).toBeCloseTo(499, 0);
    expect(arrayPower(1, 1)).toBeCloseTo(1361 * 0.29 * 0.85, 3);
  });
});

describe('sizing model', () => {
  it('default designs evaluate for every mission', () => {
    for (const m of MISSIONS) { const r = evaluate(defaultDesign(m, 'engineer')); expect(r.cost).toBeGreaterThan(0); expect(r.checks.length).toBeGreaterThan(5); }
  });
  it('the assistant produces a design with no failing check on every mission and difficulty it serves', () => {
    for (const m of MISSIONS) for (const diff of ['cadet', 'engineer'] as const) {
      const d = assist(defaultDesign(m, diff), null);
      expect(failing(evaluate(d)).map(c => c.id), m + diff).toEqual([]);
    }
  });
  it('more mass needs more propellant, and a small battery fails the eclipse check', () => {
    const d = assist(defaultDesign('moon', 'engineer'), null);
    const heavier = { ...d, shield: 'heavy' };
    expect(evaluate(heavier).propNeed).toBeGreaterThan(evaluate(d).propNeed);
    const leo: Design = { ...assist(defaultDesign('leo', 'engineer'), null), battery: 'S', instruments: ['sar'], power: 'solarL' };
    expect(evaluate(leo).checks.find(c => c.id === 'battery')?.status).toBe('fail');
    expect(findFix(leo, 'battery')).toBeTruthy();
  });
  it('solar power is useless in permanent shadow', () => {
    const d: Design = { ...assist(defaultDesign('moon', 'engineer'), null), orbit: 'psr', power: 'solarXL' };
    expect(evaluate(d).gen).toBe(0);
  });
  it('crew perks change the numbers', () => {
    const d = assist(defaultDesign('leo', 'engineer'), null);
    expect(evaluate(d, { crew: ['sys'] }).budget).toBeGreaterThan(evaluate(d).budget);
    expect(evaluate(d, { crew: ['sc'] }).dry).toBeLessThan(evaluate(d).dry);
  });
});

describe('simulation', () => {
  it('is deterministic', () => {
    for (const m of MISSIONS) {
      const d = assist(defaultDesign(m, 'engineer'), null);
      const a = complete(d, {}), b = complete(d, {});
      expect(a.science).toBe(b.science); expect(a.timeline.map(e => e.id + e.v)).toEqual(b.timeline.map(e => e.id + e.v));
    }
  });
  it('stops at a decision until a pick is supplied', () => {
    const d = assist(defaultDesign('leo', 'engineer'), null);
    const r = simulate(d, {});
    expect(r.pending).toBe(true);
    const last = r.timeline[r.timeline.length - 1];
    expect(last.options.length).toBeGreaterThan(1);
    const picks = autoPicks(d);
    expect(simulate(d, picks).pending).toBe(false);
  });
  it('an overweight spacecraft is lost at launch, with the mass check as root cause and a fix', () => {
    const d: Design = { ...assist(defaultDesign('moon', 'engineer'), null), bus: 'L', launcher: 'small' };
    const r = complete(d, {});
    expect(r.lost).toBe(true); expect(r.science).toBe(0);
    const e = r.timeline.find(x => x.id === 'overmass')!;
    expect(e.cause).toBe('mass'); expect(e.patch).toBeTruthy();
  });
  it('a lander without enough battery faces the night decision and loses science', () => {
    const base = assist({ ...defaultDesign('moon', 'engineer'), orbit: 'ridge' }, null);
    const weak: Design = { ...base, battery: 'S', thermal: 'heaters', power: 'solarL' };
    const r = complete(weak, {});
    expect(r.timeline.some(e => e.id === 'night')).toBe(true);
    expect(r.science).toBeLessThan(complete(base, {}).science);
  });
  it('one-change reruns keep earlier picks', () => {
    const d = assist(defaultDesign('mars', 'engineer'), null);
    const picks = autoPicks(d);
    for (const n of neighbours(d).slice(0, 12)) { const r = complete(n.design, picks); expect(r.pending).toBe(false); expect(isFinite(r.science)).toBe(true); }
  });
  it('every situation option has a defined outcome for sampled designs', () => {
    for (const m of MISSIONS) {
      const base = assist(defaultDesign(m, 'engineer'), null);
      for (const n of [{ design: base }, ...neighbours(base)]) {
        let picks: Record<string, string> = {};
        for (let g = 0; g < 20; g++) {
          const r = simulate(n.design, picks); if (!r.pending) break;
          const e = r.timeline[r.timeline.length - 1];
          for (const o of e.options) { const rr = complete(n.design, { ...picks, [e.id]: o }); expect(rr.timeline.find(x => x.id === e.id)?.v, e.id + o).toBeTruthy(); }
          picks = { ...picks, [e.id]: e.options[e.options.length - 1] };
        }
      }
    }
  });
});

describe('pareto and share codes', () => {
  it('finds a monotonic frontier', () => {
    const p = pareto(defaultDesign('leo', 'engineer'), {}, 300);
    expect(p.points.length).toBeGreaterThan(10);
    for (let i = 1; i < p.front.length; i++) { expect(p.front[i].cost).toBeGreaterThanOrEqual(p.front[i - 1].cost); expect(p.front[i].sci).toBeGreaterThan(p.front[i - 1].sci); }
    expect(frontierAt(p, 1e9)).toBe(p.front[p.front.length - 1].sci);
  });
  it('round-trips designs through share codes', () => {
    for (const m of MISSIONS) {
      const d = assist({ ...defaultDesign(m, 'director'), ambition: 2, objective: MISSION[m].objectives[2] }, null);
      const code = encodeDesign(d);
      expect(code).toMatch(/^[a-z0-9-]+$/);
      expect(decodeDesign(code)).toEqual(d);
    }
    expect(decodeDesign('nonsense')).toBeNull();
    expect(INSTRUMENTS.length).toBeGreaterThan(20);
  });
});

describe('guided build', () => {
  it('tidy keeps the player decisions and never adds failing checks', async () => {
    const { tidy, AUTO_FIELDS, evaluate, defaultDesign, failing } = await import('../src/engine/engine');
    for (const m of ['leo', 'moon', 'neo', 'mars'] as const) {
      const d = { ...defaultDesign(m, 'engineer'), instruments: [] as string[] };
      const t2 = tidy(d);
      for (const k of Object.keys(d) as (keyof typeof d)[]) if (!AUTO_FIELDS.includes(k as any) && k !== 'propKg') expect(t2[k]).toEqual(d[k]);
      expect(failing(evaluate(t2)).length).toBeLessThanOrEqual(failing(evaluate(d)).length);
    }
  });
});

describe('guided path', () => {
  it('a player who follows the step hints reaches a flyable design in every mission', async () => {
    const { GUIDED, answer, suggest } = await import('../src/engine/guided');
    const { evaluate, defaultDesign, failing, instrumentWorks } = await import('../src/engine/engine');
    for (const mis of ['leo', 'moon', 'neo', 'mars'] as const) {
      let d = answer(defaultDesign(mis, 'engineer'), 'ambition', 0);
      const o = MISSION[mis].orbits.find(x => x.id === d.orbit)!;
      const inst = INSTRUMENTS.filter(i => i.mission === mis && instrumentWorks(i.id, d, o)).sort((a, b) => (b.rel[d.objective] ?? 0) - (a.rel[d.objective] ?? 0))[0];
      d = answer(d, 'instruments', [inst.id]);
      for (let pass = 0; pass < 3; pass++) for (const s of GUIDED) { const v = suggest(d, s); if (v) d = answer(d, s.field, v); }
      expect(failing(evaluate(d)).map(c => c.id), mis).toEqual([]);
    }
  });
});

import { RANDOM_EVENTS, roll } from '../src/engine/sim';
describe('random events', () => {
  it('the expected flight (no seed) has none; a seeded flight draws 2 or 3, reproducibly', () => {
    for (const mi of MISSIONS) {
      const d = assist(defaultDesign(mi, 'cadet'), null);
      expect(complete(d, {}).timeline.some(e => e.random)).toBe(false);
      const counts = new Set<number>(), seen = new Set<string>();
      for (let f = 1; f <= 60; f++) {
        const a = complete(d, {}, { flight: f }), b = complete(d, {}, { flight: f });
        expect(a.science).toBe(b.science);
        const ids = a.timeline.filter(e => e.random).map(e => e.id); ids.forEach(i => seen.add(i));
        // a draw that ends the mission early can cut the list short, never extend it
        expect(ids.length).toBeLessThanOrEqual(3); counts.add(ids.length);
      }
      expect(counts.has(2) || counts.has(3)).toBe(true);
      expect(seen.size, mi + ' variety').toBeGreaterThanOrEqual(6);
    }
  });
  it('every random event exists and the dice are uniform enough', () => {
    expect(RANDOM_EVENTS.length).toBeGreaterThanOrEqual(12);
    let s = 0; for (let i = 0; i < 2000; i++) s += roll(i + 1, 'x'); expect(s / 2000).toBeGreaterThan(0.45); expect(s / 2000).toBeLessThan(0.55);
  });
});
