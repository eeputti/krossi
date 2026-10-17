// SplitPayScreen — /pelaa/maksa/:token: the payment link of a split court booking. Anybody with the
// link pays one part here, without an account or the app: who booked, where and when, "Osuutesi
// 7,50 €", how many have paid already, and the same checkout as booking a court (MobilePay, Apple
// Pay, Google Pay, card). The paid part goes back to the booker. Signed out it is a page of its
// own (the Gate shows it, `standalone`); signed in it opens inside the app. "Löydä uutta
// peliseuraa" at the bottom takes a visitor to Krossi.
//
// Redirect methods (MobilePay on a phone) come back here with ?payment_intent=…, confirmed below.
//
// Saldo: a signed-in player with enough saldo at the booking's hall pays the part from it with one
// tap ("Maksa saldolla", api.booking.paySplitWithSaldo) — no card payment.
import { useEffect, useRef, useState } from 'react';
import { api, ApiError, isDemo } from '../../api/index.js';
import { useAsync, useResync } from '../../app/hooks.js';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { centsLabel } from '../../features/booking.js';
import { Avatar, Button, EmptyState, ErrorState, Icon, Input, Page, Skeleton, TopBar, useToast } from '../../ui/index.js';
import { downloadBookingIcs, whenLabel } from './BookingParts.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The booker as an avatar: a photo when the link has one, else the first letter. */
const bookerPerson = (s) => ({ id: s.token, name: s.bookerFirstName, avatarUrl: s.bookerAvatarUrl, avatarColor: 'blue' });

