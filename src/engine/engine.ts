// Deterministic sizing model: design -> budgets, margins and Go/No-Go checks. No DOM, no randomness.
import {
  Design, Field, Role, MISSION, DIFF, BUS, REDUND, SHIELD, POWER, BATTERY, THERMAL, PROP, AVIONICS, ANTENNA, BAND, GROUND, LAUNCHER, INST,
  G0, MU_EARTH, R_EARTH, SOLAR_CONST, CELL_EFF, ARRAY_LOSS, RTG_DECAY, ION_POWER, ION_DV_K, DEEP_REF_MBPS, LEO_REF_MBPS, AU_KM, C_KMS,
  LANDER_BUS_K, EDL_K, EDL_COST, FLYBY_DAYS, OPTIONS, OrbitDef, MissionDef, INSTRUMENTS, FIELD_ROLE,
} from './catalog';

// ---------- physics helpers (unit-tested) ----------
/** Tsiolkovsky rocket equation. Returns km/s. */
export const deltaV = (ispS: number, m0: number, mf: number) => (mf > 0 && m0 > mf ? (ispS * G0 * Math.log(m0 / mf)) / 1000 : 0);
/** Propellant (kg) needed for dv (km/s) given dry mass without tank and tank fraction. Infinity if impossible. */
export function propellantFor(dvKms: number, ispS: number, dryNoTank: number, tankFrac: number) {
  if (dvKms <= 0) return 0;
  if (ispS <= 0) return Infinity;
  const r = Math.exp((dvKms * 1000) / (ispS * G0)) - 1;
  const den = 1 - tankFrac * r;
  return den <= 0 ? Infinity : (dryNoTank * r) / den;
}
/** Circular orbit period in minutes around Earth. */
export const orbitPeriodMin = (altKm: number) => (2 * Math.PI * Math.sqrt(Math.pow(R_EARTH + altKm, 3) / MU_EARTH)) / 60;
/** Circular orbit speed km/s around Earth. */
export const orbitSpeed = (altKm: number) => Math.sqrt(MU_EARTH / (R_EARTH + altKm));
/** Worst-case eclipse fraction of a circular Earth orbit (cylindrical shadow, beta = 0). */
export const eclipseFraction = (altKm: number) => Math.asin(R_EARTH / (R_EARTH + altKm)) / Math.PI;
/** Solar flux W/m² at r AU. */
export const solarFlux = (au: number) => SOLAR_CONST / (au * au);
/** One-way light time in seconds over a distance in AU. */
export const lightTimeS = (au: number) => (au * AU_KM) / C_KMS;
/** Beginning-of-life array power W at r AU for a given area. */
export const arrayPower = (areaM2: number, au: number) => solarFlux(au) * CELL_EFF * ARRAY_LOSS * areaM2;

export type CheckId = 'budget' | 'mass' | 'payload' | 'life' | 'deorbit' | 'power' | 'battery' | 'thermal' | 'dv' | 'proptype' | 'ionpower'
  | 'relevance' | 'compat' | 'scimin' | 'link' | 'rideorbit' | 'storage' | 'autonomy' | 'dust';
export interface Check { id: CheckId; role: Role; status: 'ok' | 'warn' | 'fail'; actual: number; needed: number; vars?: Record<string, string | number> }

export interface Metrics {
  def: MissionDef; orbit: OrbitDef;
  dry: number; wet: number; launchMass: number; cap: number; massMargin: number; payloadMass: number; payloadCap: number;
  dvAvail: number; dvNeed: number; propNeed: number;
  genBol: number; gen: number; load: number; powerMargin: number; nightNeed: number; battUsable: number; heat: number;
  dataGen: number; dataDown: number; linkFrac: number; rateMbps: number; contactMin: number; lightDelayS: number; storage: number;
  cost: number; budget: number; costParts: Record<string, number>;
  cruiseDays: number; opsDays: number; totalYears: number; lifeYears: number;
  sciRate: number; sciPred: number; sciMin: number; sciFull: number;
  periodMin?: number; eclipseFrac?: number; gsdM?: number;
  checks: Check[]; margin: number;
}

