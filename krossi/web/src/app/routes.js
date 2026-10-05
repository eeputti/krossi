// routes.js — every URL of the app. Order matters only for overlapping patterns
// ('/pelaa/viestit/arkisto' must come before '/pelaa/viestit/:id').
//
// type: 'tab' (tab root) | 'page' (pushed, TopBar with back) | 'overlay' (Sheet over the
// previous page) | 'full' (no tab bar on phones) | 'public' (works without an account)

export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/pelaa/koti' },
  { id: 'pelit', label: 'Pelit', icon: 'calendar', path: '/pelaa/pelit' },
  { id: 'pelaajat', label: 'Pelaajat', icon: 'users', path: '/pelaa/pelaajat' },
  { id: 'viestit', label: 'Viestit', icon: 'chat', path: '/pelaa/viestit' },
  { id: 'profiili', label: 'Profiili', icon: 'user', path: '/pelaa/profiili' },
];

export const ROUTES = [
  { name: 'home', pattern: '/pelaa/koti', tab: 'koti', type: 'tab' },
  { name: 'games', pattern: '/pelaa/pelit', tab: 'pelit', type: 'tab' },
  { name: 'createGame', pattern: '/pelaa/uusi-peli', tab: 'pelit', type: 'overlay' },
  { name: 'game', pattern: '/pelaa/peli/:id', tab: 'pelit', type: 'page', public: true },
  { name: 'leagues', pattern: '/pelaa/liigat', tab: 'pelit', type: 'page' },
  { name: 'league', pattern: '/pelaa/liiga/:id', tab: 'pelit', type: 'page' },
  { name: 'players', pattern: '/pelaa/pelaajat', tab: 'pelaajat', type: 'tab' },
  { name: 'player', pattern: '/pelaa/pelaaja/:id', tab: 'pelaajat', type: 'page' },
  { name: 'partners', pattern: '/pelaa/pelikaverit', tab: 'pelaajat', type: 'page' },
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
