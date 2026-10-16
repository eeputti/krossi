// BookingScreen — /pelaa/varaa(/:venue): book a court at a hall and pay in the app.
//
// Time first, court second — always. Pick the day and the length, tap a start time; only then
// the booking sheet asks for the court, on the hall's floor map (a free court is preselected, so
// the fastest path is time → pay). Start times show the price and how many courts are free, so
// nobody has to scan a calendar grid (learned from Thril). The floor map shows *where* the court
// is — Krossi's own idea, neither Cintoia nor Thril has it. My upcoming bookings sit on top.
//
// Better than both: "Ilmoita kun vapautuu" on a full time (a bell), "Sama vuoro ensi viikolla" in
// one tap, the player's own play times marked, last-minute deals on empty courts and the weather
// for outdoor courts. Jaettu maksu with pelikaverit (BookSheet) and "Laita myyntiin" for a
// booking past its free cancellation (MyBookingSheet): what others put on sale is listed for the
// day, and shares waiting for my payment sit on top.
//
// From a hallisarja fixture (?liiga=<leagueId>&ottelu=<fixtureId>) the page says whose match it
// is, and after paying the booking sheet sends the time to the opponent's chat in one tap.
//
// Redirect payment methods (MobilePay on a phone) come back here with
// ?varaus=<bookingId>&payment_intent=…; that is confirmed below and the query is dropped.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useLocalState, useNow, useResync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { firstName, formatGameTime, formatTime } from '../../lib/format.js';
import {
  addDays, bookingDays, centsLabel, dateKey, durationLabel, findCourt, fitsAvailability, freeSlots, localDate, locationsFor,
  minutesOf, giveBackOf, giveBackText, priceOf, sportsOf,
} from '../../features/booking.js';
import {
  Avatar, Button, ChipSelect, EmptyState, ErrorState, Icon, IconButton, Page, Segmented, Skeleton, TopBar, useToast,
} from '../../ui/index.js';
import { BookSheet } from './BookSheet.jsx';
import { BookingExtras } from './BookingExtras.jsx';
import { MyBookingSheet } from './MyBookingSheet.jsx';
import { DateStrip, DurationStepper, MyBookingCard, TimeTiles, whenLabel } from './BookingParts.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = 'kaikki';

const SHORT_PLACE = { 'Kisapuiston ulkokentät': 'Ulkokentät' };
const shortPlace = (name) => SHORT_PLACE[name] || name;

/** The same local clock time `days` later, as ISO (DST-safe). */
function sameTimeLater(iso, days) {
  const d = new Date(iso);
  return localDate(addDays(dateKey(d), days), d.getHours() * 60 + d.getMinutes()).toISOString();
}

const sameWatch = (w, { sport, startsAt, minutes, locationId }) => w.sport === sport && w.startsAt === startsAt
  && w.minutes === minutes && (w.locationId || null) === (locationId || null);

/** Today, or tomorrow once today's last bookable start has passed. */
function firstDay(venue, now = new Date()) {
  const today = dateKey(now);
  const lastStart = minutesOf(venue.openUntil) - Math.min(...venue.durations);
  return now.getHours() * 60 + now.getMinutes() >= lastStart ? addDays(today, 1) : today;
}

