// LevelsScreen — /valmentaja/profiili/tasot, "Pelaajien tasot": the coach's own scale (words, numbers 1–N with
// notes, or none) and the list of old levels that aren't on it. The list groups similar texts ("kilpa" and
// "Kilpapelaaja", "amatööri" and "harrastaja"); the coach picks a new level for a row and every player or group
// on it changes at once. Rows left alone stay as they are, "Erota" splits a spelling into its own row, and the
// save can be undone from the toast. Nothing is converted without the coach choosing it.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Card, Icon, Page, Sheet, TopBar, useToast } from '../ui/index.js';
import {
  REMOVE_LEVEL, levelLabel, movePlan, oldLevelRows, parseLevelRange, playersByStep, relabelPlan, scaleForSave, scaleSteps, scaleSummary, stepIndex,
} from '../domain/levels.js';
import { useCoach } from './CoachRoot.jsx';
import { GroupLevelPicker, PlayerLevelPicker, ScaleForm, scaleFormMissing, useLevelScale } from './levels.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "Taso 6 on vielä käytössä (3 pelaajaa, 1 ryhmä). Vaihda se ensin." when fewer steps would drop a used one. */
function shrinkProblem(scale, next, students, groups) {
  if (scale.kind !== 'numerot' || next.kind !== 'numerot' || !next.size || next.size >= scale.size) return null;
  const steps = scaleSteps(scale);
  for (let i = scale.size - 1; i >= next.size; i -= 1) {
    const p = students.filter((s) => stepIndex(scale, s.level) === i).length;
    const g = groups.filter((x) => { const r = parseLevelRange(scale, x.level); return r && r !== 'all' && r.to >= i; }).length;
    if (p || g) {
      const who = [p && plural(p, 'pelaaja', 'pelaajaa'), g && plural(g, 'ryhmä', 'ryhmää')].filter(Boolean).join(', ');
      return `Taso ${steps[i].value} on vielä käytössä (${who}). Vaihda se ensin, niin voit poistaa sen.`;
    }
  }
  return null;
}

