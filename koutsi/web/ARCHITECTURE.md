# Krossi Koutsi web (uusi) — arkkitehtuuri ja speksi

Tämä on uudistetun Koutsin rakennusohje. Uusi sovellus rakennetaan **vanhan rinnalle**:
vanha Koutsi (`lib/koutsi-*`, `koutsi*.html`, juuren `build.mjs`, `dist/koutsi-*`) jatkaa
sellaisenaan, eikä tämä kansio muuta sitä. Krossin pelaajasovellukseen (`krossi/web`) ei
kosketa. Kaikki kolme käyttävät samaa Supabase-projektia ja samaa Cloudflare-workeria.

## 1. Tavoite

Koutsi = valmentajan viikko ja pelaajan kehitys. Pilotin data (10/2026) näyttää, että käytössä
ovat ryhmät, kalenteri ja viikkoteemat; videot, kotiläksyt, fiilikset ja ottelut ovat nollassa,
ja 49/80 pelaajalla ei ole tunnusta. Siksi:

- **Valmentaja** avaa sovelluksen viikkostartteriksi: etusivu on *Koti* (tämä viikko: teemojen kattavuus,
  tämän päivän ja huomisen treenit, läsnäolo yhdellä napautuksella, liittymättömät pelaajat,
  kalenterin loppuminen). Teemat asetetaan yhdellä suunnittelijalla monelle ryhmälle.
- **Pelaaja** näkee heti viikon teeman ja seuraavan treenin, voi ilmoittaa "En pääse" ja kertoa
  treenin jälkeen fiiliksen; Kehitys näyttää teemapolun ja aikajanan.
- Sama ilme ja tuntuma kuin uudessa Krossissa: alapalkki puhelimessa, sivupalkki työpöydällä,
  alhaalta nousevat paneelit, jokaisella näkymällä oma osoite, skeletonit, tyhjät tilat, pienet
  animaatiot.

## 2. Rinnakkaiskäyttö (opt-in)

Uusi sovellus palvellaan **samoista osoitteista** kuin vanha (`/valmentaja/*`, `/pelaaja/*`),
mutta vain selaimelle, jolla on eväste `koutsi_uusi=1`:

- `…/valmentaja?uusi=1` (tai `/pelaaja?uusi=1`) → worker asettaa evästeen ja palauttaa uuden kuoren.
- `…?uusi=0` → eväste `koutsi_uusi=0` (vuodeksi): vanha kuori kuten ennen, mutta vanha sovellus näyttää
  "Siirry uuteen" -napin — vain niille, jotka ovat jo käyttäneet uutta (eväste on olemassa).
- Ilman evästettä worker toimii **täsmälleen kuten ennen** (testattu jäädytettyä workeria vasten).
- Sama origin → sama Supabase-istunto (oletus-storageKey), samat OAuth-paluuosoitteet,
  samat kutsulinkit (`/pelaaja?koodi=…&oppilas=…`) ja ilmoitusten `link_path`-arvot.
- Toimii myös demossa: `demo.koutsi.krossi.app/valmentaja?uusi=1`.
- Uudessa sovelluksessa Profiili → "Palaa vanhaan Koutsiin" (`?uusi=0`).
- Ylläpitäjän roolinvaihto: Beta-palkissa "Valmentaja | Pelaaja" (`shared/roleSwitch.jsx`, vanhassa
  `KoutsiRoleSwitch`). Vain `koutsi_admins`-tunnukselle, ei demoissa eikä "toimi valmentajana" -tilassa.
  Ensimmäinen vaihto pelaajaksi liittää tunnuksen omiin ryhmiin (RPC `koutsi_admin_join_own_groups`),
  sen jälkeen napautus vain avaa toisen sovelluksen. Kehityksessä `?esikatsele=rooli`.

## 3. Kansiorakenne

