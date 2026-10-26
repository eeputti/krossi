// sheets.jsx — the player's own writes: mood, match note, own training (and its edit), goal / wish / note,
// "En pääse". Every free-text field carries the health-data reminder.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, ChipSelect, Field, Icon, Input, Segmented, Sheet, Textarea, Toggle } from '../ui/index.js';
import { DurationStepper, TimeSelect } from '../shared/fields.jsx';
import {
  koutsiTodayStr, koutsiFmtShortDate, koutsiTournamentsForStudent, koutsiTournamentOnDateForStudent, koutsiTournamentLabel,
  koutsiTrainingsForStudent,
} from '../domain/core.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { ACTIVITIES, activityById, defaultLogTime, ownEntry, ownNotes } from '../domain/ownWeek.js';
import { ActivityIcon } from './ActivityIcon.jsx';

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
      footer={<Button variant="dark" size="lg" block missing={!score ? 'Valitse ensin fiilis 1–5.' : null} loading={busy} onClick={save}>Tallenna</Button>}>
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
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa ottelua' : 'Ottelumuistiinpano'} size="md" confirmClose={!editing && Boolean(f.opponentName.trim() || f.note.trim() || f.score.trim())}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" missing={!f.opponentName.trim() ? 'Kirjoita vastustajan nimi.' : !f.date ? 'Valitse päivä.' : null} loading={busy} onClick={save}>Tallenna</Button></div>}>
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

/**
 * "Kirjaa oma treeni": what was done (one tap on a tile), when and how long, a few words. It is
 * the player's own entry — no coach to pick — and every coach of the player sees it. Also edits
 * an entry (`editing`), and logs a homework as done (`activity: 'kotilaksy'`, `homeworkId`).
 */
