// Application state. One serialisable `Shared` object drives the game in solo and in team rooms (host-authoritative).
import { Design, Field, Role, ROLES, MissionId, Difficulty, FIELD_ROLE, MISSIONS, MISSION } from '../engine/catalog';
import { defaultDesign, setField, evaluate, Metrics, CheckId, assist, autoPropellant } from '../engine/engine';
import { simulate, Result } from '../engine/sim';
import { CREW, CREW_BY_ID } from '../data/crew';
import { joinRoom, Net, NetPeer } from '../net/room';
import { Lang, setLang } from '../i18n';
import { decodeDesign } from '../engine/codec';
import { setSound } from './audio';
import { GUIDED } from '../engine/guided';

export type Screen = 'lobby' | 'missions' | 'contract' | 'studio' | 'review' | 'sim' | 'report';
export interface Seat { peer: string; crew: string }
export interface Vote { go: boolean; reason?: CheckId }
export interface Shared {
  v: number; host: string; screen: Screen; design: Design;
  seats: Record<Role, Seat | null>; votes: Record<Role, Vote | null>; forced: boolean;
  picks: Record<string, string>; shown: number;
  /** Seed of the current flight (random events). `rerun` keeps it for the next launch so a one-change rerun flies the same events. */
  flight: number; rerun?: boolean;
}
export interface Progress { unlocked: number; all: boolean; best: Partial<Record<MissionId, { verdict: string; sci: number }>> }
export interface App {
  lang: Lang; sound: boolean; local: 'home' | 'crew' | null; crew: string | null;
  mode: 'solo' | 'team'; net: 'off' | 'connecting' | 'on' | 'lost' | 'unavailable'; code: string | null; me: string; peers: NetPeer[];
  g: Shared; tab: Role; progress: Progress;
  /** Guided build: current question (GUIDED.length = summary), the mission it belongs to, */
  step: number; stepFor: string; toast: string | null; chat: { crew: string; text: string; mine: boolean }[]; modal: 'credits' | null;
}
type Intent =
  | { t: 'hello' } | { t: 'seat'; role: Role; crew: string } | { t: 'mission'; mission: MissionId; difficulty: Difficulty }
  | { t: 'set'; field: Field; value: unknown } | { t: 'patch'; patch: Partial<Design> } | { t: 'nav'; screen: Screen }
  | { t: 'vote'; role: Role; go: boolean; reason?: CheckId } | { t: 'launch'; forced: boolean } | { t: 'pick'; sit: string; opt: string } | { t: 'step' }
  | { t: 'adopt'; design: Design };

const load = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? { ...d, ...JSON.parse(v) } : d; } catch { return d; } };
const loadStr = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k: string, v: unknown) => { try { localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); } catch { /* storage unavailable */ } };

const emptySeats = (): Record<Role, Seat | null> => ({ sys: null, sc: null, sci: null, ops: null });
const emptyVotes = (): Record<Role, Vote | null> => ({ sys: null, sc: null, sci: null, ops: null });
const newShared = (host: string, screen: Screen): Shared => ({ v: 1, host, screen, design: defaultDesign('leo', 'engineer'), seats: emptySeats(), votes: emptyVotes(), forced: false, picks: {}, shown: 0, flight: 1 });

const storedLang = loadStr('sa.lang') as Lang | null, storedCrew = loadStr('sa.crew');
export const app: App = {
  lang: storedLang && ['en', 'pt', 'es'].includes(storedLang) ? storedLang : 'en', sound: loadStr('sa.sound') !== '0', local: 'home', crew: storedCrew && CREW_BY_ID[storedCrew] ? storedCrew : null,
  mode: 'solo', net: 'off', code: null, me: 'solo', peers: [], g: newShared('solo', 'missions'), tab: 'sys', step: 0, stepFor: '',
  progress: load<Progress>('sa.progress', { unlocked: 0, all: false, best: {} }), toast: null, chat: [], modal: null,
};
setLang(app.lang);

