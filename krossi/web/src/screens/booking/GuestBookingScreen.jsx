// GuestBookingScreen — a court booked without an account, at its own link krossi.app/pelaa/varaus/<token>
// (in the guest's confirmation email; a redirect payment such as MobilePay comes back here too). The
// booking site's look (SiteShell, SiteBar), one job: what was booked, and — before the hall's
// cancellation limit — "Peru varaus" (the money back to the card minus the 1 € peruutuskulu).
// Signed in: "Siirrä tilillesi" moves it to the account (the link is the proof; a forwarded link is
// why this is a button and not automatic). Moved: it lives in Omat varaukset, cancelled from there.
// Below, the way into Krossi for finding somebody to play with — that needs an account, and the
// booking moves to it on the way.
import { useEffect, useRef, useState } from 'react';
import { api, isDemo } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { claimGuestBookings, rememberGuestBooking } from '../../app/bookingAccount.js';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { useDemoSiteSignedIn } from '../../app/siteAccount.js';
import { AccountSheet } from './AccountSheet.jsx';
import { CANCEL_FEE_CENTS, centsLabel } from '../../features/booking.js';
import { Button, EmptyState, ErrorState, Icon, Page, Skeleton, TennisBall, useConfirm, useToast } from '../../ui/index.js';
import { SiteBar } from './SiteBar.jsx';
import { downloadBookingIcs, sportLabel, timeInSentence, whenLabel } from './BookingParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FAILED = 'Maksu ei mennyt läpi — mitään ei veloitettu.';

/** What the page says about the booking now: { tone, icon, title, text }. */
function stateOf(page, now = Date.now()) {
  const { booking: b, cancelledByGuest, lostMessage } = page;
  if (b.status === 'confirmed') return { tone: 'ok', icon: 'check', title: 'Kenttä varattu' };
  if (b.status === 'held' && Date.parse(b.holdExpiresAt) > now) {
    return { tone: 'wait', title: 'Maksu on kesken', text: 'Varaus vahvistuu heti, kun maksu menee läpi. Vahvistus tulee sähköpostiisi.' };
  }
  if (b.status === 'cancelled' && cancelledByGuest) {
    return {
      tone: 'off', icon: 'undo', title: 'Peruit varauksen',
      text: `Maksu palautetaan maksutavallesi peruutuskulua (${centsLabel(CANCEL_FEE_CENTS)}) lukuun ottamatta. Palautus näkyy tililläsi yleensä muutamassa päivässä.`,
    };
  }
  if (b.status === 'cancelled' && b.paymentStatus === 'refunded') {
    return {
      tone: 'off', icon: 'undo', title: 'Varaus peruttiin',
      text: lostMessage || 'Maksu palautetaan kokonaan maksutavallesi. Palautus näkyy tililläsi yleensä muutamassa päivässä.',
    };
  }
  if (b.status === 'cancelled') return { tone: 'off', icon: 'undo', title: 'Varaus peruttiin', text: 'Kysy tarvittaessa lisää hallilta.' };
  return { tone: 'off', icon: 'clock', title: 'Varaus ei vahvistunut', text: `${FAILED} Valitse aika uudelleen.` };
}

