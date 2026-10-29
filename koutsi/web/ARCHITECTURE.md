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

## 2. Rinnakkaiskäyttö (uusi on oletus 25.10.2026 alkaen)

Uusi sovellus palvellaan **samoista osoitteista** kuin vanha (`/valmentaja/*`, `/pelaaja/*`), ja
25.10.2026 alkaen se on **oletus** kaikille. Vanha aukeaa vain selaimelle, joka on valinnut sen:

- Ilman evästettä tai evästeellä `koutsi_uusi=1` → uusi kuori (enintään kolme tasoa syvälle).
- `…?uusi=0` ("Palaa vanhaan") → eväste `koutsi_uusi=0` (vuodeksi): vanha kuori kuten ennen, ja vanha
  sovellus näyttää "Siirry uuteen" -napin (`?uusi=1`, joka asettaa `koutsi_uusi=1`).
- Evästeellä `koutsi_uusi=0` worker vastaa **täsmälleen kuten vanha** (testattu jäädytettyä workeria
  vasten); sovellusten ulkopuoliset sivut (etusivu, tietosuoja, tiedostot) eivät koske kytkimeen.
- Sovellusosoitteiden vastaukset ovat `private, no-cache` + `Vary: Cookie`, koska sama osoite antaa
  kumman tahansa sovelluksen.
- Paluu "vanha oletuksena" -tilaan: julkaise Cloudflaressa vaihtoa edeltävä versio.
- Sama origin → sama Supabase-istunto (oletus-storageKey), samat OAuth-paluuosoitteet,
  samat kutsulinkit (`/pelaaja?koodi=…&oppilas=…`) ja ilmoitusten `link_path`-arvot.
- Sama pätee demoon (`demo.koutsi.krossi.app`).
- Uudessa sovelluksessa Profiili → "Palaa vanhaan Koutsiin" (`?uusi=0`).
- Beta-palkki "[BETA] Koutsilla uusi ilme! Palaa vanhaan →" (ei erotinpisteitä) näkyy kaikille uuden Koutsin käyttäjille.
  Ylläpitäjän Valmentaja | Pelaaja -vaihto poistettiin 17.10.2026 molemmista sovelluksista;
  RPC `koutsi_admin_join_own_groups` jäi tietokantaan, mutta sovellus ei kutsu sitä.

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
- Harjoitepankki = Krossin oma harjoitekirjasto (`src/domain/drills/`, ~200 harjoitetta, yksi
  tiedosto per aihe, `library.js` kokoaa) + valmentajan omat `koutsi_exercises`-rivit. Kirjasto
  ei ole tietokannassa: kaikki uuden Koutsin valmentajat ja pelaajat näkevät saman, eikä vanha
  sovellus muutu. build.mjs kirjoittaa sen tiedostoon `koutsi-uusi/drills.json` (~75 kt
  pakattuna), jonka `shared/drills/useLibrary.js` lataa vasta kun pankkia tai kotiläksyehdotuksia
  tarvitaan, joten sovelluksen avaus ei hidastu (`__KOUTSI_DRILL_COUNT__` = määrä tekstejä varten). `buildDrillList` yhdistää oman rivin kirjaston kaksoseen nimen perusteella (25
  esimerkkiharjoitetta, jotka jokaisella valmentajalla jo on, ja omiin tallennetut);
  koskematon esimerkkirivi lainaa kirjaston tiedot (`legacy` = rivin alkuperäiset arvot).
  "Tallenna omiin" kirjoittaa tavallisen rivin (`savedFields`), joten videot, muokkaus ja vanha
  sovellus toimivat kuten ennen. Kenttäkuvat: `domain/drills/court.js` (metrit, nimetyt pisteet)
  ja `shared/drills/art.jsx`; uuden harjoitteen muoto ja säännöt tarkistaa `test/drills.test.mjs`.
- Treenin runko (`domain/plan.js`, `coach/SessionPlan.jsx`, `shared/drills/plan.jsx`): valmentaja kokoaa
  treenin pankista neljään osaan (Lämmittely → Harjoitteet → Peli → Loppu), näkee minuutit treenin
  kestoa vasten ja voi siirtää, poistaa (Kumoa) ja vaihtaa kestoa; valitsin on `DrillBrowser`
  (`initial` = osan aihe + treenin ryhmän koko ja taso, yksityistunnilla 1 pelaaja). Runko tallennetaan
  JSONina treenirivin vapaatekstikenttään `koutsi_trainings.notes` (`api.trainings.setPlan`): kenttä on
  valmentajan treeneillä käyttämätön (vanha ja uusi sovellus näyttävät sen vain pelaajan omille
  kirjauksille), ryhmän pelaajat voivat jo lukea sen (RLS), päivitys ei laukaise ilmoitusta (vain
  insert/delete-triggerit), eikä migraatiota tarvita. Aiempi teksti säilyy (`teksti`) ja palaa, kun
  runko tyhjennetään. Pelaaja näkee rungon Kodin seuraavan treenin kortista ja Treenit-päivältä
  (`PlanSheet`, kenttäkuvat, napautus → harjoite). Vanha Koutsi ei näytä runkoa.
