// routes.js — every URL of the coach app. type: 'tab' | 'page' | 'overlay' (Sheet over the
// previous page) | 'full'. The old app's tab addresses (/valmentaja/oppilaat, /treenit …) still
// work: they redirect to their new homes (see CoachApp's LegacyRedirect).

export const CANON = '/valmentaja';
export const HOME = '/valmentaja/viikko';

export const TABS = [
  { id: 'viikko', label: 'Viikko', icon: 'home', path: '/valmentaja/viikko' },
  { id: 'ryhmat', label: 'Ryhmät', icon: 'users', path: '/valmentaja/ryhmat' },
  { id: 'pelaajat', label: 'Pelaajat', icon: 'user', path: '/valmentaja/pelaajat' },
  { id: 'kalenteri', label: 'Kalenteri', icon: 'calendar', path: '/valmentaja/kalenteri' },
  { id: 'profiili', label: 'Profiili', icon: 'settings', path: '/valmentaja/profiili' },
];

export const ROUTES = [
  { name: 'week', pattern: '/valmentaja/viikko', tab: 'viikko', type: 'tab' },
  { name: 'planner', pattern: '/valmentaja/teemat', tab: 'viikko', type: 'overlay' },
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
  // the old app's tab addresses
  { name: 'legacyStudents', pattern: '/valmentaja/oppilaat', tab: 'pelaajat', type: 'tab', redirect: '/valmentaja/pelaajat' },
  { name: 'legacyTrainings', pattern: '/valmentaja/treenit', tab: 'kalenteri', type: 'tab', redirect: '/valmentaja/kalenteri' },
];
