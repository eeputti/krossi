// OpenSlotsScreen — Vapaat ajat (coach): the single free times this coach has published for their own
// players to book, by day from today on — an open one can be removed, a booked one opens its lesson —
// and "Vapautuneet": coming private lessons whose player cannot come, one tap from being offered to the
// others. "Lisää ajat" publishes many at once (AddOpenSlotsSheet); each player gets one notice.
// Shown only while the feature is on for the coach (state.openSlotsReady; never while acting). The
// rules live in domain/openSlots.js and the database (koutsi/web/sql/…_koutsi_open_slots.sql).
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link, navigate } from '../app/router.js';
import { Button, EmptyState, Field, Icon, IconButton, Input, Page, PageHeader, Sheet, useConfirm, useToast } from '../ui/index.js';
import { DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { koutsiTodayStr } from '../domain/core.js';
import { minutesLabel, relativeDay, shortDay } from '../domain/week.js';
import {
  SLOTS_PER_PUBLISH, draftProblem, draftSlots, firstDraftRow, freedLessons, hasStarted, isPrivateLesson, nextDraftRow, offerOf,
  slotFromLesson, slotsByDay, slotWhen,
} from '../domain/openSlots.js';
import { sessionPath } from './nav.js';
import { useCoach } from './CoachRoot.jsx';

const nameOf = (state, id) => state.students.find((s) => s.id === id)?.name || 'Pelaaja';
const dayTitle = (date) => {
  const rel = relativeDay(date);
  return rel === 'Tänään' || rel === 'Huomenna' ? `${rel} · ${shortDay(date)}` : shortDay(date);
};

/** Is Vapaat ajat on for this coach right now (not while an admin acts as them)? */
export function useOpenSlotsOn() {
  const { state } = useData();
  const { acting } = useCoach();
  return Boolean(state.openSlotsReady) && !acting;
}

/** "3 vapaana · 1 varattu" for the page, the side nav and Lisää. */
export function openSlotsSummary(state) {
  const coming = (state.openSlots || []).filter((s) => !hasStarted(s));
  const open = coming.filter((s) => !s.bookedBy).length;
  const booked = coming.length - open;
  if (!coming.length) return 'Lisää ajat, jotka pelaajasi voivat varata';
  return [`${open} vapaana`, booked ? `${booked} varattu` : null].filter(Boolean).join(' · ');
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

/** On a private lesson's page: its player cannot come → offer the time to the others (or how it went). */
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
export function AddOpenSlotsSheet({ open, onClose }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [duration, setDuration] = useState(60);
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap must not publish twice
  const keys = useRef(0);
  // nothing guessed: today, no time, an hour, no place
  useEffect(() => {
    if (!open) return;
    setRows([{ ...firstDraftRow(), key: keys.current++ }]);
    setDuration(60);
    setPlace('');
  }, [open]);
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

export function OpenSlotsScreen() {
  const { state, run } = useData();
  const on = useOpenSlotsOn();
  const confirm = useConfirm();
  const offer = useOfferFreed();
  const [addOpen, setAddOpen] = useState(false);
  const [offering, setOffering] = useState(null);
  // a typed address while the feature is off (or while acting) leads home
  useEffect(() => { if (!on) navigate('/valmentaja/koti', { replace: true }); }, [on]);
  if (!on) return null;
  const days = slotsByDay(state.openSlots);
  const freed = freedLessons(state.trainings, state.openSlots);
  const remove = async (s) => {
    if (!(await confirm({ title: 'Poista vapaa aika?', message: slotWhen(s), confirmLabel: 'Poista', danger: true }))) return;
    await run(() => api.openSlots.remove(s.id), 'Vapaa aika poistettu.');
  };
  const offerOne = async (t) => { setOffering(t.id); await offer(t); setOffering(null); };
  return (
    <Page>
      <PageHeader title="Vapaat ajat" subtitle={openSlotsSummary(state)}
        actions={days.length > 0 && <Button variant="dark" size="sm" icon="plus" onClick={() => setAddOpen(true)}>Lisää ajat</Button>} />
      <div className="stack-5">
        {freed.length > 0 && (
          <section className="k-day-section">
            <h2 className="k-day-title">Vapautuneet</h2>
            <div className="k-list">
              {freed.map((t) => (
                <div key={t.id} className="k-row">
                  <span className="k-session-time"><span className="k-session-date">{relativeDay(t.date)}</span><span className="t-num">{t.time}</span></span>
                  <span className="k-row-main">
                    <span className="k-row-title truncate">{nameOf(state, t.studentId)} ei pääse</span>
                    <span className="k-row-sub truncate">Yksityistunti · {minutesLabel(t.durationMinutes || 60)}</span>
                  </span>
                  <Button variant="outline" size="sm" loading={offering === t.id} onClick={() => offerOne(t)}>Tarjoa muille</Button>
                </div>
              ))}
            </div>
          </section>
        )}
        {days.length === 0 ? (
          <EmptyState art="calendar" title="Ei vapaita aikoja" text="Lisää ajat, jolloin ehdit pitää tunnin. Pelaajasi varaavat ne itse."
            action={<Button variant="dark" icon="plus" onClick={() => setAddOpen(true)}>Lisää vapaita aikoja</Button>} />
        ) : days.map((d) => (
          <section key={d.date} className="k-day-section">
            <h2 className="k-day-title">{dayTitle(d.date)}</h2>
            <div className="k-list">
              {d.slots.map((s) => (s.bookedBy ? (
                <Link key={s.id} to={sessionPath(s.trainingId)} className="k-row">
                  <span className="k-group-time t-num">{s.time}</span>
                  <span className="k-row-main">
                    <span className="k-row-title truncate">{nameOf(state, s.bookedBy)}</span>
                    <span className="k-row-sub truncate">{['Varattu', minutesLabel(s.durationMinutes), s.place].filter(Boolean).join(' · ')}</span>
                  </span>
                  <Icon name="chevron-right" size={18} className="k-chevron" />
                </Link>
              ) : (
                <div key={s.id} className="k-row">
                  <span className="k-group-time t-num">{s.time}</span>
                  <span className="k-row-main">
                    <span className="k-row-title">Vapaa</span>
                    <span className="k-row-sub truncate">{[minutesLabel(s.durationMinutes), s.place].filter(Boolean).join(' · ')}</span>
                  </span>
                  <IconButton icon="trash" label="Poista vapaa aika" onClick={() => remove(s)} />
                </div>
              )))}
            </div>
          </section>
        ))}
      </div>
      <AddOpenSlotsSheet open={addOpen} onClose={() => setAddOpen(false)} />
    </Page>
  );
}
