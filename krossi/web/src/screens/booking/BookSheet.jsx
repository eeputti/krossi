// BookSheet — booking one start time in one view: the court on the floor map (a free one is picked
// already), one line about it, the player's own series card or saldo when they have some,
// and the payment right there (MobilePay, Apple Pay, Google Pay, card). Nothing is held until the
// player pays: then the court is held, paid and confirmed in one go ("Joku ehti ensin…" if somebody
// was faster). Done: "Kenttä varattu!" with "Jaa maksu" (a link friends pay their parts at, no
// account needed — each part goes back to the booker), "Etsi pelikaveri tähän vuoroon" and the
// calendar file. Opened from a start-time row; the length was chosen on the page.
//
// Booking for somebody (`target`: a hallisarja match, a game or a chat — see BookingScreen): once
// paid, "Lähetä aika" sends the court to their chat (or a button leads back to where it started).
//
// On the booking site (`site`, krossi.app/varaa) booking is all the page does, so the done view's
// main button is the way on: "Etsi pelikaveri tähän vuoroon" opens Peliseura with a game for this
// court ready to publish. `home` is the page's own path, where a redirect payment comes back to.
//
// Without an account (`guest`) the sheet first asks how to book: "Luo tili ja varaa" (a quick account
// right here — AccountSheet — and the booking goes to it), "Varaa ilman tiliä" (a name and an email,
// paid right away; no series card, saldo or split) or "Kirjaudu". Paying as a guest holds the court for
// the guest (api.booking.guest*). Done: the confirmation — and before the cancellation limit the
// cancellation link — goes to that email; "Näytä varaus" opens the booking's own page
// (/pelaa/varaus/<token>, where a redirect payment comes back too). The booking is remembered in this
// tab: making an account or signing in here moves it to the account (app/bookingAccount.js). Finding
// a partner needs an account: "Luo tili ja etsi pelikaveri" (the booking moves to it, then Peliseura —
// onboarding first for a new account).
//
// Signed in without a profile yet (`needsName`, back from Google / Apple): the sheet asks the name and
// saves it (api.profile.createForBooking) right before the court is held.
//
// The demo has no card form: "Maksa" opens a stand-in for the payment details and "OK" pays.
//
// A server without payConfig (krossi-booking before phase 4) can't show the payment before a hold:
// there "Varaa ja maksa" holds first and the same checkout opens under the court.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/index.js';
import { useAsync, useLocalState } from '../../app/hooks.js';
import { claimGuestBookings, rememberGuestBooking } from '../../app/bookingAccount.js';
import { useSession } from '../../app/session.jsx';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { WEEKDAYS_SHORT, formatDayMonth, formatTime } from '../../lib/format.js';
import {
  cancelDeadline, centsLabel, courtsOf, coversSale, discounted, isTaken, lastMinutePercent, priceOf,
} from '../../features/booking.js';
import { hoursLeftLabel, passFits } from '../../features/seasons.js';
import { Button, Icon, Input, Segmented, Sheet, Skeleton, Toggle, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { downloadBookingIcs, sportLabel, timeInSentence, whenLabel } from './BookingParts.jsx';
import { useForecast, weatherInfo } from './weather.js';
import { BookingTermsSheet } from './BookingTerms.jsx';
import { SplitShare } from './SplitShare.jsx';
import { AccountSheet } from './AccountSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const MIN = 60_000;

/**
 * Courts of `sport` free for [startsAt, +minutes) with their price:
 * [{ court, location, cents, fullCents, resale }] — `cents` after a last-minute deal; a court
 * somebody put on sale (`resale`) is the full price.
 */
export function freeCourts(venue, busy, sport, startsAt, minutes) {
  const startMs = Date.parse(startsAt);
  const endMs = startMs + minutes * MIN;
  const deal = lastMinutePercent(venue, startsAt);
  return courtsOf(venue, { sport })
    .filter(({ court }) => !isTaken(busy, court.id, startMs, endMs))
    .map(({ court, location }) => ({
      court, location, fullCents: priceOf(venue, court, startsAt, minutes), resale: coversSale(busy, court.id, startMs, endMs),
    }))
    .filter((o) => o.fullCents != null)
    .map((o) => ({ ...o, cents: o.resale ? o.fullCents : discounted(o.fullCents, deal) }));
}

/** What the card still pays for a held booking: the price minus a gift share on it. */
const dueCents = (booking) => (booking?.priceCents || 0) - (booking?.credit?.kind === 'gift' ? booking.credit.cents : 0);

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
/** A guest's name and email look right (the server checks them again). */
export const guestContactOk = (c) => String(c?.name || '').trim().length >= 2 && EMAIL_RE.test(String(c?.email || '').trim());

/** The guest's own page: the booking, its cancellation, and where a redirect payment comes back. */
export const guestBookingPath = (token) => `/pelaa/varaus/${encodeURIComponent(token)}`;

/** Paid: what the done view and "Omat vuorot" show right away. */
const asPaid = (booking) => ({ ...booking, status: 'confirmed', paymentStatus: 'paid', holdExpiresAt: null });

/** Map states for one location at one time: chosen court 'selected', other free ones 'free'. */
function mapStates(location, free, busy, startsAt, minutes, chosenId, sport) {
  const startMs = Date.parse(startsAt);
  const endMs = startMs + minutes * MIN;
  const freeIds = new Set(free.map((o) => o.court.id));
  const states = {};
  for (const court of location.courts) {
    if (court.sport !== sport) continue;
    if (court.id === chosenId) states[court.id] = 'selected';
    else if (freeIds.has(court.id)) states[court.id] = 'free';
    else states[court.id] = isTaken(busy, court.id, startMs, endMs) ? 'busy' : 'closed';
  }
  return states;
}

export function BookSheet({
  open, onClose, venue, busy, sport, startsAt, minutes, courtId: firstCourtId, locationId, onBooked, onChanged, target = null,
  site = false, home = '/pelaa/varaa', guest = false, needsName = false,
}) {
  const toast = useToast();
  const { user, setProfile } = useSession();
  const [quickName, setQuickName] = useState('');
  const [courtId, setCourtId] = useState(firstCourtId || null);
  const [placeId, setPlaceId] = useState(null);
  const [step, setStep] = useState('choose'); // 'choose' | 'pay' (the demo's stand-in payment) | 'done'
  const [who, setWho] = useState(null); // without an account: null (not chosen yet) | 'guest'
  const [accountAsk, setAccountAsk] = useState(null); // the demo's AccountSheet: { mode, subtitle, then }
  const [booking, setBooking] = useState(null);
  const [legacyConfig, setLegacyConfig] = useState(null);
  const [credit, setCredit] = useState(null); // null | 'gift' | a series card's id
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  // A guest's name and email, remembered on this device for the next booking.
  const [contact, setContact] = useLocalState('krossi_guest_contact', { name: '', email: '' });
  const contactOk = (!guest || guestContactOk(contact)) && (!needsName || quickName.trim().length >= 2);
  // The hold made when the player pays: Stripe's callbacks read it, and closing gives it back. A
  // guest's carries its token.
  const heldRef = useRef(null);
  const payConfig = useAsync(() => (open ? api.booking.payConfig() : Promise.resolve(null)), [open]);
  const wallet = useAsync(() => (open && venue && !guest ? api.wallet.get(venue.id).catch(() => null) : Promise.resolve(null)), [open, venue?.id, guest]);

  // A new time (or court) starts over.
  useEffect(() => {
    if (!open) return;
    setCourtId(firstCourtId || null);
    setPlaceId(null);
    setStep('choose');
    setWho(null);
    setAccountAsk(null);
    setQuickName((n) => n || user?.name || '');
    setBooking(null);
    setLegacyConfig(null);
    setCredit(null);
    heldRef.current = null;
  }, [open, startsAt, minutes, firstCourtId]);

  const options = useMemo(() => {
    const free = venue && startsAt ? freeCourts(venue, busy, sport, startsAt, minutes) : [];
    // The place the player was looking at comes first; within it, the venue's court order.
    return locationId ? [...free].sort((a, b) => (a.location.id === locationId ? 0 : 1) - (b.location.id === locationId ? 0 : 1)) : free;
  }, [venue, busy, sport, startsAt, minutes, locationId]);

  const chosen = options.find((o) => o.court.id === courtId) || options[0] || null;
  const places = useMemo(() => [...new Map(options.map((o) => [o.location.id, o.location])).values()], [options]);
  const place = places.find((l) => l.id === (placeId || chosen?.location.id)) || places[0] || null;
  const weather = weatherInfo(useForecast(chosen?.location, startsAt));

  if (!venue || !startsAt) return null;
  const endsAt = new Date(Date.parse(startsAt) + minutes * MIN).toISOString();
  const deadline = cancelDeadline(startsAt, venue);
  const lateBooking = Date.parse(deadline) <= Date.now();

  // Own credit: a series card that fits this time, or the saldo (one or the other).
  const w = wallet.data;
  const pass = w?.passes.find((p) => p.status === 'active' && passFits(p, { sport, minutes, startsAt })) || null;
  const gift = w?.giftCents > 0 ? w.giftCents : 0;
  const price = chosen?.cents ?? 0;
  const giftCover = credit === 'gift' ? Math.min(gift, price) : 0;
  const due = credit && credit !== 'gift' ? 0 : price - giftCover;

  const pickPlace = (id) => {
    setPlaceId(id);
    setCourtId(options.find((o) => o.location.id === id)?.court.id || null);
  };

  const finish = (confirmed) => {
    heldRef.current = null;
    if (confirmed?.token) rememberGuestBooking(confirmed.token);
    setBooking(confirmed);
    setStep('done');
    onBooked?.(confirmed);
  };

  const failed = (err) => {
    if (err?.code === 'taken') onChanged?.(); // somebody was faster: refresh the calendar
  };

  /** Holds the chosen court once, when the player pays (a live hold of the same court is reused). */
  const ensureHeld = async () => {
    const live = heldRef.current;
    if (live?.status === 'held' && live.courtId === chosen.court.id && Date.parse(live.holdExpiresAt) > Date.now() + 30_000) return live;
    if (guest) {
      if (!guestContactOk(contact)) throw new ApiError('Kirjoita nimesi ja sähköpostiosoitteesi.', { code: 'invalid' });
      const { booking: held, token } = await api.booking.guestHold({
        courtId: chosen.court.id, startsAt, minutes, name: contact.name.trim(), email: contact.email.trim(),
      });
      heldRef.current = { ...held, token };
      return heldRef.current;
    }
    // Back from Google / Apple without a profile: the name first (a booking belongs to a profile).
    if (needsName) setProfile(await api.profile.createForBooking({ name: quickName, city: venue.city }));
    const held = await api.booking.hold({ courtId: chosen.court.id, startsAt, minutes });
    heldRef.current = held;
    return held;
  };

  /** The PaymentIntent of the held booking (a guest's by its token). */
  const intentFor = (held) => (held.token ? api.booking.guestPaymentIntent(held.token) : api.booking.createPaymentIntent(held.id));

  /** The series card pays it all; the saldo pays its part. Confirmed when that covered it. */
  const applyCredit = async (held) => {
    if (!credit) return held;
    const next = credit === 'gift' ? await api.wallet.useGift(held.id, true) : await api.wallet.payBooking(held.id, credit);
    heldRef.current = next;
    return next;
  };

  const release = async () => {
    const held = heldRef.current;
    heldRef.current = null;
    setLegacyConfig(null);
    if (held?.status !== 'held') return;
    try {
      if (held.token) await api.booking.guestRelease(held.token);
      else await api.booking.release(held.id);
    } catch {
      // The hold runs out on its own in a few minutes anyway.
    }
    onChanged?.();
  };

  const requestClose = async () => {
    if (step !== 'done') await release();
    onClose();
  };

  // The checkout calls this when the player pays: hold, credit, then the PaymentIntent.
  const createIntent = async () => {
    try {
      const held = await applyCredit(await ensureHeld());
      if (held.status === 'confirmed') return { paid: true };
      if (dueCents(held) !== due) {
        // The price moved between the calendar and the hold (rare): show the new one first.
        await release();
        throw new ApiError('Hinta muuttui juuri — tarkista hinta ja maksa uudelleen.', { code: 'taken' });
      }
      return await intentFor(held);
    } catch (err) {
      failed(err);
      throw err;
    }
  };

  const verify = async (paymentIntentId) => {
    const held = heldRef.current;
    const result = held.token
      ? await api.booking.guestVerify(held.token, paymentIntentId)
      : await api.booking.verifyPayment(held.id, paymentIntentId);
    if (result.status === 'lost') throw new ApiError(result.message || 'Aika ehti mennä toiselle — maksu palautettiin.', { code: 'taken' });
    return { paid: result.confirmed, status: result.status };
  };

  // The demo, and credit that covers everything: no card form, pay right here.
  const payHere = async () => {
    setWorking(true);
    try {
      const held = await applyCredit(await ensureHeld());
      if (held.status === 'confirmed') { finish(held); return; }
      const intent = await intentFor(held);
      if (!intent.paid) throw new ApiError('Maksua ei voitu vahvistaa. Yritä uudelleen.');
      finish(asPaid(held));
    } catch (err) {
      failed(err);
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  // An older server: hold first, then its checkout under the court.
  const startLegacy = async () => {
    setWorking(true);
    try {
      const held = await applyCredit(await ensureHeld());
      if (held.status === 'confirmed') { finish(held); return; }
      const config = await api.booking.checkoutConfig(held.id);
      if (config.paid) finish(asPaid(held));
      else setLegacyConfig(config);
    } catch (err) {
      failed(err);
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  // A hallisarja match, a game or a chat: the booked time goes straight to that chat.
  const sendToTarget = async () => {
    setSending(true);
    try {
      const conversationId = await target.openChat();
      await api.messages.send(conversationId, target.message(`${booking.courtName}, ${booking.locationName}, ${exactWhen(booking)}`));
      toast(target.sentText, { icon: 'check' });
      onClose();
      navigate(`/pelaa/viestit/${encodeURIComponent(conversationId)}`);
    } catch (err) {
      toast(err);
    } finally {
      setSending(false);
    }
  };

  const findPartner = () => {
    const id = booking?.id;
    onClose();
    // From the booking site into the app: Peliseura underneath, the game for this court on top.
    if (site) navigate('/pelaa/pelaajat');
    navigate(`/pelaa/uusi-peli?varaus=${encodeURIComponent(id)}`, { overlay: true });
  };

  // An account right here (AccountSheet); `back` is where Google / Apple come back to.
  const askAccount = (mode, { subtitle, then, back }) => setAccountAsk({ mode, subtitle, then, back });
  const accountSheet = (
    <AccountSheet
      open={Boolean(accountAsk)}
      mode={accountAsk?.mode}
      subtitle={accountAsk?.subtitle}
      name={contact.name}
      email={contact.email}
      city={venue.city}
      back={accountAsk?.back}
      onClose={() => setAccountAsk(null)}
      onDone={() => { const then = accountAsk?.then; setAccountAsk(null); then?.(); }}
    />
  );

  // ── Done ──
  if (step === 'done' && booking) {
    const email = contact.email.trim();
    const until = booking.cancellableUntil || deadline;
    const canCancel = Date.parse(until) > Date.now();
    // The booking site's way on is a pelikaveri; a guest needs an account for that.
    const partnerFoot = !target && (site || guest);
    // The booking moves to the new account first, so the game can be on this court.
    const partnerWithAccount = () => askAccount('register', {
      subtitle: 'Pelikaverin haku vaatii tilin.',
      then: async () => {
        if (booking.token) await claimGuestBookings([booking.token]);
        findPartner();
      },
      back: '/pelaa/pelaajat',
    });
    let fine;
    if (guest) fine = canCancel ? `Vahvistus ja peruutuslinkki tulevat osoitteeseen ${email}.` : `Vahvistus tulee osoitteeseen ${email}.`;
    else if (booking.paymentStatus === 'credit') fine = `Maksettu ${booking.credit?.kind === 'pass' ? 'sarjakortilla' : 'saldolla'}.`;
    else fine = 'Kuitti tulee sähköpostiisi.';
    return (
      <Sheet
        open={open}
        onClose={onClose}
        footer={partnerFoot ? (
          guest
            ? <Button variant="lime" size="lg" block icon="users" onClick={partnerWithAccount}>Luo tili ja etsi pelikaveri</Button>
            : <Button variant="lime" size="lg" block icon="users" onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>
        ) : <Button variant="lime" size="lg" block onClick={onClose}>Valmis</Button>}
        size="md"
        className="bk-sheet"
      >
        <div className="bk-done">
          <span className="bk-done-check" aria-hidden="true"><Icon name="check" size={34} strokeWidth={3} /></span>
          <h2 className="bk-done-title">Kenttä varattu!</h2>
          <p className="bk-done-text">
            <b>{booking.courtName}</b> · {booking.locationName}<br />
            {whenLabel(booking.startsAt, booking.endsAt)}
          </p>
          {!guest && !site && <SplitShare venue={venue} booking={booking} onChanged={(next) => { setBooking(next); onChanged?.(); }} />}
          <div className="bk-done-actions">
            {target?.openChat && (
              <Button variant="dark" icon="send" block loading={sending} onClick={sendToTarget}>{target.sendLabel}</Button>
            )}
            {target && !target.openChat && target.backTo && (
              <Button variant="dark" icon="arrow-left" block onClick={() => { onClose(); navigate(target.backTo); }}>{target.backLabel}</Button>
            )}
            {!target && !site && !guest && <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>}
            <Button variant="soft" icon="calendar" block onClick={() => downloadBookingIcs(booking, { cancellableUntil: booking.cancellableUntil })}>Lisää kalenteriin</Button>
            {guest && booking.token && (
              <Button variant="soft" icon="arrow-right" block onClick={() => { onClose(); navigate(guestBookingPath(booking.token)); }}>Näytä varaus</Button>
            )}
          </div>
          <p className="bk-fine">{fine}</p>
        </div>
        {accountSheet}
      </Sheet>
    );
  }

  // ── The demo's payment: a stand-in for the payment details, "OK" pays ──
  if (step === 'pay' && chosen) {
    return (
      <Sheet
        open={open}
        onClose={requestClose}
        title={`Maksa ${centsLabel(due)}`}
        subtitle={`${chosen.court.name} · ${whenLabel(startsAt, endsAt)}`}
        footer={<Button variant="lime" size="lg" block loading={working} onClick={payHere}>OK</Button>}
        size="md"
        className="bk-sheet"
      >
        <div className="bk-demo-pay">
          <span className="bk-demo-pay-icon" aria-hidden="true"><Icon name="lock" size={22} /></span>
          <p className="bk-demo-pay-title">Tähän tulevat maksutiedot</p>
          <p className="bk-demo-pay-methods">MobilePay · Apple Pay · Google Pay · kortti</p>
        </div>
      </Sheet>
    );
  }

  // ── Court and payment ──
  const cfg = payConfig.data;
  const creditOnly = Boolean(chosen) && due === 0;
  const payLabel = credit && credit !== 'gift' ? 'Maksa sarjakortilla'
    : creditOnly ? 'Maksa saldolla'
    : `Maksa ${centsLabel(due)}`;

  const returnPath = () => (heldRef.current?.token
    ? guestBookingPath(heldRef.current.token)
    : `${home}/${encodeURIComponent(venue.slug)}?varaus=${encodeURIComponent(heldRef.current?.id || '')}`);
  const pendingText = guest
    ? 'Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — vahvistus tulee sähköpostiisi.'
    : 'Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — näet sen Omissa vuoroissa.';

  let payment;
  if (!chosen) {
    payment = null;
  } else if (guest && cfg && !cfg.demo && !cfg.guests) {
    // A server from before bookings without an account: sign in first.
    payment = (
      <Button variant="lime" size="lg" block icon="log-in" onClick={() => { onClose(); navigate('/pelaa/koti'); }}>Kirjaudu ja varaa</Button>
    );
  } else if (payConfig.loading && !cfg) {
    payment = <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>;
  } else if (payConfig.error && !cfg) {
    payment = (
      <div className="stack-3">
        <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{payConfig.error.userMessage || 'Maksua ei saatu auki.'}</p>
        <Button variant="lime" icon="refresh" block onClick={() => payConfig.reload()}>Yritä uudelleen</Button>
      </div>
    );
  } else if (creditOnly) {
    payment = <Button variant="lime" size="lg" block icon="lock" loading={working} disabled={!contactOk} onClick={payHere}>{payLabel}</Button>;
  } else if (cfg?.demo) {
    payment = <Button variant="lime" size="lg" block icon="lock" disabled={!contactOk} onClick={() => setStep('pay')}>{payLabel}</Button>;
  } else if (cfg?.legacy) {
    payment = legacyConfig ? (
      <Checkout
        config={legacyConfig}
        compact
        createIntent={() => api.booking.createPaymentIntent(heldRef.current.id)}
        verify={verify}
        returnPath={returnPath}
        pendingText={pendingText}
        onPaid={() => finish(asPaid(heldRef.current))}
      />
    ) : (
      <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={startLegacy}>Varaa ja maksa {centsLabel(due)}</Button>
    );
  } else if (cfg) {
    payment = (
      <Checkout
        key={`${chosen.court.id}:${due}`}
        config={{ publishableKey: cfg.publishableKey, amount: due, currency: cfg.currency || 'eur', email: cfg.email }}
        compact
        createIntent={createIntent}
        verify={verify}
        returnPath={returnPath}
        pendingText={pendingText}
        onPaid={() => finish(asPaid(heldRef.current))}
      />
    );
  }

  // The payment shows once it is clear whose booking it is: an account's, or a guest's with a name and an email.
  const payNow = !guest || who === 'guest';
  const plainPay = creditOnly || Boolean(cfg?.demo);
  const placeStates = place && chosen ? mapStates(place, options, busy, startsAt, minutes, chosen.court.id, sport) : {};
  const placeOptions = place ? options.filter((o) => o.location.id === place.id) : [];

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      title={whenLabel(startsAt, endsAt)}
      subtitle={`${sportLabel(sport)} · ${place?.name || venue.name}`}
      size="md"
      className="bk-sheet"
    >
      <div className="stack-4">
        {options.length === 0 ? (
          <p className="bk-note"><Icon name="info" size={16} />Tähän aikaan ei ole enää vapaata kenttää. Valitse toinen aika.</p>
        ) : (
          <div className="bk-field">
            {places.length > 1 && (
              <Segmented
                ariaLabel="Paikka"
                options={places.map((l) => ({ value: l.id, label: l.indoor ? l.name : 'Ulkokentät' }))}
                value={place.id}
                onChange={pickPlace}
                size="sm"
                className="bk-place-tabs"
              />
            )}
            {hasVenueMap(place.mapKey) ? (
              <VenueMap
                compact
                mapKey={place.mapKey}
                courts={place.courts}
                states={placeStates}
                labels={Object.fromEntries(placeOptions.map((o) => [o.court.id, centsLabel(o.cents)]))}
                onSelect={setCourtId}
                className="bk-sheet-map"
              />
            ) : (
              <div className="bk-courts-row">
                {placeOptions.map((o) => (
                  <button
                    key={o.court.id}
                    type="button"
                    className={cx('bk-court', o.court.id === chosen?.court.id && 'is-on')}
                    aria-pressed={o.court.id === chosen?.court.id}
                    onClick={() => setCourtId(o.court.id)}
                  >
                    <span className="bk-court-name">{o.court.shortName}</span>
                    <span className="bk-court-price">{centsLabel(o.cents)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chosen && (
          <p className="bk-court-line">
            <b>{chosen.court.name}</b>{chosen.court.surface ? ` · ${surfaceLabel(chosen.court.surface).toLowerCase()}` : ''}
            {weather ? <span className={cx('bk-weather', weather.wet && 'is-wet')}> · {weather.symbol} {weather.text}</span> : null}
            {chosen.resale && (
              <>
                <br />
                <span className="bk-court-line-sub">Toisen pelaajan myyntiin laittama vuoro, normaalihinta.</span>
              </>
            )}
          </p>
        )}

        {chosen && pass && (
          <Toggle
            icon="repeat"
            label="Käytä sarjakorttia"
            hint={`${pass.name} · ${hoursLeftLabel(pass.minutesLeft)} jäljellä`}
            checked={credit === pass.id}
            disabled={working}
            onChange={(on) => setCredit(on ? pass.id : null)}
          />
        )}
        {chosen && gift > 0 && credit !== pass?.id && (
          <Toggle
            icon="euro"
            label="Käytä saldoa"
            hint={credit === 'gift' ? `${centsLabel(giftCover)} saldosta${due > 0 ? ` · loput ${centsLabel(due)}` : ''}` : `Saldoa ${centsLabel(gift)}`}
            checked={credit === 'gift'}
            disabled={working}
            onChange={(on) => setCredit(on ? 'gift' : null)}
          />
        )}

        {chosen && guest && !who && (
          <div className="bk-who">
            <Button
              variant="lime"
              size="lg"
              block
              icon="user"
              onClick={() => askAccount('register', { subtitle: 'Jatkossa varaat nopeammin.', back: `${home}/${encodeURIComponent(venue.slug)}` })}
            >
              Luo tili ja varaa
            </Button>
            <Button variant="outline" size="lg" block onClick={() => setWho('guest')}>Varaa ilman tiliä</Button>
            <p className="bk-who-login">
              Onko sinulla jo tili?{' '}
              <button
                type="button"
                className="bk-terms-inline"
                onClick={() => askAccount('login', { back: `${home}/${encodeURIComponent(venue.slug)}` })}
              >
                Kirjaudu
              </button>
            </p>
          </div>
        )}

        {chosen && needsName && (
          <div className="bk-name">
            <Input
              aria-label="Nimi"
              placeholder="Nimi"
              autoComplete="name"
              maxLength={80}
              value={quickName}
              onChange={(e) => setQuickName(e.target.value)}
            />
          </div>
        )}

        {chosen && guest && who === 'guest' && (
          <div className="bk-guest">
            <Input
              aria-label="Nimi"
              placeholder="Nimi"
              autoComplete="name"
              maxLength={80}
              value={contact.name}
              onChange={(e) => setContact((c) => ({ ...c, name: e.target.value }))}
            />
            <Input
              aria-label="Sähköposti"
              placeholder="Sähköposti"
              type="email"
              inputMode="email"
              autoComplete="email"
              maxLength={254}
              value={contact.email}
              onChange={(e) => setContact((c) => ({ ...c, email: e.target.value }))}
            />
          </div>
        )}

        {payment && payNow && (
          // A card form sits in the dark box; a single pay button (the demo, credit) stands on its own.
          <div className={cx(!plainPay && 'bk-paybox', !contactOk && 'is-locked')} aria-disabled={!contactOk || undefined}>{payment}</div>
        )}

        {chosen && payNow && (
          <p className="bk-fine bk-fine-center">
            {lateBooking ? 'Peruutusaika on jo mennyt.' : `Peruutus ${timeInSentence(deadline)} asti, kulu 1 €.`}
            <br />
            Maksamalla hyväksyt <button type="button" className="bk-terms-inline" onClick={() => setTermsOpen(true)}>varausehdot</button>.
          </p>
        )}
      </div>
      <BookingTermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} venue={venue} />
      {accountSheet}
    </Sheet>
  );
}

/** 'to 15.10. klo 10.00–11.00' — a message is read later, so no "huomenna". */
const exactWhen = (b) => `${WEEKDAYS_SHORT[new Date(b.startsAt).getDay()]} ${formatDayMonth(b.startsAt)} klo ${formatTime(b.startsAt)}–${formatTime(b.endsAt)}`;

const SURFACES = { massa: 'Massakenttä', kova: 'Kova kenttä', matto: 'Matto', parketti: 'Parketti', tekonurmi: 'Tekonurmi' };
export const surfaceLabel = (surface) => SURFACES[surface] || surface;
