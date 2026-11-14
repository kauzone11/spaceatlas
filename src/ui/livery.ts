// Procedural liveries: panel lines, soot, lettering, the flag and the SpaceAtlas mission emblem, painted on canvas.
// The emblem is original artwork for this game. NASA's insignia, logotype and seal need NASA's written permission,
// so they are not used anywhere (see README, "Credits & Sources").
import * as THREE from 'three';

const FONT = '"Inter", "Helvetica Neue", Arial, sans-serif';
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mk = (w: number, h: number) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

function star(x: CanvasRenderingContext2D, cx: number, cy: number, r: number) {
  x.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.42 : r; x.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); } x.closePath(); x.fill();
}

let emblemC: HTMLCanvasElement | null = null;
/** SpaceAtlas mission emblem: a patch with an Earth limb, an ascent trail and a star. */
export function emblem(): HTMLCanvasElement {
  if (emblemC) return emblemC;
  const S = 512, c = mk(S, S), x = c.getContext('2d')!, m = S / 2;
  x.fillStyle = '#e9eef6'; x.beginPath(); x.arc(m, m, 254, 0, 7); x.fill();
  x.fillStyle = '#1846a8'; x.beginPath(); x.arc(m, m, 246, 0, 7); x.fill();
  const g = x.createRadialGradient(m - 40, m - 60, 20, m, m, 190); g.addColorStop(0, '#13285a'); g.addColorStop(1, '#060d22');
  x.fillStyle = g; x.beginPath(); x.arc(m, m, 186, 0, 7); x.fill();
  x.save(); x.beginPath(); x.arc(m, m, 186, 0, 7); x.clip();
  const r = rng(3); x.fillStyle = '#ffffff'; for (let i = 0; i < 40; i++) { const a = r() * 6.28, d = r() * 170; x.globalAlpha = 0.4 + r() * 0.6; x.beginPath(); x.arc(m + Math.cos(a) * d, m - 30 + Math.sin(a) * d * 0.7, 1 + r() * 2, 0, 7); x.fill(); }
  x.globalAlpha = 1;
  // Earth limb
  const ex = m, ey = m + 250, er = 230; const eg = x.createRadialGradient(ex - 60, ey - 200, 20, ex, ey, er); eg.addColorStop(0, '#3d8cf0'); eg.addColorStop(1, '#0d3a85');
  x.fillStyle = eg; x.beginPath(); x.arc(ex, ey, er, 0, 7); x.fill();
  x.strokeStyle = 'rgba(255,255,255,.55)'; x.lineWidth = 3;
  for (const k of [0.35, 0.65]) { x.beginPath(); x.ellipse(ex, ey, er, er * k, 0, Math.PI, 2 * Math.PI); x.stroke(); }
  for (const k of [-0.55, 0, 0.55]) { x.beginPath(); x.ellipse(ex + k * 60, ey, Math.abs(k) * 120 + 18, er, 0, Math.PI, 2 * Math.PI); x.stroke(); }
  x.strokeStyle = 'rgba(120,200,255,.9)'; x.lineWidth = 6; x.beginPath(); x.arc(ex, ey, er + 3, Math.PI * 1.08, Math.PI * 1.92); x.stroke();
  // ascent trail: from the coast up into orbit, ending at a star
  x.lineCap = 'round'; x.strokeStyle = '#ff8a1f'; x.lineWidth = 15; x.beginPath(); x.moveTo(m - 70, m + 50); x.quadraticCurveTo(m - 40, m - 90, m + 92, m - 108); x.stroke();
  x.strokeStyle = '#ffd08a'; x.lineWidth = 5; x.beginPath(); x.moveTo(m - 66, m + 40); x.quadraticCurveTo(m - 36, m - 86, m + 92, m - 108); x.stroke();
  x.fillStyle = '#ffffff'; star(x, m + 104, m - 112, 26);
  x.restore();
  // lettering on the ring
  x.fillStyle = '#ffffff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  const arcText = (t: string, top: boolean, size: number) => { x.font = `800 ${size}px ${FONT}`; const rad = 216, span = Math.min(2.4, t.length * 0.165);
    for (let i = 0; i < t.length; i++) { const a = top ? -Math.PI / 2 - span / 2 + (span * (i + 0.5)) / t.length : Math.PI / 2 + span / 2 - (span * (i + 0.5)) / t.length;
      x.save(); x.translate(m + Math.cos(a) * rad, m + Math.sin(a) * rad); x.rotate(top ? a + Math.PI / 2 : a - Math.PI / 2); x.fillText(t[i], 0, 0); x.restore(); } };
  arcText('SPACEATLAS', true, 40); arcText('MISSION CONTROL', false, 30);
  for (const s of [-1, 1]) star(x, m + s * 216, m, 10);
  return (emblemC = c);
}

