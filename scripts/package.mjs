// Packs the Vite build into the pages that are published:
//  dist/artifact.html  page fragment for a Claude artifact (format the Artifact tool publishes): code, styles and the standard
//                      planet maps inlined, because an artifact is one file
//  dist/index.html     the web build (Vercel or any static host): code in dist/assets/ (hashed names), planet maps loaded from textures/ when
//                      first needed, 4096-px maps on capable desktops
//  dist/local.html     the web build as a full document for local testing (npx vite preview)
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { WORLD_FILES } from '../src/data/worlds.ts';
const js = readFileSync('dist/app.js', 'utf8').replace(/<\/script/g, '<\\/script'), css = readFileSync('dist/app.css', 'utf8');
const MIME = { webp: 'image/webp', jpg: 'image/jpeg', png: 'image/png' };
const inline = Object.fromEntries(Object.entries(WORLD_FILES).map(([k, f]) => [k, `data:${MIME[f.sd.split('.').pop()]};base64,` + readFileSync('public/' + f.sd).toString('base64')]));
// shown by the browser before the script runs, replaced by the app on its first render
const boot = '<div class="boot" role="status"><b>SpaceAtlas</b><span>Mission Control</span><i></i></div>';
const head = `<title>SpaceAtlas Mission Control</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@500&family=Space+Grotesk:wght@500;600;700&display=swap">
<style>${css}</style>
<canvas id="stage" aria-hidden="true"></canvas><div id="app">${boot}</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>`;
const artifact = `${head}
<script>window.__SA_TEX=${JSON.stringify(inline)}</script>
<script type="module">${js}</script>
`;
const web = `${head}
<script type="module">${js}</script>
`;
// hosted build (Vercel): code and styles as content-hashed files, cached forever by the browser (vercel.json), so a repeat
// visit downloads only the small HTML; the boot splash still paints before the script arrives
const hash = s => createHash('sha256').update(s).digest('hex').slice(0, 10);
const jsRaw = readFileSync('dist/app.js', 'utf8'), jsName = `assets/app.${hash(jsRaw)}.js`, cssName = `assets/app.${hash(css)}.css`;
mkdirSync('dist/assets', { recursive: true }); writeFileSync('dist/' + jsName, jsRaw); writeFileSync('dist/' + cssName, css);
const hosted = head.replace(`<style>${css}</style>`, `<link rel="stylesheet" href="/${cssName}">`)
  .replace('<script src="https://cdnjs', `<link rel="modulepreload" href="/${jsName}">\n<script src="https://cdnjs`) + `\n<script type="module" src="/${jsName}"></script>\n`;
const doc = body => '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="description" content="SpaceAtlas: Mission Control, a mission-design game for the NASA Space Apps Challenge."><style>:root{color-scheme:dark}body{margin:0;font:14px system-ui;background:#000}img{max-width:100%}[hidden]{display:none!important}</style></head><body>' + body + '</body></html>';
writeFileSync('dist/artifact.html', artifact);
writeFileSync('dist/index.html', doc(hosted));
writeFileSync('dist/local.html', doc(web));
const mb = s => (Buffer.byteLength(s) / 1048576).toFixed(2) + ' MB';
console.log('artifact.html', mb(artifact), '| index.html', mb(hosted), '+', jsName, mb(jsRaw), '| local.html', mb(web), '(+ textures loaded on demand)');
