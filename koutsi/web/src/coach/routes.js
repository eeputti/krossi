// routes.js — every URL of the coach app. type: 'tab' | 'page' | 'overlay' (Sheet over the
// previous page) | 'full'. Earlier addresses (the old app's /valmentaja/oppilaat, /treenit …, and
// /valmentaja/viikko from before the home page was called Koti) redirect to their new homes
// (see CoachApp's LegacyRedirect).

export const CANON = '/valmentaja';
export const HOME = '/valmentaja/koti';

// Koti, Viikkohallinta (the week calendar: groups, sessions, events — it replaced both the
// Ryhmät board and the Kalenteri tab; still at /valmentaja/ryhmat, the address both apps share)
// and Pelaajat. Profiili is the avatar on Koti (phone) and the card at the bottom of the side nav
// (desktop). The phone tab bar puts the big "Merkitse" button in the middle and Harjoitepankki
// fourth, so the button stays centred (on a desktop it is a side-nav link under the tabs).
export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/valmentaja/koti' },
  { id: 'ryhmat', label: 'Viikkohallinta', icon: 'calendar', path: '/valmentaja/ryhmat' },
  { id: 'pelaajat', label: 'Pelaajat', icon: 'user', path: '/valmentaja/pelaajat' },
];
export const PHONE_TABS = [...TABS, { id: 'harjoitteet', label: 'Harjoitteet', icon: 'list', path: '/valmentaja/harjoitteet' }];

export const ROUTES = [
  { name: 'week', pattern: '/valmentaja/koti', tab: 'koti', type: 'tab' },
  { name: 'planner', pattern: '/valmentaja/teemat', tab: 'koti', type: 'overlay' },
  { name: 'groups', pattern: '/valmentaja/ryhmat', tab: 'ryhmat', type: 'tab' },
  { name: 'group', pattern: '/valmentaja/ryhma/:id', tab: 'ryhmat', type: 'page' },
  { name: 'players', pattern: '/valmentaja/pelaajat', tab: 'pelaajat', type: 'tab' },
  { name: 'player', pattern: '/valmentaja/pelaaja/:id', tab: 'pelaajat', type: 'page' },
  { name: 'invites', pattern: '/valmentaja/kutsut', tab: 'pelaajat', type: 'overlay' },
  { name: 'session', pattern: '/valmentaja/treeni/:id', tab: 'ryhmat', type: 'page' },
  { name: 'exercises', pattern: '/valmentaja/harjoitteet', tab: 'harjoitteet', type: 'page' },
  { name: 'exercise', pattern: '/valmentaja/harjoite/:id', tab: 'harjoitteet', type: 'page' },
  { name: 'profile', pattern: '/valmentaja/profiili', tab: 'profiili', type: 'tab' },
  { name: 'admin', pattern: '/valmentaja/yllapito', tab: 'profiili', type: 'page' },
  // earlier addresses: the old app's tabs, the home page's first name and the Kalenteri tab
  // (now part of Viikkohallinta; its ?vko= week is kept)
  { name: 'legacyCalendar', pattern: '/valmentaja/kalenteri', tab: 'ryhmat', type: 'tab', redirect: '/valmentaja/ryhmat', keepWeek: true },
  { name: 'legacyWeek', pattern: '/valmentaja/viikko', tab: 'koti', type: 'tab', redirect: '/valmentaja/koti' },
  { name: 'legacyStudents', pattern: '/valmentaja/oppilaat', tab: 'pelaajat', type: 'tab', redirect: '/valmentaja/pelaajat' },
  { name: 'legacyTrainings', pattern: '/valmentaja/treenit', tab: 'ryhmat', type: 'tab', redirect: '/valmentaja/ryhmat' },
];
