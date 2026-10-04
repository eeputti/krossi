// Cloudflare Worker for krossi.app, koutsi.krossi.app and demo.koutsi.krossi.app.
//
// Files in cloudflare-dist are served by Workers Static Assets before this code runs
// (wrangler.jsonc); the worker only sees "/", robots.txt, sitemap.xml and paths with no
// matching file, and maps those deep links to the right HTML shell.
//
// Koutsi hosts must route exactly as they did before the Krossi web rebuild:
// tests/cloudflare-routing.test.mjs compares every Koutsi path against a frozen copy of
// the previous worker (tests/fixtures/worker-before-krossi-web.js).

const KOUTSI_HOST = 'koutsi.krossi.app';
const DEMO_HOST = 'demo.koutsi.krossi.app';

// Same values as krossi/web/src/lib/constants.js (the publishable key is meant to be
// public). Copied rather than imported so a change in the web app's source tree can
// never break routing for the Koutsi hosts that share this worker.
const SUPABASE_URL = 'https://hhybjpgrvlbazbqiaaao.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_IKLRGbstMLfxKeXwBTavSA_UVYyMgTL';
const SHARE_META_TIMEOUT_MS = 1500;

// Indexable marketing/legal pages per host. Auth-gated app views (/pelaa,
// /valmentaja, /pelaaja), the Krossi demo and the interactive demo host are kept out
// of search results via robots.txt — they have no content for an anonymous crawler
// and would just be thin/duplicate results.
const SITEMAPS = {
  'krossi.app': ['https://krossi.app/'],
  [KOUTSI_HOST]: [
    `https://${KOUTSI_HOST}/`,
    `https://${KOUTSI_HOST}/tietosuoja`,
    `https://${KOUTSI_HOST}/kayttoehdot`,
  ],
};

const ROBOTS_DISALLOW = {
  'krossi.app': ['/pelaa', '/valmentaja', '/pelaaja', '/demo'],
  [KOUTSI_HOST]: ['/pelaa', '/valmentaja', '/pelaaja'],
};

function canonicalHost(hostname) {
  if (hostname === 'www.krossi.app') return 'krossi.app';
  return hostname;
}

function isKoutsiHost(hostname) {
  return hostname === KOUTSI_HOST || hostname === DEMO_HOST;
}

