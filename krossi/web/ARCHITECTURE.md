# Krossi web — arkkitehtuuri ja design-speksi

Tämä dokumentti on Krossin selainsovelluksen (krossi.app/pelaa) rakennusohje. Jokainen
näkymä, komponentti ja datakerroksen funktio noudattaa tätä. Krossi Koutsi
(koutsi.krossi.app) on eri tuote — **sen tiedostoihin ei kosketa** (`lib/koutsi-*`,
`koutsi*.html`, `build.mjs`, `dist/koutsi-*`, `supabase/functions/koutsi-*`).

## 1. Tavoite

Krossi = nopein tapa saada tennispeli sovittua tällä viikolla. Sovelluksen pitää tuntua
oikealta mobiilisovellukselta: sulava, nopea, hauska, pienet animaatiot, kunnon tyhjät
tilat. Maksumuuri (kertamaksu 8,99 €) **pysyy**: maksamaton käyttäjä näkee sovelluksen ja
lukitut esikatselut, mutta pelaajien profiilit, pelien avaaminen, liittyminen ja luominen
vaativat maksun (myös tietokanta valvoo tätä RLS:llä).

## 2. Kansiorakenne

```
krossi/
  README.md               rakenteen selitys (web / ios / android)
  web/
    ARCHITECTURE.md       tämä tiedosto
    build.mjs             esbuild: src/main.jsx -> dist/app.js, src/demo.jsx -> dist/demo.js, CSS
    dev.mjs               paikallinen kehityspalvelin (watch + SPA-reititys), portti 4400
    app.html              /pelaa-sivun runko
    demo.html             /demo-sivun runko
    landing/              krossi.app-etusivu (siirretty ennallaan; julkaistaan samoihin polkuihin)
    src/
      main.jsx            tuotanto: asentaa Supabase-backendin ja mounttaa sovelluksen
      demo.jsx            demo: asentaa muistinvaraisen backendin
      api/
        contract.js       datakerroksen rajapinta (lue tämä!)
        index.js          backend-rekisteri: `import { api } from '../api/index.js'`
        errors.js         ApiError (suomenkielinen userMessage)
        supabase/         oikea toteutus, yksi tiedosto per domain + client.js + map.js
        demo/             demototeutus, yksi tiedosto per domain + store.js (seed-data)
      app/                sovelluksen runko: App.jsx, AppShell.jsx, router.js, routes.js, session.jsx, paywall.jsx, checkout.jsx
      ui/                 design system -komponentit (index.js vie kaiken)
      features/           puhtaat funktiot: gamification.js (putket, merkit), recap.js (koosteet),
                          booking.js (kenttävaraus), seasons.js (kausivuorot, laskut, krediitit)
      lib/                constants.js, format.js (päivämäärät, nimet), geo.js, image.js, ics.js, share.js, stripe.js
      screens/<alue>/     näkymät alueittain (home, games, players, messages, profile, leagues, recap, auth, admin)
      styles/             tokens.css, base.css, ui.css, shell.css + yksi tiedosto per näkymäalue
    test/                 node:test -testit (sopimus, gamification, reititys)
    dist/                 build-tuotos (ei versionhallinnassa)
  ios/  android/          mobiilisovellus (Expo, toistaiseksi ~/developer/krossi) — ks. README
```

Julkaisu: `scripts/build-cloudflare.mjs` kopioi `krossi/web/dist/*` ja `krossi/web/landing/*`
`cloudflare-dist`-kansioon. Worker (`src/worker.js`) reitittää `/pelaa/*` → `app.html` ja
`/demo/*` → `krossi-demo.html`.

## 3. Koodikäytännöt

- ES-moduulit, React 18 -funktiokomponentit ja hookit. JSX-tiedostot `.jsx`, muut `.js`.
  Importeissa aina tiedostopääte (`'../ui/index.js'`).
