// Realistic bodies: Earth (day/night, ocean glint, clouds, atmosphere), Moon and Mars (relief from elevation data),
// the asteroid (procedural regolith, craters and boulders on the real Bennu shape), the Sun, and the other planets.
// Every material is lit by one sun description (SUN) so the scene, the films and the heliocentric view agree.
import * as THREE from 'three';
import { WORLD_FILES } from '../data/worlds';
import { Q } from './quality';

/** The artifact build inlines the standard maps as data URLs (one-file page); the web build loads them from textures/. */
const INLINE = (globalThis as { __SA_TEX?: Record<string, string> }).__SA_TEX ?? {};
const sdOf = (k: string) => INLINE[k] ?? WORLD_FILES[k]?.sd ?? '';

type V3 = THREE.Vector3;
/** Where the light comes from: a direction (sun far away) or a point (heliocentric frame). I scales brightness. */
export const SUN = { dir: new THREE.Vector3(-0.7, 0.3, 0.6).normalize(), point: null as V3 | null, I: 1 };
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
function sunFor(o: THREE.Object3D, out: V3) {
  if (SUN.point) { o.getWorldPosition(tmp2); return out.copy(SUN.point).sub(tmp2).normalize(); }
  return out.copy(SUN.dir).normalize();
}
const cache: Record<string, THREE.Texture> = {};
const lazy = new WeakMap<THREE.Texture, { key: string; state: number }>();
/** Phones and low-memory devices keep maps at 2048 px or less; capable desktops later swap in 4096-px maps where they exist. */
/** A texture whose image is loaded only when a body using it is first drawn (see ensure). */
export function wtex(k: string, srgb = true) {
  const id = k + srgb; if (cache[id]) return cache[id];
  const t = new THREE.Texture(); t.anisotropy = Q.tier === 0 ? 2 : 8; t.encoding = srgb ? THREE.sRGBEncoding : THREE.LinearEncoding; lazy.set(t, { key: k, state: 0 });
  return (cache[id] = t);
}
function load(src: string, done: (img: HTMLImageElement) => void, fail?: () => void) {
  const img = new Image(); img.decoding = 'async';
  img.onload = () => done(img); img.onerror = () => fail?.(); img.src = src;
}
function ensure(t: THREE.Texture) {
  const L = lazy.get(t); if (!L || L.state) return; L.state = 1;
  load(sdOf(L.key), img => {
    t.image = img; t.needsUpdate = true; L.state = 2;
    // upgrade quietly once the standard map is on screen; if the file is missing or blocked, the standard map stays
    const hd = L.key in INLINE ? undefined : WORLD_FILES[L.key]?.hd; // the one-file artifact carries no 4096-px maps
    if (hd && Q.hd) setTimeout(() => load(hd, big => { if (Q.hd) { t.image = big; t.needsUpdate = true; } }), 1500);
  }, () => { L.state = 3; }); // failed: keep the blank map rather than retrying every frame
}

const VERT = `varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vT; varying vec3 vB; varying vec3 vO; varying vec3 vON; varying vec3 vC; varying float vR;
void main(){ vUv = uv; vO = position; vON = normalize(normal); vC = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz; vR = length(modelMatrix[0].xyz); vec4 w = modelMatrix * vec4(position, 1.0); vP = w.xyz; mat3 m = mat3(modelMatrix);
  vec3 n = normalize(normal); vec3 t = normalize(cross(vec3(0.0, 1.0, 0.0), n) + vec3(1e-5, 0.0, 0.0));
  vN = normalize(m * n); vT = normalize(m * t); vB = normalize(m * cross(n, t)); gl_Position = projectionMatrix * viewMatrix * w; }`;
const NOISE = `float h3(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float n3(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++){ s += a * n3(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }`;
const toLin = (s: string) => `pow(${s}, vec3(2.2))`;