- Tavoite ja omat merkinnät (Kehitys): tavoitekortissa on kynä (koko kortti on nappi). Jokainen muutos
  kirjoittaa `koutsi_player_history`-rivin, joten vanha tavoite näkyy aikajanalla "Aiempi tavoite" -kohtana
  ja kortti kertoo, montako aiempaa on tallessa. Pelaaja voi lisätä Kehitykseen oman merkinnän (mitä tein,
  milloin, miten meni): taulu `koutsi_player_entries` (migraatio 20261021081153, ajettu 21.10.2026 käyttäjän luvalla), pelaaja
  kirjoittaa omiaan, jokainen linkitetty valmentaja (`koutsi_is_linked_coach`) lukee. Ilman taulua lataus
  palauttaa `entriesReady: false` ja Merkintä-nappi pysyy piilossa. Valmentajan pelaajasivun Kehitys alkaa
  pelaajan tavoitteella. Vanha Koutsi ei lue taulua.

- Pelaajan omat merkinnät (`domain/ownWeek.js`, `player/TrainingsScreen.jsx`, `player/weekSheets.jsx`):
  tavallinen `koutsi_trainings`-rivi (`logged_by = 'player'`), `type` pysyy vanhan sovelluksen kategoriana
  (Omatoiminen harjoitus / Fysiikka / Muu liikunta / Turnaus), ja tarkempi laji on `notes`-tekstin alussa
  ("Lenkki — 5 km", "Kuntosali", "Liikkuvuus", "Kotiläksy — …"), joten vanha sovellus ja valmentajan näkymät
  lukevat rivin kuten ennen. Merkintä on pelaajan oma: valmentajaa ei valita (rivin `coach_id` = joku
  pelaajan nykyisistä valmentajista, taulu vaatii sen), ja jokainen pelaajan valmentaja näkee sen
  (`loadCoachState` lukee myös muiden valmentajien alle kirjatut, RLS
  `koutsi_trainings_linked_coach_reads_player_logs`). Pelaaja voi muokata (`player.updateSelfTraining`) ja
  poistaa omansa. "Kotiläksy"-merkintä merkitsee läksyn samalla tehdyksi.

- Pelaajan Merkitse (`player/MerkitseSheet.jsx`, `domain/playerNow.js`): puhelimen alapalkin iso keskinappi
  (tietokoneella sivupalkin nappi). Ylimpänä juuri päättyneet treenit, yksi liu'utettava kortti per treeni
  (1–5 yhdellä napautuksella, "Kirjoita mitä opit", "Kaikista kerralla", "Ohita"), muuten seuraava treeni
  ("En pääse", runko). Sitten "Mitä teit?" -ruudut (avaavat lomakkeen laji valittuna) ja rivit Fiilis nyt ·
  Tavoitteet · Toive valmentajalle. Sama treenikortti on Kodin "Ajankohtaista"-osion ensimmäisenä.
  Fiilis kertoo treeninsä sarakkeella `koutsi_moods.training_id`; ilman saraketta (`moodSessionsReady: false`)
  kysytään vain viimeisintä treeniä kuten ennen. Tavoitteet-ikkunassa on kauden tavoitteen lisäksi
  "Mihin tähtäät?" (`koutsi_students.ambition`: harrastus/kehitys/kilpailu/huippu) ja pitkän ajan tavoite
  (`long_goal`, historia `koutsi_player_history.field = 'long_goal'`); ilman sarakkeita (`longGoalReady:
  false`) ne pysyvät piilossa. Molemmat tulevat migraatiosta
  `supabase/migrations/20261021083503_koutsi_long_goal_and_mood_session.sql` (ajettu 21.10.2026 käyttäjän luvalla).

