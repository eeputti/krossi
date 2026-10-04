// LegalSheet — SHARED component. Owner: auth agent (wave 2). Other screens import it with exactly this interface:
//   <LegalSheet open onClose={fn} doc='terms'|'privacy' />  — Krossin käyttöehdot / tietosuojaseloste (texts ported verbatim from the legacy app)
import { useEffect, useRef, useState } from 'react';
import { SUPPORT_EMAIL } from '../../lib/constants.js';
import { Button, Segmented, Sheet } from '../../ui/index.js';

const VALID_FROM = 'Voimassa 9.7.2026 alkaen';
const Mail = () => <a className="auth-legal-mail" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>;

const DOCS = {
  terms: {
    title: 'Krossin käyttöehdot',
    sections: [
      ['1. Palvelun kuvaus', 'Krossi on palvelu, jonka avulla käyttäjät löytävät pelikavereita tennikseen: selaavat pelaajaprofiileja, sopivat pelejä ja liittyvät toisten luomiin haasteisiin. Krossi ei omista kenttiä eikä ole osapuolena käyttäjien välisissä peleissä tai tapaamisissa.'],
      ['2. Käyttäjätili', 'Tilin luominen edellyttää, että annat itsestäsi oikeat tiedot etkä esiinny toisena henkilönä. Palvelu on tarkoitettu vähintään 16-vuotiaille. Vastaat itse tilisi ja salasanasi säilyttämisestä.'],
      ['3. Käyttäytyminen', 'Käytä palvelua asiallisesti. Häirintä, uhkailu, syrjivä käytös tai väärän tiedon antaminen muista käyttäjistä ei ole sallittua. Voit ilmoittaa sopimattomasta käytöksestä palvelun sisäisellä ilmoitustoiminnolla, ja Krossi voi tämän perusteella rajoittaa tai poistaa käyttöoikeuden.'],
      ['4. Tapaamiset ja vastuu', 'Krossi ei tarkista käyttäjien taustoja. Tapaamisia toisten käyttäjien kanssa varten kannattaa käyttää tervettä järkeä, esimerkiksi sopia ensimmäinen tapaaminen julkiselle kentälle. Krossi ei vastaa käyttäjien välisistä sopimuksista, peleistä tai niiden aikana sattuneista vahingoista.'],
      ['5. Sisältö', 'Vastaat itse jakamastasi sisällöstä (profiilikuva, bio, viestit). Et saa jakaa laitonta, loukkaavaa tai muiden oikeuksia loukkaavaa sisältöä.'],
      ['6. Tilin poistaminen', 'Voit poistaa tilisi milloin tahansa ottamalla yhteyttä alla olevaan osoitteeseen. Krossi voi sulkea tilin, jos näitä ehtoja rikotaan.'],
      ['7. Muutokset', 'Näitä ehtoja voidaan päivittää palvelun kehittyessä. Olennaisista muutoksista pyritään ilmoittamaan palvelussa.'],
      ['8. Yhteystiedot', <>Kysymykset: <Mail /></>],
    ],
  },
  privacy: {
    title: 'Tietosuojaseloste',
    sections: [
      ['Rekisterinpitäjä', <>Krossi. Yhteydenotot tietosuoja-asioissa: <Mail /></>],
      ['Mitä tietoja käsittelemme', 'Tiliin liittyvät tiedot (sähköposti), profiilitiedot (nimi, ikäryhmä, kotikaupunki, profiilikuva, pelitaso, kilpailuluokka, pelitoiveet, saatavuus, bio), sekä palvelun käytöstä syntyvä data: viestit muiden käyttäjien kanssa, pelipyynnöt, haasteet ja niihin osallistuminen, ottelutulokset sekä mahdolliset ilmoitukset sopimattomasta käytöksestä.'],
      ['Käsittelyn tarkoitus ja peruste', 'Käsittelemme tietoja tarjotaksemme palvelun ydintoiminnon: sopivien pelikavereiden löytämisen ja pelien sopimisen. Käsittelyn peruste on käyttäjän kanssa tehtävän sopimuksen täytäntöönpano sekä rekisteröitymisen yhteydessä annettu suostumus.'],
      ['Tietojen säilytys', 'Säilytämme tietoja niin kauan kuin tilisi on aktiivinen. Kun poistat tilisi, tiedot poistetaan kohtuullisessa ajassa, ellei laki edellytä pidempää säilytystä.'],
      ['Kenelle tietoja luovutetaan', 'Tietoja käsitellään Supabase-alustalla (tietokanta ja tiedostojen tallennus, EU-alueella sijaitsevat palvelimet). Jos kirjaudut Google- tai Apple-tunnuksilla, kyseinen palveluntarjoaja käsittelee kirjautumiseen tarvittavat tiedot omien ehtojensa mukaisesti. Profiilitietojasi ei myydä eikä luovuteta markkinointitarkoituksiin kolmansille osapuolille.'],
      ['Oikeutesi', 'Sinulla on oikeus tarkastaa, oikaista ja pyytää poistettavaksi omat tietosi, rajoittaa niiden käsittelyä, siirtää tiedot toiseen palveluun sekä vastustaa käsittelyä. Voit käyttää oikeuksiasi yllä olevasta sähköpostiosoitteesta. Sinulla on myös oikeus tehdä valitus tietosuojavaltuutetun toimistolle.'],
      ['Evästeet ja vastaavat tekniikat', 'Käytämme välttämättömiä evästeitä ja selaimen paikallista tallennustilaa kirjautumisen ylläpitämiseen — näitä ei voi kytkeä pois, koska palvelu ei toimi ilman niitä, eivätkä ne vaadi suostumusta. Lisäksi sekä markkinointisivustolla että selainsovelluksessa voidaan käyttää Metan (Facebook) analytiikka- ja markkinointievästeitä. Ne ladataan vasta, jos annat siihen nimenomaisen suostumuksen evästebannerissa.'],
      ['Suostumuksen peruuttaminen', 'Voit muuttaa tai peruuttaa evästesuostumuksesi milloin tahansa kohdasta Profiili → Asetukset → Evästeasetukset. Peruuttaminen ei vaikuta ennen peruutusta tehdyn käsittelyn lainmukaisuuteen.'],
      ['Automaattinen päätöksenteko', 'Emme tee tietojesi perusteella automaattista päätöksentekoa tai profilointia, jolla olisi sinuun oikeusvaikutuksia. Emme myöskään siirrä tietoja EU- tai ETA-alueen ulkopuolelle muutoin kuin siltä osin kuin käyttämäsi kirjautumis- tai markkinointipalvelu sitä omien ehtojensa mukaisesti edellyttää.'],
    ],
  },
};

