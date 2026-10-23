// siteTourSteps.js — the booking site's quick tour (krossi.app/varaa): five steps on the booking page
// itself, no page changes. Same step shape as tourSteps.js (target · radius · area · icon · title ·
// text). Plain words, like the booking screens: what is where, nothing more.
//
// Demo only for now. The visitor starts as a guest, whose bar has only "Kirjaudu" (site-login): my
// bookings (bk-mine) and the staff's button (bk-hall) show once they sign in or make an account
// (the demo's visitor is the courts' staff then), so those steps light up "Kirjaudu" until then.

export const SITE_TOPICS = ['Kentän varaus', 'Omat varaukset', 'Hallin näkymä'];

export const SITE_STEPS = [
  {
    id: 'varaa',
    target: '[data-tour="bk-controls"]',
    area: 'Varaa kenttä',
    icon: 'calendar',
    title: 'Tästä varaat kentän',
    text: 'Valitse ensin päivä ja vuoron pituus. Niiden alla näkyvät päivän vapaat ajat.',
  },
  {
    id: 'ajat',
    target: { sel: '[data-tour="bk-times"] > *', max: 3 },
    area: 'Varaa kenttä',
    icon: 'clock',
    title: 'Napauta vapaata aikaa',
    text: 'Rivillä on aloitusaika, vapaiden kenttien määrä ja hinta. Valitse kenttä ja maksa – tilillä tai ilman tiliä.',
  },
  {
    id: 'omat',
    target: '[data-tour="bk-mine"], [data-tour="site-login"]',
    radius: 999,
    area: 'Omat varaukset',
    icon: 'check-circle',
    title: 'Omat varaukset näkyvät tilillä',
    text: 'Kirjautuneena tästä aukeavat tulevat vuorosi: lisää vuoro kalenteriin, jaa maksu tai peru. Ilman tiliä varannut saa varauksen linkin sähköpostiin.',
  },
  {
    id: 'halli',
    target: '[data-tour="bk-hall"], [data-tour="site-login"]',
    radius: 999,
    area: 'Henkilökunta',
    icon: 'grid',
    title: 'Hallin näkymä',
    text: 'Näkyy vain henkilökunnalle. Siitä aukeavat päivän varaukset aikajanalla: estä aikoja valmennukselle, peru varauksia ja hoida laskutus. Esittelyssä kirjautunut on henkilökuntaa, joten voit kokeilla.',
  },
  {
    id: 'opastus',
    target: '[data-tour="site-help"]',
    radius: 999,
    area: 'Opastus',
    icon: 'info',
    title: 'Kokeile itse',
    text: 'Kun vuoro on maksettu, voit etsiä siihen pelikaverin. Esittelyssä mitään ei veloiteta eikä tallenneta. Opastuksen saat uudelleen tästä.',
  },
];
