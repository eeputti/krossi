// BookSheet — booking one start time: pick the length and the court (on the floor map or from
// the chips), hold it, pay, done. Opened from a time tile ("18.00 · 3 kenttää") or from a court
// on the map. While the player pays, the court is held for venue.holdMinutes; backing out
// releases it at once so nobody else has to wait.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/index.js';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { firstName, formatGameTime, formatTime } from '../../lib/format.js';
import {
  cancelDeadline, centsLabel, courtsOf, discounted, durationLabel, isTaken, lastMinutePercent, priceOf,
} from '../../features/booking.js';
import { Button, Icon, Sheet, Skeleton, useConfirm, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { DurationStepper, HoldCountdown, downloadBookingIcs, sportLabel, useHoldLeft, whenLabel } from './BookingParts.jsx';
import { useForecast, weatherInfo } from './weather.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const MIN = 60_000;

/**
 * Courts of `sport` free for [startsAt, +minutes) with their price:
 * [{ court, location, cents, fullCents }] — `cents` after a last-minute deal.
 */
export function freeCourts(venue, busy, sport, startsAt, minutes) {
  const startMs = Date.parse(startsAt);
  const endMs = startMs + minutes * MIN;
  const deal = lastMinutePercent(venue, startsAt);
  return courtsOf(venue, { sport })
    .filter(({ court }) => !isTaken(busy, court.id, startMs, endMs))
    .map(({ court, location }) => ({ court, location, fullCents: priceOf(venue, court, startsAt, minutes) }))
    .filter((o) => o.fullCents != null)
    .map((o) => ({ ...o, cents: discounted(o.fullCents, deal) }));
}

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

export function BookSheet({ open, onClose, venue, busy, sport, startsAt, minutes: firstMinutes, courtId: firstCourtId, locationId, onBooked, onChanged, match = null }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [minutes, setMinutes] = useState(firstMinutes);
  const [courtId, setCourtId] = useState(firstCourtId || null);
  const [step, setStep] = useState('choose'); // 'choose' | 'pay' | 'done'
  const [booking, setBooking] = useState(null);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [working, setWorking] = useState(false);

  // A new time (or court) starts over from the first step.
  useEffect(() => {
    if (!open) return;
    setMinutes(firstMinutes);
    setCourtId(firstCourtId || null);
    setStep('choose');
    setBooking(null);
    setConfig(null);
    setConfigError(null);
  }, [open, startsAt, firstMinutes, firstCourtId]);

  const lengths = useMemo(() => (venue?.durations || []).map((m) => {
    const free = startsAt ? freeCourts(venue, busy, sport, startsAt, m) : [];
    return { minutes: m, free, from: free.length ? Math.min(...free.map((o) => o.cents)) : null };
  }), [venue, busy, sport, startsAt]);

  const options = useMemo(() => {
    const free = lengths.find((l) => l.minutes === minutes)?.free || [];
    // The place the player was looking at comes first; within it, the venue's court order.
    return locationId ? [...free].sort((a, b) => (a.location.id === locationId ? 0 : 1) - (b.location.id === locationId ? 0 : 1)) : free;
  }, [lengths, minutes, locationId]);

  const chosen = options.find((o) => o.court.id === courtId) || options[0] || null;
  const weather = weatherInfo(useForecast(chosen?.location, startsAt));
  const deal = startsAt ? lastMinutePercent(venue, startsAt) : 0;
  const holdLeft = useHoldLeft(step === 'pay' ? booking?.holdExpiresAt : null);
  const expired = step === 'pay' && holdLeft === 0;

  if (!venue || !startsAt) return null;
  const endsAt = new Date(Date.parse(startsAt) + minutes * MIN).toISOString();
  const deadline = cancelDeadline(startsAt, venue);
  const lateBooking = Date.parse(deadline) <= Date.now();

  const finish = (confirmed) => {
    setBooking(confirmed);
    setStep('done');
    onBooked?.(confirmed);
  };

  const hold = async () => {
    if (!chosen) return;
    setWorking(true);
    try {
      const held = await api.booking.hold({ courtId: chosen.court.id, startsAt, minutes });
      if (held.status === 'confirmed') { finish(held); return; }
      setBooking(held);
      setStep('pay');
      await loadConfig(held);
    } catch (err) {
      toast(err);
      if (err?.code === 'taken') onChanged?.(); // somebody was faster: refresh the calendar
    } finally {
      setWorking(false);
    }
  };

  const loadConfig = async (held = booking) => {
    setConfigError(null);
    setConfig(null);
    try {
      const cfg = await api.booking.checkoutConfig(held.id);
      if (cfg.paid) finish({ ...held, status: 'confirmed', paymentStatus: 'paid', holdExpiresAt: null });
      else setConfig(cfg);
    } catch (err) {
      setConfigError(err);
    }
  };

  const release = async () => {
    const held = booking;
    setStep('choose');
    setBooking(null);
    setConfig(null);
    if (held?.status === 'held') {
      try {
        await api.booking.release(held.id);
      } catch (err) {
        // The hold runs out on its own in a few minutes anyway; tell, don't block.
        toast(err);
      }
    }
    onChanged?.();
  };

  const requestClose = async () => {
    if (step === 'pay' && booking && !expired) {
      const ok = await confirm({
        title: 'Perutaanko varaus?',
        message: 'Vuoro vapautuu heti muille. Mitään ei veloiteta.',
        confirmLabel: 'Peru varaus',
        cancelLabel: 'Jatka maksua',
        danger: true,
      });
      if (!ok) return;
      await release();
    }
    onClose();
  };

  const payDemo = async () => {
    setWorking(true);
    try {
      await api.booking.createPaymentIntent(booking.id);
      finish({ ...booking, status: 'confirmed', paymentStatus: 'paid', holdExpiresAt: null });
    } catch (err) {
      toast(err);
    } finally {
      setWorking(false);
    }
  };

  const verify = async (paymentIntentId) => {
    const result = await api.booking.verifyPayment(booking.id, paymentIntentId);
    if (result.status === 'lost') throw new ApiError(result.message || 'Aika ehti mennä toiselle — maksu palautettiin.', { code: 'taken' });
    return { paid: result.confirmed, status: result.status };
  };

  // Hallisarja: the booked time goes straight to the match chat with the opponent.
  const [sending, setSending] = useState(false);
  const sendToOpponent = async () => {
    setSending(true);
    try {
      const conversationId = await api.leagues.openFixtureChat(match.fixtureId);
      await api.messages.send(conversationId,
        `Varasin meille kentän hallisarjan otteluun: ${booking.courtName}, ${booking.locationName}, ${whenLabel(booking.startsAt, booking.endsAt)}. Nähdään kentällä!`);
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

  // ── Content per step ──
  let body;
  let footer;

  if (step === 'done' && booking) {
    const location = venue.locations.find((l) => l.courts.some((c) => c.id === booking.courtId));
    body = (
      <div className="bk-done">
        <span className="bk-done-check" aria-hidden="true"><Icon name="check" size={34} strokeWidth={3} /></span>
        <h2 className="bk-done-title">Kenttä varattu!</h2>
        <p className="bk-done-text">
          <b>{booking.courtName}</b> · {booking.locationName}<br />
          {whenLabel(booking.startsAt, booking.endsAt)}
        </p>
        {location && hasVenueMap(location.mapKey) && (
          <VenueMap compact mapKey={location.mapKey} courts={location.courts} states={{ [booking.courtId]: 'mine' }} className="bk-done-map" />
        )}
        <div className="bk-done-actions">
          {match && (
            <Button variant="dark" icon="send" block loading={sending} onClick={sendToOpponent}>
              Lähetä aika: {firstName(match.opponent?.name)}
            </Button>
          )}
          <Button variant={match ? 'outline' : 'dark'} icon="calendar" block onClick={() => downloadBookingIcs(booking, { cancellableUntil: booking.cancellableUntil })}>Lisää kalenteriin</Button>
          {!match && <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>}
        </div>
        <p className="bk-fine">
          {config?.demo ? 'Demotila — mitään ei veloitettu.' : 'Kuitti tulee sähköpostiisi.'}
          {!lateBooking && ` Maksuton peruutus ${formatGameTime(booking.cancellableUntil || deadline)} asti.`}
        </p>
      </div>
    );
    footer = <Button variant="lime" size="lg" block onClick={onClose}>Valmis</Button>;
  } else if (step === 'pay' && booking) {
    body = (
      <div className="stack-4">
        <div className="bk-paybar">
          {expired
            ? <span className="bk-hold is-low"><Icon name="alert" size={15} />Pitoaika umpeutui</span>
            : holdLeft != null && <HoldCountdown left={holdLeft} />}
          <span className="bk-paybar-price">{centsLabel(booking.priceCents)}</span>
        </div>
        <Summary venue={venue} booking={booking} lateBooking={lateBooking} deadline={deadline} />
        {expired ? (
          <div className="bk-expired">
            <p>Vuoroa pidettiin sinulle {venue.holdMinutes} minuuttia, ja se vapautui nyt muille. Mitään ei veloitettu.</p>
            <Button variant="dark" icon="refresh" block onClick={release}>Valitse aika uudelleen</Button>
          </div>
        ) : (
          <div className="bk-paybox">
            <span className="eyebrow bk-paybox-title">Maksu</span>
            {configError ? (
              <div className="stack-3">
                <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{configError.userMessage || 'Maksua ei saatu auki.'}</p>
                <Button variant="lime" icon="refresh" block onClick={() => loadConfig()}>Yritä uudelleen</Button>
              </div>
            ) : !config ? (
              <div className="stack-3" aria-label="Ladataan maksua"><Skeleton h={50} r={14} /><Skeleton h={54} r={14} /></div>
            ) : config.demo ? (
              <div className="stack-3">
                <p className="bk-paybox-demo">
                  <Icon name="info" size={15} />
                  <span><b>Demotila</b> — maksu hyväksytään heti. Oikeassa Krossissa maksat Apple Paylla, Google Paylla, MobilePaylla tai kortilla.</span>
                </p>
                <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(booking.priceCents)}</Button>
              </div>
            ) : (
              <Checkout
                config={config}
                createIntent={() => api.booking.createPaymentIntent(booking.id)}
                verify={verify}
                returnPath={`/pelaa/varaa/${encodeURIComponent(venue.slug)}?varaus=${encodeURIComponent(booking.id)}`}
                pendingText="Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — näet sen Omissa vuoroissa."
                onPaid={() => finish({ ...booking, status: 'confirmed', paymentStatus: 'paid', holdExpiresAt: null })}
              />
            )}
          </div>
        )}
      </div>
    );
    footer = !expired && (
      <Button variant="ghost" block onClick={async () => { await release(); }}>Peru varaus ja valitse toinen aika</Button>
    );
  } else {
    const location = chosen?.location || venue.locations.find((l) => l.id === locationId) || null;
    const byLocation = [];
    for (const o of options) {
      let group = byLocation.find((g) => g.location.id === o.location.id);
      if (!group) { group = { location: o.location, options: [] }; byLocation.push(group); }
      group.options.push(o);
    }
    body = (
      <div className="stack-4">
        <div className="bk-field">
          <span className="eyebrow">Kesto</span>
          <DurationStepper
            value={minutes}
            options={venue.durations}
            onChange={setMinutes}
            note={chosen ? `klo ${formatTime(startsAt)}–${formatTime(endsAt)} · ${centsLabel(chosen.cents)}` : `klo ${formatTime(startsAt)}–${formatTime(endsAt)}`}
            className="bk-stepper-wide"
          />
        </div>

        {options.length === 0 ? (
          <p className="bk-note"><Icon name="info" size={16} />Tälle kestolle ei ole vapaata kenttää tähän aikaan — lyhennä kestoa.</p>
        ) : (
          <div className="bk-field">
            <span className="eyebrow">Kenttä</span>
            {location && hasVenueMap(location.mapKey) && (
              <VenueMap
                compact
                mapKey={location.mapKey}
                courts={location.courts}
                states={mapStates(location, options, busy, startsAt, minutes, chosen?.court.id, sport)}
                labels={Object.fromEntries(options.filter((o) => o.location.id === location.id).map((o) => [o.court.id, centsLabel(o.cents)]))}
                onSelect={setCourtId}
                className="bk-sheet-map"
              />
            )}
            {byLocation.map((group) => (
              <div key={group.location.id} className="bk-courts">
                {byLocation.length > 1 && <span className="bk-courts-place">{group.location.name}</span>}
                <div className="bk-courts-row">
                  {group.options.map((o) => (
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
              </div>
            ))}
          </div>
        )}

        {chosen && (
          <dl className="bk-facts">
            <div><dt>Paikka</dt><dd>{chosen.location.name}{chosen.location.address ? <small>{chosen.location.address}</small> : null}</dd></div>
            <div><dt>Kenttä</dt><dd>{chosen.court.name}{chosen.court.surface ? <small>{surfaceLabel(chosen.court.surface)}</small> : null}</dd></div>
            {weather && (
              <div><dt>Sää</dt><dd className={cx('bk-weather', weather.wet && 'is-wet')}>{weather.symbol} {weather.text}</dd></div>
            )}
            {deal > 0 && chosen.fullCents > chosen.cents && (
              <div><dt>Hinta</dt><dd>{centsLabel(chosen.cents)}<small>Viime hetken ale −{deal} % (norm. {centsLabel(chosen.fullCents)})</small></dd></div>
            )}
            <div><dt>Peruutus</dt><dd>{lateBooking ? 'Alle vuorokausi alkuun — ei maksutonta peruutusta' : `Maksuton ${formatGameTime(deadline)} asti`}</dd></div>
          </dl>
        )}
      </div>
    );
    footer = (
      <div className="stack-2">
        <Button variant="lime" size="lg" block loading={working} disabled={!chosen} onClick={hold} icon={working ? undefined : 'lock'}>
          {chosen ? `Varaa ja maksa ${centsLabel(chosen.cents)}` : 'Valitse kenttä'}
        </Button>
        <p className="bk-fine bk-fine-center">Vuoro pidetään sinulle {venue.holdMinutes} min maksun ajan.</p>
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={requestClose}
      title={step === 'done' ? undefined : whenLabel(startsAt, step === 'pay' && booking ? booking.endsAt : endsAt)}
      subtitle={step === 'done' ? undefined : `${sportLabel(sport)} · ${venue.name}`}
      footer={footer || undefined}
      size="md"
      dismissible={step !== 'pay' || expired}
      className="bk-sheet"
    >
      {body}
    </Sheet>
  );
}

const SURFACES = { massa: 'Massakenttä', kova: 'Kova kenttä', matto: 'Matto', parketti: 'Parketti', tekonurmi: 'Tekonurmi' };
export const surfaceLabel = (surface) => SURFACES[surface] || surface;

function Summary({ venue, booking, lateBooking, deadline }) {
  return (
    <dl className="bk-facts">
      <div><dt>Kenttä</dt><dd>{booking.courtName}<small>{booking.locationName}</small></dd></div>
      <div><dt>Aika</dt><dd>{whenLabel(booking.startsAt, booking.endsAt)}</dd></div>
      <div><dt>Peruutus</dt><dd>{lateBooking ? 'Ei maksutonta peruutusta' : `Maksuton ${formatGameTime(booking.cancellableUntil || deadline)} asti`}</dd></div>
      <div><dt>Paikka</dt><dd>{venue.name}</dd></div>
    </dl>
  );
}
