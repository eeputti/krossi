// routes.js — every URL of the coach app. type: 'tab' | 'page' | 'overlay' (Sheet over the
// previous page) | 'full'. Earlier addresses (the old app's /valmentaja/oppilaat, /treenit …, and
// /valmentaja/viikko from before the home page was called Koti) redirect to their new homes
// (see CoachApp's LegacyRedirect).

export const CANON = '/valmentaja';
export const HOME = '/valmentaja/koti';

// Four tabs around the big "Merkitse" button in the middle of the phone tab bar. Profiili is
// the avatar on Koti (phone) and the card at the bottom of the side nav (desktop).
export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/valmentaja/koti' },
  { id: 'ryhmat', label: 'Ryhmät', icon: 'users', path: '/valmentaja/ryhmat' },
  { id: 'pelaajat', label: 'Pelaajat', icon: 'user', path: '/valmentaja/pelaajat' },
  { id: 'kalenteri', label: 'Kalenteri', icon: 'calendar', path: '/valmentaja/kalenteri' },
];

export const ROUTES = [
  { name: 'week', pattern: '/valmentaja/koti', tab: 'koti', type: 'tab' },
  { name: 'planner', pattern: '/valmentaja/teemat', tab: 'koti', type: 'overlay' },
  { name: 'groups', pattern: '/valmentaja/ryhmat', tab: 'ryhmat', type: 'tab' },
  { name: 'group', pattern: '/valmentaja/ryhma/:id', tab: 'ryhmat', type: 'page' },
  { name: 'players', pattern: '/valmentaja/pelaajat', tab: 'pelaajat', type: 'tab' },
  { name: 'player', pattern: '/valmentaja/pelaaja/:id', tab: 'pelaajat', type: 'page' },
  { name: 'invites', pattern: '/valmentaja/kutsut', tab: 'pelaajat', type: 'overlay' },
  { name: 'calendar', pattern: '/valmentaja/kalenteri', tab: 'kalenteri', type: 'tab' },
  { name: 'session', pattern: '/valmentaja/treeni/:id', tab: 'kalenteri', type: 'page' },
  { name: 'exercises', pattern: '/valmentaja/harjoitteet', tab: 'profiili', type: 'page' },
  { name: 'exercise', pattern: '/valmentaja/harjoite/:id', tab: 'profiili', type: 'page' },
  { name: 'profile', pattern: '/valmentaja/profiili', tab: 'profiili', type: 'tab' },
  { name: 'admin', pattern: '/valmentaja/yllapito', tab: 'profiili', type: 'page' },
  // earlier addresses: the old app's tabs, and the home page's first name
  { name: 'legacyWeek', pattern: '/valmentaja/viikko', tab: 'koti', type: 'tab', redirect: '/valmentaja/koti' },
  { name: 'legacyStudents', pattern: '/valmentaja/oppilaat', tab: 'pelaajat', type: 'tab', redirect: '/valmentaja/pelaajat' },
  { name: 'legacyTrainings', pattern: '/valmentaja/treenit', tab: 'kalenteri', type: 'tab', redirect: '/valmentaja/kalenteri' },
];
