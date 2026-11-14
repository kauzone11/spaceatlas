// NASA open data at run time. The game starts on the dated snapshot (src/data/nasa.ts) and, where the page may reach NASA's APIs
// (a normal web host; not inside a Claude artifact, whose sandbox blocks outside requests), swaps in today's data.
// Live data only changes texts and the briefing cards, never the simulation, so team members always fly the same flight.
import { NASA } from '../data/nasa';
import { parseDonkiCme, parseDonkiGst, parseNeoWs, parseEonet, Cme, Gst, Neo, Ev } from './nasa-parse';

export interface NasaData { date: string; cme: Cme[]; gst: Gst[]; neo: Neo[]; eonet: Ev[] }
export const nasa: { data: NasaData; live: boolean } = { data: NASA, live: false };

const KEY = 'DEMO_KEY', CACHE = 'sa.nasa', TTL = 3 * 3600e3;
const day = (d: Date) => d.toISOString().slice(0, 10);
async function get(url: string, ms = 7000) {
  const c = new AbortController(), id = setTimeout(() => c.abort(), ms);
  try { const r = await fetch(url, { signal: c.signal }); if (!r.ok) throw new Error(String(r.status)); return await r.json(); } finally { clearTimeout(id); }
}
/** Try NASA's APIs once; on any failure keep the snapshot. Calls `done` only when live data arrived. */
export async function loadLive(done: () => void) {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE) || 'null');
    if (c && c.fail && Date.now() - c.at < 3600e3) return; // blocked or rate-limited within the last hour: do not ask again
    if (c && Date.now() - c.at < TTL && c.data?.cme) { nasa.data = c.data; nasa.live = true; done(); return; }
  } catch { /* storage unavailable */ }
  if (typeof fetch !== 'function') return;
  const now = new Date(), from = (n: number) => day(new Date(now.getTime() - n * 864e5));
  const all = await Promise.allSettled([
    get(`https://api.nasa.gov/DONKI/CME?startDate=${from(45)}&endDate=${day(now)}&api_key=${KEY}`),
    get(`https://api.nasa.gov/DONKI/GST?startDate=${from(59)}&endDate=${day(now)}&api_key=${KEY}`),
    get(`https://api.nasa.gov/neo/rest/v1/feed?start_date=${day(now)}&end_date=${day(new Date(now.getTime() + 6 * 864e5))}&api_key=${KEY}`),
    get('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&limit=60'),
  ]);
  const val = <T,>(i: number, f: (x: unknown) => T[]) => { const r = all[i]; if (r.status !== 'fulfilled') return null; const v = f(r.value); return v.length ? v : null; }; // empty = nothing new: keep the snapshot list
  const cme = val(0, parseDonkiCme), gst = val(1, parseDonkiGst), neo = val(2, parseNeoWs), eonet = val(3, parseEonet);
  if (!cme && !gst && !neo && !eonet) { // blocked, offline or rate-limited: stay on the snapshot
    try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), fail: true })); } catch { /* storage unavailable */ }
    return;
  }
  nasa.data = { date: day(now), cme: cme ?? NASA.cme, gst: gst ?? NASA.gst, neo: neo ?? NASA.neo, eonet: eonet ?? NASA.eonet };
  nasa.live = true;
  try { localStorage.setItem(CACHE, JSON.stringify({ at: Date.now(), data: nasa.data })); } catch { /* storage unavailable */ }
  done();
}
/** A real CME for this flight, picked by the flight seed among the last weeks' events (fast ones first). */
export function cmeFor(seed: number): Cme | null {
  const fast = nasa.data.cme.filter(c => c.speed >= 500), pool = fast.length ? fast : nasa.data.cme;
  return pool.length ? pool[seed % pool.length] : null;
}
