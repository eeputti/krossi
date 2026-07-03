// krossi-landing.jsx — landing sections + root render + tweaks wiring

const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "accent": "#CFE414",
  "bgTone": "white",
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
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: -0.6, color: light ? '#fff' : 'var(--lime)' }}>Krossi</span>
  );
}

function StoreBadge({ store }) {
  const apple = store === 'apple';
  const href = apple ? 'https://apps.apple.com/fi/app/krossi/id6771824274' : 'https://tally.so/r/BzerXK';
  const badge = (
    <a href={href} className="store-badge" target="_blank" rel="noopener noreferrer"
      onClick={apple ? () => { if (typeof fbq !== 'undefined') fbq('trackCustom', 'ClickDownload'); } : undefined}>
      {apple ? (
        <svg width="20" height="24" viewBox="0 0 20 24" fill="#fff"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z" /></svg>
      ) : (
        <svg width="20" height="22" viewBox="0 0 20 22"><path d="M1 1.5v19l10-9.5L1 1.5z" fill="#fff" /><path d="M1 1.5l13.5 7L11 11 1 1.5z" fill="#fff" opacity="0.85" /><path d="M1 20.5L11 11l3.5 2.5L1 20.5z" fill="#fff" opacity="0.7" /><path d="M14.5 8.5L19 11l-4.5 2.5L11 11l3.5-2.5z" fill="#fff" opacity="0.55" /></svg>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.15, textAlign: 'left' }}>
        <span style={{ fontSize: 10.5, opacity: 0.8, fontWeight: 500 }}>{apple ? 'Lataa täältä' : 'Saatavilla'}</span>
        <span style={{ fontSize: 16, fontWeight: 700 }}>{apple ? 'App Store' : 'Google Play'}</span>
      </span>
    </a>
  );
  if (apple) return badge;
  return (
    <div className="store-badge-wrap">
      {badge}
      <span className="store-badge-note">Testiversio</span>
    </div>
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
function FeatureShot({ src }) {
  return (
    <div className="fm fm-shot">
      <img src={src} alt="" />
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
          <a href="#halleille">Halleille</a>
        </nav>
        <a href="/pelaa" className="btn-dark btn-sm" style={{ padding: '10px 18px', fontSize: 14 }}>Kokeile Krossia</a>
      </header>
    </div>
  );
}

function Hero({ t }) {
  const heroRef = React.useRef(null);
  const phoneElRef = React.useRef(null);
  const phoneVisualRef = React.useRef(null);

  const handleScrollEl = React.useCallback((el) => {
    phoneElRef.current = el;
  }, []);

  // All screens: drive phone scroll based on how far hero section has scrolled past
  React.useEffect(() => {
    const onScroll = () => {
      const section = heroRef.current;
      const phoneEl = phoneElRef.current;
      if (!section || !phoneEl) return;
      const rect = section.getBoundingClientRect();
      const progress = Math.max(0, Math.min(1, -rect.top / section.offsetHeight));
      phoneEl.scrollTop = progress * (phoneEl.scrollHeight - phoneEl.clientHeight);
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // Mobile: intercept touch swipes on the phone visual to scroll phone content
  React.useEffect(() => {
    const wrapper = phoneVisualRef.current;
    if (!wrapper) return;

    let startY = 0;
    let startScrollTop = 0;

    const onTouchStart = (e) => {
      const phoneEl = phoneElRef.current;
      if (!phoneEl) return;
      startY = e.touches[0].clientY;
      startScrollTop = phoneEl.scrollTop;
    };

    const onTouchMove = (e) => {
      if (window.innerWidth >= 940) return;
      const phoneEl = phoneElRef.current;
      if (!phoneEl) return;
      const deltaY = startY - e.touches[0].clientY;
      const maxScroll = phoneEl.scrollHeight - phoneEl.clientHeight;
      const atTop = phoneEl.scrollTop <= 0 && deltaY < 0;
      const atBottom = phoneEl.scrollTop >= maxScroll - 1 && deltaY > 0;
      if (!atTop && !atBottom) {
        e.preventDefault();
        phoneEl.scrollTop = Math.max(0, Math.min(startScrollTop + deltaY, maxScroll));
      }
    };

    wrapper.addEventListener('touchstart', onTouchStart, { passive: true });
    wrapper.addEventListener('touchmove', onTouchMove, { passive: false });
    return () => {
      wrapper.removeEventListener('touchstart', onTouchStart);
      wrapper.removeEventListener('touchmove', onTouchMove);
    };
  }, []);

  return (
    <section className="hero hero-single" id="lataa" ref={heroRef}>
        <div className="hero-copy">
          <h1 className="hero-title">
            Uutta{' '}
            {t.highlight ? <span className="hl">peliseuraa?</span> : <span>peliseuraa?</span>}
          </h1>
          <p className="hero-sub">Löydä pelaajia, luo ja sovi pelejä ja pysy mukana paikallisissa tennistapahtumissa.</p>
          <div className="hero-cta">
            <a href="/pelaa" className="btn-lime btn-lg">Kokeile Krossia</a>
          </div>

          <p className="demo-hint">Testaa vieressä olevaa interaktiivista demoa</p>
        </div>
        <div className="hero-visual" ref={phoneVisualRef}>
          <p className="demo-label">Alla interaktiivinen demo</p>
          <div className="hero-stage">
            <div className="phone-front"><KrossiPhone startTab="players" width={290} onScrollEl={handleScrollEl} /></div>
          </div>
        </div>
    </section>
  );
}

const FEATURES = [
  { n: '01', side: 'left', title: 'Löydä pelikavereita', body: 'Selaa paikallisia pelaajia ja löydä omaan tasoon sopivaa peliseuraa.', media: <FeatureShot src="assets/loyda-pelikavereita.png" /> },
  { n: '02', side: 'right', title: 'Sovi pelit helposti', body: 'Luo avoimia haasteita, joihin muut voivat liittyä. Pelaa, kun sulle sopii tai ehdota aikoja ja siirrä sopiminen pois hajanaisista viestikeskusteluista.', media: <FeatureShot src="assets/sovi-pelit-helposti.png" /> },
  { n: '03', side: 'left', title: 'Luo omia haasteita', body: 'Hae pelikaveria juuri sellaiseen peliin kuin sulle sopii.', media: <FeatureShot src="assets/luo-haasteita.png" /> },
  { n: '04', side: 'right', title: 'Pysy mukana', body: 'Näe paikalliset tennisjutut, tapahtumat ja pelaajat yhdessä paikassa.', media: <NewsMedia /> },
];

// ── upcoming matches ───────────────────────────────────
const DEMO_MATCHES = [
  { id: 1, creator: 'Roger Federer', initials: 'RF', hue: 210, age: '40–50', level: 'Kilpapelaaja', type: 'Kaksinpeli', loc: 'Janus Areena', locType: 'Sisätennis', day: 'Tänään', time: 'klo 18:00', desc: 'Rentoa pallottelua illan päätteeksi. Kaikki tasot tervetulleita!', slots: 1 },
  { id: 2, creator: 'Serena Williams', initials: 'SW', hue: 340, age: '40–50', level: 'Edistynyt', type: 'Pallottelu', loc: 'Kispi Areena', locType: 'Sisätennis', day: 'Huomenna', time: 'klo 10:00', desc: 'Aamutreeni ennen töitä — sparrauskaveria haetaan!', slots: 1 },
  { id: 3, creator: 'Rafael Nadal', initials: 'RN', hue: 25, age: '30–40', level: 'Kilpapelaaja', type: 'Nelinpeli', loc: 'Mukkulan kentät', locType: 'Ulkotennis', day: 'Lauantai', time: 'klo 12:00', desc: 'Nelinpelisessio ulkona — tarvitaan 3 muuta. Massa-alustalla.', slots: 3 },
  { id: 4, creator: 'Naomi Osaka', initials: 'NO', hue: 280, age: '20–30', level: 'Keskitaso', type: 'Kaksinpeli', loc: 'Janus Areena', locType: 'Sisätennis', day: 'Sunnuntai', time: 'klo 16:00', desc: null, slots: 1 },
];

function DemoAvatar({ initials, hue, size = 38 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${hue} 55% 55%), hsl(${hue+30} 50% 38%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.35, letterSpacing: 0.3,
    }}>{initials}</div>
  );
}

function UpcomingMatches() {
  return (
    <section className="upcoming" id="tulevat">
      <div className="upcoming-inner">
        <div className="upcoming-header">
          <span className="eyebrow"><span className="ball-dot" /> Tulevat pelit</span>
          <h2 className="upcoming-title">Avoimet haasteet Lahdessa</h2>
          <p className="upcoming-sub">Tällaisia pelejä Krossissa sovitaan. Liity mukaan ja löydä oma pelikaverisi.</p>
        </div>
        <div className="upcoming-grid">
          {DEMO_MATCHES.map((m) => (
            <a key={m.id} href="/pelaa" className="upcoming-card">
              <div className="uc-top">
                <span className="uc-day">{m.day} · {m.time}</span>
                <span className="uc-type">{m.type}</span>
              </div>
              <div className="uc-body">
                <DemoAvatar initials={m.initials} hue={m.hue} size={42} />
                <div className="uc-info">
                  <div className="uc-name">{m.creator}, {m.age}</div>
                  <div className="uc-loc">{m.loc} · {m.locType}</div>
                </div>
                <div className="uc-slots">
                  {Array.from({ length: m.slots }).map((_, i) => (
                    <span key={i} className="uc-slot" />
                  ))}
                </div>
              </div>
              {m.desc && <p className="uc-desc">{m.desc}</p>}
              <div className="uc-tags">
                <span className="uc-tag">{m.level}</span>
                <span className="uc-tag">{m.locType}</span>
              </div>
            </a>
          ))}
        </div>
        <div style={{ textAlign: 'center', marginTop: 'clamp(20px,3vw,32px)' }}>
          <a href="/pelaa" className="btn-lime btn-lg">Kokeile Krossia selaimessa →</a>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="features" id="ominaisuudet">
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

const KROSSI_CITIES = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio'];

function Trust() {
  return (
    <section className="trust trust-light" id="lahti">
      <div className="trust-inner">
        <span className="eyebrow eyebrow-light"><span className="ball-dot" /> Krossi laajenee kaupunkeihin ympäri Suomen</span>
        <h2>Rakennetaan Suomen<br />tennisverkostoa yhdessä.</h2>
        <p>Krossi on jo käytössä kahdeksassa kaupungissa. Kun pelaajat löytyvät samasta paikasta, pelien sopiminen, tapahtumien jakaminen ja uusien tenniskavereiden löytäminen helpottuu kaikille.</p>
        <div className="city-pills">
          {KROSSI_CITIES.map((c) => <span key={c} className="city-pill">{c}</span>)}
        </div>
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
    <section className="closing" id="kentalle">
      <div className="closing-photo">
        <div className="closing-inner">
          <h2>Valmiina kentälle!</h2>
          <p>Löydä. Valitse. Sovi. Pelaa.</p>
          <a href="/pelaa" className="btn-lime btn-lg">Kokeile Krossia</a>
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
          <span>Suomi</span>
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
      <UpcomingMatches />
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
