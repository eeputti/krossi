// MatchResultSheet — SHARED component. Owner: profile agent (wave 2). Other screens import it with exactly this interface:
//   <MatchResultSheet open onClose={fn} onSaved={fn} initial={MatchResult|{format, opponentName, opponent?}|null} title='Lisää tulos' />  — saves via api.results.save(initial?.id ?? null, …)
//
// `initial` with an `id` edits that result; without one it only prefills (e.g. from a played game).
// onSaved(result) is called after a successful save (result = the saved fields + id|null); the sheet
// then closes itself through onClose. A win fires confetti.
// Names can be Krossi players (PlayerNameField: pelikaverit first): a linked opponent is asked to
// confirm the result (api.results.save makes it 'pending' and notifies them).
import { useEffect, useId, useState } from 'react';
import { api } from '../../api/index.js';
import { useAsync, useBusy } from '../../app/hooks.js';
import { useSession } from '../../app/session.jsx';
import { firstName } from '../../lib/format.js';
import { Button, ChipSelect, Field, Icon, IconButton, Segmented, Sheet, Stepper, confetti, useToast } from '../../ui/index.js';
import { MAX_SETS, RESULT_FORMATS, RESULT_GAME_TYPES, computeWon, headlineScore, notifyResultsChanged, tally } from '../profile/matchResult.js';
import { PlayerNameField } from './PlayerNameField.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

function initialState(initial) {
  const i = initial || {};
  const gameType = RESULT_GAME_TYPES.some((t) => t.value === i.gameType) ? i.gameType : 'sets';
  const sets = Array.isArray(i.sets) && i.sets.length
    ? i.sets.map((s) => ({ my: Number(s.my) || 0, opp: Number(s.opp) || 0 }))
    : [{ my: 0, opp: 0 }];
  // The typed name wins (a linked person can read 'Pelaaja' without profile access).
  const who = (person, name) => ({ name: name || person?.name || '', person: person?.id ? person : null });
  return {
    format: i.format === 'doubles' ? 'doubles' : 'singles',
    gameType,
    opponent: who(i.opponent, i.opponentName),
    partner: who(i.partner, i.partnerName),
    oppPartner: who(i.oppPartner, i.oppPartnerName),
    sets: gameType === 'tiebreak' ? sets.slice(0, 1) : sets.slice(0, MAX_SETS),
  };
}

/** What the result looks like right now, for the live preview. */
function previewOf(form) {
  const tiebreak = form.gameType === 'tiebreak';
  const sets = tiebreak ? form.sets.slice(0, 1).filter((s) => s.my > 0 || s.opp > 0) : form.sets.filter((s) => s.my > 0 || s.opp > 0);
  if (sets.length === 0) {
    return { state: 'idle', icon: 'ball', title: tiebreak ? 'Syötä tie-breakin pisteet' : 'Syötä erien pelit', text: 'Näet tuloksen tässä heti' };
  }
  const t = tally(sets);
  const score = headlineScore(sets);
  const detail = sets.length > 1 ? sets.map((s) => `${s.my}–${s.opp}`).join(', ') : (tiebreak ? 'Tie-break' : '1 erä');
  if (t.won === t.lost) {
    return { state: 'even', icon: 'repeat', title: `Tasan ${score}`, text: t.won > 0 ? 'Lisää ratkaiseva erä, jos sellainen pelattiin' : detail };
  }
  return computeWon(sets)
    ? { state: 'win', icon: 'trophy', title: tiebreak ? `Voitit tie-breakin ${score} 🎉` : `Voitit ${score} 🎉`, text: detail }
    : { state: 'loss', icon: 'flag', title: tiebreak ? `Hävisit tie-breakin ${score}` : `Hävisit ${score}`, text: detail };
}