- Kehityksen arkisto ja kalenteri (`domain/archive.js`, `domain/monthCal.js`, `player/ArchiveSheet.jsx`,
  `player/MonthSheet.jsx`): aikajanan "Muokkaa"-tilassa jokaisen rivin voi piilottaa; se siirtyy pelaajan omaan
  Arkistoon (taulu `koutsi_timeline_archive`, avain = aikajanan tapahtuman id). Pelaajan itse tekemät (fiilis,
  ottelu, merkintä, oma treeni, oma video, tavoite-/toivemuutos) katoavat myös valmentajan sovelluksesta
  (`coachViewOfArchives` latauksessa); valmentajan omat (huomiot, läksyt, treenit) jäävät valmentajalle.
  Arkistosta: Palauta tai Poista (omat poistetaan pysyvästi, valmentajan merkinnät vain arkistosta).
  Tavoitteen, pitkän ajan tavoitteen ja tähtäimen (`field = 'ambition'`) muutokset ovat aikajanalla pieninä
  riveinä "vanha → uusi". "Tämä viikko" -kortti avaa kuukausikalenterin: mitä kunakin päivänä tehtiin.
  Migraatio `supabase/migrations/20261021085606_koutsi_timeline_archive.sql` (ajettu 21.10.2026 käyttäjän
  luvalla); tietokannassa ilman taulua `archiveReady: false` ja Muokkaa/Arkisto pysyvät piilossa.

- Tilaus (`domain/subscription.js`, `coach/TrialStart.jsx`, `coach/SubscriptionCard.jsx`, `api/supabase/subscription.js`):
  uusi yksityisvalmentaja aloittaa ilman valmentaja-avainta 3 kk ilmaisella kokeilulla (ei korttia, ei muutu
  maksulliseksi itsestään) ja voi sen jälkeen ottaa kuukausitilauksen Stripen kautta (maksu Roisku Medialle).
  Tila: taulu `koutsi_coach_plans` (`free | trial | active | past_due | ended`) ja `koutsi_coach_plan(uuid)`
  (myös Laskutuksen porttia varten); kokeilu päättyy itsestään (`trial_ends_at`, ei cronia). Kaikki nykyiset
  valmentajat ja avaimella tulleet ovat `free`: ei kokeilulaskuria, ei maksupyyntöä, ei mitään uutta. Avainsivu →
  "Aloita 3 kk ilmainen kokeilu" (`koutsi_start_trial`: valmentajarivi, kokeilu ja tilausehtojen hyväksyntä
  samalla, versio `SUBSCRIPTION_TERMS_VERSION`; pilotin `PILOT_*_VERSION` ennallaan), avain yhden napautuksen
  päässä; kirjautumissivun valmentajahuomautus kertoo kokeilusta. Profiili → Tilaus (olemassa oleva `k-alert`-kortti):
  kokeilua jäljellä / tilaus voimassa / maksu ei mennyt läpi / päättyi + yksi nappi (Stripe Checkout tai asiakasportaali).
  Kokeilun aikana otettu tilaus veloitetaan vasta kokeilun lopussa (`subscription_data.trial_end`). Stripe on omissa
  funktioissaan: `supabase/functions/koutsi-subscription` (price / checkout / portal / sync) ja `koutsi-stripe-webhook`
  (oma endpoint ja salaisuus, vain `metadata.product = 'koutsi_subscription'`); yhteinen logiikka
  `_shared/koutsiPlan.js` (testit `test/subscriptionStripe.test.mjs`). Krossin `stripe-webhook` ei muutu, eikä Koutsin
  kassa kanna kenttiä (`client_reference_id`, `metadata.supabase_user_id`), joista se avaisi Krossin maksumuurin.
  Tilin poisto (oma ja ylläpitäjän) päättää valmentajan Stripe-tilauksen ensin (`_shared/koutsiCancel.ts`). Hinta on
  Stripessä, ei koodissa: `node scripts/koutsi-stripe-setup.mjs --hinta X [--alku Y --alku-kpl N --alku-kk M]`
  (omistaja ajaa). Hinta on arvonlisäveroton (Roisku Media ei ole alv-velvollinen); kun on, `--alv 25.5` lisää alv:n
  hinnan päälle: Stripen alv-kanta uusiin tilauksiin (`KOUTSI_TAX_RATE`, Checkoutin `default_tax_rates`) ja
  vahvistuksen jälkeen nykyisiin seuraavasta veloituksesta, ja sovellus näyttää "29 €/kk + alv" (tilausehdot §3). Ehdot: `koutsi-tilausehdot.html` (`/tilausehdot`) ja `koutsi-kasittelysopimus.html`
  (`/kasittelysopimus`, valmentaja = rekisterinpitäjä, Roisku Media = käsittelijä), voimassa 29.10.2026 (versio
  `SUBSCRIPTION_TERMS_VERSION`; tietosuojaseloste päivitetty samalla: Stripe, rooli). Kokeilun jälkeen
  ilman tilausta (`ended`, käyttäjän päätös 29.10.2026): valmentaja näkee kaiken ja suunnittelee kuten ennen (kalenteri,
  teemat, läsnäolot, pelaajat), mutta uuden lähettäminen pelaajille vaatii tilauksen — huomio, kotiläksy, video,
  tiedote, viesti ja lasku. Lukko on tietokannassa (`koutsi_plan_send_guard` ennen inserttiä kuuteen tauluun,
  `koutsi_invoice_plan_guard` luonnos → lähetetty), joten vanha Koutsi ei ohita sitä; pelaajan omat rivit menevät aina
  läpi. Sovelluksessa Merkitse näyttää yhden rivin "Kokeilu päättyi · … Ota tilaus" (`PlanNotice`, tila
  `coach/subscriptionStore.js`), ja estetty lähetys kertoo syyn. Laskutus (`koutsi_billing_coach_enabled`) aukeaa
  kokeilussa ja tilauksella oleville; kokeilun jälkeen vain jo laskuttaneelle (vanhat laskut, maksetuksi merkintä).
  Muistutus 7 pv ennen kokeilun loppua (`koutsi_trial_reminders`, cron `koutsi-trial-reminders`, ilmoituslaji
  `trial_ending`). Tietokanta: `supabase/migrations/20261029193756_koutsi_coach_plans.sql` (ajettu 29.10.2026 käyttäjän
  luvalla, kokeilu ilman avainta KIINNI; PGlite-testi `koutsi/web/sql/20261029193756_…check.mjs`); ilman sitä
  `ready: false` ja kaikki on piilossa (avainsivu täsmälleen ennallaan). Uudet valmentajat ilman avainta: migraatio
  luo `koutsi_self_serve_open()`:n kiinni (`select false`, sovellus näyttää avainsivun kuten ennen); avaaminen on yhden
  rivin korvaus (`select true`), eikä migraation uudelleenajo sulje sitä. Demo: Anna on kokeilussa; kehityksessä
  `?esikatsele=kokeilu | avain | tilaus-active | tilaus-past_due | tilaus-ended | tilaus-free`.

