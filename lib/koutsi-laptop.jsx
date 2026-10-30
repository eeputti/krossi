// koutsi-laptop.jsx — the laptop on koutsi.krossi.app's front page: the coach app on a computer.
// A browser window with one tab per view; every few seconds the next view fades in and slowly
// scrolls down, and the card of that view lights up under the laptop. A card shows that view at
// once; the laptop itself is only a picture (no clicks, drags or selection on it). The screens are real screenshots of the demo, taken with
// node scripts/koutsi-landing-desktop-shots.mjs (Viestit left out: the real app doesn't have it yet).

const { useEffect, useRef, useState } = React;

const LT_SCREENS = [
  {
    id: 'suunnittele', tab: 'Suunnittele', url: 'koutsi.krossi.app/valmentaja/suunnittele', src: 'assets/koutsi-kone-suunnittele.webp',
    alt: 'Suunnittele: kauden viikot ja ryhmien teemat taulukossa',
    title: 'Treenien suunnittelu', text: 'Koko kauden teemat ja treenit yhdessä taulukossa. Kopioi ja liitä viikosta toiseen kuin Excelissä.',
  },
  {
    id: 'viikko', tab: 'Viikkohallinta', url: 'koutsi.krossi.app/valmentaja/ryhmat', src: 'assets/koutsi-kone-viikko.webp',
    alt: 'Viikkohallinta: kaikkien ryhmien treenit viikkokalenterissa',
    title: 'Viikkohallinta', text: 'Kaikkien ryhmien treenit viikkokalenterissa. Poissaolot ja puuttuvat teemat näkyvät heti.',
  },
  {
    id: 'pelaaja', tab: 'Pelaajat', url: 'koutsi.krossi.app/valmentaja/pelaaja', src: 'assets/koutsi-kone-pelaaja.webp',
    alt: 'Pelaajan sivu: läsnäolot, treenit viikossa, fiilis ja kuukauden kalenteri',
    title: 'Läsnäolot ja seuranta', text: 'Merkitse kuka oli paikalla. Jokaisen pelaajan läsnäolot, fiilikset ja tavoitteet yhdellä sivulla.',
  },
  {
    id: 'laskutus', tab: 'Laskutus', url: 'koutsi.krossi.app/valmentaja/laskutus', src: 'assets/koutsi-kone-laskutus.webp',
    alt: 'Laskutus: avoimet ja maksetut laskut pelaajittain',
    title: 'Laskutus', text: 'Laskut suoraan läsnäoloista viitenumerolla, PDF:nä ja sähköpostiin. Verkkomaksulla pelaaja maksaa MobilePaylla, kortilla tai Klarnalla.',
  },
];
const LT_STEP_MS = 4200;

function LaptopTour() {
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [still] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tick, setTick] = useState(0); // restarts the timer after a tap
  const root = useRef(null);

  // turns only while the laptop is on screen, so the tour starts where the visitor is looking
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver !== 'function') { setVisible(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || still) return undefined;
    const t = setTimeout(() => setActive((i) => (i + 1) % LT_SCREENS.length), LT_STEP_MS);
    return () => clearTimeout(t);
  }, [visible, still, active, tick]);
  const show = (i) => { setActive(i); setTick((n) => n + 1); };
  const on = LT_SCREENS[active];

  return (
    <div className="lt" ref={root}>
      <div className="lt-device" role="group" aria-label="Krossi Koutsi tietokoneella">
        <div className="lt-lid">
          <span className="lt-cam" aria-hidden="true" />
          <div className="lt-screen">
            <div className="lt-chrome">
              <div className="lt-tabs" aria-hidden="true">
                <span className="lt-dots"><i /><i /><i /></span>
                {LT_SCREENS.map((s, i) => (
                  <span key={s.id} className={'lt-tab' + (i === active ? ' is-on' : '')}>
                    <img src="assets/ball-tight.png" alt="" width="14" height="14" draggable="false" />
                    <span>{s.tab}</span>
                  </span>
                ))}
              </div>
              <div className="lt-bar">
                <span className="lt-url">
                  <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden="true"><rect x="1" y="5" width="8" height="6.5" rx="1.5" fill="currentColor" /><path d="M2.8 5V3.6a2.2 2.2 0 0 1 4.4 0V5" fill="none" stroke="currentColor" strokeWidth="1.4" /></svg>
                  {on.url}
                </span>
              </div>
            </div>
            <div className={'lt-view' + (still ? ' is-still' : '')}>
              {LT_SCREENS.map((s, i) => (
                <img key={s.id} src={s.src} alt={i === active ? s.alt : ''} aria-hidden={i === active ? undefined : 'true'}
                  width="1600" height="1400" loading="lazy" decoding="async" draggable="false" className={'lt-shot' + (i === active ? ' is-on' : '')} />
              ))}
            </div>
          </div>
        </div>
        <div className="lt-base" aria-hidden="true" />
      </div>
      <div className="lt-cards">
        {LT_SCREENS.map((s, i) => (
          <button key={s.id} type="button" className={'lt-card' + (i === active ? ' is-on' : '')} onClick={() => show(i)} aria-pressed={i === active}>
            <span className="lt-card-title">{s.title}</span>
            <span className="lt-card-text">{s.text}</span>
            {/* fills while this view is on, then the next one comes (restarts on a tap) */}
            {i === active && visible && !still && <span key={tick} className="lt-card-bar" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

Object.assign(window, { LaptopTour });
