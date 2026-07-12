// koutsi-landing.jsx — landing page for koutsi.krossi.app (coach/student platform pitch)

const CONTACT_MAILTO = 'mailto:eelispuro@gmail.com?subject=' + encodeURIComponent('Kiinnostunut Krossi Koutsista');

function Wordmark({ size = 23 }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{ fontWeight: 800, fontSize: size, letterSpacing: -0.6, color: 'var(--lime)' }}>Krossi</span>
      <span className="koutsi-badge">Koutsi</span>
    </span>
  );
}

function Nav() {
  return (
    <div className="nav-wrap">
      <header className="nav-pill">
        <a href="#top" className="nav-logo"><Wordmark size={21} /></a>
        <nav className="nav-links">
          <a href="#ominaisuudet">Ominaisuudet</a>
          <a href="#miten-toimii">Miten toimii</a>
        </nav>
        <a href={CONTACT_MAILTO} className="btn-dark btn-sm" style={{ padding: '10px 18px', fontSize: 14 }}>Pyydä pääsy</a>
      </header>
    </div>
  );
}

function Hero() {
  return (
    <section className="hero" id="lataa">
      <div className="hero-copy">
        <span className="eyebrow"><span className="ball-dot" /> Krossi valmentajille</span>
        <h1 className="hero-title">Valmennus ja<br /><span className="hl">kehitys,</span> samassa paikassa.</h1>
        <p className="hero-sub">Krossi Koutsi yhdistää valmentajan ja pelaajan. Kirjaa tavoitteet, sanele treenimuistiinpanot, jaa viikon teema ja seuraa pelaajiesi kehitystä — kaikki yhdessä näkymässä.</p>
        <div className="hero-cta">
          <a href={CONTACT_MAILTO} className="btn-lime btn-lg">Pyydä pääsy testiin</a>
          <p className="hero-fine">Ei julkista latausta vielä.</p>
        </div>
        <p className="demo-hint">Kokeile vieressä olevaa demoa — avaa tiedot ja lisää palaute.</p>
      </div>
      <div className="hero-visual">
        <p className="demo-label">Kokeile alla olevaa demoa</p>
        <div className="hero-stage">
          <div className="phone-glow" />
          <div className="phone-front">
            <KoutsiPhone width={280} />
          </div>
        </div>
      </div>
    </section>
  );
}

function Promise_() {
  const lines = ['Muista jokainen pelaaja.', 'Suunnittele paremmat treenit.', 'Tee kehitys näkyväksi.'];
  return (
    <section style={{ maxWidth: 1120, margin: '0 auto', padding: '0 22px clamp(30px,5vw,54px)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px,3vw,30px)', justifyContent: 'center', textAlign: 'center' }}>
        {lines.map((t) => (
          <span key={t} style={{ fontSize: 'clamp(1.05rem,2.4vw,1.35rem)', fontWeight: 800, color: 'var(--green-deep)', letterSpacing: '-0.01em' }}>{t}</span>
        ))}
      </div>
    </section>
  );
}

