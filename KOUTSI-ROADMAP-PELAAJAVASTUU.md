# Koutsi-roadmap: pelaajalle enemmän vastuuta ja mahdollisuuksia

Rovaniemen koutsin kanssa 2.9.2026 käydyn palaverin pohjalta. Seuraava puhelu n. 1 kk
päähän (~2.10.2026). Tämä dokumentti pilkkoo palaverin ison kokonaisuuden erillisiin,
itsenäisesti toteutettaviin osiin — kukin osa on suunniteltu niin, että sen voi antaa
Claudelle omana promptina yhdessä sessiossa.

Pohjatiedot tarkistettu suoraan koodikannasta (`lib/koutsi-pelaaja-app.jsx`,
`lib/koutsi-valmentaja-app.jsx`, `lib/koutsi-data.js`) ja Supabase-skeemasta
(projekti `TENNISSOVELLUS`, hhybjpgrvlbazbqiaaao) 2.9.2026.

---

## Jo tehty — ei vaadi toimenpiteitä

**Ryhmän/treenin kesto vapaana minuuttimääränä.** Toteutettu samana päivänä
(migraatiot `20260902060000_add_group_and_training_duration.sql`,
`20260902060100_bulk_setup_generates_group_trainings.sql`,
`20260902060200_backfill_existing_group_trainings.sql`). `koutsi_groups` ja
`koutsi_trainings` saivat `duration_minutes`-sarakkeen (15 min välein, esim. 60/75/90),
ja ryhmän luonti generoi nyt automaattisesti vuoden verran viikoittaisia treenejä
kalenteriin. Tätä ei siis tarvitse enää pyytää uudelleen.

---

## Nykytila lyhyesti (mihin osat nojaavat)

- `koutsi_trainings`: coach_id, group_id, student_id, date, time, type (vapaa teksti,
  esim. "Ryhmätreeni"/"Yksityistunti"/"Ottelu"), duration_minutes, series_id. Ei vielä
  käsitettä "pelaajan itse lisäämä".
- `koutsi_match_notes`: vain opponent_name, date, note. Ei kestoa, tulosta, erien
  tulosta eikä kaksinpeli/nelinpeli-tietoa.
- `koutsi_exercises` (valmentajan drilli-/videokirjasto): tagit rajoitettu joukkoon
  syotto/liikkuminen/pistepeli/verkkopeli/tekniikka/lammittely — ei fysiikka-kategoriaa.
- `koutsi_videos`: yksi rivi per vastaanottaja-pelaaja, kohdennus on siis jo teknisesti
  mahdollista (moniriviinsertti), mutta UX ryhmäkohdennukselle kannattaa tarkistaa osa 6:ssa.
- `koutsi_coach_events`: coach_id, date, title, kind, end_date — valmentaja voi jo
  lisätä usean päivän tapahtumia (esim. turnauksia) kalenteriin, mutta vain valmentaja,
  ei pelaaja itse.
- Pelaajan "Treenit"-välilehdellä (`TrainingsView` / `PlayerCalendarGrid`,
  koutsi-pelaaja-app.jsx:605-) on **jo olemassa kuukausikalenteri** edellinen/seuraava-
  navigoinnilla ja päivän valinnalla, joka näyttää sen päivän treenit ja seuran
  tapahtumat. Tämä on hyvä pohja Strava-tyyliselle näkymälle — ei tarvitse rakentaa
  alusta, vaan laajentaa.

---

## Osa 1 — Pelaajan omat harjoitukset (omatoiminen, fysiikka, muu laji)

**Tavoite:** pelaaja voi itse kirjata kalenteriin harjoituksia, jotka eivät tule
seuran/valmentajan kautta — siirtää vastuuta kehittymisestä pelaajalle ilman että
valmentajalle syntyy lisätyötä.

**Tekninen toteutus:**
- `koutsi_trainings`: lisää `logged_by text check (logged_by in ('coach','player'))
  default 'coach'` ja `category text` (esim. `omatoiminen`, `fysiikka`, `muu_laji`,
  `ottelu` — ryhmä-/yksityistunnit erottuvat jo group_id:n ja nykyisen type-kentän
  kautta). Lisää `notes text` vapaalle kuvaukselle (esim. "Löin kaverin kanssa",
  "5 km juoksu").
- RLS: salli pelaajan insertoida/poistaa/muokata rivi jossa `student_id = auth.uid()`
  ja `logged_by = 'player'`; `coach_id` asetetaan pelaajan nykyiseksi valmentajaksi
  (jos on) jotta se näkyy valmentajan puolella, `group_id` null.
- UI (`koutsi-pelaaja-app.jsx`, `TrainingsView`): "+ Lisää" -nappi valitulle päivälle,
  lomake jossa tyyppi (Omatoiminen / Fysiikka / Muu laji / Ottelu — Ottelu ohjaa
  osan 2 lomakkeeseen), kesto minuutteina, vapaa kuvaus.

---

## Osa 2 — Ottelumuistiinpanojen laajennus

**Tavoite:** pelaaja kirjaa otteluista kattavammat tiedot, jotta oma ja valmentajan
näkemä kehityskaari näkyy paremmin.

