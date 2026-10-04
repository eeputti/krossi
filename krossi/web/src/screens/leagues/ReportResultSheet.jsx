// ReportResultSheet — "Ilmoita tulos" for a league fixture: set rows with Stepper pairs, quick
// scores for the last set, live winner preview. The opponent confirms afterwards.
//   <ReportResultSheet open onClose fixture meId onSaved={({ won }) => …} />
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { firstName } from '../../lib/format.js';
import { Avatar, Button, ChipSelect, Icon, IconButton, Sheet, Stepper, useToast } from '../../ui/index.js';
import { MAX_SETS, tallySets } from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const QUICK = ['6–0', '6–1', '6–2', '6–3', '6–4', '7–5', '7–6', '0–6', '1–6', '2–6', '3–6', '4–6', '5–7', '6–7'];
const EMPTY = [{ my: 0, opp: 0 }];

function preview(sets, oppName) {
  const filled = sets.filter((s) => s.my > 0 || s.opp > 0);
  if (filled.length === 0) return { state: 'idle', icon: 'ball', title: 'Syötä erien pelit', text: 'Näet voittajan tässä heti' };
  const t = tallySets(filled);
  const score = `${t.won}–${t.lost}`;
  const detail = filled.map((s) => `${s.my}–${s.opp}`).join(' · ');
  if (t.won === t.lost) return { state: 'even', icon: 'repeat', title: `Erät tasan ${score}`, text: 'Lisää ratkaiseva erä tai tie-break' };
  return t.won > t.lost
    ? { state: 'win', icon: 'trophy', title: `Voitit ${score} 🎉`, text: detail }
    : { state: 'loss', icon: 'flag', title: `${oppName} voitti ${t.lost}–${t.won}`, text: detail };
}

export function ReportResultSheet({ open, onClose, fixture, meId, onSaved }) {
  const toast = useToast();
  const [busy, run] = useBusy();
  const [sets, setSets] = useState(EMPTY);

  useEffect(() => { if (open) setSets(EMPTY); }, [open, fixture?.id]);

  if (!fixture) return null;
  const iAmA = fixture.playerA.id === meId;
  const me = iAmA ? fixture.playerA : fixture.playerB;
  const opp = iAmA ? fixture.playerB : fixture.playerA;
  const oppName = firstName(opp.name);
  const p = preview(sets, oppName);
  const decisive = p.state === 'win' || p.state === 'loss';
  const last = sets[sets.length - 1];
  const lastQuick = `${last.my}–${last.opp}`;

  const update = (i, key, value) => setSets((list) => list.map((s, j) => (j === i ? { ...s, [key]: value } : s)));
  const applyQuick = (v) => {
    if (!v) return;
    const [my, o] = v.split('–').map(Number);
    setSets((list) => list.map((s, j) => (j === list.length - 1 ? { my, opp: o } : s)));
  };
  const addSet = () => setSets((list) => (list.length < MAX_SETS ? [...list, { my: 0, opp: 0 }] : list));
  const removeSet = (i) => setSets((list) => list.filter((_, j) => j !== i));

  const submit = () => run(async () => {
    const filled = sets.filter((s) => s.my > 0 || s.opp > 0);
    const t = tallySets(filled);
    if (t.won === t.lost) return;
    const payload = filled.map((s) => (iAmA ? { a: s.my, b: s.opp } : { a: s.opp, b: s.my }));
    const won = t.won > t.lost;
    try {
      await api.leagues.reportResult(fixture.id, payload, won ? me.id : opp.id);
      onSaved?.({ won });
    } catch (err) {
      toast(err);
    }
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Ilmoita tulos"
      subtitle={`${oppName} vahvistaa tuloksen, jonka jälkeen se päivittyy sarjataulukkoon.`}
      footer={(
        <div className="leagues-report-footer">
          <div key={`${p.state}-${p.title}`} className={cx('leagues-report-preview', `is-${p.state}`)} aria-live="polite">
            <span className="leagues-report-preview-icon"><Icon name={p.icon} size={20} /></span>
            <span className="leagues-report-preview-text">
              <span className="leagues-report-preview-title">{p.title}</span>
              <span className="leagues-report-preview-sub">{p.text}</span>
            </span>
          </div>
          <Button variant="lime" size="lg" block icon="send" loading={busy} disabled={!decisive} onClick={submit}>Ilmoita tulos</Button>
        </div>
      )}
    >
      <div className="leagues-report">
        <div className="leagues-report-vs">
          <span className="leagues-report-player">
            <Avatar person={me} size={52} />
            <span className="leagues-report-name">Sinä</span>
          </span>
          <span className="leagues-report-vs-mark" aria-hidden="true">vs</span>
          <span className="leagues-report-player">
            <Avatar person={opp} size={52} />
            <span className="leagues-report-name truncate">{oppName}</span>
          </span>
        </div>

        <div className="leagues-report-sets" role="group" aria-label="Erien tulokset">
          {sets.map((s, i) => (
            <div key={i} className="leagues-report-set rise">
              <div className="leagues-report-set-head">
                <span className="leagues-report-set-label">{i + 1}. erä</span>
                {sets.length > 1 && (
                  <IconButton icon="close" size="sm" label={`Poista ${i + 1}. erä`} onClick={() => removeSet(i)} />
                )}
              </div>
              <div className="leagues-report-set-row">
                <span className={cx('leagues-report-side', s.my > s.opp && 'is-ahead')}>
                  <Stepper value={s.my} onChange={(v) => update(i, 'my', v)} min={0} max={20} label={`${i + 1}. erä, sinun pelisi`} />
                </span>
                <span className="leagues-report-dash" aria-hidden="true">–</span>
                <span className={cx('leagues-report-side', s.opp > s.my && 'is-ahead')}>
                  <Stepper value={s.opp} onChange={(v) => update(i, 'opp', v)} min={0} max={20} label={`${i + 1}. erä, vastustajan pelit`} />
                </span>
              </div>
            </div>
          ))}
        </div>

        <div className="leagues-report-quick">
          <div className="leagues-report-quick-label">Pikavalinta {sets.length}. erälle <span>(sinä–{oppName})</span></div>
          <ChipSelect
            ariaLabel={`Pikavalinta ${sets.length}. erälle`}
            size="sm"
            layout="scroll"
            options={QUICK.map((q) => ({ value: q, label: q }))}
            value={lastQuick}
            onChange={applyQuick}
          />
        </div>

        {sets.length < MAX_SETS && (
          <Button variant="soft" size="sm" icon="plus" onClick={addSet} className="leagues-report-add">
            {p.state === 'even' ? 'Lisää ratkaiseva erä' : 'Lisää erä'}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
