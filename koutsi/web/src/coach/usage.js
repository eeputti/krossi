// usage.js — which parts of the coach app get used. One event name per tap (never content or
// recipients), sent in the background; Ylläpito → Käyttö shows the tally (api.admin.usage).
import { api } from '../api/index.js';

/** Counts one tap. Never waits and never fails a tap. */
export function track(event) {
  api.account.trackEvent(event).catch(() => {});
}

// Ylläpito's labels, in the order the menu shows them. An event the list doesn't know is
// listed under "Muut" with its raw name.
export const USAGE_SECTIONS = [
  {
    title: 'Merkitse-valikko',
    events: [
      ['merkitse.avaa', 'Merkitse-nappi avattu'],
      ['merkitse.nyt', 'Käynnissä nyt -kortti'],
      ['merkitse.paattyi', 'Juuri päättyi -kortti'],
      ['merkitse.seuraava', 'Seuraava treeni -kortti'],
      ['merkitse.paiva', 'Päivän yhteenveto'],
      ['merkitse.viikko', 'Viikon yhteenveto'],
      ['merkitse.teemat', 'Viikon teemat'],
      ['merkitse.huomio', 'Huomio'],
      ['merkitse.laksy', 'Kotiläksy'],
      ['merkitse.video', 'Video'],
      ['merkitse.lasnaolo', 'Läsnäolo'],
      ['merkitse.paivakirja', 'Viikkopäiväkirja'],
    ],
  },
  {
    title: 'Pikanapit sivuilla',
    events: [
      ['treeni.huomio', 'Treeni → Huomio'],
      ['treeni.laksy', 'Treeni → Kotiläksy'],
      ['treeni.video', 'Treeni → Video'],
      ['ryhma.huomio', 'Ryhmä → Huomio'],
      ['ryhma.laksy', 'Ryhmä → Kotiläksy'],
      ['ryhma.video', 'Ryhmä → Video'],
      ['pelaaja.huomio', 'Pelaaja → Huomio'],
      ['pelaaja.laksy', 'Pelaaja → Kotiläksy'],
      ['pelaaja.video', 'Pelaaja → Video'],
    ],
  },
  {
    title: 'Tallennettu',
    events: [
      ['tallennettu.huomio', 'Huomio lähetetty'],
      ['tallennettu.huomio-monelle', '…joista usealle pelaajalle'],
      ['tallennettu.laksy', 'Kotiläksy annettu'],
      ['tallennettu.laksy-monelle', '…joista usealle pelaajalle'],
      ['tallennettu.video', 'Video jaettu'],
      ['tallennettu.video-monelle', '…joista usealle pelaajalle'],
    ],
  },
];
