// routes.js — every URL of the player app. The tab addresses are the old app's
// (/pelaaja/koti, /ryhma, /treenit, /harjoitteet, /kehitys, /profiili), so links in old
// notifications and bookmarks keep working.
//
// The phone tab bar: Koti · Viikko · [Merkitse] · Kehitys · Lisää, the same build as the coach's.
// "Lisää" is a drawer with Ryhmäsi, Harjoitteet ja videot, Ilmoitukset, Profiili and Anna
// palautetta; it lights up on any of those pages (`ids`). A computer has them in the side nav
// (Profiili is the card at its bottom).

export const CANON = '/pelaaja';
export const HOME = '/pelaaja/koti';

export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/pelaaja/koti' },
  { id: 'treenit', label: 'Viikko', icon: 'calendar', path: '/pelaaja/treenit' },
  { id: 'kehitys', label: 'Kehitys', icon: 'flame', path: '/pelaaja/kehitys' },
];
export const PHONE_TABS = [...TABS, { id: 'lisaa', label: 'Lisää', icon: 'more', ids: ['ryhma', 'harjoitteet', 'profiili', 'laskut'] }];

export const ROUTES = [
  { name: 'home', pattern: '/pelaaja/koti', tab: 'koti', type: 'tab' },
  { name: 'progress', pattern: '/pelaaja/kehitys', tab: 'kehitys', type: 'tab' },
  { name: 'trainings', pattern: '/pelaaja/treenit', tab: 'treenit', type: 'tab' },
  { name: 'group', pattern: '/pelaaja/ryhma', tab: 'ryhma', type: 'tab' },
  { name: 'exercises', pattern: '/pelaaja/harjoitteet', tab: 'harjoitteet', type: 'tab' },
  { name: 'profile', pattern: '/pelaaja/profiili', tab: 'profiili', type: 'tab' },
  { name: 'profileEdit', pattern: '/pelaaja/profiili/muokkaa', tab: 'profiili', type: 'page' },
  // Viestit: the conversations with one's coaches (Koti's chat icon, Lisää), one conversation full screen
  { name: 'messages', pattern: '/pelaaja/viestit', tab: 'koti', type: 'page' },
  { name: 'thread', pattern: '/pelaaja/viestit/:id', tab: 'koti', type: 'full' },
  // Laskut: the player's invoices (only when a coach has sent one); the notification opens one
  { name: 'invoices', pattern: '/pelaaja/laskut', tab: 'laskut', type: 'page' },
  { name: 'invoice', pattern: '/pelaaja/laskut/:id', tab: 'laskut', type: 'page' },
  // Vapaat ajat (the notice's link): straight to Viikko on the day of the soonest free time
  { name: 'openSlots', pattern: '/pelaaja/vapaat', tab: 'treenit', type: 'tab' },
];