const FEATURES = [
  { n: '01', title: 'Pelaajat ja ryhmät yhdessä näkymässä', body: 'Näet jokaisen valmennettavan tason, tavoitteet ja rajoitteet — sekä sen, mitä käsiteltiin viime kerralla ja mikä on seuraava kehityskohde.' },
  { n: '02', title: 'Nopea treenimuistiinpano — jopa sanelemalla', body: 'Sanele 15–30 sekunnin ääniviesti tunnin jälkeen. Tekoäly muotoilee siitä valmiin yhteenvedon — et joudu kirjoittamaan raportteja.' },
  { n: '03', title: 'Pelaajakohtainen kehityspolku', body: 'Tavoitteet, huomiot, videot ja tehtävät kertyvät aikajanalle. Kehitys näkyy sekä sinulle että pelaajalle.' },
  { n: '04', title: 'Viikon teema koko ryhmälle', body: 'Julkaise ryhmälle viikon painopiste, tavoite ja omatoiminen tehtävä kerralla — et selitä samaa asiaa erikseen jokaiselle.' },
  { n: '05', title: 'Harjoitepankki', body: 'Tallenna omat harjoitteesi tavoitteen, pelaajamäärän, keston ja tason mukaan, ja rakenna tunti vetämällä harjoitteita suunnitelmaan.' },
  { n: '06', title: 'Palaute ja kotitehtävä suoraan pelaajalle', body: 'Pelaaja näkee palautteen, tehtävän ja tulevat treenit omasta näkymästään — ei enää hajanaisia WhatsApp-viestejä.' },
  { n: '07', title: 'Videot pelaajan aikajanalla', body: 'Liitä video muistiinpanoon, niin se tallentuu suoraan pelaajan kehityshistoriaan.' },
  { n: '08', title: 'Ennen treeniä -yhteenveto', body: 'Juuri ennen tuntia näet automaattisesti koosteen: mitä kukin pelaaja tarvitsee, ryhmän teeman ja ehdotetut harjoitteet.' },
];

function Features() {
  return (
    <section className="features" id="ominaisuudet">
      <span className="eyebrow"><span className="ball-dot" /> Ominaisuudet</span>
      <h2 className="sec-title">Mitä saat käyttöön.</h2>
      <div className="cf-grid">
        {FEATURES.map((f) => (
          <article key={f.n} className="cf-card">
            <span className="cf-num">{f.n}</span>
            <h3>{f.title}</h3>
            <p>{f.body}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  { n: 1, title: 'Kutsu oppilaasi mukaan', body: 'Lähetä kutsulinkki — oppilas liittyy omalla tililleen sinun valmennettavaksesi.' },
  { n: 2, title: 'Kirjaa treenit ja palautteet', body: 'Lisää tulevat treenit, kotiläksyt ja lyhyt palaute jokaisen kerran jälkeen.' },
  { n: 3, title: 'Oppilas seuraa kehitystään', body: 'Oppilas näkee omat tietonsa, palautteet ja tulevat treenit omasta näkymästään.' },
];

function HowItWorks() {
  return (
    <section className="steps" id="miten-toimii">
      <div className="steps-inner">
        <span className="eyebrow eyebrow-light"><span className="ball-dot" /> Miten toimii</span>
        <h2>Kolme askelta käyttöönottoon.</h2>
        <div className="steps-grid">
          {STEPS.map((s) => (
            <div key={s.n} className="step-card">
              <span className="step-n">{s.n}</span>
              <h3>{s.title}</h3>
              <p>{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="closing" id="liity">
      <div className="closing-inner">
        <h2>Rakennetaan tätä<br />yhdessä.</h2>
        <p>Krossi Koutsi on vielä varhaisessa vaiheessa. Jos valmennat pelaajia ja tunnistat tämän ongelman, otetaan yhteyttä — vastaan henkilökohtaisesti jokaiseen viestiin.</p>
        <a href={CONTACT_MAILTO} className="btn-lime btn-lg">Pyydä pääsy testiin</a>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Wordmark size={26} />
        <p className="footer-tag">Valmennus ja kehitys, samassa paikassa.</p>
        <div className="footer-links">
          <a href={CONTACT_MAILTO}>eelispuro@gmail.com</a>
          <a href="https://krossi.app">Krossi pelaajille →</a>
          <a href="#" onClick={e => { e.preventDefault(); window.krossiOpenCookieSettings && window.krossiOpenCookieSettings(); }}>Evästeasetukset</a>
        </div>
        <div className="footer-base">© 2026 Krossi Koutsi</div>
      </div>
    </footer>
  );
}

function App() {
  return (
    <div className="krossi-root" id="top">
      <Nav />
      <Hero />
      <Promise_ />
      <Features />
      <HowItWorks />
      <ClosingCTA />
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