- Kaudet ja "Uusi kausi" (`domain/season.js`, `coach/SeasonSheet.jsx`, migraatio
  `supabase/migrations/20261025181126_koutsi_seasons.sql`, ajettu 25.10.2026 käyttäjän luvalla; uusien
  SECURITY DEFINER -funktioiden oikeudet `20261025181234_koutsi_seasons_function_grants.sql`):
  kausi = nimi, alku, loppu ja taukopäivät (`koutsi_seasons`), ryhmällä `season_id` ja `continues_from`.
  Seuraavan kauden ryhmät ovat UUSIA rivejä: päättyvän kauden ryhmät, jäsenet, treenit, läsnäolot ja teemat
  jäävät ennalleen, eikä vanhoja jäsenyyksiä päätetä (`koutsi_is_group_member` vaatii `ended_at is null`, joten
  pelaaja menettäisi omat menneet treeninsä). Sovellus näyttää listoissa kunkin valmentajan aktiivisen kauden
  ryhmät (`seasonView` DataProviderissa: käynnissä oleva, tauolla seuraava, muuten viimeisin); `allGroups`
  sisältää kaikki, ja id-haut (`koutsiGroupById`, treenin ryhmä) käyttävät sitä. Luonnos on valmentajan oma rivi
  (`koutsi_season_drafts`), julkaisu yksi RPC (`koutsi_publish_season`): kausi, ryhmät, jäsenet, uudet
  paikkapelaajat ja treenit kerralla, rivikohtaiset treeni-ilmoitukset vaimennettuna, sitten yksi ilmoitus per
  pelaaja. Uusi ryhmä liittyy valmentajan nykyiseen kauteen triggerillä (`koutsi_current_season`), vanhan kauden
  ryhmälinkki liittää jatkoryhmään (`koutsi_latest_group` redeemissä). Ominaisuus näkyy, kun
  `koutsi_seasons_enabled()` (beta-testaajat ja ylläpitäjät ensin) — kaikille avaaminen = funktion vaihto.
  Kodin kortti 56 pv ennen kauden loppua: Suunnittele kevät / Jatka suunnittelua / julkaistu + "Muuta loppua"
  (`SeasonEditSheet`: kauden pidennys jatkaa vain kauden loppuun asti ulottuvien ryhmien kalenterin).
  Ryhmän luonnissa "Kauden loppuun (n vk)" on oletus. Ilman migraatiota `seasonsReady: false` ja kaikki on piilossa.

