// build.mjs — bundles the renewed Krossi Koutsi (coach + player apps and their demos).
//
//   npm run build:koutsi                 one-off production build into koutsi/web/dist/
//                                        (+ koutsi-uusi/drills.json, the drill library)
//   node koutsi/web/build.mjs --watch    rebuild on change (used by dev.mjs)
//
// Real ES-module bundles like krossi/web: React, supabase-js and tus-js-client come from npm
// (pinned by package-lock), nothing is loaded from a CDN at runtime. The old Koutsi (root
// build.mjs, lib/koutsi-*) is not touched by this build at all.
//
// dist/ mirrors the published layout: the four HTML shells at the top level and everything
// else under koutsi-uusi/. scripts/build-cloudflare.mjs copies the tree as is.

import { context, build } from 'esbuild';
import { readFile, writeFile, mkdir, rm, readdir, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { usageWords } from '../../scripts/usage-words.mjs';

const here = dirname(fileURLToPath(import.meta.url));
// KOUTSI_OUT lets parallel tools (scripts/snap.mjs) build into their own folder.
const outDir = process.env.KOUTSI_OUT || join(here, 'dist');
const assetDir = join(outDir, 'koutsi-uusi');
const watch = process.argv.includes('--watch');

const shared = {
  bundle: true,
  minify: !watch,
  sourcemap: watch ? 'inline' : false,
  format: 'iife',
  // The old Koutsi built for Safari 14; keep the same floor so no pilot phone is left out.
  target: ['es2019', 'safari14'],
  jsx: 'automatic',
  loader: { '.js': 'jsx', '.svg': 'text' },
  legalComments: 'none',
  define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
  logLevel: 'warning',
};

const PAGES = [
  {
    entry: 'src/valmentaja.jsx', out: 'valmentaja', shell: 'koutsi-uusi-valmentaja.html', manifest: 'valmentaja',
    title: 'Valmentaja — Krossi Koutsi', boot: 'Ladataan Koutsia',
    description: 'Krossi Koutsi valmentajille: viikon teemat, ryhmät, treenit ja pelaajien kehitys yhdessä paikassa.',
  },
  {
    entry: 'src/pelaaja.jsx', out: 'pelaaja', shell: 'koutsi-uusi-pelaaja.html', manifest: 'pelaaja',
    title: 'Pelaaja — Krossi Koutsi', boot: 'Ladataan Koutsia',
    description: 'Krossi Koutsi pelaajille: ryhmäsi viikon teema, treenit ja oma tenniskehityksesi.',
  },
  {
    entry: 'src/valmentaja-demo.jsx', out: 'valmentaja-demo', shell: 'koutsi-uusi-valmentaja-demo.html', manifest: null,
    title: 'Kokeile Koutsia — valmentajan demo', boot: 'Ladataan demoa', demo: true,
    description: 'Kokeile Krossi Koutsia ilman tiliä: viikon teemat, ryhmät ja läsnäolot valmentajan silmin.',
  },
  {
    entry: 'src/pelaaja-demo.jsx', out: 'pelaaja-demo', shell: 'koutsi-uusi-pelaaja-demo.html', manifest: null,
    title: 'Kokeile Koutsia — pelaajan demo', boot: 'Ladataan demoa', demo: true,
    description: 'Kokeile Krossi Koutsia ilman tiliä: näe viikon teema, treenit ja kehityksesi pelaajan silmin.',
  },
];

// Every area keeps its own stylesheet next to the shared ones; they are concatenated in this
// order into one koutsi.css so later files can rely on the tokens defined earlier.
const CSS_ORDER = ['tokens', 'base', 'ui', 'shell', 'koutsi'];

async function buildCss() {
  const dir = join(here, 'src/styles');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.css'));
  const ordered = [
    ...CSS_ORDER.map((n) => `${n}.css`).filter((f) => files.includes(f)),
    ...files.filter((f) => !CSS_ORDER.includes(f.replace(/\.css$/, ''))).sort(),
  ];
  const parts = await Promise.all(ordered.map(async (f) => `/* ${f} */\n${await readFile(join(dir, f), 'utf8')}`));
  const result = await build({
    stdin: { contents: parts.join('\n'), loader: 'css', resolveDir: dir },
    write: false, minify: !watch, target: ['safari14', 'chrome100'], logLevel: 'warning',
  });
  await writeFile(join(assetDir, 'koutsi.css'), result.outputFiles[0].text);
}

const escapeHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

async function writeShells() {
  const template = await readFile(join(here, 'shell.html'), 'utf8');
  for (const page of PAGES) {
    const html = template
      .replaceAll('{{TITLE}}', escapeHtml(page.title))
      .replaceAll('{{DESCRIPTION}}', escapeHtml(page.description))
      .replaceAll('{{BOOT}}', escapeHtml(page.boot))
      .replaceAll('{{SCRIPT}}', `/koutsi-uusi/${page.out}.js`)
      .replaceAll('{{ROBOTS}}', page.demo ? '<meta name="robots" content="noindex" />' : '<meta name="robots" content="noindex" />')
      // the demos store nothing and track nothing, like the old demo pages: no consent banner
      .replaceAll('{{COOKIE}}', page.demo ? '' : '  <script src="/lib/cookie-consent.js" defer></script>\n')
      .replaceAll('{{MANIFEST}}', page.manifest ? `<link rel="manifest" href="/koutsi-uusi/${page.manifest}.webmanifest" />` : '');
    await writeFile(join(outDir, page.shell), html);
  }
  // One manifest per app so an installed app opens where it belongs, not on the marketing page.
  for (const [name, label, start] of [['valmentaja', 'Koutsi', '/valmentaja'], ['pelaaja', 'Koutsi', '/pelaaja']]) {
    const manifest = {
      name: 'Krossi Koutsi', short_name: label, lang: 'fi', start_url: start, scope: '/', display: 'standalone',
      background_color: '#FFFFFF', theme_color: '#121212',
      icons: [
        { src: '/assets/krossi-icon.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: '/assets/krossi-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
    await writeFile(join(assetDir, `${name}.webmanifest`), `${JSON.stringify(manifest, null, 2)}\n`);
  }
}

if (!watch) await rm(outDir, { recursive: true, force: true });
await mkdir(assetDir, { recursive: true });

// The app's own wording: the only text the anonymous usage tracker sends as a tap label
// (lib/koutsi-usage.js, scripts/usage-words.mjs). Demo code and its seed data stay out — their
// made-up names are not UI words. The demos don't track at all, so they get none. The drill
// library's texts (domain/drills/<topic>.js) stay out too: no button says them, and they would
// only make the list longer.
const sources = (await readdir(join(here, 'src'), { recursive: true }))
  .filter((f) => /\.jsx?$/.test(f) && !f.startsWith('api/demo/') && !/-demo\.jsx$/.test(f)
    && !/^domain\/drills\/(?!index\.js$|court\.js$)/.test(f))
  .map((f) => join(here, 'src', f));
const USAGE_WORDS = await usageWords(sources);

// Krossi's drill library (src/domain/drills/library.js) is served as koutsi-uusi/drills.json and
// loaded when the drill bank first needs it, so it isn't part of the app bundles. The data is
// bundled fresh each time (no module cache) so watch mode picks up edits.
async function writeDrills() {
  const out = await build({
    entryPoints: [join(here, 'src/domain/drills/library.js')], bundle: true, write: false,
    format: 'esm', platform: 'neutral', logLevel: 'warning',
  });
  const { LIBRARY } = await import(`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString('base64')}`);
  await writeFile(join(assetDir, 'drills.json'), JSON.stringify(LIBRARY));
  return LIBRARY.length;
}
const DRILL_COUNT = await writeDrills();

const options = (page) => ({
  ...shared,
  define: {
    ...shared.define,
    __KOUTSI_USAGE_WORDS__: JSON.stringify(page.demo ? '' : USAGE_WORDS),
    __KOUTSI_DRILL_COUNT__: String(DRILL_COUNT),
  },
  entryPoints: [join(here, page.entry)],
  outfile: join(assetDir, `${page.out}.js`),
});

if (watch) {
  const ctxs = await Promise.all(PAGES.map((p) => context(options(p))));
  await Promise.all(ctxs.map((c) => c.watch()));
  const { watch: fsWatch } = await import('node:fs');
  let timer = null;
  const rebuildStatic = () => { clearTimeout(timer); timer = setTimeout(() => Promise.all([buildCss(), writeShells()]).catch(console.error), 60); };
  fsWatch(join(here, 'src/styles'), rebuildStatic);
  fsWatch(join(here, 'shell.html'), rebuildStatic);
  let drillTimer = null;
  fsWatch(join(here, 'src/domain/drills'), () => { clearTimeout(drillTimer); drillTimer = setTimeout(() => writeDrills().catch(console.error), 120); });
  await Promise.all([buildCss(), writeShells()]);
  console.log('koutsi/web: watching for changes…');
} else {
  for (const page of PAGES) await build(options(page));
  await Promise.all([buildCss(), writeShells()]);
  for (const f of [...PAGES.map((p) => `${p.out}.js`), 'koutsi.css', 'drills.json']) {
    console.log(`${join(assetDir, f).replace(`${process.cwd()}/`, '')}  ${((await stat(join(assetDir, f))).size / 1024).toFixed(1)} kB`);
  }
}
