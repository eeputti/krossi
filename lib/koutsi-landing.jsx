// koutsi-landing.jsx — landing page for koutsi.krossi.app (coach/student platform pitch)

const CONTACT_MAILTO = 'mailto:eelispuro@gmail.com?subject=' + encodeURIComponent('Kiinnostunut Krossi Koutsista');
// contact page with the booking calendar (koutsi-yhteys.html)
const CONTACT_PAGE = 'https://koutsi.krossi.app/yhteys';

// The Krossi Koutsi wordmark, the same as in the app (koutsi/web shared/gates.jsx KoutsiWordmark):
// lime "Krossi", a tennis ball for a full stop, then "Koutsi". `id` keeps the ball's gradient ids
// unique when the page shows it twice. koutsi-yhteys.html has the same markup by hand.
function Wordmark({ size = 26, id }) {
  return (
    <span className="wordmark" style={{ fontSize: size }} role="img" aria-label="Krossi Koutsi">
      <span aria-hidden="true">Krossi</span>
      <span className="wordmark-ball" aria-hidden="true">
        <svg viewBox="0 0 100 100" width="100%" height="100%">
          <defs>
            <radialGradient id={`kw-g-${id}`} cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#E4F25A" /><stop offset=".7" stopColor="#CFE414" /><stop offset="1" stopColor="#B9CC0E" /></radialGradient>
            <clipPath id={`kw-c-${id}`}><circle cx="50" cy="50" r="46" /></clipPath>
          </defs>
          <circle cx="50" cy="50" r="46" fill={`url(#kw-g-${id})`} />
          <g clipPath={`url(#kw-c-${id})`} fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round">
            <path d="M10 30c18-6 40-4 56 8s22 22 28 32" /><path d="M30 80c14 7 34 6 50-6" />
          </g>
        </svg>
      </span>
      <span className="wordmark-sub" aria-hidden="true">Koutsi</span>
    </span>
  );
}

function Nav() {
  return (
    <div className="nav-wrap">
      <header className="nav-pill">
        <a href="#top" className="nav-logo"><Wordmark size={27} id="nav" /></a>
        <nav className="nav-links">
          <a href="#miten-toimii">Miten toimii</a>
          <a href={CONTACT_PAGE}>Ota yhteyttä</a>
          <a href="https://koutsi.krossi.app/valmentaja?auth=login">Kirjaudu sisään</a>
        </nav>
        <a href="https://koutsi.krossi.app/valmentaja" className="btn-dark btn-sm" style={{ padding: '10px 18px', fontSize: 14 }}>Luo tili</a>
      </header>
    </div>
  );
}

function Promise_() {
  const lines = ['Muista jokainen pelaaja.', 'Suunnittele paremmat treenit.', 'Tee kehitys näkyväksi.'];
  return (
    <section style={{ maxWidth: 1120, margin: '0 auto', padding: '0 22px clamp(30px,5vw,54px)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'clamp(10px,3vw,30px)', justifyContent: 'center', textAlign: 'center' }}>
        {lines.map((t) => (
          <span key={t} style={{ fontSize: 'clamp(1.05rem,2.4vw,1.35rem)', fontWeight: 800, color: 'var(--ink)', letterSpacing: '-0.01em' }}>{t}</span>
        ))}
      </div>
    </section>
  );
}

const STEPS = [
  { n: 1, title: 'Kutsu pelaajasi mukaan', body: 'Jaa ryhmälinkki tai liittymiskoodi. Pelaaja liittyy omalla tunnuksellaan sinun ryhmääsi.' },
  { n: 2, title: 'Kirjaa treenit ja palautteet', body: 'Lisää tulevat treenit, kotiläksyt ja lyhyt palaute jokaisen kerran jälkeen.' },
  { n: 3, title: 'Pelaaja seuraa kehitystään', body: 'Pelaaja näkee omat treeninsä, palautteet ja kotiläksyt omasta näkymästään.' },
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

// The coach app on a computer (lib/koutsi-laptop.jsx): planning, the week, attendance, invoicing.
function Tools() {
  return (
    <section className="tools" id="tyokalut">
      <div className="tools-inner">
        <span className="eyebrow"><span className="ball-dot" /> Valmentajan työkalut</span>
        <h2>Treenien suunnittelusta <span className="hl">laskuihin.</span></h2>
        <p className="tools-sub">Sama Koutsi toimii tietokoneella ja puhelimessa.</p>
        <LaptopTour />
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="closing" id="liity">
      <div className="closing-inner">
        <h2>Rakennetaan tätä yhdessä.</h2>
        <div className="closing-actions">
          <a href="https://koutsi.krossi.app/valmentaja" className="btn-lime btn-lg">Aloita treenaaminen →</a>
          <a href={CONTACT_PAGE} className="btn-glass btn-lg">Ota yhteyttä</a>
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Wordmark size={40} id="footer" />
        <p className="footer-tag">Valmennus ja kehitys, samassa paikassa.</p>
        <div className="footer-links">
          <a href={CONTACT_PAGE}>Ota yhteyttä</a>
          <a href={CONTACT_MAILTO}>eelispuro@gmail.com</a>
          <a href="https://koutsi.krossi.app/tietosuoja">Tietosuojaseloste</a>
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
      <KoutsiFilm />
      <Promise_ />
      <HowItWorks />
      <PlayerSection />
      <Tools />
      <ClosingCTA />
      <Footer />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
