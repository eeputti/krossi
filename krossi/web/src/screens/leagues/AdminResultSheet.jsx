// AdminResultSheet — the league admin enters or fixes any fixture's result, confirmed at once:
//   Tulos (games of the hour, or sets) · Luovutus (wo 6–0 to the winner) · 3–3 (both tried,
//   no date found — hallisarja rule). A reported, unconfirmed result can be accepted as is,
//   and any result can be removed (the fixture goes back to unplayed).
//   <AdminResultSheet open onClose fixture league onSaved={(message) => …} />
import { useEffect, useState } from 'react';
import { api } from '../../api/index.js';
import { useBusy } from '../../app/hooks.js';
import { Avatar, Button, Icon, IconButton, Segmented, Sheet, Stepper, useConfirm, useToast } from '../../ui/index.js';
import { MAX_SETS, isTimed, shortName } from './leagueUtils.js';

const cx = (...c) => c.filter(Boolean).join(' ');

function initialState(fixture) {
  const r = fixture?.result;
  if (r?.walkover) return { mode: 'wo', sets: [{ a: 0, b: 0 }], woWinner: r.winnerId };
  if (r && r.sets?.length) return { mode: 'score', sets: r.sets.map((s) => ({ a: s.a, b: s.b })), woWinner: null };
  return { mode: 'score', sets: [{ a: 0, b: 0 }], woWinner: null };
}

