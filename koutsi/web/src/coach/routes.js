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
// On a phone the fourth place is "Lisää": a drawer with Harjoitepankki, Suunnittele, Ryhmät,
// Ilmoitukset, Tiedote and Profiili. It lights up on any of those pages (`ids`).
export const PHONE_TABS = [...TABS, { id: 'lisaa', label: 'Lisää', icon: 'more', ids: ['harjoitteet', 'lahetetyt', 'suunnittele', 'ryhmalista', 'profiili', 'viestit'] }];
// Viestit (when the database has it and the coach has the feature): a computer's side nav gets it after
// Pelaajat with the unread count, a phone reaches it from Lisää (CoachApp adds the tab).
export const MESSAGES_TAB = { id: 'viestit', label: 'Viestit', icon: 'chat', path: '/valmentaja/viestit' };
// A computer's side nav also has Suunnittele (themes for many weeks, absences ahead, the season)
// after Viikkohallinta and the Ryhmät list under Pelaajat. Phones get them later.
export const DESKTOP_TABS = [
  TABS[0], TABS[1],
  { id: 'suunnittele', label: 'Suunnittele', icon: 'grid', path: '/valmentaja/suunnittele' },
  TABS[2],
  { id: 'ryhmalista', label: 'Ryhmät', icon: 'users', path: '/valmentaja/ryhmalista' },
];

export const ROUTES = [
  { name: 'week', pattern: '/valmentaja/koti', tab: 'koti', type: 'tab' },
  { name: 'planner', pattern: '/valmentaja/teemat', tab: 'koti', type: 'overlay' },
  // "Uusi kausi": the next season as a copy of the current one (SeasonSheet)
  { name: 'season', pattern: '/valmentaja/kausi', tab: 'koti', type: 'overlay' },
  { name: 'groups', pattern: '/valmentaja/ryhmat', tab: 'ryhmat', type: 'tab' },
  { name: 'plan', pattern: '/valmentaja/suunnittele', tab: 'suunnittele', type: 'tab' },
  { name: 'groupList', pattern: '/valmentaja/ryhmalista', tab: 'ryhmalista', type: 'tab' },
  { name: 'group', pattern: '/valmentaja/ryhma/:id', tab: 'ryhmat', type: 'page' },
  { name: 'players', pattern: '/valmentaja/pelaajat', tab: 'pelaajat', type: 'tab' },
  { name: 'player', pattern: '/valmentaja/pelaaja/:id', tab: 'pelaajat', type: 'page' },
  { name: 'invites', pattern: '/valmentaja/kutsut', tab: 'pelaajat', type: 'overlay' },
  // Viestit: the conversations, and one conversation by the player's id (full screen on a phone).
  // A tab, so it lights its own side-nav link (a phone lights Lisää) instead of the previous tab.
  { name: 'messages', pattern: '/valmentaja/viestit', tab: 'viestit', type: 'tab' },
  { name: 'thread', pattern: '/valmentaja/viestit/:id', tab: 'viestit', type: 'full' },
  { name: 'session', pattern: '/valmentaja/treeni/:id', tab: 'ryhmat', type: 'page' },
  // a tab, not a page: on a phone it is the fourth tab, so it lights its own icon instead of
  // keeping the previous tab lit (on a desktop the side nav lights its Harjoitepankki link)
  { name: 'exercises', pattern: '/valmentaja/harjoitteet', tab: 'harjoitteet', type: 'tab' },
  { name: 'exercise', pattern: '/valmentaja/harjoite/:id', tab: 'harjoitteet', type: 'page' },
  // Lähetetyt: everything sent to players (?laji= a kind, ?ryhma= one group's); a phone reaches it from Lisää
  { name: 'sent', pattern: '/valmentaja/lahetetyt', tab: 'lahetetyt', type: 'tab' },
  { name: 'profile', pattern: '/valmentaja/profiili', tab: 'profiili', type: 'tab' },
  { name: 'profileEdit', pattern: '/valmentaja/profiili/muokkaa', tab: 'profiili', type: 'page' },
  { name: 'admin', pattern: '/valmentaja/yllapito', tab: 'profiili', type: 'page' },
  // earlier addresses: the old app's tabs, the home page's first name and the Kalenteri tab
  // (now part of Viikkohallinta; its ?vko= week is kept)
  { name: 'legacyCalendar', pattern: '/valmentaja/kalenteri', tab: 'ryhmat', type: 'tab', redirect: '/valmentaja/ryhmat', keepWeek: true },
  { name: 'legacyWeek', pattern: '/valmentaja/viikko', tab: 'koti', type: 'tab', redirect: '/valmentaja/koti' },
  { name: 'legacyStudents', pattern: '/valmentaja/oppilaat', tab: 'pelaajat', type: 'tab', redirect: '/valmentaja/pelaajat' },
  { name: 'legacyTrainings', pattern: '/valmentaja/treenit', tab: 'ryhmat', type: 'tab', redirect: '/valmentaja/ryhmat' },
];