/** Attach per-object sun updates (materials are cloned per object so uniforms never leak between copies). */
function lit(mesh: THREE.Mesh, mat: THREE.ShaderMaterial) {
  mesh.material = mat;
  mesh.onBeforeRender = () => { const m = mesh.material as THREE.ShaderMaterial; sunFor(mesh, m.uniforms.L.value); m.uniforms.I.value = SUN.I;
    for (const k in m.uniforms) { const v = m.uniforms[k].value as THREE.Texture | null; if (v?.isTexture) ensure(v); } };
  mesh.userData.lit = true;
  return mesh;
}
/** After Object3D.clone(true) the copies share materials: give each lit mesh its own. */
export function ownMaterials(o: THREE.Object3D) {
  o.traverse(c => { const m = c as THREE.Mesh; if (!m.userData?.lit) return; const src = m.material as THREE.ShaderMaterial, cp = src.clone();
    // ShaderMaterial.clone() also clones textures (new, never-uploaded copies): share the originals instead
    for (const k in src.uniforms) if ((src.uniforms[k].value as THREE.Texture | null)?.isTexture) cp.uniforms[k].value = src.uniforms[k].value;
    lit(m, cp); });
}

// ---------------------------------------------------------------- Earth
export function earthBody(sphere: THREE.SphereGeometry) {
  const g = new THREE.Group();
  const surf = lit(new THREE.Mesh(sphere), new THREE.ShaderMaterial({
    uniforms: { day: { value: wtex('earth', false) }, night: { value: wtex('night', false) }, water: { value: wtex('water', false) }, cl: { value: wtex('clouds', false) },
      L: { value: new THREE.Vector3() }, I: { value: 1 }, cr: { value: 0 } },
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D day, night, water, cl; uniform vec3 L; uniform float I, cr; varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vC; varying float vR;
    void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vP); float d = dot(N, L), mu = max(dot(N, V), 0.0);
      vec3 alb = ${toLin('texture2D(day, vUv).rgb')}; float w = texture2D(water, vUv).r;
      float c = texture2D(cl, vUv + vec2(cr - 0.0012, 0.0006)).r; // cloud shadow, offset toward the sun side
      alb = mix(alb, alb * vec3(0.78, 0.86, 1.0), w * 0.25);
      float dif = max(d, 0.0); float dayK = smoothstep(-0.12, 0.18, d);
      vec3 col = alb * dif * (1.0 - 0.45 * c) * I * 1.15;
      // sunglint on open water (Blinn-Phong lobe + a wide sheen like the photographs)
      vec3 H = normalize(L + V); float nh = max(dot(N, H), 0.0);
      col += w * (1.0 - 0.8 * c) * dif * I * (vec3(1.0, 0.86, 0.62) * pow(nh, 220.0) * 1.6 + vec3(0.9, 0.8, 0.65) * pow(nh, 18.0) * 0.18);
      // night-side city lights
      vec3 lights = vec3(1.0, 0.72, 0.38) * pow(texture2D(night, vUv).r, 1.6) * 1.6 * (1.0 - smoothstep(-0.2, 0.04, d)) * (1.0 - 0.7 * c);
      col += lights;
      // atmosphere seen through the air column: blue haze toward the limb, reddening along the terminator
      // seen from low orbit the air column is short except right at the horizon; from afar the whole limb is hazy
      float alt = length(cameraPosition - vC) / vR - 1.0, far = smoothstep(0.03, 1.2, alt);
      float fr = pow(1.0 - mu, mix(9.0, 2.6, far)), air = smoothstep(-0.25, 0.4, d);
      col = mix(col, vec3(0.32, 0.55, 1.0) * I * air, fr * mix(0.55, 0.75, far) * air);
      /* twilight: the last sunlight is reddened by the long air path, but only in a thin strip; beyond it the air glows deep blue, then night */
      float tw = smoothstep(-0.16, 0.0, d) * (1.0 - smoothstep(0.0, 0.2, d));
      col *= mix(vec3(1.0), vec3(1.0, 0.9, 0.8), tw * 0.6);
      col += vec3(0.05, 0.1, 0.22) * tw * (0.12 + 0.5 * fr) * I;
      col += vec3(1.0, 0.5, 0.28) * fr * smoothstep(-0.07, 0.0, d) * (1.0 - smoothstep(0.0, 0.05, d)) * 0.12 * I;
      col += vec3(0.04, 0.07, 0.12) * dayK * 0.15;
      gl_FragColor = linearToOutputTexel(vec4(col, 1.0)); }`,
  }));
  g.add(surf);
  const clouds = lit(new THREE.Mesh(sphere), new THREE.ShaderMaterial({
    uniforms: { cl: { value: wtex('clouds', false) }, L: { value: new THREE.Vector3() }, I: { value: 1 } }, transparent: true, depthWrite: false,
    vertexShader: VERT,
    fragmentShader: `uniform sampler2D cl; uniform vec3 L; uniform float I; varying vec3 vN; varying vec3 vP; varying vec2 vUv;
    void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vP); float d = dot(N, L); float c = texture2D(cl, vUv).r;
      c = smoothstep(0.08, 0.85, c); float dif = max(d, 0.0);
      vec3 col = vec3(1.0, 0.99, 0.97) * (1.05 * dif) * I + vec3(0.012, 0.016, 0.03); /* night-side clouds are nearly black, faintly blue */
      col *= mix(vec3(1.0, 0.8, 0.66), vec3(1.0), smoothstep(-0.02, 0.09, d)); /* a faint warm tint on the last lit cloud tops only */
      float a = c * (0.5 + 0.5 * smoothstep(-0.25, 0.1, d)) * (0.85 + 0.15 * max(dot(N, V), 0.0));
      gl_FragColor = linearToOutputTexel(vec4(col, a)); }`,
  }));
  clouds.scale.setScalar(1.006); clouds.name = 'clouds'; clouds.userData.noSpin = false; g.add(clouds);
  g.add(atmosphere(1.028, 0x5a9cff, 0xff8a4a, 1.25));
  g.add(aurora());
  return g;
}

/** Auroral ovals for geomagnetic storms: curtains of light 100–300 km up, ringing both geomagnetic poles (tilted about 10° from the spin axis),
 * green low down (oxygen, 557.7 nm) grading to red-violet at the top. userData.set(k) fades them in; during a storm the ovals widen toward lower latitudes. */
export function aurora() {
  const g = new THREE.Group(); g.name = 'aurora'; g.visible = false; g.rotation.z = 0.17;
  const mat = new THREE.ShaderMaterial({ uniforms: { o: { value: 0 }, t: { value: 0 } }, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec2 vUv; varying vec3 vO; void main(){ vUv = uv; vO = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform float o, t; varying vec2 vUv; varying vec3 vO;
      float h1(float n){ return fract(sin(n) * 43758.5453); } float n1(float x){ float i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f); return mix(h1(i), h1(i + 1.0), f); }
      void main(){ float a = vUv.x * 6.2832; float rays = n1(a * 60.0 + t * 0.9) * 0.55 + n1(a * 23.0 - t * 0.5) * 0.45; float band = n1(a * 5.0 + t * 0.2);
        float i = pow(rays, 1.6) * (0.35 + 0.9 * band) * smoothstep(0.0, 0.08, vUv.y) * pow(1.0 - vUv.y, 1.5);
        vec3 c = mix(vec3(0.2, 1.0, 0.45), vec3(0.75, 0.2, 0.85), smoothstep(0.25, 0.95, vUv.y)); gl_FragColor = vec4(c * i * o * 3.4, 1.0); }` });
  for (const sgn of [1, -1]) { const th = 0.42, r0 = 1.012, r1 = 1.085, m = new THREE.Mesh(new THREE.CylinderGeometry(r1 * Math.sin(th), r0 * Math.sin(th), (r1 - r0) * Math.cos(th), 128, 1, true), mat);
    m.position.y = sgn * ((r0 + r1) / 2) * Math.cos(th); if (sgn < 0) m.rotation.x = Math.PI; g.add(m); }
  g.userData.set = (k: number, t: number) => { g.visible = k > 0.01; mat.uniforms.o.value = k; mat.uniforms.t.value = t; };
  return g;
}

