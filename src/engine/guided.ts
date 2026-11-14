// The guided build: one question per decision, in an order where each answer only depends on earlier ones.
// Pure data plus the "which option clears this step" helper; no DOM.
import { Design, Field } from './catalog';
import { CheckId, EvalOpts, evaluate, optionsFor, setField, tidy, badness } from './engine';

export type Part = 'bus' | 'power' | 'battery' | 'thermal' | 'prop' | 'avionics' | 'antenna' | 'inst' | 'legs';
export interface Step { id: string; field: Field; checks: CheckId[]; part?: Part; view?: 'craft' | 'rocket' }
export const GUIDED: Step[] = [
  { id: 'objective', field: 'objective', checks: [] },
  { id: 'ambition', field: 'ambition', checks: ['life'] },
  { id: 'instruments', field: 'instruments', checks: ['relevance', 'compat', 'scimin'], part: 'inst' },
  { id: 'orbit', field: 'orbit', checks: ['compat', 'rideorbit'] },
  { id: 'bus', field: 'bus', checks: ['payload'], part: 'bus' },
  { id: 'power', field: 'power', checks: ['power', 'ionpower', 'dust'], part: 'power' },
  { id: 'battery', field: 'battery', checks: ['battery', 'thermal'], part: 'battery' },
  { id: 'prop', field: 'prop', checks: ['dv', 'deorbit', 'proptype'], part: 'prop' },
  { id: 'antenna', field: 'antenna', checks: ['link', 'storage'], part: 'antenna' },
  { id: 'launcher', field: 'launcher', checks: ['mass', 'rideorbit', 'budget'], view: 'rocket' },
];
/** Index of the step that owns a spacecraft part (for "go to the question" from the 3D explorer). */
export const stepOfPart = (p: string) => GUIDED.findIndex(s => s.part === p);

/** The design after a guided answer: the choice itself, then the automatic secondary decisions. */
export function answer(d: Design, f: Field, v: unknown, opts?: EvalOpts): Design {
  return tidy(setField(d, f, v), opts);
}
/** Score of a design for one step: failing checks of that step first, then everything else. */
const stepBad = (d: Design, s: Step, opts?: EvalOpts) => { const m = evaluate(d, opts);
  return m.checks.filter(c => s.checks.includes(c.id) && c.status === 'fail').length * 1e3 + badness(m); };
/** The single option of this step that best clears its checks (null when the current one is already the best). */
export function suggest(d: Design, s: Step, opts?: EvalOpts): string | null {
  if (s.field === 'instruments' || s.field === 'objective' || s.field === 'ambition') return null;
  const cur = stepBad(d, s, opts); let best: { v: string; b: number; cost: number } | null = null;
  for (const v of optionsFor(d, s.field) as string[]) {
    if (v === d[s.field]) continue;
    const n = answer(d, s.field, v, opts), b = stepBad(n, s, opts), cost = evaluate(n, opts).cost;
    if (b < cur && (!best || b < best.b || (b === best.b && cost < best.cost))) best = { v, b, cost };
  }
  return best?.v ?? null;
}
