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
                          booking.js (kenttävaraus), seasons.js (kausivuorot, laskut, krediitit),
                          resultLinks.js (tulosten pelaajat ja vahvistus)
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
| `/pelaa/varaa`, `/pelaa/varaa/:venue` (`?peli=<id>`, `?chat=<id>`, `?liiga=&ottelu=`) | booking, bookingVenue | varaa | tab (työpöytä) / page (puhelin) |
| `/varaa`, `/varaa/:venue` | bookingSite, bookingSiteVenue | — | site (varaussivu krossi.app/varaa, ks. alla) |
| `/pelaa/halli/:venue` (`?nakyma=kausivuorot\|laskutus\|kortit\|asetukset`) | hall | pelit | page (hallin henkilökunta) |
| `/pelaa/osuus/:id` | share | pelit | page (osuus jaetusta kenttävuorosta; ei vaadi avausmaksua) |
| `/pelaa/omat-varaukset` (`?vuoro=<id>` avaa varauksen) | myBookings | pelit | page (vuorot, kausivuorot, sarja- ja lahjakortit) |
| `/pelaa/lasku/:id` | invoice | pelit | full (tulostettava lasku: henkilökunta ja haltija) |
| `/pelaa/kutsu/:code` | invite | — | public |
| `/pelaa/yllapito` | admin | profiili | page (vain admin) |

- *tab* = välilehden juuri; *page* = työnnetty sivu (TopBar + takaisin-nuoli, liukuu sisään);
  *site* = varaussivu ilman sovelluksen valikoita (`SiteShell`, `SiteBar`): asiakas tekee siellä vain varauksen, ja
  "Kenttä varattu!" -näkymän pääpainike "Etsi pelikaveri tähän vuoroon" vie sovellukseen (Peliseura + pelin luonti
  valmiiksi täytettynä). Polku on `/pelaa`:n ulkopuolella, joten demo pitää saman osoitteen. Worker tarjoaa
  `/varaa`:n toistaiseksi demon taustalla (`krossi-varaa.html` lataa `demo.js`:n, ulkokenttämaailma): linkin voi
  lähettää seuralle kokeiltavaksi ilman tiliä. Kun oikeat kentät aukeavat pelaajille, worker vaihdetaan `app.html`:ään
  (silloin varausaikojen pitää näkyä ilman tiliä ja kirjautuminen tulla vasta maksaessa — tietokantamuutos);
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
- `AppShell.jsx`: mobiilissa (< 900 px) alareunan **TabBar**: Koti · Peliseura · Viestit · Profiili
  (lukemattomat-badge Viestit-kohdassa). Kenttä varataan puhelimella omalta sivultaan: Kodin Tulevat-otsikon
  "Varaa kenttä" ja Peliseuran "Onko jo pelikaveri? Varaa kenttä" (vain kun varattava halli on näkyvissä).
  Työpöydällä vasen **SideNav**: Koti · Peliseura · Varaa · Viestit · Profiili ja oma profiilichippi
  (`TABS`, Varaa on `desktopOnly`). Keskellä sisältö max 720 px (Koti: 1080 px kahdella palstalla ≥ 1200 px).
  Reitit, joiden tyyppi on *site*, renderöi `SiteShell.jsx` ilman näitä valikoita.
- **Pelataanko?-valikko** (`screens/play/PlayMenu.jsx`, avataan `openPlayMenu()`): kaksi ovea,
  yksi kierto. Tulossa (omat tulevat pelit + kenttävaraukset; vuoro, jolla ei ole peliä eikä
  jakoa, on "Puuttuu pelikaveri"), sitten **Varaa kenttä** (tumma; vapaat ajat tänään) ja **Etsi
  peliseuraa** (lime; avaa sheetin: Ajankohtaista — tyhjä vuoro "Avaa vuoro muille", kutsu peliin,
  pelaa nyt, avoimet pelit — ja Luo peli · Avoimet pelit · Etsi pelikaveri), alla pikanapit Pelaan nyt ·
  Kirjaa tulos · Kutsu · Liigat (+ Tapahtuma). Ilman varattavaa hallia (`useBookingHall`) ei ole
  kenttäovea: peliseuran vaihtoehdot ovat suoraan valikossa. Toinen suunta: pelisivun Paikka-osio
  ("Varaa kenttä tälle pelille" järjestäjälle tai "Kenttä varattu") ja chatin ⋯-valikko.
