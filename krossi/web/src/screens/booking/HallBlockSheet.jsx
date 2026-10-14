// HallBlockSheet — "Estä aika": the hall takes courts for its own use (hallisarja evening, coaching,
// maintenance, an event). Name (quick chips + free text, max 80), courts of the location (with
// "Kaikki tenniskentät" style shortcuts), start, length or end. Shows what the block would collide
// with before sending; the server still decides (api.booking.block fails on any overlap).
//
//   <HallBlockSheet open onClose venue location dayKey items nowMin draft onBlocked={(result) => …} />
//     draft      { courtIds, startMin, endMin? } — what the sheet opens with (a tapped half hour)
//     onBlocked  ({ ids, title, kind, courts, startMin, endMin }) after the server said yes

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { durationLabel, localDate } from '../../features/booking.js';
import { firstName, formatTime } from '../../lib/format.js';
import { Button, ChipSelect, Field, Icon, Input, Select, Sheet, useToast } from '../../ui/index.js';
import {
  conflictsFor, courtsLabel, dayText, dayWindow, defaultStart, endChoices, hhmm, kindForTitle, startChoices,
} from './hallData.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const PRESETS = ['Hallisarja', 'Valmennus', 'Kunnostus', 'Tapahtuma'].map((v) => ({ value: v, label: v }));
const LENGTHS = [60, 90, 120, 180];
const SPORT_COURTS = { tennis: 'tenniskentät', sulkapallo: 'sulkapallokentät', padel: 'padelkentät', squash: 'squashkentät' };

