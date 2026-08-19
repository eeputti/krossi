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

function RoleChooserModal({ onClose }) {
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 200, background: 'rgba(10,15,10,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: 'min(420px, 100%)', background: '#fff', borderRadius: 24, padding: '30px 28px', border: '1px solid var(--line)' }}>
        <h3 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6, color: 'var(--ink)' }}>Kumpi olet?</h3>
        <p style={{ fontSize: 13.5, color: '#8a857a', marginBottom: 20, lineHeight: 1.5 }}>Valmentaja ja pelaaja käyttävät eri näkymää — valitse kumpi olet, niin pääset kirjautumaan tai luomaan tilin oikeaan paikkaan.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <a href="https://koutsi.krossi.app/valmentaja" className="btn-dark" style={{ width: '100%', padding: '14px 0' }}>Olen valmentaja →</a>
          <a href="https://koutsi.krossi.app/pelaaja" className="btn-outline" style={{ width: '100%', padding: '14px 0' }}>Olen pelaaja →</a>
        </div>
      </div>
    </div>
  );
}

function Nav({ onOpenRoleChooser }) {
  return (
    <div className="nav-wrap">
      <header className="nav-pill">
        <a href="#top" className="nav-logo"><Wordmark size={21} /></a>
        <nav className="nav-links">
          <a href="#miten-toimii">Miten toimii</a>
          <a href="https://demo.koutsi.krossi.app">Kokeile demoa</a>
          <a href="#" onClick={(e) => { e.preventDefault(); onOpenRoleChooser(); }}>Kirjaudu sisään</a>
        </nav>
        <button type="button" onClick={onOpenRoleChooser} className="btn-dark btn-sm" style={{ padding: '10px 18px', fontSize: 14 }}>Luo tili</button>
      </header>
    </div>
  );
}

function Hero({ onOpenRoleChooser }) {
  return (
    <section className="hero" id="lataa">
      <div className="hero-copy">
        <span className="eyebrow"><span className="ball-dot" /> Krossi valmentajille</span>
        <h1 className="hero-title">Valmennus ja<br /><span className="hl">kehitys,</span> samassa paikassa.</h1>
        <p className="hero-sub">Krossi Koutsi yhdistää valmentajan ja pelaajan. Pelaajat, ryhmät, videot, harjoitteet ja tavoitteet — kaikki yhdessä näkymässä.</p>
        <div className="hero-cta">
          <a href="https://demo.koutsi.krossi.app" className="btn-lime btn-lg">Avaa demo →</a>
          <button type="button" onClick={onOpenRoleChooser} className="btn-outline btn-lg">Luo tili →</button>
        </div>
      </div>
      <div className="hero-visual">
        <div className="hero-stage">
          <div className="phone-glow" />
          <div className="phone-pair">
            <div className="phone-pair-item phone-pair-back"><PlayerPhone width={210} /></div>
            <div className="phone-pair-item phone-pair-front"><CoachPhone width={210} /></div>
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

const STEPS = [
  { n: 1, title: 'Kutsu oppilaasi mukaan', body: 'Lähetä kutsulinkki — oppilas liittyy omalle tililleen sinun valmennettavaksesi.' },
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
        <h2>Rakennetaan tätä yhdessä.</h2>
        <a href="https://demo.koutsi.krossi.app" className="btn-lime btn-lg">Avaa demo →</a>
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
  const [roleChooserOpen, setRoleChooserOpen] = React.useState(false);
  const openRoleChooser = () => setRoleChooserOpen(true);
  return (
    <div className="krossi-root" id="top">
      <Nav onOpenRoleChooser={openRoleChooser} />
      <Hero onOpenRoleChooser={openRoleChooser} />
      <Promise_ />
      <HowItWorks />
      <ClosingCTA />
      <Footer />
      {roleChooserOpen && <RoleChooserModal onClose={() => setRoleChooserOpen(false)} />}
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
