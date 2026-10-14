// HallScreen — /pelaa/halli/:venue: the hall staff's day view ("Hallin näkymä") for the front desk.
// Every booking of a day with names, per location: the day's numbers, a court × time timeline
// (HallTimeline), blocking courts for the hall's own use (HallBlockSheet: hallisarja, coaching,
// maintenance) and cancelling / refunding bookings or removing blocks (HallItemSheet).
//
// ?pv=YYYY-MM-DD (missing = today) and ?paikka=<locationId> (missing = the first location) keep
// the view over a reload; both are written with navigate(…, { replace: true }).
// Only venue staff get in (venue.isStaff; api.booking.staffDay refuses everyone else too).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy, useMediaQuery, useNow, useResync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { LIVE_SPORTS, addDays, centsLabel, dateKey, localDate } from '../../features/booking.js';
import { WEEKDAYS, WEEKDAYS_SHORT, dayDiff, dayLabel } from '../../lib/format.js';
import {
  Button, ErrorState, Icon, IconButton, Page, ProgressBar, Segmented, Skeleton, StatTile, TopBar, useToast,
} from '../../ui/index.js';
import { HallBlockSheet } from './HallBlockSheet.jsx';
import { HallItemSheet } from './HallItemSheet.jsx';
import { HallTimeline } from './HallTimeline.jsx';
import {
  courtsLabel, dayWindow, daySummary, defaultStart, hhmm, isoWeek, liveLocations, locationLabel, nowMinuteOn,
  parseDayKey, percentLabel, startChoices,
} from './hallData.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const REFRESH_MS = 60_000;

export function HallScreen({ params, query }) {
  const ref = params.venue;
  const venueQ = useAsync(() => api.booking.getVenue(ref), [ref]);
  const venue = venueQ.data;
  const back = `/pelaa/varaa/${venue?.slug || ref}`;

  let blocked = null;
  if (venueQ.loading && !venue) {
    blocked = <HallSkeleton />;
  } else if (venueQ.error) {
    blocked = <ErrorState error={venueQ.error} onRetry={() => venueQ.reload()} />;
  } else if (!venue) {
    blocked = (
      <HallNotice
        icon="search"
        title="Hallia ei löytynyt"
        text="Linkki voi olla vanhentunut. Valitse halli kenttävarauksesta."
        action={<Button variant="dark" icon="arrow-left" onClick={() => navigate('/pelaa/varaa')}>Kenttävaraukseen</Button>}
      />
    );
  } else if (!venue.isStaff) {
    blocked = (
      <HallNotice
        icon="lock"
        title="Vain hallin henkilökunnalle"
        text="Hallin näkymässä työntekijät näkevät päivän varaukset ja estävät kenttiä hallin omaan käyttöön. Pelaajana voit varata vuoron tavalliseen tapaan."
        action={<Button variant="dark" icon="calendar" onClick={() => navigate(back)}>Varaa vuoro</Button>}
      />
    );
  }

  if (blocked) {
    return (
      <>
        <TopBar title="Hallin näkymä" back={back} className="bhall-topbar" />
        <Page width="wide" className="bhall">{blocked}</Page>
      </>
    );
  }
  return <HallDay venue={venue} venueRef={ref} query={query} back={back} />;
}

/** The pilot books tennis only (LIVE_SPORTS): the hall's other courts stay out of the view. */
function liveCourtsOnly(venue) {
  const locations = (venue.locations || [])
    .map((l) => ({ ...l, courts: (l.courts || []).filter((c) => LIVE_SPORTS.includes(c.sport)) }))
    .filter((l) => l.courts.length > 0);
  return { ...venue, locations };
}

