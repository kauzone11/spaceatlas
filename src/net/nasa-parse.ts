// Parsers shared by the snapshot script (Node) and the live loader (browser): raw NASA API JSON -> the small records the game uses.
/** DONKI CME: date, fastest analysed speed (km/s) and type (S, C, O, R, ER), fastest first-seen order kept. */
/* eslint-disable @typescript-eslint/no-explicit-any */
export interface Cme { id: string; date: string; speed: number; type: string; link: string }
export interface Gst { id: string; date: string; kp: number; link: string }
export interface Neo { name: string; date: string; ld: number; kms: number; dMin: number; dMax: number; hazardous: boolean }
export interface Ev { id: string; title: string; cat: string; date: string; lon: number; lat: number; src: string }
export function parseDonkiCme(raw: any): Cme[] {
  const out: Cme[] = [];
  for (const c of raw || []) {
    const an = (c.cmeAnalyses || []).filter((a: any) => a && a.speed);
    if (!an.length) continue;
    const best = an.reduce((a: any, b: any) => (b.isMostAccurate ? b : a.isMostAccurate ? a : b.speed > a.speed ? b : a));
    out.push({ id: c.activityID, date: String(c.startTime).slice(0, 10), speed: Math.round(best.speed), type: best.type || '', link: c.link || '' });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 25);
}
/** DONKI GST: start date and peak planetary Kp. */
export function parseDonkiGst(raw: any): Gst[] {
  return (raw || []).map((g: any) => ({ id: g.gstID, date: String(g.startTime).slice(0, 10), kp: Math.max(0, ...(g.allKpIndex || []).map((k: any) => +k.kpIndex || 0)), link: g.link || '' }))
    .sort((a: Gst, b: Gst) => (a.date < b.date ? 1 : -1)).slice(0, 15);
}
/** NeoWs feed: close approaches this week, closest first. Diameter is the estimated range in metres. */
export function parseNeoWs(raw: any): Neo[] {
  const out: Neo[] = [];
  for (const list of Object.values((raw && raw.near_earth_objects) || {}) as any[][]) for (const o of list) {
    const ca = (o.close_approach_data || [])[0]; if (!ca) continue;
    const dm = o.estimated_diameter && o.estimated_diameter.meters;
    out.push({ name: String(o.name).replace(/[()]/g, '').trim(), date: ca.close_approach_date, ld: +(+ca.miss_distance.lunar).toFixed(2), kms: +(+ca.relative_velocity.kilometers_per_second).toFixed(1),
      dMin: dm ? Math.round(dm.estimated_diameter_min) : 0, dMax: dm ? Math.round(dm.estimated_diameter_max) : 0, hazardous: !!o.is_potentially_hazardous_asteroid });
  }
  return out.sort((a, b) => a.ld - b.ld).slice(0, 12);
}
/** EONET v3 open events: one record per event, latest geometry. */
export function parseEonet(raw: any): Ev[] {
  const out: Ev[] = [];
  for (const e of (raw && raw.events) || []) {
    const g = (e.geometry || [])[e.geometry.length - 1]; if (!g || g.type !== 'Point') continue;
    out.push({ id: e.id, title: e.title, cat: (e.categories || [])[0] ? e.categories[0].id : '', date: String(g.date).slice(0, 10), lon: g.coordinates[0], lat: g.coordinates[1], src: (e.sources || [])[0] ? e.sources[0].id : '' });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 30);
}