function PayBox({ link, name, onPaid }) {
  const toast = useToast();
  const [config, setConfig] = useState(null);
  const [error, setError] = useState(null);
  const [working, setWorking] = useState(false);

  const load = async () => {
    setError(null);
    setConfig(null);
    try {
      setConfig(await api.booking.splitCheckoutConfig(link.token));
    } catch (err) {
      setError(err);
    }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [link.token]);

  const payDemo = async () => {
    setWorking(true);
    try {
      const result = await api.booking.createSplitPaymentIntent(link.token, { name });
      if (result.full) throw new ApiError('Kaikki osuudet ehdittiin jo maksaa.', { code: 'full' });
      onPaid();
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const createIntent = async () => {
    const result = await api.booking.createSplitPaymentIntent(link.token, { name });
    if (result.full) throw new ApiError('Kaikki osuudet ehdittiin jo maksaa.', { code: 'full' });
    return result;
  };

  const verify = async (paymentIntentId) => {
    const result = await api.booking.verifySplitPayment(link.token, paymentIntentId);
    if (result.status === 'refunded') throw new ApiError(result.message || 'Maksu palautettiin.', { code: 'refunded' });
    return { paid: result.paid, status: result.status };
  };

  if (error) {
    return (
      <div className="stack-3">
        <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{error.userMessage || 'Maksua ei saatu auki.'}</p>
        <Button variant="lime" icon="refresh" block onClick={load}>Yritä uudelleen</Button>
      </div>
    );
  }
  if (!config) return <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>;
  if (config.full || config.over) return null; // the page above says why
  if (config.demo) {
    return (
      <div className="stack-3">
        <p className="bk-paybox-demo">
          <Icon name="info" size={15} />
          <span><b>Demotila</b> — maksu hyväksytään heti. Oikeassa Krossissa maksat MobilePaylla, Apple Paylla, Google Paylla tai kortilla.</span>
        </p>
        <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(link.perCents)}</Button>
      </div>
    );
  }
  return (
    <Checkout
      config={config}
      compact
      createIntent={createIntent}
      verify={verify}
      returnPath={`/pelaa/maksa/${encodeURIComponent(link.token)}`}
      pendingText="Maksu on vielä kesken. Osuus merkitään maksetuksi heti, kun pankki vahvistaa maksun."
      onPaid={onPaid}
    />
  );
}

export function SplitPayScreen({ params, query, standalone = false }) {
  const toast = useToast();
  const { user, profile } = useSession();
  const link = useAsync(() => api.booking.splitPublic(params.token), [params.token]);
  const [name, setName] = useState('');
  const [paid, setPaid] = useState(false);
  const [payingSaldo, setPayingSaldo] = useState(false);
  const venueId = link.data?.venueId || null;
  const wallet = useAsync(
    () => (user && venueId && link.data?.state === 'open' ? api.wallet.get(venueId).catch(() => null) : Promise.resolve(null)),
    [user?.id, venueId, link.data?.state],
  );
  useResync(() => link.reload({ silent: true }));

  // Coming back from a redirect payment (MobilePay on a phone): confirm it, then drop the query.
  const handledReturn = useRef(false);
  useEffect(() => {
    const intentId = query?.payment_intent;
    if (!intentId || handledReturn.current) return;
    handledReturn.current = true;
    (async () => {
      if (query.redirect_status === 'failed') {
        toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error', duration: 6000 });
      } else {
        try {
          for (let tries = 0; tries < 8; tries += 1) {
            const result = await api.booking.verifySplitPayment(params.token, intentId);
            if (result.paid) { setPaid(true); break; }
            if (result.status === 'refunded') { toast(result.message || 'Maksu palautettiin.', { tone: 'error', duration: 7000 }); break; }
            if (result.status !== 'processing') { toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error' }); break; }
            await sleep(1500);
          }
        } catch (err) {
          toast(err);
        }
      }
      link.reload({ silent: true });
      // Drop the query: it carries Stripe's client secret.
      navigate(`/pelaa/maksa/${encodeURIComponent(params.token)}`, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.payment_intent]);

  const s = link.data;
  let body;
  if (link.loading && !s) {
    body = <div className="stack-3"><Skeleton h={96} r={18} /><Skeleton h={140} r={18} /></div>;
  } else if (link.error && !s) {
    body = <ErrorState error={link.error} onRetry={() => link.reload()} />;
  } else if (!s) {
    body = (
      <EmptyState
        art="court"
        title="Maksulinkkiä ei löytynyt"
        text="Linkki voi olla vanha. Pyydä kentän varaajalta uusi linkki."
      />
    );
  } else {
    const done = paid;
    let state;
    if (done) {
      state = (
        <div className="splitpay-done">
          <span className="bk-done-check" aria-hidden="true"><Icon name="check" size={30} strokeWidth={3} /></span>
          <h2 className="splitpay-done-title">Osuutesi on maksettu</h2>
          <p className="bk-fine">
            {centsLabel(s.perCents)}. {paid === 'saldo' ? 'Maksettu saldostasi.' : isDemo ? 'Demotila — mitään ei veloitettu.' : 'Kuitti tulee sähköpostiisi, jos annoit sen maksaessa.'} Nähdään kentällä!
          </p>
          <Button variant="soft" icon="calendar" onClick={() => downloadBookingIcs({
            id: s.token, startsAt: s.startsAt, endsAt: s.endsAt, courtName: s.courtName, locationName: s.locationName, venueName: s.venueName, sport: s.sport,
          })}
          >
            Lisää kalenteriin
          </Button>
        </div>
      );
    } else if (s.state === 'cancelled') {
      state = <p className="bk-info"><Icon name="info" size={18} /><span>Vuoro peruttiin — osuutta ei tarvitse maksaa.</span></p>;
    } else if (s.state === 'over') {
      state = <p className="bk-info"><Icon name="clock" size={18} /><span>Vuoro on jo alkanut. Osuuksia ei voi enää maksaa linkistä.</span></p>;
    } else if (s.state === 'full') {
      state = <p className="bk-info"><Icon name="check" size={18} /><span>Kaikki osuudet on jo maksettu. Kiitos!</span></p>;
    } else {
      const friends = s.parts - 1;
      const saldo = wallet.data?.giftCents ?? 0;
      const paySaldo = async () => {
        setPayingSaldo(true);
        try {
          const result = await api.booking.paySplitWithSaldo(s.token);
          if (result.full) toast('Kaikki osuudet ehdittiin jo maksaa.', { tone: 'error' });
          else setPaid('saldo');
          link.reload({ silent: true });
        } catch (err) {
          toast(err);
        } finally {
          setPayingSaldo(false);
        }
      };
      state = (
        <div className="stack-3">
          <div className="splitpay-amount">
            <span className="eyebrow">Osuutesi</span>
            <span className="splitpay-amount-value t-num">{centsLabel(s.perCents)}</span>
            {s.paidCount > 0 && (
              <span className="splitpay-paid"><Icon name="check" size={13} strokeWidth={2.8} />{s.paidCount}/{friends} {friends === 1 ? 'kaveri on' : 'kaveria on'} jo maksanut</span>
            )}
          </div>
          {/* Signed in, the profile's name goes with the payment; the demo shows what a visitor sees. */}
          {(!user || isDemo) && (
            <label className="splitpay-name">
              <span className="splitpay-name-label">Nimesi <small>(näkyy varaajalle)</small></span>
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Etunimi" maxLength={40} autoComplete="given-name" />
            </label>
          )}
          {saldo >= s.perCents && (
            <div className="stack-2">
              <Button variant="dark" size="lg" block icon="euro" loading={payingSaldo} onClick={paySaldo}>Maksa saldolla</Button>
              <p className="bk-fine bk-fine-center">Saldoa {centsLabel(saldo)} · {s.venueName}</p>
            </div>
          )}
          <div className="bk-paybox">
            <PayBox link={s} name={user && !isDemo ? (profile?.name || '') : name} onPaid={() => { setPaid(true); link.reload({ silent: true }); }} />
          </div>
          <p className="bk-fine bk-fine-center">Tiliä tai sovellusta ei tarvita.</p>
        </div>
      );
    }
    body = (
      <div className="stack-4">
        <section className="splitpay-card">
          <Avatar person={bookerPerson(s)} size={46} />
          <span className="splitpay-card-text">
            <b>{s.bookerFirstName} varasi kentän</b>
            <span>{s.courtName} · {s.locationName}</span>
            <span>{whenLabel(s.startsAt, s.endsAt)}</span>
          </span>
        </section>
        {state}
      </div>
    );
  }

  // A visitor (or the demo's friend's view) is shown the way to Krossi itself.
  const invite = (!user || isDemo) && (
    <a className="splitpay-invite" href={isDemo ? '/demo' : '/pelaa'}>Löydä uutta peliseuraa <Icon name="chevron-right" size={16} /></a>
  );

  if (standalone) {
    return (
      <div className="splitpay">
        <header className="splitpay-top">
          <a href="https://krossi.app" className="splitpay-logo" aria-label="Krossi — etusivu">Krossi</a>
        </header>
        <main className="splitpay-main">{body}</main>
        <footer className="splitpay-foot">{invite}</footer>
      </div>
    );
  }
  return (
    <>
      <TopBar title="Maksa osuutesi" back="/pelaa/koti" />
      <Page className="bk-page">
        {body}
        {invite}
      </Page>
    </>
  );
}