export function SelfTrainingSheet({ open, onClose, defaultDate, defaultTime, editing, preset, onSwitchToMatch }) {
  const { state, run, ownerId } = useData();
  const coaches = state.coaches || [];
  const student = state.students[0];
  const openHomework = (student?.homework || []).filter((h) => !h.done || h.id === preset?.homeworkId);
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const startText = useRef('');
  useEffect(() => {
    if (!open) { setF(null); return; }
    if (editing) {
      const e = ownEntry(editing);
      startText.current = e.activity === 'turnaus' ? (editing.notes || '') : e.text;
      setF({ activity: e.activity, date: editing.date, time: editing.time || '17:00', duration: editing.durationMinutes || 60, endDate: editing.endDate || '', text: e.activity === 'turnaus' ? (editing.notes || '') : e.text, homeworkId: null });
      return;
    }
    const activity = preset?.activity || 'tennis';
    const date = defaultDate || koutsiTodayStr();
    const hw = preset?.homeworkId || openHomework[0]?.id || null;
    startText.current = '';
    setF({
      activity, date, time: defaultTime || defaultLogTime(date), duration: activityById(activity).duration || 60, endDate: '',
      text: activity === 'kotilaksy' ? (openHomework.find((h) => h.id === hw)?.text || '') : '', homeworkId: activity === 'kotilaksy' ? hw : null,
    });
  }, [open, editing, defaultDate, defaultTime, preset]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!f) return null;
  const a = activityById(f.activity);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const pick = (id) => setF((x) => {
    const next = activityById(id);
    const hw = next.homework ? (x.homeworkId || openHomework[0]?.id || null) : null;
    return {
      ...x, activity: id, homeworkId: hw,
      // the usual length of the new kind, unless the player already changed it
      duration: !editing && x.duration === activityById(x.activity).duration ? (next.duration || x.duration) : x.duration,
      text: next.homework && !x.text ? (openHomework.find((h) => h.id === hw)?.text || '') : x.text,
    };
  });
  const pickHomework = (id) => setF((x) => {
    const before = openHomework.find((h) => h.id === x.homeworkId)?.text || '';
    return { ...x, homeworkId: id, text: !x.text || x.text === before ? (openHomework.find((h) => h.id === id)?.text || '') : x.text };
  });
  const isTournament = a.id === 'turnaus';
  // An entry stays with the coach it was written under while that coaching goes on; a new one,
  // or one whose coach has left, goes under a current coach. Every coach of the player sees it.
  const coachId = editing && coaches.some((c) => c.id === editing.coachId) ? editing.coachId : coaches[0]?.id || null;
  const ready = !busy && coachId && f.date && (isTournament || (f.time && f.duration > 0));
  const save = async () => {
    if (a.match) { onClose(); onSwitchToMatch?.(f.date); return; }
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const payload = {
      studentId: ownerId, coachId, date: f.date, endDate: isTournament && f.endDate ? f.endDate : null,
      time: isTournament ? (editing?.time || '12:00') : f.time, type: a.type, durationMinutes: isTournament ? null : f.duration,
      notes: isTournament ? f.text.trim() : ownNotes(a.id, f.text),
    };
    const hw = a.homework && f.homeworkId ? openHomework.find((h) => h.id === f.homeworkId) : null;
    const res = await run(async () => {
      if (editing) await api.player.updateSelfTraining(editing.id, payload);
      else await api.player.addSelfTraining(payload);
      if (hw && !hw.done) await api.homework.toggleDone(hw.id, true);
    }, editing ? 'Merkintä päivitetty.' : isTournament ? 'Turnaus kirjattu.' : hw ? 'Kotiläksy tehty ja kirjattu — hienoa!' : 'Treeni kirjattu — hienoa!');
    busyRef.current = false; setBusy(false);
    if (res.ok) onClose();
  };
  const tiles = ACTIVITIES.filter((x) => (!x.hidden || x.id === f.activity) && (!x.homework || openHomework.length > 0 || x.id === f.activity) && (!editing || !x.match));
  // From Merkitse the kind was already picked with one tap: the form opens under its name.
  const locked = Boolean(preset?.locked) && !editing;
  // Words the player wrote (not the homework text filled in for them) are asked about before closing.
  const autoText = a.homework ? (openHomework.find((h) => h.id === f.homeworkId)?.text || '') : '';
  const typed = Boolean(f.text.trim()) && f.text.trim() !== startText.current.trim() && f.text.trim() !== autoText.trim();
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} confirmClose={!busy && typed} title={editing ? 'Muokkaa merkintää' : locked ? a.title : 'Kirjaa oma treeni'} subtitle="Oma merkintäsi. Kaikki valmentajasi näkevät sen." size="md"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" missing={a.match ? null : !coachId ? 'Liity ensin valmentajan ryhmään (Lisää → Liity ryhmään), niin voit kirjata treenejä.' : !f.date ? 'Valitse päivä.' : !isTournament && !f.time ? 'Valitse kellonaika.' : !isTournament && !(f.duration > 0) ? 'Valitse kesto.' : null} loading={busy} onClick={save}>{a.match ? 'Jatka ottelun kirjaukseen' : 'Tallenna'}</Button></div>}>
      <div className="stack-4">
        {!locked && <div className="pw-acts" role="radiogroup" aria-label="Mitä teit?">
          {tiles.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={x.id === f.activity} className={cx('pw-act', x.id === f.activity && 'is-on')} onClick={() => pick(x.id)}>
              <span className="pw-act-icon"><ActivityIcon activity={x.id} size={22} /></span>
              <span className="pw-act-label">{x.label}</span>
            </button>
          ))}
        </div>}
        {a.homework && openHomework.length > 1 && (
          <Field label="Mikä kotiläksy?">
            <div className="pw-hw-pick">
              {openHomework.map((h) => (
                <button key={h.id} type="button" className={cx('pw-hw-opt', h.id === f.homeworkId && 'is-on')} onClick={() => pickHomework(h.id)}>
                  <span className={cx('k-check-btn', h.id === f.homeworkId && 'is-on')}><Icon name="check" size={14} strokeWidth={3} /></span>
                  <span className="grow">{h.text}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        {!a.match && (
          <>
            <div className="k-two">
              <Field label={isTournament ? 'Alkaa' : 'Päivä'} htmlFor="st-date"><Input id="st-date" type="date" value={f.date} onChange={set('date')} /></Field>
              {isTournament
                ? <Field label="Päättyy" optional htmlFor="st-end"><Input id="st-end" type="date" min={f.date} value={f.endDate} onChange={set('endDate')} /></Field>
                : <Field label="Alkoi klo"><TimeSelect value={f.time} onChange={set('time')} /></Field>}
            </div>
            {!isTournament && <Field label="Kesto"><DurationStepper value={f.duration} onChange={set('duration')} /></Field>}
            <Field label={isTournament ? 'Turnauksen nimi' : 'Mitä teit?'} optional htmlFor="st-notes">
              <Textarea id="st-notes" rows={2} value={f.text} onChange={set('text')} placeholder={a.placeholder || ''} maxLength={900} />
            </Field>
            <p className="k-warn-text">{HEALTH_NOTE}</p>
            {coaches.length === 0 && <p className="field-msg">Voit kirjata omia treenejä, kun olet liittynyt valmentajan ryhmään.</p>}
          </>
        )}
        {a.match && <p className="k-quiet-text">Ottelusta kirjataan vastustaja, tulos ja muistiinpanot omalla lomakkeellaan.</p>}
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
    note: { title: 'Kommentti valmentajalle', hint: 'Valmentajasi näkee tämän.', placeholder: '', save: (t) => api.player.saveNote(ownerId, t), done: 'Kommentti tallennettu.' },
  }[kind || 'goal'];
  const save = async () => {
    if (busy) return;
    setBusy(true);
    const res = await run(() => meta.save(text.trim()), meta.done);
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={meta.title} subtitle={meta.hint} size="sm" dismissible={!busy} confirmClose={text.trim() !== (initial || '').trim()}
      footer={<Button variant="dark" size="lg" block loading={busy} missing={text.trim() === (initial || '').trim() ? (text.trim() ? 'Et ole muuttanut tekstiä.' : 'Kirjoita ensin.') : null} onClick={save}>Tallenna</Button>}>
      <div className="stack-3">
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} placeholder={meta.placeholder} autoFocus maxLength={1000} aria-label={meta.title} />
        {kind === 'goal' && (initial || '').trim() && <p className="field-msg">Vanha tavoite jää talteen Kehitys-aikajanalle.</p>}
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
      <p className="field-msg">{absentNow ? 'Valmentajasi saa heti tiedon, että tuletkin paikalle.' : 'Valmentajasi saa poissaolosta heti tiedon. Syytä ei kysytä eikä tallenneta.'}</p>
    </Sheet>
  );
}
