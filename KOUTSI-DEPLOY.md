# Koutsi — käyttöönotto ja ylläpito

Muistilista sille, mitä `koutsi.krossi.app` vaatii toimiakseen tuotannossa.

## Buildi

Sovellussivut (`koutsi-valmentaja.html`, `koutsi-pelaaja.html`) eivät enää käännä JSX:ää
selaimessa. Ne lataavat valmiin niteen kansiosta `dist/`.

```bash
npm install
npm run test:cloudflare
```

`npm run test:cloudflare` muodostaa ensin `dist/*.js`-niteet, kokoaa vain julkiset tiedostot
`cloudflare-dist/`-hakemistoon ja tarkistaa kaikki domain- ja syvälinkkireitit. Generoitu
`cloudflare-dist/` ei kuulu versionhallintaan. Sisäiset ohjeet, `.env`-tiedostot ja
Supabase-migraatiot eivät päädy julkiseen jakeluun.

Demo-sivut (`koutsi-demo.html`, `koutsi-*-demo.html`) ja markkinointisivut käyttävät
edelleen selainkäännöstä. Se on niille tarkoituksella jätetty — ne eivät ole kriittisiä.

## Cloudflare-hostaus

Tuotanto ajetaan Cloudflare Workers Static Assets -palvelussa. Worker `krossi` säilyttää
nykyiset domainit ja Vercelin reittikäytöksen:

- `krossi.app/` → Krossin etusivu ja `/pelaa` → selainversio
- `koutsi.krossi.app/` → Koutsin etusivu sekä `/valmentaja/<näkymä>` ja
  `/pelaaja/<näkymä>` → oikea sovellus
- `demo.koutsi.krossi.app/` → demo ja vastaavat valmentaja-/pelaajareitit

Cloudflare Workers Builds -asetukset:

- Git-repositorio: `eeputti/krossi`
- tuotantohaara: `main`
- Worker-nimi: `krossi` (täsmättävä `wrangler.jsonc`-tiedoston nimeen)
- build-komento: jätä tyhjäksi
- deploy-komento: `npm run deploy:cloudflare`
- root directory: `/`

Ennen domainien siirtoa avaa Cloudflaren `workers.dev`-esikatselu ja tarkista ainakin
etusivut, `/pelaa`, Koutsin kirjautuminen, salasanan palautus, pelaajan liittymislinkki,
valmentajan ja pelaajan syvälinkit sekä demo. Liitä vasta sen jälkeen custom domainit
`krossi.app`, `koutsi.krossi.app` ja `demo.koutsi.krossi.app`. Pidä Vercel-projekti
rollbackia varten, kunnes kaikki tuotantoreitit on tarkistettu Cloudflaresta.

## Sähköposti-ilmoitukset

Ilmoitukset kirjautuvat aina `koutsi_notifications`-tauluun ja näkyvät sovelluksen
kellokuvakkeessa. **Sähköpostin lähetys on erikseen kytkettävä päälle** — ilman alla olevia
salaisuuksia jono vain kertyy eikä mitään lähde, mikä on turvallinen oletustila.

### 1. Edge-funktion salaisuudet

```bash
supabase secrets set \
  RESEND_API_KEY='<Resendin API-avain>' \
  KOUTSI_MAIL_FROM='messages@krossi.app' \
  KOUTSI_MAIL_FROM_NAME='Krossi' \
  KOUTSI_MAIL_REPLY_TO='eelispuro@gmail.com' \
  KOUTSI_CRON_KEY="$(openssl rand -hex 32)"
```

**Domain pitää vahvistaa Resendissä ensin.** Resend → Domains → Add Domain → `krossi.app`,
ja lisää sen antamat DKIM- ja SPF-tietueet DNS:ään. Ennen vahvistusta lähetys onnistuu
vain omaan osoitteeseesi, ja `email_status` jää arvoon `failed` kolmen yrityksen jälkeen.

Lähetys on tarkoituksella eriytetty muista projekteista: Koutsin viestit lähtevät vain
`krossi.app`-domainilta eivätkä koskaan minkään muun yrityksen sähköpostitilin kautta.

