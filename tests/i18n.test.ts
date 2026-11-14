import { describe, it, expect } from 'vitest';
import { DICT, t, setLang } from '../src/i18n';
import { INSTRUMENTS, MISSION, MISSIONS, OPTIONS } from '../src/engine/catalog';
import { evaluate, defaultDesign, assist, neighbours } from '../src/engine/engine';
import { simulate, RANDOM_EVENTS } from '../src/engine/sim';

describe('translations', () => {
  const keys = Object.keys(DICT.en).sort();
  it('pt and es define exactly the English keys', () => {
    expect(Object.keys(DICT.pt).sort()).toEqual(keys);
    expect(Object.keys(DICT.es).sort()).toEqual(keys);
  });
  it('placeholders match across languages', () => {
    const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
    for (const k of keys) { expect(ph(DICT.pt[k]), 'pt ' + k).toBe(ph(DICT.en[k])); expect(ph(DICT.es[k]), 'es ' + k).toBe(ph(DICT.en[k])); }
  });
  it('no empty strings', () => { for (const l of ['en', 'pt', 'es'] as const) for (const k of keys) expect(DICT[l][k].length, l + k).toBeGreaterThan(0); });
  it('every catalog item, check and situation outcome has text', () => {
    const need = new Set<string>();
    for (const i of INSTRUMENTS) { need.add('inst.' + i.id); need.add('instd.' + i.id); }
    for (const [f, vs] of Object.entries(OPTIONS)) { need.add('f.' + f); need.add('why.' + f); for (const v of vs) need.add(`opt.${f}.${v}`); }
    for (const m of MISSIONS) {
      for (const o of MISSION[m].orbits) { need.add('opt.orbit.' + o.id); need.add('optd.orbit.' + o.id); }
      for (const o of MISSION[m].objectives) need.add('obj.' + o);
      const base = assist(defaultDesign(m, 'engineer'), null);
      const list = [{ design: base }, { design: defaultDesign(m, 'engineer') }, ...neighbours(base), ...neighbours(defaultDesign(m, 'engineer'))];
      for (const [ni, n] of list.entries()) {
        for (const c of evaluate(n.design).checks) { need.add(`chk.${c.id}.t`); need.add(`chk.${c.id}.d`); }
        // walk every branch of the decision tree
        const walk = (picks: Record<string, string>, depth: number, o: { events?: string[]; flight?: number } = {}) => {
          const r = simulate(n.design, picks, o);
          for (const e of r.timeline) { need.add(`sit.${e.id}.t`); if (e.v) need.add(`sit.${e.id}.r.${e.v}`); for (const o of e.options) need.add(`sit.${e.id}.o.${o}`); if (e.options.length) need.add(`sit.${e.id}.b`); }
          if (!r.pending || depth > 8) return;
          const e = r.timeline[r.timeline.length - 1];
          for (const x of e.options) walk({ ...picks, [e.id]: x }, depth + 1, o);
        };
        walk({}, 0);
        // every random event, alone, over several flights (their outcomes also depend on the flight's dice)
        if (ni < 2) for (const ev of RANDOM_EVENTS) for (const flight of [1, 2, 3, 5, 8, 13, 21, 34]) walk({}, 0, { events: [ev], flight });
      }
    }
    const missing = [...need].filter(k => !(k in DICT.en));
    expect(missing).toEqual([]);
  });
  it('formats numbers per language', () => {
    setLang('pt'); expect(t('chk.budget.d', { actual: 12.5, needed: 1500 })).toContain('12,5'); setLang('en');
  });
});