export function HallBlockSheet({ open, onClose, venue, location, dayKey, items, nowMin, draft, onBlocked }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const win = useMemo(() => dayWindow(venue), [venue]);
  const courts = location?.courts || [];
  const [title, setTitle] = useState('');
  const [titleError, setTitleError] = useState('');
  const [courtIds, setCourtIds] = useState([]);
  const [startMin, setStartMin] = useState(win.from);
  const [endMin, setEndMin] = useState(win.from + 60);

  // A fresh form every time the sheet opens (the draft object is new per open).
  useEffect(() => {
    if (!open || !draft) return;
    const start = draft.startMin ?? defaultStart(win, nowMin);
    setTitle(draft.title || '');
    setTitleError('');
    setCourtIds(draft.courtIds || []);
    setStartMin(start);
    setEndMin(Math.min(win.until, draft.endMin ?? start + 60));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, draft]);

  const starts = useMemo(() => {
    const list = startChoices(win, nowMin);
    return list.includes(startMin) ? list : [startMin, ...list].sort((a, b) => a - b);
  }, [win, nowMin, startMin]);
  const ends = useMemo(() => endChoices(win, startMin), [win, startMin]);
  const lengths = LENGTHS.filter((len) => startMin + len <= win.until);
  const length = endMin - startMin;

  const selected = courts.filter((c) => courtIds.includes(c.id));
  const shortcuts = useMemo(() => {
    const bySport = new Map();
    for (const c of courts) bySport.set(c.sport, [...(bySport.get(c.sport) || []), c.id]);
    return [...bySport].filter(([sport, ids]) => ids.length > 1 && SPORT_COURTS[sport])
      .map(([sport, ids]) => ({ sport, ids, label: `Kaikki ${SPORT_COURTS[sport]}` }));
  }, [courts]);

  const conflicts = useMemo(
    () => conflictsFor(items, courtIds, dayKey, startMin, endMin)
      .sort((a, b) => courts.findIndex((c) => c.id === a.courtId) - courts.findIndex((c) => c.id === b.courtId)),
    [items, courtIds, dayKey, startMin, endMin, courts],
  );
  const clashIds = [...new Set(conflicts.map((it) => it.courtId))];

  const changeStart = (value) => {
    const start = Number(value);
    const keep = Math.max(30, endMin - startMin);
    setStartMin(start);
    setEndMin(Math.min(win.until, start + keep));
  };

  const name = title.trim();
  const kind = kindForTitle(name);
  const ready = courtIds.length > 0 && endMin > startMin;

  const submit = () => run(async () => {
    if (!name) { setTitleError('Anna esteelle nimi, esim. "Hallisarja".'); return; }
    try {
      const ids = await api.booking.block({
        courtIds,
        startsAt: localDate(dayKey, startMin).toISOString(),
        endsAt: localDate(dayKey, endMin).toISOString(),
        title: name,
        kind,
      });
      onBlocked?.({ ids, title: name, kind, courts: selected, startMin, endMin });
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={busy ? undefined : onClose}
      title="Estä aika"
      subtitle={`${location?.name || ''} · ${dayText(dayKey)}`}
      footer={(
        <div className="bhall-sheet-foot">
          <p className="bhall-sheet-summary">
            <span className={cx('bhall-swatch', `is-${kind}`)} aria-hidden="true" />
            <span className="truncate">
              {ready
                ? `${courtsLabel(selected)} · klo ${hhmm(startMin)}–${hhmm(endMin)} (${durationLabel(length)})`
                : 'Valitse ainakin yksi kenttä.'}
            </span>
          </p>
          <Button variant="dark" size="lg" block icon="lock" loading={busy} disabled={!ready} onClick={submit}>Estä aika</Button>
        </div>
      )}
    >
      <div className="bhall-form">
        <Field label="Nimi" htmlFor="bhall-block-title" error={titleError} hint="Näkyy pelaajille varauskalenterissa.">
          <ChipSelect
            ariaLabel="Valmiit nimet"
            size="sm"
            options={PRESETS}
            value={PRESETS.find((p) => p.value === name)?.value || ''}
            onChange={(v) => { setTitle(v); setTitleError(''); }}
          />
          <Input
            id="bhall-block-title"
            value={title}
            maxLength={80}
            placeholder="esim. Junioreiden valmennus"
            autoComplete="off"
            onChange={(e) => { setTitle(e.target.value); if (titleError) setTitleError(''); }}
          />
        </Field>

        <div className="field">
          <div className="bhall-field-head">
            <span className="field-label" id="bhall-block-courts">Kentät</span>
            {shortcuts.map((s) => (
              <button key={s.sport} type="button" className="bhall-link" onClick={() => setCourtIds(s.ids)}>{s.label}</button>
            ))}
          </div>
          <ChipSelect
            multiple
            size="sm"
            ariaLabel="Kentät"
            className="bhall-court-chips"
            options={courts.map((c) => ({ value: c.id, label: c.shortName }))}
            value={courtIds}
            onChange={setCourtIds}
          />
        </div>

        <div className="field">
          <span className="field-label">Aika</span>
          <div className="bhall-time-row">
            <label className="bhall-time" htmlFor="bhall-block-start">
              <span className="bhall-time-label">Alkaa</span>
              <Select
                id="bhall-block-start"
                options={starts.map((m) => ({ value: String(m), label: hhmm(m) }))}
                value={String(startMin)}
                onChange={(e) => changeStart(e.target.value)}
              />
            </label>
            <label className="bhall-time" htmlFor="bhall-block-end">
              <span className="bhall-time-label">Loppuu</span>
              <Select
                id="bhall-block-end"
                options={ends.map((m) => ({ value: String(m), label: hhmm(m) }))}
                value={String(endMin)}
                onChange={(e) => setEndMin(Number(e.target.value))}
              />
            </label>
          </div>
          {lengths.length > 0 && (
            <ChipSelect
              size="sm"
              ariaLabel="Kesto"
              options={lengths.map((len) => ({ value: String(len), label: durationLabel(len) }))}
              value={lengths.includes(length) ? String(length) : ''}
              onChange={(v) => setEndMin(startMin + Number(v))}
            />
          )}
        </div>

        {conflicts.length > 0 && (
          <div className="bhall-clash" role="status">
            <div className="bhall-clash-head">
              <Icon name="alert" size={16} />
              <span>{conflicts.length === 1 ? 'Ajalla on jo varaus' : `Ajalla on jo ${conflicts.length} varausta`}</span>
            </div>
            <ul className="bhall-clash-list">
              {conflicts.slice(0, 5).map((it) => (
                <li key={it.id}>
                  <strong>{courts.find((c) => c.id === it.courtId)?.shortName}</strong>
                  {' '}{it.kind === 'booking' ? firstName(it.bookedBy?.name) : it.title}
                  {' '}<span className="t-num">{formatTime(it.startsAt)}–{formatTime(it.endsAt)}</span>
                </li>
              ))}
              {conflicts.length > 5 && <li>+ {conflicts.length - 5} muuta</li>}
            </ul>
            {clashIds.length < courtIds.length && (
              <button type="button" className="bhall-link" onClick={() => setCourtIds(courtIds.filter((id) => !clashIds.includes(id)))}>
                Jätä varatut kentät pois
              </button>
            )}
            {clashIds.length === courtIds.length && (
              <p className="bhall-clash-hint">Peru päällekkäiset varaukset ensin tai valitse toinen aika.</p>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