export interface EvalOpts {
  crew?: Role[];
  /** Flight seed: draws this flight's random events. Absent = the expected flight (no random events), used for Pareto and planning. */
  flight?: number;
  /** Force these random events (tests and debugging). */
  events?: string[];
}

export function instrumentWorks(id: string, d: Design, o: OrbitDef) {
  const i = INST[id];
  if (!i || i.mission !== d.mission) return false;
  if (i.req === 'orbiter') return o.kind === 'orbiter';
  if (i.req === 'lander') return o.kind === 'lander';
  if (i.req === 'stay') return o.kind !== 'flyby';
  if (i.req === 'touch') return !!o.touch;
  if (i.req === 'xband') return d.band !== 's';
  return true;
}

export function evaluate(d: Design, opts: EvalOpts = {}): Metrics {
  const def = MISSION[d.mission], diff = DIFF[d.difficulty], crew = opts.crew ?? [];
  const o = def.orbits.find(x => x.id === d.orbit) ?? def.orbits[0];
  const bus = BUS[d.bus], red = REDUND[d.redund], sh = SHIELD[d.shield], pw = POWER[d.power], bat = BATTERY[d.battery];
  const th = THERMAL[d.thermal], pr = PROP[d.prop], av = AVIONICS[d.avionics], an = ANTENNA[d.antenna], bd = BAND[d.band], gr = GROUND[d.ground];
  const lander = o.kind === 'lander';
  const insts = d.instruments.map(i => INST[i]).filter(i => i && i.mission === d.mission);

  // ----- mass
  const busMass = bus.mass * red.massK * (1 + sh.massK) * (lander ? LANDER_BUS_K : 1) * (crew.includes('sc') ? 0.94 : 1);
  const payloadMass = insts.reduce((s, i) => s + i.mass, 0);
  const propKg = pr.isp ? Math.max(0, Math.min(d.propKg, bus.maxProp)) : 0;
  const dryNoTank = busMass + pw.mass + bat.mass + th.mass + pr.dry + av.mass + an.mass + payloadMass;
  const dry = dryNoTank + pr.tank * propKg;
  const wet = dry + propKg;
  const edl = d.mission === 'mars' && lander;
  const launchMass = wet * (edl ? 1 + EDL_K : 1);
  const L = LAUNCHER[d.launcher];
  const cap = L.cap[def.dest] * (def.dest === 'esc' ? Math.max(0, 1 - def.c3 / 80) : 1);
  const massMargin = launchMass > 0 ? cap / launchMass - 1 : 0;

  // ----- time
  const cruiseDays = Math.round(def.cruiseDays * (pr.lowThrust && d.mission !== 'leo' ? ION_DV_K : 1) + (pr.lowThrust && d.mission === 'moon' ? 180 : 0));
  const contractDays = def.days[d.ambition] ?? def.days[0];
  const solar = pw.area > 0;
  const opsDays = o.kind === 'flyby' ? FLYBY_DAYS : Math.min(contractDays, solar && o.maxDays ? o.maxDays : Infinity);
  const totalYears = (cruiseDays + (o.kind === 'flyby' ? 30 : opsDays)) / 365;
  const lifeYears = red.life * diff.lifeK;

  // ----- delta-v
  const dvNeedBase = o.dv + (o.dvPerYear ?? 0) * (opsDays / 365);
  const dvNeed = dvNeedBase * (pr.lowThrust ? ION_DV_K : 1);
  const dvAvail = deltaV(pr.isp, wet, dry);
  const propNeed = pr.isp ? propellantFor(dvNeedBase * (pr.lowThrust ? ION_DV_K : 1) * 1.1, pr.isp, dryNoTank, pr.tank) : Infinity;

  // ----- power (end of life, orbit average)
  const genBol = solar ? arrayPower(pw.area, def.sunAu) : pw.rtgW;
  const gen = solar ? genBol * Math.pow(1 - diff.degr, totalYears) * o.sun : pw.rtgW * Math.pow(1 - RTG_DECAY, totalYears);
  const rtgHeat = pw.rtgW > 0;
  const heat = d.thermal === 'heaters' && !rtgHeat ? o.heat : 0; // RHUs and RTG waste heat need no electrical power
  const instPower = insts.reduce((s, i) => s + i.power, 0);
  const base = bus.power + av.power + bd.power * 0.3;
  const load = base + instPower + heat;
  const powerMargin = load > 0 ? gen / load - 1 : 0;
  const nightLoad = lander ? base * 0.25 + heat : load; // a lander hibernates through the night; an orbiter keeps observing
  const nightNeed = solar ? nightLoad * o.nightH : 0;
  const battUsable = bat.wh * o.dod;

  // ----- data
  const dataGen = insts.reduce((s, i) => s + (instrumentWorks(i.id, d, o) ? i.data : 0), 0);
  const opsK = crew.includes('ops') ? 1.12 : 1;
  let rateMbps: number, contactMin: number;
  if (d.mission === 'leo') {
    rateMbps = Math.min(bd.cap, LEO_REF_MBPS * bd.k * an.gainLeo);
    contactMin = gr.leoPasses * (4 + (o.alt ?? 525) / 130);
  } else if (d.mission === 'mars' && lander && d.band === 's') {
    rateMbps = 0.25; contactMin = 30; // UHF relay through existing Mars orbiters
  } else {
    rateMbps = Math.min(bd.cap, (DEEP_REF_MBPS * an.gainDeep * bd.k * gr.deepK) / (def.earthAu * def.earthAu));
    contactMin = gr.deepHours * 60;
  }
  const dataDown = (rateMbps * contactMin * 60 * opsK) / 1000; // Gb/day
  const storage = av.storage;
  const linkFrac = dataGen <= 0 ? 1 : o.kind === 'flyby' ? Math.min(1, storage / (dataGen * 2)) : Math.min(1, dataDown / dataGen);

  // ----- science
  const sciK = crew.includes('sci') ? 1.08 : 1;
  const sciRate = insts.reduce((s, i) => s + (instrumentWorks(i.id, d, o) ? 10 * (i.rel[d.objective] ?? 0) * (o.sciK?.[d.objective] ?? 1) : 0), 0) * sciK;
  const ambK = [1, 1.1, 1.2][d.ambition] ?? 1; // bigger commitments also demand a richer payload
  const sciMin = def.refRate * contractDays * 0.4 * ambK;
  const sciFull = def.refRate * contractDays * 0.8 * ambK;
  const sciPred = sciRate * opsDays * linkFrac * Math.min(1, Math.max(0, gen / Math.max(load, 1)));

  // ----- cost ($M)
  const hw = {
    bus: bus.cost * red.costK * (lander ? 1.3 : 1) + sh.cost + (edl ? EDL_COST : 0),
    power: pw.cost + bat.cost + th.cost,
    prop: pr.cost + propKg * 0.002,
    avionics: av.cost + an.cost + bd.cost,
    payload: insts.reduce((s, i) => s + i.cost, 0),
  };
  const hwSum = Object.values(hw).reduce((a, b) => a + b, 0);
  const groundYr = d.mission === 'leo' ? gr.leoCost : gr.deepCost;
  const costParts: Record<string, number> = { ...hw, test: hwSum * 0.15, launch: L.cost[def.dest], ops: (groundYr + def.teamCost) * totalYears };
  const cost = Object.values(costParts).reduce((a, b) => a + b, 0);
  const budget = def.budget * diff.budgetK * (crew.includes('sys') ? 1.04 : 1);

  // ----- checks
  const m = diff.margin, checks: Check[] = [];
  const add = (id: CheckId, role: Role, ok: boolean, warn: boolean, actual: number, needed: number, vars?: Check['vars']) =>
    checks.push({ id, role, status: ok ? (warn ? 'warn' : 'ok') : 'fail', actual, needed, vars });
  add('budget', 'sys', cost <= budget, cost > budget * 0.95, cost, budget);
  add('life', 'sys', lifeYears >= totalYears, lifeYears < totalYears * 1.2, lifeYears, totalYears);
  add('payload', 'sys', payloadMass <= bus.payload, false, payloadMass, bus.payload);
  if (d.mission === 'leo' && (o.alt ?? 0) >= 650) add('deorbit', 'sys', dvAvail >= o.dv, false, dvAvail * 1000, o.dv * 1000);
  add('power', 'sc', powerMargin >= 0, powerMargin < m, gen, load, { margin: powerMargin * 100, req: m * 100 });
  if (nightNeed > 0) add('battery', 'sc', battUsable >= nightNeed, battUsable < nightNeed * 1.2, battUsable, nightNeed, { hours: o.nightH, dod: o.dod * 100 });
  if (o.heat > 0) add('thermal', 'sc', d.thermal !== 'passive' || rtgHeat, false, d.thermal === 'passive' && !rtgHeat ? 0 : o.heat, o.heat);
  if (dvNeed > 0 && !(d.mission === 'leo' && (o.alt ?? 0) >= 650)) add('dv', 'sc', dvAvail >= dvNeed, dvAvail < dvNeed * 1.1, dvAvail * 1000, dvNeed * 1000);
  if (lander && pr.lowThrust && d.mission === 'moon') add('proptype', 'sc', false, false, 0, 1);
  if (pr.lowThrust) add('ionpower', 'sc', gen - load >= ION_POWER || d.mission === 'leo', false, Math.max(0, gen - load), ION_POWER);
  if (d.mission === 'mars' && lander && solar) add('dust', 'sc', true, !(battUsable >= nightNeed * 1.5 || d.thermal === 'rhu' || powerMargin >= 1), gen * 0.2, load);
  const relevant = insts.filter(i => instrumentWorks(i.id, d, o) && (i.rel[d.objective] ?? 0) >= 0.8).length;
  add('relevance', 'sci', relevant > 0, false, relevant, 1);
  const bad = insts.filter(i => !instrumentWorks(i.id, d, o));
  if (bad.length) add('compat', 'sci', false, false, bad.length, 0, { inst: bad[0].id });
  add('scimin', 'sci', sciPred >= sciMin, sciPred < sciFull, sciPred, sciMin, { full: sciFull });
  add('mass', 'ops', massMargin >= 0, massMargin < m, launchMass, cap, { margin: massMargin * 100, req: m * 100 });
  if (d.mission === 'leo' && d.launcher === 'ride') add('rideorbit', 'ops', !!o.fixedByRide, false, o.alt ?? 0, 525);
  if (o.kind === 'flyby') add('storage', 'ops', linkFrac >= 1, linkFrac < 1, storage, dataGen * 2);
  else add('link', 'ops', dataDown >= dataGen, dataDown < dataGen * 1.2, dataDown, dataGen, { rate: rateMbps });
  const delay = lightTimeS(def.earthAu);
  if (delay > 30) add('autonomy', 'ops', true, d.avionics !== 'auto', delay, 30);

  const alt = d.mission === 'leo' ? o.alt : undefined;
  return {
    def, orbit: o, dry, wet, launchMass, cap, massMargin, payloadMass, payloadCap: bus.payload, dvAvail, dvNeed, propNeed,
    genBol, gen, load, powerMargin, nightNeed, battUsable, heat: o.heat, dataGen, dataDown, linkFrac, rateMbps, contactMin, lightDelayS: delay, storage,
    cost, budget, costParts, cruiseDays, opsDays, totalYears, lifeYears, sciRate, sciPred, sciMin, sciFull,
    periodMin: alt ? orbitPeriodMin(alt) : undefined, eclipseFrac: alt ? eclipseFraction(alt) : undefined,
    gsdM: alt && d.instruments.includes('cam') ? alt * 1000 * 6e-6 : undefined,
    checks, margin: m,
  };
}

