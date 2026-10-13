// sheets.jsx — the player's own writes: mood, match note, own training, goal / wish / note,
// "En pääse", and age. Every free-text field carries the health-data reminder.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, ChipSelect, Field, Input, Segmented, Sheet, Textarea, Toggle } from '../ui/index.js';
import { DurationStepper, TimeSelect } from '../shared/fields.jsx';
import {
  koutsiTodayStr, koutsiFmtShortDate, koutsiTournamentsForStudent, koutsiTournamentOnDateForStudent, koutsiTournamentLabel,
  koutsiTrainingsForStudent,
} from '../domain/core.js';
import { MOOD_LABELS, SELF_TRAINING_TYPES } from '../lib/constants.js';

const cx = (...c) => c.filter(Boolean).join(' ');
export const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';

export function MoodPicker({ value, onChange, size = 'md' }) {
  return (
    <div className={cx('mood-pick', `mood-pick-${size}`)} role="radiogroup" aria-label="Fiilis">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" role="radio" aria-checked={value === n} className={cx('mood-btn', value === n && 'is-on')} data-score={n} onClick={() => onChange(n)}>
          <span className="mood-btn-num t-num">{n}</span>
          <span className="mood-btn-label">{MOOD_LABELS[n]}</span>
        </button>
      ))}
    </div>
  );
}