```
koutsi/web/
  ARCHITECTURE.md    tämä tiedosto
  build.mjs          esbuild: 4 bundlea (valmentaja, pelaaja, + demot), koutsi.css, kuoret, manifestit
  dev.mjs            kehityspalvelin, portti 4500 (launch config "koutsi-web"); demo /demo/valmentaja
  shell.html         HTML-kuoren pohja (build täyttää otsikon ja skriptin)
  src/
    valmentaja.jsx / pelaaja.jsx                tuotanto: Supabase-backend
    valmentaja-demo.jsx / pelaaja-demo.jsx      demo: muistinvarainen backend
    api/
      contract.js    datakerroksen rajapinta (domainit ja funktiot) — testit vaativat että
                     molemmat backendit toteuttavat täsmälleen sen
      index.js       backend-rekisteri: `import { api } from '../api/index.js'`
      errors.js      ApiError + suomenkieliset virheviestit (vanhan Koutsin fraasikirja)
      supabase/      oikea toteutus; kyselyt ja kirjoitukset siirretty vanhasta koutsi-data.js:stä
                     samoina (samat taulut, samat RPC:t, samat rivit)
      demo/          muistinvarainen toteutus + seed (nollautuu joka latauksella)
    domain/
      core.js        vanhan koutsi-data.js:n puhtaat apufunktiot sellaisinaan (viikot, teemat,
                     aikataulut, valitsimet, läsnäolo-/kuukausiyhteenvedot, kutsutekstit)
      timeline.js    Kehitys-aikajanan rakentaja
      ...            uudet puhtaat apurit (viikkonäkymä, aktiivisuus, putki)
    app/             router, hooks, session (auth + portit), AppShell, DataProvider, mount
    shared/          molempien roolien yhteiset näkymäpalat (aikajana, läsnäolo, ilmoitukset, auth-näkymät)
    coach/           valmentajan reitit ja näkymät
    player/          pelaajan reitit ja näkymät
    ui/              design system (kopio krossi/web/src/ui:sta + Koutsin vahvistusjono)
    styles/          tokens/base/ui/shell (Krossista) + koutsi.css + alueittaiset tiedostot
  test/              node:test — pariteetti vanhaan, sopimus, demo, supabase-kirjoitukset, reititys
  scripts/preview-prod.mjs  tuotantobuildi oikean workerin läpi (opt-in-kytkimen kokeilu)
```

UI-kit ja tyylit on **kopioitu** krossi/webistä, ei jaettu: Krossin muutos ei saa koskaan
muuttaa Koutsia huomaamatta (ja päinvastoin).

## 4. Datakerros

- Ruudut puhuvat vain `api`:lle. Ei supabase-js:ää näkymissä.
- Valmentaja ja pelaaja lataavat yhden **tilannekuvan** (`api.coach.load`, `api.player.load`),
  sama muoto kuin vanhassa (`{ coach, coaches, students, groups, trainings, exercises,
  clubEvents }`), joten core.js:n valitsimet toimivat sellaisinaan. Erot vanhaan:
  - jokaisen alikyselyn virhe heitetään (vanha muutti epäonnistuneen kyselyn tyhjäksi listaksi,
    jolloin esim. poissaolot näkyivät "kaikki paikalla");
  - treenit haetaan sivuttain (yli 1000 rivin raja ei katkaise hiljaa) ja `.in()`-listat pilkotaan;
  - päiväkirja, läksyt, fiilikset ja videot uusin ensin.
- `DataProvider` pitää tilannekuvan, `reload()` (vain uusin lataus voittaa), `run(fn, viesti)`
  (kirjoitus → toast → reload). Oma kirjoitus ei aiheuta toista latausta realtime-kaiusta.
- Realtime: yksi kanava, debounce. Lisäksi `useResync` (välilehti takaisin näkyviin / verkko palaa).
- Optimistinen päivitys läsnäoloon (napautus näkyy heti).
- Moniaskeliset kirjoitukset (ryhmän luonti, aikataulun muutos) ovat samat kuin vanhassa.
- `groups.extendSeries` käyttää RPC:tä `koutsi_extend_group_series`, joka lisää treenit ilman
  rivikohtaista ilmoitustulvaa. Jos RPC:tä ei vielä ole (migraatio ajamatta), käyttäjä saa
  selkeän viestin eikä mitään kirjoiteta.