const subs = new Set<() => void>();
export const subscribe = (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; };
let cache: { key: string; m: Metrics; r: Result } | null = null;
export function notify() { subs.forEach(f => f()); saveSolo(); }
// ---------- solo game kept across reloads (a closed tab or a refresh does not lose the spacecraft) ----------
const SCREENS: Screen[] = ['missions', 'studio', 'review', 'sim', 'report'];
let lastSaved = '';
function saveSolo() {
  if (app.mode !== 'solo' || app.local !== null || !app.crew) return;
  const s = JSON.stringify({ g: app.g, step: app.step, crew: app.crew });
  if (s !== lastSaved) { lastSaved = s; save('sa.game', s); }
}
/** The solo game saved on this device, if it is past the mission list. */
export function savedGame(): { g: Shared; step: number; crew: string } | null {
  try {
    const v = JSON.parse(loadStr('sa.game') || 'null');
    if (!v?.g?.design || !MISSION[v.g.design.mission as MissionId] || !SCREENS.includes(v.g.screen) || v.g.screen === 'missions' || !CREW_BY_ID[v.crew]) return null;
    evaluate(v.g.design); return v;
  } catch { return null; }
}
export function resumeGame() {
  const v = savedGame(); if (!v) return false;
  leaveRoom(); app.mode = 'solo'; app.me = 'solo'; app.net = 'off'; app.crew = v.crew;
  app.g = { ...newShared('solo', 'missions'), ...v.g, host: 'solo' }; app.step = Math.max(0, Math.min(GUIDED.length, Number(v.step) || 0)); app.stepFor = app.g.design.mission + ':' + app.g.design.difficulty;
  app.local = null; notify(); return true;
}
export const screen = () => app.local ?? app.g.screen;
export const isHost = () => app.g.host === app.me;
export const myRole = (): Role | null => ROLES.find(r => app.g.seats[r]?.peer === app.me) ?? null;
/** A station is yours when you sit at it, or when nobody does (autopilot seats are shared). */
export const canEdit = (role: Role) => { const s = app.g.seats[role]; return !s || s.peer === app.me; };
export const crewPerks = (g = app.g): Role[] => ROLES.filter(r => { const s = g.seats[r]; return !!s && CREW_BY_ID[s.crew]?.role === r; });
/** Options for simulating the flight being flown: crew perks plus this flight's random-event seed. */
export const simOpts = (g = app.g) => ({ crew: crewPerks(g), flight: g.flight ?? 1 });
/** Metrics and simulation of the current shared state (memoised on the state version). */
export function derived() {
  const g = app.g, key = JSON.stringify([g.design, g.picks, crewPerks(), g.flight]);
  if (!cache || cache.key !== key) { const o = simOpts(); cache = { key, m: evaluate(g.design, o), r: simulate(g.design, g.picks, o) }; }
  return cache;
}
export function toast(msg: string) { app.toast = msg; notify(); setTimeout(() => { if (app.toast === msg) { app.toast = null; notify(); } }, 2600); }

// ---------- local actions ----------
export function chooseLang(l: Lang) { app.lang = l; setLang(l); save('sa.lang', l); notify(); }
export function toggleSound() { app.sound = !app.sound; setSound(app.sound); save('sa.sound', app.sound ? '1' : '0'); notify(); }
/** The player picks their astronaut on the crew screen; the choice is remembered for the next visit. */
export function chooseCrew(id: string) {
  if (!CREW_BY_ID[id]) return;
  app.crew = id; save('sa.crew', id);
  net?.presence({ crew: app.crew });
  notify();
}
/** Crew members other players in the room have picked (picks may repeat between players). */
export const teammateCrew = () => new Set(app.peers.filter(p => !p.isMe).map(p => p.presence.crew as string));
/** Used when a shared design link skips the crew screen: pick someone not already in the room. */
export function drawCrew(seed = Math.random()) {
  const taken = teammateCrew(), pool = CREW.filter(c => !taken.has(c.id));
  chooseCrew((pool.length ? pool : CREW)[Math.floor(seed * (pool.length || CREW.length))].id);
}
export function goLocal(s: App['local']) { app.local = s; notify(); }
export function setTab(r: Role) { app.tab = r; notify(); }
export function openModal(m: App['modal']) { app.modal = m; notify(); }
export function unlockAll() { app.progress.all = true; save('sa.progress', app.progress); notify(); }
export const unlocked = (m: MissionId) => app.mode === 'team' || app.progress.all || MISSIONS.indexOf(m) <= app.progress.unlocked;
export function recordResult(r: Result) {
  const m = app.g.design.mission, prev = app.progress.best[m], rank = { fail: 0, min: 1, full: 2 } as Record<string, number>;
  let newly = false;
  if (!prev || rank[r.verdict] > rank[prev.verdict] || (rank[r.verdict] === rank[prev.verdict] && r.science > prev.sci)) app.progress.best[m] = { verdict: r.verdict, sci: Math.round(r.science) };
  if (r.verdict !== 'fail' && MISSIONS.indexOf(m) === app.progress.unlocked && app.progress.unlocked < MISSIONS.length - 1) { app.progress.unlocked++; newly = true; }
  save('sa.progress', app.progress);
  return newly;
}

