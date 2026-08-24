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
- [ ] Tarkista Supabase Dashboardin organisaatio-/laskutustiedoista, että sopimuksen
  asiakkaana on **Roisku Media** ja että tilin hyväksynyt henkilö saa sitoa yrityksen.
  Hallintarajapinta näyttää organisaation nimeksi tällä hetkellä `eeputti`, ei yrityksen
  juridista nimeä.
- [ ] Tallenna nykyisen DPA:n ja palveluehtojen PDF-kopiot, projektin alue, palvelutaso,
  asiakastieto ja tarkistuspäivä sopimusarkistoon.

## Vercel

- [x] Nykyiset [Vercelin DPA-ehdot](https://vercel.com/legal/dpa) ja
  [palveluehdot](https://vercel.com/legal/terms) tarkistettu. DPA on sisällytetty
  palvelusopimukseen viittauksella.
- [x] DPA:n nykytekstin mukaan Vercel toimii Customer Datan käsittelijänä Pro- ja
  Enterprise-palvelutasoilla. Vercelin Customer Dataan ei saa sisällyttää erityisiin
  henkilötietoryhmiin kuuluvia tietoja.
- [ ] Tarkista Vercelin hallinnasta, että tuotantoprojekti on **Pro- tai Enterprise-tilillä**.
  Jos se on Hobby-tilillä, päivitä palvelutaso ennen henkilötietopilottia.
- [ ] Tallenna DPA:n PDF/kopio, palvelutaso ja tarkistuspäivä sopimusarkistoon.

Koutsi toimitetaan Vercelistä staattisina tiedostoina. Selain lähettää varsinaiset
sovellustiedot suoraan Supabaseen; Vercel käsittelee silti tavallisia HTTP- ja
jakelulokitietoja, kuten IP-osoitetta.

## Resend

- [x] [Resendin DPA](https://resend.com/legal/dpa) tarkistettu. Sen mukaan DPA tulee
  osaksi palvelusopimusta ehtojen hyväksynnällä tai erillisellä allekirjoituksella.
- [ ] Avaa Resend Dashboard → Settings → Documents ja lataa allekirjoitettu DPA
  ([Resendin ohje](https://resend.com/docs/knowledge-base/downloading-documents)).
- [ ] Tallenna allekirjoitettu kopio sopimusarkistoon.

## Lopullinen hyväksyntä

- [ ] Supabasen asiakasnimi vahvistettu ja tosite tallennettu
- [ ] Vercelin Pro/Enterprise-palvelutaso ja DPA-kopio tallennettu
- [ ] Resendin allekirjoitettu DPA tallennettu
- [ ] Tietosuojaselosteen käsittelijä- ja sijaintitiedot tarkistettu tositteita vasten

Hyväksyjä: ____________________  Päivä: ____________________

Kun kaikki kohdat ovat valmiit, muuta tämän asiakirjan tila muotoon
`HYVÄKSYTTY HENKILÖTIETOPILOTILLE` ja säilytä hyväksytty versio tositteiden kanssa.