- **Ilmoitukset** (kello Kodin yläkulmassa, `screens/home/Notifications.jsx`): lista kootaan
  olemassa olevasta datasta (`features/notifications.js`: pelikutsut, pelipyynnöt, lukemattomat
  viestit, "Pelasitteko?", vahvistettavat tulokset ja vastaukset omiin tuloksiin, alle vuorokauden
  päästä alkavat pelit, uudet pelit omissa kaupungeissa);
  omaa taulua ei ole. "Nähty" = localStorage `krossi_notifs_seen:<uid>`.
- Globaalit: `ToastHost`, `ConfirmHost`, `PaywallSheet`, `PendingOutcomeCheck`
  (Omat-välilehden kortista tai kellosta: "Pelasitteko?" + tuloksen kirjaaminen, ja muiden kirjaamista
  tuloksista "Vahvistatko tuloksen?"; ei avaudu itsestään), demotilan banneri.

## 6. Design system

### Tokenit (`styles/tokens.css`)
Ilme (2026-10-17): litteä ja kontrastikas "Spotify valkoisella" — valkoinen sivu, neutraalit harmaat,
lähes musta tummille pinnoille ja lime ainoana korostusvärinä. Ei varjoja korteissa, ei koristekuvioita.
- Brändi: `--green-*`-nimet ovat jääneet ensimmäisestä (metsänvihreästä) paletista; ne ovat nyt tummat
  pinnat: `--green-900 #000`, `--green-800 #121212` (pääväri), `--green-700 #2A2A2A`, `--green-600 #3E3E3E`.
  `--lime #CFE414` (korostus/CTA), `--lime-300 #DBEE45`, `--lime-100 #F4F8D9`, `--clay #E0592A`
  (merkkipallot, putket), `--sky #2E77F0` (oma sijainti).
- Pinnat: `--bg #FFFFFF`, `--surface #FFFFFF`, `--surface-2 #F7F7F7`, `--sand #F1F1F1`,
  `--line #E8E8E8`, `--line-strong #D4D4D4`.
- Teksti: `--ink #121212`, `--ink-2 #333`, `--muted #6A6A6A`, `--faint #969696`,
  `--on-dark #FFFFFF`, `--on-dark-muted rgba(255,255,255,.7)`.
- Tilat: `--success #16794A`, `--success-bg`, `--danger #D22F27`, `--danger-bg`, `--warn #8A6100`, `--warn-bg`.
- Avatarit: tasavärit `--av-blue/yellow/red/green` (ei liukuvärejä).
- **Lime ei koskaan ole tekstiväri vaalealla pohjalla** (kontrasti). Limeä käytetään taustana
  (tummalla tekstillä `--ink`) tai tekstinä tummalla pohjalla.
- Välit `--s1 4px … --s8 48px`; säteet `--r-xs 6px`, `--r-sm 8px`, `--r-md 10px`, `--r-lg 12px`,
  `--r-xl 14px`, `--r-2xl 18px`, `--r-pill 999px` (vain napit ja chipit). Varjot: `--shadow-1` ja
  `--shadow-lift` ovat tyhjiä (reunat kantavat rakenteen), `--shadow-2/3` vain päällä leijuville.
- Typografia: järjestelmäfontti (SF Pro / Segoe), myös numeroissa (ei pyöristettyä). `--fs-display 34px/800/-0.03em`,
  `--fs-title 24px/800`, `--fs-h2 19px/750`, `--fs-h3 16px/700`, `--fs-body 15px`,
  `--fs-small 13px`, `--fs-micro 11px` (eyebrow: uppercase, 700, .08em).
- Liike: `--ease-out cubic-bezier(.22,1,.36,1)`; `--ease-spring` on sama käyrä ilman yliheilahdusta,
  `--dur-1 140ms`, `--dur-2 220ms`, `--dur-3 360ms`.