export function MoodSheet({ open, onClose, studentId, initialScore = null, title = 'Miten treeni meni?' }) {
  const { run } = useData();
  const [score, setScore] = useState(initialScore);
  const [note, setNote] = useState('');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setScore(initialScore); setNote(''); setHidden(false); } }, [open, initialScore]);
  const save = async () => {
    if (!score || busy) return;
    setBusy(true);
    const res = await run(() => api.player.addMood(studentId, { score, note: note.trim(), hiddenFromCoach: hidden }), 'Fiilis tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={title} size="sm"
      footer={<Button variant="dark" size="lg" block disabled={!score} loading={busy} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <MoodPicker value={score} onChange={setScore} />
        <Field label="Miksi?" optional htmlFor="mood-note"><Textarea id="mood-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} /></Field>
        <p className="k-warn-text">{HEALTH_NOTE}</p>
        <Toggle icon="lock" checked={hidden} onChange={setHidden} label="Vain minulle" hint="Piilotettu fiilis ei näy valmentajalle." />
      </div>
    </Sheet>
  );
}

export function MatchNoteSheet({ open, onClose, editing, defaultDate }) {
  const { state, run, ownerId } = useData();
  const tournaments = koutsiTournamentsForStudent(state, ownerId);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) { setF(null); return; }
    const date = editing?.date || defaultDate || koutsiTodayStr();
    setF({
      opponentName: editing?.opponentName || '', opponent2Name: editing?.opponent2Name || '', partnerName: editing?.partnerName || '',
      date, result: editing?.result || '', format: editing?.format || 'kaksinpeli', durationMinutes: editing?.durationMinutes || '',
      score: editing?.score || '', note: editing?.note || '',
      tournamentId: editing ? editing.tournamentId || '' : (koutsiTournamentOnDateForStudent(state, ownerId, date)?.id || ''),
    });
  }, [open, editing, defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const ready = f.opponentName.trim() && f.date && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const payload = { ...f, opponentName: f.opponentName.trim(), durationMinutes: f.durationMinutes ? Number(f.durationMinutes) : null, tournamentId: f.tournamentId || null };
    const res = editing
      ? await run(() => api.player.updateMatchNote(editing.id, payload), 'Muistiinpano päivitetty.')
      : await run(() => api.player.addMatchNote(ownerId, payload), 'Ottelu tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  const doubles = f.format === 'nelinpeli';
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa ottelua' : 'Ottelumuistiinpano'} size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Segmented ariaLabel="Laji" value={f.format} onChange={set('format')} options={[{ value: 'kaksinpeli', label: 'Kaksinpeli' }, { value: 'nelinpeli', label: 'Nelinpeli' }]} />
        {doubles && <Field label="Parisi" optional htmlFor="mn-partner"><Input id="mn-partner" value={f.partnerName} onChange={set('partnerName')} maxLength={120} /></Field>}
        <Field label={doubles ? 'Vastustaja 1' : 'Vastustaja'} htmlFor="mn-opp"><Input id="mn-opp" value={f.opponentName} onChange={set('opponentName')} maxLength={120} placeholder="Nimi" /></Field>
        {doubles && <Field label="Vastustaja 2" optional htmlFor="mn-opp2"><Input id="mn-opp2" value={f.opponent2Name} onChange={set('opponent2Name')} maxLength={120} /></Field>}
        <div className="k-two">
          <Field label="Päivä" htmlFor="mn-date"><Input id="mn-date" type="date" value={f.date} onChange={set('date')} /></Field>
          <Field label="Tulos" optional htmlFor="mn-score"><Input id="mn-score" value={f.score} onChange={set('score')} placeholder="6-4 6-3" maxLength={40} /></Field>
        </div>
        <Field label="Lopputulos" optional>
          <ChipSelect size="sm" allowEmpty options={[{ value: 'voitto', label: 'Voitto' }, { value: 'tappio', label: 'Tappio' }]} value={f.result} onChange={set('result')} ariaLabel="Lopputulos" />
        </Field>
        <Field label="Kesto (min)" optional htmlFor="mn-dur"><Input id="mn-dur" inputMode="numeric" value={f.durationMinutes} onChange={(e) => set('durationMinutes')(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} /></Field>
        {tournaments.length > 0 && (
          <Field label="Turnaus" optional>
            <ChipSelect size="sm" allowEmpty options={tournaments.map((t) => ({ value: t.id, label: koutsiTournamentLabel(t) }))} value={f.tournamentId} onChange={set('tournamentId')} ariaLabel="Turnaus" />
          </Field>
        )}
        <Field label="Muistiinpanot" optional htmlFor="mn-note" hint="Taktiikka, mikä toimi, mitä huomasit vastustajasta.">
          <Textarea id="mn-note" rows={4} value={f.note} onChange={set('note')} maxLength={4000} />
        </Field>
        <p className="k-warn-text">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}

const NOTE_HINTS = {
  'Omatoiminen harjoitus': 'Esim. Syöttöjä seinää vasten, kaverin kanssa lyöntejä.',
  Fysiikka: 'Esim. Kuntosali, juoksu, liikkuvuus.',
  'Muu liikunta': 'Esim. Sulkapallo, uinti, pyöräily.',
  Turnaus: 'Esim. Piirinmestaruuskisat, Lahti.',
};

export function SelfTrainingSheet({ open, onClose, defaultDate, onSwitchToMatch }) {
  const { state, run, ownerId } = useData();
  const coaches = state.coaches || [];
  const [type, setType] = useState('Omatoiminen harjoitus');
  const [date, setDate] = useState(koutsiTodayStr());
  const [time, setTime] = useState('12:00');
  const [duration, setDuration] = useState(60);
  const [endDate, setEndDate] = useState('');
  const [notes, setNotes] = useState('');
  const [coachId, setCoachId] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  useEffect(() => {
    if (!open) return;
    setType('Omatoiminen harjoitus'); setDate(defaultDate || koutsiTodayStr()); setTime('12:00'); setDuration(60); setEndDate(''); setNotes('');
    setCoachId(coaches[0]?.id || null);
  }, [open, defaultDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const isTournament = type === 'Turnaus';
  const isMatch = type === 'Ottelu';
  const ready = !busy && coachId && (isTournament || (time && duration > 0));
  const save = async () => {
    if (isMatch) { onClose(); onSwitchToMatch?.(date); return; }
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const res = await run(() => api.player.addSelfTraining({
      studentId: ownerId, coachId, date, endDate: isTournament && endDate ? endDate : null,
      time, type, durationMinutes: isTournament ? null : duration, notes: notes.trim(),
    }), isTournament ? 'Turnaus kirjattu.' : 'Treeni kirjattu — hienoa!');
    busyRef.current = false; setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Kirjaa oma treeni" subtitle="Omatoiminen harjoitus, fysiikka, muu laji tai turnaus — näkyy valmentajallesi." size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" disabled={!isMatch && !ready} loading={busy} onClick={save}>{isMatch ? 'Jatka ottelun kirjaukseen' : 'Tallenna'}</Button></div>}>
      <div className="stack-4">
        <Field label="Mitä teit?"><ChipSelect size="sm" options={SELF_TRAINING_TYPES.map((t) => ({ value: t, label: t }))} value={type} onChange={(v) => v && setType(v)} ariaLabel="Laji" /></Field>
        {coaches.length > 1 && !isMatch && (
          <Field label="Kenen valmennukseen?"><ChipSelect size="sm" options={coaches.map((c) => ({ value: c.id, label: c.name }))} value={coachId} onChange={(v) => v && setCoachId(v)} ariaLabel="Valmentaja" /></Field>
        )}
        {!isMatch && (
          <>
            <div className="k-two">
              <Field label={isTournament ? 'Alkaa' : 'Päivä'} htmlFor="st-date"><Input id="st-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              {isTournament
                ? <Field label="Päättyy" optional htmlFor="st-end"><Input id="st-end" type="date" min={date} value={endDate} onChange={(e) => setEndDate(e.target.value)} /></Field>
                : <Field label="Kellonaika"><TimeSelect value={time} onChange={setTime} /></Field>}
            </div>
            {!isTournament && <Field label="Kesto"><DurationStepper value={duration} onChange={setDuration} /></Field>}
            <Field label={isTournament ? 'Turnauksen nimi' : 'Kuvaus'} optional htmlFor="st-notes"><Textarea id="st-notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={NOTE_HINTS[type] || ''} maxLength={1000} /></Field>
            <p className="k-warn-text">{HEALTH_NOTE}</p>
          </>
        )}
        {isMatch && <p className="k-quiet-text">Ottelusta kirjataan vastustaja, tulos ja muistiinpanot omalla lomakkeellaan.</p>}
      </div>
    </Sheet>
  );
}

/** Goal, wish or own note: one text, with its history kept. kind: 'goal' | 'wish' | 'note' */
export function PlayerTextSheet({ open, onClose, kind, initial }) {
  const { run, ownerId } = useData();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setText(initial || ''); }, [open, initial]);
  const meta = {
    goal: { title: 'Tavoitteeni', hint: 'Mitä haluat oppia tai saavuttaa tällä kaudella?', placeholder: 'Esim. Varmempi kakkossyöttö', save: (t) => api.player.saveGoal(ownerId, t), done: 'Tavoite tallennettu.' },
    wish: { title: 'Toive valmentajalle', hint: 'Mitä haluaisit harjoitella seuraavaksi?', placeholder: 'Esim. Enemmän verkkopeliä', save: (t) => api.player.saveWish(ownerId, t), done: 'Toive lähetetty valmentajalle.' },
    note: { title: 'Oma muistiinpano', hint: 'Muistiinpano itsellesi ja valmentajalle.', placeholder: '', save: (t) => api.player.saveNote(ownerId, t), done: 'Muistiinpano tallennettu.' },
  }[kind || 'goal'];
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const res = await run(() => meta.save(text.trim()), meta.done);
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={meta.title} subtitle={meta.hint} size="sm" dismissible={!busy}
      footer={<Button variant="dark" size="lg" block loading={busy} disabled={text.trim() === (initial || '').trim()} onClick={save}>Tallenna</Button>}>
      <div className="stack-3">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={meta.placeholder} autoFocus maxLength={1000} aria-label={meta.title} />
        <p className="k-warn-text">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}

