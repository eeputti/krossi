// SeasonRequestSheet — "Hae vakiovuoroa": a player applies for a kausivuoro (the same court,
// weekday and time every week of a season). Pick the day, time, length and place; the season quote
// (api.seasons.quote) shows how many weeks it is, which weeks are already taken on each court, the
// season price and what each month costs. Then the billing: an invoice for the season, or monthly
// charges from a saved card (SaveCard). The hall confirms the request (Hallin näkymä → Kausivuorot).
import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync } from '../../app/hooks.js';
import { navigate } from '../../app/router.js';
import { addDays, centsLabel, dateKey, isoWeekday, locationsFor, minutesOf } from '../../features/booking.js';
import { WEEKDAY_NAMES, WEEKDAY_SHORT, addClock, clockLabel, dayMonth, monthLabel } from '../../features/seasons.js';
import {
  Button, ChipSelect, Field, Icon, Segmented, Select, Sheet, Skeleton, Textarea, useToast,
} from '../../ui/index.js';
import { DurationStepper } from './BookingParts.jsx';
import { SaveCard } from './SaveCard.jsx';
import { InfoLine, cardLabel } from './SeasonParts.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const ANY = 'any';
const SHORT_PLACE = { 'Kisapuiston ulkokentät': 'Ulkokentät' };

