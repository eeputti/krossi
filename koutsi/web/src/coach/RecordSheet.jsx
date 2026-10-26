// RecordSheet — a coach's note ("Huomio") or homework for one player or many: the text, a
// health-data reminder, and who it's for (picked from a group in one tap). Each player gets
// their own copy on their timeline and their own notification; homework is ticked off by each
// player separately. A homework can start from the drill bank: a few drills that suit the
// picked players' theme this week (or can be done alone) are offered while the field is empty,
// and "Kaikki harjoitteet" opens the whole bank (Krossi's library and the coach's own drills).
// Editing one existing entry stays in playerForms' TextEntrySheet.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Icon, Input, Sheet, Textarea } from '../ui/index.js';
import { RecipientPicker } from '../shared/recipients.jsx';
import { sameIds, ScopeLine } from '../shared/scope.jsx';
import { exerciseFacts, exerciseHomeworkText, homeworkSuggestions } from '../domain/exercises.js';
import { asExercises, buildDrillList } from '../domain/drills/index.js';
import { sendLogFor } from '../domain/sends.js';
import { DrillIcon } from '../shared/drills/art.jsx';
import { useDrillLibrary } from '../shared/drills/useLibrary.js';
import { useCoach } from './CoachRoot.jsx';
import { track } from './usage.js';

const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';

const KINDS = {
  note: {
    title: 'Huomio',
    subtitle: 'Näkyy pelaajan aikajanalla.',
    placeholder: 'Esim. Hyvä nousu syötössä tällä viikolla…',
    event: 'huomio',
    done: (n) => (n === 1 ? 'Huomio lähetetty.' : `Huomio lähetetty ${n} pelaajalle.`),
  },
  homework: {
    title: 'Kotiläksy',
    subtitle: 'Jokainen pelaaja merkitsee läksyn tehdyksi omassa näkymässään.',
    placeholder: 'Esim. 20 rystylyöntiä seinää vasten…',
    event: 'laksy',
    done: (n) => (n === 1 ? 'Kotiläksy annettu.' : `Kotiläksy annettu ${n} pelaajalle.`),
  },
};

/** The whole drill bank to pick one from: a search and a list. onPick(exercise) */
function ExercisePickerSheet({ open, exercises, onPick, onClose }) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (open) setQuery(''); }, [open]);
  const list = useMemo(() => {
    const q = query.trim().toLocaleLowerCase('fi');
    return exercises
      .filter((e) => !q || `${e.name} ${e.goal}`.toLocaleLowerCase('fi').includes(q))
      .sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  }, [exercises, query]);
  return (
    <Sheet open={open} onClose={onClose} title="Harjoitepankki" subtitle="Valitse harjoite kotiläksyksi. Voit muokata tekstiä ennen lähettämistä." size="md">
      <div className="stack-3">
        {exercises.length > 8 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae harjoitetta" aria-label="Hae harjoitetta" />}
        <div className="k-list">
          {list.map((e) => (
            <button key={e.id} type="button" className="k-row" onClick={() => onPick(e)}>
              <span className="k-ex-icon">{e.video ? <Icon name="play" size={16} /> : <DrillIcon cat={e.cat} size={18} />}</span>
              <span className="k-row-main">
                <span className="k-row-title truncate">{e.name}</span>
                <span className="k-row-sub truncate">{exerciseFacts(e)}</span>
              </span>
            </button>
          ))}
          {list.length === 0 && <p className="k-quiet">Ei osumia.</p>}
        </div>
      </div>
    </Sheet>
  );
}

/**
 * open, kind: 'note' | 'homework', initialIds, initialText (e.g. a drill), onClose(),
 * scope (opened from a session or a group: which one — shown on top while those players are picked)
 */
