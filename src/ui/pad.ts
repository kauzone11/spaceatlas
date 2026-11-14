// The launch complex for the flight film: an LC-39-style pad (elevated hardstand, flame trench, mobile launcher,
// service tower with swing arms, lightning towers, water tower, cryogenic spheres), the crawlerway, the vehicle
// assembly building, scrub, lagoons, the beach and the Atlantic to the east. 1 unit ≈ 32 m. Not to exact scale.
import * as THREE from 'three';
import { Q } from './quality';
import { facade } from './livery';

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const canvas = (w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!); const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; return t; };

export const GROUND_R = 420;
/** Where the vehicle assembly building stands, and which way its decorated face looks (toward the pad). */
export const VAB = v3(-60, 0, -14);

function groundTexture() {
  const N = 2048, R = GROUND_R, w2p = (x: number) => ((x / R + 1) / 2) * N;
  const t = canvas(N, N, x => { const r = rng(21);
    x.fillStyle = '#4a5338'; x.fillRect(0, 0, N, N);
    for (let i = 0; i < 9000; i++) { const s = 3 + r() * 26, g = r(); x.fillStyle = g < 0.4 ? `rgba(38,52,30,${0.25 + r() * 0.3})` : g < 0.75 ? `rgba(92,100,62,${0.15 + r() * 0.25})` : `rgba(120,112,80,${0.1 + r() * 0.2})`; x.beginPath(); x.ellipse(r() * N, r() * N, s, s * (0.4 + r() * 0.8), r() * 3, 0, 7); x.fill(); }
    // lagoons (Banana River, Indian River) and marsh to the west
    const blob = (cx: number, cz: number, rx: number, rz: number, seed: number) => { const q = rng(seed); x.beginPath();
      for (let i = 0; i <= 40; i++) { const a = (i / 40) * 6.283, k = 0.75 + q() * 0.4; x.lineTo(w2p(cx + Math.cos(a) * rx * k), w2p(cz + Math.sin(a) * rz * k)); } x.closePath(); x.fill(); };
    x.fillStyle = '#3c5566'; blob(-75, 10, 22, 160, 4); blob(-150, -60, 40, 200, 5); blob(-30, 60, 14, 26, 6); blob(25, -120, 30, 60, 8); blob(-10, 110, 30, 18, 9);
    x.fillStyle = 'rgba(80,110,90,.5)'; blob(-62, 30, 8, 40, 10); blob(-40, -70, 10, 18, 11);
    // beach along the Atlantic
    const g = x.createLinearGradient(w2p(22), 0, w2p(27), 0); g.addColorStop(0, 'rgba(205,190,150,0)'); g.addColorStop(0.35, '#d8caa2'); g.addColorStop(1, '#cbbd96'); x.fillStyle = g; x.fillRect(w2p(22), 0, w2p(27) - w2p(22), N);
    // service roads
    x.strokeStyle = 'rgba(90,88,84,.9)'; x.lineWidth = 2.2; x.beginPath(); x.moveTo(w2p(-5), w2p(-400)); x.lineTo(w2p(-6), w2p(400)); x.stroke(); x.beginPath(); x.moveTo(w2p(-400), w2p(18)); x.lineTo(w2p(20), w2p(14)); x.stroke(); });
  return t;
}
const detailTexture = (base: string, specks: [string, number][], seed: number, n = 1400) => { const t = canvas(256, 256, x => { const r = rng(seed); x.fillStyle = base; x.fillRect(0, 0, 256, 256);
  for (let i = 0; i < n; i++) { const [c, a] = specks[i % specks.length]; x.fillStyle = `rgba(${c},${a * (0.4 + r() * 0.6)})`; x.fillRect(r() * 256, r() * 256, 1 + r() * 4, 1 + r() * 4); } }); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t; };