/** United States flag, 19:10. */
export function flag(): HTMLCanvasElement {
  const W = 380, H = 200, c = mk(W, H), x = c.getContext('2d')!;
  for (let i = 0; i < 13; i++) { x.fillStyle = i % 2 ? '#ffffff' : '#b22234'; x.fillRect(0, (i * H) / 13, W, H / 13 + 1); }
  const cw = W * 0.4, ch = (H * 7) / 13; x.fillStyle = '#3c3b6e'; x.fillRect(0, 0, cw, ch); x.fillStyle = '#ffffff';
  for (let row = 0; row < 9; row++) for (let col = 0; col < (row % 2 ? 5 : 6); col++) star(x, (cw / 12) * (2 * col + 1 + (row % 2)), (ch / 10) * (row + 1), 5.2);
  return c;
}

export type Decal = { k: 'text'; text: string; color: string; at: number; size: number } | { k: 'flag'; at: number; w: number } | { k: 'emblem'; at: number; w: number };
export interface TubeLook { base: string; decals?: Decal[]; seams?: number; soot?: number; foam?: boolean; carbon?: boolean; seed?: number;
  /** Frost on a cryogenic tank: [from, to] as fractions of the height from the bottom. */ frost?: [number, number];
  /** Bands with external stringers (intertank, skirts): [from, to] fractions from the bottom. */ ribs?: [number, number][];
  /** Black thermal-protection bands: [from, to] fractions from the bottom. */ bands?: [number, number][] }
/** Angle (radians from +z toward +x) the decals face: toward the cameras that film the pad. */
export const DECAL_THETA = 0.55;