- **Ei inline-tyylejä** muuhun kuin aidosti dynaamisiin arvoihin (esim. `style={{'--i': i}}`,
  prosenttileveys). Kaikki ulkoasu CSS-luokilla tiedostoissa `styles/*.css`. Näkymäalueen
  luokat prefiksoidaan alueen nimellä (`.games-card`, `.chat-bubble`) törmäysten välttämiseksi.
- Värit, välit, säteet, varjot ja animaatiokäyrät **vain tokeneista** (`var(--…)`, ks. §6).
- Ei `alert()`/`confirm()`/`prompt()`: käytä `useToast()` ja `useConfirm()`.
- Ei hiljaa nieltyjä virheitä (`catch {}`). Lataukselle on aina kolme tilaa: lataa
  (skeleton), virhe (ErrorState + "Yritä uudelleen"), data/tyhjä (EmptyState).
- Screens importtaavat datan vain `api`:sta. Ei supabase-js:ää näkymissä.
- Hook `useAsync(fn, deps)` (`app/hooks.js`) palauttaa `{ data, error, loading, reload, setData }`.
- Saavutettavuus: oikeat `<button>`/`<a>`, `aria-label` ikonipainikkeille, näkyvä
  focus-rengas, kontrasti ≥ 4.5:1 tekstille. `prefers-reduced-motion` sammuttaa liikkeen.
- Kieli: suomi, ystävällinen ja rento mutta selkeä ("Pelataanko?", "Peli sovittu!",
  "Ei vielä pelejä — luo eka ja jaa linkki kavereille"). Sinuttelu. Ei englanninkielisiä
  termejä UI:ssa (paitsi vakiintuneet: tie-break). Numerot suomalaisittain (8,99 €, klo 18.30).

## 4. Reititys

`app/router.js` tarjoaa: `useRoute()` → `{ name, path, params, query, state }`,
`navigate(to, { replace, state })`, `goBack(fallbackPath)`, `<Link to="…">`.
Reittitaulu on `app/routes.js`. Polut:

| Polku | Nimi | Välilehti | Tyyppi |
|---|---|---|---|
| `/pelaa`, `/pelaa/koti` | home | koti | tab |
| `/pelaa/pelit` (`?nakyma=omat\|kartta`) | games | pelit | tab |
| `/pelaa/peli/:id` | game | pelit | page |
| `/pelaa/uusi-peli` (`?tapahtuma=1`, `?kutsu=<userId>`) | createGame | — | overlay (Sheet) |
| `/pelaa/pelaajat` | players | pelaajat | tab |
| `/pelaa/pelaaja/:id` | player | pelaajat | page |
| `/pelaa/pelikaverit` | partners | pelaajat | page |
| `/pelaa/viestit` | inbox | viestit | tab |
| `/pelaa/viestit/arkisto` | archive | viestit | page |
| `/pelaa/viestit/:id` | chat | viestit | full (ei välilehtipalkkia mobiilissa) |
| `/pelaa/profiili` | profile | profiili | tab |
| `/pelaa/profiili/muokkaa` | profileEdit | profiili | page |
| `/pelaa/asetukset` | settings | profiili | page |
| `/pelaa/asetukset/estetyt` | blocked | profiili | page |
| `/pelaa/merkit` | badges | profiili | page |
| `/pelaa/kooste/:period` (`2026-09` tai `kausi-2026`) | recap | profiili | full |
| `/pelaa/liigat` | leagues | pelit | page |
| `/pelaa/liiga/:id` | league | pelit | page (kirjautumaton: julkinen sarjataulukko) |
| `/pelaa/varaa`, `/pelaa/varaa/:venue` | booking, bookingVenue | pelit | page |
| `/pelaa/halli/:venue` (`?nakyma=kausivuorot\|laskutus\|kortit\|asetukset`) | hall | pelit | page (hallin henkilökunta) |
| `/pelaa/omat-varaukset` | myBookings | pelit | page (vuorot, kausivuorot, sarja- ja lahjakortit) |
| `/pelaa/lasku/:id` | invoice | pelit | full (tulostettava lasku: henkilökunta ja haltija) |
| `/pelaa/kutsu/:code` | invite | — | public |
| `/pelaa/yllapito` | admin | profiili | page (vain admin) |

