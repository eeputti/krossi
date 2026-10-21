// EntrySheet — the player's own Kehitys entry: what I did, when, and how it went
// ("Tein tätä ja tätä, silloin, ja näin meni"). Adds one, or edits one (`editing`).
// Every coach the player has sees it on the player's Kehitys timeline.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Input, Sheet, Textarea } from '../ui/index.js';
import { koutsiTodayStr } from '../domain/core.js';
import { HEALTH_NOTE } from './sheets.jsx';

export function EntrySheet({ open, onClose, editing }) {
  const { run, ownerId } = useData();
  const [f, setF] = useState({ text: '', date: koutsiTodayStr(), how: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setF({ text: editing?.text || '', date: editing?.date || koutsiTodayStr(), how: editing?.how || '' });
  }, [open, editing]);
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const ready = f.text.trim() && f.date && !busy;
  const save = async () => {
    if (!ready) return;
    setBusy(true);
    const res = editing
      ? await run(() => api.player.updateEntry(editing.id, f), 'Merkintä päivitetty.')
      : await run(() => api.player.addEntry(ownerId, f), 'Merkintä tallennettu — hienoa!');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={editing ? 'Muokkaa merkintää' : 'Uusi merkintä'}
      subtitle="Mitä teit, milloin ja miten meni. Näkyy Kehityksessä sinulle ja valmentajallesi." size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <Field label="Mitä teit?" htmlFor="en-text">
          <Textarea id="en-text" rows={3} value={f.text} onChange={set('text')} maxLength={2000} autoFocus={!editing}
            placeholder="Esim. Syötin 50 kakkossyöttöä ja pelasin kaverin kanssa tunnin." />
        </Field>
        <Field label="Milloin?" htmlFor="en-date">
          <Input id="en-date" type="date" value={f.date} max={koutsiTodayStr()} onChange={set('date')} />
        </Field>
        <Field label="Miten meni?" optional htmlFor="en-how">
          <Textarea id="en-how" rows={2} value={f.how} onChange={set('how')} maxLength={1000}
            placeholder="Esim. Kick-syöttö alkoi nousta, rysty vielä hukassa." />
        </Field>
        <p className="k-warn-text">{HEALTH_NOTE}</p>
      </div>
    </Sheet>
  );
}