/** Start times on the venue's grid that leave room for `minutes`, as 'HH:MM'. */
function startOptions(venue, minutes) {
  const out = [];
  for (let m = minutesOf(venue.openFrom); m + minutes <= minutesOf(venue.openUntil); m += venue.slotMinutes || 30) {
    out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return out;
}

export function SeasonRequestSheet({ open, onClose, venue, seasons, card, onCardSaved, onRequested }) {
  const toast = useToast();
  const openSeasons = useMemo(() => (seasons || []).filter((s) => s.requestsOpen), [seasons]);
  const [seasonId, setSeasonId] = useState(null);
  const [weekday, setWeekday] = useState(() => isoWeekday(new Date(Date.now() + 86_400_000)));
  const [minutes, setMinutes] = useState(60);
  const [startTime, setStartTime] = useState('18:00');
  const [place, setPlace] = useState(ANY);
  const [courtId, setCourtId] = useState(ANY);
  const [billing, setBilling] = useState('invoice');
  const [note, setNote] = useState('');
  const [changingCard, setChangingCard] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(null);

  useEffect(() => {
    if (!open) return;
    setSent(null);
    setChangingCard(false);
    setSeasonId((id) => (openSeasons.some((s) => s.id === id) ? id : openSeasons[0]?.id || null));
    setBilling(card ? 'card' : 'invoice');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const season = openSeasons.find((s) => s.id === seasonId) || openSeasons[0] || null;
  const places = useMemo(() => (venue ? locationsFor(venue, 'tennis') : []), [venue]);
  const locationId = places.some((l) => l.id === place) ? place : null;
  const courts = useMemo(() => (locationId ? places.find((l) => l.id === locationId).courts.filter((c) => c.sport === 'tennis') : []), [places, locationId]);
  const chosenCourt = courts.some((c) => c.id === courtId) ? courtId : null;
  const times = useMemo(() => (venue ? startOptions(venue, minutes) : []), [venue, minutes]);
  const time = times.includes(startTime) ? startTime : times[times.length - 1] || '18:00';

  const quote = useAsync(
    () => (open && season ? api.seasons.quote({
      seasonId: season.id, courtId: chosenCourt, locationId, weekday, startTime: time, minutes,
    }) : Promise.resolve(null)),
    [open, season?.id, chosenCourt, locationId, weekday, time, minutes],
  );
  const q = quote.data;
  const conflicts = (q?.weeks || []).filter((w) => w.conflict);
  const booked = (q?.weeks || []).filter((w) => !w.conflict);
  const suggested = q && !chosenCourt && q.courtId ? venue.locations.flatMap((l) => l.courts).find((c) => c.id === q.courtId) : null;

  if (!venue) return null;

  const send = async () => {
    setSending(true);
    try {
      const slot = await api.seasons.request({
        seasonId: season.id, courtId: chosenCourt, locationId, weekday, startTime: time, minutes, billing, note,
      });
      setSent(slot);
      onRequested?.(slot);
    } catch (err) {
      toast(err);
      if (err?.code === 'conflict') quote.reload();
    } finally {
      setSending(false);
    }
  };

  let body;
  let footer;
  if (!season) {
    body = <InfoLine icon="calendar">Hallissa ei ole nyt avointa vakiovuorohakua. Kysy hallilta seuraavan kauden hausta.</InfoLine>;
  } else if (sent) {
    body = (
      <div className="ss-done">
        <span className="ss-done-icon" aria-hidden="true"><Icon name="check" size={28} strokeWidth={3} /></span>
        <h2 className="ss-done-title">Hakemus lähetetty</h2>
        <p className="ss-done-text">
          {WEEKDAY_NAMES[sent.weekday - 1]} klo {clockLabel(sent.startTime)}–{clockLabel(addClock(sent.startTime, sent.minutes))}
          {sent.courtName ? `, ${sent.courtName}` : ''}{sent.locationName ? ` · ${sent.locationName}` : ''}.
          Halli vahvistaa vuoron ja kentän. Näet tilanteen Omissa varauksissa.
        </p>
      </div>
    );
    footer = (
      <div className="stack-2">
        <Button variant="dark" block icon="list" onClick={() => { onClose(); navigate('/pelaa/omat-varaukset'); }}>Omat varaukset</Button>
        <Button variant="ghost" block onClick={onClose}>Valmis</Button>
      </div>
    );
  } else {
    body = (
      <div className="stack-4">
        {openSeasons.length > 1 && (
          <Segmented
            ariaLabel="Kausi"
            options={openSeasons.map((s) => ({ value: s.id, label: s.name }))}
            value={season.id}
            onChange={setSeasonId}
          />
        )}
        <p className="ss-season-dates">{season.name}: {dayMonth(season.startsOn, true)}–{dayMonth(season.endsOn, true)} · kausihinta −{season.discountPercent} %</p>

        <div className="bk-field">
          <span className="eyebrow">Viikonpäivä</span>
          <ChipSelect
            ariaLabel="Viikonpäivä"
            size="sm"
            layout="grid"
            columns={7}
            options={WEEKDAY_SHORT.map((label, i) => ({ value: String(i + 1), label }))}
            value={String(weekday)}
            onChange={(v) => v && setWeekday(Number(v))}
            className="ss-weekdays"
          />
        </div>

        <div className="ss-time-row">
          <label className="bk-field" htmlFor="ss-start">
            <span className="eyebrow">Alkaa</span>
            <Select id="ss-start" options={times.map((t) => ({ value: t, label: clockLabel(t) }))} value={time} onChange={(e) => setStartTime(e.target.value)} />
          </label>
          <div className="bk-field">
            <span className="eyebrow">Kesto</span>
            <DurationStepper value={minutes} options={venue.durations} onChange={setMinutes} />
          </div>
        </div>

        {places.length > 1 && (
          <div className="bk-field">
            <span className="eyebrow">Paikka</span>
            <ChipSelect
              ariaLabel="Paikka"
              size="sm"
              layout="scroll"
              options={[{ value: ANY, label: 'Mikä tahansa' }, ...places.map((l) => ({ value: l.id, label: SHORT_PLACE[l.name] || l.name }))]}
              value={locationId || ANY}
              onChange={(v) => { setPlace(v || ANY); setCourtId(ANY); }}
            />
          </div>
        )}

        {locationId && (
          <div className="bk-field">
            <span className="eyebrow">Kenttä</span>
            <div className="ss-courts" role="group" aria-label="Kenttä">
              <button type="button" className={cx('bk-court', !chosenCourt && 'is-on')} aria-pressed={!chosenCourt} onClick={() => setCourtId(ANY)}>
                <span className="bk-court-name">Vapaa kenttä</span>
              </button>
              {courts.map((c) => {
                const n = q?.courts?.find((x) => x.courtId === c.id)?.conflicts;
                return (
                  <button key={c.id} type="button" className={cx('bk-court', chosenCourt === c.id && 'is-on')} aria-pressed={chosenCourt === c.id} onClick={() => setCourtId(c.id)}>
                    <span className="bk-court-name">{c.shortName}</span>
                    {n != null && <span className="bk-court-price">{n === 0 ? 'vapaa' : `${n} varattu`}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {quote.error && !q ? (
          <p className="checkout-error" role="alert"><Icon name="alert" size={16} />{quote.error.userMessage || 'Hintaa ei voitu laskea.'}</p>
        ) : !q ? (
          <div className="stack-2" aria-label="Lasketaan hintaa"><Skeleton h={44} r={12} /><Skeleton h={44} r={12} /></div>
        ) : (
          <QuoteFacts q={q} booked={booked} conflicts={conflicts} suggested={suggested} billing={billing} loading={quote.loading} />
        )}

        <div className="bk-field">
          <span className="eyebrow">Maksu</span>
          <Segmented
            ariaLabel="Maksutapa"
            options={[{ value: 'invoice', label: 'Lasku' }, { value: 'card', label: 'Kortilta kuukausittain' }]}
            value={billing}
            onChange={setBilling}
          />
          {billing === 'invoice' ? (
            <InfoLine icon="mail">Halli lähettää laskun koko kaudesta, kun vuoro on vahvistettu. Maksuaika 14 päivää.</InfoLine>
          ) : card && !changingCard ? (
            <div className="ss-card-line">
              <Icon name="lock" size={16} />
              <span>{cardLabel(card)}</span>
              <button type="button" className="bhall-link" onClick={() => setChangingCard(true)}>Vaihda</button>
            </div>
          ) : (
            <SaveCard onSaved={(saved) => { onCardSaved?.(saved); setChangingCard(false); toast('Kortti tallennettu.', { icon: 'check' }); }} />
          )}
          {billing === 'card' && <p className="bk-fine">Ensimmäinen kuukausi veloitetaan, kun halli vahvistaa vuoron, seuraavat kunkin kuun 1. päivä.</p>}
        </div>

        <Field label="Viesti hallille" optional htmlFor="ss-note">
          <Textarea id="ss-note" value={note} maxLength={500} rows={2} placeholder="esim. kenen kanssa pelaat tai joustatko ajasta" onChange={(e) => setNote(e.target.value)} />
        </Field>
      </div>
    );
    const ready = q && q.count > 0 && (billing === 'invoice' || (card && !changingCard));
    footer = (
      <div className="stack-2">
        <Button variant="lime" size="lg" block loading={sending} disabled={!ready} onClick={send}>
          {q && q.count > 0 ? `Lähetä hakemus · ${centsLabel(q.cents)}` : 'Lähetä hakemus'}
        </Button>
        <p className="bk-fine bk-fine-center">Hakemus ei sido sinua ennen kuin halli vahvistaa sen.</p>
      </div>
    );
  }

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={sent ? undefined : 'Hae kausivuoroa'}
      subtitle={sent ? undefined : venue.name}
      footer={footer}
      size="md"
      className="bk-sheet"
    >
      {body}
    </Sheet>
  );
}

function QuoteFacts({ q, booked, conflicts, suggested, billing, loading }) {
  const first = booked[0]?.date;
  const last = booked[booked.length - 1]?.date;
  return (
    <dl className={cx('bk-facts', loading && 'is-loading')}>
      <div>
        <dt>Viikot</dt>
        <dd>
          {q.count ? `${q.count} kertaa` : 'Ei vapaita viikkoja'}
          {first && <small>{dayMonth(first, true)}–{dayMonth(last, true)}</small>}
        </dd>
      </div>
      {suggested && (
        <div><dt>Kenttä</dt><dd>{suggested.name}<small>Halli voi vielä vaihtaa kentän</small></dd></div>
      )}
      {(q.skipped.length > 0 || conflicts.length > 0) && (
        <div>
          <dt>Pois</dt>
          <dd>
            {q.skipped.length > 0 && <small>Pyhät: {q.skipped.map((d) => dayMonth(d)).join(', ')}</small>}
            {conflicts.length > 0 && (
              <small>
                Jo varattu: {conflicts.slice(0, 6).map((w) => dayMonth(w.date)).join(', ')}{conflicts.length > 6 ? ` +${conflicts.length - 6}` : ''}
              </small>
            )}
          </dd>
        </div>
      )}
      <div>
        <dt>Kausihinta</dt>
        <dd>
          {centsLabel(q.cents)}
          {q.fullCents > q.cents && <small>Normaalihinta {centsLabel(q.fullCents)} − {q.discountPercent} %</small>}
        </dd>
      </div>
      {billing === 'card' && q.months.length > 0 && (
        <div>
          <dt>Kuukausittain</dt>
          <dd className="ss-months">
            {q.months.map((m) => <small key={m.month} className="t-num">{monthLabel(m.month, true)} {centsLabel(m.cents)}</small>)}
          </dd>
        </div>
      )}
    </dl>
  );
}

/** Whether today is past the season's last start — used by the booking screen to hide the entry. */
export function seasonOpenFor(seasons) {
  const today = dateKey(new Date());
  return (seasons || []).some((s) => s.requestsOpen && s.endsOn >= addDays(today, 7));
}