- *tab* = välilehden juuri; *page* = työnnetty sivu (TopBar + takaisin-nuoli, liukuu sisään);
  *overlay* = renderöidään Sheetinä edellisen näkymän päälle (taustanäkymä `state.bg`);
  *full* = koko ruutu ilman välilehtipalkkia mobiilissa.
- Kirjautumaton käyttäjä: `/pelaa/peli/:id` näyttää julkisen esikatselun (`api.games.publicPreview`)
  + "Luo tili ja liity" -CTA; `/pelaa/kutsu/:code` näyttää kutsunäkymän. Muut → AuthScreen.
  Jaetun linkin kohde muistetaan (`sessionStorage 'krossi_after_auth'`) ja avataan kirjautumisen jälkeen.

## 5. Sovelluksen runko (app/)

- `session.jsx`: `SessionProvider` + `useSession()` → `{ session, user, profile, loading,
  isAdmin, eventCities, canCreateEvents, paid, refreshProfile, needsOnboarding }`.
- `paywall.jsx`: `usePaywall()` → `{ paid, requirePaid(fn) }`. `requirePaid(fn)` ajaa fn:n jos
  maksettu, muuten avaa PaywallSheetin (ja ajaa fn:n maksun onnistuttua "Jatketaan"-napista).
  Myös `<LockedPreview title text>{children}</LockedPreview>` (sumennettu esikatselu + avauskortti).
- `checkout.jsx`: Krossin oma kassa PaywallSheetissä — Stripe Elements (Apple Pay / Google Pay
  -napit ylhäällä, alla MobilePay, kortti ja muut Stripe Dashboardissa päällä olevat tavat).
  Edge-funktio `krossi-payment` (config / intent / verify) luo PaymentIntentin vasta maksettaessa
  ja varmistaa maksun palvelimella. Uudelleenohjaavat tavat (MobilePay puhelimella) palaavat
  osoitteeseen `/pelaa?maksu=1&payment_intent=…`, jonka `useStripeReturn()` (App.jsx) käsittelee.
  Testi/live ratkeaa pelkillä Supabase-secreteillä (`STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`); ilman `STRIPE_PUBLISHABLE_KEY`:tä käytetään
  Stripen hostattua Checkout-sivua (`stripe-checkout`).
- `AppShell.jsx`: mobiilissa (< 900 px) alareunan **TabBar** (Koti · Pelit · iso lime
  **Pelataanko?** keskellä · Pelaajat · Viestit, lukemattomat-badge Viestit-kohdassa; kuten
  Koutsin "Merkitse") — Profiili on mobiilissa Kodin avatar. Työpöydällä vasen **SideNav**
  (logo, kaikki viisi kohdetta, iso lime "Pelataanko?" -nappi, oma profiilichippi). Keskellä
  sisältö max 720 px (Koti: 1080 px kahdella palstalla ≥ 1200 px).
- **Pelataanko?-valikko** (`screens/play/PlayMenu.jsx`, avataan `openPlayMenu()`): Tulossa
  (omat tulevat pelit), Ajankohtaista (kutsu peliin, pelaa nyt, avoimet pelit tällä viikolla)
  ja ruudut Luo peli · Pelaan nyt · Avoimet pelit · Etsi pelikaveri · Kirjaa tulos · Kutsu kaveri.
- **Ilmoitukset** (kello Kodin yläkulmassa, `screens/home/Notifications.jsx`): lista kootaan
  olemassa olevasta datasta (`features/notifications.js`: pelikutsut, pelipyynnöt, lukemattomat
  viestit, "Pelasitteko?", alle vuorokauden päästä alkavat pelit, uudet pelit omissa kaupungeissa);
  omaa taulua ei ole. "Nähty" = localStorage `krossi_notifs_seen:<uid>`.
