// Flight films: what the mission looks like between decisions — from the pad at Kennedy Space Center to the target.
// Time is compressed. Telemetry follows typical published ascent and transfer profiles and is labelled as illustrative.
import * as THREE from 'three';
import { Q } from './quality';
import type { MissionId } from '../engine/catalog';
import { sfx } from './audio';
import { createSite, VAB } from './pad';
import { SUN, ownMaterials, sunBody, tickSun, sunDisc, sunDeg, planetBody, PLANETS, EARTH_L } from './worlds';

type V3 = THREE.Vector3;
const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** Piecewise-linear lookup in a [[x, y], …] table. */
const lerpT = (tb: number[][], x: number) => { if (x <= tb[0][0]) return tb[0][1]; for (let i = 1; i < tb.length; i++) if (x <= tb[i][0]) { const [x0, y0] = tb[i - 1], [x1, y1] = tb[i]; return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); } return tb[tb.length - 1][1]; };
const latlon = (lat: number, lon: number, r = 1) => { const p = ((90 - lat) * Math.PI) / 180, t = ((lon + 180) * Math.PI) / 180; return v3(-r * Math.sin(p) * Math.cos(t), r * Math.cos(p), r * Math.sin(p) * Math.sin(t)); };
const slerp = (a: V3, b: V3, s: number) => { const w = Math.acos(clamp(a.dot(b), -1, 1)), k = Math.sin(w) || 1; return a.clone().multiplyScalar(Math.sin((1 - s) * w) / k).add(b.clone().multiplyScalar(Math.sin(s * w) / k)); };

export type Film = 'launch' | 'cruise' | 'arrival';
export type CamId = 'auto' | 'ground' | 'track' | 'onboard';
type Base = Film;
export type Ending = 'ok' | 'hold' | 'short' | 'offorbit';
export type Arrive = 'orbit' | 'land' | 'aero' | 'nav' | 'miss' | 'flyby';
export type Fx = 'storm' | 'dark' | 'dust' | 'streaks' | 'plasma' | 'clouds' | 'sunblock';
export interface FilmSpec {
  key: string; films: Film[]; hold: boolean; ops: boolean; phase: string; mission: MissionId; ending: Ending; arrive: Arrive; post: string | null; fx: Fx | null;
  cruiseDays: number; altKm: number; plannedAltKm: number;
}
export interface FilmEvent { k: string; at: number }
export interface FilmInfo {
  active: boolean; ready: boolean; u: number; dur: number; clock: { kind: 'T' | 'day' | 'none'; v: number; of?: number }; warp: number;
  alt: number | null; vel: number | null; dist: number | null; events: FilmEvent[]; seq: number; film: Film | null; labels: { k: string; x: number; y: number }[]; alert: boolean; hold: boolean;
}
export interface FilmCtx {
  renderer: THREE.WebGLRenderer; scene: THREE.Scene; cam: THREE.PerspectiveCamera; sun: THREE.DirectionalLight; canvas: HTMLCanvasElement; reduced: boolean;
  bodies: Record<string, THREE.Object3D>; rocket: THREE.Group; model: THREE.Group; envs: { space: THREE.Texture; day: THREE.Texture };
  /** Where the always-on scene currently draws the body and the spacecraft (used by effects during operations). */
  anchor: () => { planet: V3; R: number; craft: V3 };
  restoreView: () => void;
}

// ---------------------------------------------------------------- shared textures and materials
function canvasTex(w: number, h: number, draw: (x: CanvasRenderingContext2D) => void) { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d')!); const t = new THREE.CanvasTexture(c); return t; }
const glowTex = () => canvasTex(128, 128, x => { const g = x.createRadialGradient(64, 64, 0, 64, 64, 64); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.75)'); g.addColorStop(0.45, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 128, 128); });
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** Camera-facing quads with per-particle age, size and spin (instanced, so they can be large without point-size limits).
 * Additive for fire and sparks; normal blending for smoke, steam and dust. Smoke can be lit by a nearby flame (fl, fi). */
function particles(n: number, color: number, hot: number, additive: boolean, grow: number, opacity = 1, map: THREE.Texture | null = null) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(n * 3), age = new Float32Array(n).fill(1), size = new Float32Array(n), rot = new Float32Array(n), vel = new Float32Array(n * 3), life = new Float32Array(n).fill(1), spin = new Float32Array(n);
  const aPos = new THREE.InstancedBufferAttribute(pos, 3), aAge = new THREE.InstancedBufferAttribute(age, 1), aSize = new THREE.InstancedBufferAttribute(size, 1), aRot = new THREE.InstancedBufferAttribute(rot, 1);
  g.setAttribute('iPos', aPos); g.setAttribute('iAge', aAge); g.setAttribute('iSize', aSize); g.setAttribute('iRot', aRot); (g as THREE.InstancedBufferGeometry).instanceCount = n;
  const mat = new THREE.ShaderMaterial({
    uniforms: { c: { value: new THREE.Color(color) }, h: { value: new THREE.Color(hot) }, grow: { value: grow }, op: { value: opacity }, hw: { value: additive ? 0.25 : 0.06 }, map: { value: map }, useMap: { value: map ? 1 : 0 }, fl: { value: new THREE.Vector3() }, fi: { value: 0 }, amb: { value: 1 } },
    vertexShader: `attribute vec3 iPos; attribute float iAge, iSize, iRot; uniform float grow, fi; uniform vec3 fl; varying float vA, vG; varying vec2 vUv;
      void main(){ vA = iAge; vUv = uv; vec4 mv = modelViewMatrix * vec4(iPos, 1.0); float s = iAge >= 1.0 ? 0.0 : iSize * (1.0 + grow * iAge);
        float c = cos(iRot), sn = sin(iRot); mv.xy += vec2(c * position.x - sn * position.y, sn * position.x + c * position.y) * s;
        vG = fi * exp(-distance(iPos, fl) * 1.5); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform vec3 c, h; uniform float op, hw, useMap, amb; uniform sampler2D map; varying float vA, vG; varying vec2 vUv;
      void main(){ if (vA >= 1.0) discard; vec4 tx = useMap > 0.5 ? texture2D(map, vUv) : vec4(1.0, 1.0, 1.0, smoothstep(0.5, 0.0, length(vUv - 0.5)));
        float a = tx.a * pow(1.0 - vA, 1.2) * smoothstep(0.0, 0.03, vA) * op;
        vec3 col = mix(h, c, smoothstep(0.0, hw, vA)) * tx.rgb * amb + vec3(1.0, 0.56, 0.22) * vG * (1.0 - vA * 0.6);
        gl_FragColor = vec4(col, a); }`,
    transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; let next = 0;
  return {
    pts: mesh, mat,
    emit(p: V3, v: V3, s: number, l: number) { const i = next; next = (next + 1) % n; pos.set([p.x, p.y, p.z], i * 3); vel.set([v.x, v.y, v.z], i * 3); age[i] = 0; size[i] = s; life[i] = l; rot[i] = Math.random() * 6.283; spin[i] = (Math.random() - 0.5) * 0.6; },
    step(dt: number, drag = 0, lift = 0) {
      const f = Math.max(0, 1 - drag * dt);
      for (let i = 0; i < n; i++) { if (age[i] >= 1) continue; age[i] = Math.min(1, age[i] + dt / life[i]); rot[i] += spin[i] * dt;
        vel[i * 3] *= f; vel[i * 3 + 1] = vel[i * 3 + 1] * f + lift * dt; vel[i * 3 + 2] *= f; pos[i * 3] += vel[i * 3] * dt; pos[i * 3 + 1] += vel[i * 3 + 1] * dt; pos[i * 3 + 2] += vel[i * 3 + 2] * dt; }
      aPos.needsUpdate = aAge.needsUpdate = aSize.needsUpdate = aRot.needsUpdate = true;
    },
    clear() { age.fill(1); aAge.needsUpdate = true; },
  };
}
type Parts = ReturnType<typeof particles>;

/** Four cauliflower puffs in a 2×2 atlas: rg = surface normal, a = density. Built from overlapping domes, so each has lobes and creases. */
function billowTex() {
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S * 2; const x = c.getContext('2d')!, img = x.createImageData(S * 2, S * 2), H = new Float32Array(S * S), D = new Float32Array(S * S);
  const hh = (a: number, b: number) => { const t = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return t - Math.floor(t); };
  const vn = (a: number, b: number) => { const i = Math.floor(a), j = Math.floor(b), f = a - i, g = b - j, u = f * f * (3 - 2 * f), v = g * g * (3 - 2 * g); return (hh(i, j) * (1 - u) + hh(i + 1, j) * u) * (1 - v) + (hh(i, j + 1) * (1 - u) + hh(i + 1, j + 1) * u) * v; };
  const fbm = (a: number, b: number) => vn(a, b) * 0.5 + vn(a * 2.1 + 5, b * 2.1 + 3) * 0.27 + vn(a * 4.3 + 9, b * 4.3 + 1) * 0.15 + vn(a * 8.7, b * 8.7 + 7) * 0.08;
  for (let v = 0; v < 4; v++) { const r = rng(31 + v * 7), bl: number[][] = [];
    for (let i = 0; i < 30; i++) { const a = r() * 6.283, d = Math.pow(r(), 0.7) * 27; bl.push([64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 8 + r() * 17, 0.45 + r() * 0.55]); }
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) { let h = 0, dn = 0; for (const [bx, by, br, bh] of bl) { const d2 = ((px - bx) ** 2 + (py - by) ** 2) / (br * br); if (d2 < 1) h = Math.max(h, bh * Math.sqrt(1 - d2)); dn += bh * Math.exp(-d2 * 1.6); }
      const n = fbm(px / 9 + v * 13, py / 9), edge = Math.min(1, Math.max(0, (dn - 0.3 - n * 0.9) * 0.55)), rr = Math.hypot(px - 64, py - 64) / 62; D[py * S + px] = edge * edge * (3 - 2 * edge) * Math.max(0, 1 - rr * rr * rr) * Math.exp(-rr * rr * 1.2); H[py * S + px] = h * 0.55 + dn * 0.12 + n * 0.5; }
    const ox = (v % 2) * S, oy = (v >> 1) * S;
    for (let py = 0; py < S; py++) for (let px = 0; px < S; px++) { const g = (ax: number, ay: number) => H[Math.min(S - 1, Math.max(0, ay)) * S + Math.min(S - 1, Math.max(0, ax))];
      const nx = -(g(px + 2, py) - g(px - 2, py)) * 7, ny = (g(px, py + 2) - g(px, py - 2)) * 7, l = Math.hypot(nx, ny, 1), o = ((oy + py) * S * 2 + ox + px) * 4;
      img.data[o] = (nx / l * 0.5 + 0.5) * 255; img.data[o + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[o + 2] = Math.min(1, g(px, py)) * 255; img.data[o + 3] = D[py * S + px] * 255; } }
  x.putImageData(img, 0, 0); return new THREE.CanvasTexture(c);
}
interface BillowOpt { grow?: number; tint?: number; op?: number }
/** Smoke, steam, vapour and dust: camera-facing puffs shaded as lumpy volumes — sunlit on one side, sky-lit in shadow, glowing near a flame —
 * that swell, break apart as they age, are stirred by turbulence, drift with the wind and spread when they reach the ground. Drawn far to near. */
function billows(n: number, cam: THREE.Camera, map: THREE.Texture, lit: number, shade: number, grow0: number, op0 = 1) {
  const quad = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
  g.index = quad.index; g.setAttribute('position', quad.attributes.position); g.setAttribute('uv', quad.attributes.uv);
  const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3), age = new Float32Array(n).fill(1), life = new Float32Array(n).fill(1), size = new Float32Array(n), rot = new Float32Array(n), spin = new Float32Array(n), vr = new Float32Array(n), grow = new Float32Array(n), tint = new Float32Array(n), opa = new Float32Array(n);
  const gP = new Float32Array(n * 3), gA = new Float32Array(n * 4), gB = new Float32Array(n * 3), aP = new THREE.InstancedBufferAttribute(gP, 3), aA = new THREE.InstancedBufferAttribute(gA, 4), aB = new THREE.InstancedBufferAttribute(gB, 3);
  g.setAttribute('iPos', aP); g.setAttribute('iA', aA); g.setAttribute('iB', aB); g.instanceCount = 0;
  const mat = new THREE.ShaderMaterial({
    uniforms: { map: { value: map }, li: { value: new THREE.Color(lit) }, sh: { value: new THREE.Color(shade) }, Lv: { value: new THREE.Vector3(0, 1, 0) }, fl: { value: new THREE.Vector3() }, fi: { value: 0 }, amb: { value: 1 }, op: { value: op0 } },
    vertexShader: `attribute vec3 iPos; attribute vec4 iA; attribute vec3 iB; uniform vec3 Lv, fl; uniform float fi; varying vec2 vUv; varying float vAge, vTint, vG, vOp; varying vec3 vL;
      void main(){ float age = iA.x; vec4 mv = modelViewMatrix * vec4(iPos, 1.0); float s = iA.y * (1.0 + iB.x * pow(age, 0.6)); float c = cos(iA.z), sn = sin(iA.z);
        mv.xy += vec2(c * position.x - sn * position.y, sn * position.x + c * position.y) * s; vL = vec3(c * Lv.x + sn * Lv.y, -sn * Lv.x + c * Lv.y, Lv.z);
        vUv = (uv + vec2(mod(iA.w, 2.0), floor(iA.w / 2.0))) * 0.5; vAge = age; vTint = iB.y; vOp = iB.z; vG = fi * exp(-distance(iPos, fl) * 1.1); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform sampler2D map; uniform vec3 li, sh; uniform float amb, op; varying vec2 vUv; varying float vAge, vTint, vG, vOp; varying vec3 vL;
      void main(){ vec4 t = texture2D(map, vUv); float er = vAge * vAge * 0.7;
        float a = smoothstep(er, er + 0.6, t.a) * (1.0 - smoothstep(0.6, 1.0, vAge)) * smoothstep(0.0, 0.05, vAge) * vOp * op; if (a < 0.004) discard;
        vec3 N = normalize(vec3(t.rg * 2.0 - 1.0, 0.9)); float d = dot(N, normalize(vL)); float lit = smoothstep(-0.75, 0.9, d);
        vec3 col = mix(sh, li, lit) * (0.86 + 0.14 * t.b) * vTint * amb + vec3(1.0, 0.52, 0.2) * vG * (1.0 - vAge * 0.5);
        gl_FragColor = vec4(col, a); }`,
    transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(g, mat); mesh.frustumCulled = false; let next = 0, tm = 0; const order = new Uint16Array(n), dep = new Float32Array(n), cd = new THREE.Vector3();
  return {
    pts: mesh, mat,
    emit(p: V3, v: V3, s: number, l: number, o?: BillowOpt) { const i = next; next = (next + 1) % n; pos.set([p.x, p.y, p.z], i * 3); vel.set([v.x, v.y, v.z], i * 3); age[i] = 0; size[i] = s; life[i] = l; rot[i] = Math.random() * 6.283; spin[i] = (Math.random() - 0.5) * 0.5; vr[i] = Math.floor(Math.random() * 4);
      grow[i] = o?.grow ?? grow0; tint[i] = o?.tint ?? 0.94 + Math.random() * 0.06; opa[i] = o?.op ?? 1; },
    /** turb: stirring acceleration; ground: height the puffs cannot sink below (they spread instead); wind: drift per second, growing with height. */
    step(dt: number, drag = 0, lift = 0, o: { turb?: number; ground?: number; wind?: V3 } = {}) {
      const f = Math.max(0, 1 - drag * dt), tb = (o.turb ?? 0) * dt, gy = o.ground ?? -1e9, w = o.wind; tm += dt; let m = 0;
      cam.getWorldDirection(cd); const cp = cam.position;
      for (let i = 0; i < n; i++) { if (age[i] >= 1) continue; age[i] = Math.min(1, age[i] + dt / life[i]); if (age[i] >= 1) continue; rot[i] += spin[i] * dt; const k = i * 3;
        let x = pos[k], y = pos[k + 1], z = pos[k + 2];
        if (tb) { vel[k] += Math.sin(y * 1.3 + z * 0.9 + tm * 0.7 + i) * tb; vel[k + 1] += Math.sin(x * 1.1 + z * 0.6 + tm * 0.5 + i * 1.7) * tb * 0.5; vel[k + 2] += Math.cos(y * 1.7 + x * 0.8 - tm * 0.6 + i * 0.6) * tb; }
        vel[k] *= f; vel[k + 1] = vel[k + 1] * f + lift * dt; vel[k + 2] *= f;
        x += vel[k] * dt; y += vel[k + 1] * dt; z += vel[k + 2] * dt; if (w) { const hk = Math.min(3, Math.max(0, y) * 0.12) * dt; x += w.x * hk; z += w.z * hk; }
        if (y < gy) { y = gy; if (vel[k + 1] < 0) { const sp = -vel[k + 1] * 0.5, hl = Math.hypot(vel[k], vel[k + 2]) || 1; vel[k] += (vel[k] / hl) * sp; vel[k + 2] += (vel[k + 2] / hl) * sp; vel[k + 1] = 0; } }
        pos[k] = x; pos[k + 1] = y; pos[k + 2] = z; dep[i] = (x - cp.x) * cd.x + (y - cp.y) * cd.y + (z - cp.z) * cd.z; order[m++] = i; }
      const idx = order.subarray(0, m); idx.sort((a, b) => dep[b] - dep[a]);
      for (let j = 0; j < m; j++) { const i = idx[j]; gP[j * 3] = pos[i * 3]; gP[j * 3 + 1] = pos[i * 3 + 1]; gP[j * 3 + 2] = pos[i * 3 + 2]; gA[j * 4] = age[i]; gA[j * 4 + 1] = size[i]; gA[j * 4 + 2] = rot[i]; gA[j * 4 + 3] = vr[i]; gB[j * 3] = grow[i]; gB[j * 3 + 1] = tint[i]; gB[j * 3 + 2] = opa[i]; }
      g.instanceCount = m; aP.needsUpdate = aA.needsUpdate = aB.needsUpdate = true;
    },
    /** Sun direction (world) for shading; call once per frame before rendering. */
    light(dir: V3) { mat.uniforms.Lv.value.copy(dir).transformDirection(cam.matrixWorldInverse); },
    clear() { age.fill(1); g.instanceCount = 0; },
  };
}

/** Exhaust plume: an open cylinder reshaped in the shader (radius r0 at the nozzle growing to r1 over length L), bright core,
 * shock diamonds at low altitude, flicker, soft edges. Additive. */
const plumeGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 28, 28, true); g.translate(0, -0.5, 0); return g; })();
function plumeMaterial(c0: number, c1: number, c2: number) {
  return new THREE.ShaderMaterial({
    uniforms: { tm: { value: 0 }, r0: { value: 1 }, r1: { value: 1 }, L: { value: 1 }, ex: { value: 0.6 }, dia: { value: 0 }, op: { value: 1 }, fp: { value: 1.5 }, turb: { value: 0 }, c0: { value: new THREE.Color(c0) }, c1: { value: new THREE.Color(c1) }, c2: { value: new THREE.Color(c2) } },
    vertexShader: `uniform float tm, r0, r1, L, ex; varying float vT; varying vec3 vN, vV; varying vec2 vXZ;
      void main(){ float t = -position.y; float rr = mix(r0, r1, pow(t, ex)) * (1.0 + 0.05 * sin(t * 37.0 - tm * 55.0) * t + 0.035 * sin(t * 13.0 - tm * 31.0 + position.x * 5.0) * t);
        vec4 mv = modelViewMatrix * vec4(position.x * rr, -t * L, position.z * rr, 1.0); vXZ = position.xz;
        vN = normalize(normalMatrix * vec3(position.x, 0.0, position.z)); vV = normalize(-mv.xyz); vT = t; gl_Position = projectionMatrix * mv; }`,
    fragmentShader: `uniform float tm, dia, op, fp, turb; uniform vec3 c0, c1, c2; varying float vT; varying vec3 vN, vV; varying vec2 vXZ;
      float h(float n){ return fract(sin(n) * 43758.5453); }
      float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), f.x), f.y); }
      void main(){ float e = pow(abs(dot(normalize(vN), normalize(vV))), 1.6); float fall = pow(1.0 - vT, fp) * smoothstep(0.0, 0.035, vT + 0.004);
        /* turbulent streaks carried down the jet */
        float a1 = vXZ.x * 2.2 + vXZ.y * 1.3, fl = n2(vec2(a1 * 2.0, vT * 8.0 - tm * 13.0)) * 0.6 + n2(vec2(a1 * 5.0 + 3.0, vT * 21.0 - tm * 27.0)) * 0.4;
        float tb = mix(1.0, 0.4 + 1.25 * fl, turb * smoothstep(0.04, 0.5, vT));
        /* shock diamonds: evenly spaced bright cells that fade downstream */
        float d = 1.0 + dia * smoothstep(0.8, 0.0, vT) * pow(0.5 + 0.5 * cos(vT * 52.0), 3.0) * 2.4;
        float fk = 0.85 + 0.15 * h(floor(vT * 24.0 - tm * 26.0) + floor(tm * 37.0) * 7.0);
        vec3 col = mix(c0, c1, smoothstep(0.0, 0.2, vT)); col = mix(col, c2, smoothstep(0.28, 0.95, vT));
        float a = clamp(e * fall * d * fk * tb * op, 0.0, 1.0); gl_FragColor = vec4(col * a * 1.25, a * 0.8); }`,
    // premultiplied 'over' with a glow term: the flame covers a bright sky instead of washing out into it
    transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, side: THREE.DoubleSide,
  });
}

/** A polyline whose visible length can grow (trajectories drawn as the vehicle flies them). */
function trail(n: number, color: number, opacity = 0.9, dashed = false) {
  const g = new THREE.BufferGeometry(), pos = new Float32Array(n * 3); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = dashed ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, dashSize: 0.05, gapSize: 0.05, depthWrite: false }) : new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
  const line = new THREE.Line(g, mat); line.frustumCulled = false;
  return { line, mat, set(pts: V3[]) { pts.forEach((p, i) => pos.set([p.x, p.y, p.z], i * 3)); g.attributes.position.needsUpdate = true; g.setDrawRange(0, pts.length); if (dashed) line.computeLineDistances(); }, upTo(k: number) { g.setDrawRange(0, Math.max(0, Math.floor(k))); } };
}

