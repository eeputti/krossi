// BookingScreen — /pelaa/varaa(/:venue): book a court at a hall and pay in the app.
//
// One job, top to bottom: where (the venue's halls as cards — or "Mikä tahansa"), which day, how
// long, and the start times as rows (time, free courts, price). Tap a time; only then the booking
// sheet asks for the court on the hall's floor map (a free court is preselected, so the fastest path
// is time → pay). Everything else is one tap away in a small sheet or its own page instead of text
// on this one: unpaid payments (a row → sheet), my bookings (top bar → Omat varaukset), kausivuoro
// and cards (tiles under the times), the booking terms (a link → sheet). Times that fit the
// player's usual play times carry a lime dot; a full time takes a bell ("Ilmoita kun vapautuu");
// somebody's booking on sale is its own row. Changing the day spins a ball while the times load.
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
  addDays, bookingDays, centsLabel, dateKey, durationLabel, findCourt, fitsAvailability, freeSlots, locationsFor,
  minutesOf, giveBackOf, giveBackText, priceOf, sportsOf,
} from '../../features/booking.js';
import {
  Button, EmptyState, ErrorState, Icon, IconButton, Page, Segmented, Sheet, Skeleton, TennisBall, TopBar, useToast,
} from '../../ui/index.js';
import { BookSheet } from './BookSheet.jsx';
import { BookingExtras } from './BookingExtras.jsx';
import { BookingTermsSheet } from './BookingTerms.jsx';
import { DateStrip, DurationStepper, PlacePicker, TimeRows, UnpaidPayments } from './BookingParts.jsx';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = 'kaikki';