- Globaalit: `ToastHost`, `ConfirmHost`, `PaywallSheet`, `PendingOutcomeCheck`
  (kysyy menneistä peleistä "Pelasitteko?" ja tarjoaa tuloksen kirjaamista), demotilan banneri.

## 6. Design system

### Tokenit (`styles/tokens.css`)
- Brändi: `--green-900 #0A2C20`, `--green-800 #0E3B2C` (pääväri), `--green-700 #155440`,
  `--green-600 #1E6B52`, `--lime #CFE414` (korostus/CTA), `--lime-300 #DDEE5A`,
  `--lime-100 #F4F8CF`, `--clay #D9734A` (tennismassa, putket/liekit), `--sky #3F7DFF` (oma sijainti).
- Pinnat: `--bg #F7F5EF` (sovelluksen tausta), `--surface #FFFFFF`, `--surface-2 #FBFAF6`,
  `--sand #EFECE3`, `--line #E5E1D7`, `--line-strong #D3CEC2`.
- Teksti: `--ink #121212`, `--ink-2 #3A372F`, `--muted #6B665C`, `--faint #9A958A`,
  `--on-dark #FFFFFF`, `--on-dark-muted rgba(255,255,255,.72)`.
- Tilat: `--success #2D7A4D`, `--success-bg`, `--danger #B23B2E`, `--danger-bg`, `--warn #9A6B00`, `--warn-bg`.
- **Lime ei koskaan ole tekstiväri vaalealla pohjalla** (kontrasti). Limeä käytetään taustana
  (tummalla tekstillä `--ink`) tai tekstinä tummanvihreällä pohjalla.
- Välit `--s1 4px … --s8 48px`; säteet `--r-sm 10px`, `--r-md 14px`, `--r-lg 18px`,
  `--r-xl 24px`, `--r-pill 999px`; varjot `--shadow-1/2/3`, `--shadow-lift`.
- Typografia: järjestelmäfontti (SF Pro / Segoe). `--fs-display 34px/800/-0.03em`,
  `--fs-title 24px/800`, `--fs-h2 19px/750`, `--fs-h3 16px/700`, `--fs-body 15px`,
  `--fs-small 13px`, `--fs-micro 11px` (eyebrow: uppercase, 700, .08em).
- Liike: `--ease-out cubic-bezier(.22,1,.36,1)`, `--ease-spring cubic-bezier(.34,1.56,.64,1)`,
  `--dur-1 140ms`, `--dur-2 220ms`, `--dur-3 360ms`.

### Liike ja tunnelma
- Sivun vaihto: uusi sivu liukuu 16 px oikealta + fade (`.route-enter`), välilehti vaihtuu fadella.
- Listat ilmestyvät porrastetusti: `<div className="stagger">` ja lapsille `style={{'--i': index}}`.
- Napit: painallus skaalaa 0.97, hover nostaa 1 px. Kortit: hover nostaa 2 px + varjo.
- Sheet nousee alhaalta jousella, taustan blur+fade, raahaamalla alas sulkeutuu.
- Onnistumiset: `confetti()` kun peli täyttyy / liityt / saat merkin; check-animaatio toasteissa.
- Lataus: shimmer-skeletonit, ei pelkkiä spinnereitä listoissa. Splash: pomppiva pallo.
- Tummanvihreät "hero"-pinnat käyttävät kenttäviivakuviota (`.court-lines`-tausta) ja limeä.

### UI-komponentit (`ui/index.js`)
`Icon`, `Button`, `IconButton`, `Avatar`, `AvatarStack`, `Chip`, `ChipSelect`, `Segmented`,
`Card`, `Section`, `ListRow`, `StatTile`, `Sheet`, `useConfirm`, `useToast`, `EmptyState`,
`ErrorState`, `Skeleton`, `SkeletonList`, `Spinner`, `Field`, `Input`, `Textarea`, `Select`,
`Toggle`, `Disclosure`, `TopBar`, `Page`, `PageHeader`, `ProgressBar`, `ProgressRing`,
`CountUp`, `BadgeMedal`, `confetti`, `useShare`. Propsit on dokumentoitu jokaisen
komponentin yläpuolelle `ui/`-tiedostoissa — lue ne ennen käyttöä äläkä tee rinnakkaisia
versioita. Jos jokin puuttuu, lisää se oman alueesi kansioon, ei `ui/`:hin.