export const failing = (m: Metrics, role?: Role) => m.checks.filter(c => c.status === 'fail' && (!role || c.role === role));

// ---------- defaults, option lists, fixes ----------
export function defaultDesign(mission: Design['mission'], difficulty: Design['difficulty']): Design {
  const def = MISSION[mission];
  return {
    mission, difficulty, objective: def.objectives[0], ambition: 0,
    bus: 'S', redund: 'single', shield: 'light', power: 'solarS', battery: 'S', thermal: 'passive', prop: 'none', propKg: 0, avionics: 'basic',
    instruments: [], launcher: mission === 'leo' ? 'ride' : 'small', orbit: def.orbits[mission === 'leo' || mission === 'neo' ? 1 : 0].id, antenna: 'lga', band: 's', ground: 'single',
  };
}
export function optionsFor(d: Design, f: Field): (string | number)[] {
  const def = MISSION[d.mission];
  if (f === 'objective') return def.objectives;
  if (f === 'ambition') return [0, 1, 2];
  if (f === 'orbit') return def.orbits.map(o => o.id);
  if (f === 'instruments') return INSTRUMENTS.filter(i => i.mission === d.mission).map(i => i.id);
  if (f === 'propKg') return [];
  return OPTIONS[f];
}
export const setField = (d: Design, f: Field, v: unknown): Design => {
  const n = { ...d, [f]: v } as Design;
  if (f === 'bus') n.propKg = Math.min(n.propKg, BUS[n.bus].maxProp);
  if (f === 'prop' && v === 'none') n.propKg = 0;
  return n;
};
/** Propellant load (kg) that covers the required delta-v plus 10 %, clamped to the tank limit. */
export function autoPropellant(d: Design, opts?: EvalOpts): number {
  if (d.prop === 'none') return 0;
  const m = evaluate(d, opts);
  return Math.min(BUS[d.bus].maxProp, Math.ceil(isFinite(m.propNeed) ? m.propNeed : BUS[d.bus].maxProp));
}

