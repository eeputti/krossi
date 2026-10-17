// BookSheet — booking one start time in one view: the court on the floor map (a free one is picked
// already), one line about it, the player's own series card or gift balance when they have some,
// and the payment right there (MobilePay, Apple Pay, Google Pay, card). Nothing is held until the
// player pays: then the court is held, paid and confirmed in one go ("Joku ehti ensin…" if somebody
// was faster). Done: "Kenttä varattu!" with "Jaa maksu" (a link friends pay their parts at, no
// account needed — each part goes back to the booker), "Etsi pelikaveri tähän vuoroon" and the
// calendar file. Opened from a start-time row; the length was chosen on the page.
//
// A server without payConfig (krossi-booking before phase 4) can't show the payment before a hold:
// there "Varaa ja maksa" holds first and the same checkout opens under the court.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { WEEKDAYS_SHORT, firstName, formatDayMonth, formatTime } from '../../lib/format.js';
import {
  cancelDeadline, centsLabel, courtsOf, coversSale, discounted, isTaken, lastMinutePercent, priceOf,
} from '../../features/booking.js';
import { hoursLeftLabel, passFits } from '../../features/seasons.js';
import { Button, Icon, Segmented, Sheet, Skeleton, Toggle, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { downloadBookingIcs, sportLabel, timeInSentence, whenLabel } from './BookingParts.jsx';
import { useForecast, weatherInfo } from './weather.js';
import { BookingTermsSheet } from './BookingTerms.jsx';
import { SplitShare } from './SplitShare.jsx';

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

export function BookSheet({ open, onClose, venue, busy, sport, startsAt, minutes, courtId: firstCourtId, locationId, onBooked, onChanged, match = null }) {
  const toast = useToast();
  const [courtId, setCourtId] = useState(firstCourtId || null);
  const [placeId, setPlaceId] = useState(null);
  const [step, setStep] = useState('choose'); // 'choose' | 'done'
  const [booking, setBooking] = useState(null);
  const [legacyConfig, setLegacyConfig] = useState(null);
  const [credit, setCredit] = useState(null); // null | 'gift' | a series card's id
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  // The hold made when the player pays: Stripe's callbacks read it, and closing gives it back.
  const heldRef = useRef(null);
  const payConfig = useAsync(() => (open ? api.booking.payConfig() : Promise.resolve(null)), [open]);
  const wallet = useAsync(() => (open && venue ? api.wallet.get(venue.id).catch(() => null) : Promise.resolve(null)), [open, venue?.id]);

  // A new time (or court) starts over.
  useEffect(() => {
    if (!open) return;
    setCourtId(firstCourtId || null);
    setPlaceId(null);
    setStep('choose');
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

  // Own credit: a series card that fits this time, or the gift balance (one or the other).
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
    const held = await api.booking.hold({ courtId: chosen.court.id, startsAt, minutes });
    heldRef.current = held;
    return held;
  };

  /** The series card pays it all; the gift balance pays its part. Confirmed when that covered it. */
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
      await api.booking.release(held.id);
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
      return await api.booking.createPaymentIntent(held.id);
    } catch (err) {
      failed(err);
      throw err;
    }
  };

  const verify = async (paymentIntentId) => {
    const result = await api.booking.verifyPayment(heldRef.current.id, paymentIntentId);
    if (result.status === 'lost') throw new ApiError(result.message || 'Aika ehti mennä toiselle — maksu palautettiin.', { code: 'taken' });
    return { paid: result.confirmed, status: result.status };
  };

  // The demo, and credit that covers everything: no card form, pay right here.
  const payHere = async () => {
    setWorking(true);
    try {
      const held = await applyCredit(await ensureHeld());
      if (held.status === 'confirmed') { finish(held); return; }
      const intent = await api.booking.createPaymentIntent(held.id);
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

  // Hallisarja: the booked time goes straight to the match chat with the opponent.
  const sendToOpponent = async () => {
    setSending(true);
    try {
      const conversationId = await api.leagues.openFixtureChat(match.fixtureId);
      await api.messages.send(conversationId,
        `Varasin meille kentän hallisarjan otteluun: ${booking.courtName}, ${booking.locationName}, ${exactWhen(booking)}. Nähdään kentällä!`);
      toast(`Aika lähetetty: ${firstName(match.opponent?.name)}`, { icon: 'check' });
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
    navigate(`/pelaa/uusi-peli?varaus=${encodeURIComponent(id)}`, { overlay: true });
  };

  // ── Done ──
  if (step === 'done' && booking) {
    return (
      <Sheet
        open={open}
        onClose={onClose}
        footer={<Button variant="lime" size="lg" block onClick={onClose}>Valmis</Button>}
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
          {!match && <SplitShare venue={venue} booking={booking} onChanged={(next) => { setBooking(next); onChanged?.(); }} />}
          <div className="bk-done-actions">
            {match && (
              <Button variant="dark" icon="send" block loading={sending} onClick={sendToOpponent}>
                Lähetä aika: {firstName(match.opponent?.name)}
              </Button>
            )}
            {!match && <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>}
            <Button variant="soft" icon="calendar" block onClick={() => downloadBookingIcs(booking, { cancellableUntil: booking.cancellableUntil })}>Lisää kalenteriin</Button>
          </div>
          <p className="bk-fine">
            {booking.paymentStatus === 'credit'
              ? `Maksettu ${booking.credit?.kind === 'pass' ? 'sarjakortilla' : 'lahjakorttisaldolla'}.`
              : payConfig.data?.demo ? 'Demotila — mitään ei veloitettu.' : 'Kuitti tulee sähköpostiisi.'}
            {!lateBooking && ` Maksuton peruutus ${timeInSentence(booking.cancellableUntil || deadline)} asti.`}
          </p>
        </div>
      </Sheet>
    );
  }

  // ── Court and payment ──
  const cfg = payConfig.data;
  const creditOnly = Boolean(chosen) && due === 0;
  const payLabel = credit && credit !== 'gift' ? 'Maksa sarjakortilla'
    : creditOnly ? 'Maksa lahjakorttisaldolla'
    : `Maksa ${centsLabel(due)}`;

  let payment;
  if (!chosen) {
    payment = null;
  } else if (payConfig.loading && !cfg) {
    payment = <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>;
  } else if (payConfig.error && !cfg) {
    payment = (
      <div className="stack-3">
        <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{payConfig.error.userMessage || 'Maksua ei saatu auki.'}</p>
        <Button variant="lime" icon="refresh" block onClick={() => payConfig.reload()}>Yritä uudelleen</Button>
      </div>
    );
  } else if (creditOnly || cfg?.demo) {
    payment = (
      <div className="stack-3">
        {cfg?.demo && !creditOnly && (
          <p className="bk-paybox-demo">
            <Icon name="info" size={15} />
            <span><b>Demotila</b> — maksu hyväksytään heti. Oikeassa Krossissa maksat MobilePaylla, Apple Paylla, Google Paylla tai kortilla.</span>
          </p>
        )}
        <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payHere}>{payLabel}</Button>
      </div>
    );
  } else if (cfg?.legacy) {
    payment = legacyConfig ? (
      <Checkout
        config={legacyConfig}
        compact
        createIntent={() => api.booking.createPaymentIntent(heldRef.current.id)}
        verify={verify}
        returnPath={() => `/pelaa/varaa/${encodeURIComponent(venue.slug)}?varaus=${encodeURIComponent(heldRef.current?.id || '')}`}
        pendingText="Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — näet sen Omissa vuoroissa."
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
        returnPath={() => `/pelaa/varaa/${encodeURIComponent(venue.slug)}?varaus=${encodeURIComponent(heldRef.current?.id || '')}`}
        pendingText="Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — näet sen Omissa vuoroissa."
        onPaid={() => finish(asPaid(heldRef.current))}
      />
    );
  }

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
            <br />
            <span className="bk-court-line-sub">
              {chosen.resale ? 'Toisen pelaajan myyntiin laittama vuoro, normaalihinta. ' : ''}
              {lateBooking ? 'Ei maksutonta peruutusta' : `Maksuton peruutus ${timeInSentence(deadline)} asti`}
            </span>
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
            icon="gift"
            label="Käytä lahjakorttisaldoa"
            hint={credit === 'gift' ? `${centsLabel(giftCover)} saldosta${due > 0 ? ` · loput ${centsLabel(due)}` : ''}` : `Saldoa ${centsLabel(gift)}`}
            checked={credit === 'gift'}
            disabled={working}
            onChange={(on) => setCredit(on ? 'gift' : null)}
          />
        )}

        {payment && <div className="bk-paybox">{payment}</div>}

        {chosen && (
          <p className="bk-fine bk-fine-center">
            Maksamalla hyväksyt <button type="button" className="bk-terms-inline" onClick={() => setTermsOpen(true)}>varausehdot</button>.
          </p>
        )}
      </div>
      <BookingTermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} venue={venue} />
    </Sheet>
  );
}

/** 'to 15.10. klo 10.00–11.00' — a message is read later, so no "huomenna". */
const exactWhen = (b) => `${WEEKDAYS_SHORT[new Date(b.startsAt).getDay()]} ${formatDayMonth(b.startsAt)} klo ${formatTime(b.startsAt)}–${formatTime(b.endsAt)}`;

const SURFACES = { massa: 'Massakenttä', kova: 'Kova kenttä', matto: 'Matto', parketti: 'Parketti', tekonurmi: 'Tekonurmi' };
export const surfaceLabel = (surface) => SURFACES[surface] || surface;