## 7. Näkymät (screens/)

**Koti (home):** tumma hero ("Moi, Eelis!", Pelaan tällä viikolla -kytkin, ⚡ Pelaan nyt,
iso "Pelataanko?"), Seuraava pelisi -kortti, pelikutsut ja pelipyynnöt, putki + kuukauden
pelit + uusin merkki, lähialueen avoimet pelit vaakarullana, kuukauden kooste -kortti,
kutsu kaveri -kortti. Maksamattomalle: avauskortti.

**Pelit (games):** Segmented Avoimet / Omat pelit / Kartta. Suodattimet (pelityyppi,
sisällä/ulkona, pinta, taso) sheetissä, "Lähin ensin". Pelikortti: päivä-"lappu" (pe 3.10.),
kellonaika, paikka, tyyppi, vapaat paikat pisteinä, etäisyys. Pelin sivu: osallistujat,
liity / jonota / poistu / peru, jaa linkki, lisää kalenteriin (.ics), kutsu pelikavereita,
siirry chattiin. **Luo peli** -sheet: pakolliset (pelityyppi, päivä Tänään/Huomenna/viikon
päivät, aikaikkuna tai tarkka aika, paikka/halli) näkyvissä; "Lisätiedot" -Disclosure
(pinta, taso, kenttävuoron hinta, otsikko, kuvaus, tarjoan vuoron, kartta). Tapahtumatila
adminille. Onnistuminen: "Peli julkaistu!" + jaa linkki heti.

**Pelaajat (players):** lista kotikaupungista (taso-suodatin, lisäsuodattimet sheetissä),
"Pelaa nyt" / "tällä viikolla" -merkit, pelaajan sivu (taso, kilpailuluokka, tyyli, ajat,
bio, yhteiset pelit), "Pyydä pelaamaan", ilmoita/estä. **Pelikaverit**: kenen kanssa olet
pelannut + "Pelaa uudestaan" (avaa Luo peli -sheetin kutsu esitäytettynä).

**Viestit (messages):** pelipyynnöt ylhäällä, keskustelut (pyyhkäisy/valikko: arkistoi,
poista), arkisto. **Chat**: ryhmitellyt kuplat, päivämäärä-erottimet, kellonajat, peli-kortti
ylhäällä pelin chatissa, kuvan lähetys esikatselulla, peukku, optimistinen lähetys,
reaaliaikaisuus, "uusia viestejä ↓" -nappi, osallistujat-sheet.

**Profiili (profile):** hero (kuva, nimi, taso, kaupungit), tilastot (pelatut, järkätyt,
voitot), putki, merkit-rivi → Merkit-sivu, pelihistoria + "Lisää tulos", pelikaverit,
kuukauden/kauden kooste. Muokkaa profiilia (kaikki kentät + kuvan vaihto), Asetukset
(sähköposti-ilmoitukset, näkyvyys, kirjautumistavat, ehdot, evästeet, estetyt, kirjaudu ulos,
poista tili, admin: maksutilan kytkin).

**Koosteet (recap):** `/pelaa/kooste/2026-09` ja `/pelaa/kooste/kausi-2026` — tarinamainen
koko ruudun diaesitys (napauta eteenpäin): pelit, voitot, eniten pelattu kaveri, suosikkihalli,
pisin putki, uudet merkit, loppudia jaettavana korttina (canvas → kuva / navigator.share).

