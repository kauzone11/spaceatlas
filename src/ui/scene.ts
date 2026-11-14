// One persistent WebGL scene behind every screen: a body (Earth, Moon, asteroid, Mars) and the spacecraft
// assembled from the current design. Screens only set a "view"; everything eases toward it.
import * as THREE from 'three';
import { Q, sample, frameStats } from './quality';
import { BENNU } from '../data/assets';
import { SUN, earthBody, rockyBody, atmosphere, asteroidMesh, sunDisc, sunDeg } from './worlds';
import { Design, MISSION, MissionId, POWER, INST, BATTERY } from '../engine/catalog';
import type { Phase } from '../engine/sim';
import { createDirector, Director } from './cine';
import { createEnvs } from './env';
import { tubeTexture, tubeBump, shellTexture, gridTexture, DECAL_THETA, type TubeLook, type Decal } from './livery';

type V3 = THREE.Vector3;
export interface ViewSpec { guided?: boolean; view: string; mission: MissionId; phase?: Phase; lander?: boolean; marker?: { lat: number; lon: number } | null; lost?: boolean; show?: 'craft' | 'rocket' }
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const BODY_OF: Record<MissionId, string> = { leo: 'earth', moon: 'moon', neo: 'bennu', mars: 'mars' };

export interface Label { cat: string; x: number; y: number }
export interface Scene3D {
  /** Dev aid for visual checks. */ three?: { scene: THREE.Scene; cam: THREE.PerspectiveCamera; craft: THREE.Object3D; perf: () => Record<string, number> };
  scroll: (px: number) => void; set: (v: ViewSpec) => void; design: (d: Design | null) => void; rotate: (dx: number, dy: number) => void; ok: boolean;
  /** Exploded view of the spacecraft or rocket (studio only). */ explode: (on: boolean) => void;
  /** Highlight one part category, or none. */ focus: (cat: string | null) => void;
  /** Screen position (CSS px) of each visible part category. */ labels: () => Label[];
  /** Part category under a screen point. */ pick: (x: number, y: number) => string | null;
  /** Flight films (null without WebGL). */ film: Director | null;
}