export function BookingScreen({ params, query }) {
  const toast = useToast();
  const { profile, user } = useSession();
  const now = useNow(60_000);
  const venues = useAsync(() => api.booking.listVenues(), []);
  const venue = useMemo(() => {
    const list = venues.data || [];
    return (params?.venue && list.find((v) => v.slug === params.venue || v.id === params.venue)) || list[0] || null;
  }, [venues.data, params?.venue]);

  const [prefs, setPrefs] = useLocalState('krossi_booking_prefs', { sport: 'tennis' });
  const [length, setLength] = useState(60); // Kesto starts at 1 h on every visit
  const [dayKey, setDayKey] = useState(null);
  const [place, setPlace] = useState(ALL);
  const [pick, setPick] = useState(null); // { startsAt, courtId, locationId } for BookSheet
  const [bookOpen, setBookOpen] = useState(false);
  const [openBooking, setOpenBooking] = useState(null);
  const [pending, setPending] = useState(null); // a pick waiting for its day to load (rebook, freed watch)

  const sports = useMemo(() => (venue ? sportsOf(venue) : []), [venue]);
  const sport = sports.some((s) => s.value === prefs.sport) ? prefs.sport : sports[0]?.value || 'tennis';
  const minutes = venue?.durations.includes(length) ? length : venue?.durations[0] || 60;
  const places = useMemo(() => (venue ? locationsFor(venue, sport) : []), [venue, sport]);
  const locationId = places.some((l) => l.id === place) ? place : null;
  const days = useMemo(() => (venue ? bookingDays(venue, new Date(now)) : []), [venue, now]);
  const key = dayKey && days.includes(dayKey) ? dayKey : venue ? firstDay(venue, new Date(now)) : null;

  const day = useAsync(() => (venue && key ? api.booking.day(venue.id, key) : Promise.resolve(null)), [venue?.id, key]);
  // Only once a hall is visible: before the booking tables exist the list is just empty.
  const mine = useAsync(() => (venue ? api.booking.listMine() : Promise.resolve(null)), [venue?.id]);
  // Booking for a hallisarja match: who the opponent is (the sheet sends them the time).
  const match = useAsync(async () => {
    if (!query?.liiga || !query?.ottelu) return null;
    const league = await api.leagues.get(query.liiga);
    const fixture = league?.fixtures?.find((f) => f.id === query.ottelu);
    if (!fixture) return null;
    const opponent = fixture.playerA?.id === user?.id ? fixture.playerB : fixture.playerA;
    return { leagueId: league.id, leagueName: league.seasonLabel, fixtureId: fixture.id, opponent };
  }, [query?.liiga, query?.ottelu, user?.id]);
  const watches = useAsync(() => (venue ? api.booking.listWatches() : Promise.resolve([])), [venue?.id]);
  // Shares waiting for my payment: friends' bookings, and a rest my card didn't cover.
  const shares = useAsync(() => (venue ? api.booking.listShares() : Promise.resolve([])), [venue?.id]);
  useResync(() => { day.reload({ silent: true }); mine.reload({ silent: true }); watches.reload({ silent: true }); shares.reload({ silent: true }); });

  // While a booking of mine is on sale, or friends still owe their shares, look now and then:
  // who has paid shows up, and when somebody books my on-sale slot, say so.
  const onSale = (mine.data?.upcoming || []).filter((b) => b.forSale).map((b) => b.id).join();
  const owing = (mine.data?.upcoming || []).some((b) => b.split?.lines.some((l) => l.kind === 'friend' && l.status === 'pending'));
  const listedRef = useRef(new Set());
  useEffect(() => {
    if (!onSale && !owing) return undefined;
    const timer = setInterval(() => { mine.reload({ silent: true }); if (onSale) day.reload({ silent: true }); }, 15_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onSale, owing]);
  useEffect(() => {
    const listed = listedRef.current;
    for (const b of mine.data?.past || []) {
      if (b.soldAt && listed.has(b.id)) {
        listed.delete(b.id);
        const back = giveBackText(giveBackOf(b));
        toast(`Vuorosi myytiin. ${back ? `${back}.` : 'Mitään ei veloitettu.'}`, { icon: 'check', duration: 6000 });
      }
    }
    for (const b of mine.data?.upcoming || []) if (b.forSale) listed.add(b.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data]);

  // While a bell is waiting, look again now and then: a freed court shows up without a reload.
  const waiting = (watches.data || []).some((w) => !w.notifiedAt);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => { watches.reload({ silent: true }); day.reload({ silent: true }); }, 20_000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting]);

  const busy = useMemo(() => day.data?.busy || [], [day.data]);
  const slots = useMemo(
    () => (venue && key ? freeSlots(venue, key, busy, { sport, locationId, minutes, now, includeFull: true }) : []),
    [venue, key, busy, sport, locationId, minutes, now],
  );
  const freeCount = slots.filter((s) => s.options.length).length;

  const refresh = () => {
    day.reload({ silent: true });
    mine.reload({ silent: true });
    watches.reload({ silent: true });
    shares.reload({ silent: true });
  };

  // A rebook / freed-watch pick opens once its day's calendar has loaded.
  useEffect(() => {
    if (!pending || day.loading || day.data?.date !== pending.key) return;
    setPick(pending);
    setBookOpen(true);
    setPending(null);
  }, [pending, day.loading, day.data?.date]);

  /** Jump to a time on another day (or this one) and open the booking sheet there. */
  const goTo = ({ startsAt, courtId = null, locationId: loc = null, sport: wantSport, minutes: wantMinutes }) => {
    if (wantSport) setPrefs((p) => ({ ...p, sport: wantSport }));
    if (wantMinutes && venue?.durations.includes(wantMinutes)) setLength(wantMinutes);
    const target = dateKey(new Date(startsAt));
    setDayKey(target);
    setPending({ key: target, startsAt, courtId, locationId: loc, minutes: wantMinutes });
  };

  const toggleWatch = async (slot) => {
    const want = { sport, startsAt: slot.startsAt, minutes, locationId };
    const existing = (watches.data || []).find((w) => sameWatch(w, want));
    try {
      if (existing) {
        await api.booking.unwatch(existing.id);
        toast('Ilmoitus poistettu.');
      } else {
        await api.booking.watch({ venueId: venue.id, ...want });
        toast(`Ilmoitamme, jos klo ${formatTime(slot.startsAt)} vapautuu.`, { icon: 'bell', duration: 4200 });
      }
      watches.reload({ silent: true });
    } catch (err) {
      toast(err);
      if (err?.code === 'free') day.reload({ silent: true });
    }
  };

  // ── Coming back from a redirect payment (MobilePay on a phone) ──
  const handledReturn = useRef(false);
  useEffect(() => {
    const { varaus, payment_intent: intentId, redirect_status: redirectStatus } = query || {};
    if (!varaus || handledReturn.current || !venue) return;
    handledReturn.current = true;
    (async () => {
      if (redirectStatus === 'failed') {
        toast('Maksu ei mennyt läpi — mitään ei veloitettu. Valitse aika uudelleen.', { tone: 'error', duration: 6000 });
      } else if (intentId) {
        try {
          for (let tries = 0; tries < 8; tries += 1) {
            const result = await api.booking.verifyPayment(varaus, intentId);
            if (result.confirmed) { toast('Kenttä varattu. Kuitti tulee sähköpostiisi.', { icon: 'check', duration: 4200 }); break; }
            if (result.status === 'lost') { toast(result.message || 'Aika ehti mennä toiselle — maksu palautettiin.', { tone: 'error', duration: 7000 }); break; }
            if (result.status !== 'processing') { toast('Maksu ei mennyt läpi — mitään ei veloitettu.', { tone: 'error' }); break; }
            await sleep(1500);
          }
        } catch (err) {
          toast(err);
        }
      }
      refresh();
      // Drop the query: it carries Stripe's client secret.
      navigate(`/pelaa/varaa/${encodeURIComponent(venue.slug)}`, { replace: true });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query?.varaus, venue?.id]);

  const openPick = (next) => { setPick(next); setBookOpen(true); };

  // ── The venue itself: loading / failed / none visible yet ──
  if (venues.loading && !venues.data) {
    return (
      <>
        <TopBar title="Varaa kenttä" back="/pelaa/pelit" />
        <Page className="bk-page">
          <Skeleton h={150} r={24} />
          <div className="bk-skel-row">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={68} r={16} />)}</div>
          <div className="bk-skel-grid">{Array.from({ length: 9 }, (_, i) => <Skeleton key={i} h={78} r={16} />)}</div>
        </Page>
      </>
    );
  }
  if (venues.error && !venues.data) {
    return (
      <>
        <TopBar title="Varaa kenttä" back="/pelaa/pelit" />
        <Page><ErrorState error={venues.error} onRetry={() => venues.reload()} /></Page>
      </>
    );
  }
  if (!venue) {
    return (
      <>
        <TopBar title="Varaa kenttä" back="/pelaa/pelit" />
        <Page>
          <EmptyState
            art="court"
            title="Kenttävaraus on tulossa"
            text="Pian varaat hallien vuorot ja maksat suoraan Krossissa. Kerromme, kun ensimmäinen halli aukeaa."
            action={<Button variant="dark" onClick={() => navigate('/pelaa/pelit')}>Takaisin peleihin</Button>}
          />
        </Page>
      </>
    );
  }

  const upcoming = mine.data?.upcoming || [];
  // The open booking follows the latest data (a friend paid, it sold) instead of the tapped snapshot.
  const shownBooking = openBooking
    && ([...upcoming, ...(mine.data?.past || [])].find((b) => b.id === openBooking.id) || openBooking);
  const freed = (watches.data || []).filter((w) => w.notifiedAt);
  const owed = (shares.data || []).filter((s) => s.payable);
  const lastDay = days[days.length - 1];
  // Somebody else's booking on sale today: bookable at exactly its time and length (the rule of
  // krossi_hold_booking), so they get their own list whatever length the stepper shows.
  const forSale = busy
    .filter((b) => b.forSale && !b.mine && Date.parse(b.startsAt) > now)
    .map((b) => {
      const found = findCourt(venue, b.courtId);
      const length = Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000);
      return found && found.court.sport === sport && venue.durations.includes(length)
        ? { ...b, ...found, minutes: length, cents: priceOf(venue, found.court, b.startsAt, length) }
        : null;
    })
    .filter((b) => b && b.cents != null);

  // "Sama vuoro ensi viikolla?": my latest played booking, one week on, if that day can be booked.
  const lastPlayed = (mine.data?.past || []).find((b) => b.status === 'confirmed' && Date.parse(b.endsAt) < now);
  let rebook = null;
  if (lastPlayed) {
    let next = sameTimeLater(lastPlayed.startsAt, 7);
    while (Date.parse(next) < now + 30 * 60_000) next = sameTimeLater(next, 7);
    const length = Math.round((Date.parse(lastPlayed.endsAt) - Date.parse(lastPlayed.startsAt)) / 60_000);
    const taken = upcoming.some((b) => b.startsAt === next);
    if (!taken && dateKey(new Date(next)) <= lastDay) rebook = { booking: lastPlayed, startsAt: next, minutes: length };
  }
  const fits = (startsAt) => fitsAvailability(profile?.availability, startsAt);
  const anyFits = slots.some((s) => s.options.length && fits(s.startsAt));
  const courtsTotal = venue.locations.reduce((n, l) => n + l.courts.filter((c) => c.sport === sport).length, 0);
  const sportName = sports.find((s) => s.value === sport)?.label.toLowerCase() || 'tennis';

  let results;
  if (day.loading && !day.data) {
    results = <div className="bk-skel-grid" aria-label="Ladataan vapaita aikoja">{Array.from({ length: 12 }, (_, i) => <Skeleton key={i} h={78} r={16} />)}</div>;
  } else if (day.error && !day.data) {
    results = <ErrorState error={day.error} onRetry={() => day.reload()} />;
  } else if (freeCount === 0 && slots.length === 0) {
    results = (
      <EmptyState
        compact
        art="calendar"
        title="Ei vapaita aikoja tälle päivälle"
        text={`Kaikki ${durationLabel(minutes)} vuorot on viety. Kokeile toista päivää tai lyhyempää vuoroa.`}
        action={days.indexOf(key) < days.length - 1 ? (
          <Button variant="dark" iconRight="chevron-right" onClick={() => setDayKey(addDays(key, 1))}>Seuraava päivä</Button>
        ) : null}
      />
    );
  } else {
    results = (
      <>
        {freeCount === 0 && (
          <p className="bk-note"><Icon name="bell" size={16} />Kaikki vuorot on viety. Napauta aikaa, niin ilmoitamme heti, jos joku peruu.</p>
        )}
        {anyFits && (
          <p className="bk-legend"><span className="bk-time-yours" aria-hidden="true" />Sopii tavallisiin peliaikoihisi</p>
        )}
        <TimeTiles
          slots={slots}
          onPick={(slot) => openPick({ startsAt: slot.startsAt, courtId: null, locationId })}
          onWatch={toggleWatch}
          watched={(startsAt) => (watches.data || []).some((w) => sameWatch(w, { sport, startsAt, minutes, locationId }))}
          fits={fits}
        />
      </>
    );
  }

  return (
    <>
      <TopBar
        title="Varaa kenttä"
        back="/pelaa/pelit"
        actions={venue.isStaff ? (
          <Button variant="soft" size="sm" icon="grid" onClick={() => navigate(`/pelaa/halli/${encodeURIComponent(venue.slug)}`)}>Hallin näkymä</Button>
        ) : null}
      />
      <Page className="bk-page">
        <header className="bk-hero court-lines">
          <span className="eyebrow bk-hero-eyebrow">Kenttävaraus · {venue.city}</span>
          <h1 className="bk-hero-title">{venue.name}</h1>
          <p className="bk-hero-sub">{venue.locations.map((l) => l.name).join(' · ')}</p>
          <div className="bk-hero-facts">
            <span><Icon name="court" size={15} />{courtsTotal} {sportName}kenttää</span>
            <span><Icon name="bolt" size={15} />Maksu heti</span>
            <span><Icon name="undo" size={15} />Peru {venue.cancelLimitHours} h ennen</span>
          </div>
        </header>

        {owed.map((s) => (
          <button key={s.id} type="button" className="bk-owe rise" onClick={() => navigate(`/pelaa/osuus/${encodeURIComponent(s.id)}`)}>
            {s.kind === 'rest'
              ? <span className="bk-owe-icon" aria-hidden="true"><Icon name="alert" size={18} strokeWidth={2.4} /></span>
              : <Avatar person={s.booker} size={38} />}
            <span className="bk-owe-text">
              <b>{s.kind === 'rest' ? `Loppuosuus maksamatta: ${centsLabel(s.cents)}` : `${firstName(s.booker.name)} pyytää osuuttasi: ${centsLabel(s.cents)}`}</b>
              <span className="truncate">{whenLabel(s.booking.startsAt, s.booking.endsAt)} · {s.booking.courtName}, {s.booking.locationName}</span>
            </span>
            <span className="bk-owe-cta">Maksa</span>
          </button>
        ))}
        <BookingExtras venue={venue} refreshKey={mine.data} />

        {freed.map((w) => (
          <div key={w.id} className="bk-freed rise" role="status">
            <span className="bk-freed-icon" aria-hidden="true"><Icon name="bell" size={18} strokeWidth={2.4} /></span>
            <span className="bk-freed-text">
              <b>Vuoro vapautui!</b> {formatGameTime(w.startsAt)} — varaa ennen muita.
            </span>
            <Button variant="lime" size="sm" onClick={() => goTo({ startsAt: w.startsAt, locationId: w.locationId, sport: w.sport, minutes: w.minutes })}>Varaa</Button>
            <IconButton icon="close" label="Poista ilmoitus" variant="ghost" onClick={async () => {
              try { await api.booking.unwatch(w.id); watches.reload({ silent: true }); } catch (err) { toast(err); }
            }} />
          </div>
        ))}

        {rebook && (
          <button
            type="button"
            className="bk-rebook"
            onClick={() => goTo({ startsAt: rebook.startsAt, courtId: rebook.booking.courtId, sport: rebook.booking.sport, minutes: rebook.minutes })}
          >
            <span className="bk-rebook-icon" aria-hidden="true"><Icon name="repeat" size={20} strokeWidth={2.4} /></span>
            <span className="bk-rebook-text">
              <span className="bk-rebook-title">Sama vuoro uudestaan?</span>
              <span className="bk-rebook-sub">{formatGameTime(rebook.startsAt)} · {rebook.booking.courtName}, {rebook.booking.locationName}</span>
            </span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}

        {match.data && (
          <div className="bk-match" role="note">
            <span className="bk-match-icon" aria-hidden="true"><Icon name="trophy" size={18} /></span>
            <span className="bk-match-text">
              <b>{match.data.leagueName}: ottelu vs. {firstName(match.data.opponent?.name)}</b>
              Varaa kenttä, niin voit lähettää ajan vastustajallesi yhdellä napautuksella.
            </span>
          </div>
        )}

        {upcoming.length > 0 && (
          <section className="bk-section" aria-label="Omat vuorot">
            <h2 className="bk-h">Omat vuorot</h2>
            <div className="bk-mine-strip">
              {upcoming.map((b) => <MyBookingCard key={b.id} booking={b} now={now} onOpen={setOpenBooking} />)}
            </div>
          </section>
        )}

        <section className="bk-controls" aria-label="Valitse aika">
          {sports.length > 1 && (
            <Segmented
              ariaLabel="Laji"
              options={sports.map((s) => ({ value: s.value, label: s.label }))}
              value={sport}
              onChange={(v) => { setPrefs((p) => ({ ...p, sport: v })); setPlace(ALL); }}
              className="bk-sports"
            />
          )}
          <DateStrip days={days} value={key} onChange={setDayKey} />
          <div className="bk-filters">
            <div className="bk-length-row">
              <span className="bk-length-label">Kesto</span>
              <DurationStepper value={minutes} options={venue.durations} onChange={setLength} />
            </div>
            {places.length > 1 && (
              <ChipSelect
                ariaLabel="Paikka"
                size="sm"
                layout="scroll"
                options={[{ value: ALL, label: 'Kaikki' }, ...places.map((l) => ({ value: l.id, label: shortPlace(l.name) }))]}
                value={locationId || ALL}
                onChange={(v) => setPlace(v || ALL)}
              />
            )}
          </div>
        </section>

        {forSale.length > 0 && (
          <section className="bk-section" aria-label="Myynnissä">
            <h2 className="bk-h">Myynnissä tänä päivänä</h2>
            <div className="bk-sales">
              {forSale.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  className="bk-sale"
                  onClick={() => openPick({ startsAt: b.startsAt, courtId: b.courtId, locationId: b.location.id, minutes: b.minutes })}
                >
                  <span className="bk-sale-clock t-num">{formatTime(b.startsAt)}–{formatTime(b.endsAt)}</span>
                  <span className="bk-sale-place truncate">{b.court.name} · {b.location.name}</span>
                  <span className="bk-sale-price t-num">{centsLabel(b.cents)}</span>
                  <Icon name="chevron-right" size={18} />
                </button>
              ))}
            </div>
            <p className="bk-fine">Pelaaja ei pääse vuoroonsa ja myy sen eteenpäin. Varaat sen sellaisenaan, normaalihintaan.</p>
          </section>
        )}

        {results}

        <p className="bk-fine bk-fine-center bk-page-foot">
          Hinnat sisältävät ALV:n. Maksuton peruutus {venue.cancelLimitHours} h ennen vuoron alkua — rahat palautuvat maksutavallesi.
        </p>
      </Page>

      <BookSheet
        open={bookOpen && Boolean(pick)}
        onClose={() => setBookOpen(false)}
        venue={venue}
        busy={busy}
        sport={sport}
        startsAt={pick?.startsAt}
        minutes={pick?.minutes || minutes}
        courtId={pick?.courtId}
        locationId={pick?.locationId || locationId}
        onBooked={refresh}
        onChanged={refresh}
        match={match.data || null}
      />
      <MyBookingSheet
        open={Boolean(openBooking)}
        booking={shownBooking}
        venue={venue}
        onClose={() => setOpenBooking(null)}
        onChanged={refresh}
        onRebook={(b) => {
          setOpenBooking(null);
          const length = Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000);
          const next = sameTimeLater(b.startsAt, 7);
          if (dateKey(new Date(next)) > lastDay) { toast(`Vuoroja voi varata ${venue.daysAhead} päivän päähän.`, { tone: 'info' }); return; }
          goTo({ startsAt: next, courtId: b.courtId, sport: b.sport, minutes: length });
        }}
      />
    </>
  );
}
