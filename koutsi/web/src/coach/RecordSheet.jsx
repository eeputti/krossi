// RecordSheet — a coach's note ("Huomio") or homework for one player or many: who it's for
// (picked from a group in one tap), the text, and a health-data reminder. Each player gets
// their own copy on their timeline and their own notification; homework is ticked off by each
// player separately. Editing one existing entry stays in playerForms' TextEntrySheet.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Sheet, Textarea } from '../ui/index.js';
import { RecipientPicker } from '../shared/recipients.jsx';
import { useCoach } from './CoachRoot.jsx';
import { track } from './usage.js';

const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';

const KINDS = {
  note: {
    title: 'Huomio',
    subtitle: 'Näkyy pelaajan aikajanalla, ja hän saa ilmoituksen.',
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

/** open, kind: 'note' | 'homework', initialIds, onClose() */
export function RecordSheet({ open, kind, initialIds = [], onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const [ids, setIds] = useState(initialIds);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setIds(initialIds);
    setText('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const k = KINDS[kind] || KINDS.note;
  const dirty = Boolean(text.trim());
  const ready = text.trim() && ids.length > 0 && !busy;

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const clean = text.trim();
    const n = ids.length;
    const res = await run(() => (kind === 'homework' ? api.homework.addMany(ids, clean) : api.notes.addMany(coachId, ids, clean)), k.done(n));
    setBusy(false);
    if (!res.ok) return;
    track(`tallennettu.${k.event}`);
    if (n > 1) track(`tallennettu.${k.event}-monelle`);
    onClose();
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={k.title} subtitle={k.subtitle} size="md" dismissible={!busy && !dirty}
      footer={(
        <div className="sheet-actions">
          <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
          <Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={submit}>{ids.length > 1 ? `Lähetä ${ids.length} pelaajalle` : 'Lähetä'}</Button>
        </div>
      )}>
      <div className="stack-4">
        <Field label={`Kenelle${ids.length ? ` (${ids.length})` : ''}`}>
          <RecipientPicker students={state.students} groups={state.groups} value={ids} onChange={setIds} open={open} />
        </Field>
        <Field label={kind === 'homework' ? 'Läksy' : 'Huomio'} htmlFor="record-text">
          <Textarea id="record-text" rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder={k.placeholder} maxLength={4000} />
        </Field>
        <p className="k-warn-text">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}
