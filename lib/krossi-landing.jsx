// krossi-landing.jsx — landing sections + root render + tweaks wiring

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#CFE414",
  "bgTone": "warm",
  "heroLayout": "duo",
  "courtLines": true,
  "highlight": true,
  "headlineScale": 1
}/*EDITMODE-END*/;

const BG_TONES = { warm: '#F7F5EF', soft: '#EFEDE7', white: '#FFFFFF' };
const BALL = 'assets/ball-tight.png';

// ── small pieces ────────────────────────────────────────
function Wordmark({ light = false, size = 23 }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: -0.6, color: light ? '#fff' : 'var(--ink)' }}>Krossi</span>
  );
}

function StoreBadge({ store }) {
  const apple = store === 'apple';
  const href = apple ? 'https://apps.apple.com/fi/app/krossi/id6771824274' : '#';
  const handleClick = apple ? undefined : (e) => e.preventDefault();
  return (
    <a href={href} onClick={handleClick} className="store-badge" target={apple ? '_blank' : undefined} rel={apple ? 'noopener noreferrer' : undefined}>
      {apple ? (
        <svg width="20" height="24" viewBox="0 0 20 24" fill="#fff"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z" /></svg>
      ) : (
        <svg width="20" height="22" viewBox="0 0 20 22"><path d="M1 1.5v19l10-9.5L1 1.5z" fill="#fff" /><path d="M1 1.5l13.5 7L11 11 1 1.5z" fill="#fff" opacity="0.85" /><path d="M1 20.5L11 11l3.5 2.5L1 20.5z" fill="#fff" opacity="0.7" /><path d="M14.5 8.5L19 11l-4.5 2.5L11 11l3.5-2.5z" fill="#fff" opacity="0.55" /></svg>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'left' }}>
        <span style={{ fontSize: 10.5, opacity: 0.8, fontWeight: 500 }}>{apple ? 'Lataa täältä' : 'Tulossa pian'}</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{apple ? 'App Store' : 'Google Play'}</span>
      </span>
    </a>
  );
}

function CourtLines({ light = false }) {
  const c = light ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.5)';
  return (
    <svg className="court-lines" viewBox="0 0 400 600" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke={c} strokeWidth="1.5" fill="none">
        <rect x="40" y="30" width="320" height="540" />
        <rect x="40" y="150" width="320" height="300" />
        <line x1="120" y1="150" x2="120" y2="450" />
        <line x1="280" y1="150" x2="280" y2="450" />
        <line x1="120" y1="300" x2="280" y2="300" />
        <line x1="200" y1="30" x2="200" y2="150" />
        <line x1="200" y1="450" x2="200" y2="570" />
      </g>
    </svg>
  );
}

// ── feature mini-visuals ────────────────────────────────
function BallsMedia() {
  return (
    <div className="fm fm-balls">
      <img src={BALL} alt="" style={{ position: 'absolute', width: '50%', left: '10%', top: '16%', transform: 'rotate(-8deg)' }} />
      <img src={BALL} alt="" style={{ position: 'absolute', width: '42%', right: '8%', top: '8%', transform: 'rotate(12deg)' }} />
      <img src={BALL} alt="" style={{ position: 'absolute', width: '38%', left: '32%', bottom: '8%', transform: 'rotate(4deg)' }} />
    </div>
  );
}
function ChatMedia() {
  return (
    <div className="fm fm-chat">
      <span className="bubble bubble-them">Klo 18 kentälle?</span>
      <span className="bubble bubble-me">Sopii! 🎾</span>
    </div>
  );
}
function NewsMedia() {
  return (
    <div className="fm fm-news">
      <div className="news-card">
        <div className="news-thumb"><span className="news-chip">Tänään</span></div>
        <div className="news-meta">
          <div className="news-title">Lahden tennisviikko alkaa</div>
          <span className="news-line" style={{ width: '90%' }} />
          <span className="news-line" style={{ width: '60%' }} />
        </div>
      </div>
    </div>
  );
}