### 2. Vault-salaisuudet ajastusta varten

Aja SQL-editorissa. `koutsi_cron_key` **täytyy olla sama arvo** kuin `KOUTSI_CRON_KEY` yllä.

```sql
select vault.create_secret(
  'https://hhybjpgrvlbazbqiaaao.supabase.co/functions/v1/koutsi-notify',
  'koutsi_notify_url'
);
select vault.create_secret('<sama arvo kuin KOUTSI_CRON_KEY>', 'koutsi_cron_key');
```

Ajastus (`koutsi-notify-dispatch`, viiden minuutin välein) on jo luotu. Se on no-op niin
kauan kuin nämä kaksi salaisuutta puuttuvat.

### 3. Testaus

```sql
select public.koutsi_dispatch_notification_emails();
select id, kind, email_status, email_error from koutsi_notifications order by created_at desc limit 10;
```

`email_status` etenee `pending` → `sent`. `skipped` tarkoittaa, että vastaanottaja on
kytkenyt sähköpostit pois tai hänellä ei ole osoitetta. `failed` näkyy kolmen epäonnistuneen
yrityksen jälkeen, ja syy on `email_error`-sarakkeessa.

## Ennen oikeiden henkilötietojen pilottia

**Pilotin tila on BLOKATTU**, kunnes [KOUTSI-DPA-CHECKLIST.md](KOUTSI-DPA-CHECKLIST.md)
on kokonaan täytetty ja hyväksytty. Julkaistujen ehtojen tarkistus ei yksin todista, että
Roisku Median tilillä vaadittu hyväksyntä, palvelutaso ja sopimusarkistointi ovat kunnossa.
Kun lista on valmis, ensimmäisen valmentajan opastus tehdään
[pilottiohjeen](KOUTSI-PILOTTI-OHJE.md) mukaan.

Pilottiin voi lisätä kaikenikäisiä pelaajia pelkällä nimellä. Tarkka ikä on vapaaehtoinen:
valmentaja voi lisätä sen pelaajariville tai pelaaja omaan profiiliinsa myöhemmin. Jos ikää
ei anneta, Koutsi ei tallenna eikä päättele ikää tai ikäryhmää. Syntymäaikaa,
henkilöllisyystodistusta tai huoltajan yhteystietoja ei kerätä.

Migraatio `20260824204654_remove_required_player_age_groups.sql` poistaa ikäryhmän
pakollisuuden ja lopettaa uusien ikäryhmäarvojen tallentamisen, säilyttää tarkan iän
vapaaehtoisena sekä pitää terveystietojen tallennuskiellon tietokantatasolla. Aiemmat
pilottivahvistukset säilyvät historiatietona. Asiakirjaversiot ja terveystietosäännön
vahvistus tallentuvat edelleen `koutsi_pilot_acknowledgements`-tauluun.

Taustatietokenttä, loukkaantumismerkintä ja vapaaehtoinen poissaolosyy on poistettu
käyttöliittymästä: poissaolosta tallennetaan vain tieto "poissa", ei syytä.

Migraatio `20260824052633_koutsi_adult_pilot_acknowledgement_and_health_lock.sql` tyhjentää
vanhan sekakäyttöisen `background`-kentän. Tuotannossa jo käytössä oleva migraatio
`20260823170209_add_attendance_details_and_player_reporting.sql` loi läsnäolorivin tekniset
lisäkentät. Sen jälkeen ajettava
`20260824052642_koutsi_close_attendance_health_exception.sql` muuntaa mahdolliset vanhat
`vamma`-merkinnät tavallisiksi poissaoloiksi, tyhjentää poissaolon syyt ja estää niiden
tallentamisen myös vanhalla käyttöliittymällä tai suoralla API-kutsulla.

## Vielä tehtäväksi jäävät asetukset

