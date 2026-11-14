// One-off helper: set/remove i18n keys in en/pt/es at once, keeping the three dictionaries identical in keys.
// Usage: node scripts/i18n-patch.mjs <patch.json>   where patch = { set: { key: [en, pt, es] }, del: [key] }
import fs from 'fs';
const patch = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const files = ['en', 'pt', 'es'].map(l => `src/i18n/${l}.ts`);
const esc = s => s.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
files.forEach((f, li) => {
  let src = fs.readFileSync(f, 'utf8');
  const re = k => new RegExp(`'${k.replace(/\./g, '\\.')}':\\s*'(?:[^'\\\\]|\\\\.)*',?[ \\t]*`, 'g');
  for (const k of patch.del ?? []) { if (!re(k).test(src)) console.warn(f, 'missing (del)', k); src = src.replace(re(k), ''); }
  const add = [];
  for (const [k, vals] of Object.entries(patch.set ?? {})) {
    const line = `'${k}': '${esc(vals[li])}',`;
    if (re(k).test(src)) src = src.replace(re(k), line + ' '); else add.push('  ' + line);
  }
  if (add.length) src = src.replace(/\n};\s*$/, '\n' + add.join('\n') + '\n};\n');
  src = src.replace(/^[ \t]+$/gm, '').replace(/\n{2,}(?=\s*')/g, '\n');
  fs.writeFileSync(f, src);
});