**Liigat (leagues):** kaupungin liigat, luo/liity, liigan sivu: lohkot, sarjataulukko,
ottelut, ilmoita/vahvista tulos, avaa chat vastustajan kanssa. Kaksi muotoa:
*Krossi-liiga* (lohkot arvotaan kerran, erät) ja *hallisarja* (Lahden hallisarjan mallin mukaan:
kierrokset päivämäärineen, ylläpitäjä jakaa lohkot A, B, C… — `proposeGroups` ehdottaa nousut ja
putoamiset —, tunnin aikapeli geimeinä, tasapeli mahdollinen, 2/1/0 pistettä, tasapisteissä
geimiero → keskinäinen → voitetut geimit). Perustaja on liigan **ylläpitäjä** (AdminCard +
Ylläpito-sheet: tiedot, pelaajien poisto, kauden päätös, liigan poisto); Krossin moderaattorit
(`krossi_can_manage_city`) saavat samat oikeudet. Ylläpitäjä kirjaa tulokset, luovutukset
(wo 6–0) ja 3–3-tasapelit (AdminResultSheet) ja päättää kierrokset. Julkiseksi merkitty sarja
näkyy kirjautumattomille (`api.leagues.publicGet`, nimet "Mikko V."). Tietokanta:
`supabase/migrations/20261014191351_krossi_league_admin_and_hallisarja.sql`.

**Kenttävaraus (booking):** `/pelaa/varaa` — hallin vuorot ja maksu sovelluksessa (Cintoian ja
Thrilin opit, ei niiden ulkoasua). Päivä, kesto ja paikka valitaan ylhäältä; *Ajat* näyttää vapaat
aloitusajat ruutuina (hinta + montako kenttää vapaana), *Kartta* hallin pohjakartan valitulle
ajalle (`VenueMap`, `venueMaps.js`: vapaat kentät korostuvat, napautus varaa). BookSheet: kesto →
kenttä (kartta + chipit) → pito (`holdMinutes`, laskuri) → maksu (sama Stripe-`Checkout` kuin
avausmaksussa, `createIntent`/`verify`-propseilla) → "Kenttä varattu!" + kalenteri + "Etsi pelikaveri
tähän vuoroon" (avaa Luo peli -sheetin `?varaus=<id>`, täytettynä). Omat vuorot ylhäällä,
peruutus maksutta `cancelLimitHours` ennen (raha takaisin maksutavalle). Säännöt (aloitusajat,
puolen tunnin hinnoittelu, vapaat kentät) ovat `features/booking.js`:ssä; palvelin
(`krossi_hold_booking`, edge-funktio `krossi-booking`) päättää. Hallin henkilökunta: `/pelaa/halli/:venue`
(päivän aikajana nimillä, esteet kuten Hallisarja, peruutus + hyvitys). Näkyy toistaiseksi vain
demossa ja adminille (PlayMenu: `isDemo || isAdmin`).

