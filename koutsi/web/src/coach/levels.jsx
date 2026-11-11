// levels.jsx — "Pelaajien tasot" on the coach's own scale (domain/levels.js): the hook, the player's and the
// group's level pickers, and the scale form shared by the welcome sheet and Profiili → Pelaajien tasot.
import { useState } from 'react';
import { api } from '../api/index.js';
import { Button, ChipSelect, Field, Input, Sheet } from '../ui/index.js';
import { useData } from '../app/data.jsx';
import { track } from './usage.js';
import {
  ALL_LEVELS, NOTE_MAX, SCALE_MAX, SCALE_MIN, levelLabel, normalizeScale, parseLevelRange, rangeValue, scaleForSave, scaleSteps, stepIndex, usesLevels,
} from '../domain/levels.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/** The coach's scale: { scale, ready (the table is there), uses (not "En käytä tasoja"), label(text) }. */
export function useLevelScale() {
  const { state } = useData();
  const scale = normalizeScale(state.levelScale);
  return { scale, ready: Boolean(state.levelScaleReady), uses: usesLevels(scale), label: (text) => levelLabel(scale, text) };
}

/** (text) → how a level reads in a list ("Taso 3–4"), or '' when the coach doesn't use levels. */
export function useLevelText() {
  const { scale, uses } = useLevelScale();
  return (text) => (uses ? levelLabel(scale, text) : '');
}

/** "Nyt: keskitaso/edistynyt" above a picker when the saved level isn't on the scale. */
function OldNow({ text }) {
  return <p className="field-msg lv-old-now">Nyt: <strong>{text}</strong> (vanha taso, muuttuu kun valitset uuden)</p>;
}

/**
 * The coach's notes in one small line under the chips, like the ends of a scale: "1 = Harrastaja" from the left
 * under 1, "6 = Kilpa" on the right under 6 (a note in between sits between them).
 */
export function ScaleKey({ scale }) {
  const steps = scaleSteps(scale);
  const noted = steps.map((s, i) => ({ ...s, i })).filter((s) => s.note);
  if (!noted.length) return null;
  return (
    <p className="field-msg lv-key">
      {noted.map((s) => <span key={s.value} className={cx(s.i === steps.length - 1 && steps.length > 1 && 'is-end')}>{s.label} = {s.note}</span>)}
    </p>
  );
}

/** One level for a player: the coach's steps in a row, the notes under them; tapping the chosen one clears it. */
export function PlayerLevelPicker({ value, onChange, size = 'sm' }) {
  const { scale } = useLevelScale();
  const steps = scaleSteps(scale);
  const i = stepIndex(scale, value);
  const old = String(value ?? '').trim() && i < 0;
  return (
    <div className="stack-2">
      <div className="lv-scale">
        <ChipSelect size={size} allowEmpty ariaLabel="Taso" className={cx('lv-picker', scale.kind === 'numerot' && 'lv-numbers')}
          options={steps.map((s) => ({ value: s.value, label: s.label }))}
          value={i >= 0 ? steps[i].value : ''} onChange={(v) => onChange(v || '')} />
        <ScaleKey scale={scale} />
      </div>
      {/* under the chips, so they don't jump when the first tap replaces the old level */}
      {old && <OldNow text={value} />}
    </div>
  );
}

/**
 * A group's level: one step, a range (tap two steps) or Kaikki tasot. onChange gets the text to save
 * ('4', '3–5', 'Keskitaso–Edistynyt', 'Kaikki tasot' or '').
 */
export function GroupLevelPicker({ value, onChange }) {
  const { scale } = useLevelScale();
  const steps = scaleSteps(scale);
  const range = parseLevelRange(scale, value);
  const sel = range && range !== 'all' ? range : null;
  const old = String(value ?? '').trim() && range === null;
  const tap = (i) => {
    if (sel && sel.from === sel.to) { onChange(sel.from === i ? '' : rangeValue(scale, sel.from, i)); return; }
    onChange(rangeValue(scale, i, i));
  };
  return (
    <div className="stack-2">
      <div className="lv-scale">
        <div className={cx('chip-select chip-select-wrap', scale.kind === 'numerot' && 'lv-numbers')} role="group" aria-label="Taso">
          {steps.map((s, i) => {
            const on = sel && i >= sel.from && i <= sel.to;
            return (
              <button key={s.value} type="button" aria-pressed={Boolean(on)}
                className={cx('select-chip select-chip-sm', on && 'is-on', on && sel.from !== sel.to && 'lv-in-range')} onClick={() => tap(i)}>
                <span className="select-chip-text"><span className="select-chip-label">{s.label}</span></span>
              </button>
            );
          })}
        </div>
        <ScaleKey scale={scale} />
      </div>
      <div className="chip-select chip-select-wrap">
        <button type="button" aria-pressed={range === 'all'} className={cx('select-chip select-chip-sm', range === 'all' && 'is-on')}
          onClick={() => onChange(range === 'all' ? '' : ALL_LEVELS)}>
          <span className="select-chip-text"><span className="select-chip-label">{ALL_LEVELS}</span></span>
        </button>
      </div>
      {old && <OldNow text={value} />}
      <p className="field-msg">{sel && sel.from === sel.to ? 'Napauta toista tasoa, niin ryhmälle tulee väli.' : 'Napauta yhtä tasoa tai kahta, niin väli valitaan.'}</p>
    </div>
  );
}