/** A sun-aware limb glow (scattering shell). */
export function atmosphere(scale: number, day: number, dusk: number, strength: number) {
  const m = lit(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32)), new THREE.ShaderMaterial({
    uniforms: { L: { value: new THREE.Vector3() }, I: { value: 1 }, c1: { value: new THREE.Color(day) }, c2: { value: new THREE.Color(dusk) }, s: { value: strength } },
    transparent: true, blending: THREE.AdditiveBlending, side: THREE.BackSide, depthWrite: false, vertexShader: VERT,
    fragmentShader: `uniform vec3 L, c1, c2; uniform float I, s; varying vec3 vN; varying vec3 vP;
    void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vP); float d = dot(N, L);
      float i = pow(max(0.0, 0.78 - dot(N, -V)), 3.4) * s; float day = smoothstep(-0.3, 0.35, d);
      vec3 c = mix(c1 * 0.35, c1, smoothstep(-0.25, 0.2, d)); c = mix(c, c2, smoothstep(-0.1, -0.02, d) * (1.0 - smoothstep(-0.02, 0.06, d)) * 0.55) * i * day * I; /* red only in a narrow band at the terminator */ gl_FragColor = vec4(c, 1.0); }`,
  }));
  m.scale.setScalar(scale); m.userData.noSpin = true; return m;
}