export function MatchResultSheet({ open, onClose, onSaved, initial = null, title }) {
  const [form, setForm] = useState(() => initialState(initial));
  const [error, setError] = useState('');
  const [busy, run] = useBusy();
  const toast = useToast();
  const ids = useId();
  const { profile } = useSession();
  const editing = Boolean(initial?.id);
  // Krossi players to pick from. A failure only means no suggestions: names can still be typed.
  const { data: candidates } = useAsync(
    () => (open ? api.results.candidates({ city: profile?.city || null }) : Promise.resolve(null)),
    [open, profile?.city],
  );

  useEffect(() => {
    if (open) { setForm(initialState(initial)); setError(''); }
    // Reset only when the sheet opens; `initial` objects are often recreated on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const tiebreak = form.gameType === 'tiebreak';
  const doubles = form.format === 'doubles';
  const maxScore = tiebreak ? 50 : 20;
  const preview = previewOf(form);
  const oppShort = form.opponent.name.trim().split(/\s+/)[0] || (doubles ? 'Vastustajat' : 'Vastustaja');
  const linkedIds = (except) => ['opponent', 'oppPartner', 'partner'].filter((k) => k !== except && (doubles || k === 'opponent'))
    .map((k) => form[k].person?.id).filter(Boolean);

  const set = (key, value) => { setForm((f) => ({ ...f, [key]: value })); setError(''); };
  const setGameType = (gameType) => {
    setForm((f) => ({ ...f, gameType, sets: gameType === 'tiebreak' ? f.sets.slice(0, 1) : f.sets }));
    setError('');
  };
  const updateSet = (index, side, value) => {
    setForm((f) => ({ ...f, sets: f.sets.map((s, i) => (i === index ? { ...s, [side]: value } : s)) }));
    setError('');
  };
  const addSet = () => setForm((f) => (f.sets.length >= MAX_SETS ? f : { ...f, sets: [...f.sets, { my: 0, opp: 0 }] }));
  const removeSet = (index) => setForm((f) => (f.sets.length <= 1 ? f : { ...f, sets: f.sets.filter((_, i) => i !== index) }));

  const save = () => run(async () => {
    const sets = (tiebreak ? form.sets.slice(0, 1) : form.sets).filter((s) => s.my > 0 || s.opp > 0);
    if (sets.length === 0) {
      setError(tiebreak ? 'Syötä tie-breakin pisteet.' : 'Syötä vähintään yhden erän tulos.');
      return;
    }
    const won = computeWon(sets);
    const name = (key) => form[key].name.trim() || null;
    const idOf = (key) => form[key].person?.id ?? null;
    const payload = {
      gameType: form.gameType,
      format: form.format,
      partnerName: doubles ? name('partner') : null,
      opponentName: name('opponent'),
      oppPartnerName: doubles ? name('oppPartner') : null,
      partnerId: doubles ? idOf('partner') : null,
      opponentId: idOf('opponent'),
      oppPartnerId: doubles ? idOf('oppPartner') : null,
      sets,
      won,
    };
    let saved;
    try {
      saved = await api.results.save(initial?.id ?? null, payload);
    } catch (err) {
      setError(err?.userMessage || 'Tuloksen tallennus epäonnistui. Yritä uudelleen.');
      return;
    }
    notifyResultsChanged();
    const t = tally(sets);
    const realWin = won && t.my !== t.opp;
    if (realWin && !(editing && initial?.won)) confetti();
    const asked = saved?.confirmation === 'pending' ? (form.opponent.person || form.oppPartner.person) : null;
    const headline = editing ? 'Tulos päivitetty' : realWin ? 'Voitto kirjattu!' : 'Tulos tallennettu';
    toast(asked ? `${headline} ${firstName(asked.name)} saa pyynnön vahvistaa sen.` : headline, { icon: realWin ? 'trophy' : undefined });
    onSaved?.({ id: saved?.id ?? initial?.id ?? null, ...payload });
    onClose?.();
  });

  const footer = (
    <div className="match-result-footer">
      {error && <p className="match-result-error" role="alert"><Icon name="alert" size={16} />{error}</p>}
      <div key={`${preview.state}-${preview.title}`} className={cx('match-result-preview', `is-${preview.state}`)} aria-live="polite">
        <span className="match-result-preview-icon"><Icon name={preview.icon} size={20} /></span>
        <span className="match-result-preview-text">
          <span className="match-result-preview-title">{preview.title}</span>
          <span className="match-result-preview-sub">{preview.text}</span>
        </span>
      </div>
      <Button variant="lime" size="lg" block loading={busy} icon="check" onClick={save}>
        {editing ? 'Tallenna muutokset' : 'Tallenna tulos'}
      </Button>
    </div>
  );

  return (
    <Sheet open={open} onClose={onClose} title={title || (editing ? 'Muokkaa tulosta' : 'Lisää tulos')} subtitle={editing ? null : 'Kirjaa matsi, niin voitot ja putket päivittyvät.'} footer={footer} size="md">
      <div className="match-result">
        <Segmented ariaLabel="Pelimuoto" options={RESULT_FORMATS} value={form.format} onChange={(v) => set('format', v)} className="match-result-format" />

        <Field label="Pelityyppi">
          <ChipSelect ariaLabel="Pelityyppi" options={RESULT_GAME_TYPES} value={form.gameType} onChange={(v) => v && setGameType(v)} size="sm" />
        </Field>

        <div className={cx('match-result-names', doubles && 'is-doubles')}>
          <PlayerNameField
            id={`${ids}-opp`} label="Vastustaja" placeholder="Vastustajan nimi" value={form.opponent} onChange={(v) => set('opponent', v)}
            candidates={candidates} excludeIds={linkedIds('opponent')} linkedHint="Saa pyynnön vahvistaa tuloksen"
          />
          {doubles && (
            <PlayerNameField
              id={`${ids}-opp2`} label="Vastustajan pari" optional placeholder="Parin nimi" value={form.oppPartner} onChange={(v) => set('oppPartner', v)}
              candidates={candidates} excludeIds={linkedIds('oppPartner')} linkedHint="Voi myös vahvistaa tuloksen"
            />
          )}
          {doubles && (
            <PlayerNameField
              id={`${ids}-partner`} label="Parisi" optional icon="heart" placeholder="Kenen kanssa pelasit?" value={form.partner} onChange={(v) => set('partner', v)}
              candidates={candidates} excludeIds={linkedIds('partner')} linkedHint="Tulos näkyy hänelläkin, kun se on vahvistettu"
            />
          )}
        </div>

        <div className="match-result-sets" role="group" aria-label={tiebreak ? 'Tie-breakin pisteet' : 'Erien tulokset'}>
          <div className="match-result-sets-head">
            <span className="field-label">{tiebreak ? 'Tie-break' : 'Tulos'}</span>
            <span className="match-result-col">Sinä</span>
            <span />
            <span className="match-result-col truncate">{oppShort}</span>
            <span />
          </div>
          {form.sets.map((s, i) => (
            <div className="match-result-set rise" key={i}>
              <span className="match-result-set-label">{tiebreak ? 'Pisteet' : `${i + 1}. erä`}</span>
              <span className={cx('match-result-side', s.my > s.opp && 'is-ahead')}>
                <Stepper size="sm" value={s.my} max={maxScore} label={tiebreak ? 'Sinun pisteesi' : `${i + 1}. erä, sinun pelisi`} onChange={(v) => updateSet(i, 'my', v)} />
              </span>
              <span className="match-result-dash" aria-hidden="true">–</span>
              <span className={cx('match-result-side', s.opp > s.my && 'is-ahead')}>
                <Stepper size="sm" value={s.opp} max={maxScore} label={tiebreak ? 'Vastustajan pisteet' : `${i + 1}. erä, vastustajan pelit`} onChange={(v) => updateSet(i, 'opp', v)} />
              </span>
              {form.sets.length > 1
                ? <IconButton icon="close" size="sm" label={`Poista ${i + 1}. erä`} onClick={() => removeSet(i)} className="match-result-remove" />
                : <span className="match-result-remove-spacer" />}
            </div>
          ))}
          {!tiebreak && form.sets.length < MAX_SETS && (
            <Button variant="soft" size="sm" icon="plus" onClick={addSet} className="match-result-add">Lisää erä</Button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