- **Salasanapolitiikka (valmis):** tuotannon Auth-palvelimen vähimmäispituudeksi asetettiin 8
  merkkiä. Suljetussa betassa käytetään tarkoituksella Supabasen asetusta
  `No required characters`; vuotaneiden salasanojen maksullinen tarkistus on käsitelty
  erikseen alla. Palvelintesti 25.8.2026 hylkäsi 7-merkkisen salasanan ja tietokannasta
  vahvistettiin, ettei testikäyttäjiä jäänyt. Sovellus vaatii rekisteröinnissä ja
  salasanan palautuksessa saman 8 merkkiä.
- **Sähköpostivahvistus (väliaikaisesti pois päältä 2.9.2026):** `Confirm email` otettiin
  käyttöön 25.8.2026, mutta koska Resendin `krossi.app`-domain ei ollut vielä varmennettu,
  vahvistusviestit eivät menneet perille muille kuin omaan osoitteeseen — uudet käyttäjät
  (mm. pilottivalmentajat) jäivät jumiin vahvistusruutuun. Kytketty pois Dashboardista
  2.9.2026 ennen ensimmäistä valmentajapuhelua: Authentication → Providers → Email →
  `Confirm email` = pois. Uudet tilit aktivoituvat nyt ilman sähköpostivahvistusta.
  **Kytke takaisin päälle heti kun Resendin domain on varmennettu**, ettei tuotanto jää
  pysyvästi ilman vahvistusta.
- **Vuotaneiden salasanojen esto (siirretty)**: ominaisuus kuuluu Supabasen Pro-tasoon,
  joten sitä ei oteta käyttöön Free-tasolla ajettavassa ensimmäisessä pilotissa. Jos
  organisaatio päivitetään myöhemmin Prohon, kytke Authentication → Policies →
  "Leaked password protection" päälle. Päätös tarkistettu 24.8.2026 Supabasen
  salasanasuojausohjetta vasten.
- **Tietosuojaseloste ja käyttöehdot** (`/tietosuoja`, `/kayttoehdot`) on kirjoitettu
  tämänhetkisen toteutuksen mukaisiksi. Rekisterinpitäjänä ja palveluntarjoajana on
  Roisku Media (Y-tunnus 3413406-6, Rauhankatu 10 C 809, 15110 Lahti). Jos mukaan tulee
  seurayhteistyötä — eli seura päättää mitä oppilaista kirjataan — rekisterinpitäjän ja
  käsittelijän roolit menevät uusiksi ja ne kannattaa tarkistuttaa juristilla.
- **Käsittelysopimukset (DPA):** seuraa erillistä
  [DPA-tarkistuslistaa](KOUTSI-DPA-CHECKLIST.md). Älä kutsu ulkopuolisia testaajia ennen
  sen lopullista hyväksyntää.

## Valmentaja-avaimet

Uusi valmentaja tarvitsee avaimen taulusta `koutsi_coach_invite_codes`. Avain on
kertakäyttöinen (`max_uses` oletuksena 1) ja lunastus luo samalla valmentajalle
harjoitepankin `koutsi_exercise_templates`-taulun pohjalta.

```sql
insert into koutsi_coach_invite_codes (code, note, expires_at, max_uses)
values (upper('esim-avain-tahan'), 'Matti Meikäläinen / Lahden Tennisseura', now() + interval '30 days', 1);
```

Taulussa on RLS päällä ilman politiikkoja: siihen pääsee vain SQL-editorista tai
service-rolella, ei koskaan selaimesta. Sama koskee `koutsi_admins`-taulua.

## Pelaajien kutsuminen suljettuun pilottiin

Uusi pelaaja pääsee pilottiin vain valmentajan liittymiskoodilla. Käyttöliittymän
”Jatka ilman koodia” -polku on poistettu, ja migraatio peruu authenticated-roolilta
`start_koutsi_without_code()`-funktion suoritusoikeuden. Aiemmin luotuja pelaajarivejä ei
poisteta automaattisesti.

Yhteistä valmentajakoodia ei saa jakaa julkisessa ryhmässä tai avoimella verkkosivulla.
Valmentaja voi lisätä pelaajan ensin pelkällä nimellä ja lähettää pelaajakortilta
henkilökohtaisen linkin. Pelaajan ei tarvitse ilmoittaa ikäänsä liittyessä tai myöhemmin.