function HallDay({ venue: allCourts, venueRef, query, back }) {
  const venue = useMemo(() => liveCourtsOnly(allCourts), [allCourts]);
  const toast = useToast();
  const longLabels = useMediaQuery('(min-width: 1200px)');
  const now = useNow(30_000);
  const today = dateKey(new Date(now));
  const dayKey = parseDayKey(query.pv) || today;
  // Only courts of the sports live in the app (tennis in the pilot): rows, chips, stats, everything.
  const locations = useMemo(() => liveLocations(venue), [venue]);
  const liveIds = useMemo(() => new Set(locations.flatMap((l) => l.courts.map((c) => c.id))), [locations]);
  const location = locations.find((l) => l.id === query.paikka) || locations[0] || null;
  const win = useMemo(() => dayWindow(venue), [venue]);
  const nowMin = nowMinuteOn(dayKey, now);

  // The day's rows carry their key, so a slow answer for yesterday never paints under today.
  const day = useAsync(async () => ({ key: dayKey, items: await api.booking.staffDay(venue.id, dayKey) }), [venue.id, dayKey]);
  const fresh = day.data?.key === dayKey;
  const items = useMemo(() => (fresh ? day.data.items.filter((it) => liveIds.has(it.courtId)) : []), [fresh, day.data, liveIds]);
  const loading = !fresh && !day.error;
  const summary = useMemo(
    () => (fresh && location ? daySummary(venue, location, dayKey, items, win) : null),
    [fresh, venue, location, dayKey, items, win],
  );

  const reloadDay = day.reload;
  const [refreshing, runRefresh] = useBusy();
  const refresh = () => runRefresh(async () => {
    const result = await reloadDay({ silent: true });
    if (result === undefined) toast('Päivitys ei onnistunut. Yritä hetken päästä uudelleen.', { tone: 'error' });
  });
  useResync(() => reloadDay({ silent: true }));
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') reloadDay({ silent: true }); }, REFRESH_MS);
    return () => clearInterval(t);
  }, [reloadDay]);

  // Day and place live in the URL. navigate() scrolls a new history entry to the top: keep the
  // page where it was, the controls are often scrolled a little on phones.
  const keepScroll = useRef(null);
  const searchFor = ({ pv, paikka }) => {
    const qs = new URLSearchParams();
    if (pv !== today) qs.set('pv', pv);
    if (paikka && paikka !== locations[0]?.id) qs.set('paikka', paikka);
    return qs.toString();
  };
  const setView = ({ pv = dayKey, paikka = location?.id } = {}) => {
    const search = searchFor({ pv, paikka });
    if (search === searchFor({ pv: dayKey, paikka: location?.id })) return; // nothing changes
    keepScroll.current = window.scrollY;
    navigate(`/pelaa/halli/${venueRef}${search ? `?${search}` : ''}`, { replace: true });
  };
  useEffect(() => {
    if (keepScroll.current == null) return;
    window.scrollTo(0, keepScroll.current);
    keepScroll.current = null;
  }, [query.pv, query.paikka]);

  // Sheets keep their last content while they animate out.
  const [blockDraft, setBlockDraft] = useState(null);
  const [blockOpen, setBlockOpen] = useState(false);
  const [openItem, setOpenItem] = useState(null);
  const [itemOpen, setItemOpen] = useState(false);
  const canBlock = startChoices(win, nowMin).length > 0;

  const openBlock = (draft) => {
    setBlockDraft({ ...draft });
    setBlockOpen(true);
  };
  const onFree = useCallback((court, minute) => {
    setBlockDraft({ courtIds: [court.id], startMin: minute });
    setBlockOpen(true);
  }, []);
  const onItem = useCallback((item) => {
    setOpenItem(item);
    setItemOpen(true);
  }, []);

  const onBlocked = ({ title, courts, startMin, endMin }) => {
    setBlockOpen(false);
    toast(`Estetty: ${title} · ${courtsLabel(courts)} klo ${hhmm(startMin)}–${hhmm(endMin)}`);
    reloadDay({ silent: true });
  };
  const onItemDone = (message) => {
    if (message) {
      setItemOpen(false);
      toast(message);
    }
    reloadDay({ silent: true });
  };

  return (
    <>
      <TopBar
        title="Hallin näkymä"
        back={back}
        className="bhall-topbar"
        actions={(
          <IconButton
            icon="refresh"
            label="Päivitä"
            className={cx('bhall-refresh', refreshing && 'is-spinning')}
            onClick={refresh}
            disabled={refreshing}
          />
        )}
      />
      <Page width="wide" className="bhall">
        <header className="bhall-head">
          <div className="bhall-head-text">
            <div className="eyebrow bhall-eyebrow"><Icon name="shield" size={13} strokeWidth={2.4} />Henkilökunta</div>
            <h1 className="bhall-title">{venue.name}</h1>
          </div>
          {canBlock && location && (
            <Button variant="dark" size="sm" icon="plus" className="bhall-head-cta" onClick={() => openBlock({ courtIds: [], startMin: defaultStart(win, nowMin) })}>
              Estä aika
            </Button>
          )}
        </header>

        <div className="bhall-controls">
          <DayNav dayKey={dayKey} today={today} onChange={(pv) => setView({ pv })} />
          {locations.length > 1 && (
            <Segmented
              key={longLabels ? 'long' : 'short'}
              ariaLabel="Paikka"
              className="bhall-places"
              options={locations.map((l) => ({ value: l.id, label: locationLabel(l, !longLabels) }))}
              value={location?.id}
              onChange={(paikka) => setView({ paikka })}
            />
          )}
        </div>

        {location && <DayStats summary={summary} failed={Boolean(day.error) && !fresh} />}

        {location ? (
          <section className="bhall-board" aria-label={`${location.name}: kentät ja varaukset`}>
            {day.error && !fresh ? (
              <ErrorState error={day.error} onRetry={() => reloadDay()} compact />
            ) : (
              <HallTimeline
                venue={venue}
                location={location}
                dayKey={dayKey}
                items={items}
                loading={loading}
                nowMin={nowMin}
                onFree={onFree}
                onItem={onItem}
              />
            )}
            <Legend hint={fresh && summary && summary.bookings + summary.own === 0 ? 'Ei varauksia — koko päivä on vapaana.' : canBlock ? 'Napauta vapaata aikaa estääksesi sen.' : null} />
          </section>
        ) : (
          <HallNotice icon="court" title="Ei varattavia kenttiä" text="Kun hallin kentät ovat varattavissa Krossissa, päivän varaukset näkyvät tässä." />
        )}
      </Page>

      {location && (
        <HallBlockSheet
          open={blockOpen}
          onClose={() => setBlockOpen(false)}
          venue={venue}
          location={location}
          dayKey={dayKey}
          items={items}
          nowMin={nowMin}
          draft={blockDraft}
          onBlocked={onBlocked}
        />
      )}
      <HallItemSheet
        open={itemOpen}
        onClose={() => setItemOpen(false)}
        item={openItem}
        venue={venue}
        dayKey={dayKey}
        items={items}
        onDone={onItemDone}
      />
    </>
  );
}

