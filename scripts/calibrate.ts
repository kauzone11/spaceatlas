import { MISSION, MISSIONS, Design } from '../src/engine/catalog';
import { defaultDesign, evaluate, assist, failing } from '../src/engine/engine';
import { pareto, complete } from '../src/engine/sim';
for (const mi of MISSIONS) for (const amb of [0, 1, 2]) {
  const def = MISSION[mi];
  for (const obj of def.objectives.slice(0, amb === 1 ? 3 : 1)) {
    const base: Design = { ...defaultDesign(mi, 'engineer'), objective: obj, ambition: amb };
    const t = Date.now(); const p = pareto(base, {}, 700);
    const m = evaluate(base);
    const ok = p.points.filter(x => x.cost <= m.budget);
    const q = (a: number[], f: number) => a.sort((x, y) => x - y)[Math.floor(a.length * f)] ?? 0;
    const sc = ok.map(x => x.sci);
    console.log(mi, obj, 'amb', amb, 'valid', p.points.length, 'inBudget', ok.length, 'budget', m.budget.toFixed(0), 'cost q10/50/90', q(p.points.map(x => x.cost), .1).toFixed(0), q(p.points.map(x => x.cost), .5).toFixed(0), q(p.points.map(x => x.cost), .9).toFixed(0),
      'sci(inB) q50/q90/max', q(sc, .5).toFixed(0), q(sc, .9).toFixed(0), Math.max(0, ...sc).toFixed(0), 'min/full', m.sciMin.toFixed(0), m.sciFull.toFixed(0), 'front', p.front.length, (Date.now() - t) + 'ms');
  }
  if (amb) continue; const a = assist(defaultDesign(mi, 'cadet'), null); const ma = evaluate(a); const r = complete(a, {});
  console.log('  assist:', a.bus,a.power,a.battery,a.thermal,a.prop,a.propKg,a.avionics,a.instruments.join('+'),a.launcher,a.orbit,a.antenna,a.band,a.ground, 'fails', failing(ma).map(c => c.id), 'cost', ma.cost.toFixed(1), '/', ma.budget.toFixed(0), 'sci', r.science.toFixed(0), r.verdict);
}