- Käyttötilastot (Ylläpito → Käyttö): sama seurantaskripti kuin vanhassa Koutsissa
  (`lib/koutsi-usage.js`, käynnistys `src/app/usageTracking.js`, vain tuotantobundleissa).
  Sivut, painallukset ja virheet ilman käyttäjää; painikkeen teksti lähtee vain, jos jokainen
  sana on sovelluksen omaa sanastoa (`scripts/usage-words.mjs`, build.mjs:n `__KOUTSI_USAGE_WORDS__`).
  Luku `api.admin.usageOverview` → `koutsi_admin_usage()`, muotoilu `lib/koutsi-usage-report.js`
  (yhteinen vanhan ylläpidon `lib/koutsi-admin-usage.jsx`:n kanssa). Rivit poistuvat 180 pv jälkeen.

## 5. Reitit

**Valmentaja** (`/valmentaja`, välilehdet: Koti · Viikkohallinta · Pelaajat; puhelimessa lisäksi Harjoitteet ja keskellä Merkitse)

| Polku | Nimi | Tyyppi |
|---|---|---|
| `/valmentaja/koti` | week | tab (etusivu, ent. `/valmentaja/viikko` → uudelleenohjaus) |
| `/valmentaja/teemat` (`?vko=2026-42`) | planner | overlay (Sheet) |
| `/valmentaja/ryhmat` (`?vko=2026-42`) | groups — Viikkohallinta: viikko aikaruudukkona (ryhmät, yksityistunnit, tapahtumat, puutteet), plus-nappi | tab |
| `/valmentaja/ryhma/:id` | group | page |
| `/valmentaja/pelaajat` | players | tab |
| `/valmentaja/pelaaja/:id` | player | page |
| `/valmentaja/kutsut` | invites | overlay |
| `/valmentaja/treeni/:id` | session | page |
| `/valmentaja/harjoitteet`, `/valmentaja/harjoite/:id` | exercises, exercise | page |
| `/valmentaja/profiili`, `/valmentaja/yllapito` | profile, admin | tab / page |
| `/valmentaja/oppilaat`, `/treenit`, `/kalenteri` | vanhat osoitteet | ohjaus uusiin (`/kalenteri?vko=` säilyttää viikon) |

**Pelaaja** (`/pelaaja`, välilehdet: Koti · Kehitys · Treenit · Ryhmä · Profiili)

| Polku | Nimi |
|---|---|
| `/pelaaja/koti` | home |
| `/pelaaja/kehitys` | progress |
| `/pelaaja/treenit` | trainings |
| `/pelaaja/ryhma` | group |
| `/pelaaja/harjoitteet` | exercises |
| `/pelaaja/profiili` | profile |

Vanhat osoitteet (`/pelaaja/koti` jne.) ovat samat; `link_path` `/pelaaja` → koti.

## 6. Portit (järjestys kuten vanhassa)

- **Valmentaja:** auth → salasanan palautus → pilottivahvistus → profiilivirhe → profiilin luonti
  → valmentajarivi → valmentaja-avain → ylläpitäjän "toimi valmentajana" -tarkistus palvelimella → sovellus.
- **Pelaaja:** auth → salasanan palautus → profiilivirhe → profiilin luonti → oppilasrivi →
  liittymiskoodi (kutsulinkin `?koodi`/`?oppilas` esitäytettynä, "oletko sinä?") → pilottivahvistus → sovellus.
- Kutsulinkki toisen käyttäjän laitteella → varoitusbanneri (InviteMismatch).

## 7. Pakko säilyttää (tarkistuslista)