## Vuosisuunnitelmat (beta)

Valmentajan lataama vuosisuunnitelma ei mene suoraan käyttöön. Tiedosto tallentuu
`koutsi-plans`-säiliöön ja ryhmän tila jää arvoon `annual_plan_status = 'review'`.
Jokainen `koutsi_admins`-taulussa oleva käyttäjä saa siitä ilmoituksen (sovelluksessa ja
sähköpostilla), ja ilmoituksen tekstissä on tiedostonimi sekä polku säiliössä.

Käsittely tapahtuu sovelluksessa: valmentajanäkymän **Profiili**-välilehdellä on
`koutsi_admins`-käyttäjille kortti "Odottavat vuosisuunnitelmat". Siitä tiedoston voi avata
(**Avaa**) ja merkitä lisätyksi (**Merkitse lisätyksi**) — jälkimmäinen lähettää
valmentajalle ilmoituksen ja vaihtaa merkinnän tilaan "Käytössä". Kortti on näkymätön
kaikille muille. Tiedoston avaaminen nojaa `koutsi_plans_object_admin_select`
-storage-politiikkaan; ilman sitä allekirjoitettu linkki ei aukea muun valmentajan
suunnitelmaan.

Sama SQL:llä, jos sovellukseen ei pääse:

```sql
select * from koutsi_pending_annual_plans();
```

```sql
select koutsi_publish_annual_plan('<ryhman-uuid>');
```

Käsittelijän lisääminen tai vaihtaminen:

```sql
insert into koutsi_admins (user_id) select id from auth.users where email = 'joku@esimerkki.fi';
```

## Viikkoteemat

Ryhmän viikkoteemat ovat taulussa `koutsi_group_themes`, avaimena ISO-viikko
(`iso_year` + `iso_week`). Valmentaja suunnittelee ne ryhmänäkymästä, useamman viikon
kerralla; pelaajalle näytetään aina kuluvan viikon teema ja seuraavat suunnitellut.
Vanhat `koutsi_groups.theme_title` / `theme_lead` -sarakkeet ovat käytöstä poistuneita,
ja niiden sisältö siirrettiin migraatiossa kuluvan viikon riviksi.

## Ylläpitäjän toiminnot

`koutsi_admins`-taulussa olevat käyttäjät näkevät valmentajanäkymän Profiili-välilehdellä
listan odottavista vuosisuunnitelmista sekä napit "Avaa" ja "Merkitse lisätyksi". Aiemmin
julkaisu oli käsin kirjoitettu UPDATE SQL-editorissa; se toimii yhä, mutta ei ole enää
tarpeen.

```sql
insert into koutsi_admins (user_id) select id from auth.users where email = 'joku@esimerkki.fi';
```

## Ylläpitäjä valmentajan näkymässä

Ylläpito-välilehden valmentajakortissa on **Avaa näkymä**. Se vaihtaa koko valmentaja-
sovelluksen kyseisen valmentajan tietoihin: pelaajat, ryhmät, treenit, harjoitteet ja
kutsukoodit ovat hänen, ja kaikki mitä lisäät tallentuu hänen nimissään. Ruudun ylälaidassa
on ruskea palkki, joka kertoo kenen näkymässä olet, ja josta pääsee takaisin omaan.
Näkymä avautuu aina Oppilaat-välilehdelle ja paluu vie takaisin Ylläpitoon. Profiili-
välilehti, ilmoitukset, ilmoitusasetukset, tilin poisto ja uloskirjautuminen eivät ole
käytettävissä acting-tilassa. Myös `sessionStorage`-kohde tarkistetaan palvelimelta uudelleen
ennen kuin kohdevalmentajan tietoja ladataan.

Rajaus on kannassa, ei käyttöliittymässä: kaikki valmentajan puolen politiikat käyttävät
funktiota `koutsi_acts_as(coach_id)`, joka päästää läpi joko omistajan tai ylläpitäjän.
Taulut `profiles` ja `koutsi_coaches` jäivät tarkoituksella ennalleen, joten **valmentajan
omia profiilitietoja, ilmoitusasetuksia tai tiliä ei pääse muokkaamaan** — ei
käyttöliittymästä eikä suoralla kutsulla.

