// InviteScreen — logged-out /pelaa/kutsu/:code. "Alex kutsui sinut Krossiin" + why Krossi + sign up.
// The Gate (app/App.jsx) has already stored the code; it is claimed after onboarding.
import { navigate } from '../../app/router.js';
import { Avatar, Button, Icon } from '../../ui/index.js';
import { AuthLayout, VALUE_PROPS, Wordmark } from './AuthHero.jsx';
import { useInviter } from './useInviter.js';

export function InviteScreen({ params }) {
  const code = params?.code ? String(params.code) : null;
  const { inviterName, loading } = useInviter(code);

  const hero = (
    <div className="auth-hero-brand auth-invite-hero">
      <Wordmark size="sm" />
      {loading ? (
        <div className="auth-invite-skel" aria-busy="true" aria-label="Ladataan kutsua">
          <span className="auth-skel auth-skel-avatar" />
          <span className="auth-skel auth-skel-line" />
          <span className="auth-skel auth-skel-line auth-skel-short" />
        </div>
      ) : (
        <div className="auth-invite-who rise">
          {inviterName ? (
            <>
              <span className="auth-invite-avatar pop">
                <Avatar name={inviterName} color="green" size={60} />
                <span className="auth-invite-avatar-ball" aria-hidden="true">🎾</span>
              </span>
              <h1 className="auth-invite-title">{inviterName} kutsui sinut Krossiin</h1>
              <p className="auth-tagline">Lähde pelaamaan — pelikaveri on jo valmiina.</p>
            </>
          ) : (
            <>
              <span className="auth-invite-avatar auth-invite-avatar-generic pop"><Icon name="gift" size={28} /></span>
              <h1 className="auth-invite-title">Sinut on kutsuttu Krossiin!</h1>
              <p className="auth-tagline">Löydä pelikaveri. Sovi peli. Pelaa.</p>
            </>
          )}
        </div>
      )}
    </div>
  );

  return (
    <AuthLayout hero={hero}>
      <div className="auth-card auth-invite-card">
        <p className="eyebrow">Näin Krossi toimii</p>
        <ul className="auth-props stagger">
          {VALUE_PROPS.map((p, i) => (
            <li key={p.title} className="auth-prop" style={{ '--i': i }}>
              <span className="auth-prop-icon"><Icon name={p.icon} size={20} /></span>
              <span className="auth-prop-text">
                <span className="auth-prop-title">{p.title}</span>
                <span className="auth-prop-sub">{p.text}</span>
              </span>
            </li>
          ))}
        </ul>
        <div className="auth-invite-actions">
          <Button variant="lime" size="lg" block iconRight="arrow-right" onClick={() => navigate('/pelaa')}>
            Luo tili ja aloita
          </Button>
          <Button as="a" href="/demo" variant="outline" size="lg" block icon="play">
            Kokeile demoa
          </Button>
        </div>
        <p className="auth-terms">
          Onko sinulla jo tili?{' '}
          <button type="button" className="auth-textlink" onClick={() => navigate('/pelaa', { state: { authMode: 'login' } })}>
            Kirjaudu sisään
          </button>
        </p>
      </div>
      <a className="auth-koutsi-link" href="https://koutsi.krossi.app">
        Etsitkö Krossi Koutsia? <span aria-hidden="true">→</span>
      </a>
    </AuthLayout>
  );
}