// ---------------------------------------------------------------- the director
export function createDirector(ctx: FilmCtx) {
  const { scene, cam, sun } = ctx;
  const root = new THREE.Group(); root.visible = false; scene.add(root);
  const fxRoot = new THREE.Group(); scene.add(fxRoot);
  const glow = glowTex();
  const sprite = (color: number, s: number, op = 1, add = true) => { const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity: op, depthWrite: false, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending })); m.scale.setScalar(s); return m; };
  /** kero: kerosene/oxygen, bright yellow-orange and opaque. solid: brilliant white-yellow, wide. hydro: hydrogen/oxygen, pale blue and nearly transparent with clear shock diamonds. vac: upper stage in vacuum. */
  type PlumeKind = 'kero' | 'solid' | 'hydro' | 'vac';
  const PL: Record<PlumeKind, { o: number[]; i: number[]; glow: number; gs: number }> = {
    kero: { o: [0xfff0d0, 0xffa64a, 0xd8480f], i: [0xffffff, 0xfff3c8, 0xffbe6a], glow: 0xffc27a, gs: 7 },
    solid: { o: [0xfffbe8, 0xffd27a, 0xff8a2c], i: [0xffffff, 0xfffbe6, 0xffe2a0], glow: 0xffdc9a, gs: 9 },
    hydro: { o: [0xdcecff, 0x86b4ff, 0x4468c8], i: [0xffffff, 0xcfe4ff, 0x9ec2ff], glow: 0xa8c8ff, gs: 4 },
    vac: { o: [0xfff6ea, 0xa8c6ff, 0x34508f], i: [0xffffff, 0xfff1c4, 0xffb262], glow: 0xc4d8ff, gs: 5 },
  };
  /** Exhaust plume pointing down -Y from its origin; userData.u(altitude 0…1, thrust, time) shapes it each frame. */
  const plume = (r: number, len: number, kind: PlumeKind) => {
    const g = new THREE.Group(), K = PL[kind];
    const outer = new THREE.Mesh(plumeGeo, plumeMaterial(K.o[0], K.o[1], K.o[2]));
    const inner = new THREE.Mesh(plumeGeo, plumeMaterial(K.i[0], K.i[1], K.i[2]));
    outer.frustumCulled = inner.frustumCulled = false; g.add(outer, inner);
    const gl = sprite(K.glow, r * 6, kind === 'hydro' ? 0.5 : 0.85); g.add(gl); g.visible = false;
    g.userData.u = (alt: number, thrust: number, tm: number) => {
      const o = (outer.material as THREE.ShaderMaterial).uniforms, i = (inner.material as THREE.ShaderMaterial).uniforms;
      if (kind === 'vac') { o.r0.value = r; o.r1.value = r * 4.5; o.L.value = len * 0.6 * thrust; o.ex.value = 0.5; o.dia.value = 0; o.op.value = 0.2; o.fp.value = 1.5;
        i.r0.value = r * 0.88; i.r1.value = r * 1.7; i.L.value = len * 0.2 * thrust; i.ex.value = 0.7; i.dia.value = 0; i.op.value = 0.95; i.fp.value = 1.2; }
      else { const sol = kind === 'solid', hy = kind === 'hydro'; // the jet is pinched by sea-level pressure and balloons as the air thins
        o.r0.value = r * 0.95; o.r1.value = r * ((sol ? 1.9 : 1.45) + alt * 7); o.L.value = len * (sol ? 1.25 : 1) * (1 + alt * 0.9) * thrust; o.ex.value = 0.55; o.dia.value = (1 - alt) * (hy ? 1.1 : sol ? 0 : 0.45); o.op.value = (hy ? 0.5 : 1) - alt * 0.4; o.fp.value = (sol ? 0.75 : 0.9) + alt * 0.6; o.turb.value = sol ? 0.9 : hy ? 0.25 : 0.6;
        i.r0.value = r * 0.72; i.r1.value = r * ((sol ? 0.7 : 0.28) + alt * 1.6); i.L.value = len * (sol ? 0.6 : 0.4) * thrust; i.ex.value = 1; i.dia.value = (1 - alt) * (sol ? 0 : hy ? 2.2 : 1.6); i.op.value = hy ? 0.8 : 1; i.fp.value = 0.8; i.turb.value = sol ? 0.5 : 0.2; }
      o.tm.value = i.tm.value = tm; gl.scale.setScalar(r * K.gs * (0.9 + 0.1 * Math.sin(tm * 61)) * Math.min(1, thrust));
    };
    return g;
  };
  /** Stochastic rounding of rate × dt, so emission does not depend on the frame rate. */
  const count = (rate: number, dt: number) => { const f = rate * dt * Q.fx; return Math.floor(f) + (Math.random() < f % 1 ? 1 : 0); };
  const firePlume = (p: THREE.Object3D, on: boolean, alt: number, thrust = 1) => { p.visible = on; if (on) p.userData.u(alt, thrust, ambient); };

  // ---- the launch complex (pad, tower, assembly building, terrain, sky)
  const site = createSite(); const pad = site.group; root.add(pad);
  const hemi = new THREE.HemisphereLight(0xc4dcff, 0x4a4a3a, 0.34); pad.add(hemi);
  const flameLight = new THREE.PointLight(0xffa45a, 0, 16, 2); root.add(flameLight);
  // a plain gradient sky for the landing films (Mars, the Moon)
  const skyMat = new THREE.ShaderMaterial({ uniforms: { hz: { value: new THREE.Color(0xa9c6e6) }, zn: { value: new THREE.Color(0x2f62a8) }, gr: { value: new THREE.Color(0x56604c) }, k: { value: 0 } }, side: THREE.BackSide, depthWrite: false,
    vertexShader: 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform vec3 hz, zn, gr; uniform float k; varying vec3 vD; void main(){ float y = vD.y; vec3 c = y < 0.0 ? mix(hz, gr, smoothstep(0.0, -0.08, y)) : mix(hz, zn, pow(smoothstep(0.0, 0.6, y), 0.7)); c = mix(c, vec3(0.0), k); gl_FragColor = vec4(c, 1.0); }' });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), skyMat); sky.renderOrder = -2; root.add(sky);

  // ---- the vehicle (cloned from the studio rocket so it is the one the player configured)
  const veh = new THREE.Group(); root.add(veh);
  let rk: THREE.Group | null = null, S = 1;
  interface Loose { o: THREE.Object3D; v: V3; w: V3; t: number }
  let loose: Loose[] = [];
  const stagePlume = { s1: [] as THREE.Object3D[], boost: [] as THREE.Object3D[], s2: null as THREE.Object3D | null };
  let hasBoost = false, sepY = 1.4, coreR = 0.1, vehH = 2.2, s1Bottom = 0;
  let coreKind: PlumeKind = 'kero';
  const nozzleM = new THREE.MeshStandardMaterial({ color: 0x3a3c40, metalness: 0.8, roughness: 0.4, emissive: 0xb8380a, emissiveIntensity: 0, side: THREE.DoubleSide });
  // Max-Q condensation collar
  const vaporMat = new THREE.ShaderMaterial({ uniforms: { o: { value: 0 }, tm: { value: 0 } }, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN, vV; varying float vY; void main(){ vY = uv.y; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'uniform float o, tm; varying vec3 vN, vV; varying float vY; void main(){ float f = pow(1.0 - abs(dot(vN, vV)), 1.5); float n = 0.75 + 0.25 * sin(vY * 40.0 + tm * 30.0); gl_FragColor = vec4(vec3(0.97), f * o * n * smoothstep(0.0, 0.5, vY) * smoothstep(1.0, 0.7, vY)); }' });
  const vapor = new THREE.Mesh(new THREE.LatheGeometry([0, 0.25, 0.5, 0.75, 1].map(t => new THREE.Vector2(1 + t * 1.6, -t * 1.4)), 32), vaporMat); vapor.visible = false; veh.add(vapor);
  function buildVehicle() {
    if (rk) veh.remove(rk); loose = []; stagePlume.s1 = []; stagePlume.boost = []; stagePlume.s2 = null;
    veh.position.set(0, 0, 0); veh.rotation.set(0, 0, 0); veh.updateMatrixWorld(true);
    rk = ctx.rocket.clone(true); rk.rotation.set(0, 0, 0); rk.position.set(0, 0, 0); rk.scale.setScalar(1); rk.visible = true;
    // remove the studio's exhaust cones; we draw our own plumes per stage
    for (const o of [...rk.children]) if (!o.userData.cat && o.type === 'Mesh' && (o as THREE.Mesh).geometry.type === 'ConeGeometry') rk.remove(o);
    rk.traverse(o => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    rk.updateMatrixWorld(true);
    const bb = new THREE.Box3().setFromObject(rk), H = bb.max.y - bb.min.y || 1; S = 2.2 / H;
    rk.scale.setScalar(S); rk.position.y = -bb.min.y * S; veh.add(rk); veh.updateMatrixWorld(true);
    const loc = (yv: number) => (yv - rk!.position.y) / S; // vehicle-frame height → rocket-local
    hasBoost = rk.children.some(o => o.userData.cat === 'boost');
    const boxOf = (cats: string[], f?: (o: THREE.Object3D) => boolean) => { const b = new THREE.Box3(); rk!.children.forEach(o => { if (cats.includes(o.userData.cat) && (!f || f(o))) b.expandByObject(o); }); return b; };
    const core = boxOf(['stage1'], o => Math.abs(o.position.x) < 0.02), cr = (core.max.x - core.min.x) / 2 / S;
    const full = boxOf(['stage1', 'boost', 'inter', 'stage2', 'fairing', 'payload']); vehH = full.max.y; coreR = cr * S;
    // engine section bottom (above the bells)
    const bells = boxOf(['stage1'], o => (o as THREE.Mesh).isMesh && ((o as THREE.Mesh).geometry.type === 'LatheGeometry'));
    s1Bottom = (bells.isEmpty() ? core.min.y : bells.min.y);
    const lid = String(ctx.rocket.userData.id ?? ''); coreKind = lid === 'heavy' ? 'hydro' : 'kero';
    const p1 = plume(cr, cr * (coreKind === 'hydro' ? 13 : 16), coreKind); p1.position.set(0, loc(s1Bottom), 0); rk.add(p1); stagePlume.s1.push(p1); p1.userData.cat = 'stage1'; p1.userData.fx = true;
    if (hasBoost) for (const sx of [-1, 1]) { const b = boxOf(['boost'], o => Math.sign(o.position.x) === sx); if (b.isEmpty()) continue; const r = (b.max.x - b.min.x) / 2 / S;
      const p = plume(r * 1.05, r * 18, 'solid'); p.position.set(((b.max.x + b.min.x) / 2) / S, loc(b.min.y), 0); p.userData.cat = 'boost'; p.userData.side = sx; p.userData.fx = true; rk.add(p); stagePlume.boost.push(p); }
    const s2 = boxOf(['stage2']);
    if (!s2.isEmpty()) { const r2 = (s2.max.x - s2.min.x) / 2 / S, nh = r2 * 1.35, re = r2 * 0.78; sepY = s2.min.y;
      const pts: THREE.Vector2[] = []; for (let i = 0; i <= 12; i++) { const t = i / 12; pts.push(new THREE.Vector2(r2 * 0.22 + (re - r2 * 0.22) * Math.pow(t, 0.6), -t * nh)); }
      const nz = new THREE.Mesh(new THREE.LatheGeometry(pts, 28), nozzleM); nz.position.y = loc(s2.min.y); nz.userData.cat = 'stage2'; rk.add(nz);
      const p = plume(re, re * 16, 'vac'); p.position.set(0, loc(s2.min.y) - nh, 0); p.userData.cat = 'stage2'; p.userData.fx = true; rk.add(p); stagePlume.s2 = p; }
    vapor.scale.set(coreR * 1.15, coreR * 1.3, coreR * 1.15); vapor.position.y = sepY - 0.1;
    site.fitArms(coreR, [Math.min(vehH - 0.5, sepY + 0.25), sepY - 0.55, vehH * 0.42]);
  }
  function release(cats: string[], out: number) {
    if (!rk) return;
    for (const o of rk.children) { if (!cats.includes(o.userData.cat) || o.userData.gone) continue; o.userData.gone = true;
      const side = o.userData.side ?? (Math.abs(o.position.x) > 0.01 ? Math.sign(o.position.x) : 0);
      const isFair = o.userData.cat === 'fairing';
      loose.push({ o, v: v3(side * out * (isFair ? 1.6 : 1), isFair ? 0.1 : -0.5, isFair ? 0.15 : 0), w: v3(0, 0, -side * (isFair ? 1.4 : 0.5)), t: 0 }); }
  }
  /** A point on the vehicle (vehicle frame) in world space. */
  const onVeh = (x: number, y: number, z: number) => veh.localToWorld(v3(x, y, z));

  // ---- worlds: Earth for ascent views, the target bodies, a heliocentric frame
  const clone = (k: string) => { const g = ctx.bodies[k].clone(true); ownMaterials(g); g.visible = true; g.position.set(0, 0, 0); g.rotation.set(0, 0, 0); g.scale.setScalar(1); return g; };
  const earth = clone('earth'); root.add(earth);
  const clouds = earth.getObjectByName('clouds') ?? new THREE.Object3D();
  const target: Record<string, THREE.Object3D> = { moon: clone('moon'), mars: clone('mars'), bennu: ctx.bodies.bennu ? clone('bennu') : clone('moon') };
  for (const k in target) root.add(target[k]);
  const helio = new THREE.Group(); root.add(helio);
  const sunBall = sunBody(0.3, 9); helio.add(sunBall);
  const sunLight = new THREE.PointLight(0xfff1dc, 2.2, 0, 1); helio.add(sunLight);
  const seeSun = sunDisc(); root.add(seeSun.obj); seeSun.obj.visible = false;
  const orbitLine = (r: number, e = 0, w = 0, color = 0x5d6b82, op = 0.55) => { const pts: V3[] = []; const a = r / (1 - e * e) * (1 - e * e);
    for (let i = 0; i <= 256; i++) { const th = (i / 256) * Math.PI * 2, rr = (a * (1 - e * e)) / (1 + e * Math.cos(th - w)); pts.push(v3(Math.cos(th) * rr, 0, Math.sin(th) * rr)); }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: op })); helio.add(l); return l; };
  const AU = 2.4;
  const earthOrbit = orbitLine(AU), marsOrbit = orbitLine(1.524 * AU), bennuOrbit = orbitLine(1.126 * AU, 0.204, 0.4);
  const others = PLANETS.map(p => { const b = planetBody(p); b.scale.setScalar(0.1 * Math.pow(p.r, 0.45)); helio.add(b); orbitLine(p.a * AU, 0, 0, 0x3d4758, 0.4); return { p, b }; });
  // the main asteroid belt, 2.1–3.3 AU: thinner at the Kirkwood gaps that Jupiter's resonances clear (2.50, 2.82, 2.95 AU)
  const belt = (() => { const n = 2600, pos = new Float32Array(n * 3), r = rng(5); let i = 0;
    while (i < n) { const a = 2.1 + r() * 1.2; if ([2.5, 2.82, 2.95].some(gp => Math.abs(a - gp) < 0.03) && r() < 0.85) continue; const th = r() * 6.283; pos.set([Math.cos(th) * a * AU, (r() + r() + r() - 1.5) * 0.22 * a, Math.sin(th) * a * AU], i * 3); i++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const p = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xb9ad9c, size: 1.3, sizeAttenuation: false, transparent: true, opacity: 0.34, depthWrite: false })); helio.add(p); return p; })();
  const dot = sprite(0x7fd8ff, 0.22, 1); root.add(dot);
  const dotCore = sprite(0xffffff, 0.07, 1); dot.add(dotCore); dotCore.scale.setScalar(0.35);
  const path = trail(400, 0x64d2ff, 0.95), ghost = trail(400, 0x8aa0bf, 0.45, true), ring = trail(257, 0x64d2ff, 0.7), ring2 = trail(257, 0xffffff, 0.45, true);
  root.add(path.line, ghost.line, ring.line, ring2.line);
  const craft = new THREE.Group(); root.add(craft);
  let craftModel: THREE.Object3D | null = null;
  const retro = plume(0.045, 0.6, 'vac'); craft.add(retro);
  const shield = sprite(0xff7a2a, 1.6, 0); craft.add(shield);
  function buildCraft() { if (craftModel) craft.remove(craftModel); craftModel = ctx.model.clone(true); craftModel.position.set(0, 0, 0); craftModel.rotation.set(0, 0, 0);
    const fit = (ctx.model.userData.fit ?? 1) * 0.2; craftModel.scale.setScalar(fit); craftModel.children.forEach(c => c.scale.setScalar(1)); craft.add(craftModel);
    craft.userData.foot = (ctx.model.userData.foot ?? 0.5) * fit; }

  // ---- particles
  const puff = billowTex();
  const smoke = billows(5200, cam, puff, 0xfffdfa, 0xa3acbe, 4.2, 0.95); root.add(smoke.pts);
  const vent = billows(500, cam, puff, 0xffffff, 0xb4bfd0, 2.6, 0.6); root.add(vent.pts);
  const spray = billows(700, cam, puff, 0xffffff, 0xa8b6c8, 1.4, 0.5); root.add(spray.pts);
  const fire = particles(600, 0xff7a2a, 0xfff0c8, true, 1.5, 0.9); root.add(fire.pts);
  const sparks = particles(300, 0xffc070, 0xffffff, true, 0, 1); root.add(sparks.pts);
  const puffs = billows(200, cam, puff, 0xffffff, 0x9aa6bc, 3, 0.35); root.add(puffs.pts);
  const dust = billows(600, cam, puff, 0xcfa880, 0x5e4433, 4, 0.8); root.add(dust.pts);
  const allBillows = [smoke, vent, spray, puffs, dust];
  // lens flare: a glare at the sun and ghosts mirrored through the centre of the frame
  const flareMain = sprite(0xfff3dc, 1, 0), flareGhosts = [0x7fd0ff, 0xffb070, 0x9fffcf, 0xffd27a].map(c => sprite(c, 1, 0));
  for (const f of [flareMain, ...flareGhosts]) { (f.material as THREE.SpriteMaterial).depthTest = false; f.renderOrder = 10; root.add(f); }
  // ---- effects (also shown over the always-on scene during operations)
  const flash = sprite(0xffe7b0, 1, 0); fxRoot.add(flash);
  // coronal mass ejection (heliocentric view): a bubble of plasma leaving one side of the Sun, a bright filamentary front with a fainter wake
  const cmeMat = new THREE.ShaderMaterial({ uniforms: { c: { value: new THREE.Color(0xffa45a) }, o: { value: 0 }, dir: { value: new THREE.Vector3(1, 0, 0) }, tm: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    vertexShader: 'varying vec3 vN; varying vec3 vV; varying vec3 vO; void main(){ vO = normalize(position); vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `uniform vec3 c, dir; uniform float o, tm; varying vec3 vN; varying vec3 vV; varying vec3 vO;
      void main(){ float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.0); float cone = smoothstep(0.5, 0.92, dot(normalize(vO), dir));
        float fil = 0.72 + 0.28 * sin(vO.x * 41.0 + vO.y * 23.0 + sin(vO.z * 9.0) * 3.0 + tm) * sin(vO.z * 37.0 - vO.y * 19.0 + sin(vO.x * 7.0) * 3.0 - tm * 0.7);
        gl_FragColor = vec4(c * (f * 1.1 + 0.06) * cone * fil * o, 1.0); }` });
  const cme = new THREE.Mesh(new THREE.SphereGeometry(1, 64, 32), cmeMat), cme2 = new THREE.Mesh(cme.geometry, cmeMat); fxRoot.add(cme, cme2);
  // energetic particles striking the camera sensor: short random tracks and specks over the whole picture, as in coronagraph images during a proton storm
  const snowMat = new THREE.ShaderMaterial({ uniforms: { o: { value: 0 }, tm: { value: 0 }, asp: { value: 1 } }, transparent: true, depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform float o, tm, asp; varying vec2 vUv;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float layer(float sc, float dens, float maxLen, float seed){ float fr = floor(tm * 13.0) + seed; vec2 uv = vUv * vec2(asp, 1.0) * sc, id = floor(uv), f = fract(uv) - 0.5;
        float on = step(1.0 - dens, h(id + fr * 1.7)); float ang = h(id + fr * 3.1) * 3.1416; vec2 d = vec2(cos(ang), sin(ang)); float len = maxLen * h(id + fr + 7.0);
        vec2 q = f - (vec2(h(id + fr * 5.3), h(id + fr * 9.1)) - 0.5) * 0.5; float t = clamp(dot(q, d), -len, len); return on * smoothstep(0.05, 0.0, length(q - d * t)) * (0.5 + 0.5 * h(id + fr * 2.3)); }
      void main(){ float s = layer(22.0, 0.11 * o, 0.36, 0.0) + layer(54.0, 0.07 * o, 0.05, 31.0) + layer(90.0, 0.05 * o, 0.0, 57.0) * 0.8;
        float grain = (h(vUv * 613.0 + tm) - 0.5) * 0.05 * o; gl_FragColor = vec4(vec3(0.94, 0.97, 1.0) * s + grain, 1.0); }` });
  const snow = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), snowMat); snow.frustumCulled = false; snow.renderOrder = 50; snow.visible = false; fxRoot.add(snow);
  // the gust itself near the spacecraft: thin streaks blowing straight out from the Sun
  const WN = 110, windPos = new Float32Array(WN * 6), windCol = new Float32Array(WN * 6), windP: { p: V3; s: number; l: number }[] = [];
  const windG = new THREE.BufferGeometry(); windG.setAttribute('position', new THREE.BufferAttribute(windPos, 3)); windG.setAttribute('color', new THREE.BufferAttribute(windCol, 3));
  const wind = new THREE.LineSegments(windG, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); wind.frustumCulled = false; wind.visible = false; fxRoot.add(wind);
  const streaks = particles(200, 0xcfe6ff, 0xffffff, true, 0, 1); fxRoot.add(streaks.pts);
  const haze = sprite(0x8a5a36, 1, 0, false); fxRoot.add(haze);
  const plasma = sprite(0xff6a1a, 1, 0); fxRoot.add(plasma);
  const sunFar = sprite(0xffd9a0, 1, 0); fxRoot.add(sunFar);

  // ---------------------------------------------------------------- state
  let spec: FilmSpec | null = null, u = 0, fxU = -1, speed = 1, paused = false, near = true, yaw = 0, pitch = 0, zoom = 1, ambient = 0;
  /** Which launch camera the viewer asked for; auto follows the director's cut. */
  let camPref: CamId = 'auto';
  let dur = 1, readyAt = 0, fxAt = Infinity, events: FilmEvent[] = [], firedEv = new Set<string>(), alerted = false, savedSun = sun.position.clone();
  const info: FilmInfo = { film: null, seq: 0, active: false, ready: true, u: 0, dur: 1, clock: { kind: 'none', v: 0 }, warp: 1, alt: null, vel: null, dist: null, events: [], labels: [], alert: false, hold: false };
  const labels: { k: string; p: V3 }[] = [];
  let shot: (u: number, dt: number) => Shot = () => ({ pos: v3(0, 0, 12), look: v3() });
  const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3();
  const auroras = [ctx.bodies.earth.getObjectByName('aurora'), earth.getObjectByName('aurora')].filter(Boolean) as THREE.Object3D[];
  let savedSunI = sun.intensity, cloudsOn = true; const stars = scene.getObjectByName('stars');

  // ---------------------------------------------------------------- films
  // Film-time cues (seconds) and the mission clock (T±, seconds) they map to. Ascent figures follow a typical published profile.
  const C = { vabEnd: 2.4, aerialEnd: 5.0, deluge: 5.6, ign: 6.6, lift: 7.4, groundEnd: 9.2, maxq: 10.8, trackEnd: 11.0, boost: 12.2, meco: 13.4, sep: 13.8, ses: 14.4, onboardEnd: 15.4, fair: 15.9, sideEnd: 17.2, globe: 18.8, seco: 21.8, orbit: 22.6, dur: 23.2 };
  const MT = [[0, -38], [C.vabEnd, -26], [C.aerialEnd, -12], [C.ign, -3], [C.lift, 0], [C.groundEnd, 24], [C.maxq, 72], [C.boost, 118], [C.meco, 150], [C.sep, 153], [C.ses, 160], [C.fair, 210], [C.sideEnd, 262], [C.globe, 330], [C.seco, 520], [C.dur, 560]];
  const ALT = [[0, 0], [72, 12], [118, 42], [150, 70], [210, 115], [290, 150], [400, 182], [520, 200]];
  const VEL = [[0, 0], [72, 0.45], [118, 1.35], [150, 2.3], [160, 2.3], [210, 2.9], [290, 4], [400, 5.8], [520, 7.6], [560, 7.7]];
  const KSC = latlon(28.608, -80.604);
  // Sun directions (from the scene toward the Sun) for the cruise and arrival films: about 50° from the default camera, over its left shoulder
  const SUN_L = v3(-0.62, 0.42, 0.66).normalize(), SUN_M = v3(-0.55, 0.45, 0.7).normalize(), SUN_A = v3(-0.7, 0.42, 0.58).normalize();
  interface Shot { pos: V3; look: V3; far?: number; fov?: number; sun?: V3; sunI?: number; /** Sun fixed in the world: direction from the scene toward it, distance (AU) for its apparent size. */ sunW?: V3; sunAu?: number; shake?: number; flare?: V3 | null; shadow?: boolean; stars?: number }
  const fog = new THREE.Fog(0xbcd3ea, 40, 330);
  const WIND = v3(-0.5, 0, 0.28); // a light sea breeze: the exhaust column leans and kinks as it rises
  const EARTH_OFF = v3(-6, -46, -20), EARTH_S = 44;
  function launchFilm(sp: FilmSpec) {
    buildVehicle(); for (const p of [smoke, fire, vent, spray, sparks, puffs]) p.clear();
    const ending = sp.ending, ER = 1.6, deck = site.deckTop;
    const D = latlon(22, -50), n = KSC.clone().cross(D).normalize();
    const hOrb = (Math.max(150, sp.altKm || 200) / 6371) * 3, hPlan = ((sp.plannedAltKm || sp.altKm || 200) / 6371) * 3;
    const G0 = C.globe, G1 = C.seco;
    // ascent path on the globe, then the orbit ring in the same plane
    const ascent: V3[] = [];
    for (let i = 0; i <= 120; i++) { const s = i / 120;
      if (ending === 'short') { const ss = s * 1.35, h = hOrb * 0.8 * Math.sin(Math.min(Math.PI, ss * 2.4)) ** 0.8; ascent.push(slerp(KSC, D, ss).normalize().multiplyScalar(ER * (1 + Math.max(0, ss > 1.05 ? h * 0.6 : h)))); }
      else ascent.push(slerp(KSC, D, s).normalize().multiplyScalar(ER * (1 + hOrb * Math.pow(smooth(0, 1, s), 0.6)))); }
    path.set(ascent); path.upTo(0); (path.mat as THREE.LineBasicMaterial).color.set(ending === 'short' ? 0xff7a5a : 0x64d2ff);
    const ringPts = (h: number) => { const a: V3[] = []; for (let i = 0; i <= 256; i++) a.push(D.clone().applyAxisAngle(n, (i / 256) * Math.PI * 2).multiplyScalar(ER * (1 + h))); return a; };
    ring.set(ringPts(hOrb)); ring.upTo(0); (ring.mat as THREE.LineBasicMaterial).color.set(ending === 'offorbit' ? 0xffb340 : 0x64d2ff);
    ring2.set(ringPts(hPlan)); ring2.upTo(0);
    const hold = ending === 'hold';
    events = hold ? [{ k: 'gonogo', at: 1.0 }, { k: 'hold', at: 5.0 }] : [{ k: 'gonogo', at: 1.0 }, { k: 'deluge', at: C.deluge }, { k: 'ignition', at: C.ign }, { k: 'liftoff', at: C.lift }, { k: 'maxq', at: C.maxq }, ...(hasBoost ? [{ k: 'boostsep', at: C.boost }] : []),
      { k: 'meco', at: C.meco }, { k: 'stagesep', at: C.sep }, { k: 'ses', at: C.ses }, { k: 'fairing', at: C.fair }, ...(ending === 'short' ? [{ k: 'underperf', at: 18.2 }, { k: 'reentry', at: 21.6 }] : [{ k: 'seco', at: C.seco }, { k: 'orbit', at: C.orbit }])];
    dur = hold ? 6.6 : C.dur; readyAt = hold ? 6.0 : ending === 'short' ? 22.2 : 22.8;
    info.clock = { kind: 'T', v: -38 }; info.warp = 31;
    const rise = (x: number) => (x < C.lift ? 0 : 0.32 * (x - C.lift) ** 2 + 0.05 * (x - C.lift) ** 3);
    cloudsOn = true; let spaceSet = false, lastNoz: V3 | null = null, s1Tank: THREE.Mesh | null = null;
    const toVab = VAB.clone().setY(0).normalize().negate(), vabSide = v3(toVab.z, 0, -toVab.x);
    return (x: number, dt: number): Shot => {
      const mt = hold ? lerpT(MT, Math.min(x, 5.0)) : lerpT(MT, x); info.clock = { kind: 'T', v: mt };
      info.hold = hold && x >= 5.0;
      const altTab = ending === 'short' ? [...ALT.slice(0, 7), [460, 170], [520, 120], [560, 70]] : ALT, velTab = ending === 'short' ? [...VEL.slice(0, 7), [400, 5.6], [560, 6.1]] : VEL;
      info.alt = mt <= 0 ? 0 : lerpT(altTab, mt); info.vel = mt <= 0 ? 0 : lerpT(velTab, mt); if (ending === 'ok' && mt > 520) info.alt = sp.altKm || info.alt; info.dist = null;
      const altK = clamp((info.alt ?? 0) / 60), dark = smooth(8, 70, info.alt ?? 0);
      const inSpace = x >= C.meco && x < G0, globe = x >= G0, onPad = !inSpace && !globe;
      if (inSpace && !spaceSet) { spaceSet = true; smoke.clear(); vent.clear(); spray.clear(); fire.clear(); }
      pad.visible = onPad; sky.visible = false; veh.visible = !globe; earth.visible = inSpace || globe; dot.visible = path.line.visible = globe;
      ring.line.visible = globe && ending !== 'short'; ring2.line.visible = globe && ending === 'offorbit';
      for (const k in target) target[k].visible = false; helio.visible = false; craft.visible = false;
      site.skyMat.uniforms.k.value = dark; hemi.intensity = 0.34 * (1 - dark);
      site.clouds.visible = (info.alt ?? 0) < 14;
      scene.fog = onPad ? fog : null; fog.color.set(0xbcd3ea).lerp(new THREE.Color(0x0a1426), dark); fog.far = 330 + altK * 600;
      site.oceanMat.uniforms.fc.value.copy(fog.color); site.oceanMat.uniforms.ff.value = fog.far; site.skyMat.uniforms.tm.value = ambient; scene.environment = onPad ? ctx.envs.day : ctx.envs.space;
      // ---- vehicle
      const ign = !hold && x >= C.ign, lifted = x >= C.lift;
      if (onPad) { const y = rise(x); veh.position.set(0.012 * Math.max(0, x - C.lift - 1) ** 3, deck + y, 0); veh.rotation.set(0, 0, -smooth(C.lift + 1.8, C.meco, x) * 0.62); }
      else { veh.position.set(0.22 * (x - C.meco), 0, 0); veh.rotation.set(0, 0, -1.12); }
      veh.updateMatrixWorld(true);
      site.retract(hold ? 0 : smooth(C.ign - 0.6, C.lift + 0.2, x));
      const thrust = ign ? smooth(C.ign, C.ign + 0.5, x) : 0;
      stagePlume.s1.forEach(p => firePlume(p, ign && x < C.meco, altK, (0.7 + 0.3 * thrust) * (1 + smooth(C.lift, C.maxq, x) * 0.6)));
      stagePlume.boost.forEach(p => firePlume(p, ign && x < C.boost, altK, (0.7 + 0.3 * thrust) * (1 + smooth(C.lift, C.boost, x) * 0.5)));
      const s2on = x >= C.ses && x < (ending === 'short' ? 18.2 : G1);
      if (stagePlume.s2) firePlume(stagePlume.s2, s2on, 1, smooth(C.ses, C.ses + 0.6, x));
      nozzleM.emissiveIntensity = s2on ? 0.25 + 0.6 * smooth(C.ses, C.ses + 2, x) : x >= C.ses ? Math.max(0, nozzleM.emissiveIntensity - dt * 0.4) : 0;
      if (x >= C.boost && hasBoost) release(['boost'], 0.5);
      if (x >= C.sep) { release(['stage1', 'inter', 'boost'], 0.04); s1Tank ??= (rk?.children.filter(o => o.userData.cat === 'stage1' && (o as THREE.Mesh).geometry?.type === 'CylinderGeometry') as THREE.Mesh[]).sort((a, b) => (b.geometry as THREE.CylinderGeometry).parameters.height - (a.geometry as THREE.CylinderGeometry).parameters.height)[0] ?? null; }
      if (x >= C.fair) release(['fairing'], 0.45);
      for (const l of loose) { l.t += dt; l.o.position.addScaledVector(l.v, dt / S); l.v.y -= dt * 1.1; l.o.rotation.x += l.w.x * dt; l.o.rotation.z += l.w.z * dt; l.o.visible = l.t < 6; }
      // Max-Q condensation collar
      const vq = ign ? Math.max(0, 1 - Math.abs(x - (C.maxq + 0.2)) / 0.7) : 0; vapor.visible = vq > 0 && !ctx.reduced; vaporMat.uniforms.o.value = vq * 0.75; vaporMat.uniforms.tm.value = ambient;
      // ---- exhaust, steam, venting, water deluge
      const noz = onVeh(0, s1Bottom - coreR * 0.6, 0);
      const nearGround = clamp(1 - (veh.position.y - deck) / 9);
      flameLight.visible = onPad; flameLight.position.copy(noz).add(v3(0, -0.4, 0.3)); flameLight.intensity = ign && x < C.meco ? (2.2 + Math.random() * 0.8) * thrust * (0.25 + 0.75 * nearGround) : 0;
      smoke.mat.uniforms.fl.value.copy(noz); smoke.mat.uniforms.fi.value = ign && onPad ? 0.7 * thrust * (0.3 + 0.7 * nearGround) : 0; smoke.mat.uniforms.amb.value = 1 - dark * 0.6;
      if (!ctx.reduced && onPad) {
        // LOX boil-off from the vents until the engines light
        if (!lifted) for (let j = 0, kk = count(46, dt); j < kk; j++) for (const yv of [sepY - 0.15, vehH * 0.55]) { const sx = Math.random() < 0.5 ? 1 : -1, p = onVeh(sx * coreR * 1.05, yv, coreR * 0.3);
          vent.emit(p, v3(sx * (0.08 + Math.random() * 0.12), -0.14 - Math.random() * 0.12, 0.05), 0.06 + Math.random() * 0.06, 2.2 + Math.random(), { op: 0.5 + Math.random() * 0.5 }); }
        // sound-suppression water deluge across the deck
        if (!hold && x >= C.deluge && x < C.lift + 2) for (let i = 0, k = count(280, dt); i < k; i++) { const a = Math.random() * 6.283, r0 = 0.7 + Math.random() * 0.2;
          spray.emit(v3(Math.cos(a) * r0, deck + 0.05, Math.sin(a) * r0 * 0.8), v3(-Math.cos(a) * 0.6, 1.4 + Math.random() * 0.8, -Math.sin(a) * 0.5), 0.05 + Math.random() * 0.05, 0.9); }
        if (ign) {
          const down = v3(0, -1, 0).applyQuaternion(veh.quaternion), thick = hasBoost ? 1 : 0.6; // solid boosters leave a dense white column; liquid engines a thinner one
          // deluge water flashed to steam, blasting out of both ends of the flame trench, then slowing, swelling and rising
          const surge = 1 - smooth(C.lift + 1.0, C.lift + 4.2, x);
          for (let i = 0, k = count(230 * surge * thrust, dt); i < k; i++) { const ex = site.trenchExits[i % 2], sg = Math.sign(ex.x), sp = 2.4 + Math.random() * 6;
            smoke.emit(ex.clone().add(v3(sg * Math.random() * 0.4, Math.random() * 0.25, (Math.random() - 0.5) * 0.5)), v3(sg * sp, 0.15 + Math.random() * 1.1, (Math.random() - 0.5) * 2.8), 0.42 + Math.random() * 0.5, 9 + Math.random() * 8, { grow: 5.2 }); }
          // exhaust spilling over the deck and the hardstand in every direction
          if (x < C.lift + 2.2) for (let i = 0, k = count(70 * thrust, dt); i < k; i++) { const a = Math.random() * 6.283, sp = 1.2 + Math.random() * 2.2; smoke.emit(v3(Math.cos(a) * 0.8, deck + 0.05, Math.sin(a) * 0.65), v3(Math.cos(a) * sp, 0.3 + Math.random() * 0.7, Math.sin(a) * sp), 0.34 + Math.random() * 0.3, 6 + Math.random() * 5, { grow: 4.4 }); }
          for (let i = 0, k = count(46, dt); i < k; i++) fire.emit(noz.clone().add(v3((Math.random() - 0.5) * coreR, -0.05, (Math.random() - 0.5) * coreR)), down.clone().multiplyScalar(2.5 + Math.random() * 2).add(v3((Math.random() - 0.5) * 0.8, 0, (Math.random() - 0.5) * 0.8)), coreR * 2.4, 0.3);
          // the column of exhaust left behind, laid along the path flown this frame; it thins as the air does
          if (lifted && x < C.meco) { const from = lastNoz ?? noz, solid = hasBoost && x < C.boost, k = Math.min(110, count((from.distanceTo(noz) / (solid ? 0.035 : 0.05) + 34 * dt) * (solid ? 1 : 0.55) * (1 - altK * (solid ? 0.25 : 0.55)), 1)), far = coreR * (solid ? 10 : 7), wide = solid ? coreR * 2.4 : 0.16;
            for (let i = 0; i < k; i++) { const p = from.clone().lerp(noz, Math.random()).addScaledVector(down, far * (0.8 + Math.random() * 0.7)).add(v3((Math.random() - 0.5) * wide, 0, (Math.random() - 0.5) * wide));
              smoke.emit(p, down.clone().multiplyScalar(0.9 + Math.random() * 1.3).add(v3((Math.random() - 0.5) * 0.5, 0, (Math.random() - 0.5) * 0.5)), (0.2 + Math.random() * 0.17) * (solid ? 1.7 : 1) * (1 + altK * 2.2), 10 + Math.random() * 7, { grow: solid ? 3 : 3.4, op: solid ? 1 - altK * 0.2 : 0.6 * (1 - altK * 0.5), tint: (solid ? 0.97 : 0.92) + Math.random() * 0.05 }); } }
          lastNoz = noz.clone();
          if (x < C.lift + 0.4) for (let i = 0, k = count(60, dt); i < k; i++) sparks.emit(v3((Math.random() - 0.5) * 0.6, deck + 0.05, (Math.random() - 0.5) * 0.6), v3((Math.random() - 0.5) * 4, 1 + Math.random() * 2.5, (Math.random() - 0.5) * 4), 0.025, 0.6);
        }
      }
      if (hold && !ctx.reduced && Math.random() < 0.6) { const p = onVeh(coreR * 1.05, vehH * 0.7, 0); vent.emit(p, v3(0.25 + Math.random() * 0.2, -0.05, 0.12), 0.1, 2.6); }
      // cold-gas puffs and pyro at separation
      if (inSpace && !ctx.reduced) {
        if (x >= C.sep && x < C.sep + 0.15) for (let i = 0; i < 10; i++) { const p = onVeh((Math.random() - 0.5) * coreR * 2, sepY, (Math.random() - 0.5) * coreR * 2); sparks.emit(p, v3((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2), 0.02, 0.5); }
        if (s1Tank && x > C.sep + 0.4 && x < C.onboardEnd && Math.random() < 0.2) { const hgt = (s1Tank.geometry as THREE.CylinderGeometry).parameters.height, sx = Math.random() < 0.5 ? 1 : -1;
          const p = s1Tank.localToWorld(v3(sx * coreR / S, hgt / 2, 0)); puffs.emit(p, s1Tank.localToWorld(v3(sx * 3, hgt / 2, 0)).sub(p).normalize().multiplyScalar(0.6), 0.07, 0.7); }
        if (x >= C.fair && x < C.fair + 0.15) for (let i = 0; i < 8; i++) { const p = onVeh((Math.random() - 0.5) * coreR * 3, vehH - 0.3 + Math.random() * 0.3, (Math.random() - 0.5) * coreR * 2); sparks.emit(p, v3((Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5), 0.018, 0.5); }
      }
      smoke.step(dt, 0.6, 0.07, { turb: 0.55, ground: onPad ? 0.12 : undefined, wind: WIND }); fire.step(dt); vent.step(dt, 0.4, -0.08, { turb: 0.15 }); spray.step(dt, 0.2, -3.2); sparks.step(dt, 0.8, -1.5); puffs.step(dt, 1.2, 0);
      labels.length = 0;
      // ---- shots
      if (globe) {
        earth.position.set(0, 0, 0); earth.scale.setScalar(ER); earth.rotation.set(0, 0, 0); cloudsOn = true;
        const s = clamp((x - G0) / (G1 - G0));
        path.upTo(s * 121);
        let p: V3;
        if (ending === 'short') { const k = Math.min(120, Math.floor(clamp((x - G0) / 3.3) * 120)); path.upTo(k + 1); p = ascent[k]; dot.visible = x < G0 + 3.6; }
        else if (x < G1) p = slerp(KSC, D, s).normalize().multiplyScalar(ER * (1 + hOrb * Math.pow(smooth(0, 1, s), 0.6)));
        else { const a = (x - G1) * 0.25 + ambient * 0.02 * (x >= dur ? 1 : 0); p = D.clone().applyAxisAngle(n, a).multiplyScalar(ER * (1 + hOrb)); ring.upTo(257 * smooth(G1, G1 + 1.4, x)); ring2.upTo(257 * smooth(G1, G1 + 1.4, x)); }
        dot.position.copy(p); dot.material.color.set(ending === 'short' && x > G0 + 2.3 ? 0xff7a2a : 0x7fd8ff);
        
        
        const mid = slerp(KSC, D, 0.55).normalize();
        return { pos: mid.clone().multiplyScalar(5.8).add(n.clone().multiplyScalar(-1.4)).add(v3(0, 1, 0)), look: mid.clone().multiplyScalar(1.1), far: 1.5, stars: 1 };
      }
      if (inSpace) {
        const up = EARTH_OFF.clone().negate().normalize();
        earth.position.copy(veh.position).add(EARTH_OFF); earth.scale.setScalar(EARTH_S);
        earth.quaternion.setFromUnitVectors(latlon(27, -64).normalize(), up).premultiply(new THREE.Quaternion().setFromAxisAngle(up, -0.5 + (x - C.meco) * 0.01));
        cloudsOn = true; // real cloud cover (NASA-derived map) seen from the upper stage
        const sv = camPref === 'auto' ? (x < C.onboardEnd ? 0 : x < C.sideEnd ? 1 : 2) : camPref === 'onboard' ? 0 : camPref === 'ground' ? 1 : 2;
        if (sv === 0) { // camera on the upper stage looking aft as the first stage falls away
          const pos = onVeh(coreR * 5.2, sepY + 0.3, coreR * 4.2), look = onVeh(-coreR * 0.5, sepY - 1.5, 0);
          return { pos, look, far: 1.6, fov: 62, sun: v3(0.4, 0.8, 0.45), sunI: 1.5, shake: 0.002, stars: 1 };
        }
        if (sv === 1) { const look = onVeh(0, sepY + 0.35, 0); return { pos: look.clone().add(v3(0.4, 0.55, 2.4)), look, far: 2, fov: 40, sun: v3(0.5, 0.75, 0.45), sunI: 1.5, stars: 1 }; }
        // the upper stage burning toward the sunrise over the limb
        const dip = Math.acos(EARTH_S / EARTH_OFF.length()), fwd = v3(1, 0, 0).projectOnPlane(up).normalize(), side = fwd.clone().cross(up).normalize();
        const sunD = fwd.clone().multiplyScalar(Math.cos(dip - 0.05)).addScaledVector(up, -Math.sin(dip - 0.05)).normalize();
        const mid = onVeh(0, vehH * 0.5, 0), look = mid.clone().addScaledVector(sunD, 2.2);
        return { pos: mid.clone().addScaledVector(sunD, -2.6).addScaledVector(up, 0.55).addScaledVector(side, 0.9), look, far: 1.6, fov: 50, sun: sunD.clone().addScaledVector(up, 0.25), sunI: 1.6, flare: sunD, stars: 1 };
      }
      const shake = ign ? (0.004 + 0.012 * thrust) * nearGround : 0, stars = dark;
      if (camPref === 'onboard') { // rocket camera: fixed to the vehicle, looking down its side at the pad falling away
        const pos = onVeh(coreR * 2.6, vehH * 0.86, coreR * 2.2), look = onVeh(coreR * 0.4, -1.5, 0);
        return { pos, look, far: 1.3, fov: 68, sun: site.sunDir, sunI: 1.25, shadow: true, shake: shake * 0.6 + (ign ? 0.002 : 0), stars };
      }
      if (camPref === 'ground') { // press-site camera a few hundred metres away, tilting up with the vehicle
        const look = veh.position.clone().add(v3(0, 1.1, 0));
        return { pos: v3(2.2, 0.5, 4.7), look: v3(look.x * 0.8, Math.max(deck + 1.2, look.y * 0.92), 0), far: 2, fov: 38, sun: site.sunDir, sunI: 1.25, shadow: true, shake, stars };
      }
      if (camPref === 'track') { // long-lens tracking camera miles away
        const pos = v3(16, 1.4, 26), look = veh.position.clone().add(v3(0, 0.7, 0)), d = pos.distanceTo(look);
        return { pos, look, far: 1, fov: (2 * Math.atan(3.4 / d) * 180) / Math.PI, sun: site.sunDir, sunI: 1.25, stars };
      }
      if (x < C.vabEnd) { // the assembly building where the vehicle was stacked
        const s = x / C.vabEnd, base = VAB.clone();
        
        return { pos: base.clone().add(toVab.clone().multiplyScalar(10.5 - s * 1.4)).add(vabSide.clone().multiplyScalar(-2.6 + s * 0.8)).setY(0.32 + s * 0.12), look: base.clone().add(toVab.clone().multiplyScalar(2.4)).setY(2.6 + s * 0.4), far: 1.6, fov: 44, sun: site.sunDir, sunI: 1.25, shadow: true, stars };
      }
      if (x < C.aerialEnd) { // aerial over the pad from the ocean side, the assembly building beyond
        const s = smooth(C.vabEnd, C.aerialEnd, x);
        
        return { pos: v3(15, 6.8, 12).lerp(v3(7.2, 2.7, 7.6), s), look: v3(0, 1.7, 0).lerp(v3(0, 1.85, 0), s), far: 1.4, fov: 40, sun: site.sunDir, sunI: 1.25, shadow: true, stars };
      }
      if (x < C.lift) { // low on the deck, looking up the vehicle: venting, deluge, ignition
        const s = smooth(C.aerialEnd, C.lift, x);
        return { pos: v3(1.15 + s * 0.15, deck + 0.12, 1.45 + s * 0.2), look: v3(-0.15, deck + 1.55, 0), far: 1.6, fov: 54, sun: site.sunDir, sunI: 1.25, shadow: true, shake, stars };
      }
      if (x < C.groundEnd) { // ground tracking camera
        const look = veh.position.clone().add(v3(0, 1.1, 0));
        return { pos: v3(2.2, 0.5, 4.7), look: v3(look.x * 0.8, Math.max(deck + 1.2, look.y * 0.92), 0), far: 2, fov: 38, sun: site.sunDir, sunI: 1.25, shadow: true, shake, stars };
      }
      if (x < C.trackEnd) { // long-lens tracking camera miles away
        const pos = v3(16, 1.4, 26), look = veh.position.clone().add(v3(0, 0.7, 0)), d = pos.distanceTo(look);
        return { pos, look, far: 1, fov: (2 * Math.atan(3.4 / d) * 180) / Math.PI, sun: site.sunDir, sunI: 1.25, stars };
      }
      // chase alongside as the sky darkens
      const look = onVeh(0, vehH * 0.08, 0);
      return { pos: look.clone().add(v3(2.6, -0.2, 5.4)), look, far: 2, fov: 40, sun: site.sunDir, sunI: 1.25, shake: 0.002, stars };
    };
  }

  function cruiseFilm(sp: FilmSpec): (x: number, dt: number) => Shot {
    const days = Math.max(1, sp.cruiseDays || 3), m = sp.mission;
    dur = 9; readyAt = 9; info.warp = (days * 86400) / dur; path.upTo(0); ghost.upTo(0);
    events = [{ k: m === 'leo' ? 'commission' : 'depart', at: 0.6 }, ...(m === 'leo' ? [] : [{ k: 'midcourse', at: 4.8 }]), { k: 'approach', at: 8.4 }];
    if (m === 'leo') { // first days in orbit: commissioning, Sun off to the side
      const ER = 1.5, hO = ((sp.altKm || 500) / 6371) * 3, n = v3(0.25, 1, 0.2).normalize(), d0 = v3(1, 0, 0).applyAxisAngle(v3(0, 0, 1), 0.35).projectOnPlane(n).normalize();
      const pts: V3[] = []; for (let i = 0; i <= 256; i++) pts.push(d0.clone().applyAxisAngle(n, (i / 256) * Math.PI * 2).multiplyScalar(ER * (1 + hO))); ring.set(pts); ring.upTo(257);
      return (x: number) => { show({ earth: true, ring: true, dot: true });
        earth.position.set(0, 0, 0); earth.scale.setScalar(ER); earth.rotation.set(0, x * 0.05, 0);
        dot.position.copy(d0.clone().applyAxisAngle(n, x * 0.9 + ambient * 0.05).multiplyScalar(ER * (1 + hO)));
        info.clock = { kind: 'day', v: Math.round((x / dur) * days), of: days }; info.alt = sp.altKm || null; info.vel = Math.sqrt(398600 / (6371 + (sp.altKm || 500))); info.dist = null;
        labels.length = 0; labels.push({ k: 'earth', p: v3(0, -ER * 1.05, 0) });
        return { pos: v3(1.4, 1.6, 6.2), look: v3(0, 0, 0), far: 2, sunW: SUN_L, sunAu: 1 }; };
    }
    if (m === 'moon') {
      const E = v3(-3.2, 0, 0), M = v3(3.4, 0.25, -0.6), RE = 0.62, RM = RE * 0.273;
      const curve = new THREE.CatmullRomCurve3([E.clone().add(v3(0.25, -0.05, RE + 0.12)), E.clone().add(v3(1.4, 0.15, 1.15)), v3(0.4, 0.35, 1.2), M.clone().add(v3(-0.9, 0.2, 0.75)), M.clone().add(v3(0.05, 0.08, RM + 0.25)), M.clone().add(v3(RM + 0.25, 0.04, 0))]);
      const pts = curve.getPoints(399); path.set(pts); ghost.set(pts); ghost.upTo(400);
      return (x: number) => { show({ earth: true, moon: true, dot: true, path: true, ghost: true });
        earth.position.copy(E); earth.scale.setScalar(RE); earth.rotation.set(0, x * 0.1, 0); target.moon.position.copy(M); target.moon.scale.setScalar(RM); target.moon.rotation.set(0, -1.2, 0);
        const s = smooth(0.4, dur - 0.4, x), k = Math.floor(s * 399); path.upTo(k + 1); dot.position.copy(pts[k]);
        info.clock = { kind: 'day', v: Math.round(s * days), of: days }; info.dist = Math.round(s * 384400 * (0.97 + 0.03 * s)); info.alt = null; info.vel = null;
        labels.length = 0; labels.push({ k: 'earth', p: E.clone().add(v3(0, -RE * 1.15, 0)) }, { k: 'moon', p: M.clone().add(v3(0, -RM * 1.6, 0)) });
        return { pos: v3(1.2, 3.2, 8.4), look: v3(1.2, 0, 0), far: 1.6, sunW: SUN_M, sunAu: 1 }; };
    }
    // heliocentric transfer (Mars: Hohmann half-ellipse; Bennu: schematic arc to its orbit)
    const r2 = m === 'mars' ? 1.524 : 1.126, sweep = m === 'mars' ? Math.PI : Math.PI * 0.82, th0 = 2.6, tgtPeriod = m === 'mars' ? 687 : 437;
    const rAt = (s: number) => AU * (1 + (r2 - 1) * (m === 'mars' ? (1 - Math.cos(Math.PI * s)) / 2 : smooth(0, 1, s)));
    const at = (s: number) => { const th = th0 + sweep * s; return v3(Math.cos(th) * rAt(s), Math.sin(s * Math.PI) * 0.06, -Math.sin(th) * rAt(s)); };
    const pts: V3[] = []; for (let i = 0; i < 400; i++) pts.push(at(i / 399)); path.set(pts); ghost.set(pts); ghost.upTo(400);
    // the other planets at their mean longitudes for the launch date (2026-11-12), in the frame where Earth departs at th0
    const d0 = (Date.UTC(2026, 10, 12) - Date.UTC(2000, 0, 1, 12)) / 864e5, rad = Math.PI / 180, off = th0 - (EARTH_L.L0 + EARTH_L.n * d0) * rad;
    dur = 10.5; readyAt = dur; events = events.map(e => ({ ...e, at: e.at + 1.5 }));
    const planetAt = (r: number, period: number, dayNow: number, endTh: number) => { const th = endTh - ((days - dayNow) / period) * Math.PI * 2; return v3(Math.cos(th) * r * AU, 0, -Math.sin(th) * r * AU); };
    return (x: number) => { show({ helio: true, earth: true, [m === 'mars' ? 'mars' : 'bennu']: true, dot: true, path: true, ghost: true });
      helio.position.set(0, 0, 0); earthOrbit.visible = true; marsOrbit.visible = m === 'mars'; bennuOrbit.visible = m === 'neo';
      const s = smooth(1.9, dur - 0.4, x), day = s * days, k = Math.floor(s * 399); path.upTo(k + 1); dot.position.copy(pts[k]);
      for (const o of others) { const th = off + (o.p.L0 + o.p.n * (d0 + day)) * rad; o.b.position.set(Math.cos(th) * o.p.a * AU, 0, -Math.sin(th) * o.p.a * AU); o.b.rotation.y = x * 0.6; }
      tickSun(sunBall, ambient); belt.rotation.y = day * 0.0038; // about 4.6 years per turn at 2.7 AU
      const ep = planetAt(1, 365.25, day, th0 + (days / 365.25) * Math.PI * 2), tp = planetAt(r2, tgtPeriod, day, th0 + sweep);
      earth.position.copy(ep); earth.scale.setScalar(0.1); earth.rotation.set(0, x, 0);
      const T = target[m === 'mars' ? 'mars' : 'bennu']; T.position.copy(tp); T.scale.setScalar(m === 'mars' ? 0.075 : 0.05);
      info.clock = { kind: 'day', v: Math.round(day), of: days }; info.dist = Math.round(pts[k].distanceTo(ep) / AU * 149.6e6); info.alt = null; info.vel = null;
      labels.length = 0; labels.push({ k: 'sun', p: v3(0, -0.36, 0) }, { k: 'earth', p: ep.clone().add(v3(0, -0.2, 0)) }, { k: m === 'mars' ? 'mars' : 'bennu', p: tp.clone().add(v3(0, -0.2, 0)) });
      // open on the whole system (true distances), then close in on the transfer
      const w = 1 - smooth(0.2, 2.4, x);
      return { pos: v3(0.6, 5.4, 6.8).lerp(v3(4, 52, 66), w), look: v3(0.2, 0, 0.4).lerp(v3(0, 0, 0), w), far: 1.5 }; };
  }

  function arrivalFilm(sp: FilmSpec): (x: number, dt: number) => Shot {
    const m = sp.mission, key = m === 'mars' ? 'mars' : m === 'neo' ? 'bennu' : 'moon', B = target[key], a = sp.arrive, post = sp.post;
    buildCraft(); dust.clear();
    const days = Math.max(1, sp.cruiseDays || 1);
    info.clock = { kind: 'day', v: days, of: days }; info.alt = info.vel = info.dist = null; info.warp = 600;
    if (a === 'land') {
      const R = 40, mars = m === 'mars';
      skyMat.uniforms.hz.value.set(mars ? 0xc49a72 : 0x000000); skyMat.uniforms.zn.value.set(mars ? 0x5b4031 : 0x000000); skyMat.uniforms.gr.value.set(mars ? 0x6a4a38 : 0x111111); skyMat.uniforms.k.value = 0;
      const touched = !!post;
      dur = touched ? 4.2 : mars ? 8 : 6.5; readyAt = dur;
      events = touched ? [{ k: 'touchdown', at: 3.2 }] : [...(mars ? [{ k: 'entry', at: 0.3 }] : []), { k: 'descent', at: mars ? 3.6 : 0.5 }];
      const hover = 1.15, foot = craft.userData.foot ?? 0.3;
      return (x: number, dt: number) => { show({ [key]: true, craft: true, sky: true });
        B.position.set(0, -R, 0); B.scale.setScalar(R); B.rotation.set(0.3, 1.1, 0);
        let y: number, xo = 0, glowOn = 0, burn = false;
        if (!touched) {
          if (mars && x < 3.4) { const s = x / 3.4; y = 9 - s * 6; xo = -5 + s * 4.4; glowOn = 1 - smooth(2.2, 3.4, x); }
          else { const s0 = mars ? 3.4 : 0, s = smooth(s0, dur, x); y = (mars ? 3 : 4.2) + (hover - (mars ? 3 : 4.2)) * s; xo = (mars ? -0.6 : -1.4) * (1 - s); burn = true; }
          info.alt = Math.max(0, Math.round((y - foot) * 120)) / 1000; info.vel = Math.max(0.002, (1 - x / dur) * (mars ? 0.4 : 1.6));
        } else { const s = smooth(0, 3.2, x); y = hover + (foot - hover) * s; burn = x < 3.2; info.alt = Math.max(0, (y - foot) * 0.12); info.vel = burn ? 0.002 : 0;
          if (!ctx.reduced && x > 2.4 && x < 3.6) for (let i = 0; i < 8; i++) { const an = Math.random() * 6.283, sp2 = 0.8 + Math.random() * 1.4; dust.emit(v3(Math.cos(an) * 0.2, 0.02, Math.sin(an) * 0.2), v3(Math.cos(an) * sp2, 0.15 + Math.random() * 0.3, Math.sin(an) * sp2), 0.35, 2.2); } }
        dust.step(dt, 0.9, -0.05);
        craft.position.set(xo, y, 0); craft.rotation.set(0, ambient * 0.1, mars && glowOn > 0 ? 0.9 : 0);
        firePlume(retro, burn, 1, 1); retro.rotation.set(0, 0, 0); retro.position.set(0, -0.12, 0); retro.scale.set(1, 0.7 + Math.sin(ambient * 50) * 0.08, 1);
        shield.material.opacity = glowOn * 0.9; shield.scale.setScalar(1.4 + Math.sin(ambient * 30) * 0.1);
        labels.length = 0;
        return { pos: v3(xo + 1.6, y + 0.35, 3.4), look: v3(xo * 0.6, y - 0.1, 0), far: 2.2, sunW: SUN_A, sunAu: mars ? 1.52 : 1 };
      };
    }
    const RB = key === 'bennu' ? 0.9 : 1.4;
    const aero = a === 'aero', nav = a === 'nav', miss = a === 'miss', flyby = a === 'flyby';
    dur = post ? 6 : nav ? 7 : 7; readyAt = dur;
    events = miss ? [{ k: 'capture', at: 2.6 }, { k: 'miss', at: 5 }] : nav ? [{ k: 'opnav', at: 0.6 }, { k: 'approach', at: 4 }] : flyby ? [{ k: 'flyby', at: 4 }]
      : post === 'aero' ? [{ k: 'aero', at: 1 }, { k: 'aero', at: 3 }, { k: 'aero', at: 5 }] : [{ k: 'approach', at: 0.6 }, { k: 'capture', at: 3 }, { k: 'orbit', at: 5.6 }];
    const rp = RB * 1.35, n = v3(0.12, 1, 0.18).normalize();
    const ringAt = (e: number) => { const pts: V3[] = []; const aa = rp / (1 - e); for (let i = 0; i <= 256; i++) { const th = (i / 256) * Math.PI * 2, r = (aa * (1 - e * e)) / (1 + e * Math.cos(th)); pts.push(v3(Math.cos(th) * r, 0, Math.sin(th) * r).applyAxisAngle(v3(1, 0, 0), 0.18)); } return pts; };
    if (!nav && !flyby && !miss) { ring.set(ringAt(post === 'aero' ? 0.6 : aero ? 0.75 : 0)); ring.upTo(0); }
    const approach = new THREE.CatmullRomCurve3([v3(-9, 1.4, 4.2), v3(-3.6, 0.5, 2.6), v3(-0.8, 0.1, rp + 0.05), v3(rp * 0.2, 0, rp * 1.0), v3(rp, 0, 0.1)]);
    return (x: number, dt: number) => { show({ [key]: true, craft: !nav || x > 4, ring: !nav && !flyby && !miss });
      B.position.set(0, 0, 0); B.scale.setScalar(nav ? RB * (0.05 + 0.95 * smooth(0, 6, x)) : RB); B.rotation.set(key === 'moon' ? 0 : 0.2, key === 'moon' ? -Math.PI / 2 + 0.6 : ambient * (key === 'bennu' ? 0.25 : 0.03), 0); // the Moon keeps its near side to the Earth
      let p: V3, burn = false;
      if (post === 'aero' || (post === 'burn')) { const e = post === 'aero' ? 0.6 * (1 - smooth(0, 6, x)) : 0; ring.set(ringAt(e)); ring.upTo(257);
        const th = x * (post === 'aero' ? 3.2 : 0.9); const aa = rp / (1 - Math.max(0.001, e)); const r = (aa * (1 - e * e)) / (1 + e * Math.cos(th));
        p = v3(Math.cos(th) * r, 0, Math.sin(th) * r).applyAxisAngle(v3(1, 0, 0), 0.18); burn = post === 'burn' && x < 2.2;
        plasma.position.copy(p); (plasma.material as THREE.SpriteMaterial).opacity = post === 'aero' ? Math.max(0, 1 - (r - rp) / 0.25) * 0.9 : 0; plasma.scale.setScalar(0.45);
      } else if (nav) { const s = smooth(4, 7, x); p = v3(rp * 1.2, 0.3, 1.2).lerp(v3(rp * 1.05, 0.2, 0.6), s); info.dist = Math.round((1 - smooth(0, 6, x)) * 1.8e6 + 20); }
      else { const s = miss ? x / dur : smooth(0, 5.6, x); if (s < 1 || miss) p = approach.getPoint(Math.min(1, s)).clone(); else p = v3(rp, 0, 0.1);
        if (miss && x > 4.6) p = approach.getPoint(1).clone().add(v3(0.5, 0, -1).multiplyScalar((x - 4.6) * 0.8));
        if (!miss && x > 5.6) { const th = (x - 5.6) * 0.6; p = v3(Math.cos(th) * rp, 0, Math.sin(th) * rp).applyAxisAngle(v3(1, 0, 0), 0.18); }
        burn = x > 2.8 && x < (miss ? 3.6 : 5.4); if (!miss && !flyby) ring.upTo(257 * smooth(4.6, 6, x)); }
      craft.position.copy(p); craft.lookAt(B.position); craft.rotateX(Math.PI / 2);
      firePlume(retro, burn && !ctx.reduced, 1, 1); retro.scale.set(1, 0.8 + Math.sin(ambient * 50) * 0.1, 1); retro.rotation.set(Math.PI, 0, 0); retro.position.set(0, 0.25, 0);
      shield.material.opacity = 0; void dt;
      labels.length = 0; labels.push({ k: key, p: v3(0, -RB * 1.12, 0) });
      const au = key === 'mars' ? 1.52 : key === 'bennu' ? 1.13 : 1;
      // opening: low over the surface, looking along the horizon toward the Sun as it rises over the limb (true apparent size);
      // the ground lights up at grazing angle, then the camera pulls back to the day side
      const main = nav ? { pos: v3(0.2, 0.5, 4.6), look: v3(0, 0, 0) } : { pos: v3(0.6, 1.5, 6), look: v3(0.2, 0, 0) };
      const k = ctx.reduced || post ? 1 : smooth(2.8, 4.8, x);
      if (k < 1) { const up = v3(0, 1, 0).addScaledVector(SUN_A, -SUN_A.y).normalize(), D2R = Math.PI / 180;
        // altitude 0.22 radii: the horizon lies 35° below the local horizontal; the Sun climbs from behind it (orbital sunrise)
        const e = (-40 + 29 * smooth(0, 2.6, x)) * D2R, nrm = SUN_A.clone().multiplyScalar(Math.sin(e)).addScaledVector(up, Math.cos(e)).normalize();
        const fwd = SUN_A.clone().addScaledVector(nrm, -SUN_A.dot(nrm)).normalize();
        const cpos = nrm.clone().multiplyScalar(RB * 1.22), clook = cpos.clone().addScaledVector(fwd, 5).addScaledVector(nrm, -5 * Math.tan(25 * D2R));
        return { pos: cpos.lerp(main.pos, k), look: clook.lerp(main.look, k), far: 1, sunW: SUN_A, sunAu: au, fov: 46 - 6 * k }; }
      return { ...main, far: nav ? 1.8 : 1.7, sunW: SUN_A, sunAu: au };
    };
  }

  function show(on: Record<string, boolean>) {
    pad.visible = !!on.pad; sky.visible = !!on.sky; veh.visible = !!on.veh; earth.visible = !!on.earth; helio.visible = !!on.helio; craft.visible = !!on.craft; dot.visible = !!on.dot;
    path.line.visible = !!on.path; ghost.line.visible = !!on.ghost; ring.line.visible = !!on.ring; ring2.line.visible = !!on.ring2;
    for (const k in target) target[k].visible = !!on[k];
    scene.fog = null; scene.environment = ctx.envs.space;
  }

  // ---------------------------------------------------------------- effects
  function fxUpdate(dt: number, camPos: V3, filmOn: boolean) {
    const fx = spec?.fx ?? null, t = fxU;
    const live = fx && t >= 0;
    const a = ctx.anchor(), focus = filmOn ? (craft.visible ? craft.position : dot.visible ? dot.position : v3()) : a.craft, bodyPos = filmOn ? v3() : a.planet, bodyR = filmOn ? 1.4 : a.R;
    // solar storm, in the order it happens: a flare brightens the Sun (light, 8 minutes at 1 AU); energetic protons arrive next and pepper the
    // camera sensor; the plasma cloud itself blows past; around Earth the aurora lights up. Nothing explodes: the damage is radiation, not blast.
    const hel = filmOn && helio.visible, sunDir = tmp.copy(SUN.dir).normalize(), sunPos = hel ? v3() : camPos.clone().addScaledVector(sunDir, 600);
    const storm = live && fx === 'storm', fl = storm ? Math.max(0, 1 - Math.abs(t - 0.5) / 0.6) : 0;
    flash.visible = !!storm; cme.visible = cme2.visible = !!storm && hel; sunFar.visible = false;
    const snowK = storm && !ctx.reduced ? smooth(0.9, 2.4, t) * (0.55 + 0.45 * (1 - smooth(4, 9, t))) : 0, windK = storm && !hel && !ctx.reduced ? smooth(1.3, 2.6, t) * (0.5 + 0.5 * (1 - smooth(5, 10, t))) : 0;
    snow.visible = snowK > 0; snowMat.uniforms.o.value = snowK; snowMat.uniforms.tm.value = ambient; snowMat.uniforms.asp.value = cam.aspect;
    if (storm) {
      flash.position.copy(sunPos); flash.scale.setScalar(hel ? 1.6 + fl * 4 : 70 + fl * 260); (flash.material as THREE.SpriteMaterial).opacity = Math.min(1, 0.25 + fl);
      if (hel) { const to = focus.clone().normalize(), reach = focus.length() * 1.3, s1 = smooth(0.4, 2.8, t) * reach; cmeMat.uniforms.dir.value.copy(to); cmeMat.uniforms.tm.value = ambient * 2; cmeMat.uniforms.o.value = 0.95 * (1 - smooth(2.8, 5, t));
        cme.position.set(0, 0, 0); cme.scale.setScalar(Math.max(0.01, s1)); cme2.position.set(0, 0, 0); cme2.scale.setScalar(Math.max(0.01, s1 * 0.82)); } }
    wind.visible = windK > 0;
    if (windK > 0) { const dir = sunDir.clone().negate(), fw = cam.getWorldDirection(v3()), rt = v3().crossVectors(fw, cam.up).normalize(), up = v3().crossVectors(rt, fw);
      const spawn = (w: { p: V3; s: number; l: number }, anywhere: boolean) => { const d = 3 + Math.random() * 14; w.p.copy(camPos).addScaledVector(fw, d).addScaledVector(rt, (Math.random() - 0.5) * d * 1.6).addScaledVector(up, (Math.random() - 0.5) * d); if (!anywhere) w.p.addScaledVector(dir, -d * 0.7); w.s = 9 + Math.random() * 14; w.l = 0.25 + Math.random() * 0.9; };
      while (windP.length < WN) { const w = { p: v3(), s: 1, l: 1 }; spawn(w, true); windP.push(w); }
      windP.forEach((w, i) => { w.p.addScaledVector(dir, w.s * dt); if (tmp2.copy(w.p).sub(camPos).dot(dir) > 16) spawn(w, false);
        const tail = tmp2.copy(w.p).addScaledVector(dir, -w.l), b = windK * (0.25 + 0.5 * ((i * 37) % 10) / 10); windPos.set([w.p.x, w.p.y, w.p.z, tail.x, tail.y, tail.z], i * 6); windCol.set([b, b * 0.82, b * 0.6, 0, 0, 0], i * 6); });
      windG.attributes.position.needsUpdate = windG.attributes.color.needsUpdate = true; }
    const aurK = storm && spec?.mission === 'leo' ? smooth(1.4, 4, t) : 0; for (const a of auroras) { a.visible = aurK > 0.01; const u = ((a.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms; u.o.value = aurK; u.t.value = ambient; }
    // micrometeoroids: bright streaks crossing near the spacecraft
    if (live && fx === 'streaks' && !ctx.reduced && Math.random() < 0.6) { const d = v3(1, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4).normalize(); streaks.emit(focus.clone().add(v3(-2, (Math.random() - 0.5) * 1.2, (Math.random() - 0.5) * 1.2)), d.multiplyScalar(9), 0.03, 0.5); }
    streaks.step(dt);
    // dust storm: a brown veil over the body and dimmer sunlight
    const dustK = live && fx === 'dust' ? smooth(0, 2, t) : 0; haze.visible = dustK > 0; haze.position.copy(bodyPos); haze.scale.setScalar(bodyR * 3.4); (haze.material as THREE.SpriteMaterial).opacity = dustK * 0.75;
    // re-entry/drag heating around the spacecraft
    const pl = live && fx === 'plasma' ? 0.55 + 0.25 * Math.sin(ambient * 25) : 0; if (!(filmOn && spec?.post === 'aero')) { plasma.position.copy(focus); plasma.scale.setScalar(0.6); (plasma.material as THREE.SpriteMaterial).opacity = pl; }
    // eclipse / night / brown-out: the light goes away
    const dark = live && (fx === 'dark') ? smooth(0, 1.5, t) : -0.3 * fl; // a flare briefly brightens everything the Sun lights
    // conjunction: the Sun sits between Earth and the spacecraft
    if (live && fx === 'sunblock') { sunFar.visible = true; sunFar.position.copy(camPos.clone().add(v3(-4, 1.5, -20))); sunFar.scale.setScalar(14); (sunFar.material as THREE.SpriteMaterial).opacity = smooth(0, 1.5, t); }
    clouds.visible = filmOn && cloudsOn;
    return { dark, dust: dustK };
  }

  // ---------------------------------------------------------------- public
  let q: Base[] = [], qi = 0, inOps = false;
  /** Start film k of the queue. The fx and the decision belong to the last film unless the entry happens in operations. */
  function begin(k: number) {
    const sp = spec!, base = q[k], last = k === q.length - 1, own = last && !sp.ops;
    qi = k; inOps = false; cloudsOn = true; info.film = base; root.visible = true; info.active = true; firedEv = new Set(); loose = [];
    shot = base === 'launch' ? launchFilm(sp) : base === 'cruise' ? cruiseFilm(sp) : arrivalFilm(sp);
    if (sp.hold && own) { u = dur; readyAt = dur + (sp.fx ? 2.4 : 0.2); fxAt = sp.fx ? dur + 0.3 : Infinity; events.forEach(e => firedEv.add(e.k + e.at)); }
    else { u = 0; fxAt = own && sp.fx ? dur * 0.55 : Infinity; if (own && sp.fx) readyAt = Math.max(readyAt, fxAt + 2.4); if (!own) readyAt = dur; }
    info.events = events; info.dur = Math.max(dur, readyAt); info.seq++; shot(u, 0);
  }
  /** Operations: the always-on scene draws the body and spacecraft; the director only adds effects. */
  function enterOps() {
    const sp = spec!; inOps = true; info.film = null; finishFilm(); u = 0; dur = 0.01; events = []; info.events = []; info.seq++;
    fxAt = sp.fx ? 0.3 : Infinity; readyAt = sp.fx ? 2.4 : 0; info.dur = Math.max(dur, readyAt);
  }
  function setSpec(sp: FilmSpec | null) {
    if (sp?.key === spec?.key) { if (sp) spec = sp; return; }
    const wasFilm = info.active; spec = sp; alerted = false; yaw = pitch = 0; zoom = 1; fxU = -1; info.alert = false; info.hold = false; info.ready = false;
    if (!sp) { finishFilm(); info.ready = true; return; }
    if (!wasFilm) { savedSun = sun.position.clone(); savedSunI = sun.intensity; }
    q = [...sp.films];
    if (ctx.reduced) { if (sp.ops || !q.length) { enterOps(); u = readyAt; } else { begin(q.length - 1); u = Math.max(u, readyAt); events.forEach(e => firedEv.add(e.k + e.at)); } }
    else if (q.length) begin(0); else enterOps();
    info.ready = u >= readyAt;
  }
  function finishFilm() { if (info.active || root.visible) { root.visible = false; scene.fog = null; scene.environment = ctx.envs.space; sun.position.copy(savedSun); sun.intensity = savedSunI; sun.castShadow = false; setStars(0.9); ctx.restoreView(); } info.active = false; info.labels = []; }

  function setStars(o: number) { stars?.userData.op?.(o); }
  /** Glare and ghosts when the sun (direction d) is in frame. */
  function flare(d: V3 | null) {
    const all = [flareMain, ...flareGhosts]; all.forEach(f => (f.visible = false)); if (!d || ctx.reduced) return;
    const sp = cam.position.clone().add(d.clone().normalize().multiplyScalar(80)), ndc = sp.clone().project(cam);
    if (ndc.z > 1 || Math.abs(ndc.x) > 1.3 || Math.abs(ndc.y) > 1.3) return;
    const at = (nx: number, ny: number, dist: number) => v3(nx, ny, 0.5).unproject(cam).sub(cam.position).normalize().multiplyScalar(dist).add(cam.position);
    const viewH = 2 * Math.tan((cam.fov * Math.PI) / 360);
    flareMain.visible = true; flareMain.position.copy(at(ndc.x, ndc.y, 6)); flareMain.scale.setScalar(viewH * 6 * 0.3); (flareMain.material as THREE.SpriteMaterial).opacity = 0.95;
    [0.3, 0.7, 1.15, 1.5].forEach((f, i) => { const g = flareGhosts[i]; g.visible = true; g.position.copy(at(ndc.x * (1 - 2 * f), ndc.y * (1 - 2 * f), 5)); g.scale.setScalar(viewH * 5 * [0.06, 0.12, 0.05, 0.18][i]); (g.material as THREE.SpriteMaterial).opacity = [0.35, 0.18, 0.4, 0.12][i]; });
  }
  /** Advance one frame. Returns true when a film owns the camera (the caller then skips its own layout). */
  let lastNow = 0;
  function update(_dt: number, w: number, h: number): { film: boolean; dark: number; dust: number } {
    const nowMs = performance.now(), dt = lastNow ? Math.min(0.25, (nowMs - lastNow) / 1000) : 0.016; lastNow = nowMs;
    if (!spec) { fxUpdate(dt, cam.position, false); return { film: false, dark: 0, dust: 0 }; }
    const step = paused ? 0 : dt * speed;
    ambient += dt;
    const end = Math.max(dur, readyAt);
    if (u < end) u = Math.min(end, u + step); else u += step * 0.0; // hold the last frame; ambient time keeps things alive
    if (u >= fxAt && fxU < 0) fxU = 0; if (fxU >= 0) fxU += step || (paused ? 0 : dt);
    if (fxU >= 0 && !alerted) { alerted = true; info.alert = true; if (!ctx.reduced) sfx.alert(); }
    for (const e of events) if (u >= e.at && !firedEv.has(e.k + e.at)) { firedEv.add(e.k + e.at); if (e.k === 'ignition') sfx.launch(); else if (['boostsep', 'stagesep', 'fairing', 'touchdown'].includes(e.k)) sfx.whoosh(); }
    if (!info.ready && u >= readyAt) { if (!inOps && qi < q.length - 1) begin(qi + 1); else if (!inOps && spec.ops) enterOps(); else info.ready = true; }
    info.u = Math.min(u, info.dur);
    if (inOps) { const r = fxUpdate(dt, cam.position, false); info.labels = []; return { film: false, ...r }; }
    const s = shot(Math.min(u, dur), step);
    // user look-around: orbit the camera about the subject, zoom, near/wide
    const off = s.pos.clone().sub(s.look).multiplyScalar(zoom * (near ? 1 : s.far ?? 2) * (w / h < 0.8 ? 1.4 : 1));
    const sph = new THREE.Spherical().setFromVector3(off); sph.theta += yaw; sph.phi = clamp(sph.phi - pitch, 0.08, Math.PI - 0.08);
    cam.position.copy(s.look).add(tmp.setFromSpherical(sph));
    if (s.shake && !ctx.reduced) { const a = s.shake; cam.position.add(v3(Math.sin(ambient * 71) * a, Math.sin(ambient * 83 + 1) * a, Math.sin(ambient * 67 + 2) * a)); }
    cam.lookAt(s.look);
    const baseFov = w / h < 0.82 ? 52 : 40; cam.fov = s.fov ? (s.fov * baseFov) / 40 : baseFov;
    // keep the subject clear of the decision panel: right panel on desktop, bottom sheet on phones
    const desk = w > 900; cam.setViewOffset(w, h, desk ? w * 0.13 : 0, desk ? 0 : h * 0.17, w, h); cam.updateProjectionMatrix();
    // light from over the camera's shoulder, upper left
    seeSun.obj.visible = false;
    if (s.sunW) { sun.position.copy(s.sunW).normalize().multiplyScalar(30); sun.intensity = s.sunI ?? 1.35; seeSun.obj.visible = true; seeSun.place(cam, s.sunW, sunDeg(s.sunAu ?? 1), 600, 1); }
    else if (s.sun) { sun.position.copy(s.sun).normalize().multiplyScalar(30); sun.intensity = s.sunI ?? 1.3; }
    else { sun.position.copy(cam.position).add(v3(-6, 3, 2).applyQuaternion(cam.quaternion)); sun.intensity = savedSunI || 1.35; }
    const sm = Q.shadowMap; sun.castShadow = !!s.shadow && sm > 0; if (sun.castShadow) { const sc = sun.shadow.camera as THREE.OrthographicCamera; if (sc.right !== 7) { sc.left = sc.bottom = -7; sc.right = sc.top = 7; sc.near = 5; sc.far = 70; sc.updateProjectionMatrix(); sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02; }
      if (sun.shadow.mapSize.x !== sm) { sun.shadow.mapSize.set(sm, sm); const sh = sun.shadow as unknown as { map: THREE.WebGLRenderTarget | null }; sh.map?.dispose(); sh.map = null; } }
    setStars(0.9 * (s.stars ?? 1));
    flare(s.flare ?? null);
    { const ld = tmp.copy(sun.position).normalize(); for (const b of allBillows) b.light(ld); }
    const r = fxUpdate(dt, cam.position, true);
    // screen positions of labelled things
    scene.updateMatrixWorld(); const out: FilmInfo['labels'] = [];
    for (const l of labels) { tmp.copy(l.p).project(cam); if (tmp.z < 1 && Math.abs(tmp.x) < 1.05 && Math.abs(tmp.y) < 1.05) out.push({ k: l.k, x: ((tmp.x + 1) / 2) * w, y: ((1 - tmp.y) / 2) * h }); }
    info.labels = out;
    return { film: true, ...r };
  }

  return {
    info, update, set: setSpec,
    /** World position of the Sun when the heliocentric frame is on screen, else null (directional light). */
    sunPoint() { return root.visible && helio.visible ? helio.getWorldPosition(v3()) : null; },
    skip() { if (!spec) return; if (!inOps && spec.ops) enterOps(); else if (!inOps && qi < q.length - 1) begin(q.length - 1);
      u = Math.max(u, Math.max(dur, readyAt)); if (spec.fx && fxU < 0) fxU = 2.4; events.forEach(e => firedEv.add(e.k + e.at)); info.ready = true; },
    replay() { if (!spec || !q.length) return; const sp = spec; spec = null; info.active = true; setSpec(sp); },
    /** Dev aid: jump to film time x (seconds). */ seek(x: number) { u = x; },
    speed(n: number) { speed = n; }, pause(p: boolean) { paused = p; }, near(on: boolean) { near = on; },
    /** Launch camera: the director's cut, the press site, the long-lens tracker or the camera on the rocket. */ cam(id: CamId) { camPref = id; yaw = pitch = 0; zoom = 1; },
    look(dx: number, dy: number) { yaw -= dx * 0.006; pitch = clamp(pitch - dy * 0.005, -1.2, 1.2); },
    zoom(f: number) { zoom = clamp(zoom * f, 0.4, 3); },
    get state() { return { speed, paused, near, cam: camPref }; },
  };
}
export type Director = ReturnType<typeof createDirector>;