- Viestit (`domain/messages.js`, `shared/messages/`, `coach/MessagesScreen.jsx`, `coach/ThreadScreen.jsx`,
  `player/MessagesScreen.jsx`, tyylit `styles/messages.css`): yksi keskustelu per valmentaja–pelaaja-pari, pois
  päältä kunnes valmentaja ottaa sen käyttöön (aikuisten ryhmät tai yksittäinen pelaaja; alaikäisille myöhemmin
  huoltajan kautta). Vain kaksi osapuolta lukee; vastaus voi lainata toivetta, tiedotetta tai Miten meni?
  -vastausta (tallentuu vain id); "Nähty" oman viimeisen viestin alla; muistutus terveystiedoista kirjoituskentän
  yläpuolella. Oma kevyt tila (`MessagesProvider`, `api.messages.overview`), ei osa valmentajan tilannekuvaa,
  joten viesti ei lataa koko viikkoa uudelleen. Tietokanta: ehdotettu migraatio
  `koutsi/web/sql/20261109120000_koutsi_messages.sql` — **EI AJETTU**; ilman sitä `ready: false` ja kaikki pysyy
  piilossa (ominaisuuskytkin `koutsi_messages_coach_enabled`: beta + ylläpitäjät ensin). Demo: Annan aikuisten
  ryhmillä viestit päällä (`api/demo/messagesSeed.js`).

- Lähetetyt ja valmentajan videot (`domain/sends.js`, `coach/SentScreen.jsx`, `coach/sent.jsx`, `coach/VideosTab.jsx`,
  tyylit `styles/sent.css`): kaikki, mitä valmentaja on lähettänyt pelaajille — videot, kotiläksyt, huomiot ja
  tiedotteet — päivittäin uusin ensin: kenelle (kokonaiset ryhmät nimellä, muut etunimellä), milloin ja kotiläksystä
  "3/8 tehty". Avattuna: kuka on tehnyt, Muokkaa (kaikki kopiot kerralla), Poista kaikilta ja "Lähetä myös muille"
  (jo saaneet näkyvät "Saanut" eikä heitä voi valita). Ryhmän sivulla "Ryhmälle lähetetty" (3 uusinta →
  `/valmentaja/lahetetyt?ryhma=`). Jokainen jaettu video tallentuu valmentajan omiin videoihin (Harjoitteet ja videot
  → Videot), ja Merkitse → Video → "Omista videoista" jakaa saman videon uudelleen lataamatta sitä. Tietokanta:
  `koutsi_sends` (yksi rivi per lähetys, vain valmentaja lukee), `koutsi_coach_videos` (id = pelaajarivien `share_id`,
  tiedosto kerran valmentajan kansiossa) ja `koutsi_homework.coach_id/send_id`, `koutsi_diary_entries.send_id`.
  Migraatio `supabase/migrations/20261026084331_koutsi_sends_and_video_library.sql` (ajettu 26.10.2026 käyttäjän
  luvalla; PGlite-testi `koutsi/web/sql/20261026084331_…check.mjs`). Tietokannassa ilman tauluja `sendsReady: false`,
  ja Lähetetyt, Videot-välilehti ja "Omista videoista" pysyvät piilossa, kaikki lähettäminen toimii kuten ennen.

