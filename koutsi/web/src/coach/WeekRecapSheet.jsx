// WeekRecapSheet — "Viikko paketissa". Once a week, after the week's last session, the coach sees
// how the week went (sessions held, attendance, the players' feelings and new wishes), what next
// week still needs (its themes, one tap away), and can answer "Miten treeniviikko sujui?" in a
// private weekly diary. No e-mail: it opens in the app (see CoachApp), and from the diary on Koti.
import { useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Field, Sheet, StatTile, Textarea } from '../ui/index.js';
import { koutsiAddIsoWeeks, koutsiCompareIsoWeeks, koutsiCurrentIsoWeek, koutsiIsoWeekRangeLabel, koutsiWeekThemeStatus } from '../domain/core.js';
import { weekRecap } from '../domain/week.js';
import { firstName } from '../domain/roster.js';
import { MoodPicker } from '../player/sheets.jsx';
import { useCoach } from './CoachRoot.jsx';
import { openPlanner } from './nav.js';
import { useRecord } from './merkitse.jsx';

const SEEN_KEY = (coachId) => `koutsi_viikkokooste_${coachId}`;
const weekKey = (w) => `${w.year}-${w.week}`;
const readSeen = (coachId) => {
  try { return new Set(JSON.parse(localStorage.getItem(SEEN_KEY(coachId)) || '[]')); } catch { return new Set(); }
};

/** Whether the coach already closed this week's recap on this device. */
export const recapSeen = (coachId, week) => readSeen(coachId).has(weekKey(week));
export function markRecapSeen(coachId, week) {
  try {
    const next = readSeen(coachId).add(weekKey(week));
    localStorage.setItem(SEEN_KEY(coachId), JSON.stringify([...next].slice(-20)));
  } catch { /* private mode: it may open once more */ }
}

// `npm run dev:koutsi` → /demo/valmentaja?esikatsele=viikko opens this week's recap in the demo.
export const previewRecap = process.env.NODE_ENV !== 'production'
  && typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('esikatsele') === 'viikko';

const percent = (x) => `${Math.round(x * 100)}\u00a0%`;
const average = (x) => x.toFixed(1).replace('.', ',');

/** open, week ({ year, week }), onClose() */
export function WeekRecapSheet({ open, week, onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const { openContinue } = useRecord();
  const existing = week ? (state.weekNotes || []).find((n) => n.year === week.year && n.week === week.week) : null;
  const [score, setScore] = useState(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setScore(existing?.score ?? null);
    setNote(existing?.note || '');
  }, [open, week?.year, week?.week]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!week) return null;

  const recap = weekRecap(state, week);
  const next = koutsiAddIsoWeeks(week, 1);
  const nextStatus = koutsiWeekThemeStatus(state.groups, state.trainings, next);
  const missing = nextStatus.pool.length - nextStatus.covered;
  const save = async () => {
    setBusy(true);
    const res = await run(() => api.coach.saveWeekNote(coachId, { year: week.year, week: week.week, score, note: note.trim() }), 'Tallennettu viikkomuistioon.');
    setBusy(false);
    if (res.ok) onClose();
  };
  const toPlanner = () => { onClose(); openPlanner({ week: next }); };
  const carryOn = () => { onClose(); openContinue(next); };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md"
      // mid-week (from Merkitse → Oma viikkomuistio) the week isn't "paketissa" yet
      title={koutsiCompareIsoWeeks(week, koutsiCurrentIsoWeek()) < 0 || new Date().getDay() === 0 ? `Viikko ${week.week} paketissa` : `Oma viikkomuistio · viikko ${week.week}`}
      subtitle={koutsiIsoWeekRangeLabel(week.year, week.week)}
      confirmClose={note.trim() !== (existing?.note || '').trim()}
      footer={score || note.trim()
        ? <Button variant="dark" size="lg" block loading={busy} missing={!score ? 'Valitse ensin, miltä viikko tuntui (1–5).' : null} onClick={save}>{existing ? 'Tallenna muutokset' : 'Tallenna viikkomuistioon'}</Button>
        : <Button variant="soft" size="lg" block onClick={onClose}>Sulje</Button>}>
      <div className="stack-5">
        <div className="k-stats k-stats-3">
          <StatTile label="Treenejä pidetty" value={recap.sessions ? `${recap.held}/${recap.sessions}` : '0'} />
          <StatTile label="Läsnäolo" value={recap.attendance == null ? '–' : percent(recap.attendance)} />
          <StatTile label="Pelaajien fiilis" value={recap.moodAverage == null ? '–' : average(recap.moodAverage)}
            sub={recap.moodCount ? `${recap.moodCount} ${recap.moodCount === 1 ? 'vastaus' : 'vastausta'}` : 'ei vastauksia'} />
        </div>

        {recap.wishes.length > 0 && (
          <section className="stack-2">
            <div className="eyebrow">Toiveet pelaajilta</div>
            <ul className="k-recap-wishes">
              {recap.wishes.slice(0, 3).map((w) => (
                <li key={`${w.student.id}-${w.at}`}><strong>{firstName(w.student.name)}:</strong> {w.text}</li>
              ))}
            </ul>
          </section>
        )}

        <section className="k-recap-next stack-2">
          <div className="eyebrow">Ensi viikko · vko {next.week}</div>
          <p className="k-body-text">
            {nextStatus.pool.length === 0 ? 'Ensi viikolle ei ole treenejä kalenterissa.'
              : missing === 0 ? `Kaikilla ${nextStatus.pool.length} ryhmällä on jo teema.`
                : `Teema ${nextStatus.covered}/${nextStatus.pool.length} ryhmällä.`}
          </p>
          {missing > 0 && (
            <div className="row wrap">
              {nextStatus.carry.length > 0 && <Button variant="lime" size="sm" icon="repeat" onClick={carryOn}>Jatka edellisillä ({nextStatus.carry.length})</Button>}
              <Button variant="outline" size="sm" icon="sparkles" onClick={toPlanner}>Aseta teemat</Button>
            </div>
          )}
        </section>

        <section className="stack-3">
          <div>
            <div className="eyebrow">Oma viikkomuistio · vain sinulle</div>
            <h3 className="k-block-title">Miten treeniviikko sujui?</h3>
          </div>
          <MoodPicker value={score} onChange={setScore} size="sm" />
          <Field label="Muistiinpano itsellesi" optional htmlFor="week-note">
            <Textarea id="week-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000}
              placeholder="Esim. mikä toimi ja mitä teet ensi viikolla toisin" />
          </Field>
          <p className="k-warn-text">Älä kirjoita pelaajien terveystietoja.</p>
        </section>
      </div>
    </Sheet>
  );
}
