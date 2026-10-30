// WalletSheet — saldo, sarja- ja lahjakortit at a hall. Saldo: top it up (25 / 50 / 100 €), see it
// and its history, send unused top-ups back to the card, and redeem a gift card's code onto it.
// Sarjakortit: buy a series card (e.g. 10 × 1 h, valid 12 months). Lahjakortti: buy one for
// someone (its code is shown once paid, to copy or share). Paying uses the same Stripe checkout as
// court bookings (Checkout with api.wallet.createPaymentIntent / verifyPayment); the demo pays at
// once. The saldo and series cards are then offered in the booking sheet; the saldo also pays a
// friend's share and takes a cancelled booking back whole.
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { Checkout } from '../../app/checkout.jsx';
import { useAsync } from '../../app/hooks.js';
import { centsLabel, durationLabel } from '../../features/booking.js';
import { dayMonth, hoursLeftLabel } from '../../features/seasons.js';
import {
  Button, ChipSelect, Disclosure, Field, Icon, Input, Segmented, Sheet, Skeleton, copyText, useConfirm, useShare, useToast,
} from '../../ui/index.js';
import { CreditHistory, InfoLine, PassBalance } from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const OTHER = 'muu';
// 'redeem' was a tab of its own before the saldo: the code is redeemed on the Saldo tab now.
const tabOf = (tab) => (tab === 'redeem' ? 'saldo' : tab || 'saldo');