const SHORT_PLACE = { 'Kisapuiston ulkokentät': 'Ulkokentät' };
const shortPlace = (name) => SHORT_PLACE[name] || name;

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
  const [pending, setPending] = useState(null); // a pick waiting for its day to load (a freed watch)
  const [paymentsOpen, setPaymentsOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [settling, setSettling] = useState(false); // the ball spins a moment after a day change, however fast it loads

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
  // Shares waiting for my payment (friends' bookings, a rest my card didn't cover) and failed
  // kausivuoro months: the "Maksamattomat maksut" row.
  const shares = useAsync(() => (venue ? api.booking.listShares() : Promise.resolve([])), [venue?.id]);
  const seasonSlots = useAsync(() => (venue ? api.seasons.listMine().catch(() => []) : Promise.resolve([])), [venue?.id]);
  useResync(() => {
    day.reload({ silent: true }); mine.reload({ silent: true }); watches.reload({ silent: true });
    shares.reload({ silent: true }); seasonSlots.reload({ silent: true });
  });
  useEffect(() => {
    if (!key) return undefined;
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), 450);
    return () => clearTimeout(timer);
  }, [key]);

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
  // How many start times are still free per place on the day (the place cards say it).
  const freeTimes = useMemo(() => {
    if (!venue || !key || !day.data) return {};
    const count = (loc) => freeSlots(venue, key, busy, { sport, locationId: loc, minutes, now }).filter((s) => s.options.length).length;
    return Object.fromEntries([[ALL, count(null)], ...places.map((l) => [l.id, count(l.id)])]);
  }, [venue, key, day.data, busy, sport, places, minutes, now]);

  const refresh = () => {
    day.reload({ silent: true });
    mine.reload({ silent: true });
    watches.reload({ silent: true });
    shares.reload({ silent: true });
    seasonSlots.reload({ silent: true });
  };

  // A freed-watch pick opens once its day's calendar has loaded.
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
          <div className="bk-skel-places">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={62} r={16} />)}</div>
          <div className="bk-skel-row">{[0, 1, 2, 3, 4].map((i) => <Skeleton key={i} h={68} r={16} />)}</div>
          <div className="bk-skel-rows">{Array.from({ length: 6 }, (_, i) => <Skeleton key={i} h={52} r={14} />)}</div>
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
  const freed = (watches.data || []).filter((w) => w.notifiedAt);
  const owed = (shares.data || []).filter((s) => s.payable);
  const failedMonths = (seasonSlots.data || [])
    .filter((slot) => slot.venueId === venue.id && slot.status === 'active')
    .flatMap((slot) => slot.charges.filter((c) => c.status === 'failed').map((c) => ({ ...c, slot })));
  const unpaidCents = owed.reduce((n, s) => n + s.cents, 0) + failedMonths.reduce((n, c) => n + c.amountCents, 0);
  // Somebody else's booking on sale today: bookable at exactly its time and length (the rule of
  // krossi_hold_booking), so they get their own list whatever length the stepper shows.
  const forSale = busy
    .filter((b) => b.forSale && !b.mine && Date.parse(b.startsAt) > now)
    .map((b) => {
      const found = findCourt(venue, b.courtId);
      const length = Math.round((Date.parse(b.endsAt) - Date.parse(b.startsAt)) / 60_000);
      return found && found.court.sport === sport && venue.durations.includes(length) && (!locationId || found.location.id === locationId)
        ? { ...b, ...found, minutes: length, cents: priceOf(venue, found.court, b.startsAt, length) }
        : null;
    })
    .filter((b) => b && b.cents != null);

  const fits = (startsAt) => fitsAvailability(profile?.availability, startsAt);
  // A new day: the ball spins until its times are in (and a moment more, so the change shows).
  const loadingDay = settling || (day.loading && day.data?.date !== key);

  let results;
  if (loadingDay) {
    results = (
      <div className="bk-loading" role="status" aria-label="Haetaan vapaita aikoja">
        <TennisBall size={30} motion="spin" />
      </div>
    );
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
        <TimeRows
          slots={slots}
          sales={forSale}
          onPick={(slot) => openPick({ startsAt: slot.startsAt, courtId: null, locationId })}
          onPickSale={(b) => openPick({ startsAt: b.startsAt, courtId: b.courtId, locationId: b.location.id, minutes: b.minutes })}
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
        title={venue.name}
        back="/pelaa/pelit"
        actions={(
          <>
            {upcoming.length > 0 && (
              <IconButton icon="calendar" label={`Omat vuorot (${upcoming.length})`} onClick={() => navigate('/pelaa/omat-varaukset')} />
            )}
            {venue.isStaff && (
              <IconButton icon="grid" label="Hallin näkymä" onClick={() => navigate(`/pelaa/halli/${encodeURIComponent(venue.slug)}`)} />
            )}
          </>
        )}
      />
      <Page className="bk-page">
        {unpaidCents > 0 && (
          <button type="button" className="bk-unpaid-row" onClick={() => setPaymentsOpen(true)}>
            <span className="bk-unpaid-icon" aria-hidden="true"><Icon name="alert" size={18} strokeWidth={2.4} /></span>
            <span className="bk-unpaid-title">Maksamattomat maksut</span>
            <span className="bk-unpaid-total t-num">{centsLabel(unpaidCents)}</span>
            <Icon name="chevron-right" size={18} />
          </button>
        )}
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

        {match.data && (
          <div className="bk-match" role="note">
            <span className="bk-match-icon" aria-hidden="true"><Icon name="trophy" size={18} /></span>
            <span className="bk-match-text">
              <b>{match.data.leagueName}: ottelu vs. {firstName(match.data.opponent?.name)}</b>
              Varaa kenttä, niin voit lähettää ajan vastustajallesi yhdellä napautuksella.
            </span>
          </div>
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
          {places.length > 1 && (
            <PlacePicker
              places={places}
              value={locationId}
              onChange={(id) => setPlace(id || ALL)}
              freeTimes={freeTimes}
              loading={loadingDay}
              shortName={shortPlace}
              all={ALL}
            />
          )}
          <DateStrip days={days} value={key} onChange={setDayKey} />
          <DurationStepper value={minutes} options={venue.durations} onChange={setLength} className="bk-stepper-wide" />
        </section>

        {results}

        <BookingExtras venue={venue} refreshKey={mine.data} showFailed={false} />

        <button type="button" className="bk-terms-link" onClick={() => setTermsOpen(true)}>Varausehdot</button>
      </Page>

      <Sheet open={paymentsOpen} onClose={() => setPaymentsOpen(false)} size="sm" title="Maksamattomat maksut">
        <UnpaidPayments
          shares={owed}
          months={failedMonths}
          now={new Date(now)}
          onOpen={(share) => { setPaymentsOpen(false); navigate(`/pelaa/osuus/${encodeURIComponent(share.id)}`); }}
          onOpenMonth={() => { setPaymentsOpen(false); navigate('/pelaa/omat-varaukset'); }}
        />
      </Sheet>
      <BookingTermsSheet open={termsOpen} onClose={() => setTermsOpen(false)} venue={venue} />
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
    </>
  );
}