```sql
-- yksi käsite, jota jokainen valmentajan puolen politiikka kutsuu
create or replace function public.koutsi_acts_as(target uuid)
returns boolean language sql stable security definer set search_path to ''
as $$ select target is not null and (target = (select auth.uid()) or public.koutsi_is_admin()); $$;
```

Funktiot `create_koutsi_invite_code`, `koutsi_create_player` ja `koutsi_seed_exercises`
ottavat valinnaisen valmentajan id:n; muu kuin oma id vaatii ylläpitäjän oikeudet.

Jokainen onnistunut näkymän avaus (myös tallennetun acting-tilan palautus) kirjautuu tauluun
`koutsi_admin_actions`:

```sql
select a.created_at, p.name as valmentaja
  from koutsi_admin_actions a left join profiles p on p.id = a.coach_id
 order by a.created_at desc limit 20;
```

Auditoinnin rajaus on tärkeä: taulu kirjaa **acting-näkymän avaukset**, ei jokaista sen
jälkeen tehtyä lisäystä, muokkausta tai poistoa. Varsinaiset rivimuutokset näkyvät taulujen
omissa `created_at`/`updated_at`-kentissä silloin kun sellainen kenttä on olemassa, mutta ne
eivät muodosta kattavaa ylläpitäjäkohtaista audit-lokia.

Tämän toiminnon loppuunvienti, pelaajan rajattu ryhmärosteri sekä ylläpitäjän tarkasti
rajatut Storage-politiikat ovat versionoitu migraatiossa
`supabase/migrations/20260823131111_finish_admin_acting_and_player_roster.sql`.

### Käyttäjähallinta ja tilankäyttö

Ylläpito-välilehti listaa kaikki Auth-käyttäjät ja näyttää erikseen roolit **Ylläpitäjä**,
**Valmentaja** ja **Pelaaja**. Käyttäjiä voi hakea nimellä tai sähköpostilla ja suodattaa
roolin mukaan. `koutsi_admin_users()` lukee sähköpostit `auth.users`-taulusta ja laskee
käyttäjäkohtaisen Storage-käytön `storage.objects.metadata.size`-kentästä; tavallinen
kirjautunut käyttäjä ei saa kumpaankaan tauluun suoraa lukuoikeutta. Valmentajalle
kohdistetaan myös hänen ryhmiensä `koutsi-plans`-tiedostot, vaikka tiedoston olisi ladannut
ylläpitäjä hänen puolestaan.

**Poista tili** vaatii vahvistukseksi käyttäjän sähköpostiosoitteen. Selain kutsuu
JWT-suojattua `koutsi-admin-delete-user`-Edge Functionia, joka tarkistaa kutsujan
`koutsi_admins`-jäsenyyden palvelimella, estää oman sekä kaikkien ylläpitäjätilien poiston,
poistaa käyttäjälle kohdistetut Storage-objektit ja vasta sitten Auth-käyttäjän. Auth-poisto
poistaa viiteavainten `ON DELETE CASCADE` -säännöillä myös profiilin ja Koutsi-rivit.
Poistosta jää henkilötiedot minimoiva audit-rivi tauluun `koutsi_admin_deletions`; taulu on
RLS-suojattu eikä sitä voi lukea asiakassovelluksesta.

Toteutus on migraatioissa `20260823165750_admin_user_management.sql` ja
`20260823165948_tighten_admin_deletion_audit.sql`. Edge Function julkaistaan näin:

```bash
supabase functions deploy koutsi-admin-delete-user --project-ref hhybjpgrvlbazbqiaaao
```

## Pelaajan ryhmärosteri

Pelaaja ei saa laajaa SELECT-oikeutta muiden `koutsi_students`-riveihin. Ryhmäkortti hakee
aktiiviset ryhmäläiset RPC:llä `koutsi_player_group_roster()`, joka palauttaa vain ryhmän id:n,
pelaajan id:n, nimen, `avatar_url`:n ja tason. Funktio vaatii, että sekä kutsujan että
palautettavan ryhmäläisen jäsenyys ja valmennussuhde kyseisen ryhmän valmentajaan ovat
aktiivisia. Tavoitteita, taustatietoja, fiiliksiä, muistiinpanoja tai muuta valmennusdataa
ei palauteta.

