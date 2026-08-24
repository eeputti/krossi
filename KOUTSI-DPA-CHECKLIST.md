# Koutsi — DPA-tarkistus ennen ulkopuolista pilottia

Päivitetty 24.8.2026. Tämä asiakirja erottaa toisistaan palveluntarjoajan julkaistujen
ehtojen tarkistamisen ja Roisku Median oman tilin asiakastiedot, palvelutason sekä
sopimustositteen. Koodista tai julkiselta verkkosivulta ei voi todentaa kaikkia näitä
tilikohtaisia tietoja.

**Tila: ULKOPUOLINEN PILOTTI EI OLE VIELÄ HYVÄKSYTTY HENKILÖTIEDOILLE.** Kaikki alla
olevat kohdat merkitään tehdyiksi ja tositteet tallennetaan samaan sopimusarkistoon ennen
kuin valmentajalle annetaan lupa käyttää oikeita nimiä, sähköpostiosoitteita, kuvia tai
videoita.

## Supabase

- [x] Tuotantoprojektin alue ja palvelutaso tarkistettu: `eu-west-1`, Free (Supabase-projekti
  `hhybjpgrvlbazbqiaaao`, tarkistettu 24.8.2026).
- [x] [Nykyinen DPA](https://supabase.com/legal/customer-resources/data-processing-addendum)
  (versio 1, 1.8.2026) ja [palveluehdot](https://supabase.com/terms) tarkistettu. DPA on
  sisällytetty palvelusopimukseen ja tulee voimaan palvelusopimuksen voimaantulopäivänä;
  erillistä vanhaa PDF-allekirjoitusta ei nykytekstin mukaan tarvita.
- [x] Tarkista Supabase Dashboardin organisaatio-/laskutustiedoista, että sopimuksen
  asiakkaana on **Roisku Media** ja että tilin hyväksynyt henkilö saa sitoa yrityksen.
  Hallintarajapinta näyttää organisaation nimeksi `Roisku Media` (varmistettu
  24.8.2026). Tilin haltija vahvisti 24.8.2026, että hänellä on oikeus tehdä
  palvelusopimukset Roisku Median puolesta.
- [x] Nykyisen DPA:n ja palveluehtojen 24.8.2026 päivätyt PDF-kopiot tallennettu
  yksityiseen sopimusarkistoon: `Roisku Media / Sopimusarkisto / Koutsi – 2026-08-24`.
  Latauksen jälkeen varmistettu, että molempien tiedostojen näkyvyys on `not_shared`.
- [x] Projektin alueen, palvelutason, asiakastiedon ja tarkistuspäivän sisältävä
  tilitosite tallennettu samaan yksityiseen sopimusarkistoon 24.8.2026. Latauksen
  jälkeen varmistettu, että tiedoston näkyvyys on `not_shared`.

## Vercel (poistuva hosti)

- [x] Nykyiset [Vercelin DPA-ehdot](https://vercel.com/legal/dpa) ja
  [palveluehdot](https://vercel.com/legal/terms) tarkistettu. DPA on sisällytetty
  palvelusopimukseen viittauksella.
- [x] DPA:n nykytekstin mukaan Vercel toimii Customer Datan käsittelijänä Pro- ja
  Enterprise-palvelutasoilla. Vercelin Customer Dataan ei saa sisällyttää erityisiin
  henkilötietoryhmiin kuuluvia tietoja.
- [x] Tuotantoprojektin palvelutasoksi vahvistettu **Hobby** 24.8.2026. Verceliä ei
  päivitetä Prohon, vaan tuotantohostaus siirretään Cloudflareen kustannussyistä.
- [ ] Viimeistele Vercel → Cloudflare -siirto ennen henkilötietopilottia ja varmista,
  ettei tuotantoliikennettä tai lokitietoja enää käsitellä Vercelissä.
- [ ] Varmista domainien siirron jälkeen, etteivät `krossi.app`, `koutsi.krossi.app` tai
  `demo.koutsi.krossi.app` enää osoita Verceliin. Säilytä Vercel vain lyhyenä rollbackina
  ja poista projekti sekä domain-liitokset hyväksytyn tuotantotestin jälkeen.

## Cloudflare

- [x] [Cloudflaren DPA](https://www.cloudflare.com/cloudflare-customer-dpa/) (versio 6.4,
  3.4.2026) ja [Self-Serve Subscription Agreement](https://www.cloudflare.com/terms/)
  tarkistettu 24.8.2026. Cloudflaren nykyisen GDPR-ohjeen mukaan standardi-DPA on
  sisällytetty self-service-sopimukseen, ja DPA sisältää EU:n vakiolausekkeet.
- [x] Tekninen toteutus rajattu Workers Static Assets -jakeluun ja pieneen
  domain-/polkureitittimeen. Sovellusdata ja tiedostolataukset menevät selaimesta suoraan
  Supabaseen eivätkä kulje Cloudflare Workerin kautta.
- [ ] Tarkista Cloudflare Dashboardista, että tilin juridinen asiakas on **Roisku Media**,
  tilin hyväksynyt henkilö saa sitoa yrityksen ja tuotanto-Worker käyttää Free-tasoa.
- [ ] Tallenna DPA:n, self-service-ehtojen ja alikäsittelijäluettelon päivätyt kopiot sekä
  tilin asiakas- ja palvelutasotosite yksityiseen sopimusarkistoon.
- [ ] Tarkista Cloudflaren tuotantoasetuksista käytössä olevat lokit ja niiden säilytysajat
  tietosuojaselosteen enintään 90 vuorokauden lupauksen kanssa.

Koutsi toimitetaan Cloudflaresta staattisina tiedostoina. Selain lähettää varsinaiset
sovellustiedot suoraan Supabaseen; Cloudflare käsittelee silti tavallisia HTTP- ja
jakelulokitietoja, kuten IP-osoitetta.

## Resend

- [x] [Resendin DPA](https://resend.com/legal/dpa) tarkistettu. Sen mukaan DPA tulee
  osaksi palvelusopimusta ehtojen hyväksynnällä tai erillisellä allekirjoituksella.
- [x] Resend Dashboard → Settings → Documents -näkymästä ladattu allekirjoitettu DPA
  ([Resendin ohje](https://resend.com/docs/knowledge-base/downloading-documents)).
  Plus Five Five, Inc. on allekirjoittanut asiakirjan DocuSignin kautta 14.1.2026;
  allekirjoituksen eheys ja sallitut varmennuspäivitykset tarkistettu 24.8.2026.
- [x] Allekirjoitettu DPA tallennettu yksityiseen sopimusarkistoon 24.8.2026.
  Samalla tallennettu Resendin penetraatiotestin varmennuskirje ja SOC 2 Type II
  -raportti. Latauksen jälkeen kaikkien kolmen tiedoston näkyvyydeksi vahvistettu
  `not_shared`. W-9 jätettiin tarkoituksella arkiston ulkopuolelle, koska se ei ole
  Koutsin käyttöönoton tosite ja sisältää verotunnisteen.

## Lopullinen hyväksyntä

- [x] Supabasen asiakasnimi vahvistettu ja tosite tallennettu
- [ ] Tuotantohostaus siirretty Cloudflareen ja Cloudflaren palvelutaso sekä DPA-tosite
  tallennettu
- [x] Resendin allekirjoitettu DPA tallennettu
- [ ] Tietosuojaselosteen käsittelijä- ja sijaintitiedot tarkistettu tositteita vasten

Hyväksyjä: ____________________  Päivä: ____________________

Kun kaikki kohdat ovat valmiit, muuta tämän asiakirjan tila muotoon
`HYVÄKSYTTY HENKILÖTIETOPILOTILLE` ja säilytä hyväksytty versio tositteiden kanssa.
