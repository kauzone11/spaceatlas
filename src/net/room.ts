// Thin transport over the artifact `room` capability (one named room per game code).
// Outside a viewer (local dev, tests) a BroadcastChannel stands in so several tabs can play together.
export interface NetPeer { peer: string; isMe: boolean; presence: Record<string, unknown> }
export interface Net {
  me: () => string; peers: () => NetPeer[]; onPeers: (cb: () => void) => void;
  emit: (topic: string, data: unknown) => void; on: (topic: string, cb: (data: any, from: string) => void) => void;
  presence: (p: Record<string, unknown>) => void; leave: () => void; onLost: (cb: () => void) => void;
}
declare global { interface Window { claude?: { use: (n: string) => Promise<any> } } }

export async function roomAvailable(): Promise<boolean> {
  if (!window.claude?.use) return typeof BroadcastChannel !== 'undefined' && location.protocol !== 'about:';
  try { return !!(await window.claude.use('room')); } catch { return false; }
}

export async function joinRoom(code: string): Promise<Net | null> {
  const name = 'sa-' + code.toLowerCase();
  if (window.claude?.use) {
    let lobby: any = null;
    try { lobby = await window.claude.use('room'); } catch { /* unavailable */ }
    if (!lobby) return null;
    let room: any;
    try { room = await lobby.join(name); } catch { return null; }
    const lost: (() => void)[] = []; const fail = () => lost.forEach(f => f());
    const meId = () => (room.peers() as any[]).find(p => p.isMe && p.sameTab)?.peer ?? '';
    return {
      me: meId,
      peers: () => (room.peers() as any[]).filter(p => p.kind !== 'agent' && (!p.isMe || p.sameTab)).map(p => ({ peer: p.peer, isMe: p.isMe && p.sameTab, presence: p.presence ?? {} })),
      onPeers: cb => { room.onPeers(() => cb(), fail); },
      emit: (topic, data) => { room.emit(topic, data).catch(() => {}); },
      on: (topic, cb) => { room.on(topic, (m: any) => { if (!(m.isMe && m.sameTab)) cb(m.data, m.peer); }, fail); },
      presence: p => { room.presence(p).catch(() => {}); },
      leave: () => { room.leave().catch(() => {}); },
      onLost: cb => { lost.push(cb); },
    };
  }
  if (typeof BroadcastChannel === 'undefined') return null;
  // ---- local stand-in
  const id = 'p' + Math.random().toString(36).slice(2, 10);
  const ch = new BroadcastChannel(name);
  const peers = new Map<string, { presence: Record<string, unknown>; seen: number }>();
  let mine: Record<string, unknown> = {};
  const handlers: Record<string, ((d: any, from: string) => void)[]> = {}; const peerCbs: (() => void)[] = [];
  const beat = () => ch.postMessage({ k: 'beat', id, presence: mine });
  ch.onmessage = ev => {
    const m = ev.data;
    if (m.k === 'beat') { const isNew = !peers.has(m.id); peers.set(m.id, { presence: m.presence, seen: Date.now() }); peerCbs.forEach(f => f()); if (isNew) beat(); }
    else if (m.k === 'bye') { peers.delete(m.id); peerCbs.forEach(f => f()); }
    else if (m.k === 'msg') (handlers[m.topic] ?? []).forEach(f => f(m.data, m.id));
  };
  const timer = setInterval(() => {
    beat(); let ch2 = false;
    for (const [k, v] of peers) if (Date.now() - v.seen > 4000) { peers.delete(k); ch2 = true; }
    if (ch2) peerCbs.forEach(f => f());
  }, 1000);
  beat();
  addEventListener('pagehide', () => ch.postMessage({ k: 'bye', id }));
  return {
    me: () => id,
    peers: () => [{ peer: id, isMe: true, presence: mine }, ...[...peers].map(([peer, v]) => ({ peer, isMe: false, presence: v.presence }))],
    onPeers: cb => { peerCbs.push(cb); },
    emit: (topic, data) => ch.postMessage({ k: 'msg', topic, data, id }),
    on: (topic, cb) => { (handlers[topic] ??= []).push(cb); },
    presence: p => { mine = { ...mine, ...p }; beat(); },
    leave: () => { clearInterval(timer); ch.postMessage({ k: 'bye', id }); ch.close(); },
    onLost: () => {},
  };
}