export type Patch = Partial<Design>;
const SINGLE_FIELDS: Field[] = ['bus', 'redund', 'shield', 'power', 'battery', 'thermal', 'prop', 'avionics', 'launcher', 'orbit', 'antenna', 'band', 'ground'];
/** All one-decision changes of a design (propellant is re-sized with the propulsion system). */
export function neighbours(d: Design, opts?: EvalOpts): { patch: Patch; design: Design }[] {
  const out: { patch: Patch; design: Design }[] = [];
  for (const f of SINGLE_FIELDS) for (const v of optionsFor(d, f)) {
    if (d[f] === v) continue;
    let n = setField(d, f, v); const patch: Patch = { [f]: v };
    if (f === 'prop' || f === 'bus' || f === 'orbit') { n = { ...n, propKg: autoPropellant(n, opts) }; if (n.propKg !== d.propKg) patch.propKg = n.propKg; }
    out.push({ patch, design: n });
  }
  if (d.prop !== 'none') { const p = autoPropellant(d, opts); if (Math.abs(p - d.propKg) > 0.5) out.push({ patch: { propKg: p }, design: { ...d, propKg: p } }); }
  for (const i of optionsFor(d, 'instruments') as string[]) {
    const instruments = d.instruments.includes(i) ? d.instruments.filter(x => x !== i) : [...d.instruments, i];
    out.push({ patch: { instruments }, design: { ...d, instruments } });
  }
  return out;
}
/** Cheapest single decision that clears a failing check without breaking another one. */
export function findFix(d: Design, id: CheckId, opts?: EvalOpts): Patch | null {
  const before = new Set(failing(evaluate(d, opts)).map(c => c.id));
  let best: { patch: Patch; score: number } | null = null;
  for (const n of neighbours(d, opts)) {
    const m = evaluate(n.design, opts), f = failing(m);
    if (f.some(c => c.id === id)) continue;
    const newFails = f.filter(c => !before.has(c.id)).length;
    const score = newFails * 1e6 + m.cost - m.sciPred * 0.001;
    if (!best || score < best.score) best = { patch: n.patch, score };
  }
  return best?.patch ?? null;
}