export function AdminResultSheet({ open, onClose, fixture, league, onSaved }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, run] = useBusy();
  const timed = isTimed(league);
  const [mode, setMode] = useState('score'); // 'score' | 'wo' | 'draw'
  const [sets, setSets] = useState([{ a: 0, b: 0 }]);
  const [woWinner, setWoWinner] = useState(null);

  useEffect(() => {
    if (!open || !fixture) return;
    const s = initialState(fixture);
    setMode(s.mode); setSets(s.sets); setWoWinner(s.woWinner);
  }, [open, fixture?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!fixture) return null;
  const A = fixture.playerA;
  const B = fixture.playerB;
  const result = fixture.result;
  const pendingReport = result && !result.confirmedBy;
  const reporter = result?.reportedBy === A.id ? A : B;
  const score = (r) => (r?.sets || []).map((s) => `${s.a}–${s.b}`).join(', ');

  const filled = sets.filter((s) => s.a > 0 || s.b > 0);
  const aSets = filled.filter((s) => s.a > s.b).length;
  const bSets = filled.filter((s) => s.b > s.a).length;
  const timedWinner = timed && filled[0] ? (filled[0].a > filled[0].b ? A : filled[0].b > filled[0].a ? B : null) : null;
  const setsWinner = !timed && aSets !== bSets ? (aSets > bSets ? A : B) : null;
  const canSave = mode === 'wo' ? Boolean(woWinner) : mode === 'draw' ? true : timed ? filled.length === 1 : Boolean(setsWinner);

  const summary = mode === 'wo'
    ? (woWinner ? `${shortName((woWinner === A.id ? A : B).name)} voittaa luovutuksella 6–0` : 'Valitse, kumpi voitti luovutuksella')
    : mode === 'draw' ? 'Tasapeli 3–3 — piste kummallekin'
      : timed
        ? (filled.length ? (timedWinner ? `${shortName(timedWinner.name)} voittaa ${Math.max(filled[0].a, filled[0].b)}–${Math.min(filled[0].a, filled[0].b)}` : `Tasapeli ${filled[0].a}–${filled[0].b}`) : 'Syötä pelatut geimit')
        : (setsWinner ? `${shortName(setsWinner.name)} voittaa ${Math.max(aSets, bSets)}–${Math.min(aSets, bSets)}` : 'Syötä erät — voittaja ratkeaa erävoitoista');

  const save = () => run(async () => {
    try {
      if (mode === 'wo') await api.leagues.adminSetResult(fixture.id, { walkover: true, winnerId: woWinner });
      else if (mode === 'draw') await api.leagues.adminSetResult(fixture.id, { sets: [{ a: 3, b: 3 }], winnerId: null });
      else await api.leagues.adminSetResult(fixture.id, { sets: timed ? [filled[0]] : filled, winnerId: timed ? timedWinner?.id || null : setsWinner.id });
      onSaved?.(mode === 'wo' ? 'Luovutus kirjattu.' : 'Tulos kirjattu ja vahvistettu.');
    } catch (err) {
      toast(err);
    }
  });

  const acceptReport = () => run(async () => {
    try {
      await api.leagues.adminConfirmResult(fixture.id);
      onSaved?.('Ilmoitettu tulos hyväksytty.');
    } catch (err) {
      toast(err);
    }
  });

  const clear = async () => {
    const ok = await confirm({
      title: 'Poistetaanko tulos?',
      message: `${shortName(A.name)} – ${shortName(B.name)} palaa pelaamattomaksi, ja pelaajat voivat ilmoittaa tuloksen uudelleen.`,
      confirmLabel: 'Poista tulos',
      danger: true,
    });
    if (!ok) return;
    run(async () => {
      try {
        await api.leagues.adminClearResult(fixture.id);
        onSaved?.('Tulos poistettu.');
      } catch (err) {
        toast(err);
      }
    });
  };

  const modes = [
    { value: 'score', label: 'Tulos' },
    { value: 'wo', label: 'Luovutus' },
    ...(timed ? [{ value: 'draw', label: '3–3' }] : []),
  ];
  const update = (i, key, value) => setSets((list) => list.map((s, j) => (j === i ? { ...s, [key]: value } : s)));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Kirjaa tulos"
      subtitle="Ylläpitäjänä kirjaamasi tulos on heti vahvistettu ja näkyy sarjataulukossa."
      footer={(
        <div className="leagues-report-footer">
          <p className="leagues-admres-summary" aria-live="polite"><Icon name={canSave ? 'check-circle' : 'info'} size={16} />{summary}</p>
          <Button variant="lime" size="lg" block icon="check" loading={busy} disabled={!canSave} onClick={save}>Tallenna tulos</Button>
          {result && <Button variant="ghost" size="sm" block icon="trash" disabled={busy} onClick={clear}>Poista tulos</Button>}
        </div>
      )}
    >
      <div className="leagues-report">
        <div className="leagues-report-vs">
          <span className="leagues-report-player"><Avatar person={A} size={48} /><span className="leagues-report-name truncate">{shortName(A.name)}</span></span>
          <span className="leagues-report-vs-mark" aria-hidden="true">vs</span>
          <span className="leagues-report-player"><Avatar person={B} size={48} /><span className="leagues-report-name truncate">{shortName(B.name)}</span></span>
        </div>

        {pendingReport && (
          <div className="leagues-admres-pending">
            <p><strong>{shortName(reporter.name)}</strong> ilmoitti {score(result)}{result.winnerId ? '' : ' (tasapeli)'}. Vastustaja ei ole vielä vahvistanut.</p>
            <Button variant="dark" size="sm" icon="check" loading={busy} onClick={acceptReport}>Hyväksy ilmoitus</Button>
          </div>
        )}

        <Segmented ariaLabel="Tuloksen tyyppi" options={modes} value={mode} onChange={setMode} />

        {mode === 'score' && (
          <div className="leagues-report-sets" role="group" aria-label={timed ? 'Geimit' : 'Erät'}>
            {(timed ? sets.slice(0, 1) : sets).map((s, i) => (
              <div key={i} className="leagues-report-set">
                <div className="leagues-report-set-head">
                  <span className="leagues-report-set-label">{timed ? 'Geimit tunnin aikana' : `${i + 1}. erä`}</span>
                  {!timed && sets.length > 1 && <IconButton icon="close" size="sm" label={`Poista ${i + 1}. erä`} onClick={() => setSets((l) => l.filter((_, j) => j !== i))} />}
                </div>
                <div className="leagues-report-set-row">
                  <span className={cx('leagues-report-side', s.a > s.b && 'is-ahead')}>
                    <Stepper value={s.a} onChange={(v) => update(i, 'a', v)} min={0} max={timed ? 40 : 20} label={`${shortName(A.name)}: ${timed ? 'geimit' : `${i + 1}. erä`}`} />
                  </span>
                  <span className="leagues-report-dash" aria-hidden="true">–</span>
                  <span className={cx('leagues-report-side', s.b > s.a && 'is-ahead')}>
                    <Stepper value={s.b} onChange={(v) => update(i, 'b', v)} min={0} max={timed ? 40 : 20} label={`${shortName(B.name)}: ${timed ? 'geimit' : `${i + 1}. erä`}`} />
                  </span>
                </div>
              </div>
            ))}
            {!timed && sets.length < MAX_SETS && (
              <Button variant="soft" size="sm" icon="plus" onClick={() => setSets((l) => [...l, { a: 0, b: 0 }])} className="leagues-report-add">Lisää erä</Button>
            )}
          </div>
        )}

        {mode === 'wo' && (
          <div className="leagues-admres-wo" role="radiogroup" aria-label="Luovutusvoittaja">
            <p className="leagues-admres-help">Kun vastustajaa ei useista yrityksistä huolimatta saatu kentälle, aktiivinen pelaaja voittaa luovutuksella 6–0.</p>
            {[A, B].map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={woWinner === p.id}
                className={cx('leagues-admres-pick', woWinner === p.id && 'is-on')}
                onClick={() => setWoWinner(p.id)}
              >
                <Avatar person={p} size={32} />
                <span className="leagues-admres-pick-name truncate">{shortName(p.name)} voittaa</span>
                {woWinner === p.id && <Icon name="check" size={18} strokeWidth={3} />}
              </button>
            ))}
          </div>
        )}

        {mode === 'draw' && (
          <p className="leagues-admres-help">
            Jos molemmat ovat todistettavasti yrittäneet sopia peliä kierroksen aikana siinä onnistumatta, ottelu kirjataan 3–3-tasapeliksi.
          </p>
        )}
      </div>
    </Sheet>
  );
}
