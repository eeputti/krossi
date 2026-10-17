// BookingScreen — /pelaa/varaa(/:venue): book a court at a hall and pay in the app.
//
// One job, top to bottom: where (the venue's halls as cards — or "Mikä tahansa"), which day, how
// long, and the start times as rows (time, free courts, price). Tap a time; only then the booking
// sheet asks for the court on the hall's floor map (a free court is preselected, so the fastest path
// is time → pay). Everything else is one tap away in a small sheet or its own page instead of text
// on this one: an unpaid kausivuoro month (a row → sheet), my bookings, kausivuorot and cards (the
// top bar's calendar → Omat varaukset), the booking terms (a link → sheet). Times that fit the
// player's usual play times carry a lime dot; a full time takes a bell ("Ilmoita kun vapautuu");
// somebody's booking on sale is its own row. Changing the day spins a ball while the times load.
//
// Booking for somebody: a hallisarja fixture (?liiga=<leagueId>&ottelu=<fixtureId>), a game
// (?peli=<gameId>, "Varaa kenttä tälle pelille") or a chat (?chat=<conversationId>). The page says
// who the court is for, and after paying the booking sheet sends the time to their chat in one tap.
// A game's day is picked for the player and, if a court is free when the game starts, the sheet
// opens at that time; a game I already have a court for says so instead.
//
// Redirect payment methods (MobilePay on a phone) come back here with
// ?varaus=<bookingId>&payment_intent=…; that is confirmed below and the query is dropped.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api, isDemo } from '../../api/index.js';
import { useAsync, useLocalState, useNow, useResync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { useSession } from '../../app/session.jsx';
import { firstName, formatGameTime, formatTime } from '../../lib/format.js';
import {
  addDays, bookingDays, bookingForGame, centsLabel, dateKey, durationLabel, findCourt, fitsAvailability, freeSlots, locationsFor,
  minutesOf, giveBackOf, giveBackText, priceOf, sportsOf,
} from '../../features/booking.js';
import {
  Button, EmptyState, ErrorState, Icon, IconButton, Page, Segmented, Sheet, Skeleton, TennisBall, TopBar, useToast,
} from '../../ui/index.js';
import { BookSheet } from './BookSheet.jsx';
import { BookingTermsSheet } from './BookingTerms.jsx';
import { DateStrip, DurationStepper, PlacePicker, TimeRows, UnpaidPayments } from './BookingParts.jsx';
import { gameTitle } from '../games/gameUtils.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ALL = 'kaikki';

const SHORT_PLACE = { 'Kisapuiston ulkokentät': 'Ulkokentät' };
const shortPlace = (name) => SHORT_PLACE[name] || name;
const squash = (s) => String(s || '').toLocaleLowerCase('fi').replace(/[^a-z0-9åäö]/g, '');

const sameWatch = (w, { sport, startsAt, minutes, locationId }) => w.sport === sport && w.startsAt === startsAt
  && w.minutes === minutes && (w.locationId || null) === (locationId || null);

/** Today, or tomorrow once today's last bookable start has passed. */
function firstDay(venue, now = new Date()) {
  const today = dateKey(now);
  const lastStart = minutesOf(venue.openUntil) - Math.min(...venue.durations);
  return now.getHours() * 60 + now.getMinutes() >= lastStart ? addDays(today, 1) : today;
}

export function BookingScreen({ params, query, route }) {
  // The Varaa tab's root has no back arrow; a venue page, or a booking opened from a game or a chat, does.
  const back = route?.name === 'booking' && !query?.peli && !query?.chat ? false : route?.name === 'bookingVenue' ? '/pelaa/varaa' : '/pelaa/koti';
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
  // Booking for somebody (a hallisarja match, a game, a chat): who it is for and where the sheet
  // sends the time once the court is paid.
  const target = useAsync(() => bookingTarget(query, user?.id), [query?.liiga, query?.ottelu, query?.peli, query?.chat, user?.id]);
  const watches = useAsync(() => (venue ? api.booking.listWatches() : Promise.resolve([])), [venue?.id]);
  // Failed kausivuoro months: the payments row on top.
  const seasonSlots = useAsync(() => (venue ? api.seasons.listMine().catch(() => []) : Promise.resolve([])), [venue?.id]);
  useResync(() => {
    day.reload({ silent: true }); mine.reload({ silent: true }); watches.reload({ silent: true });
    seasonSlots.reload({ silent: true });
  });
  useEffect(() => {
    if (!key) return undefined;
    setSettling(true);
    const timer = setTimeout(() => setSettling(false), 450);
    return () => clearTimeout(timer);
  }, [key]);

  // While a booking of mine is on sale, or friends still have parts to pay, look now and then:
  // a friend's payment shows up (and is said out loud), and so does somebody booking my on-sale slot.
  const onSale = (mine.data?.upcoming || []).filter((b) => b.forSale).map((b) => b.id).join();
  const owing = (mine.data?.upcoming || []).some((b) => b.split?.lines.some((l) => l.kind === 'friend' && (l.status === 'open' || l.status === 'pending')));
  const listedRef = useRef(new Set());
  const paidPartsRef = useRef(null); // friend part ids already paid when last looked
  useEffect(() => {
    if (!onSale && !owing) return undefined;
    const timer = setInterval(() => { mine.reload({ silent: true }); if (onSale) day.reload({ silent: true }); }, isDemo ? 3_000 : 15_000);
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
    // A friend paid their part: the same sum went back to me.
    const paidNow = new Map();
    for (const b of mine.data?.upcoming || []) {
      for (const l of b.split?.lines || []) if (l.kind === 'friend' && l.status === 'paid' && l.id) paidNow.set(l.id, l);
    }
    if (paidPartsRef.current) {
      for (const [id, l] of paidNow) {
        if (paidPartsRef.current.has(id)) continue;
        const who = l.person ? firstName(l.person.name) : l.name || 'Kaveri';
        toast(`${who} maksoi osuutensa ${centsLabel(l.cents)} — summa palautetaan sinulle.`, { icon: 'check', duration: 5000 });
      }
    }
    if (mine.data) paidPartsRef.current = new Set(paidNow.keys());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine.data]);

  // While a bell is waiting, look again now and then: a freed court shows up without a reload.
  // The demo frees a court within half a minute and asks nothing from a server, so it looks often.
  const waiting = (watches.data || []).some((w) => !w.notifiedAt);
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => { watches.reload({ silent: true }); day.reload({ silent: true }); }, isDemo ? 3_000 : 20_000);
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

  // A game's court: go to the game's day, then open the sheet at the game's start (the grid start
  // just before it when the game is at, say, 18.15). Once per game; not when I already have its
  // court. A full time just says so: a court starting earlier or later isn't this game's court.
  const game = target.data?.kind === 'game' ? target.data.game : null;
  const already = game ? bookingForGame(mine.data?.upcoming, game) : null;
  const presetFor = useRef(null);
  const [aim, setAim] = useState(null);
  useEffect(() => {
    if (!venue || !game?.scheduledAt || !mine.data || presetFor.current === game.id) return;
    presetFor.current = game.id;
    if (already || Date.parse(game.scheduledAt) <= Date.now()) return;
    const want = dateKey(new Date(game.scheduledAt));
    if (!days.includes(want)) { toast(`Vuoroja voi varata ${venue.daysAhead} päivän päähän.`, { tone: 'info' }); return; }
    setDayKey(want);
    setAim(game.scheduledAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue?.id, game?.id, mine.data]);
  useEffect(() => {
    if (!aim || settling || day.loading || day.data?.date !== dateKey(new Date(aim))) return;
    setAim(null);
    const t = Date.parse(aim);
    const start = slots.filter((slot) => Date.parse(slot.startsAt) <= t && t - Date.parse(slot.startsAt) < 30 * 60_000).pop();
    // The game's own hall first when its place names one of the venue's (Kispi Areena = Kispi-Areena).
    const at = venue.locations.find((l) => squash(l.name) === squash(game?.locationName));
    if (start?.options.length) openPick({ startsAt: start.startsAt, courtId: null, locationId: at?.id || locationId });
    else toast(`Klo ${formatTime(aim)} kentät on varattu — valitse toinen aika.`, { tone: 'info', duration: 4200 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aim, settling, day.loading, day.data, slots]);

  // ── The venue itself: loading / failed / none visible yet ──
  if (venues.loading && !venues.data) {
    return (
      <>
        <TopBar title="Varaa kenttä" back={back} />
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
        <TopBar title="Varaa kenttä" back={back} />
        <Page><ErrorState error={venues.error} onRetry={() => venues.reload()} /></Page>
      </>
    );
  }
  if (!venue) {
    return (
      <>
        <TopBar title="Varaa kenttä" back={back} />
        <Page>
          <EmptyState
            art="court"
            title="Kenttävaraus on tulossa"
            text="Pian varaat hallien vuorot ja maksat suoraan Krossissa. Kerromme, kun ensimmäinen halli aukeaa."
            action={<Button variant="dark" icon="users" onClick={() => navigate('/pelaa/pelaajat')}>Etsi peliseuraa</Button>}
          />
        </Page>
      </>
    );
  }

  const upcoming = mine.data?.upcoming || [];
  const freed = (watches.data || []).filter((w) => w.notifiedAt);
  const failedMonths = (seasonSlots.data || [])
    .filter((slot) => slot.venueId === venue.id && slot.status === 'active')
    .flatMap((slot) => slot.charges.filter((c) => c.status === 'failed').map((c) => ({ ...c, slot })));
  const unpaidCents = failedMonths.reduce((n, c) => n + c.amountCents, 0);
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
        back={back}
        actions={(
          <>
            <IconButton
              icon="calendar"
              label={upcoming.length ? `Omat varaukset (${upcoming.length} tulossa)` : 'Omat varaukset'}
              badge={upcoming.length || undefined}
              className="bk-mine-btn"
              onClick={() => navigate('/pelaa/omat-varaukset')}
            />
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

        {target.data && (
          <div className="bk-match" role="note">
            <span className="bk-match-icon" aria-hidden="true"><Icon name={target.data.icon} size={18} /></span>
            <span className="bk-match-text">
              <b>{target.data.title}</b>
              {already
                ? `Sinulla on jo kenttä tähän peliin: ${already.courtName}, ${already.locationName} klo ${formatTime(already.startsAt)}–${formatTime(already.endsAt)}.`
                : target.data.text}
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

        <button type="button" className="bk-terms-link" onClick={() => setTermsOpen(true)}>Varausehdot</button>
      </Page>

      <Sheet open={paymentsOpen} onClose={() => setPaymentsOpen(false)} size="sm" title="Maksamattomat maksut">
        <UnpaidPayments
          months={failedMonths}
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
        target={target.data || null}
      />
    </>
  );
}

/**
 * Who a booking is for, from the page's query: a hallisarja match, a game or a chat — or null.
 * The sheet puts `peopleIds` first in the split list and, once paid, sends `message(where)` to
 * the chat `openChat()` opens (a game nobody has joined yet has no chat: "Takaisin peliin").
 */
async function bookingTarget(query, meId) {
  if (query?.liiga && query?.ottelu) {
    const league = await api.leagues.get(query.liiga);
    const fixture = league?.fixtures?.find((f) => f.id === query.ottelu);
    if (!fixture) return null;
    const opponent = fixture.playerA?.id === meId ? fixture.playerB : fixture.playerA;
    const name = firstName(opponent?.name);
    return {
      kind: 'league', icon: 'trophy',
      title: `${league.seasonLabel}: ottelu vs. ${name}`,
      text: 'Varaa kenttä, niin voit lähettää ajan vastustajallesi yhdellä napautuksella.',
      peopleIds: [opponent?.id].filter(Boolean),
      sendLabel: `Lähetä aika: ${name}`,
      sentText: `Aika lähetetty: ${name}`,
      openChat: () => api.leagues.openFixtureChat(fixture.id),
      message: (where) => `Varasin meille kentän hallisarjan otteluun: ${where}. Nähdään kentällä!`,
    };
  }
  if (query?.peli) {
    const game = await api.games.get(query.peli);
    if (!game || game.status === 'cancelled') return null;
    const players = [game.creator, ...game.participants].filter((p) => p?.id && p.id !== meId);
    return {
      kind: 'game', icon: 'racket', game,
      title: `Kenttä peliin: ${gameTitle(game)} ${game.scheduledAt ? formatGameTime(game.scheduledAt).replace(/^\S+/, (w) => w.toLowerCase()) : ''}`.trim(),
      text: game.conversationId
        ? 'Kun kenttä on maksettu, aika lähtee pelin chattiin yhdellä napautuksella.'
        : 'Kun kenttä on maksettu, peli näyttää sen varattuna.',
      peopleIds: players.map((p) => p.id),
      sendLabel: 'Lähetä aika pelin chattiin',
      sentText: 'Aika lähetetty pelin chattiin',
      openChat: game.conversationId ? async () => game.conversationId : null,
      backTo: `/pelaa/peli/${encodeURIComponent(game.id)}`,
      backLabel: 'Takaisin peliin',
      message: (where) => `Varasin kentän peliin: ${where}. Nähdään kentällä!`,
    };
  }
  if (query?.chat) {
    const chat = await api.messages.getConversation(query.chat);
    if (!chat) return null;
    const name = chat.isGroup ? chat.title : firstName(chat.participants[0]?.name);
    return {
      kind: 'chat', icon: 'chat',
      title: chat.isGroup ? `Kenttä porukalle: ${name}` : `Pelikaverina ${name}`,
      text: 'Kun kenttä on maksettu, aika lähtee keskusteluun yhdellä napautuksella.',
      peopleIds: chat.participants.map((p) => p.id),
      sendLabel: chat.isGroup ? 'Lähetä aika keskusteluun' : `Lähetä aika: ${name}`,
      sentText: chat.isGroup ? 'Aika lähetetty keskusteluun' : `Aika lähetetty: ${name}`,
      openChat: async () => chat.id,
      message: (where) => `Varasin meille kentän: ${where}. Nähdään kentällä!`,
    };
  }
  return null;
}