function paint(x: CanvasRenderingContext2D, P: number, w: number, h: number, look: TubeLook, cx: number) {
  const r = rng(look.seed ?? 7);
  x.fillStyle = look.base; x.fillRect(0, 0, w * P, h * P);
  if (look.foam) for (let i = 0; i < 2600; i++) { const s = (0.004 + r() * 0.03) * P; x.fillStyle = `rgba(${r() < 0.5 ? '150,70,25' : '232,140,70'},${0.08 + r() * 0.16})`; x.beginPath(); x.ellipse(r() * w * P, r() * h * P, s, s * (0.5 + r()), r() * 3, 0, 7); x.fill(); }
  if (look.carbon) for (let i = 0; i < 900; i++) { x.fillStyle = `rgba(255,255,255,${0.012 + r() * 0.025})`; x.fillRect(r() * w * P, r() * h * P, 0.02 * P, 0.002 * P); }
  else for (let i = 0; i < 700; i++) { x.fillStyle = `rgba(0,0,0,${r() * 0.035})`; x.fillRect(r() * w * P, r() * h * P, (0.004 + r() * 0.02) * P, (0.002 + r() * 0.01) * P); }
  // weld rings and stringers
  const sp = look.seams ?? 0.16; x.strokeStyle = look.carbon ? 'rgba(255,255,255,.05)' : 'rgba(0,0,0,.13)'; x.lineWidth = Math.max(1, 0.003 * P);
  for (let y = sp; y < h; y += sp) { x.beginPath(); x.moveTo(0, y * P); x.lineTo(w * P, y * P); x.stroke(); }
  x.strokeStyle = look.carbon ? 'rgba(255,255,255,.03)' : 'rgba(0,0,0,.05)'; for (let i = 1; i < 8; i++) { x.beginPath(); x.moveTo((i * w * P) / 8, 0); x.lineTo((i * w * P) / 8, h * P); x.stroke(); }
  for (const [a, b] of look.ribs ?? []) { x.strokeStyle = 'rgba(0,0,0,.16)'; x.lineWidth = Math.max(1, 0.0025 * P); const n = 56; for (let i = 0; i < n; i++) { const px = (i / n) * w * P; x.beginPath(); x.moveTo(px, (1 - b) * h * P); x.lineTo(px, (1 - a) * h * P); x.stroke(); }
    x.strokeStyle = 'rgba(0,0,0,.3)'; for (const e of [a, b]) { x.beginPath(); x.moveTo(0, (1 - e) * h * P); x.lineTo(w * P, (1 - e) * h * P); x.stroke(); } }
  for (const [a, b] of look.bands ?? []) { x.fillStyle = '#15171a'; x.fillRect(0, (1 - b) * h * P, w * P, (b - a) * h * P); }
  // rivet rows beside each weld ring
  if (!look.carbon) { x.fillStyle = 'rgba(0,0,0,.16)'; const d = Math.max(1, 0.0022 * P); for (let y = sp; y < h; y += sp) for (let i = 0; i < 90; i++) x.fillRect((i / 90) * w * P, y * P + d * 2.5, d, d); }
  // frost: condensed ice on the cold tank wall, patchy toward its edges, shed in streaks
  if (look.frost) { const [a, b] = look.frost, y0 = (1 - b) * h * P, y1 = (1 - a) * h * P, m = (y1 - y0) * 0.22;
    for (let i = 0; i < 2600; i++) { const py = y0 + r() * (y1 - y0), e = Math.min(1, (py - y0) / m, (y1 - py) / m), sz = (0.006 + r() * 0.03) * P; if (r() > e * 0.9 + 0.1) continue;
      x.fillStyle = `rgba(250,252,255,${0.05 + r() * 0.2 * e})`; x.beginPath(); x.ellipse(r() * w * P, py, sz * (0.6 + r()), sz * (1 + r() * 2.5), 0, 0, 7); x.fill(); } }
  // soot toward the engines, with streaks running up the body
  if (look.soot) for (let i = 0; i < 70; i++) { const px = r() * w * P, len = h * P * look.soot * (0.5 + r() * 1.6), g2 = x.createLinearGradient(0, h * P, 0, h * P - len); g2.addColorStop(0, `rgba(30,26,22,${0.1 + r() * 0.2})`); g2.addColorStop(1, 'rgba(30,26,22,0)'); x.fillStyle = g2; x.fillRect(px, h * P - len, (0.004 + r() * 0.02) * P, len); }
  if (look.soot) { const g = x.createLinearGradient(0, h * P, 0, h * P * (1 - look.soot)); g.addColorStop(0, 'rgba(30,26,22,.55)'); g.addColorStop(1, 'rgba(30,26,22,0)'); x.fillStyle = g; x.fillRect(0, h * P * (1 - look.soot), w * P, h * P * look.soot); }
  for (const d of look.decals ?? []) {
    const cy = (1 - d.at) * h * P;
    if (d.k === 'text') { const fs = d.size * P; x.save(); x.translate(cx * P, cy); x.rotate(-Math.PI / 2); x.fillStyle = d.color; x.font = `800 ${fs}px ${FONT}`; x.textAlign = 'center'; x.textBaseline = 'middle';
      const track = fs * 0.18, widths = [...d.text].map(ch => x.measureText(ch).width), tw = widths.reduce((a, b) => a + b, 0) + track * (d.text.length - 1); let px = -tw / 2;
      [...d.text].forEach((ch, i) => { x.fillText(ch, px + widths[i] / 2, 0); px += widths[i] + track; }); x.restore(); }
    else { const src = d.k === 'flag' ? flag() : emblem(), wpx = d.w * P, hpx = (wpx * src.height) / src.width; x.drawImage(src, cx * P - wpx / 2, cy - hpx / 2, wpx, hpx); }
  }
}
const finish = (c: HTMLCanvasElement) => { const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; return t; };

/** Texture for a full cylinder of radius r and height h (world units), decals centred at DECAL_THETA. */
export function tubeTexture(r: number, h: number, look: TubeLook) {
  const w = 2 * Math.PI * r; let P = 512 / w; if (h * P > 2048) P = 2048 / h;
  const c = mk(Math.round(w * P), Math.max(8, Math.round(h * P))), x = c.getContext('2d')!;
  paint(x, P, w, h, look, w / 2);
  const t = finish(c); t.wrapS = THREE.RepeatWrapping; t.offset.x = 0.5 - DECAL_THETA / (2 * Math.PI); return t;
}
/** Height map matching tubeTexture: weld rings, stringer bands, foam grain. Mid-grey is the surface. */
export function tubeBump(r: number, h: number, look: TubeLook) {
  const w = 2 * Math.PI * r; let P = 512 / w; if (h * P > 2048) P = 2048 / h;
  const c = mk(Math.round(w * P), Math.max(8, Math.round(h * P))), x = c.getContext('2d')!, q = rng((look.seed ?? 7) + 5);
  x.fillStyle = '#808080'; x.fillRect(0, 0, c.width, c.height);
  if (look.foam) for (let i = 0; i < 5000; i++) { const s = (0.003 + q() * 0.012) * P; x.fillStyle = q() < 0.5 ? 'rgba(60,60,60,.35)' : 'rgba(190,190,190,.35)'; x.beginPath(); x.arc(q() * c.width, q() * c.height, s, 0, 7); x.fill(); }
  const sp = look.seams ?? 0.16; x.fillStyle = '#b4b4b4'; const t = Math.max(2, 0.006 * P); for (let y = sp; y < h; y += sp) x.fillRect(0, y * P - t / 2, c.width, t);
  x.fillStyle = '#5a5a5a'; for (let i = 0; i < 8; i++) x.fillRect((i * c.width) / 8, 0, Math.max(1, 0.002 * P), c.height);
  for (const [a, b] of look.ribs ?? []) { const n = 56, cw = c.width / n; for (let i = 0; i < n; i++) { x.fillStyle = '#d8d8d8'; x.fillRect(i * cw, (1 - b) * h * P, cw * 0.42, (b - a) * h * P); } }
  const tx = new THREE.CanvasTexture(c); tx.wrapS = THREE.RepeatWrapping; tx.offset.x = 0.5 - DECAL_THETA / (2 * Math.PI); tx.anisotropy = 4; return tx;
}
/** Grid-fin lattice with transparent holes. */
export function gridTexture() { const c = mk(64, 64), x = c.getContext('2d')!; x.clearRect(0, 0, 64, 64); x.strokeStyle = '#8f949b'; x.lineWidth = 3; x.strokeRect(1.5, 1.5, 61, 61);
  x.lineWidth = 2; for (let i = -64; i < 128; i += 12) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + 64, 64); x.stroke(); x.beginPath(); x.moveTo(i + 64, 0); x.lineTo(i, 64); x.stroke(); } return finish(c); }