export function RecordSheet({ open, kind, initialIds = [], initialText = '', scope = null, onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [ids, setIds] = useState(initialIds);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [bankOpen, setBankOpen] = useState(false);
  // Opened from a player's page the form is just for them (like the old "Päiväkirja — Aino S."):
  // no recipient list until the coach asks for one.
  const onePlayer = scope?.icon === 'user' && initialIds.length === 1;
  const [pickOthers, setPickOthers] = useState(false);
  useEffect(() => {
    if (!open) return;
    setIds(initialIds);
    setText(initialText);
    setBankOpen(false);
    setPickOthers(false);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = KINDS[kind] || KINDS.note;
  // The whole bank: Krossi's library (loaded when a homework sheet first opens) and the coach's
  // own drills (a saved drill once).
  const { library } = useDrillLibrary(open && kind === 'homework');
  const bank = useMemo(() => asExercises(buildDrillList(state.exercises, { library: library || [] })), [state.exercises, library]);
  const offer = kind === 'homework' && !text.trim() && bank.length > 0;
  const suggested = useMemo(() => (offer ? homeworkSuggestions({ ...state, exercises: bank }, ids, { limit: 3 }) : null), [offer, state, bank, ids]);
  const pickExercise = (ex, how) => {
    track(`laksy.${how}`);
    setText(exerciseHomeworkText(ex));
    setBankOpen(false);
  };
  const dirty = Boolean(text.trim());
  const ready = text.trim() && ids.length > 0 && !busy;
  const missing = !text.trim() ? (kind === 'homework' ? 'Kirjoita kotiläksy ensin.' : 'Kirjoita huomio ensin.') : ids.length === 0 ? 'Valitse ainakin yksi pelaaja.' : null;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const clean = text.trim();
    const n = ids.length;
    const log = sendLogFor(state, coachId, ids);
    const res = await run(() => (kind === 'homework' ? api.homework.addMany(ids, clean, log) : api.notes.addMany(coachId, ids, clean, log)), k.done(n));
    setBusy(false);
    if (!res.ok) return;
    track(`tallennettu.${k.event}`);
    if (n > 1) track(`tallennettu.${k.event}-monelle`);
    onClose();
  };

  return (
    <>
      <Sheet open={open} onClose={() => !busy && onClose()} title={k.title} subtitle={k.subtitle} size="md" dismissible={!busy} confirmClose={dirty}
        footer={(
          <div className="sheet-actions">
            <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
            <Button variant="dark" size="lg" missing={missing} loading={busy} onClick={submit}>{ids.length > 1 ? `Lähetä ${ids.length} pelaajalle` : 'Lähetä'}</Button>
          </div>
        )}>
        {/* The text first: the player list can be long, and the field must never sink under it. */}
        <div className="stack-4">
          {scope && sameIds(ids, initialIds) && <ScopeLine scope={scope} />}
          <Field label={kind === 'homework' ? 'Läksy' : 'Huomio'} htmlFor="record-text">
            <Textarea id="record-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={k.placeholder} maxLength={4000} />
          </Field>
          {suggested && (
            <div className="stack-2">
              <div className="k-hw-suggest-head">
                <span className="field-label">{suggested.theme ? `Harjoitepankista · teemaan ${suggested.theme}` : 'Harjoitepankista'}</span>
                <button type="button" className="k-textlink" onClick={() => setBankOpen(true)}>Kaikki harjoitteet</button>
              </div>
              <div className="k-hw-suggest" role="group" aria-label="Ehdotetut harjoitteet">
                {suggested.items.map(({ exercise, reason }) => (
                  <button key={exercise.id} type="button" className="k-hw-suggest-row" onClick={() => pickExercise(exercise, 'ehdotus')}>
                    {exercise.video ? <Icon name="play" size={15} className="k-hw-suggest-icon" /> : <DrillIcon cat={exercise.cat} size={16} className="k-hw-suggest-icon" />}
                    <span className="grow truncate">{exercise.name}</span>
                    {reason && <span className="k-hw-suggest-why">{reason}</span>}
                    <Icon name="plus" size={16} className="k-hw-suggest-add" />
                  </button>
                ))}
              </div>
            </div>
          )}
          {kind === 'homework' && !suggested && bank.length > 0 && (
            <button type="button" className="k-textlink" onClick={() => setBankOpen(true)}>Valitse harjoitepankista</button>
          )}
          <p className="k-warn-text">{HEALTH_NOTE}</p>
          {onePlayer && !pickOthers ? (
            <button type="button" className="k-textlink" onClick={() => setPickOthers(true)}>Lähetä myös muille pelaajille</button>
          ) : (
            <Field label={`Kenelle${ids.length ? ` (${ids.length})` : ''}`}>
              <RecipientPicker students={state.students} groups={state.groups} value={ids} onChange={setIds} open={open} />
            </Field>
          )}
        </div>
      </Sheet>
      <ExercisePickerSheet open={open && bankOpen} exercises={bank} onPick={(ex) => pickExercise(ex, 'pankista')} onClose={() => setBankOpen(false)} />
    </>
  );
}