function buildRobots(hostname) {
  const host = canonicalHost(hostname);
  if (!Object.hasOwn(ROBOTS_DISALLOW, host)) return 'User-agent: *\nDisallow: /\n';
  return [
    'User-agent: *',
    ...ROBOTS_DISALLOW[host].map((path) => `Disallow: ${path}`),
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

// `base` itself or up to `maxDepth` path segments below it, with an optional trailing slash.
function matchesPath(pathname, base, maxDepth) {
  const escaped = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}(?:/[^/]+){0,${maxDepth}}/?$`).test(pathname);
}

// Unchanged from the pre-rebuild worker, including the historical fallthrough where
// /pelaa (one segment at most) on a Koutsi host opens the Krossi app shell.
function resolveKoutsiAssetPath(hostname, pathname) {
  if (hostname === DEMO_HOST) {
    if (pathname === '/') return '/koutsi-demo.html';
    if (matchesPath(pathname, '/valmentaja', 1)) return '/koutsi-valmentaja-demo.html';
    if (matchesPath(pathname, '/pelaaja', 1)) return '/koutsi-pelaaja-demo.html';
  } else {
    if (pathname === '/') return '/koutsi.html';
    if (matchesPath(pathname, '/valmentaja', 1)) return '/koutsi-valmentaja.html';
    if (matchesPath(pathname, '/pelaaja', 1)) return '/koutsi-pelaaja.html';
    if (pathname === '/tietosuoja' || pathname === '/tietosuoja/') return '/koutsi-tietosuoja.html';
    if (pathname === '/kayttoehdot' || pathname === '/kayttoehdot/') return '/koutsi-kayttoehdot.html';
  }
  if (matchesPath(pathname, '/pelaa', 1)) return '/app.html';
  return null;
}

// krossi.app, www.krossi.app and preview hosts. App routes go at most two segments below
// /pelaa (/pelaa/asetukset/estetyt, /pelaa/viestit/<id>); three leaves headroom without
// turning arbitrarily deep junk URLs into app pages.
function resolveKrossiAssetPath(pathname) {
  if (pathname === '/') return '/index.html';
  if (matchesPath(pathname, '/pelaa', 3)) return '/app.html';
  if (matchesPath(pathname, '/demo', 3)) return '/krossi-demo.html';
  return null;
}

export function resolveAssetPath(input) {
  const url = input instanceof URL ? input : new URL(input.url || input);
  const { hostname, pathname } = url;
  return isKoutsiHost(hostname)
    ? resolveKoutsiAssetPath(hostname, pathname)
    : resolveKrossiAssetPath(pathname);
}

function rewriteRequest(request, pathname) {
  const url = new URL(request.url);
  url.pathname = pathname;
  return new Request(url, request);
}

// ── Open Graph cards for shared links ────────────────────────────────────────
// WhatsApp, iMessage, Messenger etc. don't run JavaScript, so a shared game or invite
// link would otherwise always preview as the generic app page.

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const GAME_SHARE_PATH = new RegExp(`^/pelaa/peli/(${UUID})/?$`, 'i');
const INVITE_SHARE_PATH = /^\/pelaa\/kutsu\/([A-Za-z0-9]{4,16})\/?$/;

const MATCH_TYPE_LABELS = { kaksinpeli: 'Kaksinpeli', nelinpeli: 'Nelinpeli', pallottelu: 'Pallottelu' };
const LOCATION_TYPE_LABELS = { 'sisätennis': 'Sisäkenttä', 'ulkotennis': 'Ulkokenttä' };

const helsinkiDateParts = new Intl.DateTimeFormat('fi-FI', {
  timeZone: 'Europe/Helsinki',
  weekday: 'short',
  day: 'numeric',
  month: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hourCycle: 'h23',
});

export function shareTargetFor(pathname) {
  const game = GAME_SHARE_PATH.exec(pathname);
  if (game) return { kind: 'game', id: game[1].toLowerCase() };
  const invite = INVITE_SHARE_PATH.exec(pathname);
  if (invite) return { kind: 'invite', code: invite[1].toUpperCase() };
  return null;
}

// "pe 3.10. klo 18" or "pe 3.10. klo 18.30" in Finnish time, whatever the edge's clock says.
export function formatShareTime(iso) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) return null;
  const parts = helsinkiDateParts.formatToParts(date);
  const part = (type) => parts.find((p) => p.type === type)?.value ?? '';
  const minute = part('minute');
  const time = `${Number(part('hour'))}${minute && minute !== '00' ? `.${minute}` : ''}`;
  return `${part('weekday')} ${part('day')}.${part('month')}. klo ${time}`;
}

function firstName(name) {
  return (typeof name === 'string' ? name.trim().split(/\s+/)[0] : '') || 'Pelaaja';
}

function placeLabel(preview) {
  const location = typeof preview.location === 'string' ? preview.location.trim() : '';
  const base = location && location !== 'Avoin' ? location : LOCATION_TYPE_LABELS[preview.location_type] ?? '';
  const city = typeof preview.city === 'string' ? preview.city.trim() : '';
  if (!base) return city;
  return city && !base.includes(city) ? `${base}, ${city}` : base;
}

function spotsLabel(spotsLeft) {
  if (spotsLeft <= 0) return 'Peli on täynnä';
  return spotsLeft === 1 ? '1 paikka vapaana' : `${spotsLeft} paikkaa vapaana`;
}

// preview = krossi_public_challenge_preview() result (snake_case jsonb).
export function gameShareMeta(preview) {
  const creator = firstName(preview.creator_name);
  const spotsLeft = Math.max(0, Number(preview.spots_left) || 0);
  const eventTitle = typeof preview.title === 'string' ? preview.title.trim() : '';

  let headline;
  if (preview.kind === 'event') headline = eventTitle || 'Tennistapahtuma';
  else if (spotsLeft === 0) headline = `${creator} on sopinut pelin`;
  else headline = `${creator} hakee ${spotsLeft > 1 ? 'pelikavereita' : 'pelikaveria'}`;

  const when = preview.scheduled_at ? formatShareTime(preview.scheduled_at) : null;
  const facts = [MATCH_TYPE_LABELS[preview.match_type] ?? 'Tennis', placeLabel(preview), spotsLabel(spotsLeft)].filter(Boolean);
  return {
    title: when ? `${headline} — ${when}` : headline,
    description: `${facts.join(' · ')}. ${spotsLeft > 0 ? 'Liity Krossissa.' : 'Katso Krossissa.'}`,
  };
}

// invite = krossi_resolve_invite() result.
export function inviteShareMeta(invite) {
  return {
    title: `${firstName(invite.inviter_name)} kutsuu sinut Krossiin`,
    description: 'Löydä pelikavereita tennikseen ja sovi pelit helposti.',
  };
}

async function callPublicRpc(fetchImpl, name, args) {
  const response = await fetchImpl(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(args),
    signal: AbortSignal.timeout(SHARE_META_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`${name} responded ${response.status}`);
  return response.json();
}

// Resolves to { title, description } or null. Never rejects: a slow or missing backend
// (timeout, RPC not deployed yet, game cancelled) just means the generic page is served.
export async function loadShareMeta(target, fetchImpl = fetch) {
  try {
    if (target.kind === 'game') {
      const preview = await callPublicRpc(fetchImpl, 'krossi_public_challenge_preview', { challenge_id_input: target.id });
      return preview && typeof preview === 'object' ? gameShareMeta(preview) : null;
    }
    const invite = await callPublicRpc(fetchImpl, 'krossi_resolve_invite', { code_input: target.code });
    return invite && typeof invite === 'object' ? inviteShareMeta(invite) : null;
  } catch (error) {
    console.warn('share meta unavailable:', error?.message ?? error);
    return null;
  }
}

// Rewrites <title> and the description/Open Graph tags of an HTML response.
// HTMLRewriter escapes both inner content and attribute values.
export function injectShareMeta(response, meta, Rewriter = globalThis.HTMLRewriter) {
  if (!Rewriter) return response;
  const setContent = (value) => ({ element(el) { el.setAttribute('content', value); } });
  const rewritten = new Rewriter()
    .on('title', { element(el) { el.setInnerContent(meta.title); } })
    .on('meta[name="description"]', setContent(meta.description))
    .on('meta[property="og:title"]', setContent(meta.title))
    .on('meta[property="og:description"]', setContent(meta.description))
    .on('meta[name="twitter:title"]', setContent(meta.title))
    .on('meta[name="twitter:description"]', setContent(meta.description))
    .transform(response);

  // The ETag still describes the untouched app.html, not this page.
  const headers = new Headers(rewritten.headers);
  headers.delete('etag');
  return new Response(rewritten.body, { status: rewritten.status, statusText: rewritten.statusText, headers });
}

function isHtml(response) {
  return (response.headers.get('content-type') || '').startsWith('text/html');
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
    const shareTarget = assetPath === '/app.html' && request.method === 'GET' && !isKoutsiHost(hostname)
      ? shareTargetFor(pathname)
      : null;
    // Started before the asset fetch so the two run in parallel.
    const shareMeta = shareTarget ? loadShareMeta(shareTarget) : null;

    const response = await env.ASSETS.fetch(assetPath ? rewriteRequest(request, assetPath) : request);
    if (!shareMeta || response.status !== 200 || !isHtml(response)) return response;

    const meta = await shareMeta;
    return meta ? injectShareMeta(response, meta) : response;
  },
};