const TABS = [
  { value: 'terms', label: 'Käyttöehdot' },
  { value: 'privacy', label: 'Tietosuoja' },
];

function SectionTitle({ text }) {
  const m = /^(\d+)\.\s+(.*)$/.exec(text);
  if (!m) return <h3 className="auth-legal-h">{text}</h3>;
  return (
    <h3 className="auth-legal-h">
      <span className="auth-legal-num t-num" aria-hidden="true">{m[1]}</span>
      <span className="sr-only">{m[1]}. </span>
      {m[2]}
    </h3>
  );
}

export function LegalSheet({ open, onClose, doc = 'terms' }) {
  const [tab, setTab] = useState(doc === 'privacy' ? 'privacy' : 'terms');
  const tabsRef = useRef(null);
  useEffect(() => { if (open) setTab(doc === 'privacy' ? 'privacy' : 'terms'); }, [open, doc]);

  const switchTab = (next) => {
    setTab(next);
    tabsRef.current?.closest('.sheet-body')?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const current = DOCS[tab];
  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="lg"
      title={current.title}
      subtitle={VALID_FROM}
      className="auth-legal-sheet"
      footer={<Button variant="dark" size="lg" block onClick={onClose}>Selvä</Button>}
    >
      <div ref={tabsRef} className="auth-legal-tabs">
        <Segmented options={TABS} value={tab} onChange={switchTab} size="sm" ariaLabel="Asiakirja" />
      </div>
      <article key={tab} className={`auth-legal route-fade${tab === 'terms' ? ' is-numbered' : ''}`} aria-label={current.title}>
        {current.sections.map(([title, body]) => (
          <section key={title} className="auth-legal-section">
            <SectionTitle text={title} />
            <p className="auth-legal-p">{body}</p>
          </section>
        ))}
      </article>
    </Sheet>
  );
}
