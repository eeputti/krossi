// tourSteps.js — what the demo tour shows, in order. One step = one place in the app.
//
//   path     canonical page the step opens (a function may look it up, e.g. the hall's slug)
//   target   what is lit up: a CSS selector, or a list of them (their union); { sel, max } takes
//            the first `max` matches of a selector (e.g. the first three time rows)
//   radius   corner radius of the lit-up hole (999 = round, for icon buttons)
//   area     the small label on the card · icon · title · text (text may depend on { desktop })
//
// Booking, hall and payment steps speak plainly (no jokes), like the screens they point at.
import { api } from '../../api/index.js';

async function hallPath(view) {
  const [venue] = await api.booking.listVenues();
  if (!venue) return '/pelaa/varaa';
  return `/pelaa/halli/${encodeURIComponent(venue.slug)}${view ? `?nakyma=${view}` : ''}`;
}

export const TOUR_TOPICS = ['Kentän varaus', 'Omat varaukset', 'Henkilökunnan näkymä', 'Laskutus', 'Peliseura'];

export const STEPS = [
  {
    id: 'omat',
    path: '/pelaa/koti',
    target: '[data-tour="tab-koti"]',
    radius: 16,
    area: 'Koti',
    icon: 'home',
    title: 'Kaikki sinun yhdessä paikassa',
    text: ({ desktop }) => `Kodissa odottavat pelikutsut ja pelipyynnöt sekä tulevat pelisi ja kenttävuorosi aikajärjestyksessä.${desktop ? '' : ' Kentän varaat Tulevat-otsikon vierestä: Varaa kenttä.'}`,
  },
  {
    id: 'varaa',
    path: '/pelaa/varaa',
    target: '[data-tour="bk-controls"]',
    area: 'Varaa kenttä',
    icon: 'court',
    title: 'Valitse päivä ja kesto',
    text: 'Kentän varaus on oma sivunsa: valitse päivä ja vuoron pituus. Asiakkaat pääsevät samalle sivulle suoraan osoitteesta krossi.app/varaa – siellä ei ole muuta kuin varaus.',
  },
  {
    id: 'ajat',
    path: '/pelaa/varaa',
    target: { sel: '[data-tour="bk-times"] > *', max: 3 },
    area: 'Varaa kenttä',
    icon: 'clock',
    title: 'Napauta vapaata aikaa',
    text: 'Rivillä näkyy aloitusaika, vapaat kentät ja hinta. Valitse kenttä kartalta ja maksa heti. Maksun voi jakaa kavereiden kesken linkillä, ja varauksen jälkeen voi etsiä vuoroon pelikaverin.',
  },
  {
    id: 'omat-nappi',
    path: '/pelaa/varaa',
    target: '[data-tour="bk-mine"]',
    radius: 999,
    area: 'Omat varaukset',
    icon: 'calendar',
    title: 'Omat varauksesi löytyvät tästä',
    text: 'Kalenterikuvake yläkulmassa avaa omat varaukset. Numero kertoo, montako vuoroa sinulla on tulossa.',
  },
  {
    id: 'omat-varaukset',
    path: '/pelaa/omat-varaukset',
    target: '[data-tour="mb-upcoming"]',
    area: 'Omat varaukset',
    icon: 'check-circle',
    title: 'Vuorot, kausivuorot ja kortit',
    text: 'Napauta vuoroa: lisää se kalenteriin, etsi siihen pelikaveri, jaa maksu tai peru. Alempana ovat kausivuorosi laskuineen, saldo sekä sarja- ja lahjakortit.',
  },
  {
    id: 'halli-nappi',
    path: '/pelaa/varaa',
    target: '[data-tour="bk-hall"]',
    radius: 999,
    area: 'Henkilökunta',
    icon: 'grid',
    title: 'Henkilökunnan näkymä',
    text: 'Tämä painike näkyy vain kenttien henkilökunnalle. Demossa olet henkilökuntaa, joten pääset katsomaan, miltä vastaanotossa näyttää.',
  },
  {
    id: 'aikajana',
    path: () => hallPath(),
    target: '[data-tour="hall-board"]',
    area: 'Henkilökunta',
    icon: 'court',
    title: 'Päivän varaukset aikajanalla',
    text: 'Kentät riveinä, kellonajat sarakkeina ja varaajien nimet näkyvissä. Napauta vapaata kohtaa estääksesi ajan omaan käyttöön, esimerkiksi seuran sarjalle tai valmennukselle, tai varausta perua ja hyvittää se.',
  },
  {
    id: 'laskutus',
    path: () => hallPath('laskutus'),
    target: ['.bhall-views', '.bhall-view-head'],
    area: 'Henkilökunta',
    icon: 'euro',
    title: 'Kausivuorot, laskutus ja kortit',
    text: 'Laskutuksessa ovat kausivuorojen laskut ja kuukausiveloitukset, ja erääntyneet veloitetaan yhdellä napilla. Kausivuoroissa hyväksyt hakemukset, Korteissa näet myydyt sarja- ja lahjakortit. Asetukset ovat rattaan takana.',
  },
  {
    id: 'peliseura',
    path: '/pelaa/pelaajat',
    target: '.ps-head',
    area: 'Peliseura',
    icon: 'users',
    title: 'Löydä peliseuraa',
    text: 'Peliseurassa näet kaupunkisi pelaajat sopivimmat ensin, avoimet pelit ja kartan. Ylhäältä kerrot muille, että haet seuraa. Pyydä pelaamaan, sopikaa Viesteissä ja varaa kenttä suoraan chatista.',
  },
  {
    id: 'profiili',
    path: '/pelaa/profiili',
    target: '[data-tour="tour-restart"]',
    area: 'Profiili',
    icon: 'play',
    title: 'Opastus löytyy aina täältä',
    text: 'Profiilista voit katsoa opastuksen uudelleen milloin vain. Kokeile nyt rauhassa: demossa mikään ei tallennu.',
  },
];