### Liike ja tunnelma
- Sivun vaihto: uusi sivu liukuu 16 px oikealta + fade (`.route-enter`), välilehti vaihtuu fadella.
- Listat ilmestyvät porrastetusti: `<div className="stagger">` ja lapsille `style={{'--i': index}}`.
- Napit: painallus skaalaa 0.97, hover vaihtaa värin. Kortit: hover tummentaa reunan (ei nostoa).
- Sheet nousee alhaalta, taustan blur+fade, raahaamalla alas sulkeutuu.
- Onnistumiset: `confetti()` kun peli täyttyy / liityt / saat merkin; check-animaatio toasteissa.
- Lataus: shimmer-skeletonit, ei pelkkiä spinnereitä listoissa.
- Ei jatkuvia pomppu-, heilunta- tai liekkianimaatioita tavallisissa näkymissä (koosteiden diat poikkeus).
- Tummat "hero"-pinnat ovat tasaisen mustia ja käyttävät limeä; `.court-lines` on enää asemointikonteksti.
- Navigaatio: aktiivinen välilehti näyttää ikonin täytettynä (`home-fill` jne.), muut ääriviivoina.
- Kuvitukset (`ui/illustrations.jsx`): litteät geometriset muodot harmaalla kiekolla, musta + paperi + lime
  pallo, ei kipinöitä/konfetteja/animaatiota; värit `--ill-*`-muuttujista, kääntyvät `.on-dark`-pinnoilla.

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
iso "Pelataanko?"), Seuraava pelisi -kortti (seuraava peli tai, kun halli on varattavissa, seuraava
oma kenttävuoro, jolla ei ole peliä: `CourtCard`), pelikutsut ja pelipyynnöt, putki + kuukauden
pelit + uusin merkki, lähialueen avoimet pelit vaakarullana, kuukauden kooste -kortti,
kutsu kaveri -kortti. Maksamattomalle: avauskortti.

