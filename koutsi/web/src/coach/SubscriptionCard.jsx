// SubscriptionCard — Profiili → Tilaus: the trial's days left, the subscription or a failed payment,
// and one button (Stripe Checkout or Stripe's customer portal). Nothing at all for a free coach
// (today's coaches, coach keys) or before the database has it. Back from Stripe (?tilaus=valmis /
// ?tilaus=palasit) it reads the subscription straight from Stripe instead of waiting for the webhook.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { dropQueryParam, useRoute } from '../app/router.js';
import { Button, Card, Icon, useToast } from '../ui/index.js';
import { NO_SUBSCRIPTION, planCard } from '../domain/subscription.js';

const cx = (...c) => c.filter(Boolean).join(' ');

export function SubscriptionCard() {
  const toast = useToast();
  const { query } = useRoute();
  const [back] = useState(() => query?.tilaus || '');
  const [status, setStatus] = useState(NO_SUBSCRIPTION);
  const [price, setPrice] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    const show = (s) => {
      if (!alive) return;
      setStatus(s);
      if (s.plan === 'trial' || s.plan === 'ended') api.subscription.price().then((p) => { if (alive) setPrice(p); });
    };
    (async () => {
      let s = await api.subscription.status().catch(() => NO_SUBSCRIPTION);
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
      show(s);
    })();
    return () => { alive = false; };
  }, [back, toast]);

  const card = planCard(status, price);
  if (!card) return null;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const { url } = card.action === 'portal' ? await api.subscription.portal() : await api.subscription.checkout();
      window.location.assign(url);
    } catch (err) { toast(err); setBusy(false); }
  };
  return (
    <section className="stack-2">
      <div className="eyebrow">Tilaus</div>
      <Card className={cx('k-alert', card.tone === 'warn' && 'k-alert-warn')}>
        <span className={cx('k-alert-icon', card.tone === 'lime' && 'is-lime')}><Icon name={card.icon} size={19} /></span>
        <div className="k-alert-body">
          <div className="k-alert-title">{card.title}</div>
          {card.text && <p className="k-alert-text">{card.text}</p>}
          <Button variant="dark" size="sm" loading={busy} onClick={go}>{card.label}</Button>
        </div>
      </Card>
    </section>
  );
}