/** Continuous measure of how far a design is from passing: each failing check counts 1 plus its relative shortfall. */
export function badness(m: Metrics, role?: Role | null) {
  let b = 0;
  for (const c of m.checks) if (c.status === 'fail' && (!role || c.role === role)) b += 1 + Math.min(1, Math.abs(c.needed - c.actual) / Math.max(Math.abs(c.needed), Math.abs(c.actual), 1e-9));
  return b;
}
const ROLE_FIELDS: Record<Role, Field[]> = {
  sys: ['bus', 'redund', 'shield'], sc: ['power', 'battery', 'thermal', 'prop', 'avionics'], sci: ['instruments'], ops: ['launcher', 'orbit', 'antenna', 'band', 'ground'],
};
/** Assistant for one station: exhaustive search over that station's decisions, everything else held fixed. */
export function assistRole(d: Design, role: Role, opts?: EvalOpts, freeOrbit = false): Design {
  if (role === 'ops' && !freeOrbit) { // the orbit is a deliberate choice: only change it when nothing else closes
    const keep = assistFields(d, role, ROLE_FIELDS.ops.filter(f => f !== 'orbit'), opts);
    return badness(evaluate(keep, opts), 'ops') === 0 ? keep : assistFields(d, role, ROLE_FIELDS.ops, opts);
  }
  return assistFields(d, role, ROLE_FIELDS[role], opts);
}
function assistFields(d: Design, role: Role, fields: Field[], opts?: EvalOpts): Design {
  let combos: Design[] = [d];
  if (role === 'sci') {
    const ids = optionsFor(d, 'instruments') as string[];
    combos = [];
    for (let mask = 1; mask < 1 << ids.length; mask++) combos.push({ ...d, instruments: ids.filter((_, i) => mask & (1 << i)) });
  } else for (const f of fields) combos = combos.flatMap(c => (optionsFor(d, f) as string[]).map(v => ({ ...c, [f]: v }) as Design));
  let best = d, bestScore = Infinity;
  for (let c of combos) {
    c = { ...c, propKg: c.prop === 'none' ? 0 : c.propKg };
    c.propKg = autoPropellant(c, opts);
    const m = evaluate(c, opts);
    const score = badness(m) * 1e6 + (role === 'sci' ? -m.sciPred : m.cost - m.budget * 0.5 * Math.min(1.2, m.sciPred / m.sciFull));
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
/** Assistant for the whole spacecraft: two passes over the four stations. */
export function assist(d: Design, role: Role | null, opts?: EvalOpts): Design {
  if (role) return assistRole(d, role, opts);
  let cur = assistRole(d, 'sci', opts);
  // Bus, launcher and propulsion only close together (a lander needs all three to grow at once): search them jointly.
  let best = cur, bestScore = Infinity;
  for (const bus of OPTIONS.bus) for (const launcher of OPTIONS.launcher) for (const prop of OPTIONS.prop) for (const power of OPTIONS.power) for (const battery of OPTIONS.battery) for (const thermal of OPTIONS.thermal) {
    const c: Design = { ...cur, bus, launcher, prop, power, battery, thermal, propKg: 0 };
    c.propKg = autoPropellant(c, opts);
    const m = evaluate(c, opts), score = badness(m) * 1e6 + m.cost;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  cur = best;
  for (let pass = 0; pass < 5; pass++) {
    for (const r of ['sci', 'ops', 'sc', 'sys'] as Role[]) cur = assistRole(cur, r, opts, pass >= 3);
    if (pass >= 2 && badness(evaluate(cur, opts)) === 0) break;
  }
  return cur;
}

/** Decisions the guided build settles on its own; the player still sees and can change them in the advanced studio. */
export const AUTO_FIELDS: Field[] = ['redund', 'shield', 'thermal', 'avionics', 'band', 'ground'];
/** Settles the secondary decisions and the propellant load around the ones the player made: fewest failing checks, then fewest concerns, then lowest cost. */
export function tidy(d: Design, opts?: EvalOpts, fields: Field[] = AUTO_FIELDS): Design {
  let combos: Design[] = [d];
  for (const f of fields) combos = combos.flatMap(c => (optionsFor(d, f) as string[]).map(v => ({ ...c, [f]: v }) as Design));
  let best = d, bestScore = Infinity;
  for (let c of combos) {
    c = { ...c, propKg: autoPropellant(c, opts) };
    const m = evaluate(c, opts), score = badness(m) * 1e6 + m.checks.filter(x => x.status === 'warn').length * 10 + m.cost;
    if (score < bestScore) { bestScore = score; best = c; }
  }
  return best;
}
