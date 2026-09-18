const KOUTSI_HOST = 'koutsi.krossi.app';
const DEMO_HOST = 'demo.koutsi.krossi.app';

// Indexable marketing/legal pages per host. Auth-gated app views (/pelaa,
// /valmentaja, /pelaaja) and the interactive demo host are kept out of
// search results via robots.txt — they have no content for an anonymous
// crawler and would just be thin/duplicate results.
const SITEMAPS = {
  'krossi.app': ['https://krossi.app/'],
  [KOUTSI_HOST]: [
    `https://${KOUTSI_HOST}/`,
    `https://${KOUTSI_HOST}/tietosuoja`,
    `https://${KOUTSI_HOST}/kayttoehdot`,
  ],
};

function canonicalHost(hostname) {
  if (hostname === 'www.krossi.app') return 'krossi.app';
  return hostname;
}

function buildRobots(hostname) {
  const host = canonicalHost(hostname);
  if (!(host in SITEMAPS)) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    'Disallow: /pelaa',
    'Disallow: /valmentaja',
    'Disallow: /pelaaja',
    '',
    `Sitemap: https://${host}/sitemap.xml`,
    '',
  ].join('\n');
}

function buildSitemap(hostname) {
  const urls = SITEMAPS[canonicalHost(hostname)] ?? [];
  const entries = urls.map((loc) => `  <url><loc>${loc}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function matchesSingleSegment(pathname, base) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:/[^/]+)?/?$`).test(pathname);
}

export function resolveAssetPath(input) {
  const url = input instanceof URL ? input : new URL(input.url || input);
  const { hostname, pathname } = url;

  if (hostname === DEMO_HOST) {
    if (pathname === '/') return '/koutsi-demo.html';
    if (matchesSingleSegment(pathname, '/valmentaja')) return '/koutsi-valmentaja-demo.html';
    if (matchesSingleSegment(pathname, '/pelaaja')) return '/koutsi-pelaaja-demo.html';
  }

  if (hostname === KOUTSI_HOST) {
    if (pathname === '/') return '/koutsi.html';
    if (matchesSingleSegment(pathname, '/valmentaja')) return '/koutsi-valmentaja.html';
    if (matchesSingleSegment(pathname, '/pelaaja')) return '/koutsi-pelaaja.html';
    if (pathname === '/tietosuoja' || pathname === '/tietosuoja/') return '/koutsi-tietosuoja.html';
    if (pathname === '/kayttoehdot' || pathname === '/kayttoehdot/') return '/koutsi-kayttoehdot.html';
  }

  if (matchesSingleSegment(pathname, '/pelaa')) return '/app.html';
  if (pathname === '/') return '/index.html';

  return null;
}

function rewriteRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

export default {
  async fetch(request, env) {
    const { hostname, pathname } = new URL(request.url);

    if (pathname === '/robots.txt') {
      return new Response(buildRobots(hostname), { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (pathname === '/sitemap.xml') {
      return new Response(buildSitemap(hostname), { headers: { 'content-type': 'application/xml; charset=utf-8' } });
    }

    const assetPath = resolveAssetPath(request);
    return env.ASSETS.fetch(assetPath ? rewriteRequest(request, assetPath) : request);
  },
};