/** ‹ Tänään › — the date opens the native date picker; "Tänään" jumps back when elsewhere. */
function DayNav({ dayKey, today, onChange }) {
  const date = localDate(dayKey);
  const todayDate = localDate(today);
  const diff = dayDiff(date, todayDate);
  const relative = diff >= -1 && diff <= 2;
  const main = dayLabel(date.toISOString(), todayDate);
  const short = `${WEEKDAYS_SHORT[date.getDay()]} ${date.getDate()}.${date.getMonth() + 1}.`;
  const sub = relative ? `${short} · vk ${isoWeek(dayKey)}` : `${WEEKDAYS[date.getDay()]} · vk ${isoWeek(dayKey)}`;
  const pick = (e) => {
    const key = parseDayKey(e.target.value);
    if (key) onChange(key);
  };
  return (
    <div className="bhall-daynav">
      <IconButton icon="chevron-left" label="Edellinen päivä" variant="soft" onClick={() => onChange(addDays(dayKey, -1))} />
      <label className="bhall-date">
        <span className="bhall-date-text">
          <span className={cx('bhall-date-main', diff === 0 && 'is-today')}>{main}</span>
          <span className="bhall-date-sub t-num">{sub}</span>
        </span>
        <Icon name="calendar" size={18} className="bhall-date-icon" />
        <input
          type="date"
          className="bhall-date-input"
          aria-label="Valitse päivä"
          value={dayKey}
          onChange={pick}
          onClick={(e) => { try { e.currentTarget.showPicker?.(); } catch { /* picker already open or not allowed */ } }}
        />
      </label>
      <IconButton icon="chevron-right" label="Seuraava päivä" variant="soft" onClick={() => onChange(addDays(dayKey, 1))} />
      {/* Always there (disabled on today) so the › button never jumps under a second tap. */}
      <Button variant="ghost" size="sm" className="bhall-today" disabled={diff === 0} onClick={() => onChange(today)}>Tänään</Button>
    </div>
  );
}

