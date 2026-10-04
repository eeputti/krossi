// build.mjs — bundles the Krossi web app (krossi.app/pelaa) and its demo (krossi.app/demo).
//
//   npm run build:krossi            one-off production build into krossi/web/dist/
//   node krossi/web/build.mjs --watch   rebuild on change (used by dev.mjs)
//
// Unlike the Koutsi pages (root build.mjs, classic global scripts), this is a real ES-module
// bundle: React and supabase-js come from npm in production mode, so the browser no longer
// downloads Babel and transpiles JSX on every page load.

import { context, build } from 'esbuild';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// KROSSI_OUT lets parallel tools (scripts/snap.mjs) build into their own folder.
const outDir = process.env.KROSSI_OUT || join(here, 'dist');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'iife',
  target: ['es2020', 'safari15'],
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.svg': 'text' },
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'warning',
};

const entries = [
  { in: join(here, 'src/main.jsx'), out: 'app' },
  { in: join(here, 'src/demo.jsx'), out: 'demo' },
];

// Every screen area keeps its own stylesheet next to the shared ones; they're concatenated
// in this order into one app.css so later files can rely on the tokens defined earlier.
const CSS_ORDER = ['tokens', 'base', 'ui', 'shell'];

async function buildCss() {
  const { readdir } = await import('node:fs/promises');
  const dir = join(here, 'src/styles');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.css'));
  const ordered = [
    ...CSS_ORDER.map((n) => `${n}.css`).filter((f) => files.includes(f)),
    ...files.filter((f) => !CSS_ORDER.includes(f.replace(/\.css$/, ''))).sort(),
  ];
  const parts = await Promise.all(ordered.map(async (f) => `/* ${f} */\n${await readFile(join(dir, f), 'utf8')}`));
  const result = await build({
    stdin: { contents: parts.join('\n'), loader: 'css', resolveDir: dir },
    write: false, minify: !watch, target: ['safari15', 'chrome100'], logLevel: 'warning',
  });
  await writeFile(join(outDir, 'app.css'), result.outputFiles[0].text);
}

async function copyShells() {
  for (const [src, dest] of [['app.html', 'app.html'], ['demo.html', 'krossi-demo.html'], ['manifest.webmanifest', 'krossi.webmanifest']]) {
    await writeFile(join(outDir, dest), await readFile(join(here, src)));
  }
  const { cp } = await import('node:fs/promises');
  await cp(join(here, 'static'), join(outDir, 'static'), { recursive: true });
}

if (!watch) await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

if (watch) {
  const ctxs = await Promise.all(entries.map((e) => context({ ...shared, entryPoints: [e.in], outfile: join(outDir, `${e.out}.js`) })));
  await Promise.all(ctxs.map((c) => c.watch()));
  const { watch: fsWatch } = await import('node:fs');
  let timer = null;
  const rebuildStatic = () => { clearTimeout(timer); timer = setTimeout(() => Promise.all([buildCss(), copyShells()]).catch(console.error), 60); };
  fsWatch(join(here, 'src/styles'), rebuildStatic);
  for (const f of ['app.html', 'demo.html']) fsWatch(join(here, f), rebuildStatic);
  await Promise.all([buildCss(), copyShells()]);
  console.log('krossi/web: watching for changes…');
} else {
  for (const e of entries) {
    await build({ ...shared, entryPoints: [e.in], outfile: join(outDir, `${e.out}.js`) });
  }
  await Promise.all([buildCss(), copyShells()]);
  const { stat } = await import('node:fs/promises');
  for (const f of ['app.js', 'demo.js', 'app.css']) {
    console.log(`${join(outDir, f).replace(`${process.cwd()}/`, '')}  ${((await stat(join(outDir, f))).size / 1024).toFixed(1)} kB`);
  }
}
