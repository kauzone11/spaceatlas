// Interface sounds synthesised with Web Audio: no audio files. Starts only after a user gesture.
let ctx: AudioContext | null = null, master: GainNode | null = null, drone: { stop: () => void } | null = null, enabled = true;
function ensure() {
  if (!enabled) return null;
  try {
    if (!ctx) { ctx = new (window.AudioContext || (window as any).webkitAudioContext)(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
  } catch { return null; }
  return ctx;
}
function tone(freq: number, dur: number, type: OscillatorType = 'sine', gain = 0.08, when = 0, slide = 0) {
  const c = ensure(); if (!c || !master) return;
  const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + when;
  o.type = type; o.frequency.setValueAtTime(freq, t0); if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g); g.connect(master); o.start(t0); o.stop(t0 + dur + 0.02);
}
export const sfx = {
  tap: () => tone(660, 0.07, 'sine', 0.05),
  select: () => { tone(520, 0.08, 'triangle', 0.06); tone(780, 0.1, 'triangle', 0.05, 0.05); },
  good: () => { [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'sine', 0.06, i * 0.08)); },
  bad: () => { tone(196, 0.35, 'sawtooth', 0.04, 0, 0.6); tone(147, 0.45, 'sine', 0.07, 0.05, 0.7); },
  alert: () => { tone(880, 0.12, 'square', 0.03); tone(880, 0.12, 'square', 0.03, 0.2); },
  launch: () => { tone(60, 2.2, 'sawtooth', 0.07, 0, 3); tone(90, 2.2, 'triangle', 0.05, 0, 2.5); },
  whoosh: () => tone(300, 0.5, 'sine', 0.03, 0, 0.3),
};
export function setSound(on: boolean) {
  enabled = on;
  if (!on) { drone?.stop(); drone = null; if (ctx && ctx.state === 'running') ctx.suspend(); }
  else startDrone();
}
export function startDrone() {
  const c = ensure(); if (!c || !master || drone) return;
  const g = c.createGain(); g.gain.value = 0.0001; g.gain.exponentialRampToValueAtTime(0.018, c.currentTime + 3);
  const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 320;
  const os = [55, 82.5, 110.6].map(fr => { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = fr; o.connect(f); o.start(); return o; });
  f.connect(g); g.connect(master);
  drone = { stop: () => { os.forEach(o => { try { o.stop(); } catch { /* already stopped */ } }); g.disconnect(); } };
}