## Omien tietojen lataus

Sekä valmentaja että pelaaja voivat ladata kaikki heille näkyvät tiedot yhtenä
JSON-tiedostona Profiili-välilehdeltä. Tämä kattaa GDPR:n tarkastus- ja siirto-oikeuden,
joten yksittäinen pyyntö ei vaadi käsityötä. Vienti kunnioittaa RLS:ää — se ei voi
palauttaa mitään, mitä käyttäjä ei jo näe sovelluksessa.

## Tallennussäiliöt

| Säiliö | Sisältö | Katto | Näkyvyys |
|---|---|---|---|
| `koutsi-videos` | Lyhyet treenivideot | 50 Mt / tiedosto | Vain videolle valitut pelaajat + heidän valmentajansa, `koutsi_videos`-rivien kautta |
| `koutsi-plans` | Ryhmien vuosisuunnitelmat | 20 Mt / tiedosto | Ryhmän valmentaja + jäsenet |

Molemmat ovat yksityisiä. Tiedostot avataan määräaikaisilla allekirjoitetuilla linkeillä,
eli suora URL ei toimi ilman kirjautumista.

Yli 6 Mt videot ladataan TUS-protokollalla 6 Mt paloissa suoraan selaimesta Supabasen
dedikoituun Storage-osoitteeseen. Lataus ei kierrä Cloudflaren tai oman sovelluspalvelimen
kautta, näyttää etenemisen ja jatkaa katkenneesta kohdasta. Pitkät pelianalyysit (esim.
30 min) jaetaan ensisijaisesti rajattuna YouTube- tai Google Drive -linkkinä. Näin Koutsi
ei maksa eikä välitä niiden raskasta tallennus- ja katseluliikennettä; linkkirivi näkyy
silti vain valmentajan valitsemille vastaanottajille.

Yksi tiedosto tallennetaan vain kerran. `koutsi_videos.share_id` ryhmittää sen
vastaanottajarivit, ja valmentaja voi muuttaa näkyvyyttä jälkikäteen atomisella
`koutsi_set_video_recipients`-RPC:llä ilman uutta latausta tai tiedostokopioita.

Acting-tilan lisäpolitiikat ovat `TO authenticated`, mutta pelkkä kirjautuminen ei riitä:
niissä vaaditaan aina `koutsi_is_admin()` ja Storage-polun ensimmäisen kansion pitää vastata
olemassa olevaa, arkistoimatonta Koutsi-valmentajaa (`koutsi-videos`) tai tämän olemassa
olevaa ryhmää (`koutsi-plans`). Vuosisuunnitelman korvaus käyttää samaa Storage-avainta
upsertilla; poiston epäonnistuessa metatiedot palautetaan, jotta objektia ei jätetä orvoksi.

## Security advisor

Supabasen security advisor ilmoittaa tarkoituksella INFO-tasolla, että tauluilla
`koutsi_admins` ja `koutsi_coach_invite_codes` on RLS ilman politiikkoja. Se on näissä
kahdessa taulussa deny-all-oletus selaimelle: niitä hallitaan vain migraatioilla,
SQL-editorilla tai service rolella.

Advisor ilmoittaa myös WARN-tasolla selaimelle tarkoituksella julkaistuista
`SECURITY DEFINER` -RPC:istä. Koutsin RPC:t on rajattu `authenticated`-roolille,
anonin ja `PUBLIC`in EXECUTE on poistettu, `search_path` on kiinteä ja oikeus tarkistetaan
funktion sisällä `auth.uid()`- sekä omistaja-, jäsenyys- tai `koutsi_admins`-ehdolla.
Varoitus on siis tarkistusmuistutus, ei lupa poistaa näitä sovelluksen tarvitsemia
EXECUTE-oikeuksia ilman korvaavaa rajapintaa.
