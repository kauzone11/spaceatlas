// Design <-> short share code using only letters, digits and hyphens (the only characters an artifact URL hash keeps).
import { Design, MISSIONS, MISSION, OPTIONS, INSTRUMENTS } from './catalog';
const DIFFS = ['cadet', 'engineer', 'director'] as const;
const FIELDS = ['bus', 'redund', 'shield', 'power', 'battery', 'thermal', 'prop', 'avionics', 'launcher', 'antenna', 'band', 'ground'] as const;
const B = '0123456789abcdefghijklmnopqrstuvwxyz';
export function encodeDesign(d: Design): string {
  const def = MISSION[d.mission], ids = INSTRUMENTS.filter(i => i.mission === d.mission).map(i => i.id);
  let s = B[MISSIONS.indexOf(d.mission)] + B[DIFFS.indexOf(d.difficulty)] + B[def.objectives.indexOf(d.objective)] + B[d.ambition] + B[def.orbits.findIndex(o => o.id === d.orbit)];
  for (const f of FIELDS) s += B[OPTIONS[f].indexOf(d[f])];
  const mask = ids.reduce((m, id, i) => m | (d.instruments.includes(id) ? 1 << i : 0), 0);
  return `sa1-${s}-${mask.toString(36)}-${Math.round(d.propKg).toString(36)}`;
}
export function decodeDesign(code: string): Design | null {
  const m = /^sa1-([0-9a-z]{17})-([0-9a-z]+)-([0-9a-z]+)$/.exec(code.trim().toLowerCase().replace(/^#/, ''));
  if (!m) return null;
  const ix = [...m[1]].map(c => B.indexOf(c));
  const mission = MISSIONS[ix[0]], difficulty = DIFFS[ix[1]];
  if (!mission || !difficulty) return null;
  const def = MISSION[mission], objective = def.objectives[ix[2]], orbit = def.orbits[ix[4]]?.id;
  if (!objective || !orbit || ix[3] > 2) return null;
  const d = { mission, difficulty, objective, ambition: ix[3], orbit } as Design;
  for (let i = 0; i < FIELDS.length; i++) { const v = OPTIONS[FIELDS[i]][ix[5 + i]]; if (!v) return null; d[FIELDS[i]] = v; }
  const ids = INSTRUMENTS.filter(i => i.mission === mission).map(i => i.id), mask = parseInt(m[2], 36);
  d.instruments = ids.filter((_, i) => mask & (1 << i));
  d.propKg = d.prop === 'none' ? 0 : Math.min(parseInt(m[3], 36) || 0, 7000);
  return d;
}