// ---------------------------------------------------------------- Moon, Mars and other solid surfaces
/** Textured body with relief (normal map) and regolith photometry (k=1 lunar, 0 Lambert). */
export function rockyMat(map: string, normal: string | null, k: number, bump: number, tint = 1) {
  return new THREE.ShaderMaterial({
    uniforms: { map: { value: wtex(map, false) }, nrm: { value: normal ? wtex(normal, false) : null }, L: { value: new THREE.Vector3() }, I: { value: 1 }, k: { value: k }, bump: { value: normal ? bump : 0 }, tint: { value: tint }, det: { value: normal ? 1 : 0 } },
    vertexShader: VERT,
    extensions: { derivatives: true },
    fragmentShader: `uniform sampler2D map, nrm; uniform vec3 L; uniform float I, k, bump, tint, det; varying vec3 vN; varying vec3 vP; varying vec2 vUv; varying vec3 vT; varying vec3 vB; varying vec3 vO;
    ${NOISE}
    void main(){ vec3 G = normalize(vN), V = normalize(cameraPosition - vP); vec3 N = G;
      float fw0 = length(fwidth(vO));
      if (bump > 0.0) { vec3 m = texture2D(nrm, vUv).xyz * 2.0 - 1.0; m.xy *= bump * mix(0.25, 1.0, smoothstep(0.002, 0.02, fw0)); /* the elevation grid is coarse: ease it up close */ N = normalize(normalize(vT) * m.x + normalize(vB) * m.y + G * m.z); }
      vec3 alb = ${toLin('texture2D(map, vUv).rgb')} * tint;
      // fine regolith detail below the texture's resolution, only when seen up close (fades with screen footprint)
      float fw = length(fwidth(vO)), dk = det * (1.0 - smoothstep(0.004, 0.03, fw));
      if (dk > 0.0) { vec3 q = normalize(vO) * 260.0; float e = 0.3, h0 = fbm(q), hx = fbm(q + normalize(vT) * e), hy = fbm(q + normalize(vB) * e);
        N = normalize(N - (normalize(vT) * (hx - h0) + normalize(vB) * (hy - h0)) / e * 0.12 * dk); alb *= 1.0 + (h0 - 0.5) * 0.18 * dk; }
      N = normalize(mix(G, N, smoothstep(0.0, 0.35, dot(G, V)) * (0.45 + 0.55 * smoothstep(0.0, 0.3, dot(G, L))))); // relief eases at grazing view and near the terminator, where the coarse elevation grid would alias
      float mu0 = max(dot(N, L), 0.0), mu = max(dot(G, V), 0.0);
      float ls = 1.25 * mu0 / (mu0 + mu + 0.25); float f = mix(mu0, ls, k) * smoothstep(-0.04, 0.06, dot(G, L));
      vec3 col = alb * f * I * 1.25 + alb * 0.006;
      gl_FragColor = linearToOutputTexel(vec4(col, 1.0)); }`,
  });
}
export function rockyBody(sphere: THREE.SphereGeometry, map: string, normal: string | null, k: number, bump: number) {
  return lit(new THREE.Mesh(sphere), rockyMat(map, normal, k, bump));
}