export function WalletSheet({ open, onClose, venue, initialTab = 'saldo', onChanged }) {
  const toast = useToast();
  const [tab, setTab] = useState(tabOf(initialTab));
  const [order, setOrder] = useState(null); // { kind, id, amount, name } while paying
  const [done, setDone] = useState(null);   // the paid pass / gift card
  const products = useAsync(() => (open && venue ? api.wallet.products(venue.id) : Promise.resolve(null)), [open, venue?.id]);
  const wallet = useAsync(() => (open && venue ? api.wallet.get(venue.id) : Promise.resolve(null)), [open, venue?.id]);

  useEffect(() => {
    if (!open) return;
    setTab(tabOf(initialTab));
    setOrder(null);
    setDone(null);
  }, [open, initialTab]);

  if (!venue) return null;

  const refresh = () => { wallet.reload({ silent: true }); onChanged?.(); };

  const buyPass = async (product) => {
    try {
      const pass = await api.wallet.buyPass(product.id);
      setOrder({ kind: 'pass', id: pass.id, amount: product.priceCents, name: product.name });
    } catch (err) {
      toast(err);
    }
  };

  const buyGift = async (input) => {
    try {
      const card = await api.wallet.buyGiftCard({ venueId: venue.id, ...input });
      setOrder({ kind: 'gift', id: card.id, amount: card.amountCents, name: `Lahjakortti ${centsLabel(card.amountCents)}` });
    } catch (err) {
      toast(err);
    }
  };

  const topUp = async (amountCents) => {
    try {
      const t = await api.wallet.topUp({ venueId: venue.id, amountCents });
      setOrder({ kind: 'topup', id: t.id, amount: t.amountCents, name: `Saldon lataus ${centsLabel(t.amountCents)}` });
    } catch (err) {
      toast(err);
    }
  };

  const paid = async () => {
    const w = await api.wallet.get(venue.id).catch(() => null);
    const item = order.kind === 'pass'
      ? w?.passes.find((p) => p.id === order.id)
      : order.kind === 'gift' ? w?.giftCards.find((g) => g.id === order.id) : w && { giftCents: w.giftCents };
    setDone({ kind: order.kind, item, name: order.name });
    setOrder(null);
    refresh();
  };

  let body;
  let footer;
  if (done) {
    body = <OrderDone done={done} venue={venue} />;
    footer = <Button variant="lime" size="lg" block onClick={onClose}>Valmis</Button>;
  } else if (order) {
    body = <OrderPay order={order} venue={venue} onPaid={paid} />;
    footer = <Button variant="ghost" block onClick={() => setOrder(null)}>Takaisin</Button>;
  } else {
    body = (
      <div className="stack-4">
        <Segmented
          ariaLabel="Saldo ja kortit"
          options={[{ value: 'saldo', label: 'Saldo' }, { value: 'passes', label: 'Sarjakortit' }, { value: 'gift', label: 'Lahjakortti' }]}
          value={tab}
          onChange={setTab}
        />
        {tab === 'saldo' && <SaldoTab products={products} wallet={wallet} venue={venue} onTopUp={topUp} onChanged={refresh} />}
        {tab === 'passes' && <PassShop products={products} wallet={wallet} onBuy={buyPass} />}
        {tab === 'gift' && <GiftShop products={products} wallet={wallet} venue={venue} onBuy={buyGift} />}
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={done ? undefined : order ? order.name : 'Saldo ja kortit'}
      subtitle={done ? undefined : venue.name}
      footer={footer}
      size="md"
      className="bk-sheet"
    >
      {body}
    </Sheet>
  );
}

// ── Series cards ─────────────────────────────────────────────────────────────

function PassShop({ products, wallet, onBuy }) {
  const [busy, setBusy] = useState(null);
  const mine = (wallet.data?.passes || []).filter((p) => p.status === 'active');
  if (products.loading && !products.data) return <div className="stack-3"><Skeleton h={120} r={16} /><Skeleton h={120} r={16} /></div>;
  if (products.error && !products.data) return <p className="checkout-error"><Icon name="alert" size={16} />{products.error.userMessage}</p>;
  const list = products.data?.passes || [];
  return (
    <div className="stack-4">
      {mine.length > 0 && (
        <div className="stack-2">
          <span className="eyebrow ss-eyebrow">Omat sarjakortit</span>
          {mine.map((p) => <PassBalance key={p.id} pass={p} />)}
        </div>
      )}
      {list.length === 0 ? (
        <InfoLine icon="info">Halli ei myy vielä sarjakortteja Krossissa.</InfoLine>
      ) : (
        <div className="stack-3">
          <span className="eyebrow ss-eyebrow">Osta sarjakortti</span>
          {list.map((p) => (
            <div key={p.id} className="ss-product">
              <div className="ss-product-head">
                <span className="ss-product-name">{p.name}</span>
                <span className="ss-product-price t-num">{centsLabel(p.priceCents)}</span>
              </div>
              <p className="ss-product-meta">
                {durationLabel(p.uses * p.minutesPerUse)} pelaamista, {centsLabel(Math.round(p.priceCents / ((p.uses * p.minutesPerUse) / 60)))}/h, voimassa {Math.round(p.validDays / 30.4)}&nbsp;kk
              </p>
              {p.description && <p className="ss-product-text">{p.description}</p>}
              <Button
                variant="dark"
                block
                loading={busy === p.id}
                onClick={async () => { setBusy(p.id); await onBuy(p); setBusy(null); }}
              >
                Osta {centsLabel(p.priceCents)}
              </Button>
            </div>
          ))}
          <p className="bk-fine">Sarjakortilla maksat varauksen kokonaan varauksen maksuvaiheessa. Pidemmästä vuorosta kuluu enemmän saldoa. Peruttu vuoro palauttaa tunnit kortille.</p>
        </div>
      )}
    </div>
  );
}

// ── Gift cards ───────────────────────────────────────────────────────────────

function GiftShop({ products, wallet, venue, onBuy }) {
  const gift = products.data?.gift;
  const [amount, setAmount] = useState(null);
  const [custom, setCustom] = useState('');
  const [recipient, setRecipient] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const bought = wallet.data?.giftCards || [];

  if (products.loading && !products.data) return <Skeleton h={180} r={16} />;
  if (!gift) return <InfoLine icon="info">Halli ei myy vielä lahjakortteja Krossissa.</InfoLine>;
  const chosen = amount === OTHER ? Math.round(Number(String(custom).replace(',', '.')) * 100) : (amount ?? gift.amounts[1] ?? gift.amounts[0]);
  const valid = Number.isInteger(chosen) && chosen % 100 === 0 && chosen >= gift.minCents && chosen <= gift.maxCents;

  return (
    <div className="stack-4">
      <InfoLine icon="gift">Lahjakortilla maksetaan kenttävuoroja: {venue.name}. Saaja lunastaa koodin Krossissa saldoonsa. Voimassa {Math.round(gift.validDays / 30.4)} kk.</InfoLine>
      <div className="bk-field">
        <span className="eyebrow">Summa</span>
        <ChipSelect
          ariaLabel="Summa"
          options={[...gift.amounts.map((a) => ({ value: String(a), label: centsLabel(a) })), { value: OTHER, label: 'Muu summa' }]}
          value={amount === OTHER ? OTHER : String(chosen)}
          onChange={(v) => setAmount(v === OTHER ? OTHER : Number(v))}
        />
        {amount === OTHER && (
          <Input
            inputMode="numeric"
            placeholder={`${gift.minCents / 100}–${gift.maxCents / 100} €`}
            value={custom}
            onChange={(e) => setCustom(e.target.value.replace(/[^\d]/g, '').slice(0, 4))}
            aria-label="Summa euroina"
          />
        )}
      </div>
      <Field label="Saajan nimi" optional htmlFor="gift-recipient">
        <Input id="gift-recipient" value={recipient} maxLength={60} onChange={(e) => setRecipient(e.target.value)} placeholder="Näkyy lahjakortissa" />
      </Field>
      <Field label="Viesti" optional htmlFor="gift-message">
        <Input id="gift-message" value={message} maxLength={300} onChange={(e) => setMessage(e.target.value)} placeholder="esim. Hyvää syntymäpäivää!" />
      </Field>
      <Button
        variant="lime"
        size="lg"
        block
        disabled={!valid}
        loading={busy}
        onClick={async () => { setBusy(true); await onBuy({ amountCents: chosen, recipientName: recipient, message }); setBusy(false); }}
      >
        {valid ? `Osta lahjakortti ${centsLabel(chosen)}` : `Valitse ${gift.minCents / 100}–${gift.maxCents / 100} €`}
      </Button>
      {bought.length > 0 && (
        <div className="stack-2">
          <span className="eyebrow ss-eyebrow">Ostamasi lahjakortit</span>
          {bought.map((g) => <GiftCardRow key={g.id} card={g} venue={venue} />)}
        </div>
      )}
    </div>
  );
}

const GIFT_STATES = { active: 'Lunastamatta', redeemed: 'Lunastettu', expired: 'Vanhentunut', pending: 'Maksamatta' };

export function GiftCardRow({ card, venue }) {
  const toast = useToast();
  const shareLink = useShare();
  return (
    <div className={cx('ss-giftcard', card.status !== 'active' && 'is-done')}>
      <div className="ss-giftcard-head">
        <span className="ss-giftcard-amount t-num">{centsLabel(card.amountCents)}</span>
        <span className="ss-giftcard-state">{GIFT_STATES[card.status]}{card.recipientName ? `, ${card.recipientName}` : ''}</span>
      </div>
      {card.code && <code className="ss-code">{card.code}</code>}
      {card.status === 'active' && (
        <div className="ss-giftcard-actions">
          <Button variant="soft" size="sm" icon="copy" onClick={async () => toast(await copyText(card.code) ? 'Koodi kopioitu.' : 'Kopiointi ei onnistunut.')}>Kopioi</Button>
          <Button
            variant="soft"
            size="sm"
            icon="share"
            onClick={() => shareLink({
              title: 'Lahjakortti',
              text: `Lahjakortti: ${centsLabel(card.amountCents)} kenttävuoroihin (${venue.name}). Koodi ${card.code} — lunasta Krossissa: Omat varaukset → Saldo → Lunasta lahjakortti.${card.message ? ` ${card.message}` : ''}`,
              url: 'https://krossi.app/pelaa/varaa',
            })}
          >
            Jaa
          </Button>
          <span className="ss-giftcard-valid">Lunastettava {dayMonth(card.validUntil, true)} asti</span>
        </div>
      )}
    </div>
  );
}

// ── Saldo ────────────────────────────────────────────────────────────────────

function SaldoTab({ products, wallet, venue, onTopUp, onChanged }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [amount, setAmount] = useState(null);
  const [busy, setBusy] = useState(false);
  const [refunding, setRefunding] = useState(false);
  const rules = products.data?.topup || null;
  const w = wallet.data;
  const chosen = amount ?? rules?.amounts[1] ?? rules?.amounts[0] ?? null;

  const refund = async () => {
    const fee = w.refundFeeCents;
    const ok = await confirm({
      title: 'Palautetaanko kortille?',
      message: `${centsLabel(w.refundableCents)} palautetaan kortille, jolla latasit saldoa${fee ? ` (palautuskulu ${centsLabel(fee)})` : ''}. `
        + 'Se näkyy tililläsi yleensä muutamassa päivässä.',
      confirmLabel: `Palauta ${centsLabel(w.refundableCents)}`,
      cancelLabel: 'Pidä saldossa',
    });
    if (!ok) return;
    setRefunding(true);
    try {
      const done = await api.wallet.refundToCard(venue.id);
      toast(`${centsLabel(done.refundedCents)} palautetaan kortillesi.`, { icon: 'check' });
      onChanged?.();
    } catch (err) {
      toast(err);
    } finally {
      setRefunding(false);
    }
  };

  return (
    <div className="stack-4">
      <div className="ss-balance">
        <span className="eyebrow ss-eyebrow">Saldo</span>
        <span className="ss-balance-value t-num">{w ? centsLabel(w.giftCents) : '–'}</span>
        <span className="bk-fine">Maksa saldolla vuoroja ja kavereiden osuuksia ({venue.name}).</span>
      </div>
      {rules && (
        <div className="stack-3">
          <Segmented
            ariaLabel="Ladattava summa"
            options={rules.amounts.map((a) => ({ value: String(a), label: centsLabel(a) }))}
            value={String(chosen)}
            onChange={(v) => setAmount(Number(v))}
          />
          <Button
            variant="lime"
            size="lg"
            block
            loading={busy}
            onClick={async () => { setBusy(true); await onTopUp(chosen); setBusy(false); }}
          >
            Lataa {centsLabel(chosen)}
          </Button>
        </div>
      )}
      {w?.refundableCents > 0 && (
        <Button variant="outline" block icon="undo" loading={refunding} onClick={refund}>
          Palauta kortille {centsLabel(w.refundableCents)}
        </Button>
      )}
      <Disclosure title="Lunasta lahjakortti" icon="gift">
        <RedeemCode onRedeemed={onChanged} />
      </Disclosure>
      {w?.giftHistory?.length > 0 && (
        <Disclosure title="Saldon tapahtumat" summary={`${w.giftHistory.length}`} icon="list">
          <CreditHistory events={w.giftHistory} unit="cents" />
        </Disclosure>
      )}
      {rules && (
        <p className="bk-fine">
          Saldo käy vain tässä hallissa eikä vanhene. Käyttämättömän latauksen saat takaisin kortille {rules.refundDays} päivän ajan
          — {rules.refundFreeDays} päivää maksutta, sen jälkeen {centsLabel(rules.refundFeeCents)}.
        </p>
      )}
    </div>
  );
}

function RedeemCode({ onRedeemed }) {
  const toast = useToast();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const redeem = async () => {
    setBusy(true);
    setError('');
    try {
      const result = await api.wallet.redeem(code);
      toast(`Lahjakortti lunastettu: +${centsLabel(result.cents)} saldoa.`, { icon: 'check' });
      setCode('');
      onRedeemed?.();
    } catch (err) {
      setError(err?.userMessage || 'Lunastus ei onnistunut.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack-3">
      <Field label="Lahjakortin koodi" htmlFor="gift-code" error={error}>
        <Input
          id="gift-code"
          value={code}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="KRSI-XXXX-XXXX"
          onChange={(e) => { setCode(e.target.value.toUpperCase()); if (error) setError(''); }}
          onKeyDown={(e) => { if (e.key === 'Enter' && code.trim()) redeem(); }}
        />
      </Field>
      <Button variant="dark" block loading={busy} disabled={!code.trim()} onClick={redeem}>Lunasta</Button>
    </div>
  );
}

// ── Paying for an order ──────────────────────────────────────────────────────

function OrderPay({ order, venue, onPaid }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);
  const ref = { kind: order.kind, id: order.id };

  useEffect(() => {
    let cancelled = false;
    setConfig(null);
    setError(null);
    api.wallet.checkoutConfig(ref)
      .then((cfg) => { if (cancelled) return; if (cfg.paid) onPaid(); else setConfig(cfg); })
      .catch((err) => { if (!cancelled) setError(err); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [order.id]);

  const payDemo = async () => {
    setWorking(true);
    try {
      await api.wallet.createPaymentIntent(ref);
      onPaid();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="stack-4">
      <div className="bk-paybar">
        <span className="bk-paybar-label">Maksettavaa</span>
        <span className="bk-paybar-price t-num">{centsLabel(order.amount)}</span>
      </div>
      <div className="bk-paybox">
        <span className="eyebrow bk-paybox-title">Maksu</span>
        {error ? (
          <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error.userMessage || 'Maksua ei saatu auki.'}</p>
        ) : !config ? (
          <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>
        ) : config.demo ? (
          <div className="stack-3">
            <p className="bk-paybox-demo"><Icon name="info" size={15} /><span><b>Demotila</b> — maksu hyväksytään heti.</span></p>
            <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(config.amount)}</Button>
          </div>
        ) : (
          <Checkout
            config={config}
            createIntent={() => api.wallet.createPaymentIntent(ref)}
            verify={(paymentIntentId) => api.wallet.verifyPayment(ref, paymentIntentId)}
            returnPath={`/pelaa/omat-varaukset?tilaus=${order.kind}:${encodeURIComponent(order.id)}`}
            pendingText={order.kind === 'topup'
              ? 'Maksu on vielä kesken. Saldo päivittyy heti, kun pankki vahvistaa maksun.'
              : 'Maksu on vielä kesken. Kortti näkyy Omissa varauksissa heti, kun pankki vahvistaa maksun.'}
            onPaid={onPaid}
          />
        )}
      </div>
      <p className="bk-fine bk-fine-center">{venue.name}<br />Kuitti tulee sähköpostiisi.</p>
    </div>
  );
}

function OrderDone({ done, venue }) {
  return (
    <div className="ss-done">
      <span className="ss-done-icon" aria-hidden="true"><Icon name="check" size={28} strokeWidth={3} /></span>
      <h2 className="ss-done-title">{done.kind === 'pass' ? 'Sarjakortti on käytössä' : done.kind === 'topup' ? 'Saldo ladattu' : 'Lahjakortti on valmis'}</h2>
      {done.kind === 'pass' && done.item && (
        <>
          <p className="ss-done-text">{done.item.name}: {hoursLeftLabel(done.item.minutesLeft)} pelaamista, voimassa {dayMonth(done.item.validUntil, true)} asti. Valitse se varauksen maksuvaiheessa.</p>
          <PassBalance pass={done.item} />
        </>
      )}
      {done.kind === 'gift' && done.item && (
        <>
          <p className="ss-done-text">Anna koodi saajalle. Hän lunastaa sen Krossissa: Omat varaukset → Saldo → Lunasta lahjakortti.</p>
          <GiftCardRow card={done.item} venue={venue} />
        </>
      )}
      {done.kind === 'topup' && done.item && (
        <p className="ss-done-text">Saldossa nyt {centsLabel(done.item.giftCents)}. Valitse saldo varauksen maksuvaiheessa.</p>
      )}
      {!done.item && <p className="ss-done-text">Maksu on vastaanotettu. {done.kind === 'topup' ? 'Saldo' : 'Kortti'} näkyy Omissa varauksissa.</p>}
    </div>
  );
}
