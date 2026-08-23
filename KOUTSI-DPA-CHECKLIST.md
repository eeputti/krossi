# Koutsi — DPA-tarkistus ennen ulkopuolista pilottia

Päivitetty 23.8.2026. Tämä asiakirja erottaa toisistaan palveluntarjoajan julkaistujen
ehtojen tarkistamisen ja Roisku Median omalla tilillä tehdyn hyväksynnän. Koodista tai
julkiselta verkkosivulta ei voi todentaa, että tilinomistaja on hyväksynyt tai arkistoinut
sopimuksen.

**Tila: ULKOPUOLINEN PILOTTI EI OLE VIELÄ HYVÄKSYTTY HENKILÖTIEDOILLE.** Kaikki alla
olevat kohdat merkitään tehdyiksi ja tositteet tallennetaan samaan sopimusarkistoon ennen
kuin valmentajalle annetaan lupa käyttää oikeita nimiä, sähköpostiosoitteita, kuvia tai
videoita.

## Supabase

- [x] Tuotantoprojektin alue tarkistettu: `eu-west-1` (Supabase-projekti
  `hhybjpgrvlbazbqiaaao`, tarkistettu 23.8.2026).
- [x] Nykyinen DPA tarkistettu. Se muodostaa osan palvelusopimusta siitä päivästä, kun
  asiakas allekirjoittaa tai muuten hyväksyy DPA:n.
- [ ] Lataa, täytä ja hyväksy/allekirjoita
  [Supabasen nykyinen DPA](https://supabase.com/downloads/docs/Supabase%2BDPA%2B260317.pdf).
- [ ] Tallenna hyväksytty tai allekirjoitettu kopio sopimusarkistoon.

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
- [ ] Avaa Resend Dashboard → Settings → Legal ja lataa allekirjoitettu DPA
  ([Resendin ohje](https://resend.com/docs/knowledge-base/downloading-documents)).
- [ ] Tallenna allekirjoitettu kopio sopimusarkistoon.

## Lopullinen hyväksyntä

- [ ] Supabase-tosite tallennettu
- [ ] Vercelin Pro/Enterprise-palvelutaso ja DPA-kopio tallennettu
- [ ] Resendin allekirjoitettu DPA tallennettu
- [ ] Tietosuojaselosteen käsittelijä- ja sijaintitiedot tarkistettu tositteita vasten

Hyväksyjä: ____________________  Päivä: ____________________

Kun kaikki kohdat ovat valmiit, muuta tämän asiakirjan tila muotoon
`HYVÄKSYTTY HENKILÖTIETOPILOTILLE` ja säilytä hyväksytty versio tositteiden kanssa.
