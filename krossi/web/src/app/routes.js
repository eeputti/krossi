// routes.js — every URL of the app. Order matters only for overlapping patterns
// ('/pelaa/viestit/arkisto' must come before '/pelaa/viestit/:id').
//
// type: 'tab' (tab root) | 'page' (pushed, TopBar with back) | 'overlay' (Sheet over the
// previous page) | 'full' (no tab bar on phones) | 'public' (works without an account)
// | 'site' (the booking site krossi.app/varaa: its own page outside the app's menus, see SiteShell)

// The app does two things — book a court and find somebody to play with. On phones the tab bar is
// Koti · Peliseura · Viestit · Profiili and the court is booked on its own page (krossi.app/varaa, or the
// small "Varaa kenttä" links on Koti and Peliseura); the desktop side nav keeps Varaa as an item of its own.
export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/pelaa/koti' },
  { id: 'peliseura', label: 'Peliseura', icon: 'users', path: '/pelaa/pelaajat' },
  { id: 'varaa', label: 'Varaa', icon: 'court', path: '/pelaa/varaa', desktopOnly: true },
  { id: 'viestit', label: 'Viestit', icon: 'chat', path: '/pelaa/viestit' },
  { id: 'profiili', label: 'Profiili', icon: 'user', path: '/pelaa/profiili' },
];

export const PHONE_TABS = TABS.filter((t) => !t.desktopOnly);

export const ROUTES = [
  { name: 'home', pattern: '/pelaa/koti', tab: 'koti', type: 'tab' },
  { name: 'games', pattern: '/pelaa/pelit', tab: 'peliseura', type: 'tab' },
  { name: 'createGame', pattern: '/pelaa/uusi-peli', tab: 'peliseura', type: 'overlay' },
  { name: 'game', pattern: '/pelaa/peli/:id', tab: 'peliseura', type: 'page', public: true },
  { name: 'leagues', pattern: '/pelaa/liigat', tab: 'profiili', type: 'page' },
  { name: 'league', pattern: '/pelaa/liiga/:id', tab: 'profiili', type: 'page', public: true },
  { name: 'booking', pattern: '/pelaa/varaa', tab: 'varaa', type: 'tab' }, // a tab on desktop; on phones a page reached from Koti and Peliseura
  { name: 'bookingVenue', pattern: '/pelaa/varaa/:venue', tab: 'varaa', type: 'page' },
  { name: 'hall', pattern: '/pelaa/halli/:venue', tab: 'varaa', type: 'page' },
  { name: 'splitPay', pattern: '/pelaa/maksa/:token', tab: 'varaa', type: 'page', public: true },
  // A booking made without an account: its own page (the link in the guest's email), in the booking site's look.
  { name: 'guestBooking', pattern: '/pelaa/varaus/:token', tab: null, type: 'site', public: true },
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
  // The booking site: outside /pelaa on purpose, so the demo keeps the same URL (krossi.app/varaa).
  { name: 'bookingSite', pattern: '/varaa', tab: null, type: 'site' },
  { name: 'bookingSiteVenue', pattern: '/varaa/:venue', tab: null, type: 'site' },
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