**Tekninen toteutus:**
- `koutsi_match_notes`: lisää `duration_minutes integer`, `result text check (result
  in ('voitto','tappio'))`, `format text check (format in ('kaksinpeli','nelinpeli'))`,
  `score text` (esim. "6-4 6-3").
- UI: ottelumuistiinpanolomake (pelaajan puolella) laajennetaan näillä kentillä.
  Linkittyy osaan 1: kalenterin "Ottelu"-tyyppi avaa tämän lomakkeen.

---

## Osa 3 — Turnaukset ja tapahtumat pelaajan kalenteriin

**Tavoite:** pelaaja voi merkitä omat turnauksensa kalenteriin, ei vain valmentajan
kautta tulevat.

**Päätettävä ennen toteutusta:** käytetäänkö osan 1 `koutsi_trainings`-riviä
(`category='ottelu'` + monipäiväinen tuki) vai laajennetaanko `koutsi_coach_events`
sallimaan myös pelaajan luomat rivit (`coach_id` nullable, `student_id`-sarake).
Jälkimmäinen on todennäköisesti siistimpi, koska `end_date`-tuki on jo valmiina.

**Tekninen toteutus (jos coach_events-reitti):**
- `koutsi_coach_events`: `coach_id` nullable, lisää `student_id uuid`, RLS pelaajalle
  omiin riveihinsä.
- UI: sama "+ Lisää" -lomake (osa 1) tarjoaa myös "Turnaus"-vaihtoehdon, jolloin kysytään
  alku- ja loppupäivä.

---

## Osa 4 — Stravamainen kuukausiyhteenveto

**Tavoite:** pelaajan Treenit-näkymästä tulee kuukausikohtainen yhteenveto, josta näkee
kokonaiskuvan omasta tekemisestä (treenit, fysiikka, ottelut, muu liikunta).

**Riippuu osista:** 1, 2, 3.

**Tekninen toteutus:**
- Laajenna `PlayerCalendarGrid`/`TrainingsView` (koutsi-pelaaja-app.jsx): kuukauden
  yläpuolelle yhteenvetokortti — harjoitusten lkm kategorioittain, tunnit yhteensä,
  ottelut (voitot/tappiot). Valinnainen: pieni viikkopalkkikaavio kuten Stravassa.
- Kalenteriruudukkoon merkki/väri per kategoria (ryhmätreeni/omatoiminen/fysiikka/
  ottelu/muu laji), jotta kuukauden kuvio hahmottuu visuaalisesti.
- "+ Lisää" -nappi jokaisen päivän kohdalle (ei vain valitulle päivälle).

---

## Osa 5 — Valmentajan näkymä pelaajan etenemisestä

**Tavoite:** valmentaja näkee ilman lisätyötä, tekeekö pelaaja omatoimisia treenejä, ja
voi tunnistaa kehityksen esteitä (esim. "ei omatoimisia treenejä viikkoon").

**Riippuu osasta:** 1.

**Tekninen toteutus:**
- `koutsi-valmentaja-app.jsx`: pelaajakortille/-sivulle yhteenveto pelaajan omatoimisesta
  aktiivisuudesta viimeisen 7/30 päivän ajalta, ja hälytys jos omatoimisia merkintöjä ei
  ole tullut esim. 7 päivään.

---

## Osa 6 — Video-/linkkikirjaston kategoriat (fysiikka/tekniikka/drilli)

**Tavoite:** sovellus korvaa WhatsApp-ryhmät harjoitevideoiden/-linkkien jakelussa;
valmentaja kohdistaa materiaalin tietyille pelaajille tai ryhmille, kategorioituna.

**Tekninen toteutus:**
- `koutsi_exercises.tags`-rajoitukseen lisää `fysiikka` ja `drilli` (nykyinen:
  syotto/liikkuminen/pistepeli/verkkopeli/tekniikka/lammittely). Sama
  `koutsi_videos.tags`-rajoitukseen.
- Tarkista/paranna kohdennuksen UX: nyt tekninen malli tukee kohdennusta jo (yksi rivi
  per vastaanottaja), mutta lisää valmentajan puolelle helppo "koko ryhmä kerralla"
  -valinta jakaessa videota/linkkiä, jotta se aidosti korvaa WhatsApp-linkin jakamisen.

---

## Osa 7 — Pelaajan oma suoritushistoria

**Tavoite:** pelaaja näkee kootusti oman kehityksensä tenniksessä.

**Riippuu osasta:** 2.

**Tekninen toteutus:**
- Laajenna olemassa oleva `ProgressView`-välilehti (koutsi-pelaaja-app.jsx, tab id
  `progress`) ottelutilastoilla: voitto/tappio-suhde, viimeisimmät ottelut
  tuloksineen, kaksinpeli/nelinpeli-jako.

---

## Suositeltu toteutusjärjestys

1 → 2 → 4 (kk-yhteenveto nojaa 1:een ja 2:een) → 5 → 3 → 7 → 6 (6 on irrallinen, voi
tehdä milloin vain).
