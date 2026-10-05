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
const APP_STORE_URL = 'https://apps.apple.com/fi/app/krossi/id6771824274';

// ── small pieces ────────────────────────────────────────
function Wordmark({ light = false, size = 23 }) {
  return (
    <span style={{ fontWeight: 800, fontSize: size, letterSpacing: -0.6, color: light ? '#fff' : 'var(--lime)' }}>Krossi</span>
  );
}

// Tiny inline icon set for the landing page (24×24, currentColor).
const LAND_ICONS = {
  bolt: { fill: 'M13.2 2.5 4.5 13.6h6.3l-1 7.9 8.7-11.1h-6.3l1-7.9z' },
  flame: { fill: 'M12 2.4c.9 3.3 5 5.4 5 10.4a5 5 0 0 1-10 0c0-2.5 1.2-4.1 2.4-5.1.1 2 1 3.1 2.1 3.3-.3-3.1.2-5.8.5-8.6z' },
  crown: { fill: 'M3.4 7.8 7.8 11.4 12 4.8l4.2 6.6 4.4-3.6-1.9 10.4H5.3z' },
  star: { fill: 'M12 3.2l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17.2 6.6 20.1l1-6.1-4.4-4.3 6.1-.9z' },
  check: { stroke: 'M5 12.6l4.4 4.4L19 7.4' },
  arrow: { stroke: 'M5 12h14M13 6l6 6-6 6' },
  plus: { stroke: 'M12 5v14M5 12h14' },
  trophy: { stroke: 'M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 3.5M16 6h3a3 3 0 0 1-3 3.5M12 13v4M8.5 20h7' },
  ball: { stroke: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM5.6 6.3c3 2.6 3 8.8 0 11.4M18.4 6.3c-3 2.6-3 8.8 0 11.4' },
  calendar: { stroke: 'M4 6.5h16v13H4zM4 10.5h16M8.5 4v4M15.5 4v4' },
  users: { stroke: 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20c.6-3.4 3.2-5.5 6.5-5.5s5.9 2.1 6.5 5.5M16 4.3a3.5 3.5 0 0 1 0 6.4M18.5 14.8c1.6.8 2.7 2.6 3 5.2' },
  lock: { stroke: 'M6.5 11h11v9h-11zM8.5 11V8a3.5 3.5 0 0 1 7 0v3' },
  chat: { stroke: 'M4 5.5h16v10.5H9.5L5 19.5V16H4z' },
};
function LandIcon({ name, size = 16, className }) {
  const icon = LAND_ICONS[name];
  if (!icon) return null;
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill={icon.fill ? 'currentColor' : 'none'} stroke={icon.stroke ? 'currentColor' : 'none'}
      strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d={icon.fill || icon.stroke} />
    </svg>
  );
}

function WhatsAppGlyph({ size = 16 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="M12 3.3a8.7 8.7 0 0 0-7.5 13.1L3.3 20.7l4.4-1.2A8.7 8.7 0 1 0 12 3.3z" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinejoin="round" />
      <path d="M9.1 8.4c.2-.4.5-.4.7-.4h.5c.2 0 .4.1.5.4l.6 1.5c.1.2 0 .4-.1.6l-.5.6c.6 1.2 1.6 2.1 2.8 2.7l.6-.6c.2-.2.4-.2.6-.1l1.5.7c.2.1.3.3.3.5v.5c0 .3-.1.5-.4.7-.6.4-1.5.6-2.4.3-2.3-.8-4.2-2.7-5-5-.2-.9 0-1.8.3-2.4z" fill="currentColor" />
    </svg>
  );
}

function AppleGlyph({ size = 16, fill = 'currentColor' }) {
  return (
    <svg width={size * 0.84} height={size} viewBox="0 0 20 24" fill={fill} aria-hidden="true" focusable="false"><path d="M16.4 12.6c0-2.6 2.1-3.8 2.2-3.9-1.2-1.7-3-2-3.7-2-1.6-.2-3 .9-3.8.9s-2-.9-3.3-.9c-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.5 1.3-.1 1.8-.8 3.3-.8s2 .8 3.3.8c1.4 0 2.2-1.2 3.1-2.5.7-1 1-2 1-2-.1 0-2-.8-2-3.3zM13.9 3.5c.7-.9 1.2-2.1 1-3.3-1 0-2.3.7-3 1.5-.7.8-1.3 2-1.1 3.2 1.1.1 2.3-.6 3.1-1.4z" /></svg>
  );
}

function trackDownload() {
  if (typeof fbq !== 'undefined') fbq('trackCustom', 'ClickDownload');
}

function StoreBadge({ store }) {
  const apple = store === 'apple';
  const href = apple ? APP_STORE_URL : 'https://tally.so/r/BzerXK';
  const badge = (
    <a href={href} className="store-badge" target="_blank" rel="noopener noreferrer"
      onClick={apple ? trackDownload : undefined}>
      {apple ? (
        <AppleGlyph size={24} fill="#fff" />
      ) : (
        <svg width="20" height="22" viewBox="0 0 20 22" aria-hidden="true"><path d="M1 1.5v19l10-9.5L1 1.5z" fill="#fff" /><path d="M1 1.5l13.5 7L11 11 1 1.5z" fill="#fff" opacity="0.85" /><path d="M1 20.5L11 11l3.5 2.5L1 20.5z" fill="#fff" opacity="0.7" /><path d="M14.5 8.5L19 11l-4.5 2.5L11 11l3.5-2.5z" fill="#fff" opacity="0.55" /></svg>
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

function MiniAvatar({ initial, hue, size = 30 }) {
  return (
    <span className="mini-avatar" style={{
      width: size, height: size, fontSize: Math.round(size * 0.42),
      background: `radial-gradient(120% 120% at 30% 20%, hsl(${hue} 55% 60%), hsl(${hue + 24} 58% 38%))`,
    }}>{initial}</span>
  );
}

// ── feature mini-visuals ────────────────────────────────
function FeatureShot({ src, sticker, stickerIcon, stickerTone = 'lime' }) {
  return (
    <div className="fm fm-shot">
      <img src={src} alt="" />
      {sticker && (
        <span className={`fm-sticker fm-sticker-${stickerTone}`}>
          {stickerIcon && <LandIcon name={stickerIcon} size={13} />}
          {sticker}
        </span>
      )}
    </div>
  );
}

const CREATE_ROWS = [
  { label: 'Mitä', chips: ['Kaksinpeli', 'Nelinpeli', 'Pallottelu'], on: 0 },
  { label: 'Milloin', chips: ['Tänään', 'Huomenna', 'La'], on: 1 },
  { label: 'Missä', chips: ['Sisällä', 'Ulkona', 'Missä vain'], on: 0 },
];

function CreateGameMini() {
  return (
    <div className="fm fm-ui" aria-hidden="true">
      <div className="mini-card mini-create">
        <div className="mini-create-head">
          <span className="mini-create-title">Pelataanko?</span>
          <span className="mini-x">×</span>
        </div>
        {CREATE_ROWS.map((row, r) => (
          <div key={row.label} className="mini-create-row">
            <span className="mini-label">{row.label}</span>
            <div className="mini-chips">
              {row.chips.map((c, i) => (
                <span key={c} className={`mini-chip${i === row.on ? ' is-on' : ''}`} style={{ '--d': `${r * 0.35 + 0.3}s` }}>
                  {i === row.on && <LandIcon name="check" size={11} />}{c}
                </span>
              ))}
            </div>
          </div>
        ))}
        <div className="mini-more"><LandIcon name="plus" size={13} /><span>Lisätiedot</span><em>Pinta, taso, hinta…</em></div>
        <span className="mini-share"><WhatsAppGlyph size={16} />Jaa linkki WhatsAppiin</span>
      </div>
      <span className="fm-sticker fm-sticker-lime fm-sticker-tr">3 napautusta</span>
    </div>
  );
}

const MINI_BADGES = [
  { icon: 'ball', on: true },
  { icon: 'flame', on: true },
  { icon: 'trophy', on: true },
  { icon: 'users', on: true },
  { icon: 'star', on: false },
  { icon: 'crown', on: false },
];

function StreakMini() {
  return (
    <div className="fm fm-ui" aria-hidden="true">
      <div className="mini-card mini-streak">
        <CourtLines light />
        <div className="mini-streak-inner">
          <div className="mini-story">
            <span className="is-done" /><span className="is-done" /><span className="is-live" /><span />
          </div>
          <span className="mini-streak-eyebrow">Syyskuun kooste</span>
          <div className="mini-streak-main">
            <span className="mini-flame"><LandIcon name="flame" size={30} /></span>
            <span className="mini-streak-num">5<small> vk</small></span>
            <span className="mini-streak-label">viikkoputki</span>
          </div>
          <div className="mini-stats">
            <span><b>8</b>peliä</span>
            <span><b>5</b>voittoa</span>
            <span><b>6</b>pelikaveria</span>
          </div>
          <div className="mini-badges">
            {MINI_BADGES.map((b, i) => (
              <span key={i} className={`mini-badge${b.on ? ' is-on' : ''}`}>
                <LandIcon name={b.on ? b.icon : 'lock'} size={b.on ? 15 : 13} />
              </span>
            ))}
            <span className="mini-badge-count">14/26</span>
          </div>
        </div>
      </div>
      <span className="fm-sticker fm-sticker-lime fm-sticker-bl"><LandIcon name="star" size={12} />Uusi merkki!</span>
    </div>
  );
}

const MINI_TABLE = [
  { initial: 'R', hue: 150, name: 'Riikka', wl: '4–0', pts: 8, leader: true },
  { initial: 'A', hue: 160, name: 'Sinä', wl: '3–1', pts: 6, me: true },
  { initial: 'J', hue: 48, name: 'Joonas', wl: '2–2', pts: 4 },
  { initial: 'M', hue: 214, name: 'Mikko', wl: '1–3', pts: 2 },
];

function LeagueMini() {
  return (
    <div className="fm fm-ui" aria-hidden="true">
      <div className="mini-card mini-league">
        <div className="mini-league-head">
          <div>
            <span className="mini-league-title">Lahti · Keskitaso</span>
            <span className="mini-league-sub">Syyskausi 2026</span>
          </div>
          <span className="mini-league-group">Lohko A</span>
        </div>
        <div className="mini-table">
          <div className="mini-tr mini-th"><span>#</span><span>Pelaaja</span><span>V–H</span><span>Pist</span></div>
          {MINI_TABLE.map((r, i) => (
            <div key={r.name} className={`mini-tr${r.me ? ' is-me' : ''}`}>
              <span className="mini-rank">{r.leader ? <LandIcon name="crown" size={14} /> : i + 1}</span>
              <span className="mini-player"><MiniAvatar initial={r.initial} hue={r.hue} size={22} />{r.name}</span>
              <span>{r.wl}</span>
              <span className="mini-pts">{r.pts}</span>
            </div>
          ))}
        </div>
      </div>
      <span className="fm-sticker fm-sticker-dark fm-sticker-br"><LandIcon name="check" size={12} />Tulos vahvistettu</span>
    </div>
  );
}

// ── sections ────────────────────────────────────────────
function CoachBanner() {
  const [dismissed, setDismissed] = React.useState(false);
  if (dismissed) return null;
  return (
    <div className="coach-banner">
      <span>Oletko valmentaja tai valmennettava?<br /><a href="https://koutsi.krossi.app">Siirry Krossi Koutsiin →</a></span>
      <button type="button" className="coach-banner-close" onClick={() => setDismissed(true)} aria-label="Sulje ilmoitus">×</button>
    </div>
  );
}

function Nav() {
  return (
    <div className="nav-wrap">
      <header className="nav-pill">
        <a href="#top" className="nav-logo"><Wordmark size={21} /></a>
        <nav className="nav-links">
          <a href="#ominaisuudet">Ominaisuudet</a>
          <a href="/demo">Demo</a>
          <a href="#halleille">Halleille</a>
          <a href="https://koutsi.krossi.app">Valmentajille</a>
        </nav>
        <a href="/pelaa" className="btn-dark btn-sm" style={{ padding: '10px 18px', fontSize: 14 }}>Aloita pelit</a>
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
          <span className="hero-badge"><span className="hero-badge-tag">Uusi</span>Krossi toimii nyt selaimessa</span>
          <h1 className="hero-title">
            Uutta{' '}
            {t.highlight ? <span className="hl">peliseuraa?</span> : <span>peliseuraa?</span>}
          </h1>
          <p className="hero-sub">Löydä oman tasoisesi pelikaverit ja sovi peli muutamalla napautuksella. Krossi toimii suoraan selaimessa ilman latausta — ja iPhonessa.</p>
          <div className="hero-cta">
            <a href="/pelaa" className="btn-lime btn-lg">Aloita pelit</a>
            <a href="/demo" className="btn-ghost btn-lg">Kokeile demoa <span className="btn-note">— ilman tiliä</span></a>
          </div>
          <ul className="hero-points">
            <li><LandIcon name="check" size={15} />Ei latausta</li>
            <li><LandIcon name="check" size={15} />Puhelimella ja koneella</li>
            <li>
              <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={trackDownload}>
                <AppleGlyph size={15} />Myös App Storessa
              </a>
            </li>
          </ul>
        </div>
        <div className="hero-visual" ref={phoneVisualRef}>
          <p className="demo-label">Kurkista sisään — puhelinta voi selata</p>
          <div className="hero-stage">
            <div className="phone-front"><KrossiPhone startTab="players" width={290} onScrollEl={handleScrollEl} /></div>
          </div>
        </div>
    </section>
  );
}

const FEATURES = [
  {
    n: '01', side: 'left', kind: 'shot', title: 'Löydä pelikavereita',
    body: 'Selaa lähialueen pelaajia ja löydä oman tasoisesi peliseura. Pelaa nyt -merkki kertoo, kuka lähtisi kentälle heti.',
    media: <FeatureShot src="assets/loyda-pelikavereita.png" sticker="Pelaa nyt" stickerIcon="bolt" />,
  },
  {
    n: '02', side: 'right', kind: 'ui', title: 'Pelataanko?',
    body: 'Peli sovittu kolmella napautuksella: mitä, milloin ja missä. Lisätiedot lisäät, jos haluat — ja linkin jaat suoraan WhatsAppiin.',
    media: <CreateGameMini />,
  },
  {
    n: '03', side: 'left', kind: 'shot', title: 'Pelikaverit ja viestit',
    body: 'Pelikaverit pysyvät tallessa ja juttu luistaa suoraan Krossissa. Lähetä pelipyyntö ja sopikaa loput chatissa.',
    media: <FeatureShot src="assets/sovi-pelit-helposti.png" />,
  },
  {
    n: '04', side: 'right', kind: 'ui', title: 'Putket, merkit ja koosteet',
    body: 'Pidä viikkoputki käynnissä, kerää kaikki 26 merkkiä ja katso kuun lopussa kooste peleistäsi, voitoistasi ja pelikavereistasi.',
    media: <StreakMini />,
  },
  {
    n: '05', side: 'left', kind: 'ui', title: 'Liigat',
    body: 'Pelaa oman tasosi lohkossa koko kauden. Kun vastustaja vahvistaa tuloksen, sarjataulukko päivittyy itsestään.',
    media: <LeagueMini />,
  },
];

// ── demo preview: open games ────────────────────────────
// Mirrors open games in the /demo seed (krossi/web/src/api/demo/seed.js) so the preview matches
// what the demo shows. Days are relative to today, like in the demo.
const FI_WEEKDAYS = ['Sunnuntai', 'Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai'];

function demoWhen(dayOffset, time) {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  const at = (offset) => new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset, h, m);
  let offset = dayOffset;
  if (at(offset).getTime() < now.getTime() + 90 * 60 * 1000) offset += 1;
  const day = offset === 0 ? 'Tänään' : offset === 1 ? 'Huomenna' : FI_WEEKDAYS[at(offset).getDay()];
  return `${day} · klo ${h}.${String(m).padStart(2, '0')}`;
}

const DEMO_MATCHES = [
  { id: 'teemu', creator: 'Teemu', initials: 'T', hue: 8, age: '30–40', level: 'Kilpapelaaja', type: 'Kaksinpeli', loc: 'Kispi Areena', locType: 'Sisätennis', day: 0, time: '19:00', desc: 'Haen kunnon harjoitusmatsia, 1,5 tunnin vuoro.', slots: 1 },
  { id: 'olli', creator: 'Olli', initials: 'O', hue: 40, age: '50–60', level: 'Keskitaso', type: 'Pallottelu', loc: 'Kispi Areena', locType: 'Sisätennis', day: 1, time: '07:00', desc: 'Rentoa lyöntiharjoittelua ennen töitä ☕', slots: 1 },
  { id: 'sanna', creator: 'Sanna', initials: 'S', hue: 44, age: '40–50', level: 'Edistynyt', type: 'Nelinpeli', loc: 'Janus Areena', locType: 'Sisätennis', day: 2, time: '10:00', desc: 'Kaksi paikkaa vapaana, kaikki tasot keskitasosta ylöspäin.', slots: 2 },
  { id: 'riikka', creator: 'Riikka', initials: 'R', hue: 150, age: '20–30', level: 'Kilpapelaaja', type: 'Kaksinpeli', loc: 'Janus Areena', locType: 'Sisätennis', day: 3, time: '20:00', desc: 'Treenaan kisoihin ja etsin tasaista vastusta.', slots: 1 },
];

function DemoAvatar({ initials, hue, size = 38 }) {
  return (
    <div style={{
      width: size, height: size, borderRadius: '50%', flexShrink: 0,
      background: `linear-gradient(135deg, hsl(${hue} 55% 55%), hsl(${hue+30} 50% 38%))`,
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      color: '#fff', fontWeight: 700, fontSize: size * 0.4, letterSpacing: 0.3,
    }}>{initials}</div>
  );
}

function UpcomingMatches() {
  return (
    <section className="upcoming" id="tulevat">
      <div className="upcoming-inner">
        <div className="upcoming-header">
          <span className="eyebrow"><span className="demo-tag">Demo</span> Esikatselu</span>
          <h2 className="upcoming-title">Avoimet haasteet Lahdessa</h2>
          <p className="upcoming-sub">Tällaisia pelejä Krossissa sovitaan. Avaa demo ja kokeile liittymistä — ilman tiliä.</p>
        </div>
        <div className="upcoming-grid">
          {DEMO_MATCHES.map((m) => (
            <a key={m.id} href="/demo/pelit" className="upcoming-card">
              <div className="uc-top">
                <span className="uc-day">{demoWhen(m.day, m.time)}</span>
                <span className="uc-type">{m.type}</span>
              </div>
              <div className="uc-body">
                <DemoAvatar initials={m.initials} hue={m.hue} size={42} />
                <div className="uc-info">
                  <div className="uc-name">{m.creator}, {m.age}</div>
                  <div className="uc-loc">{m.loc} · {m.locType}</div>
                </div>
                <div className="uc-slots" aria-label={`${m.slots} ${m.slots === 1 ? 'paikka' : 'paikkaa'} vapaana`}>
                  {Array.from({ length: m.slots }).map((_, i) => (
                    <span key={i} className="uc-slot" />
                  ))}
                </div>
              </div>
              {m.desc && <p className="uc-desc">{m.desc}</p>}
              <div className="uc-foot">
                <span className="uc-tag">{m.level}</span>
                <span className="uc-open">Avaa demossa <LandIcon name="arrow" size={14} /></span>
              </div>
            </a>
          ))}
        </div>
        <div className="upcoming-cta">
          <a href="/demo/pelit" className="btn-dark btn-lg">Selaa pelejä demossa <LandIcon name="arrow" size={18} /></a>
        </div>
      </div>
    </section>
  );
}

function Features() {
  return (
    <section className="features" id="ominaisuudet">
      <div className="features-header">
        <span className="eyebrow"><span className="ball-dot" /> Ominaisuudet</span>
        <h2 className="sec-title">Vähemmän viestittelyä, enemmän pelejä.</h2>
      </div>
      <div className="feat-zig">
        {FEATURES.map((f) => (
          <article key={f.n} className={`feat-card feat-${f.side} feat-kind-${f.kind}`}>
            <div className="feat-media">{f.media}</div>
            <div className="feat-body">
              <span className="feat-num">{f.n}</span>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

const KROSSI_CITIES = ['Lahti', 'Turku', 'Helsinki', 'Tampere', 'Oulu', 'Jyväskylä', 'Pori', 'Kuopio', 'Rovaniemi', 'Mikkeli'];

function Trust() {
  return (
    <section className="trust trust-light" id="lahti">
      <div className="trust-inner">
        <span className="eyebrow eyebrow-light"><span className="ball-dot" /> Krossi laajenee kaupunkeihin ympäri Suomen</span>
        <h2>Rakennetaan Suomen<br />tennisverkostoa yhdessä.</h2>
        <p>Krossi on jo käytössä kymmenessä kaupungissa. Kun pelaajat löytyvät samasta paikasta, pelien sopiminen, tapahtumien jakaminen ja uusien tenniskavereiden löytäminen helpottuu kaikille.</p>
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
          <h2>Hallille, seuralle tai{' '}<br />valmentajalle?</h2>
          <p>Krossi voi auttaa kokoamaan paikalliset pelaajat, tapahtumat ja ilmoitukset yhteen selkeään kanavaan.</p>
          <a href="mailto:eelispuro@gmail.com" className="btn-outline btn-lg">Ota yhteyttä</a>
        </div>
        <div className="clubs-deco" aria-hidden="true"><img src={BALL} alt="" /></div>
      </div>
    </section>
  );
}

function DemoBand() {
  return (
    <section className="demo-band" id="demo">
      <div className="demo-band-inner">
        <div className="demo-band-copy">
          <span className="eyebrow eyebrow-green"><span className="demo-tag">Demo</span> Ilman tiliä</span>
          <h2>Kokeile demoa</h2>
          <p>Koko Krossi esimerkkidatalla: selaa pelaajia, sovi peli, laita viestiä ja kurkkaa liigataulukkoon. Mikään ei tallennu.</p>
          <ul className="demo-band-points">
            <li><LandIcon name="check" size={15} />Ei rekisteröitymistä</li>
            <li><LandIcon name="check" size={15} />Aukeaa heti selaimessa</li>
          </ul>
          <div className="demo-band-cta">
            <a href="/demo" className="btn-dark btn-lg">Avaa demo <LandIcon name="arrow" size={18} /></a>
            <a href="/pelaa" className="demo-band-alt">tai aloita oikeat pelit</a>
          </div>
        </div>
        <a href="/demo" className="demo-window" aria-label="Avaa Krossin demo">
          <div className="demo-window-bar">
            <span className="demo-window-dots"><i /><i /><i /></span>
            <span className="demo-window-url"><LandIcon name="lock" size={11} />krossi.app/demo</span>
          </div>
          <div className="demo-window-body" aria-hidden="true">
            <div className="dw-banner"><span>Demotila — mikään ei tallennu</span><b>Luo oma tili</b></div>
            <div className="dw-hello">
              <span className="dw-hi">Moi Alex! 👋</span>
              <span className="dw-streak"><LandIcon name="flame" size={13} />4 vk</span>
            </div>
            <span className="dw-play"><LandIcon name="plus" size={16} />Pelataanko?</span>
            <div className="dw-row">
              <MiniAvatar initial="T" hue={8} size={26} />
              <span className="dw-row-text"><b>Teemu · Kaksinpeli</b><em>Kispi Areena · 1 paikka</em></span>
              <span className="dw-join">Liity</span>
            </div>
            <div className="dw-row">
              <MiniAvatar initial="S" hue={44} size={26} />
              <span className="dw-row-text"><b>Sanna · Nelinpeli</b><em>Janus Areena · 2 paikkaa</em></span>
              <span className="dw-join">Liity</span>
            </div>
          </div>
        </a>
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
          <a href="/pelaa" className="btn-lime btn-lg">Aloita pelit</a>
        </div>
      </div>
      <div className="closing-stores">
        <p>Mieluummin sovelluksena? Krossi löytyy myös puhelimeen.</p>
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
          <a href="/demo">Kokeile demoa</a>
          <a href="mailto:eelispuro@gmail.com">eelispuro@gmail.com</a>
          <span>Suomi</span>
          <a href="#" onClick={e => { e.preventDefault(); window.krossiOpenCookieSettings && window.krossiOpenCookieSettings(); }}>Evästeasetukset</a>
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
      <CoachBanner />
      <Nav />
      <Hero t={t} />
      <UpcomingMatches />
      <Features />
      <Trust />
      <Clubs />
      <DemoBand />
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