export function GuestBookingScreen({ params, query }) {
  const token = params?.token || '';
  const toast = useToast();
  const confirm = useConfirm();
  const page = useAsync(() => api.booking.guestBooking(token), [token]);
  const [checking, setChecking] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [accountAsk, setAccountAsk] = useState(null); // AccountSheet: { mode, subtitle, then }
  const [moving, setMoving] = useState(false);
  const { user, profile } = useSession();
  const demoSignedIn = useDemoSiteSignedIn();
  const account = isDemo ? demoSignedIn : Boolean(user && profile);

  /** Peliseura; a confirmed booking of this link moves to the account first, then a game on it. */
  const toPartners = async () => {
    const b = page.data?.booking;
    const moved = b?.status === 'confirmed' ? (page.data.claimed ? [b] : await claimGuestBookings([token])) : [];
    navigate('/pelaa/pelaajat');
    if (moved[0]) navigate(`/pelaa/uusi-peli?varaus=${encodeURIComponent(moved[0].id)}`, { overlay: true });
  };
  const findPartner = () => (account ? toPartners()
    : setAccountAsk({ mode: 'register', subtitle: 'Pelikaverin haku vaatii tilin.', then: toPartners }));
  const toMyBookings = () => navigate(`/pelaa/omat-varaukset?vuoro=${encodeURIComponent(page.data?.booking.id || '')}`);

  const moveToAccount = async () => {
    setMoving(true);
    try {
      await api.booking.claimGuest(token);
      toast('Varaus on nyt tililläsi.', { icon: 'check' });
      page.reload({ silent: true });
    } catch (err) {
      toast(err);
    } finally {
      setMoving(false);
    }
  };

  // Back from a redirect payment (?payment_intent=…&redirect_status=…): confirm it, then drop the
  // query (it carries Stripe's client secret).
  const handled = useRef(false);
  useEffect(() => {
    const { payment_intent: intentId, redirect_status: status } = query || {};
    if ((!intentId && !status) || handled.current) return;
    handled.current = true;
    rememberGuestBooking(token);
    (async () => {
      if (status === 'failed') {
        toast(FAILED, { tone: 'error', duration: 6000 });
        await api.booking.guestRelease(token).catch(() => {});
      } else if (intentId) {
        setChecking(true);
        try {
          for (let tries = 0; tries < 8; tries += 1) {
            const result = await api.booking.guestVerify(token, intentId);
            if (result.confirmed) break;
            if (result.status === 'lost') { toast(result.message || 'Aika ehti mennä toiselle — maksu palautettiin.', { tone: 'error', duration: 7000 }); break; }
            if (result.status !== 'processing') { toast(FAILED, { tone: 'error' }); break; }
            await sleep(1500);
          }
        } catch (err) {
          toast(err);
        }
        setChecking(false);
      }
      page.reload({ silent: true });
      navigate(`/pelaa/varaus/${encodeURIComponent(token)}`, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A payment still on its way: look again now and then.
  const waiting = page.data?.booking.status === 'held';
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => page.reload({ silent: true }), 3000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const bar = <SiteBar />;
  if ((page.loading && !page.data) || checking) {
    return (
      <>
        {bar}
        <Page className="gb-page">
          {checking ? (
            <div className="bk-loading" role="status" aria-label="Tarkistetaan maksua"><TennisBall size={30} motion="spin" /></div>
          ) : (
            <div className="stack-3"><Skeleton h={120} r={18} /><Skeleton h={54} r={14} /></div>
          )}
        </Page>
      </>
    );
  }
  if (page.error && !page.data) {
    return <>{bar}<Page className="gb-page"><ErrorState error={page.error} onRetry={() => page.reload()} /></Page></>;
  }
  if (!page.data) {
    return (
      <>
        {bar}
        <Page className="gb-page">
          <EmptyState art="calendar" title="Varausta ei löytynyt" text="Tarkista linkki vahvistusviestistä." />
        </Page>
      </>
    );
  }

  const { booking: b, guest, venue } = page.data;
  const state = stateOf(page.data);
  const confirmed = b.status === 'confirmed';
  const claimed = page.data.claimed === true;
  const cancellable = confirmed && !claimed && Date.parse(b.cancellableUntil) > Date.now();
  const paid = b.priceCents;
  const back = Math.max(0, paid - Math.min(CANCEL_FEE_CENTS, paid));

  const cancel = async () => {
    const ok = await confirm({
      title: 'Perutaanko varaus?',
      message: `${b.courtName} ${timeInSentence(b.startsAt)}. Saat ${centsLabel(back)} takaisin maksutavallesi (peruutuskulu ${centsLabel(CANCEL_FEE_CENTS)}).`,
      confirmLabel: 'Peru varaus',
      danger: true,
    });
    if (!ok) return;
    setCancelling(true);
    try {
      const result = await api.booking.guestCancel(token);
      toast(result.refundedCents > 0 ? `Varaus peruttu. ${centsLabel(result.refundedCents)} palautetaan maksutavallesi.` : 'Varaus peruttu.', { icon: 'check', duration: 5000 });
      page.reload({ silent: true });
    } catch (err) {
      toast(err);
      page.reload({ silent: true });
    } finally {
      setCancelling(false);
    }
  };

  return (
    <>
      {bar}
      <Page className="gb-page">
        <div className={cx('gb-card', `is-${state.tone}`)}>
          <div className="gb-head">
            {state.tone === 'wait'
              ? <span className="gb-mark" aria-hidden="true"><TennisBall size={26} motion="spin" /></span>
              : <span className="gb-mark" aria-hidden="true"><Icon name={state.icon} size={24} strokeWidth={2.6} /></span>}
            <h1 className="gb-title">{state.title}</h1>
          </div>
          <dl className="gb-facts">
            <div className="gb-fact">
              <dt><Icon name="calendar" size={16} />Aika</dt>
              <dd>{whenLabel(b.startsAt, b.endsAt)}</dd>
            </div>
            <div className="gb-fact">
              <dt><Icon name="court" size={16} />Kenttä</dt>
              <dd>{b.courtName} · {b.locationName}<span className="gb-fact-sub">{venue.name} · {sportLabel(b.sport)}</span></dd>
            </div>
            <div className="gb-fact">
              <dt><Icon name="euro" size={16} />{confirmed ? 'Maksettu' : 'Hinta'}</dt>
              <dd className="t-num">{centsLabel(paid)}</dd>
            </div>
            <div className="gb-fact">
              <dt><Icon name="user" size={16} />Varaaja</dt>
              <dd>{guest.name}<span className="gb-fact-sub">{guest.email}</span></dd>
            </div>
          </dl>
          {state.text && <p className="gb-text">{state.text}</p>}
          {confirmed && (
            <div className="gb-actions">
              <Button variant="soft" icon="calendar" block onClick={() => downloadBookingIcs(b, { cancellableUntil: b.cancellableUntil })}>Lisää kalenteriin</Button>
              {claimed && (
                <Button
                  variant="outline"
                  icon="arrow-right"
                  block
                  onClick={() => (account ? toMyBookings() : setAccountAsk({ mode: 'login', then: toMyBookings }))}
                >
                  Omat varaukset
                </Button>
              )}
              {!claimed && account && <Button variant="outline" icon="user" block loading={moving} onClick={moveToAccount}>Siirrä tilillesi</Button>}
              {cancellable && <Button variant="outline" icon="undo" block loading={cancelling} onClick={cancel}>Peru varaus</Button>}
            </div>
          )}
          {confirmed && (
            <p className="bk-fine bk-fine-center">
              {claimed
                ? 'Varaus on Krossi-tililläsi. Peru se tarvittaessa omista varauksistasi.'
                : cancellable
                  ? `Peruutus ${timeInSentence(b.cancellableUntil)} asti, peruutuskulu ${centsLabel(CANCEL_FEE_CENTS)}.`
                  : 'Peruutusaika on mennyt. Ota tarvittaessa yhteyttä halliin.'}
            </p>
          )}
          {!confirmed && state.tone !== 'wait' && (
            <Button variant="dark" icon="calendar-plus" block onClick={() => navigate(`${isDemo ? '/varaa' : '/pelaa/varaa'}/${encodeURIComponent(venue.slug)}`)}>Varaa uusi aika</Button>
          )}
        </div>

        <div className="gb-more">
          <Button variant="lime" size="lg" block icon="users" onClick={findPartner}>{account ? 'Etsi pelikaveri' : 'Luo tili ja etsi pelikaveri'}</Button>
        </div>
      </Page>
      <AccountSheet
        open={Boolean(accountAsk)}
        mode={accountAsk?.mode}
        subtitle={accountAsk?.subtitle}
        name={guest.name}
        email={guest.email}
        back={`/pelaa/varaus/${encodeURIComponent(token)}`}
        onClose={() => setAccountAsk(null)}
        onDone={() => { const then = accountAsk?.then; setAccountAsk(null); then?.(); }}
      />
    </>
  );
}
