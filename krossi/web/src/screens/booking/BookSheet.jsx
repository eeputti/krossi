// BookSheet — booking one start time: pick the length and the court (on the floor map or from
// the chips), who pays (me, or split with pelikaverit), hold it, pay, done. Opened from a time
// tile ("18.00 · 3 kenttää") or from a court on the map. While the player pays, the court is held
// for venue.holdMinutes; backing out releases it at once so nobody else has to wait.
//
// Jaettu maksu (better than Thril's anonymous "Osallistuja 2"): the friends are real Krossi
// players picked by face. The booker pays their own part now and the card is saved; each friend
// gets a chat message with "Maksa osuutesi", and whatever is unpaid at the deadline is charged to
// the saved card.
import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { Checkout } from '../../app/checkout.jsx';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { WEEKDAYS_SHORT, firstName, formatDayMonth, formatTime } from '../../lib/format.js';
import {
  SPLIT_PARTS, cancelDeadline, centsLabel, courtsOf, coversSale, discounted, durationLabel, isTaken, lastMinutePercent,
  priceOf, shareDeadline, splitBlocker, splitCents,
} from '../../features/booking.js';
import { Avatar, Button, Icon, Segmented, Sheet, Skeleton, useConfirm, useToast } from '../../ui/index.js';
import { VenueMap, hasVenueMap } from './VenueMap.jsx';
import { DurationStepper, HoldCountdown, SplitLines, downloadBookingIcs, sportLabel, timeInSentence, useHoldLeft, whenLabel } from './BookingParts.jsx';
import { useForecast, weatherInfo } from './weather.js';

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

const PAY_OPTIONS = [
  { value: 'self', label: 'Maksan itse' },
  { value: 'kaksinpeli', label: 'Jaa kahdelle' },
  { value: 'nelinpeli', label: 'Jaa neljälle' },
];

/** My own part paid: what the done step and "Omat vuorot" show right away. */
function asPaid(booking) {
  const split = booking.split && {
    ...booking.split,
    lines: booking.split.lines.map((l) => (l.kind === 'own' ? { ...l, status: 'paid', paidAt: new Date().toISOString() } : l)),
  };
  return { ...booking, status: 'confirmed', paymentStatus: 'paid', holdExpiresAt: null, split };
}

