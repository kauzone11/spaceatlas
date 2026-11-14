import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
// three.js is loaded from cdnjs as a global (see scripts/package.mjs); everything else is bundled into one script.
export default defineConfig({
  plugins: [preact(), { name: 'three-global', enforce: 'pre', resolveId: id => (id === 'three' ? '\0three' : null), load: id => (id === '\0three' ? 'const T = globalThis.THREE; export default T; ' + NAMES.map(n => `export const ${n} = T.${n};`).join('') : null) }],
  build: { target: 'es2020', cssCodeSplit: false, assetsInlineLimit: 1e8, rollupOptions: { output: { inlineDynamicImports: true, entryFileNames: 'app.js', assetFileNames: 'app.[ext]' } } },
});
// every THREE.Name used anywhere in src (types included; a name that is only a type exports undefined, which is harmless)
function walk(d: string): string[] { return readdirSync(d, { withFileTypes: true }).flatMap(e => (e.isDirectory() ? walk(join(d, e.name)) : /\.tsx?$/.test(e.name) ? [join(d, e.name)] : [])); }
const NAMES = [...new Set(walk('src').flatMap(f => [...readFileSync(f, 'utf8').matchAll(/\bTHREE\.([A-Za-z_]\w*)/g)].map(m => m[1])))];
