// AuthHero — the clay-court photo hero shared by the logged-out screens (AuthScreen, InviteScreen).
//   <AuthLayout hero={<…/>} pitch>{panel content}</AuthLayout>
// Phones: photo on the top ~45 % with the panel rising over it as a rounded sheet.
// Desktop (≥ 900 px): split layout — photo + pitch on the left, panel on the right.
import { Icon } from '../../ui/index.js';

const COURT_IMG = '/krossi/static/clay-court.jpg';
const BALL_IMG = '/krossi/static/ball.png';

export const VALUE_PROPS = [
  { icon: 'users', title: 'Löydä tasoisesi pelikaveri', text: 'Näet kotikaupunkisi pelaajat tason ja aikataulun mukaan.' },
  { icon: 'calendar-plus', title: 'Sovi peli minuuteissa', text: 'Luo avoin peli tai liity muiden peleihin — ilman loputonta viestittelyä.' },
  { icon: 'flame', title: 'Pidä putki käynnissä', text: 'Kirjaa tulokset, kerää merkkejä ja seuraa pelejäsi viikko viikolta.' },
];

/** Big lime "Krossi" wordmark with a bouncing ball as the full stop. */
export function Wordmark({ size = 'lg' }) {
  return (
    <span className={`auth-wordmark auth-wordmark-${size}`} aria-label="Krossi">
      <span aria-hidden="true">Krossi</span>
      <img className="auth-wordmark-ball" src={BALL_IMG} alt="" aria-hidden="true" />
    </span>
  );
}

export function AuthLayout({ hero, pitch = false, children }) {
  return (
    <div className="auth">
      <section className="auth-hero on-dark">
        <img className="auth-hero-img" src={COURT_IMG} alt="" aria-hidden="true" decoding="async" />
        <div className="auth-hero-shade" aria-hidden="true" />
        <div className="auth-hero-top">
          <a className="auth-hero-back" href="/">
            <Icon name="arrow-left" size={15} strokeWidth={2.4} />
            krossi.app
          </a>
        </div>
        <div className="auth-hero-body">{hero}</div>
        {pitch && (
          <ul className="auth-pitch stagger" aria-label="Mikä Krossi on">
            {VALUE_PROPS.map((p, i) => (
              <li key={p.title} className="auth-pitch-item" style={{ '--i': i + 2 }}>
                <span className="auth-pitch-icon"><Icon name={p.icon} size={18} /></span>
                <span className="auth-pitch-title">{p.title}</span>
                <span className="auth-pitch-text">{p.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <div className="auth-panel">
        <div className="auth-panel-inner">{children}</div>
      </div>
    </div>
  );
}

/** The small way-out links under the form. */
export function AuthLinks() {
  return (
    <nav className="auth-links" aria-label="Muut vaihtoehdot">
      <a className="auth-demo-link" href="/demo">
        <span className="auth-demo-link-icon"><Icon name="play" size={16} /></span>
        <span className="auth-demo-link-text">
          <span className="auth-demo-link-title">Kokeile ensin demoa</span>
          <span className="auth-demo-link-sub">Selaa pelejä ja pelaajia ilman tiliä</span>
        </span>
        <Icon name="arrow-right" size={18} className="auth-demo-link-arrow" />
      </a>
      <a className="auth-koutsi-link" href="https://koutsi.krossi.app">
        Etsitkö Krossi Koutsia? <span aria-hidden="true">→</span>
      </a>
    </nav>
  );
}