/** Texture for half a cylinder (a fairing shell spanning θ 0…π), decals at DECAL_THETA. */
export function shellTexture(r: number, h: number, look: TubeLook) {
  const w = Math.PI * r; let P = 512 / w; if (h * P > 2048) P = 2048 / h;
  const c = mk(Math.round(w * P), Math.max(8, Math.round(h * P))), x = c.getContext('2d')!;
  paint(x, P, w, h, look, (DECAL_THETA / Math.PI) * w);
  return finish(c);
}

/** Facade of the vehicle assembly building: panel bands, a flag and the mission emblem. */
export function facade(w: number, h: number, decor: boolean, seed = 1) {
  const P = 1024 / w, c = mk(1024, Math.round(h * P)), x = c.getContext('2d')!, r = rng(seed);
  x.fillStyle = '#dedcd6'; x.fillRect(0, 0, c.width, c.height);
  // patchwork of panel columns in white, light grey, grey and tan, stepped like the real building's siding
  const cols = 14, cw = c.width / cols, pal = ['#e4e2dc', '#cfcdc6', '#a9a8a3', '#9b8f76', '#b8ad94'];
  for (let i = 0; i < cols; i++) { let y = 0; while (y < c.height) { const hh = (0.08 + r() * 0.3) * c.height; x.fillStyle = pal[Math.floor(r() * r() * pal.length)]; x.fillRect(Math.floor(i * cw), Math.floor(y), Math.ceil(cw) + 1, Math.ceil(hh) + 1); y += hh; } }
  x.strokeStyle = 'rgba(0,0,0,.07)'; x.lineWidth = 1; for (let y = 0; y < c.height; y += 10) { x.beginPath(); x.moveTo(0, y); x.lineTo(c.width, y); x.stroke(); }
  for (let i = 0; i <= cols * 3; i++) { x.beginPath(); x.moveTo((i * cw) / 3, 0); x.lineTo((i * cw) / 3, c.height); x.stroke(); }
  const sh = x.createLinearGradient(0, 0, 0, c.height); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(60,55,45,.18)'); x.fillStyle = sh; x.fillRect(0, 0, c.width, c.height);
  // high bay door
  x.fillStyle = 'rgba(95,92,84,.75)'; x.fillRect(c.width * 0.36, c.height * 0.12, c.width * 0.26, c.height * 0.88);
  x.strokeStyle = 'rgba(0,0,0,.18)'; for (let y = c.height * 0.12; y < c.height; y += c.height * 0.06) { x.beginPath(); x.moveTo(c.width * 0.36, y); x.lineTo(c.width * 0.62, y); x.stroke(); }
  if (decor) { const f = flag(), fw = c.width * 0.2; x.save(); x.translate(c.width * 0.08 + fw * 0.5, c.height * 0.06); x.rotate(Math.PI / 2); x.scale(1, -1); x.drawImage(f, 0, -fw / 2, c.height * 0.5, fw); x.restore();
    const e = emblem(), es = c.width * 0.22; x.drawImage(e, c.width * 0.7, c.height * 0.1, es, es); }
  const t = finish(c); return t;
}
