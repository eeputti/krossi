// trainingForms.jsx — booking or editing a session (one-off or weekly), club events, and the
// series-aware delete.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Button, ChipSelect, Field, Input, Segmented, Sheet, Toggle, useConfirm } from '../ui/index.js';
import { DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { koutsiAddDays, koutsiTodayStr, koutsiWeeklyDates, koutsiFmtShortDate, KOUTSI_EVENT_KINDS, koutsiSortGroupsBySchedule } from '../domain/core.js';
import { matchStudents } from '../domain/roster.js';
import { TRAINING_TYPES } from '../lib/constants.js';
import { useCoach } from './CoachRoot.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
/** Each event kind's icon, in the form's chips and on Viikkohallinta's event bars. */
export const EVENT_ICON = { kilpailu: 'trophy', leiri: 'compass', seura: 'users', muu: 'flag' };
const EVENT_KIND_OPTIONS = KOUTSI_EVENT_KINDS.map((k) => ({ ...k, icon: EVENT_ICON[k.value] }));

/** New session for a player or a group (optionally weekly for a year), or edit one. */
export function TrainingSheet({ open, onClose, editing, defaultDate, defaultGroupId, defaultTime }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const isEdit = Boolean(editing);
  const [target, setTarget] = useState('group');
  const [studentId, setStudentId] = useState(null);
  const [groupId, setGroupId] = useState(null);
  const [date, setDate] = useState(koutsiTodayStr());
  const [time, setTime] = useState('');
  const [type, setType] = useState('Ryhmätreeni');
  const [repeat, setRepeat] = useState(false);
  const [query, setQuery] = useState('');
  // the session's own length: empty until changed, then it overrides the group's (60 min for a private lesson)
  const [duration, setDuration] = useState(null);
  // a session opened on a group (an empty slot in the week) shows that group only, not a long list
  const [allGroups, setAllGroups] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap must not book a year-long series twice
  useEffect(() => {
    if (!open) return;
    setTarget(editing ? (editing.groupId ? 'group' : 'student') : (state.groups.length ? 'group' : 'student'));
    setStudentId(editing?.studentId || null);
    setGroupId(editing?.groupId || defaultGroupId || null);
    setDate(editing?.date || defaultDate || koutsiTodayStr());
    setTime(editing?.time || defaultTime || '');
    setType(editing?.type || (state.groups.length ? 'Ryhmätreeni' : 'Yksityistunti'));
    setDuration(editing?.durationMinutes || null);
    setAllGroups(!(defaultGroupId && !editing));
    setRepeat(false); setQuery('');
  }, [open, editing, defaultDate, defaultGroupId, defaultTime, state.groups.length]);
  useEffect(() => { if (!isEdit) setType(target === 'group' ? 'Ryhmätreeni' : 'Yksityistunti'); }, [target, isEdit]);
  const types = TRAINING_TYPES[target];
  const repeatUntil = repeat && date ? koutsiAddDays(date, 365) : null;
  const occurrences = repeatUntil ? koutsiWeeklyDates(date, repeatUntil).length : 1;
  const ready = (target === 'student' ? studentId : groupId) && date && time && types.includes(type) && !busy;
  const pickedGroup = (target === 'group' ? groupId : editing?.groupId) ? state.groups.find((g) => g.id === (target === 'group' ? groupId : editing?.groupId)) : null;
  const baseDuration = pickedGroup?.durationMinutes || 60;
  const shownDuration = duration || baseDuration;
  // stored only when it differs from the group's own length (a group session follows its group)
  const durationToSave = duration && duration !== (pickedGroup ? pickedGroup.durationMinutes || 60 : null) ? duration : (pickedGroup ? null : duration || 60);
  const missing = !(target === 'student' ? studentId : groupId) ? (target === 'student' ? 'Valitse pelaaja.' : 'Valitse ryhmä.')
    : !date ? 'Valitse päivä.' : !time ? 'Valitse kellonaika.' : !types.includes(type) ? 'Valitse treenin tyyppi.' : null;
  const students = useMemo(() => (query.trim() ? matchStudents(state.students, query, { limit: 40 }) : state.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi'))), [state.students, query]);
  const groups = koutsiSortGroupsBySchedule(state.groups);

  const save = async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const res = isEdit
      ? await run(() => api.trainings.update(editing.id, { date, time, type, durationMinutes: durationToSave }), 'Treeni päivitetty.')
      : await run(() => api.trainings.add({ coachId, studentId: target === 'student' ? studentId : null, groupId: target === 'group' ? groupId : null, date, time, type, repeatUntil, durationMinutes: durationToSave }),
        repeatUntil ? `Viikoittainen sarja lisätty (${occurrences} kertaa).` : 'Treeni lisätty.');
    busyRef.current = false; setBusy(false);
    if (res.ok) onClose();
  };
  const saveSeries = async () => {
    if (busyRef.current || !editing?.seriesId) return;
    busyRef.current = true; setBusy(true);
    const from = editing.date < koutsiTodayStr() ? koutsiTodayStr() : editing.date;
    const res = await run(() => api.trainings.updateSeries(editing.seriesId, { time, type, durationMinutes: durationToSave }, from), 'Koko sarja päivitetty.');
    busyRef.current = false; setBusy(false);
    if (res.ok) onClose();
  };

  const footer = (
    <div className={cx('sheet-actions', isEdit && editing?.seriesId && 'sheet-actions-stack')}>
      {isEdit && editing?.seriesId ? (
        <>
          <Button variant="dark" size="lg" block missing={!time ? 'Valitse kellonaika.' : null} loading={busy} onClick={saveSeries}>Muuta koko sarja (aika ja tyyppi)</Button>
          <Button variant="outline" size="lg" block missing={missing} disabled={busy} onClick={save}>Muuta vain tämä kerta</Button>
        </>
      ) : (
        <>
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" missing={missing} loading={busy} onClick={save}>{isEdit ? 'Tallenna' : occurrences > 1 ? `Lisää ${occurrences} kertaa` : 'Lisää'}</Button>
        </>
      )}
    </div>
  );
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={isEdit ? 'Muokkaa treeniä' : 'Uusi treeni'} size="md" dismissible={!busy} footer={footer}>
      <div className="stack-4">
        {!isEdit && (
          <Segmented ariaLabel="Kenelle" value={target} onChange={setTarget} options={[{ value: 'group', label: 'Ryhmä', icon: 'users' }, { value: 'student', label: 'Pelaaja', icon: 'user' }]} />
        )}
        {!isEdit && target === 'group' && (
          <Field label="Ryhmä">
            {groups.length === 0 ? <p className="field-msg">Ei vielä ryhmiä — luo ryhmä Viikkohallinnan plus-napista.</p> : (
              <div className="k-pick-list">
                {(allGroups ? groups : groups.filter((g) => g.id === groupId)).map((g) => (
                  <label key={g.id} className={cx('k-pick', groupId === g.id && 'is-on')}>
                    <input type="radio" name="tr-group" checked={groupId === g.id} onChange={() => setGroupId(g.id)} />
                    <span className="grow"><span className="k-pick-title">{g.day} {g.time} · {g.name}</span><span className="k-faint">{[g.level, `${g.memberIds.length} pel.`].filter(Boolean).join(' · ')}</span></span>
                  </label>
                ))}
                {!allGroups && <button type="button" className="k-textlink" onClick={() => setAllGroups(true)}>Valitse toinen ryhmä</button>}
              </div>
            )}
          </Field>
        )}
        {!isEdit && target === 'student' && (
          <Field label="Pelaaja">
            {state.students.length > 6 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
            <div className="k-pick-list">
              {students.map((s) => (
                <label key={s.id} className={cx('k-pick', studentId === s.id && 'is-on')}>
                  <input type="radio" name="tr-student" checked={studentId === s.id} onChange={() => setStudentId(s.id)} />
                  <Avatar person={s} size={28} /><span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
        <div className="k-two">
          <Field label="Päivä" htmlFor="tr-date"><Input id="tr-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Kellonaika"><TimeSelect value={time} onChange={setTime} /></Field>
        </div>
        <Field label="Kesto" hint={pickedGroup && !duration ? `Ryhmän oma kesto. Muuta, jos tämä ${isEdit || !repeat ? 'kerta' : 'sarja'} on eri mittainen.` : null}>
          <DurationStepper value={shownDuration} onChange={setDuration} />
        </Field>
        <Field label="Tyyppi"><ChipSelect size="sm" options={types.map((t) => ({ value: t, label: t }))} value={type} onChange={(v) => v && setType(v)} ariaLabel="Tyyppi" /></Field>
        {!isEdit && (
          <Toggle checked={repeat} onChange={setRepeat} label="Toistuu viikoittain" hint={repeat ? `Luodaan vuodeksi eteenpäin (${occurrences} kertaa). Sarjan voi lopettaa milloin tahansa.` : 'Esim. viikoittainen yksityistunti.'} icon="repeat" />
        )}
        {isEdit && editing?.seriesId && <p className="field-msg">Tämä treeni kuuluu viikoittaiseen sarjaan. Päivän voi muuttaa vain tälle kerralle.</p>}
      </div>
    </Sheet>
  );
}

/** "Poista" for a session: a series asks whether to remove all upcoming or just this one. */
export function useTrainingDelete() {
  const { run } = useData();
  const confirm = useConfirm();
  return async (t, label) => {
    if (!t.seriesId) {
      if (!(await confirm({ title: 'Poista treeni?', message: `${label}. Pelaajat saavat ilmoituksen peruutuksesta.`, confirmLabel: 'Poista', danger: true }))) return false;
      return (await run(() => api.trainings.remove(t.id), 'Treeni poistettu.')).ok;
    }
    // "Kaikki tulevat" never reaches into the past, even from an already-held session.
    const from = t.date < koutsiTodayStr() ? koutsiTodayStr() : t.date;
    let remaining = 0;
    try { remaining = await api.trainings.countSeriesRemaining(t.seriesId, from); } catch { /* single-session wording */ }
    const choice = await confirm({
      title: 'Poista sarjan treenejä?',
      message: `${label} kuuluu viikoittaiseen sarjaan${remaining ? ` (${remaining} tulevaa kertaa)` : ''}. Poistetaanko vain tämä vai kaikki tulevat? Menneet treenit säilyvät.`,
      // the common case (one session off) is the main button; the whole series is the second choice
      confirmLabel: 'Poista vain tämä kerta',
      secondaryLabel: remaining ? `Poista kaikki ${remaining} tulevaa` : 'Poista kaikki tulevat', secondaryValue: 'all', cancelLabel: 'Peruuta', danger: true,
    });
    if (choice === 'all') return (await run(() => api.trainings.removeSeries(t.seriesId, from), 'Sarjan tulevat treenit poistettu.')).ok;
    if (choice === true) return (await run(() => api.trainings.remove(t.id), 'Treeni poistettu.')).ok;
    return false;
  };
}

/** Club events, tournaments and camps (also multi-day) on the calendar. */
export function EventSheet({ open, onClose, editing, defaultDate }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const confirm = useConfirm();
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(koutsiTodayStr());
  const [endDate, setEndDate] = useState('');
  const [kind, setKind] = useState('seura');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setTitle(editing?.title || ''); setDate(editing?.date || defaultDate || koutsiTodayStr());
    setEndDate(editing?.endDate || ''); setKind(editing?.kind || 'seura');
  }, [open, editing, defaultDate]);
  const ready = title.trim() && date && (!endDate || endDate >= date) && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const fields = { title: title.trim(), date, endDate: endDate || null, kind };
    const res = editing ? await run(() => api.events.update(editing.id, fields), 'Tapahtuma päivitetty.') : await run(() => api.events.add(coachId, fields), 'Tapahtuma lisätty.');
    setBusy(false);
    if (res.ok) onClose();
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Poista tapahtuma?', message: `${editing.title} — ${koutsiFmtShortDate(editing.date)}`, confirmLabel: 'Poista', danger: true }))) return;
    const res = await run(() => api.events.remove(editing.id), 'Tapahtuma poistettu.');
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa tapahtumaa' : 'Uusi tapahtuma'} confirmClose={!editing && Boolean(title.trim())} subtitle="Kilpailut, leirit ja seuran tapahtumat näkyvät pelaajien kalenterissa." size="sm"
      footer={<div className="sheet-actions">{editing ? <Button variant="ghost" size="lg" onClick={remove}>Poista</Button> : <Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button>}<Button variant="dark" size="lg" missing={!title.trim() ? 'Anna tapahtumalle nimi.' : !date ? 'Valitse päivä.' : endDate && endDate < date ? 'Loppupäivä ei voi olla ennen alkua.' : null} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="ev-title"><Input id="ev-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Seuran syyskisat" maxLength={120} /></Field>
        <Field label="Laji"><ChipSelect size="sm" options={EVENT_KIND_OPTIONS} value={kind} onChange={(v) => v && setKind(v)} ariaLabel="Laji" /></Field>
        <div className="k-two">
          <Field label="Alkaa" htmlFor="ev-start"><Input id="ev-start" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Päättyy" optional htmlFor="ev-end" error={endDate && endDate < date ? 'Ennen alkua' : null}><Input id="ev-end" type="date" value={endDate} min={date} onChange={(e) => setEndDate(e.target.value)} /></Field>
        </div>
      </div>
    </Sheet>
  );
}