**Pelit (games):** Segmented Avoimet / Omat pelit / Kartta (Omat pelit → Tulevat: pelit ja
kenttävuorot, joilla ei ole peliä, aikajärjestyksessä). Suodattimet (pelityyppi,
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

**Tulokset ja vahvistus:** tuloksen nimet voivat olla Krossin pelaajia (`MatchResultSheet` →
`PlayerNameField`: pelikaverit ensin, sitten kaupungin pelaajat, kirjoitettu nimi käy edelleen;
"Pelasitteko?" esitäyttää kaksinpelin vastustajan). Linkitetty vastustaja saa pyynnön
(`match_result_logged`, `krossi-notify`) ja vastaa Omat-välilehden kortista (Odottaa vastaustasi) tai kellosta: Vahvista / Ei pidä paikkaansa
(`results.confirm` / `dispute`). Kiistetyn tuloksen kirjaaja korjaa muokkaamalla, jolloin vastustajalta
kysytään uudelleen. Vahvistettu tulos näkyy myös vastustajan ja parin pelihistoriassa (`isMine: false`,
vain luku, oma puoli on "my"). Tulostaulu kertoo tilan (`confirmationLine`). Tasolaskennan pohja:
`ratedMatches(activity)` (vahvistetut linkitetyt tulokset + liigaottelut) ja SQL-näkymä
`krossi_rated_matches`. Tietokanta: `supabase/migrations/20261017130234_krossi_match_result_confirmations.sql`
(trigger päättää tilan, `krossi_answer_match_result`, `krossi_linked_match_results`).

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
Thrilin opit, ei niiden ulkoasua). Sivulla on vain varaaminen, ylhäältä alas: paikka korteista
(`PlacePicker`: "Mikä tahansa" tai halli + vapaiden aikojen määrä), päivä, kesto (1–4 h) ja vapaat
aloitusajat riveinä (`TimeRows`: aika, vapaat kentät, hinta; myynnissä oleva vuoro omana rivinään).
Päivää vaihtaessa pallo pyörii, kunnes ajat ovat haettu. Muu aukeaa napautuksella: maksamattomat
maksut rivistä sheetiin, omat varaukset yläpalkista (`/pelaa/omat-varaukset`), kausivuoro ja kortit
ruuduista, varausehdot linkistä (`BookingTermsSheet`). BookSheet: kesto →
kenttä (kartta + chipit) → pito (`holdMinutes`, laskuri) → maksu (sama Stripe-`Checkout` kuin
avausmaksussa, `createIntent`/`verify`-propseilla) → "Kenttä varattu!" + kalenteri + "Etsi pelikaveri
tähän vuoroon" (avaa Luo peli -sheetin `?varaus=<id>`, täytettynä). Kenelle varataan
(`bookingTarget`): hallisarjan ottelu (`?liiga=&ottelu=`), peli (`?peli=<id>`: pelin päivä valitaan ja
sheet aukeaa pelin alkuaikaan, jos kenttä on vapaana; jo varattu peli sanoo sen) tai chat
(`?chat=<id>`) — maksun jälkeen "Lähetä aika" vie ajan sen chattiin. Peliä ja varausta ei linkitetä
datassa: `bookingFitsGame` (features/booking.js) pitää varausta pelin kenttänä, kun peli alkaa sen
aikana tai enintään 30 min ennen. `gamesAndCourts(games, bookings)` kokoaa tulevat pelit ja vahvistetut
vuorot, joilla ei ole peliä, aikajärjestykseen — samaa listaa käyttävät Kodin Seuraava pelisi, Pelit →
Omat pelit ja Pelataanko?:n Tulossa. Pelin kenttä näkyy pelinä; muu vuoro on `CourtCard`
(`screens/shared/`, luokat `ccard-*`): kenttä, paikka, aika — napautus avaa varauksen
(`/pelaa/omat-varaukset?vuoro=<id>`), ja tyhjällä vuorolla "Puuttuu pelikaveri" + "Avaa vuoro muille"
(Luo peli -sheet `?varaus=<id>`, maksumuurin takana). Peruutus maksutta
`cancelLimitHours` ennen (raha takaisin maksutavalle). Säännöt (aloitusajat,
puolen tunnin hinnoittelu, vapaat kentät) ovat `features/booking.js`:ssä; palvelin
(`krossi_hold_booking`, edge-funktio `krossi-booking`) päättää. Hallin henkilökunta: `/pelaa/halli/:venue`
(päivän aikajana nimillä, esteet kuten Hallisarja, peruutus + hyvitys). Näkyy toistaiseksi vain
demossa ja adminille (`screens/booking/useBookingHall.js`, LeagueScreen: `isDemo || isAdmin`).

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
(Y-tunnuksen tarkiste, IBAN mod 97). Tarkistukset `features/seasons.js` (`checkSeason` …), SQL `…105827_krossi_booking_hall_settings.sql`.
Pelaaja saa sähköpostin, kun halli hyväksyy tai hylkää hakemuksen (`krossi-billing` `seasonDecided`, `SeasonSlot.notifiedAt`). Tietokanta: `supabase/migrations/20261017105241_…` (+ Lahden seed
`…105322`), edge-funktio `krossi-billing` (kortti, kuukausiveloitukset off-session, korttien osto, laskun
sähköposti); `krossi-booking` veloittaa hinnasta lahjakorttiosuuden pois.