- Laskutus (`domain/billing.js`, `shared/billing/`, `coach/BillingScreen.jsx`, `coach/BillingSheets.jsx`,
  `player/InvoicesScreen.jsx`, tyylit `styles/billing.css`): yksityisvalmentajan laskut läsnäoloista. Valmentaja
  asettaa kerran laskuttajan (nimi, IBAN, Y-tunnus, ALV, maksuaika), hinnat (ryhmä per kerta / kausimaksu / ei
  laskuteta, yksityistunnin tuntihinta) ja peruutusrajan. **Laskuta** näyttää jakson (kausi, tämä kuu, edellinen kuu)
  laskutettavat pelaajittain: päättyneet treenit, myöhäiset peruutukset ja poissaolot ilman ilmoitusta; jokaisen rivin
  voi kytkeä pois, sitten Lähetä tai Luonnoksiksi. Poissaolon laji tulee siitä, milloin se ilmoitettiin ensimmäisen
  kerran (`koutsi_training_absences.created_at` = `reportedAt`; upsert säilyttää sen): ajoissa = ei veloitusta,
  myöhässä tai valmentajan merkitsemä alun jälkeen = veloitetaan asetusten mukaan. Ryhmän jäsen laskutetaan
  liittymisestä lähtien (ensimmäinen kokoonpano kauden alusta) ja lähtemiseen asti. Sama treeni laskutetaan
  pelaajalta vain kerran (myös luonnoksilla); mitätöinti vapauttaa sen. Lähetys antaa juoksevan numeron, viitenumeron
  (7-3-1), eräpäivän ja kopion laskuttajan tiedoista, eikä lähetetty lasku muutu enää (vain maksettu / mitätöity).
  Tunnuksellinen pelaaja saa ilmoituksen (`kind 'invoice'`, kello + sähköpostijono, ei sähköpostikategoriaa);
  muille valmentaja jakaa linkin `koutsi.krossi.app/lasku/<token>` (ei kirjautumista, worker antaa
  `X-Robots-Tag: noindex`, myös vanhan Koutsin valinneille). Lasku tulostuu PDF:ksi selaimen tulostuksella. Pelaaja
  näkee laskunsa (Lisää → Laskut, `/pelaaja/laskut/:id`) ja "En pääse" kertoo, jos peruutus on myöhäinen.
  Tila on oma `BillingProvider` (kuten Viestit), ei osa tilannekuvaa. Tietokanta: migraatio
  `supabase/migrations/20261029162350_koutsi_billing.sql` (ajettu 29.10.2026 käyttäjän luvalla; PGlite-testi
  `koutsi/web/sql/20261029162350_koutsi_billing.check.mjs`). Ilman sitä `ready: false` ja kaikki pysyy piilossa.
  Ominaisuus näkyy vain ylläpitäjille ja `koutsi_billing_coaches`-listan
  valmentajille (käsin; Alpo ei ole listalla). Demo: Annan kausi, hinnat ja neljä lähetettyä laskua (`api/demo/billingSeed.js`).
  Maksu verkossa (vaihe 2, edge function `supabase/functions/koutsi-pay`, puhtaat apurit `_shared/koutsiPay.ts` +
  `test/koutsiPay.test.mjs`): valmentaja liittää oman Stripe-tilinsä (standard-tili: valmentaja on myyjä, Stripe
  vähentää kulunsa valmentajan puolelta, palautukset ja riidat valmentajan omassa Stripessä, Krossi ei ota mitään eikä
  maksa Connect-kuluja). Laskutus → Asetukset → Verkkomaksut: Ota käyttöön → Stripen käyttöönotto → takaisin
  `?tili=valmis` (tila luetaan Stripestä) tai `?tili=uusi` (uusi linkki). Laskun sivulla ja pelaajan Laskuissa "Maksa"
  avaa Stripe Checkoutin valmentajan tilillä (kortti, Apple/Google Pay, MobilePay ja Klarna kun valmentaja on ne
  ottanut käyttöön); paluu `lasku/<token>?maksu=<session>` vahvistaa maksun, ja Laskutus-sivu tarkistaa kerran
  käynnillä kesken jääneet (sync). `koutsi_invoice_paid_online` merkitsee laskun maksetuksi kerran (paid_via 'stripe')
  ja ilmoittaa valmentajalle (kind 'invoice_paid'). Stripe-sarakkeita kirjoittaa vain funktio (sarakeoikeudet).
  Tietokanta: `supabase/migrations/20261029185432_koutsi_billing_pay.sql` (ajettu 29.10.2026 käyttäjän luvalla;
  PGlite-testi `koutsi/web/sql/20261029185432_koutsi_billing_pay.check.mjs`); ilman sitä `biller.payReady` on false ja
  verkkomaksu pysyy piilossa. Funktio julkaistaan verify_jwt pois
  (`supabase functions deploy koutsi-pay --no-verify-jwt`); salaisuutena sama STRIPE_SECRET_KEY kuin krossi-funktioilla.
  Demo: verkkomaksu päällä, "Maksa" merkitsee laskun maksetuksi heti ilman Stripeä.

