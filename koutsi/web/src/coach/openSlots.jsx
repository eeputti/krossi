// openSlots.jsx (coach) — Vapaat ajat live in Viikkohallinta's calendar: a free time is a dashed
// "Vapaa aika" block at its time (a tap removes it), a booked one is the player's private lesson.
// The plus menu's "Vapaat ajat" publishes many at once (AddOpenSlotsSheet); each player gets one
// notice. A private lesson whose player cannot come offers "Tarjoa muille" (FreedLessonCard, on its
// block's sheet and its page). Shown only while the feature is on for the coach (state.openSlotsReady;
// never while acting). The rules live in domain/openSlots.js and the database (…_koutsi_open_slots.sql).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Button, Field, IconButton, Input, Sheet, useConfirm, useToast } from '../ui/index.js';
import { DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { koutsiTodayStr } from '../domain/core.js';
import {
  SLOTS_PER_PUBLISH, draftProblem, draftSlots, firstDraftRow, hasStarted, isPrivateLesson, nextDraftRow, offerOf, slotFromLesson, slotWhen,
} from '../domain/openSlots.js';
import { sessionPath } from './nav.js';
import { useCoach } from './CoachRoot.jsx';

const nameOf = (state, id) => state.students.find((s) => s.id === id)?.name || 'Pelaaja';

/** Is Vapaat ajat on for this coach right now (not while an admin acts as them)? */
export function useOpenSlotsOn() {
  const { state } = useData();
  const { acting } = useCoach();
  return Boolean(state.openSlotsReady) && !acting;
}

/** "Tarjoa aika muille": a freed private lesson becomes an open slot with one tap. */
export function useOfferFreed() {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  return async (training) => {
    const res = await run(() => api.openSlots.add(coachId, [slotFromLesson(training, state.openSlots)]), null);
    if (res.ok) toast(res.result ? 'Aika tarjottu muille pelaajillesi.' : 'Aika on jo tarjolla.');
    return res.ok;
  };
}

/** A tap on a free time in the calendar: what it is, and Poista. */
export function useOpenSlotTap() {
  const { run } = useData();
  const confirm = useConfirm();
  return async (slot) => {
    const remove = await confirm({
      title: 'Vapaa aika',
      message: `${[slotWhen(slot), slot.place].filter(Boolean).join(' · ')}. Pelaajasi voivat varata sen.`,
      confirmLabel: 'Poista vapaa aika', cancelLabel: 'Sulje', danger: true,
    });
    if (remove) await run(() => api.openSlots.remove(slot.id), 'Vapaa aika poistettu.');
  };
}

/** On a private lesson's sheet or page: its player cannot come → offer the time to the others (or how it went). */
export function FreedLessonCard({ training }) {
  const { state } = useData();
  const on = useOpenSlotsOn();
  const offer = useOfferFreed();
  const [busy, setBusy] = useState(false);
  if (!on || !isPrivateLesson(training) || hasStarted(training)) return null;
  if (!(training.absences || []).some((a) => a.studentId === training.studentId)) return null;
  const offered = offerOf(state.openSlots, training.id);
  return (
    <div className="k-banner-card">
      <div className="grow">
        <div className="k-banner-title">{nameOf(state, training.studentId)} ei pääse</div>
        <div className="k-banner-sub">
          {offered?.bookedBy ? `Aika on varattu: ${nameOf(state, offered.bookedBy)}.` : offered ? 'Aika on tarjolla muille pelaajillesi.' : 'Voit tarjota ajan muille pelaajillesi.'}
        </div>
      </div>
      {offered?.bookedBy && <Button variant="outline" size="sm" onClick={() => navigate(sessionPath(offered.trainingId))}>Avaa</Button>}
      {!offered && (
        <Button variant="dark" size="sm" loading={busy} onClick={async () => { setBusy(true); await offer(training); setBusy(false); }}>Tarjoa muille</Button>
      )}
    </div>
  );
}

/** "Lisää vapaita aikoja": a row per time (day + start), one length and place for all. */
export function AddOpenSlotsSheet({ open, onClose, defaultDate = null }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [duration, setDuration] = useState(60);
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap must not publish twice
  const keys = useRef(0);
  // nothing guessed: the day in view (today on this week), no time, an hour, no place
  useEffect(() => {
    if (!open) return;
    const first = firstDraftRow();
    setRows([{ ...first, date: defaultDate && defaultDate > first.date ? defaultDate : first.date, key: keys.current++ }]);
    setDuration(60);
    setPlace('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = draftProblem(rows, { durationMinutes: duration, place });
  const setRow = (key, patch) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const addRow = () => setRows((list) => [...list, { ...nextDraftRow(list[list.length - 1], duration), key: keys.current++ }]);
  const dropRow = (key) => setRows((list) => list.filter((r) => r.key !== key));
  const save = async () => {
    if (problem || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const res = await run(() => api.openSlots.add(coachId, draftSlots(rows, { durationMinutes: duration, place })), null);
    busyRef.current = false; setBusy(false);
    if (!res.ok) return;
    toast(res.result === 0 ? 'Nämä ajat ovat jo vapaana.' : res.result === 1 ? 'Vapaa aika julkaistu.' : `${res.result} vapaata aikaa julkaistu.`);
    onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} dismissible={!busy} confirmClose={!busy && rows.some((r) => r.time)} size="md"
      title="Lisää vapaita aikoja" subtitle="Pelaajasi saavat yhden ilmoituksen ja varaavat ajat itse."
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" missing={problem} loading={busy} onClick={save}>{rows.length > 1 ? `Julkaise ${rows.length} aikaa` : 'Julkaise'}</Button>
        </div>
      )}>
      <div className="stack-4">
        {rows.map((r, i) => (
          <div key={r.key} className="k-subcard stack-3">
            <div className="row-between">
              <span className="k-subcard-title">Aika {i + 1}</span>
              {rows.length > 1 && <IconButton icon="close" size="sm" label={`Poista aika ${i + 1}`} onClick={() => dropRow(r.key)} />}
            </div>
            <div className="k-two">
              <Field label="Päivä" htmlFor={`os-date-${r.key}`}>
                <Input id={`os-date-${r.key}`} type="date" min={koutsiTodayStr()} value={r.date} onChange={(e) => setRow(r.key, { date: e.target.value })} />
              </Field>
              <Field label="Alkaa"><TimeSelect value={r.time} onChange={(v) => setRow(r.key, { time: v })} /></Field>
            </div>
          </div>
        ))}
        {rows.length < SLOTS_PER_PUBLISH && <Button variant="outline" icon="plus" onClick={addRow}>Lisää aika</Button>}
        <Field label="Kesto"><DurationStepper value={duration} onChange={setDuration} /></Field>
        <Field label="Paikka" optional htmlFor="os-place">
          <Input id="os-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Esim. Kenttä 2" maxLength={120} />
        </Field>
      </div>
    </Sheet>
  );
}
