// CheckInSheet — "Treenit ohi! Miten meni?" right after a session.
//
// One tap on a number saves the feeling. After that, only if the player wants to: a few words,
// "Vain minulle", or a wish to the coach. Opened from the after-session e-mail, the number
// tapped there is saved as soon as the app opens: only a signed-in player can save anything,
// so a mail scanner that opens the link changes nothing. A feeling already given after the
// session began is shown for editing instead of saving a second one.
//
// Once koutsi_moods.training_id exists (state.moodSessionsReady) the feeling names its session, so
// each of several sessions in a row gets its own; `all` ("Kaikista kerralla") saves one for them all.
import { useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Sheet, Textarea, Toggle } from '../ui/index.js';
import { koutsiGroupById, koutsiThemeForDate } from '../domain/core.js';
import { relativeDay } from '../domain/week.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { HEALTH_NOTE, MoodPicker } from './sheets.jsx';
import { moodFor } from '../domain/playerNow.js';

/**
 * CheckInSheet
 *   open, training (may be null: then it asks about "the last session"), all (sessions answered at once),
 *   initialScore (from the e-mail), onClose(), onWish(), onSelfTraining()
 */
export function CheckInSheet({ open, training, all = null, initialScore = null, known = null, onClose, onWish, onSelfTraining }) {
  const { state, run, reload } = useData();
  const student = state.students[0];
  const [step, setStep] = useState('rate');
  const [mood, setMood] = useState(null); // { id, score }
  const [note, setNote] = useState('');
  const [savedNote, setSavedNote] = useState('');
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState(null); // the number tapped, lit while it saves
  const started = useRef(false);

  // The tapped number lights up at once and the thanks follow as soon as the row is saved; the
  // rest of the app catches up in the background (it used to wait for that, up to 1.5 s).
  const save = async (score) => {
    if (busy) return;
    setBusy(true);
    setPending(score);
    const trainingId = state.moodSessionsReady && training && !all ? training.id : null;
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false, trainingId }), undefined, { refresh: false });
    setBusy(false);
    setPending(null);
    if (!res.ok) return;
    reload().catch(() => {});
    setMood({ id: res.result?.id || null, score });
    setStep('done');
  };

  // Decide once per opening: show an earlier answer, save the e-mail's number, or ask.
  useEffect(() => {
    if (!open) { started.current = false; return; }
    if (started.current) return;
    started.current = true;
    // `known`: a number tapped on a slide a moment ago, before the data has it
    const earlier = training && !all ? moodFor(student, training) || (known?.id ? known : null) : null;
    if (earlier) {
      setMood({ id: earlier.id, score: earlier.score }); setPending(null);
      setNote(earlier.note || ''); setSavedNote(earlier.note || ''); setHidden(!!earlier.hiddenFromCoach);
      setStep('done');
    } else if (initialScore) {
      setNote(''); setSavedNote(''); setHidden(false);
      save(initialScore);
    } else {
      setMood(null); setNote(''); setSavedNote(''); setHidden(false); setPending(null);
      setStep('rate');
    }
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const changeScore = async (score) => {
    if (!mood?.id || score === mood.score) return;
    setMood({ ...mood, score });
    await run(() => api.player.updateMood(mood.id, { score }));
  };
  const changeHidden = async (value) => {
    setHidden(value);
    if (mood?.id) await run(() => api.player.updateMood(mood.id, { hiddenFromCoach: value }), value ? 'Fiilis näkyy vain sinulle.' : 'Valmentajasi näkee fiiliksen.');
  };
  const finish = async (then) => {
    const words = note.trim();
    if (mood?.id && words !== savedNote.trim()) {
      setBusy(true);
      const res = await run(() => api.player.updateMood(mood.id, { note: words }));
      setBusy(false);
      if (!res.ok) return;
    }
    onClose();
    then?.();
  };

  const group = training?.groupId ? koutsiGroupById(state, training.groupId) : null;
  const theme = group && training ? koutsiThemeForDate(group, training.date) : null;
  const when = training ? relativeDay(training.date) : '';
  const context = all?.length
    ? `${relativeDay(all[0].date)} ${all.length} treeniä · ${all.map((t) => koutsiGroupById(state, t.groupId)?.name || t.type).filter((x, i, a) => a.indexOf(x) === i).join(', ')}`
    : training
      ? [when, training.type, group?.name].filter(Boolean).join(' · ')
      : 'Viimeisin treenisi';

  // One sheet for both steps, so saving swaps the content instead of closing and reopening.
  const rating = step === 'rate';
  return (
    <Sheet open={open} onClose={() => !busy && (rating ? onClose() : finish())} size="sm"
      title={rating ? 'Treenit ohi! Miten meni?' : `Kiitos! Fiilis: ${MOOD_LABELS[mood?.score] || 'tallennettu'}`}
      subtitle={context}
      footer={rating ? null : <Button variant="dark" size="lg" block loading={busy} onClick={() => finish()}>Valmis</Button>}>
      {rating ? (
        <div className="stack-4 k-checkin">
          {theme && <p className="k-faint">Teema: <strong>{theme.title}</strong></p>}
          <MoodPicker value={pending} onChange={save} />
          <p className="k-faint">Yksi napautus riittää. Valmentajasi näkee vastauksen, ellet piilota sitä.</p>
        </div>
      ) : (
        <div className="stack-4 k-checkin">
          <MoodPicker value={mood?.score ?? null} onChange={changeScore} size="sm" />
          <Field label="Haluatko kertoa vähän lisää?" optional htmlFor="checkin-note">
            <Textarea id="checkin-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
              placeholder="Esim. syöttö kulki, mutta jalat olivat raskaat" />
          </Field>
          <p className="k-warn-text">{HEALTH_NOTE}</p>
          <Toggle icon="lock" checked={hidden} onChange={changeHidden} label="Vain minulle" hint="Piilotettu fiilis ei näy valmentajalle." />
          <div className="row wrap">
            <Button variant="outline" size="sm" icon="chat" onClick={() => finish(onWish)}>Toive valmentajalle</Button>
            <Button variant="ghost" size="sm" icon="plus" onClick={() => finish(onSelfTraining)}>Kirjaa oma treeni</Button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
