// SeasonSettingsSheet — Hallin asetukset → one season (or a new one): name, dates, the season
// discount, whether players may apply, and the holidays without season play. "Lisää Suomen pyhät"
// adds the Finnish holidays inside the dates (features/seasons.js finnishHolidays); tapping a day
// takes it off. A season with active kausivuorot must keep covering their weeks — checkSeason says
// so before the server does. A season nothing refers to can be removed (a mistake).
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { dateKey, isoWeekday, localDate } from '../../features/booking.js';
import {
  WEEKDAY_SHORT, checkSeason, dayMonth, daysBetween, finnishHolidays, holidayName,
} from '../../features/seasons.js';
import { plural } from '../../lib/format.js';
import { Button, Field, Icon, Input, Sheet, Toggle, useConfirm, useToast } from '../../ui/index.js';
import { InfoLine } from './SeasonParts.jsx';
import { intFromInput } from './hallSettingsForm.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const fromSeason = (s) => (s ? {
  name: s.name, startsOn: s.startsOn, endsOn: s.endsOn, discount: String(s.discountPercent), requestsOpen: s.requestsOpen,
  skipDates: [...s.skipDates],
} : { name: '', startsOn: '', endsOn: '', discount: '0', requestsOpen: true, skipDates: [] });

/** 'ti 6.12.' */
const dayLabel = (key) => `${WEEKDAY_SHORT[isoWeekday(localDate(key)) - 1]} ${dayMonth(key)}`;