// ── sections ────────────────────────────────────────────
function Nav() {
  return (
    <div className="nav-wrap">
      <header className="nav-pill">
        <a href="#top" className="nav-logo"><Wordmark size={21} /></a>
        <nav className="nav-links">
          <a href="#ominaisuudet">Ominaisuudet</a>
          <a href="#lahti">Lahti</a>
          <a href="#halleille">Halleille</a>
        </nav>
        <a href="#lataa" className="btn-dark btn-sm">Lataa Krossi</a>
      </header>
    </div>
  );
}

function Hero({ t }) {
  const storyRef = React.useRef(null);
  const phoneElRef = React.useRef(null);

  const handleScrollEl = React.useCallback((el) => {
    phoneElRef.current = el;
    // Set story height once phone content is known (desktop only)
    if (el && window.innerWidth >= 940) {
      // Wait one frame for layout to settle
      requestAnimationFrame(() => {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (storyRef.current && maxScroll > 0) {
          storyRef.current.style.height = `calc(100vh + ${maxScroll}px)`;
        }
      });
    }
  }, []);

  React.useEffect(() => {
    const onScroll = () => {
      if (window.innerWidth < 940) return;
      const story = storyRef.current;
      const phoneEl = phoneElRef.current;
      if (!story || !phoneEl) return;
      const scrolledPast = Math.max(0, -story.getBoundingClientRect().top);
      phoneEl.scrollTop = scrolledPast;
    };

    const onResize = () => {
      const phoneEl = phoneElRef.current;
      const story = storyRef.current;
      if (!phoneEl || !story) return;
      if (window.innerWidth >= 940) {
        const maxScroll = phoneEl.scrollHeight - phoneEl.clientHeight;
        story.style.height = maxScroll > 0 ? `calc(100vh + ${maxScroll}px)` : '';
      } else {
        story.style.height = '';
      }
    };

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <div ref={storyRef} className="scroll-story">
      <section className="hero hero-single hero-sticky" id="lataa">
        <div className="hero-copy">
          <span className="eyebrow"><span className="ball-dot" /> Nyt testissä Lahdessa</span>
          <h1 className="hero-title">
            Uutta{' '}
            {t.highlight ? <span className="hl">peliseuraa?</span> : <span>peliseuraa?</span>}
          </h1>
          <p className="hero-sub">Löydä tenniskavereita Lahdessa.<br />Luo profiili, selaa pelaajia ja sovi pelit helposti.<br />Ilman ryhmächatin säätöä.</p>
          <div className="hero-cta">
            <a href="https://apps.apple.com/fi/app/krossi/id6771824274" className="btn-lime btn-lg" target="_blank" rel="noopener noreferrer">Lataa Krossi</a>
            <div className="store-row">
              <StoreBadge store="apple" />
              <StoreBadge store="google" />
            </div>
          </div>
          <p className="hero-fine">Ilmainen beta · Pelaa jo tällä viikolla</p>
        </div>
        <div className="hero-visual">
          <div className="phone-glow" />
          <div className="hero-stage">
            <div className="phone-front"><KrossiPhone startTab="players" width={290} onScrollEl={handleScrollEl} /></div>
          </div>
          <p className="phone-caption">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 10V2M6 2L2.5 5.5M6 2L9.5 5.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"/></svg>
            Testaa ensin, lataa sitten
          </p>
        </div>
      </section>
    </div>
  );
}

const FEATURES = [
  { n: '01', side: 'left', title: 'Löydä pelikavereita', body: 'Selaa paikallisia pelaajia ja löydä omaan tasoon sopivaa peliseuraa.', media: <BallsMedia /> },
  { n: '02', side: 'right', title: 'Sovi pelit helposti', body: 'Viestittele, ehdota aikaa ja siirrä sopiminen pois hajanaisista ryhmistä.', media: <ChatMedia /> },
  { n: '03', side: 'left', title: 'Pysy mukana', body: 'Näe paikalliset tennisjutut, tapahtumat ja pelaajat yhdessä paikassa.', media: <NewsMedia /> },
];

function Features() {
  return (
    <section className="features" id="ominaisuudet">
      <h2 className="sec-title">Tennispelejä<br />ilman säätöä.</h2>
      <div className="feat-zig">
        {FEATURES.map((f) => (
          <article key={f.n} className={`feat-card feat-${f.side}`}>
            <div className="feat-media">{f.media}</div>
            <div className="feat-body">
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Trust() {
  return (
    <section className="trust trust-light" id="lahti">
      <div className="trust-inner">
        <span className="eyebrow eyebrow-light"><span className="ball-dot" /> Lahti — ensimmäinen Krossi-kaupunki</span>
        <h2>Rakennetaan Lahden<br />tennisverkosto yhdessä.</h2>
        <p>Krossi aloittaa Lahdesta. Kun pelaajat löytyvät samasta paikasta, pelien sopiminen, tapahtumien jakaminen ja uusien tenniskavereiden löytäminen helpottuu kaikille.</p>
        <a href="#kentalle" className="btn-lime btn-lg">Liity mukaan</a>
      </div>
    </section>
  );
}

function Clubs() {
  return (
    <section className="clubs" id="halleille">
      <div className="clubs-card">
        <div className="clubs-text">
          <h2>Hallille, seuralle tai<br />valmentajalle?</h2>
          <p>Krossi voi auttaa kokoamaan paikalliset pelaajat, tapahtumat ja ilmoitukset yhteen selkeään kanavaan.</p>
          <a href="mailto:eelispuro@gmail.com" className="btn-outline btn-lg">Ota yhteyttä</a>
        </div>
        <div className="clubs-deco" aria-hidden="true"><img src={BALL} alt="" /></div>
      </div>
    </section>
  );
}

function ClosingCTA() {
  return (
    <section className="closing closing-photo" id="kentalle">
      <div className="closing-inner">
        <h2>Valmiina kentälle?</h2>
        <p>Löydä. Valitse. Sovi. Pelaa.</p>
        <a href="https://apps.apple.com/fi/app/krossi/id6771824274" className="btn-lime btn-lg" target="_blank" rel="noopener noreferrer">Lataa Krossi</a>
        <div className="store-row store-row-center">
          <StoreBadge store="apple" />
          <StoreBadge store="google" />
        </div>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <Wordmark size={26} />
        <p className="footer-tag">Löydä uusia tenniskavereita.</p>
        <div className="footer-links">
          <a href="mailto:eelispuro@gmail.com">eelispuro@gmail.com</a>
          <span>Lahti, Suomi</span>
        </div>
        <div className="footer-base">© 2026 Krossi · Tennistä lähellä sinua</div>
      </div>
    </footer>
  );
}

// ── root ────────────────────────────────────────────────
function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const rootStyle = {
    '--lime': t.accent,
    '--paper': BG_TONES[t.bgTone] || BG_TONES.warm,
    '--hscale': t.headlineScale,
  };
  return (
    <div className="krossi-root" id="top" data-court={t.courtLines ? 'on' : 'off'} style={rootStyle}>
      <Nav />
      <Hero t={t} />
      <Features />
      <Trust />
      <Clubs />
      <ClosingCTA />
      <Footer />

      <TweaksPanel>
        <TweakSection label="Brändi" />
        <TweakColor label="Aksenttiväri" value={t.accent}
          options={['#CFE414', '#C7FF1A', '#D7E84A', '#B6E000']}
          onChange={(v) => setTweak('accent', v)} />
        <TweakRadio label="Taustasävy" value={t.bgTone}
          options={['warm', 'soft', 'white']}
          onChange={(v) => setTweak('bgTone', v)} />
        <TweakSection label="Hero" />
        <TweakToggle label="Korosta sana" value={t.highlight}
          onChange={(v) => setTweak('highlight', v)} />
        <TweakSlider label="Otsikon koko" value={t.headlineScale} min={0.85} max={1.2} step={0.05}
          onChange={(v) => setTweak('headlineScale', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
