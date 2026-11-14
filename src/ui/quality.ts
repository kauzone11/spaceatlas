// Rendering quality. Starts from what the device says about itself, then watches real frame times and steps down
// (never up within a session) when frames run long. A step down is remembered, so a slow device starts low next time.
//   2 high:   pixel ratio up to 2, sun shadows on the pad, full particles, 4096-px planet maps on desktops
//   1 medium: pixel ratio up to 1.5, smaller shadow map, 60 % particles, standard maps
//   0 low:    pixel ratio 1, no shadows, 35 % particles, fewer trees, menus drawn at 30 fps
export type Tier = 0 | 1 | 2;
const KEY = 'sa.tier';

function guess(): Tier {
  try {
    const q = new URLSearchParams(location.search).get('q');
    if (q === 'low') return 0; if (q === 'medium') return 1; if (q === 'high') return 2;
    const saved = localStorage.getItem(KEY); if (saved === '0' || saved === '1') return +saved as Tier;
  } catch { /* storage or location unavailable */ }
  try {
    const n = navigator as Navigator & { deviceMemory?: number };
    const mem = n.deviceMemory ?? 8, cores = n.hardwareConcurrency ?? 8, touch = matchMedia('(pointer: coarse)').matches;
    if (mem <= 2 || cores <= 2) return 0;
    if (touch || mem <= 4 || cores <= 4) return 1;
  } catch { /* old browser */ }
  return 2;
}

const listeners = new Set<(t: Tier) => void>();
export const Q = {
  tier: guess() as Tier,
  /** Planet maps: 4096 px only for high tier on a non-touch screen. */
  get hd() { try { return Q.tier === 2 && !matchMedia('(pointer: coarse)').matches; } catch { return false; } },
  get maxPr() { return [1, 1.5, 2][Q.tier]; },
  /** Particle emission multiplier (smoke, steam, sparks). */
  get fx() { return [0.35, 0.6, 1][Q.tier]; },
  get shadowMap() { return [0, 1024, 2048][Q.tier]; },
  /** Minimum ms between frames outside the flight films (menus, studio). */
  get idleFrameMs() { return Q.tier === 0 ? 31 : 0; },
  onChange(f: (t: Tier) => void) { listeners.add(f); return () => listeners.delete(f); },
  set(t: Tier, remember = false) {
    if (t === Q.tier) return; Q.tier = t;
    if (remember) try { localStorage.setItem(KEY, String(t)); } catch { /* storage unavailable */ }
    listeners.forEach(f => f(t));
  },
};

/** Frame-time governor: an exponential average of frame time; if it stays above the budget for a while, drop one tier. */
let ema = 16.7, slowFor = 0, grace = 1.5;
export function sample(dtMs: number, busy: boolean) {
  if (dtMs > 1200) return; // tab switch or a one-off long task (texture upload), not a steady rate
  grace -= dtMs / 1000; if (grace > 0) return; // ignore the first frames after start or a change
  ema += (dtMs - ema) * 0.08;
  const budget = busy ? 26 : 34; // films must stay near 40 fps; menus can tolerate ~30
  slowFor = ema > budget ? slowFor + dtMs / 1000 : 0;
  if (slowFor > 2 && Q.tier > 0) { slowFor = 0; grace = 2.5; ema = 16.7; Q.set((Q.tier - 1) as Tier, true); }
}
export const frameStats = () => ({ tier: Q.tier, ema: Math.round(ema * 10) / 10 });
