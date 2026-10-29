// TrialStart — a signed-in person who is not a coach yet starts Koutsi without a coach key: a 3-month
// free trial, no card, the subscription terms accepted with the same tap (api.subscription.startTrial).
// Shown in place of the coach-key page once the database has it and sign-ups are open; the key
// stays one tap away.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useSession } from '../app/session.jsx';
import { KoutsiWordmark, Splash } from '../shared/gates.jsx';
import { Button, useToast } from '../ui/index.js';
import { priceLine, TRIAL_MONTHS } from '../domain/subscription.js';

export function TrialStart({ onStarted, onUseKey }) {
  const { signOut } = useSession();
  const toast = useToast();
  // undefined = still reading the price from Stripe: the page waits, so the first line shows whole
  // at once instead of growing when the price arrives.
  const [price, setPrice] = useState(undefined);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    api.subscription.price().then((p) => { if (alive) setPrice(p); }).catch(() => { if (alive) setPrice(null); });
    return () => { alive = false; };
  }, []);
  const start = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await api.subscription.startTrial();
      await onStarted();
    } catch (err) { toast(err); setBusy(false); }
  };
  if (price === undefined) return <Splash />;
  const cost = priceLine(price);
  return (
    <div className="k-center-page">
      <div className="k-gate-card">
        <KoutsiWordmark size="sm" />
        <h1 className="k-gate-title">Aloita valmentajana</h1>
        <p className="k-gate-lead">{TRIAL_MONTHS} kk ilmaiseksi{cost ? `, sitten ${cost}` : ''}. Ei korttia, eikä kokeilu muutu maksulliseksi itsestään.</p>
        <Button variant="dark" size="lg" block loading={busy} onClick={start} className="k-gate-cta">Aloita {TRIAL_MONTHS} kk ilmainen kokeilu</Button>
        {/* one child: .k-fine is a flex row (icon + text) */}
        <p className="k-fine"><span>Aloittamalla vahvistat olevasi vähintään 18-vuotias ja hyväksyt <a href="/tilausehdot" target="_blank" rel="noopener">tilausehdot</a> ja <a href="/kasittelysopimus" target="_blank" rel="noopener">käsittelysopimuksen</a>.</span></p>
        <Button variant="ghost" block onClick={onUseKey} disabled={busy}>Minulla on valmentaja-avain</Button>
        <Button variant="ghost" block onClick={signOut} disabled={busy}>Kirjaudu ulos</Button>
      </div>
    </div>
  );
}