- Vapaat ajat (Calendlyn tilalle; `domain/openSlots.js`, `coach/openSlots.jsx`, `player/OpenSlots.jsx`,
  `api/supabase/openSlots.js`, `api/demo/openSlots.js`, tyylit `styles/open-slots.css`): valmentaja julkaisee yksittäisiä
  vapaita aikoja (päivä, alkaa, kesto, paikka; monta kerralla, ei toistuvia sääntöjä), ja omat pelaajat varaavat ne.
  Ajat elävät viikkonäkymissä, eivät listoina: valmentajan Viikkohallinnassa (`weekBoard(…, { openSlots })`) ja pelaajan
  Viikossa (`playerWeek(…, { openSlots })`) vapaa aika on oma palikkansa (valkoinen, katkoviivainen lime-reuna,
  "Vapaa aika"), ja varattu aika on tavallinen yksityistunti (täytetty lime). Valmentaja lisää ajat Viikkohallinnan
  plus-napista (Vapaat ajat) ja poistaa napauttamalla; pelaaja varaa napauttamalla ("Varaa aika?" kerran). Pelaajan
  Kodissa on yksi rivi, kun aikoja on (montako, lähin → Valitse aika avaa sen päivän Viikossa); ilmoituksen linkki
  `/pelaaja/vapaat` vie samaan. Varaus on yksi RPC (`koutsi_book_open_slot`, ensimmäinen voittaa) ja synnyttää tavallisen
  yksityistunnin (`koutsi_trainings`: `logged_by 'coach'`, `student_id` = pelaaja, Yksityistunti, ajan kesto), joten
  viikkonäkymät, läsnäolo, "En pääse" ja laskutus näkevät sen kuten muutkin. Pelaaja ei saa "Uusi treeni" -ilmoitusta
  omasta varauksestaan; valmentaja saa "<nimi> varasi ajan". Julkaisu = yksi ilmoitus pelaajaa kohden (uusi julkaisu
  10 min sisällä päivittää saman lukemattoman). Vapautunut aika: kun pelaaja ei pääse yksityistunnille, tunnin palikan
  ikkunassa ja tunnin sivulla on "Tarjoa muille" (uusi vapaa aika samaan aikaan, `source_training_id`); peruttu tunti jää
  kalenteriin (myöhäiset peruutukset), ja "Pääsen sittenkin" poistaa vielä varaamattoman tarjouksen. Paikka on ajan
  rivillä ja näkyy molempien tunnin tiedoissa. Molemmat tilannekuvat kantavat `openSlots` ja `openSlotsReady`.
  Tietokanta: ehdotettu migraatio `koutsi/web/sql/20261029180000_koutsi_open_slots.sql` — **EI AJETTU** (PGlite-testi
  `…_koutsi_open_slots.check.mjs`); ilman sitä `openSlotsReady: false` ja kaikki pysyy piilossa. Ominaisuus on pois
  päältä: valmentaja näkee sen, kun hänen sähköpostinsa on taulussa `koutsi_open_slot_coaches`, ja ylläpitäjät (ei
  koskaan "toimi valmentajana" -tilassa); muiden pelaajat eivät saa aikoja eivätkä ilmoituksia. Demo: Annalla päällä
  (avoimia aikoja, Jussin varaus, Leon vapautunut tunti); valmentajan ja pelaajan demo jakavat ajat selaimen
  localStoragessa (`koutsi-demo-vapaat-v1`, 6 h), joten valmentajan lisäämän ajan voi varata pelaajan demossa.
  Hillitty lisämyynti (omistajan toive: ei tyrkyttämistä): valmentaja valitsee julkaisuun "Kenelle" — kaikille pelaajille
  tai yksityistuntilaisille (`audience 'private'`: ollut yksityistunti valmentajan kanssa); tarjottu peruttu tunti perii
  alkuperäisen ajan valinnan. Pelaaja, jonka ikä on tiedossa ja alle 18, ei näe aikoja eikä saa ilmoituksia ennen
  huoltajavirtaa (`koutsi_open_slot_minor`). "En pääse" näyttää "Korvaava aika?" — 1–3 saman valmentajan aikaa kahden
  viikon sisältä; valinta varaa ajan ja ilmoittaa poissaolon kerralla (`player/OpenSlots.jsx` ReplacementSlots, Laskutuksen
  myöhäisen peruutuksen rivin alla). Kodin rivi näkyy vain, kun aika on kahden viikon sisällä eikä pelaajalla ole jo
  varattua tulossa; × (Ei kiitos) lepuuttaa sitä 14 päivää (localStorage). Ilmoitus menee vain niille, joille aika näkyy,
  ja luettelee vain heidän aikansa; sähköpostin voi kytkeä pois (Profiili → Sähköpostit → Vapaat ajat, luokka `vapaat`,
  näkyy vain pelaajalle, jolla on vapaita aikoja). Ei ponnahdusikkunoita eikä merkkejä; varatessa ei makseta (tunti
  laskutetaan seuraavalla laskulla). Mittaus: `vapaat.*`-tapahtumat (Ylläpito → Käyttö → Vapaat ajat (pelaaja)).

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
| `/valmentaja/harjoitteet` (`?nakyma=videot`), `/valmentaja/harjoite/:id` | exercises (Harjoitteet · Videot), exercise | page |
| `/valmentaja/lahetetyt` (`?laji=video\|laksy\|huomio\|tiedote`, `?ryhma=<id>`) | sent — Lähetetyt (puhelimessa Lisää-valikosta) | tab |
| `/valmentaja/profiili`, `/valmentaja/yllapito` | profile, admin | tab / page |
| `/valmentaja/viestit`, `/valmentaja/viestit/:pelaajaId` | messages, thread — Viestit (puhelimessa Lisää-valikosta, keskustelu koko näytöllä) | page / full |
| `/valmentaja/laskutus` (`?lasku=<id>`) | billing — Laskutus (vain kun käytössä; puhelimessa Lisää-valikosta) | tab |
| `/valmentaja/oppilaat`, `/treenit`, `/kalenteri` | vanhat osoitteet | ohjaus uusiin (`/kalenteri?vko=` säilyttää viikon) |