export interface Site {
  group: THREE.Group; deckTop: number; sunDir: V3; skyMat: THREE.ShaderMaterial; oceanMat: THREE.ShaderMaterial; sky: THREE.Mesh; clouds: THREE.Group;
  /** Place the swing arms against a vehicle of radius r (world) at the given heights above the deck. */ fitArms: (r: number, heights: number[]) => void;
  /** 0 = arms on the vehicle, 1 = fully swung back. */ retract: (k: number) => void;
  trenchExits: V3[]; vabTop: V3;
}

export function createSite(): Site {
  const group = new THREE.Group();
  const std = (color: number, roughness = 0.9, metalness = 0, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness, ...extra });
  const add = (o: THREE.Object3D, x = 0, y = 0, z = 0, parent: THREE.Object3D = group) => { o.position.set(x, y, z); parent.add(o); return o; };
  const mesh = (g: THREE.BufferGeometry, m: THREE.Material, cast = true, recv = true) => { const o = new THREE.Mesh(g, m); o.castShadow = cast; o.receiveShadow = recv; return o; };
  const sunDir = v3(0.72, 0.48, 0.5).normalize();

  // ---- sky: clear-air gradient (deep blue overhead, pale and hazy toward the horizon), forward-scattered glow around the Sun,
  // thin cirrus high up; k darkens it to space during the ascent
  const N2 = `float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
    float fb2(vec2 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 4; i++){ s += a * n2(p); p = p * 2.07 + 3.1; a *= 0.5; } return s; }`;
  const skyMat = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { zn: { value: new THREE.Color(0x1d4f9e) }, hz: { value: new THREE.Color(0xb4cde8) }, gr: { value: new THREE.Color(0x8a9a8a) }, sd: { value: sunDir.clone() }, k: { value: 0 }, sc: { value: new THREE.Color(0xfff1d8) }, tm: { value: 0 } },
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 zn, hz, gr, sc, sd; uniform float k, tm; varying vec3 vD;
      ${N2}
      void main(){ vec3 d = normalize(vD); float y = d.y, yc = clamp(y, 0.0, 1.0); float s = max(dot(d, normalize(sd)), 0.0);
        vec3 c = mix(hz, zn, pow(yc, 0.42)); c = mix(c, zn * 0.72, smoothstep(0.35, 1.0, yc) * 0.5);
        c += vec3(0.95, 0.96, 0.98) * pow(1.0 - yc, 12.0) * 0.22; /* haze lying on the horizon */
        c += sc * (pow(s, 60.0) * 0.4 + pow(s, 6.0) * 0.14) * (1.0 - k);
        /* cirrus: wind-combed ice cloud far above the cumulus */
        vec2 q = d.xz / (yc + 0.18); float ci = fb2(vec2(q.x * 1.1 + q.y * 0.5, q.y * 3.2) + tm * 0.004); ci = smoothstep(0.52, 0.86, ci) * smoothstep(0.04, 0.3, y) * 0.34;
        c = mix(c, vec3(1.0, 0.99, 0.97), ci * (1.0 - k));
        c = y < 0.0 ? mix(hz, gr, smoothstep(0.0, -0.06, y)) : c;
        c += sc * pow(s, 900.0) * 6.0;
        vec3 space = vec3(0.004, 0.008, 0.02) + vec3(0.22, 0.42, 0.85) * exp(-max(y + 0.02, 0.0) * 16.0) * 0.6 + vec3(0.7, 0.85, 1.0) * exp(-max(y + 0.02, 0.0) * 70.0) * 0.5 + sc * pow(s, 900.0) * 6.0;
        gl_FragColor = vec4(mix(c, space, k), 1.0); }` });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 48, 24), skyMat); sky.renderOrder = -2; sky.frustumCulled = false; group.add(sky);
  // fair-weather cumulus: flat bases, bright rounded tops, paler and bluer with distance
  const clouds = new THREE.Group(); group.add(clouds);
  { const mkCloud = (seed: number) => canvas(512, 256, x => { const r = rng(seed), base = 178;
      for (let i = 0; i < 90; i++) { const u = r(), cx = 70 + u * 372, hill = Math.sin(u * Math.PI) * (0.5 + 0.5 * Math.sin(u * 9 + seed)), cy = base - r() * (30 + 90 * hill), s = 14 + r() * (22 + 30 * hill);
        const g = x.createRadialGradient(cx, cy - s * 0.25, 0, cx, cy, s); g.addColorStop(0, 'rgba(255,255,255,.95)'); g.addColorStop(0.55, 'rgba(250,251,253,.7)'); g.addColorStop(1, 'rgba(240,244,250,0)'); x.fillStyle = g; x.beginPath(); x.arc(cx, cy, s, 0, 7); x.fill(); }
      x.globalCompositeOperation = 'destination-out'; const cut = x.createLinearGradient(0, base - 6, 0, base + 26); cut.addColorStop(0, 'rgba(0,0,0,0)'); cut.addColorStop(1, 'rgba(0,0,0,1)'); x.fillStyle = cut; x.fillRect(0, base - 6, 512, 90);
      x.globalCompositeOperation = 'source-atop'; const sh = x.createLinearGradient(0, 70, 0, base + 10); sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(0.55, 'rgba(190,200,216,.25)'); sh.addColorStop(1, 'rgba(118,132,158,.8)'); x.fillStyle = sh; x.fillRect(0, 0, 512, 256); });
    const texs = [31, 47, 58].map(mkCloud), r = rng(44), far = new THREE.Color(0xc4d6ec);
    for (let i = 0; i < 44; i++) { const a = r() * 6.283, d = 120 + r() * 300, f = (d - 120) / 300, s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texs[i % 3], transparent: true, opacity: 0.95 - f * 0.35, fog: false, depthWrite: false }));
      s.material.color.set(0xffffff).lerp(far, f * 0.75); const w = 46 + r() * 70; s.position.set(Math.cos(a) * d, 16 + f * 22 + r() * 10, Math.sin(a) * d); s.scale.set(w, w * 0.5, 1); clouds.add(s); } }

  // ---- terrain, water, apron
  const ground = mesh(new THREE.CircleGeometry(GROUND_R, 96), std(0xffffff, 1, 0, { map: groundTexture() }), false, true); ground.rotation.x = -Math.PI / 2; group.add(ground);
  // the Atlantic: sky reflection by Fresnel, wind ripples, sun glitter, turquoise shallows fading to deep blue, haze toward the horizon
  const oceanMat = new THREE.ShaderMaterial({ uniforms: { zn: skyMat.uniforms.zn, hz: skyMat.uniforms.hz, sd: skyMat.uniforms.sd, k: skyMat.uniforms.k, tm: skyMat.uniforms.tm, fc: { value: new THREE.Color(0xbcd3ea) }, ff: { value: 330 } },
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform vec3 zn, hz, sd, fc; uniform float k, tm, ff; varying vec3 vW;
      ${N2}
      void main(){ vec3 V = cameraPosition - vW; float dist = length(V); V /= dist; vec2 p = vW.xz; float fade = exp(-dist * 0.012);
        float e = 0.08; vec2 w1 = p * 1.7 + vec2(tm * 0.35, tm * 0.12), w2 = p * 5.3 - vec2(tm * 0.5, -tm * 0.3);
        float h0 = fb2(w1) + 0.4 * n2(w2), hx = fb2(w1 + vec2(e, 0.0)) + 0.4 * n2(w2 + vec2(e * 3.0, 0.0)), hz2 = fb2(w1 + vec2(0.0, e)) + 0.4 * n2(w2 + vec2(0.0, e * 3.0));
        vec3 N = normalize(vec3(-(hx - h0) / e * 0.09 * fade, 1.0, -(hz2 - h0) / e * 0.09 * fade));
        float fres = 0.03 + 0.97 * pow(1.0 - max(dot(N, V), 0.0), 5.0); vec3 Rf = reflect(-V, N); Rf.y = abs(Rf.y);
        vec3 skyc = mix(hz, zn, pow(clamp(Rf.y, 0.0, 1.0), 0.42));
        float shore = smoothstep(0.0, 26.0, vW.x - 26.0); vec3 water = mix(vec3(0.07, 0.3, 0.32), vec3(0.012, 0.07, 0.15), shore);
        water = mix(vec3(0.75, 0.82, 0.8), water, smoothstep(0.0, 1.1, vW.x - 26.0 + (n2(p * 0.9 + tm * 0.1) - 0.5) * 1.2)); /* surf */
        vec3 c = mix(water, skyc, fres) + vec3(1.0, 0.95, 0.85) * pow(max(dot(Rf, normalize(sd)), 0.0), 260.0) * 5.0 * (0.4 + 1.2 * n2(p * 9.0 + tm));
        c = mix(fc, c, exp(-pow(dist / ff, 2.0) * 1.2)); c = mix(c, c * 0.25 + vec3(0.0, 0.01, 0.03), k);
        gl_FragColor = vec4(c, 1.0); }` });
  const ocean = mesh(new THREE.PlaneGeometry(900, 1000), oceanMat, false, false); ocean.rotation.x = -Math.PI / 2; add(ocean, 26 + 450, 0.03, 0);
  const grassT = detailTexture('#56623f', [['38,52,30', 0.5], ['110,118,70', 0.35], ['140,130,90', 0.2]], 3); grassT.repeat.set(10, 10);
  const apron = mesh(new THREE.PlaneGeometry(22, 22), std(0xffffff, 1, 0, { map: grassT }), false, true); apron.rotation.x = -Math.PI / 2; add(apron, 0, 0.01, 0);
  const asphalt = std(0x3a3b3d, 0.95);
  const road = mesh(new THREE.RingGeometry(5.6, 5.85, 80), asphalt, false, true); road.rotation.x = -Math.PI / 2; add(road, 0, 0.015, 0);

  // ---- hardstand (square frustum) with the flame trench running east-west
  const concT = detailTexture('#9a978f', [['70,70,68', 0.25], ['150,146,138', 0.25], ['40,36,30', 0.12]], 7, 2200); concT.repeat.set(3, 3);
  const concrete = std(0xffffff, 0.95, 0, { map: concT, flatShading: true });
  const HS = 0.45, hard = mesh(new THREE.CylinderGeometry(2.1 * Math.SQRT2, 3.5 * Math.SQRT2, HS, 4, 1), concrete); hard.rotation.y = Math.PI / 4; add(hard, 0, HS / 2, 0);
  const dark = std(0x141414, 1);
  add(mesh(new THREE.BoxGeometry(6.6, 0.02, 0.5), dark, false, false), 0, HS + 0.002, 0);
  for (const s of [-1, 1]) { const o = mesh(new THREE.BoxGeometry(0.9, 0.34, 0.56), dark, false, false); add(o, s * 3.1, 0.15, 0); }
  // mobile launcher on pedestals
  const steelGrey = std(0x7c8086, 0.6, 0.45), deckM = std(0x8e9196, 0.75, 0.3);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.16, 0.12, 0.16), steelGrey), sx * 0.66, HS + 0.06, sz * 0.52);
  const deck = mesh(new THREE.BoxGeometry(1.8, 0.24, 1.45), deckM); add(deck, 0, HS + 0.12 + 0.12, 0);
  const deckTop = HS + 0.12 + 0.24;
  add(mesh(new THREE.BoxGeometry(0.62, 0.01, 0.62), dark, false, false), 0, deckTop + 0.004, 0);
  for (const sx of [-1, 1]) add(mesh(new THREE.BoxGeometry(0.12, 0.16, 0.5), steelGrey), sx * 0.75, deckTop + 0.08, 0.35); // tail service masts

  // ---- service tower: lattice of beams in one instanced mesh, floors, hammerhead crane, lightning mast
  const TX = -0.98, TW = 0.46, TH = 3.35, LV = 0.24;
  const beams: THREE.Matrix4[] = []; const q = new THREE.Quaternion(), sc = v3(), pos = v3(), e = new THREE.Euler();
  const beam = (a: V3, b: V3, t = 0.03) => { pos.copy(a).add(b).multiplyScalar(0.5); const d = b.clone().sub(a), L = d.length(); q.setFromUnitVectors(v3(0, 1, 0), d.normalize()); sc.set(t, L, t); beams.push(new THREE.Matrix4().compose(pos.clone(), q.clone(), sc.clone())); };
  const c4 = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => [a * TW / 2, b * TW / 2]);
  for (const [cx, cz] of c4) beam(v3(TX + cx, HS, cz), v3(TX + cx, HS + TH, cz), 0.045);
  for (let y = HS + LV, i = 0; y <= HS + TH + 0.001; y += LV, i++) for (let s = 0; s < 4; s++) { const [ax, az] = c4[s], [bx, bz] = c4[(s + 1) % 4];
    beam(v3(TX + ax, y, az), v3(TX + bx, y, bz), 0.022); const lo = y - LV; if ((i + s) % 2) beam(v3(TX + ax, lo, az), v3(TX + bx, y, bz), 0.016); else beam(v3(TX + bx, lo, bz), v3(TX + ax, y, az), 0.016); }
  void e;
  const latticeM = std(0x6e747b, 0.55, 0.55);
  const lattice = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), latticeM, beams.length); beams.forEach((m, i) => lattice.setMatrixAt(i, m)); lattice.castShadow = lattice.receiveShadow = true; group.add(lattice);
  for (let y = HS + LV * 3; y < HS + TH; y += LV * 3) add(mesh(new THREE.BoxGeometry(TW + 0.08, 0.018, TW + 0.08), steelGrey), TX, y, 0);
  add(mesh(new THREE.BoxGeometry(0.3, 0.5, 0.3), std(0x8a8f96, 0.7, 0.3)), TX - 0.05, HS + 0.25, -0.05); // elevator housing
  add(mesh(new THREE.BoxGeometry(1.2, 0.05, 0.07), std(0xb24a2a, 0.6, 0.3)), TX + 0.25, HS + TH + 0.08, 0); // hammerhead crane
  add(mesh(new THREE.BoxGeometry(0.12, 0.16, 0.12), std(0xb24a2a, 0.6, 0.3)), TX, HS + TH + 0.15, 0);
  add(mesh(new THREE.CylinderGeometry(0.008, 0.02, 1.1, 6), steelGrey), TX, HS + TH + 0.7, 0);
  // swing arms: pivot at the tower face, reaching toward +x
  const arms: { g: THREE.Group; bar: THREE.Mesh; h: number }[] = [];
  const armM = std(0x9aa0a7, 0.6, 0.45);
  for (let i = 0; i < 3; i++) { const g = new THREE.Group(); const bar = mesh(new THREE.BoxGeometry(1, 0.07, 0.09), armM); g.add(bar); add(g, TX + TW / 2, 0, 0.0); arms.push({ g, bar, h: 0 }); }
  function fitArms(r: number, heights: number[]) {
    const L = Math.max(0.05, -r - (TX + TW / 2) + 0.005);
    arms.forEach((a, i) => { const h = heights[i]; a.g.visible = h != null; if (h == null) return; a.g.position.y = deckTop + h; a.bar.scale.x = L; a.bar.position.x = L / 2; });
  }
  function retract(k: number) { arms.forEach((a, i) => { a.g.rotation.y = Math.min(1, Math.max(0, k * 1.25 - i * 0.12)) * 1.45; }); }

  // ---- lightning protection: three towers with catenary wires
  const mastM = std(0x8b9097, 0.55, 0.5), wireM = new THREE.LineBasicMaterial({ color: 0x3d4146, transparent: true, opacity: 0.8 });
  const masts = [v3(-3.6, 0, -3.3), v3(3.7, 0, -2.9), v3(-3.3, 0, 3.6)], MH = 5.6;
  for (const m of masts) { add(mesh(new THREE.CylinderGeometry(0.035, 0.09, MH, 8), mastM), m.x, MH / 2, m.z); add(mesh(new THREE.CylinderGeometry(0.01, 0.02, 0.8, 6), mastM), m.x, MH + 0.4, m.z); }
  const wire = (a: V3, b: V3, sag: number) => { const pts: V3[] = []; for (let i = 0; i <= 24; i++) { const t = i / 24; pts.push(a.clone().lerp(b, t).add(v3(0, -sag * 4 * t * (1 - t), 0))); } group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), wireM)); };
  for (let i = 0; i < 3; i++) { const a = masts[i].clone().setY(MH), b = masts[(i + 1) % 3].clone().setY(MH); wire(a, b, 1.1);
    const out = masts[i].clone().setY(0).normalize(); for (const s of [-0.6, 0.6]) wire(a, masts[i].clone().add(out.clone().applyAxisAngle(v3(0, 1, 0), s).multiplyScalar(4)).setY(0), 0.6); }

  // ---- water tower, cryogenic spheres, support buildings
  const white = std(0xe8eaec, 0.5, 0.3), silver = std(0xc9ccd0, 0.35, 0.7);
  { const W = v3(-8.5, 0, 6.8); for (let i = 0; i < 4; i++) { const a = (i / 4) * 6.283 + 0.785; add(mesh(new THREE.CylinderGeometry(0.03, 0.04, 3, 6), silver), W.x + Math.cos(a) * 0.35, 1.5, W.z + Math.sin(a) * 0.35); }
    add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 3.2, 8), silver), W.x, 1.6, W.z); add(mesh(new THREE.SphereGeometry(0.62, 24, 16), white), W.x, 3.35, W.z); }
  for (const [x, z, r] of [[5.2, -5.6, 0.62], [-6.2, 2.4, 0.55]] as const) { add(mesh(new THREE.SphereGeometry(r, 24, 16), white), x, r + 0.12, z); add(mesh(new THREE.CylinderGeometry(r * 0.7, r * 0.8, 0.14, 16), concrete), x, 0.07, z); }
  for (const [x, z, w, h, d, c] of [[6.5, 3.2, 1.4, 0.35, 0.9, 0xd8d4c8], [-6.8, -1.6, 0.9, 0.3, 1.6, 0xe6e6e2], [8.8, -2.6, 1.0, 0.45, 0.7, 0xcfcac0], [-9.5, 6.8, 2.2, 0.5, 1.2, 0xe2dfd8]] as const)
    add(mesh(new THREE.BoxGeometry(w, h, d), std(c, 0.85)), x, h / 2, z);

  // ---- crawlerway to the assembly building
  const gravel = std(0xffffff, 1, 0, { map: (() => { const t = detailTexture('#bdb6a6', [['150,144,130', 0.4], ['220,214,200', 0.4]], 9); t.repeat.set(1, 30); return t; })() });
  { const from = v3(-3.6, 0, 0), to = VAB.clone().add(v3(3.8, 0, 4.4)), d = to.clone().sub(from), L = d.length(), ang = Math.atan2(d.x, d.z), side = v3(Math.cos(ang), 0, -Math.sin(ang));
    for (const s of [-0.52, 0.52]) { const o = mesh(new THREE.PlaneGeometry(0.42, L), gravel, false, true); o.rotation.set(-Math.PI / 2, 0, ang); add(o, from.x + d.x / 2 + side.x * s, 0.012, from.z + d.z / 2 + side.z * s); } }

  // ---- vehicle assembly building with its low bay, facing the pad
  const vab = new THREE.Group(); vab.position.copy(VAB); vab.rotation.y = Math.atan2(-VAB.x, -VAB.z); group.add(vab);
  const VW = 5.0, VH = 5.0, VD = 6.6;
  const fm = (w: number, h: number, decor: boolean, seed: number) => std(0xffffff, 0.85, 0, { map: facade(w, h, decor, seed) });
  const roof = std(0x8d8c88, 0.95);
  const hb = mesh(new THREE.BoxGeometry(VW, VH, VD), [fm(VD, VH, false, 2), fm(VD, VH, false, 3), roof, roof, fm(VW, VH, true, 1), fm(VW, VH, false, 4)] as unknown as THREE.Material); hb.position.y = VH / 2; vab.add(hb);
  const lb = mesh(new THREE.BoxGeometry(3.4, 1.7, VD * 0.9), [roof, fm(VD, 1.7, false, 5), roof, roof, fm(3.4, 1.7, false, 6), roof] as unknown as THREE.Material); lb.position.set(-VW / 2 - 1.7, 0.85, -0.2); vab.add(lb);
  vab.updateMatrixWorld(true); const vabTop = vab.localToWorld(v3(0, VH + 0.6, 0));

  // ---- scrub and palms (instanced), kept off the pad, the roads and the buildings
  { const r = rng(77), N = 5200, geo = new THREE.IcosahedronGeometry(1, 0), // 20 triangles a bush (a 7x5 sphere had 70): ~260k fewer triangles in the pad shots
       mat = std(0xffffff, 1);
    const trees = new THREE.InstancedMesh(geo, mat, N), m = new THREE.Matrix4(), col = new THREE.Color(); let n = 0;
    const cw0 = v3(-3.6, 0, 0), cw1 = VAB.clone(), cwd = cw1.clone().sub(cw0), cwl = cwd.length(); cwd.normalize();
    let cx = 0, cz = 0, left = 0;
    for (let i = 0; i < N * 4 && n < N; i++) { if (left-- <= 0) { const a = r() * 6.283, d = 6.8 + Math.pow(r(), 1.5) * 150; cx = Math.cos(a) * d; cz = Math.sin(a) * d; left = 6 + Math.floor(r() * 30); }
      const x = cx + (r() - 0.5) * 3.2, z = cz + (r() - 0.5) * 3.2; if (Math.hypot(x, z) < 6.4) continue;
      if (x > 21) continue; const rel = v3(x, 0, z).sub(cw0), along = rel.dot(cwd); if (along > -1 && along < cwl + 2 && rel.clone().sub(cwd.clone().multiplyScalar(along)).length() < 2.4) continue;
      if (v3(x, 0, z).distanceTo(VAB) < 7.5 || (Math.abs(x + 6) < 1 && Math.abs(z) < 60)) continue;
      const s = 0.05 + r() * r() * 0.14; m.compose(v3(x, s * 0.5, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r() * 6, 0)), v3(s * (1 + r() * 0.6), s * (0.65 + r() * 0.5), s * (1 + r() * 0.6)));
      trees.setMatrixAt(n, m); col.setHSL(0.2 + r() * 0.09, 0.2 + r() * 0.15, 0.085 + r() * 0.07); trees.setColorAt(n, col); n++; }
    // fewer bushes on slower devices (instances are scattered in random clumps, so a prefix still covers the whole area)
    const all = n, fit = () => { trees.count = Math.round(all * [0.35, 0.7, 1][Q.tier]); }; fit(); Q.onChange(fit);
    trees.receiveShadow = false; group.add(trees); }

  const trenchExits = [v3(-3.1, 0.2, 0), v3(3.1, 0.2, 0)];
  return { group, deckTop, sunDir, skyMat, oceanMat, sky, clouds, fitArms, retract, trenchExits, vabTop };
}