// ---------- solo / team entry ----------
export function startSolo(code?: string) {
  leaveRoom(); app.mode = 'solo'; app.me = 'solo'; app.net = 'off';
  app.g = newShared('solo', 'missions');
  const c = CREW_BY_ID[app.crew!]; app.g.seats[c.role] = { peer: 'solo', crew: c.id }; app.tab = c.role;
  const d = code ? decodeDesign(code) : null;
  if (d) { app.g.design = d; app.g.screen = 'studio'; app.progress.all = true; app.step = GUIDED.length; app.stepFor = d.mission + ':' + d.difficulty; }
  app.local = null; notify();
}
let net: Net | null = null, beat: ReturnType<typeof setInterval> | null = null, hostMissing = 0;
export function leaveRoom() { if (beat) clearInterval(beat); beat = null; net?.leave(); net = null; app.peers = []; app.code = null; app.chat = []; }
export const randomCode = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ'[Math.floor(Math.random() * 24)]).join('');
export async function enterRoom(code: string, create: boolean) {
  leaveRoom(); app.mode = 'team'; app.net = 'connecting'; app.code = code.toUpperCase(); app.local = null; app.g = newShared('', 'lobby'); notify();
  const n = await joinRoom(code);
  if (!n) { app.net = 'unavailable'; notify(); return; }
  net = n; app.net = 'on';
  // the platform assigns our peer label once the room answers
  for (let i = 0; i < 40 && !n.me(); i++) await new Promise(r => setTimeout(r, 100));
  app.me = n.me() || 'p' + Math.random().toString(36).slice(2, 8);
  n.presence({ crew: app.crew });
  let got = false;
  n.on('state', (data: Shared) => {
    if (!data || typeof data.v !== 'number' || !data.design) return;
    if (data.host === app.me && app.g.host === app.me) return; // our own authority wins
    if (data.v >= app.g.v || data.host !== app.g.host) { got = true; hostMissing = 0; app.g = data; notify(); }
  });
  n.on('intent', (it: Intent, from: string) => { if (isHost()) { if (it?.t === 'hello') broadcast(); else applyIntent(it, from); } });
  n.on('chat', (m: { crew: string; text: string }) => { if (typeof m?.text === 'string') { app.chat = [...app.chat.slice(-29), { crew: String(m.crew), text: m.text.slice(0, 200), mine: false }]; notify(); } });
  n.onPeers(() => { app.peers = n.peers(); if (isHost()) pruneSeats(); notify(); });
  n.onLost(() => { app.net = 'lost'; notify(); });
  app.peers = n.peers();
  n.emit('intent', { t: 'hello' });
  if (!create) for (let i = 0; i < 25 && !got; i++) await new Promise(r => setTimeout(r, 100));
  if (!got) { app.g = newShared(app.me, 'lobby'); broadcast(); }
  beat = setInterval(() => {
    if (!net) return;
    app.peers = net.peers();
    if (isHost()) { pruneSeats(); broadcast(); return; }
    const ids = app.peers.map(p => p.peer);
    if (ids.includes(app.g.host)) { hostMissing = 0; return; }
    if (++hostMissing >= 3 && [...ids].sort()[0] === app.me) { app.g = { ...app.g, host: app.me, v: app.g.v + 1 }; hostMissing = 0; broadcast(); notify(); }
  }, 1500);
  notify();
}
function pruneSeats() {
  const ids = new Set(app.peers.map(p => p.peer)); let ch = false;
  for (const r of ROLES) { const s = app.g.seats[r]; if (s && !ids.has(s.peer)) { app.g.seats[r] = null; ch = true; } }
  if (ch) { app.g.v++; notify(); }
}
function broadcast() { net?.emit('state', app.g); }
export function sendChat(text: string) {
  const tx = text.trim().slice(0, 200); if (!tx || !net) return;
  net.emit('chat', { crew: app.crew, text: tx }); app.chat = [...app.chat.slice(-29), { crew: app.crew ?? '', text: tx, mine: true }]; notify();
}