**Jaettu maksu ja myyntiin laitto (vaihe 4):** *Jaettu maksu* on linkki. Varaaja maksaa koko kentän
(millä tavalla tahansa, myös MobilePaylla). "Jaa maksu kavereiden kesken" (`SplitShare`: BookSheetin valmis-näkymä ja
MyBookingSheet) jakaa vuoron kahdelle tai neljälle (`SPLIT_PARTS`, `booking.split()`, `splitBlocker`: sarja- tai
lahjakortilla maksettua ei voi jakaa) ja tekee linkin `https://krossi.app/pelaa/maksa/<token>`, jonka varaaja lähettää
minne haluaa (chat näyttää sen "Maksa osuutesi" -nappina, `shareRequestOf`). Linkistä kuka tahansa maksaa yhden osuuden
ilman tiliä tai sovellusta (`SplitPayScreen`, kirjautumatta oma sivunsa; nimi vapaaehtoinen): sama kassa kuin
varatessa, maksun aloitus varaa osuuden 15 minuutiksi, ja stripe-webhook palauttaa saman summan varaajalle (toast +
kello `splitPaid`). Sivun lopussa "Löydä uutta peliseuraa" vie Krossiin. `krossi-booking-cron` (5 min) viimeistelee
vain kesken jääneet palautukset. *Laita myyntiin*: maksuttoman peruutuksen jälkeen oma vuoro myyntiin (`putOnSale`,
`venue.resale`) — se näkyy muille vapaana ("Myynnissä tänä päivänä"), sen kokonaan kattava varaus ottaa sen
normaalihintaan, ja kaikki maksut palautetaan (toast + kello). Tietokanta:
`supabase/migrations/20261017124527_krossi_booking_split_and_resale.sql`, raha:
`supabase/functions/_shared/booking.ts`.

**Hallin oma Stripe-tili (Stripe Connect Express):** jokainen maksu (varaus, kaverin osuus, kausivuoron kuukausi,
sarja- ja lahjakortti) on destination charge hallin tilille, halli myyjänä (`on_behalf_of`; ei off-session-kuukausissa,
koska kortti on tallennettu Krossin tilille). Stripe ottaa kulunsa Krossin saldosta, joten Krossin osuus =
Stripen arvioitu kulu (1,75 % + 0,36 €) + hallin kate (`platform_fee_bps` + `platform_fee_fixed_cents`); palautuksessa
raha palaa hallilta ja Krossin osuus jää (`supabase/functions/_shared/fees.ts`). Julkinen halli ilman valmista tiliä ei
ota maksuja, eikä hallia voi avata pelaajille ennen kuin tili on valmis (trigger). Krossin ylläpito yhdistää tilin
Hallin asetuksista → *Verkkomaksut* (`PayoutSheet`, edge-funktio `krossi-connect`: Account Link, paluu
`?nakyma=asetukset&tili=valmis|uusi`), ja sama sheet näyttää hallille, mitä maksu maksaa sen omilla hinnoilla
(`features/payouts.js`). Tietokanta: `supabase/migrations/20261017134522_krossi_booking_connect_fees.sql`.

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
emitiä itse (create/join/leave/cancel/send/sendPlayRequest/invite, results.save) — näkymät eivät.

## 10. Demotila

`krossi.app/demo` ajaa samaa sovellusta muistinvaraisella backendillä (`api/demo/`). Käyttäjä
on valmiiksi kirjautunut, maksanut "Demo"-pelaaja Lahdesta; seed-datassa on pelaajia,
avoimia ja menneitä pelejä, keskusteluja, tuloksia, liiga ja merkkejä. Mikään ei tallennu
(sivun lataus nollaa). Ylhäällä ohut banneri "Demotila — mikään ei tallennu · Luo oma tili".
Demon pitää näyttää elävältä: viestiin vastataan muutaman sekunnin päästä, liittyminen
täyttää pelin ja laukaisee konfetin.

**Opastus** (`screens/tour/`, `styles/tour.css`): ensimmäisellä käynnillä avautuu tervetulokortti ja
10 askeleen opastus, joka avaa sovelluksen sivut itse ja korostaa yhden kohdan kerrallaan (muu sivu
himmenee, korostus liukuu kohteesta toiseen): Omat, Varaa (paikka/päivä/kesto, vapaat ajat), Omat
varaukset -nappi ja -sivu, hallin henkilökunnan nappi, päivän aikajana, laskutus, Peliseura ja lopuksi
Profiilin *Näytä opastus*, josta opastuksen saa uudelleen. Askeleet `tourSteps.js` (kohteet
`data-tour`-attribuutteina tai luokkina), tila `tourState.js` (suljettu = localStorage
`krossi_demo_tour_done`). Ei avaudu etusivun puhelinkehyksessä (iframe); `?opastus=1` avaa aina,
`?opastus=0` ei koskaan.
