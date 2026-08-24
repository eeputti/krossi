const KOUTSI_HOST = 'koutsi.krossi.app';
const DEMO_HOST = 'demo.koutsi.krossi.app';

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

  if (pathname === '/pelaa' || pathname === '/pelaa/') return '/app.html';
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
    const assetPath = resolveAssetPath(request);
    return env.ASSETS.fetch(assetPath ? rewriteRequest(request, assetPath) : request);
  },
};