/** "En pääse": absent from this and optionally the next few sessions. No reason is asked. */
export function AbsenceSheet({ open, onClose, training }) {
  const { state, run, ownerId } = useData();
  const [count, setCount] = useState(1);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setCount(1); }, [open]);
  if (!training) return null;
  const key = `${training.date}T${training.time || '00:00'}`;
  const candidates = koutsiTrainingsForStudent(state, ownerId)
    .filter((t) => t.loggedBy !== 'player' && `${t.date}T${t.time || '00:00'}` >= key)
    .slice(0, 4);
  const absentNow = (training.absences || []).some((a) => a.studentId === ownerId);
  const save = async (status) => {
    setBusy(true);
    const ids = status === 'paikalla' ? [training.id] : candidates.slice(0, count).map((t) => t.id);
    const res = await run(() => api.attendance.set(ids, ownerId, status), status === 'paikalla' ? 'Merkitty: pääset paikalle.' : 'Poissaolo ilmoitettu valmentajalle.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={absentNow ? 'Pääsetkin paikalle?' : 'En pääse'} subtitle={`${koutsiFmtShortDate(training.date)} klo ${training.time} · ${training.type}`} size="sm"
      footer={absentNow
        ? <Button variant="dark" size="lg" block loading={busy} onClick={() => save('paikalla')}>Pääsen sittenkin</Button>
        : <Button variant="dark" size="lg" block loading={busy} onClick={() => save('poissa')}>Ilmoita poissaolo</Button>}>
      {!absentNow && candidates.length > 1 && (
        <Field label="Kuinka moneen treeniin?">
          <ChipSelect size="sm" options={candidates.map((t, i) => ({ value: String(i + 1), label: i === 0 ? 'Vain tähän' : `${i + 1} treeniin (${koutsiFmtShortDate(t.date)} asti)` }))} value={String(count)} onChange={(v) => v && setCount(Number(v))} ariaLabel="Montako treeniä" />
        </Field>
      )}
      <p className="field-msg">Valmentajasi näkee poissaolon heti. Syytä ei kysytä eikä tallenneta.</p>
    </Sheet>
  );
}

/** The player's own name and optional exact age (shared profile row). */
export function PlayerProfileSheet({ open, onClose, student }) {
  const { run, ownerId } = useData();
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open && student) { setName(student.name || ''); setAge(student.age == null ? '' : String(student.age)); } }, [open, student]);
  if (!student) return null;
  const n = age ? Number(age) : null;
  const ageValid = n == null || (Number.isInteger(n) && n >= 1 && n < 120);
  const save = async () => {
    if (!name.trim() || !ageValid || busy) return;
    setBusy(true);
    const res = await run(async () => {
      if (name.trim() !== student.name) await api.account.saveDisplayName(ownerId, name.trim());
      if ((student.age ?? null) !== n) await api.player.saveAge(ownerId, n);
    }, 'Tiedot tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Omat tiedot" size="sm"
      footer={<Button variant="dark" size="lg" block disabled={!name.trim() || !ageValid} loading={busy} onClick={save}>Tallenna</Button>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="pp-name"><Input id="pp-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
        <Field label="Ikä" optional htmlFor="pp-age" error={!ageValid ? 'Iän pitää olla 1–119 vuotta.' : null} hint="Ikää ei tarvitse ilmoittaa.">
          <Input id="pp-age" inputMode="numeric" value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} />
        </Field>
      </div>
    </Sheet>
  );
}
