// routes.js — every URL of the player app. The tab addresses are the old app's
// (/pelaaja/koti, /ryhma, /treenit, /harjoitteet, /kehitys, /profiili), so links in old
// notifications and bookmarks keep working.

export const CANON = '/pelaaja';
export const HOME = '/pelaaja/koti';

export const TABS = [
  { id: 'koti', label: 'Koti', icon: 'home', path: '/pelaaja/koti' },
  { id: 'kehitys', label: 'Kehitys', icon: 'flame', path: '/pelaaja/kehitys' },
  { id: 'treenit', label: 'Treenit', icon: 'calendar', path: '/pelaaja/treenit' },
  { id: 'ryhma', label: 'Ryhmä', icon: 'users', path: '/pelaaja/ryhma' },
  { id: 'profiili', label: 'Profiili', icon: 'user', path: '/pelaaja/profiili' },
];

export const ROUTES = [
  { name: 'home', pattern: '/pelaaja/koti', tab: 'koti', type: 'tab' },
  { name: 'progress', pattern: '/pelaaja/kehitys', tab: 'kehitys', type: 'tab' },
  { name: 'trainings', pattern: '/pelaaja/treenit', tab: 'treenit', type: 'tab' },
  { name: 'group', pattern: '/pelaaja/ryhma', tab: 'ryhma', type: 'tab' },
  { name: 'exercises', pattern: '/pelaaja/harjoitteet', tab: 'kehitys', type: 'page' },
  { name: 'profile', pattern: '/pelaaja/profiili', tab: 'profiili', type: 'tab' },
];