/** Asteroid: real shape, procedural regolith with craters and boulders (dark, rough, like Bennu and Ryugu images). */
export function asteroidMesh(geo: THREE.BufferGeometry) {
  return lit(new THREE.Mesh(geo), new THREE.ShaderMaterial({
    uniforms: { L: { value: new THREE.Vector3() }, I: { value: 1 } }, vertexShader: VERT,
    fragmentShader: `uniform vec3 L; uniform float I; varying vec3 vN; varying vec3 vP; varying vec3 vT; varying vec3 vB; varying vec3 vO; varying vec3 vON;
    ${NOISE}
    float cells(vec3 p){ vec3 i = floor(p), f = fract(p); float d = 8.0;
      for (int x = -1; x <= 1; x++) for (int y = -1; y <= 1; y++) for (int z = -1; z <= 1; z++){ vec3 g = vec3(float(x), float(y), float(z));
        vec3 o = vec3(h3(i + g), h3(i + g + 11.3), h3(i + g + 23.7)); d = min(d, length(g + o - f)); } return d; }
    float crater(vec3 p){ float d = cells(p); return -smoothstep(0.42, 0.0, d) * 0.9 + smoothstep(0.30, 0.42, d) * (1.0 - smoothstep(0.42, 0.55, d)) * 0.35; }
    // rubble pile: boulders of many sizes (domes from cell distance), a few subdued craters, fine gravel
    float H(vec3 p){ return fbm(p * 4.0) * 0.35 + crater(p * 2.2) * 0.25 + smoothstep(0.42, 0.0, cells(p * 8.0)) * 0.32 + smoothstep(0.38, 0.0, cells(p * 19.0 + 5.3)) * 0.14 + fbm(p * 40.0) * 0.04; }
    void main(){ vec3 G = normalize(vN), V = normalize(cameraPosition - vP); vec3 p = vO * 1.0;
      vec3 Bt = normalize(vT), Bb = normalize(vB); float e = 0.012, h = H(p);
      vec3 nO = normalize(vON), tO = normalize(cross(vec3(0.0, 1.0, 0.0), nO) + vec3(1e-5, 0.0, 0.0)), bO = cross(nO, tO); // same frame as vT/vB
      float hx = (H(p + tO * e) - h) / e, hy = (H(p + bO * e) - h) / e;
      vec3 N = normalize(G + (Bt * hx + Bb * hy) * 0.05);
      float b = smoothstep(0.3, 0.0, cells(p * 8.0)) * (h3(floor(p * 8.0)) - 0.5); float var = fbm(p * 3.0);
      vec3 alb = mix(vec3(0.20, 0.195, 0.19), vec3(0.34, 0.33, 0.31), var) + b * 0.12;
      float mu0 = max(dot(N, L), 0.0), mu = max(dot(G, V), 0.0); float f = mix(mu0, mu0 / (mu0 + mu + 1e-3), 0.7);
      vec3 col = alb * f * I * 1.15 + alb * 0.01;
      gl_FragColor = linearToOutputTexel(vec4(col, 1.0)); }`,
  }));
}

// ---------------------------------------------------------------- the Sun
function glareTex() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.06, 'rgba(255,248,230,0.85)');
  g.addColorStop(0.2, 'rgba(255,220,170,0.25)'); g.addColorStop(0.5, 'rgba(255,190,120,0.06)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI + 0.3; x.save(); x.translate(128, 128); x.rotate(a);
    const s = x.createLinearGradient(-128, 0, 128, 0); s.addColorStop(0, 'rgba(255,240,220,0)'); s.addColorStop(0.5, 'rgba(255,245,230,0.5)'); s.addColorStop(1, 'rgba(255,240,220,0)');
    x.fillStyle = s; x.fillRect(-128, -1.2, 256, 2.4); x.restore(); }
  const t = new THREE.CanvasTexture(c); return t;
}
let glare: THREE.Texture | null = null;
let soft: THREE.Texture | null = null;
function softTex() { const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d')!;
  const g = x.createRadialGradient(128, 128, 0, 128, 128, 128); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.2, 'rgba(255,230,190,0.55)');
  g.addColorStop(0.42, 'rgba(255,170,90,0.14)'); g.addColorStop(1, 'rgba(0,0,0,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); }
/** The Sun: SDO-like surface (texture + limb darkening), corona glow. hot=1 renders it as seen by an ordinary camera (white, overexposed). */
export function sunBody(radius: number, glow: number) {
  const g = new THREE.Group();
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: (ensure(wtex('sun', false)), wtex('sun', false)) }, t: { value: 0 }, hot: { value: 0 } }, vertexShader: VERT,
    fragmentShader: `uniform sampler2D map; uniform float t, hot; varying vec3 vN; varying vec3 vP; varying vec2 vUv;
    void main(){ vec3 N = normalize(vN), V = normalize(cameraPosition - vP); float mu = max(dot(N, V), 0.0);
      vec3 s = texture2D(map, vUv + vec2(t * 0.0015, 0.0)).rgb; float l = dot(s, vec3(0.3, 0.55, 0.15));
      l = mix(l, texture2D(map, vUv * 1.7 + vec2(-t * 0.002, 0.13)).r, 0.25);
      vec3 c = mix(vec3(0.55, 0.08, 0.0), vec3(1.0, 0.5, 0.08), smoothstep(0.25, 0.75, l)) + vec3(1.0, 0.85, 0.5) * pow(smoothstep(0.6, 1.0, l), 2.0) * 1.2;
      c *= 0.55 + 0.45 * pow(mu, 0.45);
      c += vec3(1.0, 0.45, 0.1) * pow(1.0 - mu, 3.0) * 0.6; // bright active limb, as in the extreme-ultraviolet images
      c = mix(c, vec3(1.0, 0.98, 0.93) * (0.92 + 0.08 * mu), hot);
      gl_FragColor = vec4(c, 1.0); }`,
  });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(radius, 48, 32), mat); g.add(ball);
  soft ??= softTex();
  const corona = new THREE.Sprite(new THREE.SpriteMaterial({ map: soft, color: 0xffc27a, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.9 }));
  corona.scale.setScalar(radius * glow); g.add(corona);
  g.userData = { mat, corona, ball };
  return g;
}
export function tickSun(g: THREE.Object3D, t: number) { (g.userData.mat as THREE.ShaderMaterial).uniforms.t.value = t; }