export function createScene(canvas: HTMLCanvasElement): Scene3D {
  let renderer: THREE.WebGLRenderer;
  try { renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' }); }
  catch { return { scroll() {}, set() {}, design() {}, rotate() {}, explode() {}, focus() {}, labels: () => [], pick: () => null, film: null, ok: false }; }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let pr = Math.min(devicePixelRatio || 1, Q.maxPr);
  renderer.setPixelRatio(pr); renderer.outputEncoding = THREE.sRGBEncoding; renderer.shadowMap.enabled = true;
  Q.onChange(() => { const np = Math.min(devicePixelRatio || 1, Q.maxPr); if (np !== pr) { pr = np; renderer.setPixelRatio(pr); resize(); } }); renderer.setClearColor(0x000000, 1);
  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(40, 1, 0.1, 1000); cam.position.set(0, 0, 12);
  const sun = new THREE.DirectionalLight(0xfff4e6, 1.35); sun.position.set(-6, 2.5, 5); scene.add(sun);
  scene.add(new THREE.AmbientLight(0x5a6a88, 0.16));
  const envs = createEnvs(renderer, v3(-6, 2.5, 5), v3(0.72, 0.48, 0.5)); scene.environment = envs.space;
  const fill = new THREE.DirectionalLight(0x6f8fd0, 0.22); fill.position.set(5, -2, 3); scene.add(fill);

  // ---- stars: brightness follows a magnitude-like distribution (few bright, many faint), colours follow stellar temperature,
  // and the faint ones crowd toward the galactic plane; a dim Milky Way band lies behind them
  { const stars = new THREE.Group(); stars.name = 'stars'; scene.add(stars);
    const n = 5200, pos = new Float32Array(n * 3), col = new Float32Array(n * 3), siz = new Float32Array(n);
    const pole = v3(0.45, 0.6, -0.66).normalize(), TINT = [[0.68, 0.78, 1], [0.85, 0.9, 1], [1, 1, 1], [1, 0.96, 0.86], [1, 0.86, 0.68], [1, 0.74, 0.56]];
    for (let i = 0; i < n; i++) { let d: V3;
      do { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = Math.sqrt(1 - u * u); d = v3(r * Math.cos(a), u, r * Math.sin(a)); } while (Math.random() > 0.3 + 0.7 * Math.exp(-Math.pow(d.dot(pole) / 0.28, 2)));
      const m = Math.pow(Math.random(), 5.5), b = 0.2 + 0.8 * m, t = TINT[Math.min(5, Math.floor(Math.pow(Math.random(), 0.8) * 6))];
      pos.set([220 * d.x, 220 * d.y, 220 * d.z], i * 3); col.set([t[0] * b, t[1] * b, t[2] * b], i * 3); siz[i] = 1.1 + m * 3.4; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.setAttribute('sz', new THREE.BufferAttribute(siz, 1));
    const sm = new THREE.ShaderMaterial({ uniforms: { op: { value: 0.9 }, pr: { value: pr } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: 'attribute float sz; attribute vec3 color; uniform float pr; varying vec3 vC; void main(){ vC = color; gl_PointSize = sz * pr; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float op; varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5) * 2.0; float a = smoothstep(1.0, 0.0, d); gl_FragColor = vec4(vC * a * a * op * 1.5, 1.0); }' });
    const pts = new THREE.Points(g, sm); pts.frustumCulled = false; stars.add(pts);
    // the Milky Way: a soft band of unresolved starlight, brighter toward the galactic centre, split by dark dust lanes (computed per pixel so it stays smooth)
    const MW = 512, MH = 256, c = document.createElement('canvas'); c.width = MW; c.height = MH; const x = c.getContext('2d')!, im = x.createImageData(MW, MH);
    const hh = (a: number, b: number) => { const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return t - Math.floor(t); };
    const vn = (a: number, b: number, per: number) => { const i = Math.floor(a), j = Math.floor(b), f = a - i, g = b - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g), w = (q: number) => ((q % per) + per) % per; return (hh(w(i), j) * (1 - u) + hh(w(i + 1), j) * u) * (1 - v) + (hh(w(i), j + 1) * (1 - u) + hh(w(i + 1), j + 1) * u) * v; };
    const fb = (a: number, b: number) => vn(a * 8, b * 8, 8) * 0.5 + vn(a * 16, b * 16, 16) * 0.27 + vn(a * 32, b * 32, 32) * 0.15 + vn(a * 64, b * 64, 64) * 0.08;
    for (let py = 0; py < MH; py++) for (let px = 0; px < MW; px++) { const u = px / MW, lat = (py / MH - 0.5) * Math.PI, core = Math.exp(-Math.pow((u - 0.5) / 0.17, 2)), n = fb(u, py / MH * 0.5), wid = 0.085 + 0.1 * core, n2 = fb(u * 2 + 0.5, py / MH + 0.3);
      let b = Math.exp(-Math.pow(lat / wid, 2)) * (0.22 + 0.95 * core) * (0.2 + 1.5 * n * n2 * 2); const lane = fb(u + 0.37, py / MH * 0.5 + 0.2); b *= 1 - Math.exp(-Math.pow(lat / 0.045, 2)) * Math.min(1, Math.max(0, (lane - 0.38) * 3.2)) * 0.85;
      const o = (py * MW + px) * 4, v = Math.min(1, b * 0.42 + (hh(px, py) - 0.5) * 0.012); im.data[o] = 255 * v * (0.92 + 0.08 * core); im.data[o + 1] = 255 * v * 0.92; im.data[o + 2] = 255 * v * (1 - 0.14 * core); im.data[o + 3] = 255; }
    x.putImageData(im, 0, 0);
    const mt = new THREE.CanvasTexture(c); mt.encoding = THREE.sRGBEncoding;
    const mw = new THREE.Mesh(new THREE.SphereGeometry(230, 48, 24), new THREE.MeshBasicMaterial({ map: mt, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.34, fog: false }));
    mw.quaternion.setFromUnitVectors(v3(0, 1, 0), pole); mw.renderOrder = -3; mw.frustumCulled = false; stars.add(mw);
    stars.userData.op = (o: number) => { sm.uniforms.op.value = o; sm.uniforms.pr.value = pr; (mw.material as THREE.MeshBasicMaterial).opacity = 0.34 * (o / 0.9); mw.visible = o > 0.02; }; }

  // ---- bodies
  const planet = new THREE.Group(); scene.add(planet);
  const spin = new THREE.Group(); planet.add(spin);
  const bodies: Record<string, THREE.Object3D> = {};
  const sphere = new THREE.SphereGeometry(1, 128, 64);
  const put = (k: string, g: THREE.Object3D) => { g.visible = false; bodies[k] = g; spin.add(g); return g; };
  put('earth', earthBody(sphere));
  put('moon', (() => { const g = new THREE.Group(); g.add(rockyBody(sphere, 'moon', 'moonN', 1, 0.22)); return g; })());
  put('mars', (() => { const g = new THREE.Group(); g.add(rockyBody(sphere, 'mars', 'marsN', 0.35, 0.4)); g.add(atmosphere(1.018, 0xe8c4a0, 0x9fb8e0, 0.45)); return g; })());
  { // Bennu shape model (NASA), quantised to int16; regolith, craters and boulders are procedural
    const bin = (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
    const p16 = new Int16Array(bin(BENNU.pos).buffer), pos = new Float32Array(p16.length);
    for (let i = 0; i < p16.length; i++) pos[i] = p16[i] / 32767;
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(new THREE.BufferAttribute(new Uint16Array(bin(BENNU.idx).buffer), 1));
    g.computeVertexNormals(); g.computeBoundingSphere(); const s = 1 / (g.boundingSphere?.radius || 1);
    const m = asteroidMesh(g); m.scale.setScalar(s * 1.05);
    const grp = new THREE.Group(); grp.add(m); put('bennu', grp); }
  // the Sun, at its true apparent size seen from the body in focus
  const sunSee = sunDisc(); scene.add(sunSee.obj);
  // target marker (real EONET event location)
  const marker = new THREE.Mesh(new THREE.RingGeometry(0.03, 0.045, 32), new THREE.MeshBasicMaterial({ color: 0xff9f0a, side: THREE.DoubleSide, transparent: true, depthTest: true }));
  const markerDot = new THREE.Mesh(new THREE.CircleGeometry(0.014, 16), new THREE.MeshBasicMaterial({ color: 0xffd60a, side: THREE.DoubleSide })); marker.add(markerDot);
  marker.visible = false; bodies.earth.add(marker);
  // orbit ring
  const ringPts: THREE.Vector3[] = []; for (let i = 0; i <= 128; i++) { const a = (i / 128) * 6.2832; ringPts.push(v3(Math.cos(a), 0, Math.sin(a))); }
  const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts), new THREE.LineBasicMaterial({ color: 0x64d2ff, transparent: true, opacity: 0.45 }));
  ring.rotation.set(1.25, 0, 0.35); ring.visible = false; planet.add(ring);

  // ---- spacecraft
  const craft = new THREE.Group(); scene.add(craft);
  const model = new THREE.Group(); craft.add(model);
  const M = {
    foil: (() => { // crinkled multi-layer insulation: small flat facets catch the light separately, with tape seams between blankets
      const N = 256, c = document.createElement('canvas'), b = document.createElement('canvas'); c.width = c.height = b.width = b.height = N; const x = c.getContext('2d')!, y = b.getContext('2d')!;
      x.fillStyle = '#dba63e'; x.fillRect(0, 0, N, N); y.fillStyle = '#808080'; y.fillRect(0, 0, N, N);
      for (let i = 0; i < 700; i++) { const px = Math.random() * N, py = Math.random() * N, n = 3 + Math.floor(Math.random() * 3), l = Math.random(), sz = 6 + Math.random() * 22;
        const path = (q: CanvasRenderingContext2D) => { q.beginPath(); for (let k = 0; k < n; k++) { const a = (k / n) * 6.283 + l * 6, rr = sz * (0.5 + ((k * 7 + i) % 5) / 8); q.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); } q.closePath(); q.fill(); };
        x.fillStyle = `rgba(${l > 0.55 ? '255,232,160' : l > 0.25 ? '150,104,28' : '84,56,12'},${0.1 + Math.random() * 0.22})`; path(x); const v = Math.floor(60 + l * 140); y.fillStyle = `rgba(${v},${v},${v},0.55)`; path(y); }
      x.strokeStyle = 'rgba(70,50,14,.6)'; x.lineWidth = 2; y.strokeStyle = '#4a4a4a'; y.lineWidth = 2; for (const q of [x, y]) { for (const k of [0.33, 0.67]) { q.beginPath(); q.moveTo(0, k * N); q.lineTo(N, k * N); q.stroke(); } q.beginPath(); q.moveTo(N / 2, 0); q.lineTo(N / 2, N); q.stroke(); }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; const bt = new THREE.CanvasTexture(b);
      return new THREE.MeshStandardMaterial({ map: t, bumpMap: bt, bumpScale: 0.012, metalness: 0.72, roughness: 0.36, envMapIntensity: 1.2 }); })(),
    foilDark: new THREE.MeshStandardMaterial({ color: 0x8a6a2a, metalness: 0.7, roughness: 0.55 }),
    white: new THREE.MeshStandardMaterial({ color: 0xe9edf2, metalness: 0.1, roughness: 0.6 }),
    metal: new THREE.MeshStandardMaterial({ color: 0x8a919c, metalness: 0.9, roughness: 0.35 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x1c2026, metalness: 0.6, roughness: 0.5 }),
    glass: new THREE.MeshStandardMaterial({ color: 0x0b1626, metalness: 1, roughness: 0.08 }),
    hot: new THREE.MeshStandardMaterial({ color: 0xff7a2e, emissive: 0xff5a10, emissiveIntensity: 1.2, roughness: 0.6 }),
    ion: new THREE.MeshBasicMaterial({ color: 0x64d2ff }),
    accent: new THREE.MeshStandardMaterial({ color: 0x0a84ff, metalness: 0.4, roughness: 0.4 }),
    panel: (() => { // solar cells: dark blue-black rectangles with clipped corners, silver interconnects and bus bars
      const c = document.createElement('canvas'); c.width = 256; c.height = 256; const x = c.getContext('2d')!; x.fillStyle = '#9aa3b2'; x.fillRect(0, 0, 256, 256);
      const nx = 6, ny = 10, cw = 256 / nx, ch = 256 / ny;
      for (let i = 0; i < nx; i++) for (let k = 0; k < ny; k++) { const l = Math.random(), px = i * cw + 1.2, py = k * ch + 1, w = cw - 2.4, h = ch - 2, cc = 3;
        x.fillStyle = `rgb(${8 + l * 10},${14 + l * 16},${44 + l * 34})`; x.beginPath(); x.moveTo(px + cc, py); x.lineTo(px + w - cc, py); x.lineTo(px + w, py + cc); x.lineTo(px + w, py + h - cc); x.lineTo(px + w - cc, py + h); x.lineTo(px + cc, py + h); x.lineTo(px, py + h - cc); x.lineTo(px, py + cc); x.closePath(); x.fill();
        x.strokeStyle = 'rgba(150,170,210,.22)'; x.lineWidth = 0.6; for (let g = 1; g < 4; g++) { x.beginPath(); x.moveTo(px, py + (h * g) / 4); x.lineTo(px + w, py + (h * g) / 4); x.stroke(); } }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8;
      return new THREE.MeshStandardMaterial({ map: t, metalness: 0.55, roughness: 0.22, envMapIntensity: 1.3 }); })(),
    panelBack: (() => { const c = document.createElement('canvas'); c.width = 128; c.height = 128; const x = c.getContext('2d')!; x.fillStyle = '#1b1c20'; x.fillRect(0, 0, 128, 128);
      x.strokeStyle = '#b08a3a'; x.lineWidth = 2; for (let i = 16; i < 128; i += 32) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 128); x.stroke(); } x.strokeStyle = '#3a3c42'; for (let i = 0; i <= 128; i += 32) { x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return new THREE.MeshStandardMaterial({ map: t, metalness: 0.3, roughness: 0.6 }); })(),
    osr: new THREE.MeshStandardMaterial({ color: 0xdfe6ee, metalness: 0.9, roughness: 0.16, envMapIntensity: 1.2 }),
  };
  const box = (w: number, h: number, d: number, m: THREE.Material | THREE.Material[]) => new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  const cyl = (r1: number, r2: number, h: number, m: THREE.Material, seg = 24) => new THREE.Mesh(new THREE.CylinderGeometry(r1, r2, h, seg), m);
  const exhaust = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.4, 20, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb056, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }));
  exhaust.rotation.x = Math.PI; exhaust.visible = false; craft.add(exhaust);
  let keys = new Set<string>(), designKey = '', hasCraft = false, baseBottom = 0.5;
  /** Per part: exploded-view offset, label anchor (local), assembled position. */
  const meta = new WeakMap<THREE.Object3D, { ex: V3; anchor: V3; base: V3 }>();
  let exOn = false, exK = 0, hiCat: string | null = null, hiDirty = true;
  const INST_SHAPE: Record<string, string> = { cam: 'lens', mcam: 'lens', lcam: 'lens', ncam: 'lens', mast: 'mast', tir: 'lens2', spec: 'box', irs: 'box', tes: 'box', xrs: 'box', sar: 'plate', sharad: 'whip', mw: 'dish', sounder: 'box',
    neut: 'tube', rad: 'tube', drill: 'drill', mdrill: 'drill', seis: 'dome', mseis: 'dome', lidar: 'twin', radio: 'none', probe: 'arm', met: 'mast' };
  function build(d: Design) {
    const prev = keys; keys = new Set();
    while (model.children.length) model.remove(model.children[0]);
    const part = (key: string, o: THREE.Object3D, cat: string) => { o.userData.key = key; o.userData.cat = cat; keys.add(key); o.userData.s = prev.has(key) || !prev.size ? 1 : 0.01; o.scale.setScalar(o.userData.s); model.add(o); return o; };
    const w = { S: 0.6, M: 0.85, L: 1.15 }[d.bus] ?? 0.6, h = w * 1.25, def = MISSION[d.mission], orbit = def.orbits.find(o => o.id === d.orbit) ?? def.orbits[0], lander = orbit.kind === 'lander';
    // bus
    const bus = new THREE.Group(); const body = box(w, h, w, d.shield === 'heavy' ? M.foilDark : M.foil); bus.add(body);
    const top = box(w * 1.02, h * 0.06, w * 1.02, M.metal); top.position.y = h / 2; bus.add(top); const bot = top.clone(); bot.position.y = -h / 2; bus.add(bot);
    if (d.shield !== 'light') { const sh = box(w * 1.08, h * (d.shield === 'heavy' ? 0.7 : 0.4), w * 1.08, M.dark); sh.position.y = h * 0.05; bus.add(sh); }
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) { const e = box(w * 0.03, h * 1.02, w * 0.03, M.metal); e.position.set(sx * w * 0.5, 0, sz * w * 0.5); bus.add(e);
      // attitude thrusters: a block with two small nozzles on each upper corner
      const tb = box(w * 0.09, w * 0.07, w * 0.09, M.dark); tb.position.set(sx * w * 0.53, h * 0.44, sz * w * 0.53); bus.add(tb);
      for (const dir of [0, 1]) { const nz = cyl(w * 0.012, w * 0.028, w * 0.06, M.metal, 10); nz.position.set(sx * w * (0.53 + (dir ? 0.07 : 0)), h * 0.44 + (dir ? 0 : w * 0.06), sz * w * 0.53); nz.rotation.z = dir ? sx * -Math.PI / 2 : Math.PI; bus.add(nz); } }
    { const ringM = cyl(w * 0.4, w * 0.4, h * 0.05, M.metal, 40); ringM.position.y = -h / 2 - h * 0.03; bus.add(ringM); // launch adapter ring
      for (const sx of [-1, 1]) { const rad = box(0.012, h * 0.3, w * 0.74, M.osr); rad.position.set(sx * (w / 2 + 0.007), h * 0.3 * sx, 0); bus.add(rad); } // radiators (mirror tiles)
      const ss = cyl(w * 0.03, w * 0.03, 0.02, M.glass, 12); ss.position.set(-w * 0.3, h / 2 + 0.03, w * 0.3); bus.add(ss); }
    part('bus' + d.bus + d.shield, bus, 'bus');
    if (d.redund !== 'single') { const g = new THREE.Group(); const n = d.redund === 'full' ? 2 : 1;
      for (let i = 0; i < n; i++) { const u = box(w * 0.3, w * 0.22, w * 0.12, M.white); u.position.set((i ? 1 : -1) * w * 0.2, h * 0.28, -w / 2 - w * 0.06); g.add(u); } part('red' + d.redund, g, 'avionics'); }
    // power
    const P = POWER[d.power];
    if (P.area > 0) { const g = new THREE.Group(), pw = w * 1.05, len = Math.max(0.45, (P.area / 2 / pw) * 0.55 + 0.25);
      for (const s of [-1, 1]) { const boom = cyl(0.015, 0.015, 0.16, M.metal, 8); boom.rotation.z = Math.PI / 2; boom.position.set(s * (w / 2 + 0.08), 0, 0); g.add(boom);
        const segs = Math.max(1, Math.round(len / 0.5));
        const wing = new THREE.Group(); wing.rotation.x = 0.35; g.add(wing);
        for (const k of [-1, 1]) { const L = Math.hypot(0.14, pw * 0.4), y = box(L, 0.01, 0.01, M.metal); y.position.set(s * (w / 2 + 0.09), k * pw * 0.2, 0); y.rotation.z = s * k * Math.atan2(pw * 0.4, 0.14); wing.add(y); }
        for (let i = 0; i < segs; i++) { const sl = len / segs, p = box(sl * 0.97, pw, 0.012, [M.metal, M.metal, M.metal, M.metal, M.panel, M.panelBack]); p.position.set(s * (w / 2 + 0.16 + sl * (i + 0.5)), 0, 0); wing.add(p);
          if (i) for (const k of [-0.3, 0.3]) { const hg = cyl(0.012, 0.012, pw * 0.14, M.metal, 8); hg.position.set(s * (w / 2 + 0.16 + sl * i), k * pw, -0.008); wing.add(hg); } } }
      part('pw' + d.power + d.bus, g, 'power'); }
    else { const g = new THREE.Group(); const boom = cyl(0.02, 0.02, 0.5, M.metal, 8); boom.rotation.z = Math.PI / 2; boom.position.set(-w / 2 - 0.25, -h * 0.2, 0); g.add(boom);
      const r = cyl(0.11, 0.11, 0.5, M.dark); r.rotation.z = Math.PI / 2; r.position.set(-w / 2 - 0.72, -h * 0.2, 0); g.add(r);
      for (let i = 0; i < 8; i++) { const f = box(0.46, 0.012, 0.14, M.metal); const a = (i / 8) * 6.283; f.position.set(-w / 2 - 0.72, -h * 0.2 + Math.cos(a) * 0.15, Math.sin(a) * 0.15); f.rotation.x = a + Math.PI / 2; g.add(f); }
      const glow = cyl(0.06, 0.06, 0.52, M.hot, 12); glow.rotation.z = Math.PI / 2; glow.position.copy(r.position); g.add(glow); part('pwrtg' + d.bus, g, 'power'); }
    // battery
    { const g = new THREE.Group(), n = Object.keys(BATTERY).indexOf(d.battery) + 1;
      for (let i = 0; i < n; i++) { const b = box(w * 0.18, w * 0.26, w * 0.1, M.accent); b.position.set((i - (n - 1) / 2) * w * 0.22, -h * 0.22, -w / 2 - w * 0.05); g.add(b); } part('bat' + d.battery + d.bus, g, 'battery'); }
    // thermal
    if (d.thermal !== 'passive') { const g = new THREE.Group();
      if (d.thermal === 'heaters') for (const s of [-1, 1]) { const r = box(w * 0.7, h * 0.5, 0.02, M.white); r.position.set(0, 0, 0); r.position.z = 0; r.position.x = 0; r.position.y = h * 0.1; r.position.z = -w / 2 - 0.012; if (s > 0) { r.scale.set(0.5, 0.25, 1); r.position.set(0, h * 0.42, w / 2 + 0.012); (r as THREE.Mesh).material = M.hot; } g.add(r); }
      else for (const s of [-1, 1]) { const r = cyl(0.04, 0.04, 0.12, M.hot, 12); r.position.set(s * w * 0.3, -h * 0.38, w / 2 + 0.03); g.add(r); }
      part('th' + d.thermal + d.bus, g, 'thermal'); }
    // propulsion
    if (d.prop !== 'none') { const g = new THREE.Group(), tr = Math.max(0.1, Math.min(0.42, Math.cbrt(Math.max(d.propKg, 4)) * 0.028)), nt = d.prop === 'biprop' ? 2 : 1;
      for (let i = 0; i < nt; i++) { const tnk = new THREE.Mesh(new THREE.SphereGeometry(tr, 24, 16), M.white); tnk.position.set(nt > 1 ? (i ? 1 : -1) * tr * 1.05 : 0, -h / 2 - tr * 0.75, 0); g.add(tnk); }
      const ny = -h / 2 - tr * 1.6;
      if (d.prop === 'ion') { const c = cyl(0.13, 0.15, 0.16, M.metal); c.position.y = ny - 0.05; g.add(c); const e = cyl(0.11, 0.11, 0.02, M.ion); e.position.y = ny - 0.14; g.add(e); }
      else { const s = d.prop === 'biprop' ? 1.5 : 1, nz = cyl(0.04 * s, 0.11 * s, 0.2 * s, M.dark, 24); nz.position.y = ny - 0.08 * s; g.add(nz); }
      baseBottom = -ny + 0.3; part('pr' + d.prop + Math.round(tr * 30) + d.bus, g, 'prop'); } else baseBottom = h / 2 + 0.05;
    // avionics
    { const g = new THREE.Group(); const a = box(w * 0.3, w * 0.2, w * 0.1, M.dark); a.position.set(w * 0.25, h * 0.3, -w / 2 - w * 0.05); g.add(a);
      if (d.avionics === 'auto') { const st = cyl(0.045, 0.06, 0.16, M.dark, 16); st.position.set(-w * 0.3, h / 2 + 0.1, -w * 0.3); st.rotation.x = -0.5; g.add(st); const l = cyl(0.04, 0.04, 0.01, M.glass, 16); l.position.set(-w * 0.3, h / 2 + 0.17, -w * 0.345); l.rotation.x = -0.5; g.add(l); }
      part('av' + d.avionics + d.bus, g, 'avionics'); }
    // antenna
    { const g = new THREE.Group();
      if (d.antenna === 'lga') { const r = cyl(0.012, 0.012, 0.28, M.metal, 8); r.position.set(w * 0.3, h / 2 + 0.14, w * 0.3); g.add(r); }
      else if (d.antenna === 'mga') { const c = cyl(0.11, 0.03, 0.16, M.white, 20); c.position.set(w * 0.25, h / 2 + 0.12, w * 0.2); g.add(c); }
      else { const R = w * 0.62 + 0.12, pts: THREE.Vector2[] = []; for (let i = 0; i <= 10; i++) { const x = (i / 10) * R; pts.push(new THREE.Vector2(x, (x * x) / (R * 2.4))); }
        const dish = new THREE.Mesh(new THREE.LatheGeometry(pts, 40), new THREE.MeshStandardMaterial({ color: 0xf2f4f7, roughness: 0.5, metalness: 0.15, side: THREE.DoubleSide })); const mast = cyl(0.02, 0.02, 0.16, M.metal, 8);
        const feed = cyl(0.015, 0.015, R * 0.5, M.metal, 8); feed.position.y = R * 0.28; const tip = cyl(0.04, 0.04, 0.04, M.dark, 12); tip.position.y = R * 0.52; dish.add(feed, tip);
        for (let i = 0; i < 3; i++) { const an = (i / 3) * 6.283, st = cyl(0.006, 0.006, R * 0.72, M.metal, 6); st.position.set(Math.cos(an) * R * 0.4, R * 0.33, Math.sin(an) * R * 0.4); st.rotation.set(Math.sin(an) * 0.95, 0, -Math.cos(an) * 0.95); dish.add(st); }
        const back = cyl(R * 0.3, R * 0.16, 0.05, M.metal, 20); back.position.y = -0.01; dish.add(back);
        mast.position.y = h / 2 + 0.08; dish.position.y = h / 2 + 0.16; dish.rotation.z = -0.18; g.add(mast, dish); }
      part('an' + d.antenna + d.bus, g, 'antenna'); }
    // instruments on the +z face
    const list = d.instruments.filter(i => INST[i]);
    list.forEach((id, i) => { const g = new THREE.Group(), cols = Math.min(3, list.length), rows = Math.ceil(list.length / 3), cx = ((i % 3) - (cols - 1) / 2) * w * 0.3, cy = (Math.floor(i / 3) - (rows - 1) / 2) * -h * 0.34 + h * 0.05, z = w / 2, s = w * 0.9;
      const shape = INST_SHAPE[id] ?? 'box';
      if (shape === 'lens' || shape === 'lens2') { const b = cyl(0.09 * s, 0.1 * s, 0.26 * s, shape === 'lens' ? M.white : M.dark); b.rotation.x = Math.PI / 2; b.position.set(cx, cy, z + 0.13 * s); const l = cyl(0.075 * s, 0.075 * s, 0.01, M.glass); l.rotation.x = Math.PI / 2; l.position.set(cx, cy, z + 0.262 * s); g.add(b, l); }
      else if (shape === 'plate') { const p = box(w * 1.5, h * 0.3, 0.03, M.white); p.position.set(0, cy, z + 0.12); const a = cyl(0.015, 0.015, 0.12, M.metal, 8); a.rotation.x = Math.PI / 2; a.position.set(0, cy, z + 0.06); g.add(p, a); }
      else if (shape === 'whip') { const a = cyl(0.008, 0.008, w * 3, M.metal, 6); a.rotation.z = Math.PI / 2; a.position.set(0, cy, z + 0.04); g.add(a); }
      else if (shape === 'dish') { const dd = cyl(0.14 * s, 0.04 * s, 0.08 * s, M.white); dd.rotation.x = -Math.PI / 2; dd.position.set(cx, cy, z + 0.06 * s); g.add(dd); }
      else if (shape === 'tube') { const tb = cyl(0.04 * s, 0.04 * s, 0.3 * s, M.metal, 16); tb.position.set(cx, cy, z + 0.05 * s); g.add(tb); }
      else if (shape === 'drill') { const b = box(0.14 * s, 0.2 * s, 0.14 * s, M.white); b.position.set(cx, -h * 0.3, z + 0.08 * s); const r = cyl(0.018, 0.018, 0.7 * s, M.metal, 8); r.position.set(cx, -h * 0.3 - 0.35 * s, z + 0.08 * s); g.add(b, r); }
      else if (shape === 'dome') { const dm = new THREE.Mesh(new THREE.SphereGeometry(0.11 * s, 20, 12, 0, 6.283, 0, 1.571), M.white); dm.position.set(cx, -h / 2 - (lander ? 0.25 : 0), z + 0.2 * s); g.add(dm); }
      else if (shape === 'twin') for (const k of [-1, 1]) { const c = cyl(0.045 * s, 0.045 * s, 0.16 * s, M.dark, 16); c.rotation.x = Math.PI / 2; c.position.set(cx + k * 0.06 * s, cy, z + 0.08 * s); g.add(c); }
      else if (shape === 'arm') { const a = cyl(0.02, 0.02, 0.7 * s, M.metal, 8); a.rotation.x = 1.1; a.position.set(cx, -h * 0.35, z + 0.3 * s); const hd = cyl(0.1 * s, 0.1 * s, 0.05, M.white, 20); hd.position.set(cx, -h * 0.35 - 0.16 * s, z + 0.61 * s); g.add(a, hd); }
      else if (shape === 'mast') { const a = cyl(0.015, 0.015, 0.6 * s, M.metal, 8); a.position.set(cx * 1.5, h / 2 + 0.3 * s, z - 0.1); const hd = box(0.12 * s, 0.07 * s, 0.08 * s, M.white); hd.position.set(cx * 1.5, h / 2 + 0.62 * s, z - 0.1); g.add(a, hd); }
      else if (shape === 'box') { const b = box(0.2 * s, 0.2 * s, 0.14 * s, M.white); b.position.set(cx, cy, z + 0.07 * s); const ap = box(0.1 * s, 0.1 * s, 0.01, M.glass); ap.position.set(cx, cy, z + 0.142 * s); g.add(b, ap); }
      part('in' + id + d.bus + list.length, g, 'inst'); });
    // landing legs
    if (lander) { const g = new THREE.Group(), L = baseBottom + 0.25;
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.785, leg = cyl(0.02, 0.02, L * 1.35, M.metal, 8), dx = Math.cos(a), dz = Math.sin(a);
        leg.position.set(dx * (w * 0.5 + L * 0.3), -h * 0.2 - L * 0.45, dz * (w * 0.5 + L * 0.3)); leg.rotation.set(dz * 0.6, 0, -dx * 0.6);
        const pad = cyl(0.09, 0.09, 0.02, M.foil, 16); pad.position.set(dx * (w * 0.5 + L * 0.68), -h * 0.2 - L, dz * (w * 0.5 + L * 0.68)); g.add(leg, pad); }
      part('legs' + d.bus + Math.round(L * 10), g, 'legs'); }
    craft.remove(model); const rot = model.rotation.clone(), py = model.position.y; model.rotation.set(0, 0, 0); model.position.y = 0; const sc = model.children.map(o => o.scale.x); model.children.forEach(o => o.scale.setScalar(1)); model.updateMatrixWorld(true); const bb = new THREE.Box3().setFromObject(model), size = bb.getSize(new THREE.Vector3());
    for (const o of model.children) { const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()), cat = o.userData.cat;
      const dir = cat === 'bus' ? v3(0, 0, 0) : c.lengthSq() > 1e-4 ? c.clone().normalize() : v3(0, -1, 0);
      if (cat === 'inst') dir.set(dir.x * 0.4, dir.y * 0.4, 1).normalize();
      // a symmetric group (two solar wings) centres on the body: label its first member instead
      const anchor = cat !== 'bus' && c.lengthSq() < 1e-3 && o.children.length > 1 ? new THREE.Box3().setFromObject(o.children[0]).getCenter(new THREE.Vector3()) : c;
      meta.set(o, { ex: dir.multiplyScalar(cat === 'power' ? 0.35 : 0.55), anchor, base: v3(0, 0, 0) }); } model.children.forEach((o, i) => o.scale.setScalar(sc[i])); model.rotation.copy(rot); model.position.y = py; craft.add(model);
    model.userData.fit = 2.6 / Math.max(2.6, size.x, size.y * 1.3); model.userData.size = Math.max(size.x, size.y, size.z);
    refreshPayload();
    model.userData.foot = lander ? h * 0.2 + baseBottom + 0.26 : size.y / 2;
  }


  // ---- launch vehicles: one recognisable silhouette per launcher class, the spacecraft sits in the fairing
  const R = {
    white: new THREE.MeshStandardMaterial({ color: 0xf1f3f6, metalness: 0.04, roughness: 0.42 }),
    black: new THREE.MeshStandardMaterial({ color: 0x15171b, metalness: 0.25, roughness: 0.48 }),
    orange: new THREE.MeshStandardMaterial({ color: 0xd2742e, metalness: 0.0, roughness: 0.9 }),
    bronze: new THREE.MeshStandardMaterial({ color: 0xb87440, metalness: 0.75, roughness: 0.42 }),
    grey: new THREE.MeshStandardMaterial({ color: 0x6a717c, metalness: 0.8, roughness: 0.38 }),
    bell: new THREE.MeshStandardMaterial({ color: 0x4a4e56, metalness: 0.9, roughness: 0.32, side: THREE.DoubleSide }),
    copper: new THREE.MeshStandardMaterial({ color: 0x8a5a3c, metalness: 0.9, roughness: 0.38, side: THREE.DoubleSide }),
    grid: new THREE.MeshStandardMaterial({ map: gridTexture(), metalness: 0.85, roughness: 0.4, alphaTest: 0.5, side: THREE.DoubleSide }),
    flame: new THREE.MeshBasicMaterial({ color: 0xffc070, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, depthWrite: false }),
  };
  const rocket = new THREE.Group(); rocket.visible = false; craft.add(rocket);
  const flames: THREE.Mesh[] = [];
  let rocketKey = '';
  function buildRocket(id: string) {
    if (id === rocketKey) return; rocketKey = id; rocket.userData.id = id;
    while (rocket.children.length) rocket.remove(rocket.children[0]); flames.length = 0;
    let C = 'stage1';
    const add = (o: THREE.Object3D, y: number, x = 0, z = 0) => { o.position.set(x, y, z); o.userData.cat = C; rocket.add(o); return o; };
    const liv = (m: THREE.Material, map: THREE.Texture, bump: THREE.Texture | null = null) => { const b = m as THREE.MeshStandardMaterial; return new THREE.MeshStandardMaterial({ map, bumpMap: bump, bumpScale: 0.0022, roughness: b.roughness, metalness: b.metalness }); };
    const tube = (r: number, h: number, m: THREE.Material, y: number, x = 0, look?: TubeLook) => add(cyl(r, r, h, look ? liv(m, tubeTexture(r, h, look), tubeBump(r, h, look)) : m, 48), y + h / 2, x);
    /** Conical adapter: radius r0 at the bottom, r1 at the top. */
    const cone = (r0: number, r1: number, h: number, m: THREE.Material, y: number, x = 0) => add(cyl(r1, r0, h, m, 48), y + h / 2, x);
    /** Flange or separation ring standing slightly proud of the skin. */
    const band = (r: number, h: number, m: THREE.Material, y: number, x = 0) => add(cyl(r * 1.014, r * 1.014, h, m, 48), y + h / 2, x);
    /** Something flat against the skin at angle a (cable raceway, stowed fin, folded leg): w tangential, d radial. */
    const onSkin = (o: THREE.Object3D, r: number, a: number, y: number, x = 0) => { o.rotation.y = Math.PI / 2 - a; return add(o, y, x + Math.cos(a) * r, Math.sin(a) * r); };
    const RACE = Math.PI / 2 - DECAL_THETA + 2.3; // cable raceway, on the side away from the lettering
    const raceway = (r: number, y: number, h: number, m: THREE.Material, x = 0, a = RACE) => onSkin(box(r * 0.2, h, r * 0.1, m), r * 1.03, a, y + h / 2, x);
    const ogive = (r: number, h: number) => { const pts: THREE.Vector2[] = []; for (let i = 0; i <= 20; i++) { const u = i / 20; pts.push(new THREE.Vector2(r * Math.sqrt(Math.max(0, 1 - u * u)) * (1 - 0.02 * u), u * h)); } return pts; };
    const nose = (r: number, h: number, m: THREE.Material, y: number, x = 0) => add(new THREE.Mesh(new THREE.LatheGeometry(ogive(r, h), 32), m), y, x);
    /** Payload fairing in two shells that open in the exploded view; the spacecraft rides inside. rb: radius of the stage below (boat-tail). */
    const fairing = (r: number, hc: number, hn: number, y: number, look?: TubeLook, rb = r, fm: THREE.MeshStandardMaterial = R.white) => { C = 'fairing'; fm.side = THREE.DoubleSide; const hb = rb < r ? (r - rb) * 1.5 : 0;
      for (const side of [1, -1]) { const t0 = side > 0 ? 0 : Math.PI;
        const shell = new THREE.Group(); shell.userData.side = side;
        if (hb > 0) { const b = new THREE.Mesh(new THREE.CylinderGeometry(r, rb, hb, 24, 1, true, t0, Math.PI), fm); b.position.y = hb / 2; shell.add(b); }
        if (hc > 0) { const m = side > 0 && look ? liv(fm, shellTexture(r, hc, look)) : fm; m.side = THREE.DoubleSide;
          const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, hc, 24, 1, true, t0, Math.PI), m); c.position.y = hb + hc / 2; shell.add(c); }
        const n = new THREE.Mesh(new THREE.LatheGeometry(ogive(r, hn), 24, t0, Math.PI), fm); n.position.y = hb + hc; shell.add(n);
        // the split line: a thin rail along each edge of the shell
        for (const e of [0.02, Math.PI - 0.02]) { const a = Math.PI / 2 - (t0 + e), rail = box(r * 0.035, hc + hb * 0.5, r * 0.03, R.grey); rail.position.set(Math.cos(a) * r * 1.005, hb * 0.75 + hc / 2, Math.sin(a) * r * 1.005); rail.rotation.y = Math.PI / 2 - a; shell.add(rail); }
        add(shell, y); }
      rocket.userData.pay = { y: y + hb + (hc + hn * 0.45) / 2, r }; };
    /** Bell nozzle hanging below its throat, with the turbopump housing above it. */
    const bell = (rt: number, re: number, h: number, m: THREE.Material = R.bell) => { const pts: THREE.Vector2[] = [];
      for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(rt + (re - rt) * (0.72 * Math.sqrt(t) + 0.28 * t), -t * h)); } return new THREE.Mesh(new THREE.LatheGeometry(pts, 28), m); };
    /** Engine cluster under a stage: ring of n (plus a centre engine for nine), hanging from a black heat-shield closeout. */
    const engines = (r: number, n: number, y: number, x = 0, m: THREE.Material = R.bell) => {
      const ring = n === 9 ? 8 : n, k = n === 1 ? 0 : n === 9 ? r * 0.66 : n === 2 ? r * 0.42 : r * 0.5;
      const re = n === 1 ? r * 0.72 : n === 9 ? r * 0.2 : n === 2 ? r * 0.36 : r * 0.33, hb = n === 1 ? r * 0.85 : n === 9 ? r * 0.5 : r * 0.95;
      for (let i = 0; i < n; i++) { const c = n === 9 && i === 8, a = (i / ring) * 6.283 + (n === 4 ? 0.785 : 0); add(bell(re * 0.34, re, hb, m), y, x + (c ? 0 : Math.cos(a) * k), c ? 0 : Math.sin(a) * k); }
      if (n > 1) add(cyl(r * 0.985, r * 0.985, r * 0.07, R.black, 40), y - r * 0.035, x);
      const f = new THREE.Mesh(new THREE.ConeGeometry(r * 1.05, r * 9, 20, 1, true), R.flame); f.rotation.x = Math.PI; f.position.set(x, y - r * 0.9 - r * 4.5, 0); f.visible = false; rocket.add(f); flames.push(f); };
    /** Strap-on solid motor: aft skirt, segmented case, frustum and nose cone, attach struts to the core. */
    const booster = (r: number, h: number, x: number, y: number, m: THREE.Material, rc: number, look?: TubeLook) => { const k = C, sx = Math.sign(x); C = 'boost';
      tube(r, h, m, y, x, look); cone(r * 1.28, r, r * 1.5, m, y - r * 0.2, x); cone(r, r * 0.55, r * 1.2, m, y + h, x); nose(r * 0.55, r * 1.6, m, y + h + r * 1.2, x); engines(r, 1, y - r * 0.2, x);
      for (const f of [0.12, 0.88]) { const st = box(Math.max(0.004, Math.abs(x) - rc - r + 0.012), r * 0.22, r * 0.5, R.grey); add(st, y + h * f, x - sx * (r + (Math.abs(x) - rc - r) / 2)); }
      C = k; };
    const W = '#f1f3f6', K = '#16181c', T = (text: string, color: string, at: number, size: number): Decal => ({ k: 'text', text, color, at, size });
    let top = 0;
    if (id === 'small') { // Electron-class: slim carbon-black two-stage rocket, nine small engines, black fairing
      const r = 0.07; tube(r, 1.05, R.black, 0, 0, { base: '#1b1d21', carbon: true, soot: 0.06, seams: 0.21, decals: [T('SPACEATLAS', W, 0.5, 0.05), { k: 'flag', at: 0.88, w: 0.075 }] }); engines(r, 9, 0, 0, R.copper);
      band(r, 0.012, R.grey, 0.02); raceway(r, 0.08, 0.9, R.black);
      C = 'inter'; tube(r, 0.05, R.grey, 1.05); C = 'stage2'; tube(r, 0.27, R.black, 1.1, 0, { base: '#1b1d21', carbon: true, seams: 0.3, decals: [{ k: 'emblem', at: 0.5, w: 0.11 }] }); band(r, 0.008, R.grey, 1.36);
      top = 1.37; fairing(r * 1.02, 0.04, 0.3, top, undefined, r, new THREE.MeshStandardMaterial({ color: 0x1a1c20, metalness: 0.25, roughness: 0.42 }));
    } else if (id === 'ride') { // Falcon 9-class rideshare: white core frosted over the oxygen tank, sooty aft end, black interstage, stowed grid fins, folded legs, wide fairing
      const r = 0.085; tube(r, 1.5, R.white, 0, 0, { base: W, soot: 0.2, seams: 0.25, frost: [0.5, 0.93], decals: [T('SPACEATLAS', K, 0.48, 0.062), { k: 'flag', at: 0.9, w: 0.1 }] });
      band(r, 0.03, R.black, 0.0); raceway(r, 0.06, 1.38, R.white);
      C = 'inter'; tube(r, 0.12, R.black, 1.5, 0, { base: '#17191d', carbon: true, seams: 0.05 }); C = 'stage2'; tube(r, 0.34, R.white, 1.62, 0, { base: W, seams: 0.11, frost: [0.25, 0.7] }); band(r, 0.012, R.grey, 1.95); C = 'stage1';
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.785; onSkin(box(0.05, 0.062, 0.006, R.grid), r + 0.006, a, 1.535).userData.cat = 'stage1'; onSkin(box(0.02, 0.012, 0.014, R.grey), r + 0.006, a, 1.5); }
      for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283; const leg = cyl(0.006, 0.026, 0.36, R.white, 3); leg.scale.z = 0.45; onSkin(leg, r + 0.006, a, 0.21); onSkin(box(0.03, 0.03, 0.012, R.black), r + 0.006, a, 0.03); }
      engines(r, 9, 0); top = 1.96; fairing(r * 1.42, 0.2, 0.36, top, { base: W, seams: 0.5, decals: [{ k: 'emblem', at: 0.5, w: 0.16 }] }, r);
    } else if (id === 'medium') { // Atlas V-class: bronze common core, two strap-on solids, white upper stage and fairing
      const r = 0.11; tube(r, 1.38, R.bronze, 0, 0, { base: '#b87440', soot: 0.1, seams: 0.23, ribs: [[0.6, 0.68]], frost: [0.7, 0.96], decals: [T('SPACEATLAS', W, 0.42, 0.075), { k: 'flag', at: 0.84, w: 0.13 }] }); engines(r, 2, 0);
      cone(r * 1.0, r * 1.0, 0.05, R.grey, -0.012); raceway(r, 0.08, 1.26, R.bronze);
      for (const sx of [-1, 1]) booster(0.045, 0.62, sx * (r + 0.05), 0.07, R.white, r, { base: W, soot: 0.12, seams: 0.15 });
      C = 'inter'; cone(r, r * 0.82, 0.09, R.white, 1.38); C = 'stage2'; tube(r * 0.82, 0.3, R.white, 1.47, 0, { base: W, seams: 0.1, frost: [0.1, 0.8] }); top = 1.77; fairing(r * 1.25, 0.26, 0.42, top, { base: W, seams: 0.5, decals: [{ k: 'emblem', at: 0.5, w: 0.2 }] }, r * 0.82);
    } else { // SLS-class heavy lift: orange foam core with a ribbed intertank and oxygen feedlines, two white five-segment boosters, exploration upper stage, large fairing
      const r = 0.15; tube(r, 1.3, R.orange, 0, 0, { base: '#c86a2b', foam: true, soot: 0.06, seams: 0.26, ribs: [[0.6, 0.7], [0.93, 1]], decals: [{ k: 'emblem', at: 0.82, w: 0.18 }, { k: 'flag', at: 0.45, w: 0.17 }] }); engines(r, 4, 0);
      cone(r * 1.02, r * 1.02, 0.1, R.white, 0); for (const a of [RACE - 0.3, RACE + 0.3]) onSkin(cyl(0.012, 0.012, 0.78, R.orange, 10), r + 0.01, a, 0.49);
      for (const sx of [-1, 1]) { booster(0.075, 1.2, sx * (r + 0.082), 0.06, R.white, r, { base: W, soot: 0.1, seams: 0.24, bands: [[0.19, 0.2], [0.39, 0.4], [0.59, 0.6], [0.79, 0.8]], decals: [T('SPACEATLAS', K, 0.5, 0.055)] }); }
      C = 'inter'; tube(r, 0.07, R.white, 1.3, 0, { base: W, seams: 0.035, bands: [[0, 0.3]] }); C = 'stage2'; tube(r, 0.26, R.white, 1.37, 0, { base: W, seams: 0.13, frost: [0.2, 0.8] }); band(r, 0.012, R.grey, 1.62);
      top = 1.63; fairing(r, 0.28, 0.5, top, { base: W, seams: 0.5, decals: [{ k: 'emblem', at: 0.5, w: 0.24 }] });
    }
    craft.remove(rocket); rocket.rotation.set(0, 0, 0); rocket.updateMatrixWorld(true); flames.forEach(f => rocket.remove(f)); // measure in local space, without the exhaust
    const bb = new THREE.Box3().setFromObject(rocket), h = bb.max.y - bb.min.y; flames.forEach(f => rocket.add(f)); craft.add(rocket);
    rocket.userData.fit = 2.3 / h; rocket.userData.mid = (bb.max.y + bb.min.y) / 2; rocket.userData.min = bb.min.y;
    rocket.children.forEach(o => { o.position.y -= rocket.userData.mid; });
    rocket.userData.pay.y -= rocket.userData.mid;
    const ORDER: Record<string, number> = { stage1: 0, boost: 0, inter: 1, stage2: 2, payload: 3, fairing: 3 };
    craft.remove(rocket); const rrot = rocket.rotation.clone(); rocket.rotation.set(0, 0, 0); rocket.updateMatrixWorld(true);
    for (const o of rocket.children) { const cat = o.userData.cat ?? 'stage1', side = o.userData.side ?? Math.sign(o.position.x);
      const ex = v3(cat === 'boost' ? side * 0.32 : cat === 'fairing' ? side * 0.42 : 0, (ORDER[cat] ?? 0) * 0.17, 0);
      meta.set(o, { ex, anchor: new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3()).sub(o.position), base: o.position.clone() }); }
    rocket.rotation.copy(rrot); craft.add(rocket); refreshPayload();
  }
  /** A copy of the current spacecraft, shrunk to fit inside the fairing. */
  let payload: THREE.Object3D | null = null;
  function refreshPayload() {
    if (payload) { rocket.remove(payload); payload = null; }
    const pay = rocket.userData.pay; if (!pay || !model.children.length) return;
    payload = model.clone(); payload.children.forEach(c => c.scale.setScalar(1)); payload.traverse(o => { o.userData = {}; }); payload.userData.cat = 'payload';
    payload.scale.setScalar((pay.r * 1.75) / (model.userData.size || 2)); payload.position.set(0, pay.y, 0);
    rocket.add(payload); meta.set(payload, { ex: v3(0, 0.17 * 3, 0), anchor: v3(0, 0, 0), base: payload.position.clone() });
  }

  // ---- highlight: swap in emissive copies of the materials of one part category
  const orig = new WeakMap<THREE.Mesh, THREE.Material | THREE.Material[]>(), hiMats = new Map<THREE.Material, THREE.Material>();
  const hiOf = (m: THREE.Material) => { if (!('emissive' in m)) return m; let h = hiMats.get(m);
    if (!h) { h = m.clone(); (h as THREE.MeshStandardMaterial).emissive = new THREE.Color(0x2f8cff); hiMats.set(m, h); } return h; };
  const catOf = (o: THREE.Object3D | null): string | null => { for (let p = o; p; p = p.parent) if (p.userData?.cat) return p.userData.cat; return null; };
  function applyHi() { hiDirty = false;
    for (const root of [model, rocket]) root.traverse(o => { const mesh = o as THREE.Mesh; if (!mesh.isMesh) return;
      if (!orig.has(mesh)) orig.set(mesh, mesh.material); const m0 = orig.get(mesh)!;
      mesh.material = hiCat && catOf(mesh) === hiCat && !Array.isArray(m0) ? hiOf(m0) : m0; }); }
  const ray = new THREE.Raycaster();
  const visibleChain = (o: THREE.Object3D | null) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

  // ---- view state
  const cur = { pPos: v3(3, -2, 0), pScale: 3, cPos: v3(0, 0, 0), cScale: 0.001, dim: 1 };
  const tgt = { pPos: v3(3, -2, 0), pScale: 3, cPos: v3(0, 0, 0), cScale: 0, dim: 1, sunIn: false };
  const FRONT = v3(-6, 2.5, 5).normalize(), sunCur = FRONT.clone();
  const AU_OF: Record<string, number> = { earth: 1, moon: 1, mars: 1.52, bennu: 1.13 };
  let launching = false, spec: ViewSpec = { view: 'home', mission: 'leo' }, body = 'earth', yaw = 0.6, pitch = 0.25, userYaw = 0, userPitch = 0, orbitA = 0, t0 = performance.now(), simT = 0, lastPhase = '';
  function showBody(k: string) { if (k === body && bodies[k].visible) return; for (const b in bodies) bodies[b].visible = b === k; body = k; }
  showBody('earth');
  function layout() {
    const portrait = cam.aspect < 0.82, s = spec, T = tgt, orbitKind = s.lander ? 'lander' : 'orbiter';
    const P = (x: number, y: number, z: number, sc: number) => { T.pPos.set(x, y, z); T.pScale = sc; };
    const C = (x: number, y: number, z: number, sc: number) => { T.cPos.set(x, y, z); T.cScale = sc; };
    T.dim = 1; T.sunIn = false; ring.visible = false; exhaust.visible = false; launching = false;
    let b = BODY_OF[s.mission];
    switch (s.view) {
      case 'home': b = 'earth'; portrait ? P(0, -4.6, 0, 3.6) : P(3.2, -2.3, 0, 3.9); C(0, 0, 0, 0); break;
      case 'crew': case 'lobby': b = 'earth'; portrait ? P(0, -10.8, -4, 4.5) : P(8.8, -7.4, -4, 4.6); C(0, 0, 0, 0); T.dim = 0.55; break;
      case 'missions': portrait ? P(0, 2.55, 0, 1.25) : P(2.9, 0.35, 0, 2.35); C(0, 0, 0, 0); break;
      case 'contract': portrait ? P(0, 5.6, -6, 2.4) : P(4.6, -0.4, -3, 3.2); C(0, 0, 0, 0); T.dim = 0.8; break;
      case 'studio': if (s.guided) { portrait ? P(7.5, 15.5, -20, 4) : P(11, -8.2, -18, 5.2); portrait ? (s.show === 'rocket' ? C(0, 1.85, 0, 1.15) : C(0, 1.85, 0, 1.55)) : C(2.75, -0.85, 0, 1.9); T.dim = 0.8; break; }
        portrait ? P(3, 6.5, -14, 4) : P(9.5, -6.2, -14, 5); portrait ? (s.show === 'rocket' ? C(0, 1.1, 0, 1.2) : C(0, 1.25, 0, 0.6)) : C(2.5, 0.8, 0, 1.35); T.dim = 0.7; break;
      case 'review': portrait ? P(5, 12.5, -10, 4) : P(10.5, -8, -10, 6); portrait ? C(0, 0, 0, 0) : C(3.9, 2.1, 0, 0.45); T.dim = 0.5; break;
      case 'report': portrait ? P(5, 13.5, -12, 4) : P(11.5, 6.5, -14, 4.5); C(0, 0, 0, 0); T.dim = 0.45; break;
      case 'sim': {
        const ph = s.phase ?? 'launch';
        if (ph === 'launch') { b = 'earth'; portrait ? P(0, -1.6, 0, 3.4) : P(2.4, -5.6, 0, 4.6); portrait ? C(0, 2.2, 0, 0.36) : C(2.4, -0.38, 0, 0.6); launching = !s.lost; }
        else if (ph === 'cruise') { portrait ? P(2.2, 4.4, -40, 2) : P(6.5, 2.6, -40, 2.2); portrait ? C(0, 2.5, 0, 0.5) : C(2.5, 0.2, 0, 0.9); }
        else if (ph === 'arrival') { portrait ? P(0.8, 3.1, -5, 1.9) : P(4.1, 0.6, -5, 3); portrait ? C(-0.7, 2.2, 0, 0.3) : C(1.2, -0.4, 0, 0.5); }
        else if (orbitKind === 'lander') { portrait ? P(0, -0.2, 0, 3.6) : P(-1.6, -5.2, 0, 4.7); const top = (portrait ? -0.2 + 3.6 : -5.2 + 4.7); portrait ? C(0, top - 0.02, 0, 0.36) : C(-1.6, top - 0.03, 0, 0.5); }
        else { portrait ? P(0, 2.6, 0, 1.15) : P(-1.7, 0.2, 0, 1.75); C(0, 0, 0, portrait ? 0.14 : 0.2); ring.visible = true; }
        if (ph !== 'launch') T.sunIn = true;
        if (s.lost) T.dim = 0.35;
        break;
      }
    }
    showBody(b);
    marker.visible = b === 'earth' && !!s.marker && s.view !== 'home' && s.view !== 'crew' && s.view !== 'lobby';
    if (s.marker && marker.visible) { const phi = ((90 - s.marker.lat) * Math.PI) / 180, th = ((s.marker.lon + 180) * Math.PI) / 180, r = 1.012;
      marker.position.set(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)); marker.lookAt(marker.position.clone().multiplyScalar(2)); }
    if (!hasCraft) T.cScale = 0;
    if (s.view === 'sim' && lastPhase !== (s.phase ?? '')) { simT = 0; lastPhase = s.phase ?? ''; }
  }
  let scrollPx = 0;
  function resize() { const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight; renderer.setSize(w, h, false); cam.aspect = w / h; cam.fov = cam.aspect < 0.82 ? 52 : 40;
    if (scrollPx > 0) cam.setViewOffset(w, h, 0, scrollPx, w, h); else cam.clearViewOffset(); cam.updateProjectionMatrix(); layout(); }
  addEventListener('resize', resize); resize();
  // The launch complex, vehicle effects and storm effects are only needed for the flight films: build them after the
  // first screens are up (idle time), or at once if a film is requested sooner. Until then a frame has no film.
  let real: Director | null = null;
  const make = () => (real ??= createDirector({ renderer, scene, cam, sun, canvas, reduced, bodies, rocket, model, envs,
    anchor: () => ({ planet: planet.position, R: cur.pScale, craft: craft.position }),
    restoreView: () => { cam.position.set(0, 0, 12); cam.rotation.set(0, 0, 0); resize(); } }));
  const IDLE = { film: false, dark: 0, dust: 0 };
  const director = new Proxy({} as Director, { get: (_, k) => (k === 'update' && !real ? () => IDLE : k === 'sunPoint' && !real ? () => null : Reflect.get(make(), k)) });
  const later = (f: () => void) => { const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => void }; if (w.requestIdleCallback) w.requestIdleCallback(f, { timeout: 6000 }); else setTimeout(f, 2500); };
  setTimeout(() => later(() => make()), 1500);

  let last = performance.now(), running = true, filming = false, updMs = 0;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { last = performance.now(); requestAnimationFrame(tick); } });
  function tick(now: number) {
    if (!running) return;
    // slow tier: menus and the studio are drawn at about 30 fps (films always at full rate)
    if (!filming && Q.idleFrameMs && now - last < Q.idleFrameMs) { requestAnimationFrame(tick); return; }
    const ms = now - last, dt = Math.min(0.05, ms / 1000); last = now;
    sample(ms, filming);
    const u0 = performance.now(); const fr = director.update(dt, canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight); filming = !!fr.film; updMs += (performance.now() - u0 - updMs) * 0.1;
    planet.visible = !fr.film; marker.visible = marker.visible && !fr.film;
    if (fr.film) { craft.visible = false; sunSee.obj.visible = false; SUN.dir.copy(sun.position).normalize(); SUN.point = director.sunPoint(); SUN.I = sun.intensity / 1.35; renderer.render(scene, cam); requestAnimationFrame(tick); return; }
    const k = reduced ? 1 : 1 - Math.pow(0.0015, dt);
    cur.pPos.lerp(tgt.pPos, k); cur.pScale += (tgt.pScale - cur.pScale) * k; cur.cPos.lerp(tgt.cPos, k); cur.cScale += (tgt.cScale - cur.cScale) * k; cur.dim += (tgt.dim - cur.dim) * k;
    planet.position.copy(cur.pPos); planet.scale.setScalar(cur.pScale);
    const lander = spec.view === 'sim' && !!spec.lander && (spec.phase === 'ops' || spec.phase === 'end');
    if (!reduced && !lander) spin.rotation.y += dt * (body === 'bennu' ? 0.12 : 0.035);
    spin.rotation.x = body === 'earth' ? 0.41 : 0.1;
    if (body === 'moon') spin.rotation.y = -Math.PI / 2 + 0.25; // tidally locked: the near side faces us
    if (marker.visible) { const p = 1 + 0.35 * Math.sin(now / 280); marker.scale.setScalar(p); (marker.material as THREE.MeshBasicMaterial).opacity = 0.95 - 0.3 * Math.sin(now / 280); }
    sun.intensity = 1.35 * cur.dim * (1 - 0.92 * fr.dark) * (1 - 0.45 * fr.dust);
    // Sun over the viewer's left shoulder (about 50° phase): the body shows its day side, as in the reference photographs.
    // The Sun itself sits along that direction at its true apparent size, out of this fixed frame (seen in the films).
    sun.position.copy(FRONT).multiplyScalar(10); sunCur.copy(FRONT);
    sunSee.obj.visible = tgt.sunIn; if (tgt.sunIn) sunSee.place(cam, sunCur, sunDeg(AU_OF[body] ?? 1), 600, 1 - 0.92 * fr.dark);
    SUN.dir.copy(sunCur); SUN.point = null; SUN.I = sun.intensity / 1.35;
    fill.intensity = 0.22 * cur.dim * (1 - 0.7 * fr.dark);
    // spacecraft
    simT += dt; yaw += reduced || (spec.view === 'studio' && (exOn || hiCat)) ? 0 : dt * 0.16;
    let cp = cur.cPos.clone();
    const inOps = spec.view === 'sim' && (spec.phase === 'ops' || spec.phase === 'end') && !spec.lander;
    if (inOps) { orbitA += dt * 0.5; const R = cur.pScale * 1.5, lp = v3(Math.cos(orbitA) * R, 0, Math.sin(orbitA) * R).applyEuler(ring.rotation); cp = planet.position.clone().add(lp); ring.scale.setScalar(1.5); }
    if (spec.view === 'sim' && spec.phase === 'launch' && !reduced) cp.y += Math.min(1.6, simT * simT * 0.12) + (simT < 1.2 ? Math.sin(now / 30) * 0.004 : 0);
    if (spec.view === 'sim' && spec.phase === 'arrival' && !reduced) cp.x += Math.max(0, 1.5 - simT * 0.5) * -1;
    const showRocket = spec.show === 'rocket' && rocket.children.length > 0; model.visible = !showRocket; rocket.visible = showRocket;
    const exT = exOn && spec.view === 'studio' ? 1 : 0; exK += (exT - exK) * (reduced ? 1 : 1 - Math.pow(0.004, dt));
    for (const o of (showRocket ? rocket : model).children) { const mt = meta.get(o); if (mt) o.position.copy(mt.base).addScaledVector(mt.ex, exK); }
    if (hiDirty) applyHi();
    for (const m of hiMats.values()) if ('emissiveIntensity' in m) (m as THREE.MeshStandardMaterial).emissiveIntensity = 0.45 + 0.3 * Math.sin(now / 260);
    const fit = (showRocket ? (rocket.userData.fit ?? 1) * 0.85 : (model.userData.fit ?? 1)) / (1 + (showRocket ? 0.22 : 0.3) * exK);
    craft.position.copy(cp); craft.scale.setScalar(Math.max(0.0001, cur.cScale * fit)); craft.visible = cur.cScale > 0.01;
    rocket.rotation.set(0, (yaw * 0.5) % 6.2832 * (1 - exK) + userYaw, 0); // exploded: turn the opening fairing toward the camera
    for (const f of flames) { f.visible = showRocket && launching; f.scale.set(1 + Math.sin(now / 23) * 0.1, 1 + Math.sin(now / 31) * 0.14 + Math.min(0.6, simT * 0.2), 1 + Math.sin(now / 27) * 0.1); }
    const up = spec.view === 'sim' && (spec.phase === 'launch' || lander);
    model.rotation.set(up ? 0 : pitch + userPitch, up ? yaw * 0.3 + userYaw : yaw + userYaw, 0);
    if (lander) model.position.y = model.userData.foot ?? 0; else model.position.y = 0;
    exhaust.position.y = -(baseBottom + 0.7); exhaust.scale.set(1 + Math.sin(now / 23) * 0.12, 1 + Math.sin(now / 31) * 0.15, 1);
    for (const o of model.children) if (o.userData.s < 1) { o.userData.s = Math.min(1, o.userData.s + dt * 3.2); const e = o.userData.s, s = e < 1 ? 1 + 0.18 * Math.sin(e * Math.PI) * (1 - e) + (e - 1) * (1 - e) : 1; o.scale.setScalar(Math.max(0.01, e * s)); }
    renderer.render(scene, cam);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
  void t0;

  return {
    ok: true, film: director, /** dev aid for visual checks */ three: { scene, cam, craft, perf: () => ({ ...frameStats(), pr, updMs: Math.round(updMs * 10) / 10, calls: renderer.info.render.calls, tris: renderer.info.render.triangles, tex: renderer.info.memory.textures, geo: renderer.info.memory.geometries }) },
    scroll(px) { const v = Math.max(0, Math.round(px)); if (v !== scrollPx) { scrollPx = v; resize(); } },
    set(v) { spec = v; layout(); },
    design(d) { const k = d ? JSON.stringify([d.bus, d.shield, d.redund, d.power, d.battery, d.thermal, d.prop, Math.round(d.propKg / 20), d.avionics, d.antenna, d.instruments, d.orbit, d.mission, d.launcher]) : ''; if (k === designKey) return; designKey = k; hasCraft = !!d; if (d) { build(d); buildRocket(d.launcher); hiDirty = true; } layout(); },
    explode(on) { exOn = on; },
    focus(cat) { if (cat !== hiCat) { hiCat = cat; hiDirty = true; } },
    labels() {
      if (spec.view !== 'studio' || !craft.visible || cur.cScale < 0.2) return [];
      const root = rocket.visible ? rocket : model, r = canvas.getBoundingClientRect(), seen = new Set<string>(), out: Label[] = [];
      craft.updateMatrixWorld(true);
      for (const o of root.children) { const cat = o.userData.cat, mt = meta.get(o); if (!cat || !mt || seen.has(cat) || !o.visible) continue; seen.add(cat);
        const p = mt.anchor.clone().add(o.position).applyMatrix4(root.matrixWorld).project(cam);
        if (p.z < 1) out.push({ cat, x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height }); }
      return out;
    },
    pick(x, y) {
      if (spec.view !== 'studio') return null;
      const r = canvas.getBoundingClientRect(); ray.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), cam);
      const hit = ray.intersectObject(rocket.visible ? rocket : model, true).find(h => visibleChain(h.object));
      return hit ? catOf(hit.object) : null;
    },
    rotate(dx, dy) { userYaw += dx * 0.01; userPitch = Math.max(-1.2, Math.min(1.2, userPitch + dy * 0.01)); if (spec.view !== 'studio') spin.rotation.y += dx * 0.006; },
  };
}