**Pelaaja** (`/pelaaja`, puhelimessa: Koti · Viikko · [Merkitse] · Kehitys · Lisää — Lisää-laatikossa Ryhmäsi, Harjoitteet ja videot, Ilmoitukset, Profiili, Anna palautetta; tietokoneella samat sivupalkissa, Profiili alhaalla)

| Polku | Nimi |
|---|---|
| `/pelaaja/koti` | home — kellon mukaan: viikon päivät (päivän napautus avaa sen tulevan treenin, muuten Viikon sillä päivällä), Tiedote, Treenit (juuri ohi / nyt / seuraavaksi / myöhemmin, `domain/playerNow.js sessionLine`), Ajankohtaista |
| `/pelaaja/kehitys` | progress — tavoite yhdellä vilkaisulla (napautus avaa tähtäimen, pitkän ajan ja aiemmat), toive, Tämä viikko → kalenteri, aikajana suodattimilla Kaikki · Treenit · Valmentajalta · Omat |
| `/pelaaja/treenit` (`?vko=2026-43&pv=2026-10-21`) | trainings — pelaajan viikko kuten valmentajan Viikkohallinta: kotiläksyt ensin, valmentajan treenit ja omat merkinnät aikaruudukossa, plus-nappi / tyhjän kohdan napautus kirjaa; `pv` avaa päivän |
| `/pelaaja/ryhma` (`?ryhma=<id>`) | group — Lisää → Ryhmäsi tai treenin "Ryhmä": viikon teema → ryhmäläiset → seuraavat treenit |
| `/pelaaja/harjoitteet` | exercises |
| `/pelaaja/profiili` | profile |
| `/pelaaja/viestit`, `/pelaaja/viestit/:valmentajaId` | messages, thread — Viestit (Kodin kuvake kellon vieressä; yhden valmentajan pelaaja menee suoraan keskusteluun) |
| `/pelaaja/laskut`, `/pelaaja/laskut/:id` | invoices, invoice — Laskut (Lisää; kun valmentaja on lähettänyt laskun) |
| `/lasku/<token>` | laskun oma sivu linkillä, ilman kirjautumista (pelaajan kuori, `shared/billing/PublicInvoice.jsx`) |
| `/pelaaja/vapaat` | openSlots — ilmoituksen linkki: Viikko lähimmän vapaan ajan päivänä (vapaat ajat ovat Viikon palikoita) |

Vanhat osoitteet (`/pelaaja/koti` jne.) ovat samat; `link_path` `/pelaaja` → koti.

## 6. Portit (järjestys kuten vanhassa)

- **Valmentaja:** auth → salasanan palautus → pilottivahvistus → profiilivirhe → profiilin luonti
  → valmentajarivi → valmentaja-avain → ylläpitäjän "toimi valmentajana" -tarkistus palvelimella → sovellus.
- **Valmentaja-avaimen vaihe**, kun `koutsi_coach_plans` on tietokannassa ja uudet valmentajat on avattu: ensin
  "Aloita 3 kk ilmainen kokeilu" (`coach/TrialStart.jsx`), avain sen takana ("Minulla on valmentaja-avain").
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
  `koutsi_coach_week_notes` (Oma viikkomuistio, ent. viikkopäiväkirja) ja "Treenit ohi! Miten meni?": pg_cron 15 min välein →
  `koutsi_queue_session_checkins()` → nykyinen ilmoitusjono → koutsi-notify (oma 1–5-pohja,
  versio 20). Betan aikana vain `koutsi_beta_testers`-listan osoitteille.
  Linkit: `/pelaaja?uusi=1&fiilis=<treeni>&arvo=1–5`, `?toive=1`.
- `supabase/migrations/20261021080937_koutsi_coaches_read_player_logs.sql` (ajettu 21.10.2026 käyttäjän
  luvalla) — lukuoikeus: pelaajan omat merkinnät näkyvät kaikille pelaajan nykyisille valmentajille, ei
  vain rivin `coach_id`:lle. Vain luku; muokkaus- ja poisto-oikeudet ennallaan. Testattu PGlitessä (toinen
  valmentaja näkee pelaajan oman merkinnän, ei yksityistuntia eikä muiden pelaajien rivejä; päättynyt
  valmennus ei näe mitään).
- Kun uusi Koutsi otetaan kaikille käyttöön: poista beta-ehto `koutsi_queue_session_checkins()`-funktiosta
  (tai lisää osoitteet listaan) — muuten muut eivät koskaan saa viestiä.