/** Pelikaverit by face: one for kaksinpeli (tap swaps), up to three for nelinpeli. */
function FriendPicker({ friends, max, value, onChange }) {
  const toggle = (id) => {
    if (value.includes(id)) onChange(value.filter((x) => x !== id));
    else if (max === 1) onChange([id]);
    else if (value.length < max) onChange([...value, id]);
  };
  return (
    <div className="bk-friends" role="group" aria-label={max === 1 ? 'Valitse pelikaveri' : `Valitse ${max} pelikaveria`}>
      {friends.map((p) => {
        const on = value.includes(p.id);
        const full = !on && max > 1 && value.length >= max;
        return (
          <button key={p.id} type="button" className={cx('bk-friend', on && 'is-on')} aria-pressed={on} disabled={full} onClick={() => toggle(p.id)}>
            <span className="bk-friend-face">
              <Avatar person={p} size={44} />
              {on && <span className="bk-friend-check" aria-hidden="true"><Icon name="check" size={12} strokeWidth={3} /></span>}
            </span>
            <span className="bk-friend-name truncate">{firstName(p.name)}</span>
          </button>
        );
      })}
    </div>
  );
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
  const { user } = useSession();
  const [minutes, setMinutes] = useState(firstMinutes);
  const [courtId, setCourtId] = useState(firstCourtId || null);
  const [step, setStep] = useState('choose'); // 'choose' | 'pay' | 'done'
  const [booking, setBooking] = useState(null);
  const [config, setConfig] = useState(null);
  const [configError, setConfigError] = useState(null);
  const [working, setWorking] = useState(false);
  const [sending, setSending] = useState(false);
  const [payMode, setPayMode] = useState('self'); // 'self' | 'kaksinpeli' | 'nelinpeli'
  const [friendIds, setFriendIds] = useState([]);
  const splitting = payMode !== 'self';
  const friends = useAsync(() => (open && splitting ? api.booking.shareFriends() : Promise.resolve(null)), [open, splitting]);

  // A new time (or court) starts over from the first step.
  useEffect(() => {
    if (!open) return;
    setMinutes(firstMinutes);
    setCourtId(firstCourtId || null);
    setStep('choose');
    setBooking(null);
    setConfig(null);
    setConfigError(null);
    setPayMode('self');
    setFriendIds([]);
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
  const parts = SPLIT_PARTS[payMode] || 1;
  const shares = chosen && splitting ? splitCents(chosen.cents, parts) : null;
  const splitProblem = chosen && splitting ? splitBlocker(venue, startsAt, chosen.cents, parts) : null;
  const picked = splitting ? friendIds.length : 0;
  const ready = Boolean(chosen) && (!splitting || (!splitProblem && picked === parts - 1));
  // A hallisarja opponent is the obvious one to split with: first in the list.
  const friendList = (friends.data || []).slice().sort((a, b) => (b.id === match?.opponent?.id) - (a.id === match?.opponent?.id));

  const changePayMode = (mode) => {
    setPayMode(mode);
    const max = (SPLIT_PARTS[mode] || 1) - 1;
    setFriendIds((ids) => ids.slice(0, max));
  };

  const finish = (confirmed) => {
    setBooking(confirmed);
    setStep('done');
    onBooked?.(confirmed);
  };

  const hold = async () => {
    if (!ready) return;
    setWorking(true);
    try {
      const held = await api.booking.hold({ courtId: chosen.court.id, startsAt, minutes, friendIds: splitting ? friendIds : [] });
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
      if (cfg.paid) finish(asPaid(held));
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
      finish(asPaid(booking));
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
        {booking.split ? (
          <div className="bk-done-split">
            <p className="bk-done-text">{friendsAsked(booking.split)}</p>
            <SplitLines split={booking.split} meId={user?.id} />
            <p className="bk-fine">Jos osuuksia on maksamatta {timeInSentence(booking.split.deadline)}, loput veloitetaan kortiltasi.</p>
          </div>
        ) : location && hasVenueMap(location.mapKey) && (
          <VenueMap compact mapKey={location.mapKey} courts={location.courts} states={{ [booking.courtId]: 'mine' }} className="bk-done-map" />
        )}
        <div className="bk-done-actions">
          {match && (
            <Button variant="dark" icon="send" block loading={sending} onClick={sendToOpponent}>
              Lähetä aika: {firstName(match.opponent?.name)}
            </Button>
          )}
          <Button variant={match ? 'outline' : 'dark'} icon="calendar" block onClick={() => downloadBookingIcs(booking, { cancellableUntil: booking.cancellableUntil })}>Lisää kalenteriin</Button>
          {!match && !booking.split && <Button variant="outline" icon="users" block onClick={findPartner}>Etsi pelikaveri tähän vuoroon</Button>}
        </div>
        <p className="bk-fine">
          {config?.demo ? 'Demotila — mitään ei veloitettu.' : 'Kuitti tulee sähköpostiisi.'}
          {!lateBooking && ` Maksuton peruutus ${timeInSentence(booking.cancellableUntil || deadline)} asti.`}
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
          <span className="bk-paybar-price">{centsLabel(payNow(booking))}</span>
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
                  <span><b>Demotila</b> — maksu hyväksytään heti. Oikeassa Krossissa maksat Apple Paylla, Google Paylla{booking.split ? '' : ', MobilePaylla'} tai kortilla.</span>
                </p>
                <Button variant="lime" size="lg" block icon="lock" loading={working} onClick={payDemo}>Maksa {centsLabel(payNow(booking))}</Button>
              </div>
            ) : (
              <Checkout
                config={config}
                createIntent={() => api.booking.createPaymentIntent(booking.id)}
                verify={verify}
                returnPath={`/pelaa/varaa/${encodeURIComponent(venue.slug)}?varaus=${encodeURIComponent(booking.id)}`}
                pendingText="Maksu on vielä kesken. Varaus vahvistuu heti, kun pankki vahvistaa maksun — näet sen Omissa vuoroissa."
                onPaid={() => finish(asPaid(booking))}
              />
            )}
            {booking.split && (
              <p className="bk-paybox-demo">
                <Icon name="lock" size={15} />
                <span>Korttisi tallennetaan Stripeen. Jos kaverien osuuksia on maksamatta {timeInSentence(booking.split.deadline)}, loput veloitetaan siltä — saat siitä kuitin.</span>
              </p>
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
            {chosen.resale && (
              <div><dt>Hinta</dt><dd>{centsLabel(chosen.cents)}<small>Toisen pelaajan myyntiin laittama vuoro, normaalihinta</small></dd></div>
            )}
            <div><dt>Peruutus</dt><dd>{lateBooking ? 'Alle vuorokausi alkuun — ei maksutonta peruutusta' : `Maksuton ${timeInSentence(deadline)} asti`}</dd></div>
          </dl>
        )}

        {chosen && venue.shareDeadlineHours != null && (
          <div className="bk-field">
            <span className="eyebrow">Maksu</span>
            <Segmented ariaLabel="Maksu" options={PAY_OPTIONS} value={payMode} onChange={changePayMode} size="sm" className="bk-pay-modes" />
            {splitting && (splitProblem ? (
              <p className="bk-note"><Icon name="info" size={16} />{splitProblem}</p>
            ) : friends.loading && !friends.data ? (
              <div className="bk-friends" aria-label="Ladataan pelikavereita">{[0, 1, 2, 3].map((i) => <Skeleton key={i} w={64} h={74} r={14} />)}</div>
            ) : friends.error ? (
              <p className="bk-note"><Icon name="alert" size={16} />{friends.error.userMessage || 'Pelikavereita ei voitu ladata.'}</p>
            ) : friendList.length === 0 ? (
              <p className="bk-note"><Icon name="users" size={16} />Sinulla ei ole vielä pelikavereita Krossissa. Maksun voi jakaa, kun olet pelannut tai viestitellyt jonkun kanssa.</p>
            ) : (
              <>
                <span className="bk-pick-hint">{parts === 2 ? 'Kenen kanssa pelaat?' : `Valitse kolme pelikaveria (${picked}/3)`}</span>
                <FriendPicker friends={friendList} max={parts - 1} value={friendIds} onChange={setFriendIds} />
                <dl className="bk-facts">
                  <div><dt>Osuutesi</dt><dd>{centsLabel(shares.ownCents)}<small>Maksat nyt, kortti tallennetaan</small></dd></div>
                  <div><dt>Kaverit</dt><dd>{centsLabel(shares.friendCents)} / pelaaja<small>Maksavat Krossissa {timeInSentence(shareDeadline(startsAt, venue))} mennessä — maksamatta jääneet veloitetaan sinulta</small></dd></div>
                </dl>
              </>
            ))}
          </div>
        )}
      </div>
    );
    let label = 'Valitse kenttä';
    if (chosen && !splitting) label = `Varaa ja maksa ${centsLabel(chosen.cents)}`;
    else if (chosen && splitProblem) label = 'Valitse "Maksan itse"';
    else if (chosen && !ready) label = parts === 2 ? 'Valitse pelikaveri' : `Valitse pelikaverit (${picked}/3)`;
    else if (chosen) label = `Varaa ja maksa osuutesi ${centsLabel(shares.ownCents)}`;
    footer = (
      <div className="stack-2">
        <Button variant="lime" size="lg" block loading={working} disabled={!ready} onClick={hold} icon={working ? undefined : 'lock'}>
          {label}
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

/** 'to 15.10. klo 10.00–11.00' — a message is read later, so no "huomenna". */
const exactWhen = (b) => `${WEEKDAYS_SHORT[new Date(b.startsAt).getDay()]} ${formatDayMonth(b.startsAt)} klo ${formatTime(b.startsAt)}–${formatTime(b.endsAt)}`;

const SURFACES = { massa: 'Massakenttä', kova: 'Kova kenttä', matto: 'Matto', parketti: 'Parketti', tekonurmi: 'Tekonurmi' };
export const surfaceLabel = (surface) => SURFACES[surface] || surface;

/** What the booker pays now: their own part of a split booking, else all of it. */
const payNow = (b) => (b.split ? b.split.ownCents : b.priceCents);

/** 'Mikko sai viestin ja maksaa osuutensa Krossissa.' (names stay in the basic form: no inflection) */
function friendsAsked(split) {
  const names = split.lines.filter((l) => l.kind === 'friend').map((l) => firstName(l.person.name));
  return `${listNames(names)} ${names.length > 1 ? 'saivat viestin ja maksavat' : 'sai viestin ja maksaa'} osuutensa Krossissa.`;
}

/** 'Mikko', 'Mikko ja Laura', 'Mikko, Laura ja Ville' */
function listNames(names) {
  if (names.length < 2) return names[0] || '';
  return `${names.slice(0, -1).join(', ')} ja ${names[names.length - 1]}`;
}

function Summary({ venue, booking, lateBooking, deadline }) {
  const friends = booking.split?.lines.filter((l) => l.kind === 'friend') || [];
  return (
    <dl className="bk-facts">
      <div><dt>Kenttä</dt><dd>{booking.courtName}<small>{booking.locationName}</small></dd></div>
      <div><dt>Aika</dt><dd>{whenLabel(booking.startsAt, booking.endsAt)}</dd></div>
      {booking.split && (
        <div>
          <dt>Osuutesi</dt>
          <dd>{centsLabel(booking.split.ownCents)}<small>Koko vuoro {centsLabel(booking.priceCents)} · {listNames(friends.map((l) => firstName(l.person.name)))} {friends.length > 1 ? 'maksavat' : 'maksaa'} omansa</small></dd>
        </div>
      )}
      <div><dt>Peruutus</dt><dd>{lateBooking ? 'Ei maksutonta peruutusta' : `Maksuton ${timeInSentence(booking.cancellableUntil || deadline)} asti`}</dd></div>
      <div><dt>Paikka</dt><dd>{venue.name}</dd></div>
    </dl>
  );
}
