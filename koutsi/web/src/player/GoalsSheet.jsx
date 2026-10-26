// GoalsSheet — "Tavoitteet": this season's goal, and (once the columns exist, state.longGoalReady)
// the long-term aim: what kind of player the player wants to be — just for fun, to get better, to
// compete, to reach the top — and where they are heading, in their own words. Every coach of the
// player sees them; each earlier goal stays on the Kehitys timeline.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Sheet, Textarea } from '../ui/index.js';
import { AMBITIONS } from '../domain/playerNow.js';
import { HEALTH_NOTE } from './sheets.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

const LONG_HINT = {
  harrastus: 'Esim. Pelata kavereiden kanssa joka viikko koko talven',
  kehitys: 'Esim. Oppia pelaamaan nelinpeliä kunnolla',
  kilpailu: 'Esim. Pelata seuran joukkueessa aluesarjaa',
  huippu: 'Esim. Pelata A-tasolla vuonna 2028',
};

export function GoalsSheet({ open, onClose }) {
  const { state, run, ownerId } = useData();
  const student = state.students[0];
  const longReady = Boolean(state.longGoalReady);
  const [goal, setGoal] = useState('');
  const [ambition, setAmbition] = useState('');
  const [longGoal, setLongGoal] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setGoal(student.goal || ''); setAmbition(student.ambition || ''); setLongGoal(student.longGoal || '');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const goalChanged = goal.trim() !== (student.goal || '').trim();
  const aimChanged = longReady && (ambition !== (student.ambition || '') || longGoal.trim() !== (student.longGoal || '').trim());
  const save = async () => {
    if (busy || (!goalChanged && !aimChanged)) return;
    setBusy(true);
    const res = await run(async () => {
      if (goalChanged) await api.player.saveGoal(ownerId, goal.trim());
      if (aimChanged) await api.player.saveAim(ownerId, { ambition, longGoal: longGoal.trim() });
    }, 'Tavoitteet tallennettu.');
    setBusy(false);
    if (res.ok) onClose();
  };
  const hadAny = Boolean((student.goal || '').trim() || (student.longGoal || '').trim());
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Tavoitteet" subtitle="Kaikki valmentajasi näkevät nämä." size="md" dismissible={!busy} confirmClose={goalChanged || aimChanged}
      footer={<Button variant="dark" size="lg" block loading={busy} missing={!goalChanged && !aimChanged ? 'Kirjoita tai muuta tavoitetta ensin.' : null} onClick={save}>Tallenna</Button>}>
      <div className="stack-5">
        <Field label="Tämän kauden tavoite" hint="Mitä haluat oppia tai saavuttaa tällä kaudella?" htmlFor="goal-now">
          <Textarea id="goal-now" rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={1000} placeholder="Esim. Varmempi kakkossyöttö" />
        </Field>
        {longReady && (
          <>
            <Field label="Mihin tähtäät?">
              <div className="aim-pick" role="radiogroup" aria-label="Mihin tähtäät?">
                {AMBITIONS.map((a) => (
                  <button key={a.id} type="button" role="radio" aria-checked={ambition === a.id} className={cx('aim-opt', ambition === a.id && 'is-on')}
                    onClick={() => setAmbition(ambition === a.id ? '' : a.id)}>
                    <span className="aim-opt-label">{a.label}</span>
                    <span className="aim-opt-sub">{a.sub}</span>
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Pitkän ajan tavoite" optional hint="Mihin haluat tenniksessä päästä parin vuoden päästä?" htmlFor="goal-long">
              <Textarea id="goal-long" rows={2} value={longGoal} onChange={(e) => setLongGoal(e.target.value)} maxLength={500}
                placeholder={LONG_HINT[ambition] || 'Esim. Pelata seuran joukkueessa aluesarjaa'} />
            </Field>
          </>
        )}
        <p className="k-warn-text">{HEALTH_NOTE}</p>
        {hadAny && <p className="field-msg">Vanhat tavoitteet jäävät talteen Kehitys-aikajanalle.</p>}
      </div>
    </Sheet>
  );
}
