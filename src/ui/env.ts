// Image-based lighting: two small procedural environments (space and a clear day at the pad), prefiltered once.
// Metals, foil, glass and paint reflect them, which is most of what makes a spacecraft read as a real object.
import * as THREE from 'three';

const VERT = 'varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
function bake(pm: THREE.PMREMGenerator, frag: string, sun: THREE.Vector3) {
  const s = new THREE.Scene(), g = new THREE.SphereGeometry(10, 48, 24);
  const m = new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, uniforms: { sd: { value: sun.clone().normalize() } }, vertexShader: VERT, fragmentShader: 'uniform vec3 sd; varying vec3 vD;\n' + frag });
  s.add(new THREE.Mesh(g, m)); const t = pm.fromScene(s, 0.015).texture; g.dispose(); m.dispose(); return t;
}
/** space: black sky, a small very bright Sun, soft blue planet-shine from below, a faint fill so shadowed metal is not pure black.
 *  day: blue zenith, bright hazy horizon, warm ground bounce, the Sun. */
export function createEnvs(renderer: THREE.WebGLRenderer, sunSpace: THREE.Vector3, sunDay: THREE.Vector3) {
  const pm = new THREE.PMREMGenerator(renderer);
  const space = bake(pm, `void main(){ vec3 d = normalize(vD); float s = max(dot(d, sd), 0.0);
      vec3 c = vec3(0.035, 0.04, 0.055);
      c += vec3(1.0, 0.95, 0.86) * (smoothstep(0.985, 0.998, s) * 38.0 + pow(s, 14.0) * 0.55);
      c += vec3(0.16, 0.3, 0.62) * smoothstep(0.15, -0.9, d.y) * 0.9; /* planet-shine */
      c += vec3(0.5, 0.56, 0.7) * smoothstep(0.93, 1.0, dot(d, normalize(vec3(0.75, 0.25, 0.6)))) * 1.6; /* a soft second source rims the dark side */
      gl_FragColor = linearToOutputTexel(vec4(c, 1.0)); }`, sunSpace);
  const day = bake(pm, `void main(){ vec3 d = normalize(vD); float s = max(dot(d, sd), 0.0), y = d.y;
      vec3 sky = mix(vec3(0.78, 0.88, 1.0), vec3(0.16, 0.36, 0.78), pow(clamp(y, 0.0, 1.0), 0.5)) * 0.95;
      vec3 gnd = mix(vec3(0.34, 0.33, 0.27), vec3(0.2, 0.23, 0.16), smoothstep(0.0, -0.6, y));
      vec3 c = mix(gnd, sky, smoothstep(-0.03, 0.03, y));
      c += vec3(1.0, 0.94, 0.82) * (smoothstep(0.99, 0.999, s) * 30.0 + pow(s, 24.0) * 0.6);
      gl_FragColor = linearToOutputTexel(vec4(c * 0.5, 1.0)); }`, sunDay);
  pm.dispose();
  return { space, day };
}