Profiilin luonti kirjoittaa `hidden_from_feed: true` ja pelaajalle `is_discoverable: false`;
`tennis_preferences`-riviä ei koskaan luoda. Viikkoteema = yksi rivi per ryhmä per ISO-viikko,
"Jatka" ja oletusvalinnat ovat insert-only, korvaus vaatii vahvistuksen. Sarjan "poista tulevat"
ei koskaan koske menneisiin. Valmennussuhteen päättäminen on pehmeä (ended_at). Vain
lunastamattoman pelaajan voi poistaa (kirjoita nimi vahvistukseksi) tai yhdistää. Poissaolo on
vain "poissa", ei syytä (terveystietolinjaus). Piilotettu fiilis ei näy valmentajalle (RLS).
Ylläpitäjän "toimi valmentajana" tarkistetaan palvelimella joka latauksella. Tuplalähetyssuojat
lomakkeissa. Videot: yksityinen bucket, allekirjoitetut osoitteet, 50 Mt raja, TUS yli 6 MiB.
Tilin poisto: kirjoita nimi; JSON-vienti. Suomenkieliset virheet. Demo ei kirjoita mitään.

## 8. Design

Krossin tokenit (`styles/tokens.css`) sellaisinaan, samoin `base.css`, `ui.css`, `illustrations.css`,
`ui/illustrations.jsx` ja `ui/effects.js` (kopioi Krossista, kun ne muuttuvat). Ilme 2026-10-17: litteä,
valkoinen sivu, lähes musta tummille pinnoille ja lime ainoana korostuksena, `--muted` (#6A6A6A,
AA-kontrasti) tekstille; aktiivinen välilehti täytettynä ikonina. Ks. krossi/web/ARCHITECTURE.md §6. Ei inline-tyylejä muuhun kuin aidosti dynaamisiin arvoihin; luokat
prefiksoidaan alueella (`.week-`, `.group-`, `.player-`, `.cal-`, `.tl-`). Lataukselle aina
kolme tilaa (skeleton / ErrorState + Yritä uudelleen / data tai EmptyState). Ei `alert`/`confirm`:
`useToast`, `useConfirm`. Kieli: suomi, sinuttelu, lyhyesti.

## 9. QA ja julkaisu

- `npm run test:koutsi` — pariteetti vanhaan, sopimus, uudet toiminnot (treenin tila, "Miten meni?",
  kalenterin loppuminen, aikajanan sanamuodot).
- `npm run dev:koutsi` → http://localhost:4500/demo/valmentaja ja /demo/pelaaja (demo, ei tallenna mitään).
- `npm run build:cloudflare && node koutsi/web/scripts/preview-prod.mjs` → tuotantobuildi oikean workerin läpi:
  :8790 = koutsi.krossi.app, :8791 = demo.koutsi.krossi.app (kokeile `?uusi=1` / `?uusi=0`).
- `tests/cloudflare-routing.test.mjs` todistaa, että ilman evästettä jokainen Koutsi-osoite vastaa kuten ennen.
- QA vain demossa ja testeillä, ei tuotantodataa vasten.
- `npm run deploy:cloudflare` rakentaa ja julkaisee kaiken; uusi Koutsi on julki vain opt-in-evästeellä.

### Tietokanta (ajettu 2026-10-14 käyttäjän luvalla)

- `supabase/migrations/20261014074355_koutsi_extend_group_series.sql` — "Jatka kalenteria":
  `koutsi_extend_group_series()` lisää ryhmän viikkotreenit (myös lisäajat) halutulle ajalle,
  taukoviikot pois, ja lähettää pelaajalle yhden koosteilmoituksen treenikohtaisten sijaan.
  Samalla pelaaja ei enää saa ilmoitusta omasta kirjauksestaan.
- `supabase/migrations/20261014074420_koutsi_checkins_and_week_diary.sql` — valmentajan
  `koutsi_coach_week_notes` (viikkopäiväkirja) ja "Treenit ohi! Miten meni?": pg_cron 15 min välein →
  `koutsi_queue_session_checkins()` → nykyinen ilmoitusjono → koutsi-notify (oma 1–5-pohja,
  versio 20). Betan aikana vain `koutsi_beta_testers`-listan osoitteille.
  Linkit: `/pelaaja?uusi=1&fiilis=<treeni>&arvo=1–5`, `?toive=1`.
- Kun uusi Koutsi otetaan kaikille käyttöön: poista beta-ehto `koutsi_queue_session_checkins()`-funktiosta
  (tai lisää osoitteet listaan) — muuten muut eivät koskaan saa viestiä.