**Kausivuorot, laskutus, sarja- ja lahjakortit (vaihe 2):** domainit `seasons`, `billing` ja `wallet`
(contract.js), säännöt `features/seasons.js` (kauden viikot ja pyhät, kausihinta kuukausittain
pyöristettynä, viitenumero 7-3-1, pankkiviivakoodi v4, lahjakorttikoodit). Varaussivun alla
`BookingExtras`: *Hae kausivuoroa* (`SeasonRequestSheet`: viikonpäivä, aika, kesto, paikka → koko kauden
tarjous, varatut viikot kentittäin, kuukausierät; maksu laskulla tai kortilta kuukausittain, kortti
tallennetaan `SaveCard`issa Stripen SetupIntentillä), *Sarja- ja lahjakortit* (`WalletSheet`: osto samalla
kassalla, lahjakortin koodi jaettavaksi, lunastus saldoksi) ja *Omat varaukset* (`/pelaa/omat-varaukset`:
vuorot maksutapoineen, kausivuorot laskuineen tai kuukausierineen, epäonnistunut kuukausi → "Maksa nyt"
(`ChargePaySheet`), sarjakorttien saldo ja historia, lahjakorttisaldo, kortti). Varauksen maksuvaiheessa
`CreditPay`: sarjakortti maksaa koko vuoron, lahjakorttisaldo koko tai osan (kortille jää ≥ 0,50 €).
Hallin näkymässä välilehdet `?nakyma=kausivuorot|laskutus|kortit` (`HallSeasons` + `SeasonStaffSheet`:
hakemusten hyväksyntä kenttä- ja varattujen viikkojen kanssa, oma kausivuoro seuralle laskulla,
päättäminen; `HallBilling`: laskut, korttiveloitukset ja "Veloita erääntyneet"; `HallCards`). Kausivuoron
viikot ovat varauksia (`kind: 'season'`, oma väri aikajanalla); yksittäisen viikon voi vapauttaa.
Tulostettava lasku `/pelaa/lasku/:id`. **Hallin asetukset** (`?nakyma=asetukset`, ratas yläpalkissa; `HallSettings` +
`SeasonSettingsSheet`, `PassProductSheet`, `GiftSettingsSheet`, `BillingSettingsSheet`): kaudet (päivät, pyhät + "Lisää
Suomen pyhät", kausialennus, haku auki), sarjakorttituotteet (myynnissä / piilotettu), lahjakorttien summat ja laskutustiedot
(Y-tunnuksen tarkiste, IBAN mod 97). Tarkistukset `features/seasons.js` (`checkSeason` …), SQL `…120000_krossi_booking_hall_settings.sql`.
Pelaaja saa sähköpostin, kun halli hyväksyy tai hylkää hakemuksen (`krossi-billing` `seasonDecided`, `SeasonSlot.notifiedAt`). Tietokanta: `supabase/migrations/20261016100000_…` (+ Lahden seed
`…100100`), edge-funktio `krossi-billing` (kortti, kuukausiveloitukset off-session, korttien osto, laskun
sähköposti); `krossi-booking` veloittaa hinnasta lahjakorttiosuuden pois.

**Auth & onboarding:** näyttävä tumma kirjautumisnäkymä (kenttäviivat, pallo), Google/Apple/
sähköposti, rekisteröinti/kirjautuminen/salasanan palautus. Onboarding yhdellä ruudulla:
kuva, nimi, ikä, kotikaupunki, taso (+ kilpailuluokka), pelimuodot — loput myöhemmin
profiilin valmiusmittarilla. Kutsulinkillä tullut näkee "Eelis kutsui sinut Krossiin".

**Ylläpito (admin):** tilastot ja käyttäjälista (siirretty vanhasta sovelluksesta).

## 8. Pelillistäminen (features/)

`gamification.js` laskee `Activity`-datasta: viikkoputki (peräkkäiset ISO-viikot joilla
peli), pisin putki, pelatut/järkätyt/voitot, merkit (`BADGES`-lista: id, nimi, kuvaus,
ikoni, ehto, edistyminen). `recap.js` laskee kuukauden ja kauden koosteen. Puhtaita
funktioita, testit `test/gamification.test.mjs`. UI näyttää merkit `BadgeMedal`-komponentilla.

## 9. Ilmoitukset

`api.notifications.emit(event)` lähettää saman tapahtuman sekä mobiilin push-funktiolle
(`send-push-notification`) että sähköpostifunktiolle (`krossi-notify`). Datakerros kutsuu
emitiä itse (create/join/leave/cancel/send/sendPlayRequest/invite) — näkymät eivät.

## 10. Demotila

`krossi.app/demo` ajaa samaa sovellusta muistinvaraisella backendillä (`api/demo/`). Käyttäjä
on valmiiksi kirjautunut, maksanut "Demo"-pelaaja Lahdesta; seed-datassa on pelaajia,
avoimia ja menneitä pelejä, keskusteluja, tuloksia, liiga ja merkkejä. Mikään ei tallennu
(sivun lataus nollaa). Ylhäällä ohut banneri "Demotila — mikään ei tallennu · Luo oma tili".
Demon pitää näyttää elävältä: viestiin vastataan muutaman sekunnin päästä, liittyminen
täyttää pelin ja laukaisee konfetin.
