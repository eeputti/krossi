// koutsi-player-phone.jsx — the phone on koutsi.krossi.app's front page: what a player gets.
// The player app in a phone; every few seconds the next view fades in and scrolls slowly down
// under the tab bar, and the card of that view lights up beside the phone. A card shows that view
// at once; the phone itself is only a picture (no clicks, drags or selection on it), like the
// laptop (lib/koutsi-laptop.jsx). The screens are real screenshots of the demo, taken with
// node scripts/koutsi-landing-phone-shots.mjs (Viestit left out: the real app doesn't have it yet).

const PP_SCREENS = [
  {
    id: 'koti', src: 'assets/koutsi-puhelin-koti.webp', tabs: 'assets/koutsi-puhelin-koti-tabs.png',
    alt: 'Koti: viikon treenit, tiedote, valmentajan huomio ja seuraava treeni teemoineen',
    title: 'Seuraava treeni', text: 'Näet heti, milloin seuraava treeni on ja mikä sen teema on. Jos et pääse, ilmoitat sen yhdellä napautuksella.',
  },
  {
    id: 'viikko', src: 'assets/koutsi-puhelin-viikko.webp', tabs: 'assets/koutsi-puhelin-viikko-tabs.png',
    alt: 'Viikko: kotiläksyt ja viikon treenit kalenterissa',
    title: 'Viikko ja kotiläksyt', text: 'Kaikki treenisi viikkokalenterissa ja kotiläksyt ylimpänä. Kirjaa myös omat treenisi, niin valmentaja näkee ne.',
  },
  {
    id: 'merkitse', src: 'assets/koutsi-puhelin-merkitse.webp', sheet: true,
    alt: 'Merkitse: miten treeni meni, ja mitä teit, kuten tennis, ottelu tai lenkki',
    title: 'Miten meni?', text: 'Arvioi treeni ja kirjoita, mitä opit. Merkitse myös ottelut, turnaukset, salitreenit ja lenkit.',
  },
  {
    id: 'kehitys', src: 'assets/koutsi-puhelin-kehitys.webp', tabs: 'assets/koutsi-puhelin-kehitys-tabs.png',
    alt: 'Kehitys: oma tavoite, toive valmentajalle, viikon treenipäivät ja aikajana',
    title: 'Tavoitteet ja palautteet', text: 'Oma tavoite, valmentajan palautteet ja videot samalla aikajanalla. Näet, miten olet kehittynyt koko kauden.',
  },
  {
    id: 'harjoitteet', src: 'assets/koutsi-puhelin-harjoitteet.webp', tabs: 'assets/koutsi-puhelin-harjoitteet-tabs.png',
    alt: 'Harjoitteet ja videot: harjoitekirjasto ja valmentajan videot',
    title: 'Harjoitteet ja videot', text: 'Yli 200 harjoitteen kirjasto ja valmentajan videot. Treenaa omalla ajalla samoja juttuja kuin kentällä.',
  },
];
const PP_STEP_MS = 5000;
// the player's own sign-up (Luo tili); a coach's group link or code brings them to the group
const PP_SIGNUP = 'https://koutsi.krossi.app/pelaaja';