const KIND_OPTIONS = [
  { value: 'sanat', label: 'Sanat', hint: 'Aloittelija, Keskitaso, Edistynyt, Kilpapelaaja' },
  { value: 'numerot', label: 'Numerot', hint: 'Esimerkiksi 1–6. Isompi numero on parempi pelaaja.' },
  { value: 'ei', label: 'En käytä tasoja', hint: 'Tasot eivät näy lomakkeissa eivätkä listoissa.' },
];

const notePlaceholder = (i, size) => (i === 0 ? 'Esim. harrastaja' : i === size - 1 ? 'Esim. kilpa' : '');

/**
 * The scale form: { kind, size, notes } (kind '' = nothing chosen yet). Numbers ask how many steps (nothing
 * preselected) and then offer a short note for each, all optional.
 */
export function ScaleForm({ value, onChange, idPrefix = 'lv' }) {
  const set = (patch) => onChange({ ...value, ...patch });
  const size = value.kind === 'numerot' ? value.size : null;
  return (
    <div className="stack-4">
      <ChipSelect size="lg" layout="grid" columns={1} ariaLabel="Tasojen merkintätapa" options={KIND_OPTIONS}
        value={value.kind || ''} onChange={(kind) => set({ kind })} />
      {value.kind === 'numerot' && (
        <Field label="Montako tasoa?">
          <ChipSelect size="md" className="lv-numbers" ariaLabel="Montako tasoa"
            options={Array.from({ length: SCALE_MAX - SCALE_MIN + 1 }, (_, i) => ({ value: SCALE_MIN + i, label: String(SCALE_MIN + i) }))}
            value={size || null} onChange={(n) => set({ size: n })} />
        </Field>
      )}
      {value.kind === 'numerot' && size > 0 && (
        <Field label="Selitykset" optional hint="Kirjoita lyhyesti, mitä numero tarkoittaa. Täysi-ikäinen pelaaja näkee oman tasonsa selityksen.">
          <div className="lv-notes">
            {Array.from({ length: size }, (_, i) => (
              <label key={i} className="lv-note-row" htmlFor={`${idPrefix}-note-${i}`}>
                <span className="lv-note-num t-num">{i + 1}</span>
                <Input id={`${idPrefix}-note-${i}`} value={value.notes?.[i] || ''} maxLength={NOTE_MAX} placeholder={notePlaceholder(i, size)}
                  onChange={(e) => { const notes = [...(value.notes || [])]; notes[i] = e.target.value; set({ notes }); }} />
              </label>
            ))}
          </div>
        </Field>
      )}
    </div>
  );
}

/** What the scale form is still missing, or null. */
export function scaleFormMissing(value) {
  if (!value.kind) return 'Valitse yksi vaihtoehto.';
  if (value.kind === 'numerot' && !value.size) return 'Valitse, montako tasoa.';
  return null;
}

/**
 * A new coach's "Miten merkitset pelaajien tasot?" — right after the first-visit film, before the first group.
 * "Päätän myöhemmin" (or closing) keeps the words; either way onDone() runs, so what the film's last card chose
 * (Luo ensimmäinen ryhmä…) opens next.
 */
export function ScaleQuestionSheet({ open, onDone }) {
  const { run, ownerId } = useData();
  const [scale, setScale] = useState({ kind: '', size: null, notes: [] });
  const [busy, setBusy] = useState(false);
  const missing = scaleFormMissing(scale);
  const later = () => { track('tasot.tervetuloa-myohemmin'); onDone(); };
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await run(() => api.levels.saveScale(ownerId, scaleForSave(scale)), 'Tasot tallennettu.');
    setBusy(false);
    if (res.ok) { track(`tasot.tervetuloa-${scale.kind}`); onDone(); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && later()} size="md" dismissible={!busy}
      title="Miten merkitset pelaajien tasot?" subtitle="Voit muokata tasoja myöhemmin Profiilissa."
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={later} disabled={busy}>Päätän myöhemmin</Button><Button variant="lime" size="lg" missing={missing} loading={busy} onClick={save}>Valmis</Button></div>}>
      <ScaleForm value={scale} onChange={setScale} idPrefix="wl" />
    </Sheet>
  );
}
