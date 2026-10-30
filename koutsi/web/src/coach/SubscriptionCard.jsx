// SubscriptionCard — Profiili → Tilaus: the trial's days left, the subscription or a failed payment,
// and one button (Stripe Checkout or Stripe's customer portal). Nothing at all for a free coach
// (today's coaches, coach keys) or before the database has it. Back from Stripe (?tilaus=valmis /
// ?tilaus=palasit) it reads the subscription straight from Stripe instead of waiting for the webhook.
// PlanNotice — the one line Merkitse shows when the trial ended without a subscription (sending to
// players is locked in the database then; planning goes on).
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { dropQueryParam, navigate, useRoute } from '../app/router.js';
import { Button, Card, Field, Icon, Input, ListRow, Sheet, useToast } from '../ui/index.js';
import { checkoutChoices, keyWelcome, NO_SUBSCRIPTION, planCard } from '../domain/subscription.js';
import { KeyWelcome } from './KeyWelcome.jsx';
import { SUPPORT_EMAIL } from '../lib/constants.js';
import { useCoach } from './CoachRoot.jsx';
import { loadPlanStatus, setPlanStatus, usePlanStatus } from './subscriptionStore.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function PlanNotice({ onGo }) {
  const { uid } = useCoach();
  const status = usePlanStatus(uid);
  if (status.plan !== 'ended') return null;
  return (
    // one child: .vs-situation is a wrapping flex row, the sentence should flow as text
    <p className="vs-situation">
      <span>
        <strong>Kokeilu päättyi.</strong> Pelaajille lähettäminen vaatii tilauksen.{' '}
        <button type="button" className="k-textlink" onClick={() => { onGo?.(); navigate('/valmentaja/profiili'); }}>Ota tilaus</button>
      </span>
    </p>
  );
}

export function SubscriptionCard() {
  const toast = useToast();
  const { uid } = useCoach();
  const { query } = useRoute();
  const [back] = useState(() => query?.tilaus || '');
  const [status, setStatus] = useState(NO_SUBSCRIPTION);
  const [price, setPrice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sheet, setSheet] = useState(null); // 'choose' | 'code'

  useEffect(() => {
    let alive = true;
    // The card waits for the price (from Stripe), so its sentence shows whole at once and
    // does not grow when the price arrives.
    const show = async (s) => {
      if (!alive) return;
      setPlanStatus(uid, s);
      const p = s.plan === 'trial' || s.plan === 'ended' ? await api.subscription.price() : null;
      if (!alive) return;
      setPrice(p);
      setStatus(s);
    };
    (async () => {
      let s = await loadPlanStatus(uid);
      if (back && s.ready) {
        dropQueryParam('tilaus');
        s = await api.subscription.sync().catch(() => s);
        // Checkout done but Stripe still finishing (a card check): look once more in a moment.
        if (back === 'valmis' && s.plan !== 'active') {
          await new Promise((r) => setTimeout(r, 4000));
          s = await api.subscription.sync().catch(() => s);
        }
        if (back === 'valmis' && alive) toast(s.plan === 'active' ? 'Kiitos! Tilaus on voimassa.' : 'Kiitos! Tilaus vahvistuu hetken kuluttua.');
      }
      await show(s);
    })();
    return () => { alive = false; };
  }, [back, toast, uid]);

  const card = planCard(status, price);
  // A free-use key makes the coach free, and a free coach has no card: the key sheet stays (at the same
  // place in the tree, so it keeps its state) until its "Koutsi on sinulle maksuton!" is closed.
  if (!card && sheet !== 'code') return null;
  const choices = checkoutChoices(price);
  const go = async (interval = 'month') => {
    if (busy || !card) return;
    setBusy(true);
    try {
      const { url } = card.action === 'portal' ? await api.subscription.portal() : await api.subscription.checkout(interval);
      window.location.assign(url);
    } catch (err) { toast(err); setBusy(false); }
  };
  // "Ota tilaus" asks month or year only when there is a yearly price
  const primary = card?.action === 'checkout' && choices.length > 1 ? () => setSheet('choose') : () => go('month');
  const codeUsed = (s) => { setStatus(s); setPlanStatus(uid, s); };
  return (
    <section className="stack-2">
      {card && (
        <>
          <div className="eyebrow">Tilaus</div>
          <Card className={cx('k-alert', card.tone === 'warn' && 'k-alert-warn')}>
            <span className={cx('k-alert-icon', card.tone === 'lime' && 'is-lime')}><Icon name={card.icon} size={19} /></span>
            <div className="k-alert-body">
              <div className="k-alert-title">{card.title}</div>
              {card.text && <p className="k-alert-text">{card.text}</p>}
              <div className="row wrap season-alert-actions">
                <Button variant="dark" size="sm" loading={busy} onClick={primary}>{card.label}</Button>
                {card.code && <Button variant="ghost" size="sm" onClick={() => setSheet('code')}>Onko sinulla valmentaja-avain?</Button>}
              </div>
            </div>
          </Card>
          <Sheet open={sheet === 'choose'} onClose={() => setSheet(null)} title="Ota tilaus" size="sm">
            <div className="list-group">
              {choices.map((c) => (
                <ListRow key={c.interval} icon={c.interval === 'year' ? 'calendar' : 'repeat'} title={c.title} subtitle={c.sub}
                  onClick={busy ? undefined : () => go(c.interval)} />
              ))}
            </div>
          </Sheet>
        </>
      )}
      <CodeSheet open={sheet === 'code'} onClose={() => setSheet(null)} onUsed={codeUsed} />
    </section>
  );
}

/** "Onko sinulla valmentaja-avain?": a key from Krossi gives more free months (or free use), a surprise. */
function CodeSheet({ open, onClose, onUsed }) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [welcome, setWelcome] = useState(null);
  useEffect(() => { if (open) { setCode(''); setError(''); setWelcome(null); } }, [open]);
  const submit = async (e) => {
    e.preventDefault();
    if (!code.trim() || busy) return;
    setError(''); setBusy(true);
    try {
      const s = await api.subscription.useCode(code.trim());
      onUsed(s);
      setWelcome(keyWelcome(s) || { title: 'Valmis!', text: '' });
    } catch (err) { setError(err.userMessage); } finally { setBusy(false); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={welcome ? null : 'Valmentaja-avain'} size="sm">
      {welcome ? <KeyWelcome welcome={welcome} onDone={onClose} doneLabel="Selvä" /> : (
        <form className="stack-4" onSubmit={submit}>
          <Field label="Krossilta saamasi valmentaja-avain" htmlFor="plan-code" error={error || null}>
            <Input id="plan-code" size="lg" value={code} onChange={(e) => setCode(e.target.value)} autoComplete="off" autoCapitalize="characters" />
          </Field>
          <Button type="submit" variant="dark" size="lg" block loading={busy} missing={!code.trim() ? 'Kirjoita valmentaja-avain.' : null}>Käytä avainta</Button>
          <p className="k-fine"><span>Ei avainta? Saat oman tarjouksen, kun <a href={`mailto:${SUPPORT_EMAIL}?subject=Koutsi%20tarjous`}>otat yhteyttä</a>.</span></p>
        </form>
      )}
    </Sheet>
  );
}