function PlayerPhoneTour() {
  const { useEffect, useRef, useState } = React;
  const [active, setActive] = useState(0);
  const [visible, setVisible] = useState(false);
  const [still] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [tick, setTick] = useState(0); // restarts the timer after a tap
  const root = useRef(null);

  // turns only while the phone is on screen, so the tour starts where the visitor is looking
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver !== 'function') { setVisible(true); return undefined; }
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!visible || still) return undefined;
    const t = setTimeout(() => setActive((i) => (i + 1) % PP_SCREENS.length), PP_STEP_MS);
    return () => clearTimeout(t);
  }, [visible, still, active, tick]);
  const show = (i) => { setActive(i); setTick((n) => n + 1); };
  const on = PP_SCREENS[active];

  return (
    <div className="pp" ref={root}>
      <div className="pp-device" role="group" aria-label="Krossi Koutsi pelaajan puhelimessa">
        {/* is-playing: the page scrolls only while the phone is on screen, so it starts from the top */}
        <div className={'pp-screen' + (on.sheet ? ' is-sheet' : '') + (still ? ' is-still' : visible ? ' is-playing' : '')}>
          <div className="pp-view">
            {PP_SCREENS.map((s, i) => (
              <img key={s.id} src={s.src} alt={i === active ? s.alt : ''} aria-hidden={i === active ? undefined : 'true'}
                width="780" height={s.sheet ? 1594 : 2480} loading="lazy" decoding="async" draggable="false"
                className={'pp-shot' + (s.sheet ? ' is-sheet' : '') + (i === active ? ' is-on' : '')} />
            ))}
          </div>
          {/* the tab bar stays put while the page scrolls under it; Merkitse is a sheet over it */}
          <div className="pp-tabs" aria-hidden="true">
            {PP_SCREENS.filter((s) => s.tabs).map((s) => (
              <img key={s.id} src={s.tabs} alt="" width="780" height="170" loading="lazy" decoding="async" draggable="false"
                className={s.id === on.id ? 'is-on' : ''} />
            ))}
          </div>
          <div className="pp-home" aria-hidden="true"><i /></div>
          <div className="pp-status" aria-hidden="true">
            <span className="pp-time">9.30</span>
            <span className="pp-island" />
            <span className="pp-icons">
              <svg viewBox="0 0 18 12" width="18" height="12"><rect x="0" y="8" width="3" height="4" rx="1" /><rect x="5" y="5.5" width="3" height="6.5" rx="1" /><rect x="10" y="3" width="3" height="9" rx="1" /><rect x="15" y="0" width="3" height="12" rx="1" /></svg>
              <svg viewBox="0 0 16 12" width="16" height="12"><path d="M8 2.2c2.4 0 4.6.9 6.2 2.5l1.3-1.3A10.6 10.6 0 0 0 8 .3 10.6 10.6 0 0 0 .5 3.4l1.3 1.3A8.8 8.8 0 0 1 8 2.2Zm0 3.6c1.4 0 2.7.6 3.7 1.5l1.3-1.3a7 7 0 0 0-10 0l1.3 1.3c1-1 2.3-1.5 3.7-1.5Zm0 3.6c-.5 0-1 .2-1.3.6L8 11.3l1.3-1.3c-.3-.4-.8-.6-1.3-.6Z" /></svg>
              <svg viewBox="0 0 27 12" width="27" height="12"><rect x="0.5" y="0.5" width="23" height="11" rx="3.2" fill="none" stroke="currentColor" opacity=".4" /><rect x="2.5" y="2.5" width="16" height="7" rx="1.6" /><path d="M25 4v4a2 2 0 0 0 0-4Z" opacity=".4" /></svg>
            </span>
          </div>
        </div>
      </div>
      <div className="pp-cards">
        {PP_SCREENS.map((s, i) => (
          <button key={s.id} type="button" className={'lt-card pp-card' + (i === active ? ' is-on' : '')} onClick={() => show(i)} aria-pressed={i === active}>
            <span className="lt-card-title">{s.title}</span>
            <span className="lt-card-text">{s.text}</span>
            {/* fills while this view is on, then the next one comes (restarts on a tap) */}
            {i === active && visible && !still && <span key={tick} className="lt-card-bar pp-card-bar" aria-hidden="true" />}
          </button>
        ))}
      </div>
    </div>
  );
}

// The player's side of Koutsi: the phone above, the button to start under it.
function PlayerSection() {
  return (
    <section className="player" id="pelaajalle">
      <div className="player-inner">
        <span className="eyebrow"><span className="ball-dot" /> Pelaajalle</span>
        <h2>Kaikki treenisi <span className="hl">taskussa.</span></h2>
        <p className="player-sub">Omat treenit, valmentajan palautteet ja oma kehitys yhdessä sovelluksessa. Pelaajalle Koutsi on aina maksuton.</p>
        <PlayerPhoneTour />
        <div className="player-cta">
          <a href={PP_SIGNUP} className="btn-lime btn-lg">Aloita treenaaminen →</a>
          <p>Liity valmentajasi ryhmään ryhmälinkillä tai liittymiskoodilla.</p>
        </div>
      </div>
    </section>
  );
}

Object.assign(window, { PlayerSection });
