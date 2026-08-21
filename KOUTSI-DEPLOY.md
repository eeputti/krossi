# Koutsi — käyttöönotto ja ylläpito

Muistilista sille, mitä `koutsi.krossi.app` vaatii toimiakseen tuotannossa.

## Buildi

Sovellussivut (`koutsi-valmentaja.html`, `koutsi-pelaaja.html`) eivät enää käännä JSX:ää
selaimessa. Ne lataavat valmiin niteen kansiosta `dist/`.

```bash
npm install
npm run build
```

`dist/` on **committoitu repoon**, joten Vercel tarjoilee sivut edelleen staattisina eikä
buildivaihetta tarvita. Aja `npm run build` aina kun olet muokannut mitään `lib/`-kansiossa,
ja committoi syntyneet `dist/*.js`-tiedostot muutoksen mukana. Jos unohdat, sivusto pyörii
vanhalla koodilla.

Demo-sivut (`koutsi-demo.html`, `koutsi-*-demo.html`) ja markkinointisivut käyttävät
edelleen selainkäännöstä. Se on niille tarkoituksella jätetty — ne eivät ole kriittisiä.

## Sähköposti-ilmoitukset

Ilmoitukset kirjautuvat aina `koutsi_notifications`-tauluun ja näkyvät sovelluksen
kellokuvakkeessa. **Sähköpostin lähetys on erikseen kytkettävä päälle** — ilman alla olevia
salaisuuksia jono vain kertyy eikä mitään lähde, mikä on turvallinen oletustila.

### 1. Edge-funktion salaisuudet

```bash
supabase secrets set \
  RESEND_API_KEY='<Resendin API-avain>' \
  KOUTSI_MAIL_FROM='koutsi@krossi.app' \
  KOUTSI_MAIL_FROM_NAME='Krossi Koutsi' \
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

## Vielä tehtäväksi jäävät asetukset

- **Vuotaneiden salasanojen esto**: Supabase-hallinnassa Authentication → Policies →
  "Leaked password protection" päälle. Tätä ei voi asettaa migraatiolla.
- **Tietosuojaseloste ja käyttöehdot** (`/tietosuoja`, `/kayttoehdot`) on kirjoitettu
  tämänhetkisen toteutuksen mukaisiksi. Rekisterinpitäjänä ja palveluntarjoajana on
  Roisku Media (Y-tunnus 3413406-6, Rauhankatu 10 C 809, 15110 Lahti). Jos mukaan tulee
  seurayhteistyötä — eli seura päättää mitä oppilaista kirjataan — rekisterinpitäjän ja
  käsittelijän roolit menevät uusiksi ja ne kannattaa tarkistuttaa juristilla.
- **Käsittelysopimukset (DPA)** Supabasen, Vercelin ja Resendin kanssa: tarkista että ne ovat
  voimassa ennen kuin alaikäisten tietoja kertyy oikeasti.

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

## Pelaaja ilman liittymiskoodia

Pelaaja pääsee `/pelaaja`-portista sisään myös ilman valmentajan koodia ("Jatka ilman
koodia"). Se tarvitsee funktion `start_koutsi_without_code()`, koska `koutsi_students`-
taulussa ei ole INSERT-politiikkaa — rivit syntyvät vain SECURITY DEFINER -funktioista.
Funktio on jo tuotantokannassa; tässä se siltä varalta, että kanta rakennetaan uudelleen:

```sql
create or replace function public.start_koutsi_without_code()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'authentication required';
  end if;
  if not exists (select 1 from profiles where id = v_uid) then
    raise exception 'profile required';
  end if;

  insert into koutsi_students (id) values (v_uid) on conflict (id) do nothing;

  return jsonb_build_object('ok', true);
end;
$function$;

revoke all on function public.start_koutsi_without_code() from public, anon;
grant execute on function public.start_koutsi_without_code() to authenticated;
```

Tällainen pelaaja näkyy `koutsi_students`-taulussa ilman riviä `koutsi_coach_students`-
taulussa. Sovellus on hänelle tyhjä ja tarjoaa koodikenttää Ryhmä-välilehdellä; koodin
lunastus liittää hänet valmentajaan ja kaikki hänen omat merkintänsä säilyvät.

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

## Omien tietojen lataus

Sekä valmentaja että pelaaja voivat ladata kaikki heille näkyvät tiedot yhtenä
JSON-tiedostona Profiili-välilehdeltä. Tämä kattaa GDPR:n tarkastus- ja siirto-oikeuden,
joten yksittäinen pyyntö ei vaadi käsityötä. Vienti kunnioittaa RLS:ää — se ei voi
palauttaa mitään, mitä käyttäjä ei jo näe sovelluksessa.

## Tallennussäiliöt

| Säiliö | Sisältö | Katto | Näkyvyys |
|---|---|---|---|
| `koutsi-videos` | Treenivideot | 200 Mt / tiedosto | Pelaaja + hänen valmentajansa, `koutsi_videos`-rivien kautta |
| `koutsi-plans` | Ryhmien vuosisuunnitelmat | 20 Mt / tiedosto | Ryhmän valmentaja + jäsenet |

Molemmat ovat yksityisiä. Tiedostot avataan määräaikaisilla allekirjoitetuilla linkeillä,
eli suora URL ei toimi ilman kirjautumista.