export function SeasonSettingsSheet({ open, onClose, venue, season, onDone }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const [form, setForm] = useState(() => fromSeason(season));
  const [tried, setTried] = useState(false);
  const [newDay, setNewDay] = useState('');
  const [note, setNote] = useState('');
  const today = dateKey(new Date());

  useEffect(() => {
    if (!open) return;
    setForm(fromSeason(season));
    setTried(false);
    setNewDay('');
    setNote('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, season?.id]);

  if (!venue) return <Sheet open={false} onClose={onClose} />;

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const booked = season?.bookedFrom ? { from: season.bookedFrom, until: season.bookedUntil } : null;
  const input = {
    name: form.name, startsOn: form.startsOn, endsOn: form.endsOn, skipDates: form.skipDates,
    discountPercent: intFromInput(form.discount), requestsOpen: form.requestsOpen,
  };
  const check = checkSeason(input, { today, booked, isNew: !season });
  const error = (field) => (tried && check.field === field ? check.error : '');
  const datesOk = DATE_RE.test(form.startsOn) && DATE_RE.test(form.endsOn) && form.startsOn <= form.endsOn;
  const days = [...form.skipDates].sort();
  const outside = datesOk ? days.filter((d) => d < form.startsOn || d > form.endsOn).length : 0;
  const weeks = datesOk ? Math.ceil((daysBetween(form.startsOn, form.endsOn) + 1) / 7) : 0;

  const addHolidays = () => {
    const fresh = finnishHolidays(form.startsOn, form.endsOn).map((h) => h.date).filter((d) => !form.skipDates.includes(d));
    set({ skipDates: [...form.skipDates, ...fresh].sort() });
    setNote(fresh.length
      ? `Lisättiin ${plural(fresh.length, 'pyhä', 'pyhää')}. Poista ne, joina pelataan normaalisti.`
      : 'Kauden kaikki Suomen pyhät ovat jo listalla.');
  };
  const addDay = () => {
    if (!DATE_RE.test(newDay) || !datesOk || newDay < form.startsOn || newDay > form.endsOn) {
      setNote('Valitse päivä kauden sisältä.');
      return;
    }
    set({ skipDates: [...new Set([...form.skipDates, newDay])].sort() });
    setNewDay('');
    setNote('');
  };
  const removeDay = (key) => set({ skipDates: form.skipDates.filter((d) => d !== key) });

  const save = () => {
    setTried(true);
    if (check.error) return;
    run(async () => {
      try {
        const saved = await api.seasons.saveSeason({ ...check.value, id: season?.id || null, venueId: venue.id });
        onDone?.(season ? `Kausi tallennettu: ${saved.name}.` : `Kausi lisätty: ${saved.name}.`);
      } catch (err) {
        toast(err);
      }
    });
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Poistetaanko kausi?',
      message: `${season.name} poistetaan. Kaudella ei ole kausivuoroja eikä hakemuksia.`,
      confirmLabel: 'Poista kausi',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      try {
        await api.seasons.removeSeason(season.id);
        onDone?.(`Kausi poistettu: ${season.name}.`);
      } catch (err) {
        toast(err);
      }
    });
  };

  const inUse = season && (season.activeSlots > 0 || season.requests > 0);
  const footer = (
    <div className="stack-2">
      <Button variant="lime" size="lg" block icon="check" loading={busy} onClick={save}>{season ? 'Tallenna muutokset' : 'Lisää kausi'}</Button>
      {season?.removable && <Button variant="ghost" block icon="trash" disabled={busy} onClick={remove}>Poista kausi</Button>}
    </div>
  );

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title={season ? season.name : 'Uusi kausi'}
      subtitle={season ? `${dayMonth(season.startsOn, true)}–${dayMonth(season.endsOn, true)}` : venue.name}
      footer={footer}
      size="md"
      className="bk-sheet"
    >
      <div className="stack-4">
        {inUse && (
          <InfoLine icon="info">
            Kaudella on {[season.activeSlots ? plural(season.activeSlots, 'voimassa oleva kausivuoro', 'voimassa olevaa kausivuoroa') : null,
              season.requests ? plural(season.requests, 'hakemus', 'hakemusta') : null].filter(Boolean).join(' ja ')}. Muutokset koskevat
            uusia hakemuksia ja hyväksyntöjä; voimassa olevien vuorojen viikot ja hinnat pysyvät ennallaan.
            {booked ? ` Kauden päivien pitää kattaa vuorojen viikot ${dayMonth(booked.from, true)}–${dayMonth(booked.until, true)}.` : ''}
          </InfoLine>
        )}

        <Field label="Nimi" htmlFor="hset-season-name" error={error('name')}>
          <Input id="hset-season-name" value={form.name} maxLength={80} placeholder="esim. Talvikausi 2026–2027" onChange={(e) => set({ name: e.target.value })} />
        </Field>

        <div>
          <div className="ss-two">
            <Field label="Alkaa" htmlFor="hset-season-start">
              <Input id="hset-season-start" type="date" value={form.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
            </Field>
            <Field label="Päättyy" htmlFor="hset-season-end">
              <Input id="hset-season-end" type="date" value={form.endsOn} min={form.startsOn || undefined} onChange={(e) => set({ endsOn: e.target.value })} />
            </Field>
          </div>
          {error('dates')
            ? <div className="field-msg field-msg-error" role="alert">{error('dates')}</div>
            : weeks > 0 ? <div className="field-msg">{plural(weeks, 'viikko', 'viikkoa')}, viimeinen pelipäivä {dayMonth(form.endsOn, true)}</div> : null}
        </div>

        <Field label="Kausialennus (%)" htmlFor="hset-season-discount" error={error('discountPercent')}
          hint="Kausihinta = vuorojen normaalihinnat miinus tämä prosentti.">
          <Input id="hset-season-discount" inputMode="numeric" value={form.discount} placeholder="esim. 15" onChange={(e) => set({ discount: e.target.value })} />
        </Field>

        <Toggle
          label="Kausivuorohaku auki"
          hint={form.requestsOpen ? 'Pelaajat voivat hakea kausivuoroa sovelluksessa.' : 'Uusia hakemuksia ei voi tehdä. Halli voi silti lisätä vuoroja itse.'}
          checked={form.requestsOpen}
          onChange={(v) => set({ requestsOpen: v })}
        />

        <div className="hset-days-box">
          <div className="hset-days-head">
            <span className="eyebrow">Pyhät — ei kausivuoroja</span>
            <span className="hset-days-count t-num">{days.length}</span>
          </div>
          {days.length === 0 ? (
            <p className="ss-empty">Ei pyhiä. Kausivuoro pelataan joka viikko.</p>
          ) : (
            <ul className="hset-days" aria-label="Pyhät">
              {days.map((d) => {
                const name = holidayName(d);
                const out = datesOk && (d < form.startsOn || d > form.endsOn);
                return (
                  <li key={d}>
                    <button
                      type="button"
                      className={cx('hset-day', out && 'is-out')}
                      onClick={() => removeDay(d)}
                      aria-label={`Poista ${dayMonth(d, true)}${name ? ` (${name})` : ''}`}
                    >
                      <span className="t-num">{dayLabel(d)}</span>
                      {name && <small>{name}</small>}
                      <Icon name="close" size={14} />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {outside > 0 && <p className="field-msg">{plural(outside, 'päivä on', 'päivää on')} kauden ulkopuolella eikä tallennu.</p>}
          {error('skipDates') && <p className="field-msg field-msg-error" role="alert">{error('skipDates')}</p>}
          <div className="hset-day-add">
            <Input
              type="date"
              aria-label="Lisättävä päivä"
              value={newDay}
              min={form.startsOn || undefined}
              max={form.endsOn || undefined}
              onChange={(e) => setNewDay(e.target.value)}
            />
            <Button variant="outline" size="sm" icon="plus" disabled={!newDay} onClick={addDay}>Lisää päivä</Button>
          </div>
          <div className="hset-day-actions">
            <Button variant="soft" size="sm" icon="calendar" disabled={!datesOk} onClick={addHolidays}>Lisää Suomen pyhät</Button>
            {days.length > 0 && <Button variant="ghost" size="sm" onClick={() => { set({ skipDates: [] }); setNote(''); }}>Tyhjennä</Button>}
          </div>
          {note && <p className="hset-note" aria-live="polite">{note}</p>}
        </div>
      </div>
    </Sheet>
  );
}
