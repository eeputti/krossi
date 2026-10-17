// routes.js — every URL of the app. Order matters only for overlapping patterns
// ('/pelaa/viestit/arkisto' must come before '/pelaa/viestit/:id').
//
// type: 'tab' (tab root) | 'page' (pushed, TopBar with back) | 'overlay' (Sheet over the
// previous page) | 'full' (no tab bar on phones) | 'public' (works without an account)

// The app does two things — book a court and find somebody to play with — so they are tabs of their
// own, next to Omat (what is mine and what waits on me) and Viestit.
export const TABS = [
  { id: 'koti', label: 'Omat', icon: 'calendar', path: '/pelaa/koti' },
  { id: 'varaa', label: 'Varaa', icon: 'court', path: '/pelaa/varaa' },
  { id: 'peliseura', label: 'Peliseura', icon: 'users', path: '/pelaa/pelaajat' },
  { id: 'viestit', label: 'Viestit', icon: 'chat', path: '/pelaa/viestit' },
  { id: 'profiili', label: 'Profiili', icon: 'user', path: '/pelaa/profiili' },
];

// The phone tab bar leaves Profiili out: it is the avatar on Omat there. The desktop side nav keeps all of TABS.
export const PHONE_TABS = TABS.filter((t) => t.id !== 'profiili');

export const ROUTES = [
  { name: 'home', pattern: '/pelaa/koti', tab: 'koti', type: 'tab' },
  { name: 'games', pattern: '/pelaa/pelit', tab: 'peliseura', type: 'tab' },
  { name: 'createGame', pattern: '/pelaa/uusi-peli', tab: 'peliseura', type: 'overlay' },
  { name: 'game', pattern: '/pelaa/peli/:id', tab: 'peliseura', type: 'page', public: true },
  { name: 'leagues', pattern: '/pelaa/liigat', tab: 'profiili', type: 'page' },
  { name: 'league', pattern: '/pelaa/liiga/:id', tab: 'profiili', type: 'page', public: true },
  { name: 'booking', pattern: '/pelaa/varaa', tab: 'varaa', type: 'tab' },
  { name: 'bookingVenue', pattern: '/pelaa/varaa/:venue', tab: 'varaa', type: 'page' },
  { name: 'hall', pattern: '/pelaa/halli/:venue', tab: 'varaa', type: 'page' },
  { name: 'splitPay', pattern: '/pelaa/maksa/:token', tab: 'varaa', type: 'page', public: true },
  { name: 'myBookings', pattern: '/pelaa/omat-varaukset', tab: 'varaa', type: 'page' },
  { name: 'invoice', pattern: '/pelaa/lasku/:id', tab: 'varaa', type: 'full' },
  { name: 'players', pattern: '/pelaa/pelaajat', tab: 'peliseura', type: 'tab' },
  { name: 'player', pattern: '/pelaa/pelaaja/:id', tab: 'peliseura', type: 'page' },
  { name: 'partners', pattern: '/pelaa/pelikaverit', tab: 'peliseura', type: 'page' },
  { name: 'inbox', pattern: '/pelaa/viestit', tab: 'viestit', type: 'tab' },
  { name: 'archive', pattern: '/pelaa/viestit/arkisto', tab: 'viestit', type: 'page' },
  { name: 'chat', pattern: '/pelaa/viestit/:id', tab: 'viestit', type: 'full' },
  { name: 'profile', pattern: '/pelaa/profiili', tab: 'profiili', type: 'tab' },
  { name: 'profileEdit', pattern: '/pelaa/profiili/muokkaa', tab: 'profiili', type: 'page' },
  { name: 'settings', pattern: '/pelaa/asetukset', tab: 'profiili', type: 'page' },
  { name: 'blocked', pattern: '/pelaa/asetukset/estetyt', tab: 'profiili', type: 'page' },
  { name: 'badges', pattern: '/pelaa/merkit', tab: 'profiili', type: 'page' },
  { name: 'recap', pattern: '/pelaa/kooste/:period', tab: 'profiili', type: 'full' },
  { name: 'invite', pattern: '/pelaa/kutsu/:code', tab: null, type: 'public', public: true },
  { name: 'admin', pattern: '/pelaa/yllapito', tab: 'profiili', type: 'page' },
];

const compiled = ROUTES.map((route) => {
  const keys = [];
  const re = new RegExp(`^${route.pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; })}/?$`);
  return { route, re, keys };
});

export function matchRoute(path) {
  for (const { route, re, keys } of compiled) {
    const m = re.exec(path);
    if (m) {
      const params = {};
      try {
        keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      } catch {
        return null; // malformed %-escape -> not found instead of a crash before React mounts
      }
      return { name: route.name, route, params };
    }
  }
  return null;
}

export function tabRoot(tabId) {
  return TABS.find((t) => t.id === tabId)?.path || '/pelaa/koti';
}