/** Varauksia · Käyttöaste · Myynti · Maksamatta for the picked location. */
function DayStats({ summary: s, failed }) {
  const wait = failed ? '–' : <Skeleton w={44} h={22} r={6} />;
  const percent = s ? Math.round(s.utilization * 100) : 0;
  return (
    <div className="bhall-stats">
      <StatTile
        icon="calendar"
        label="Varauksia"
        value={s ? s.bookings : wait}
        sub={s ? (s.own ? `+ ${s.own} ${s.own === 1 ? 'hallin oma vuoro' : 'hallin omaa vuoroa'}` : 'ei hallin omia vuoroja') : null}
      />
      <StatTile
        icon="grid"
        label="Käyttöaste"
        value={s ? percentLabel(s.utilization) : wait}
        sub={<ProgressBar value={s ? s.utilization : 0} tone="green" label={`Käyttöaste ${percent} %`} />}
      />
      <StatTile
        icon="euro"
        label="Myynti"
        value={s ? centsLabel(s.salesCents) : wait}
        sub={s ? 'maksetut varaukset' : null}
      />
      <StatTile
        icon="clock"
        tone={s?.unpaid ? 'clay' : 'default'}
        label="Maksamatta"
        value={s ? s.unpaid : wait}
        sub={s ? (s.unpaid ? `${centsLabel(s.unpaidCents)} kesken` : 'kaikki maksettu') : null}
      />
    </div>
  );
}

const LEGEND = [
  ['booking', 'Varaus'],
  ['held', 'Pidossa'],
  ['unpaid', 'Maksamatta'],
  ['league', 'Hallisarja'],
  ['block', 'Este'],
  ['closed', 'Suljettu'],
];

function Legend({ hint }) {
  return (
    <div className="bhall-legend">
      <ul className="bhall-legend-list" aria-label="Selitteet">
        {LEGEND.map(([variant, label]) => (
          <li key={variant} className="bhall-legend-item">
            <span className={cx('bhall-swatch', `is-${variant}`)} aria-hidden="true" />{label}
          </li>
        ))}
      </ul>
      {hint && <p className="bhall-legend-hint">{hint}</p>}
    </div>
  );
}

/** A plain message in place of the view (not found, no access, no courts) — no illustration: a work tool. */
function HallNotice({ icon, title, text, action }) {
  return (
    <div className="bhall-notice">
      <span className="bhall-notice-icon" aria-hidden="true"><Icon name={icon} size={22} /></span>
      <h2 className="bhall-notice-title">{title}</h2>
      {text && <p className="bhall-notice-text">{text}</p>}
      {action && <div className="bhall-notice-actions">{action}</div>}
    </div>
  );
}

function HallSkeleton() {
  return (
    <div className="bhall-skeleton" aria-busy="true" aria-label="Ladataan hallin näkymää">
      <div className="bhall-head">
        <div className="bhall-head-text">
          <Skeleton w={96} h={11} />
          <Skeleton w="min(420px, 70%)" h={26} r={10} />
        </div>
      </div>
      <div className="bhall-controls">
        <Skeleton w="min(360px, 100%)" h={48} r={14} />
        <Skeleton w="min(380px, 100%)" h={46} r={999} />
      </div>
      <div className="bhall-stats">
        {[0, 1, 2, 3].map((i) => <div key={i} className="bhall-skeleton-tile"><Skeleton h="100%" r={14} /></div>)}
      </div>
      <div className="bhall-skeleton-board"><Skeleton h="100%" r={18} /></div>
    </div>
  );
}
