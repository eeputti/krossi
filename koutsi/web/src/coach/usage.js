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
      ['merkitse.valitse', 'Tämän päivän treeni valittu'],
      ['merkitse.ryhma', 'Valitun treenin ryhmä avattu'],
      ['merkitse.nyt', 'Käynnissä nyt -kortti (ennen 14.10.)'],
      ['merkitse.paattyi', 'Juuri päättyi -kortti (ennen 14.10.)'],
      ['merkitse.seuraava', 'Seuraava treeni -kortti (ennen 14.10.)'],
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
      ['koti.merkitse', 'Koti: aikajanan treeni → Merkitse'],
      ['ryhma.merkitse', 'Ryhmä: tämän päivän treeni → Merkitse'],
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
    title: 'Viikkohallinta',
    events: [
      ['viikko.treeni', 'Treeni avattu viikkonäkymästä'],
      ['viikko.lasnaolo', 'Treeni → Läsnäolo'],
      ['viikko.huomio', 'Treeni → Huomio'],
      ['viikko.laksy', 'Treeni → Kotiläksy'],
      ['viikko.video', 'Treeni → Video'],
      ['viikko.lisaa', 'Plus-nappi avattu'],
      ['viikko.lisaa-ryhma', 'Lisää ryhmä'],
      ['viikko.lisaa-treeni', 'Lisää treeni'],
      ['viikko.lisaa-tapahtuma', 'Lisää tapahtuma'],
      ['viikko.lisaa-teema', 'Lisää teema'],
      ['viikko.lisaa-monta', 'Monta ryhmää ja pelaajaa kerralla'],
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