function ScaleSheet({ open, onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const { scale } = useLevelScale();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [wasOpen, setWasOpen] = useState(false);
  if (open !== wasOpen) { setWasOpen(open); if (open) setForm({ kind: scale.kind, size: scale.size, notes: [...scale.notes] }); }
  if (!form) return null;
  const problem = shrinkProblem(scale, form, state.students, state.groups);
  const missing = scaleFormMissing(form) || problem;
  const changed = JSON.stringify(scaleForSave(form)) !== JSON.stringify(scaleForSave(scale));
  const kindChanges = form.kind && form.kind !== scale.kind && form.kind !== 'ei' && state.students.concat(state.groups).some((x) => String(x.level ?? '').trim());
  const save = async () => {
    if (missing || busy) return;
    setBusy(true);
    const res = await run(() => api.levels.saveScale(coachId, scaleForSave(form)), 'Tasot tallennettu.', { waitForRefresh: true });
    setBusy(false);
    if (res.ok) { track(`tasot.${form.kind}`); onClose(); }
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Miten merkitset pelaajien tasot?" size="md" dismissible={!busy}
      confirmClose={changed ? { title: 'Hylätäänkö muutokset?', message: 'Asteikkoa ei ole vielä tallennettu.' } : false}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={missing} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-4">
        <ScaleForm value={form} onChange={setForm} idPrefix="lvs" />
        {problem && <p className="k-warn-text">{problem}</p>}
        {kindChanges && <p className="field-msg">Nykyiset tasot jäävät ennalleen. Voit vaihtaa ne kerralla Pelaajien tasot -sivun listasta.</p>}
        {form.kind === 'ei' && scale.kind !== 'ei' && <p className="field-msg">Tasot piilotetaan, mutta ne säilyvät tallessa. Ne palaavat näkyviin, jos otat tasot taas käyttöön.</p>}
      </div>
    </Sheet>
  );
}

/** Up to eight names, then "+3". */
function namesOf(ids, byId) {
  const names = ids.map((id) => byId.get(id)).filter(Boolean);
  return names.length > 8 ? `${names.slice(0, 8).join(', ')} +${names.length - 8}` : names.join(', ');
}

/** Checkboxes to pick some of a list ([{ id, name }]), with Valitse kaikki / Poista valinnat. */
function PickList({ items, picked, onChange }) {
  const on = new Set(picked);
  const all = items.length > 0 && items.every((i) => on.has(i.id));
  const toggle = (id) => onChange(on.has(id) ? picked.filter((x) => x !== id) : [...picked, id]);
  return (
    <div className="stack-2">
      <button type="button" className="k-textlink lv-pick-all" onClick={() => onChange(all ? [] : items.map((i) => i.id))}>{all ? 'Poista valinnat' : 'Valitse kaikki'}</button>
      <div className="k-pick-list lv-pick-list">
        {items.map((i) => (
          <label key={i.id} className={cx('k-pick', on.has(i.id) && 'is-on')}>
            <input type="checkbox" checked={on.has(i.id)} onChange={() => toggle(i.id)} />
            <span className="grow k-pick-title">{i.name}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

const byName = (a, b) => a.name.localeCompare(b.name, 'fi');

function OldRow({ row, group, choice, onChoose, onPick, onSplit, byId }) {
  const open = Boolean(choice?.picking);
  const level = typeof choice === 'string' ? choice : choice?.level || '';
  const picked = choice?.ids || [];
  const removing = level === REMOVE_LEVEL;
  const n = row.ids.length;
  const who = group ? 'ryhmät' : 'pelaajat';
  return (
    <div className={cx('lv-row', level && 'is-chosen')}>
      <div className="lv-row-head">
        <span className="lv-row-title">{row.label}</span>
        <span className="k-faint t-num">{group ? plural(n, 'ryhmä', 'ryhmää') : plural(n, 'pelaaja', 'pelaajaa')}</span>
      </div>
      {(row.variants.length > 1 || row.variants[0].text !== row.label) && <div className="lv-variants">
        {row.variants.map((v) => (
          <span key={v.text} className="lv-variant">
            <span className="lv-variant-text">{v.text}</span>
            {row.variants.length > 1 && <span className="t-num k-faint">{v.ids.length}</span>}
            {row.variants.length > 1 && <button type="button" className="k-textlink lv-split" onClick={() => onSplit(v.text)}>Erota</button>}
          </span>
        ))}
      </div>}
      {open
        ? <PickList items={row.ids.map((id) => ({ id, name: byId.get(id) || '' })).sort(byName)} picked={picked} onChange={onPick} />
        : <p className="lv-names k-faint">{namesOf(row.ids, byId)}</p>}
      <button type="button" className="k-textlink lv-open" onClick={() => onPick([], !open)}>
        {open ? `Siirrä kaikki ${who} kerralla` : `Valitse ${who} itse`}
      </button>
      <div className="lv-row-pick">
        <span className="field-label">{picked.length ? `Uusi taso valituille (${picked.length})` : open ? 'Valitse ensin yllä, ketkä siirretään' : `Uusi taso kaikille (${n})`}</span>
        {removing
          ? <p className="field-msg">Taso poistetaan {picked.length ? 'valituilta' : group ? 'näiltä ryhmiltä' : 'näiltä pelaajilta'}.</p>
          : group
            ? <GroupLevelPicker value={level} onChange={(v) => onChoose(v)} />
            : <PlayerLevelPicker value={level} onChange={(v) => onChoose(v)} />}
        <button type="button" className="k-textlink lv-remove" onClick={() => onChoose(removing ? '' : REMOVE_LEVEL)}>
          {removing ? 'Älä poista' : 'Poista taso'}
        </button>
      </div>
    </div>
  );
}

function OldLevels({ scale }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const [split, setSplit] = useState(() => new Set());
  const [choices, setChoices] = useState({ p: {}, g: {} });
  const [busy, setBusy] = useState(false);
  const players = useMemo(() => state.students.filter((s) => !s.rosterOnly).map((s) => ({ id: s.id, level: s.level })), [state.students]);
  const groups = useMemo(() => state.groups.map((g) => ({ id: g.id, level: g.level })), [state.groups]);
  const pRows = useMemo(() => oldLevelRows(scale, players, { split }), [scale, players, split]);
  const gRows = useMemo(() => oldLevelRows(scale, groups, { group: true, split }), [scale, groups, split]);
  const byId = useMemo(() => new Map([...state.students.map((s) => [s.id, s.name]), ...state.groups.map((g) => [g.id, `${g.name} (${g.day} ${g.time})`])]), [state.students, state.groups]);
  const plan = {
    students: relabelPlan(pRows, choices.p, players),
    groups: relabelPlan(gRows, choices.g, groups),
  };
  const count = plan.students.length + plan.groups.length;
  // a row's choice: { level, ids } — ids = the picked players (none = the whole row)
  const choose = (side, key, patch) => setChoices((c) => ({ ...c, [side]: { ...c[side], [key]: { ...(c[side][key] || {}), ...patch } } }));
  const doSplit = (text) => setSplit((s) => new Set([...s, text]));

  if (!pRows.length && !gRows.length) {
    return <p className="field-msg lv-all-good"><Icon name="check" size={14} /> Kaikki tasot ovat asteikollasi.</p>;
  }
  const save = async () => {
    if (!count || busy) return;
    setBusy(true);
    const forward = { students: plan.students.map(({ id, level }) => ({ id, level })), groups: plan.groups.map(({ id, level }) => ({ id, level })) };
    const back = { students: plan.students.map(({ id, before }) => ({ id, level: before })), groups: plan.groups.map(({ id, before }) => ({ id, level: before })) };
    const res = await run(() => api.levels.relabel(coachId, forward), null, { waitForRefresh: true });
    setBusy(false);
    if (!res.ok) return;
    track('tasot.vaihda');
    setChoices({ p: {}, g: {} });
    const what = [plan.students.length && plural(plan.students.length, 'pelaajan', 'pelaajan'), plan.groups.length && plural(plan.groups.length, 'ryhmän', 'ryhmän')].filter(Boolean).join(' ja ');
    toast(`${what} taso vaihdettu.`, { duration: 8000, action: { label: 'Kumoa', onClick: () => run(() => api.levels.relabel(coachId, back), 'Muutos kumottu.') } });
  };
  return (
    <section className="stack-4">
      <div className="stack-1">
        <h2 className="t-h3">Vanhat tasot</h2>
        <p className="field-msg">Nämä tasot eivät ole asteikollasi. Samankaltaiset on koottu samalle riville. Valitse riville uusi taso, niin kaikki sen pelaajat tai ryhmät vaihtuvat kerralla, tai valitse pelaajat itse. Rivit, joita et muuta, jäävät ennalleen.</p>
        {split.size > 0 && <button type="button" className="k-textlink" onClick={() => setSplit(new Set())}>Palauta erotetut riveille</button>}
      </div>
      {pRows.length > 0 && (
        <div className="stack-3">
          <div className="field-label">Pelaajat</div>
          {pRows.map((r) => <OldRow key={r.key} row={r} choice={choices.p[r.key]} onChoose={(level) => choose('p', r.key, { level })} onPick={(ids, picking = true) => choose('p', r.key, { ids, picking })} onSplit={doSplit} byId={byId} />)}
        </div>
      )}
      {gRows.length > 0 && (
        <div className="stack-3">
          <div className="field-label">Ryhmät</div>
          {gRows.map((r) => <OldRow key={r.key} row={r} group choice={choices.g[r.key]} onChoose={(level) => choose('g', r.key, { level })} onPick={(ids, picking = true) => choose('g', r.key, { ids, picking })} onSplit={doSplit} byId={byId} />)}
        </div>
      )}
      {count > 0 && (
        <div className="lv-savebar">
          <Button variant="dark" size="lg" block loading={busy} onClick={save}>Tallenna muutokset ({count})</Button>
        </div>
      )}
    </section>
  );
}

/** One step's players (or those with no level): pick some and move them to another level at once. */
function MoveSheet({ step, onClose }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const { scale } = useLevelScale();
  const toast = useToast();
  const [picked, setPicked] = useState([]);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(null);
  if (step !== shown) { setShown(step); setPicked([]); setTarget(''); }
  const players = state.students.filter((s) => !s.rosterOnly);
  const items = (step?.ids || []).map((id) => ({ id, name: players.find((p) => p.id === id)?.name || '' })).sort(byName);
  const plan = movePlan(picked, target, players.map((p) => ({ id: p.id, level: p.level })));
  const removing = target === REMOVE_LEVEL;
  const save = async () => {
    if (!plan.length || busy) return;
    setBusy(true);
    const res = await run(() => api.levels.relabel(coachId, { students: plan.map(({ id, level }) => ({ id, level })) }), null, { waitForRefresh: true });
    setBusy(false);
    if (!res.ok) return;
    track('tasot.siirra');
    const back = plan.map(({ id, before }) => ({ id, level: before }));
    const to = removing ? 'Taso poistettu' : `Siirretty: ${levelLabel(scale, target)}`;
    toast(`${to}, ${plural(plan.length, 'pelaaja', 'pelaajaa')}.`, { duration: 8000, action: { label: 'Kumoa', onClick: () => run(() => api.levels.relabel(coachId, { students: back }), 'Muutos kumottu.') } });
    onClose();
  };
  return (
    <Sheet open={Boolean(step)} onClose={() => !busy && onClose()} size="md" dismissible={!busy}
      title={step ? (step.none ? 'Ei tasoa' : levelLabel(scale, step.value)) : ''} subtitle={step?.note || plural(items.length, 'pelaaja', 'pelaajaa')}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
        <Button variant="dark" size="lg" loading={busy} missing={!picked.length ? 'Valitse ensin pelaajat.' : !target ? 'Valitse taso, jolle siirrät.' : !plan.length ? 'Valitut ovat jo tällä tasolla.' : null} onClick={save}>
          {removing ? `Poista taso (${plan.length})` : `Siirrä (${plan.length || picked.length})`}
        </Button></div>}>
      <div className="stack-4">
        <PickList items={items} picked={picked} onChange={setPicked} />
        <div className="stack-2">
          <span className="field-label">{removing ? 'Taso poistetaan valituilta' : 'Siirrä valitut tasolle'}</span>
          {!removing && <PlayerLevelPicker value={target} onChange={setTarget} />}
          {!step?.none && <button type="button" className="k-textlink lv-remove" onClick={() => setTarget(removing ? '' : REMOVE_LEVEL)}>{removing ? 'Älä poista' : 'Poista taso valituilta'}</button>}
        </div>
      </div>
    </Sheet>
  );
}

export function LevelsScreen() {
  const { state } = useData();
  const { scale, ready, uses } = useLevelScale();
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState(null);
  const by = playersByStep(scale, state.students.filter((s) => !s.rosterOnly));
  return (
    <>
      <TopBar title="Pelaajien tasot" back="/valmentaja/profiili" />
      <Page className="stack-6 k-page-pad lv-page">
        {!ready ? <p className="field-msg">Tasojen asetukset tulevat pian käyttöön.</p> : (
          <>
            <Card className="stack-3">
              <div className="row-between">
                <div>
                  <div className="eyebrow">Asteikko</div>
                  <div className="t-h3">{scaleSummary(scale)}</div>
                </div>
                <Button variant="outline" size="sm" icon="edit" onClick={() => setEditing(true)}>Muokkaa</Button>
              </div>
              {uses && (
                <ul className="lv-steps">
                  {by.steps.map((s) => (
                    <li key={s.value}>
                      <button type="button" className="lv-step-row" disabled={!s.ids.length} onClick={() => setMoving(s)}>
                        <span className={cx('lv-step', scale.kind === 'numerot' && 't-num')}>{s.label}</span>
                        <span className="grow k-faint truncate">{s.note}</span>
                        <span className="lv-step-count t-num">{s.ids.length ? plural(s.ids.length, 'pelaaja', 'pelaajaa') : ''}</span>
                        {s.ids.length > 0 && <Icon name="chevron-right" size={16} className="k-chevron" />}
                      </button>
                    </li>
                  ))}
                  {by.none.length > 0 && (
                    <li>
                      <button type="button" className="lv-step-row" onClick={() => setMoving({ none: true, ids: by.none })}>
                        <span className="lv-step lv-step-none">Ei tasoa</span>
                        <span className="grow" />
                        <span className="lv-step-count t-num">{plural(by.none.length, 'pelaaja', 'pelaajaa')}</span>
                        <Icon name="chevron-right" size={16} className="k-chevron" />
                      </button>
                    </li>
                  )}
                </ul>
              )}
              <p className="field-msg">{!uses ? 'Tasot eivät näy lomakkeissa eivätkä listoissa. Aiemmat tasot säilyvät tallessa.'
                : [by.steps.some((s) => s.ids.length) || by.none.length ? 'Napauta tasoa, niin voit siirtää sen pelaajia kerralla.' : '',
                  scale.kind === 'numerot' ? 'Muokkaa-napista vaihdat numerot ja niiden selitykset.' : ''].filter(Boolean).join(' ')}</p>
              {uses && <p className="field-msg">Pelaaja näkee oman tasonsa vain, jos hän on täysi-ikäinen.</p>}
            </Card>
            {uses && <OldLevels scale={scale} />}
          </>
        )}
      </Page>
      <ScaleSheet open={editing} onClose={() => setEditing(false)} />
      <MoveSheet step={moving} onClose={() => setMoving(null)} />
    </>
  );
}
