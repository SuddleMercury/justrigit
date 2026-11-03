// Bundles everything into ONE self-contained HTML file (dist/justrigit.html).
import { build } from 'esbuild';
import fs from 'fs';

const res = await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true, minify: true, format: 'iife', target: 'es2020', write: false,
  legalComments: 'none',
});
const js = res.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const tpl = fs.readFileSync('src/index.template.html', 'utf8');
const [a, b] = tpl.split('/*__APP__*/');
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/justrigit.html', a + js + b);
console.log('dist/justrigit.html', (fs.statSync('dist/justrigit.html').size / 1024).toFixed(0) + ' KB');