// ---------- shared actions ----------
export function act(it: Intent) {
  if (app.mode === 'solo' || isHost()) applyIntent(it, app.me);
  else net?.emit('intent', it);
}
const owns = (from: string, role: Role, g: Shared) => { const s = g.seats[role]; return !s || s.peer === from; };
function applyIntent(it: Intent, from: string) {
  const g = app.g, hostCmd = from === g.host;
  let d = g.design, touched = false;
  switch (it.t) {
    case 'seat': {
      if (!ROLES.includes(it.role) || (g.seats[it.role] && g.seats[it.role]!.peer !== from)) return;
      for (const r of ROLES) if (g.seats[r]?.peer === from) g.seats[r] = null;
      g.seats[it.role] = { peer: from, crew: String(it.crew) }; break;
    }
    case 'mission': if (!hostCmd) return; g.design = defaultDesign(it.mission, it.difficulty); g.screen = 'studio'; g.votes = emptyVotes(); break;
    case 'set': {
      if (!(it.field in FIELD_ROLE) || !owns(from, FIELD_ROLE[it.field], g)) return;
      d = setField(d, it.field, it.value); touched = true; break;
    }
    case 'patch': {
      for (const [f, v] of Object.entries(it.patch ?? {})) { if (!(f in FIELD_ROLE) || !owns(from, FIELD_ROLE[f as Field], g)) continue; d = f === 'propKg' ? { ...d, propKg: Number(v) || 0 } : setField(d, f as Field, v); }
      touched = true; break;
    }
    case 'nav': {
      if (!hostCmd) return;
      g.screen = it.screen;
      if (it.screen === 'review') g.votes = emptyVotes();
      if (it.screen === 'missions' || it.screen === 'studio') { g.picks = {}; g.shown = 0; g.forced = false; }
      break;
    }
    case 'vote': if (g.seats[it.role]?.peer !== from) return; g.votes[it.role] = { go: !!it.go, reason: it.reason }; break;
    case 'launch': if (!hostCmd) return; g.forced = !!it.forced;
      if (!g.rerun) g.flight = 1 + Math.floor(Math.random() * 2147483646); g.rerun = false; g.picks = {}; g.shown = 0; g.screen = 'sim'; break;
    case 'pick': {
      const r = simulate(d, g.picks, simOpts(g)), e = r.timeline[r.timeline.length - 1];
      if (!r.pending || !e || e.id !== it.sit || !e.options.includes(it.opt) || !owns(from, e.role, g)) return;
      g.picks = { ...g.picks, [it.sit]: it.opt }; break;
    }
    case 'step': g.shown++; break;
    case 'adopt': if (!hostCmd) return; d = it.design; touched = true; g.screen = 'studio'; g.picks = {}; g.shown = 0; g.forced = false; g.rerun = true; break;
    default: return;
  }
  if (touched) { g.design = d; g.votes = emptyVotes(); }
  g.v++; broadcast(); notify();
}
/** Run the sizing assistant on one station (or the whole design) and send the result as a patch. Returns the number of changed decisions. */
export function runAssist(role: Role | null) {
  const before = app.g.design, after = assist(before, role, { crew: crewPerks() });
  const patch: Partial<Design> = {};
  for (const k of Object.keys(after) as (keyof Design)[]) if (JSON.stringify(after[k]) !== JSON.stringify(before[k])) (patch as any)[k] = after[k];
  if (Object.keys(patch).length) act({ t: 'patch', patch });
  return Object.keys(patch).length;
}
export function autoProp() { act({ t: 'set', field: 'propKg', value: autoPropellant(app.g.design, { crew: crewPerks() }) }); }
/** Leave any room and return to the title screen. */
export function quit() { leaveRoom(); app.mode = 'solo'; app.net = 'off'; app.me = 'solo'; app.local = 'home'; notify(); }