/** The Sun as seen from a body: correct angular diameter, placed far along the light direction, with camera glare. */
export function sunDisc() {
  const g = sunBody(1, 0); const mat = g.userData.mat as THREE.ShaderMaterial; mat.uniforms.hot.value = 1; mat.depthWrite = false;
  glare ??= glareTex();
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glare, color: 0xfff1dc, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 1 }));
  g.add(glow); (g.userData.corona as THREE.Sprite).visible = false; g.renderOrder = -1;
  return {
    obj: g,
    /** Place at distance D from the camera along dir with angular diameter deg. */
    place(cam: THREE.Camera, dir: V3, deg: number, D = 600, glareK = 1) {
      g.position.copy(cam.position).addScaledVector(tmp.copy(dir).normalize(), D);
      const r = D * Math.tan((deg * Math.PI) / 360); g.scale.setScalar(r); glow.scale.setScalar(28 * glareK); glow.material.opacity = Math.min(1, glareK);
    },
  };
}
/** Apparent diameter of the Sun (degrees) at a distance in AU. 0.533 at 1 AU. */
export const sunDeg = (au: number) => 2 * Math.atan(696000 / (au * 1.496e8)) * (180 / Math.PI);

// ---------------------------------------------------------------- other planets (heliocentric view)
export const PLANETS = [ // a (AU), radius (Earth = 1), mean longitude at J2000 and rate (deg/day), map
  { k: 'mercury', a: 0.387, r: 0.383, L0: 252.25, n: 4.09233, map: 'mercury' },
  { k: 'venus', a: 0.723, r: 0.949, L0: 181.98, n: 1.60213, map: 'venus' },
  { k: 'jupiter', a: 5.203, r: 11.21, L0: 34.4, n: 0.08309, map: 'jupiter' },
  { k: 'saturn', a: 9.537, r: 9.45, L0: 49.94, n: 0.03346, map: 'saturn' },
  { k: 'uranus', a: 19.19, r: 4.01, L0: 313.23, n: 0.01173, map: 'uranus' },
  { k: 'neptune', a: 30.07, r: 3.88, L0: 304.88, n: 0.00598, map: 'neptune' },
];
export const EARTH_L = { L0: 100.46, n: 0.98565 };
export function planetBody(p: typeof PLANETS[number]) {
  const g = new THREE.Group(); const sph = new THREE.SphereGeometry(1, 48, 24);
  g.add(lit(new THREE.Mesh(sph), rockyMat(p.map, null, p.k === 'mercury' ? 0.8 : 0, 0)));
  if (p.k === 'saturn') {
    const rg = new THREE.RingGeometry(1.24, 2.27, 96, 1); const pos = rg.attributes.position as THREE.BufferAttribute, uv = rg.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const r = Math.hypot(pos.getX(i), pos.getY(i)); uv.setXY(i, (r - 1.24) / (2.27 - 1.24), 0.5); }
    const ring = new THREE.Mesh(rg, new THREE.MeshBasicMaterial({ map: (ensure(wtex('ring')), wtex('ring')), transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.9 }));
    ring.rotation.x = Math.PI / 2; g.add(ring); g.rotation.z = 0.47;
  }
  if (p.k === 'uranus') g.rotation.z = 1.71;
  return g;
}
