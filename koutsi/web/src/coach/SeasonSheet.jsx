// SeasonSheet — "Uusi kausi": the next season as a copy of the current one, in four steps.
//   1. Kausi     name, dates and break days (suggested: hiihtoloma, pääsiäinen …)
//   2. Ryhmät    every group continues by default; tap one to change its time or end it, or add one
//   3. Pelaajat  everyone stays in their group; tap a player to move them, paste the new sign-ups
//   4. Tarkista  what changes and what the players will see; publish, or keep it as a draft
// Nothing reaches the players before "Julkaise kausi", and the current season goes on untouched.
// Players keep their accounts and history, so a new season never means joining again.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { goBack } from '../app/router.js';
import { Button, Chip, Field, Icon, Input, Select, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import { DayPicker, DurationStepper, TimeSelect } from '../shared/fields.jsx';
import { Quiet } from '../shared/bits.jsx';
import { koutsiAddDays, koutsiFmtShortDate, koutsiParseNameList, koutsiSortGroupsBySchedule, koutsiTodayStr } from '../domain/core.js';
import { lastSessionDate } from './groupForms.jsx';
import { exactNameMatch } from '../domain/roster.js';
import {
  activeGroups, addDraftGroup, addSignups, allGroupsOf, breakDates, currentSeason, draftFromSeason, draftSummary, followingSeason, groupsOfSeason,
  placePlayer, placementsOf, playerSeasonMessage, rangeLabel, scheduleChanged, seasonName, seasonWeeks, seasonWord,
  suggestedBreaks, updateDraftGroup,
} from '../domain/season.js';
import { useCoach } from './CoachRoot.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const STEPS = ['Kausi', 'Ryhmät', 'Pelaajat', 'Tarkista'];
const fmt = (d) => koutsiFmtShortDate(d);
const when = (g) => `${g.day} ${g.time}`;
const copy = (v) => JSON.parse(JSON.stringify(v));

export function SeasonSheet() {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const current = useMemo(() => currentSeason(state), [state]);
  const [open, setOpen] = useState(true);
  const [step, setStep] = useState(1);
  const [draft, setDraft] = useState(() => {
    if (!state.seasonsReady || !current) return null;
    const saved = state.seasonDraft && state.seasonDraft.fromSeasonId === current.id ? state.seasonDraft : null;
    return saved ? copy(saved) : draftFromSeason(state, current);
  });
  const [busy, setBusy] = useState(null);
  const top = useRef(null);
  // every step starts from its top, not where the previous step was scrolled to
  useEffect(() => { top.current?.closest('.sheet-body')?.scrollTo({ top: 0 }); }, [step]);
  const summary = useMemo(() => (draft ? draftSummary(state, draft) : null), [state, draft]);
  const close = () => !busy && setOpen(false);

  if (!draft) {
    return (
      <Sheet open={open} onClose={close} onClosed={() => goBack('/valmentaja/koti')} size="md" title="Uusi kausi">
        <Quiet icon="calendar">Kauden vaihto tulee käyttöön pian. Siihen asti voit jatkaa ryhmien kalenteria Kodista.</Quiet>
      </Sheet>
    );
  }
  // the next season is already out: it is changed group by group, not published again
  const published = followingSeason(state, current);
  if (published) {
    return (
      <Sheet open={open} onClose={close} onClosed={() => goBack('/valmentaja/koti')} size="md" title={published.name}>
        <Quiet icon="check-circle">{published.name} on jo julkaistu ja alkaa {fmt(published.startsOn)}. Ryhmiä ja pelaajia muutat ryhmien sivuilta Viikkohallinnasta.</Quiet>
      </Sheet>
    );
  }

  const datesOk = Boolean(draft.name.trim() && draft.startsOn && draft.endsOn && draft.endsOn > draft.startsOn);
  const saveDraft = async () => {
    setBusy('draft');
    const res = await run(() => api.seasons.saveDraft(coachId, draft), `${draft.name} tallennettu luonnokseksi — pelaajat eivät näe sitä vielä.`);
    setBusy(null);
    if (res.ok) setOpen(false);
  };
  const publish = async () => {
    const ok = await confirm({
      title: `Julkaise ${draft.name}?`,
      message: `${summary.groups.active.length} ryhmää ja ${summary.sessions} treeniä tulevat kalenteriin. Jokainen pelaaja saa yhden ilmoituksen omista ryhmistään. ${current.name} jatkuu ennallaan loppuun asti.`,
      confirmLabel: 'Julkaise kausi',
    });
    if (!ok) return;
    setBusy('publish');
    const res = await run(() => api.seasons.publish(coachId, draft));
    setBusy(null);
    if (res.ok) {
      toast(`${draft.name} julkaistu — ${res.result?.groups ?? summary.groups.active.length} ryhmää ja ${res.result?.sessions ?? summary.sessions} treeniä kalenterissa.`);
      setOpen(false);
    }
  };

  const back = <Button variant="soft" size="lg" icon="arrow-left" onClick={() => setStep(step - 1)} disabled={Boolean(busy)}>Takaisin</Button>;
  const footer = step === 1 ? (
    <div className="sheet-actions"><Button variant="soft" size="lg" onClick={close}>Peruuta</Button><Button variant="dark" size="lg" iconRight="arrow-right" disabled={!datesOk} onClick={() => setStep(2)}>Ryhmät</Button></div>
  ) : step === 2 ? (
    <div className="sheet-actions">{back}<Button variant="dark" size="lg" iconRight="arrow-right" disabled={!summary.groups.active.length} onClick={() => setStep(3)}>Pelaajat</Button></div>
  ) : step === 3 ? (
    <div className="sheet-actions">{back}<Button variant="dark" size="lg" iconRight="arrow-right" onClick={() => setStep(4)}>Tarkista</Button></div>
  ) : (
    <div className="season-foot">
      <Button variant="lime" size="lg" block icon="send" loading={busy === 'publish'} disabled={Boolean(busy)} onClick={publish}>Julkaise kausi</Button>
      <div className="sheet-actions">{back}<Button variant="outline" size="lg" loading={busy === 'draft'} disabled={Boolean(busy)} onClick={saveDraft}>Tallenna luonnos</Button></div>
    </div>
  );

  return (
    <Sheet open={open} onClose={close} onClosed={() => goBack('/valmentaja/koti')} size="lg" dismissible={!busy}
      title={step === 1 ? 'Uusi kausi' : draft.name} subtitle={`${step}/4 · ${STEPS[step - 1]}`} footer={footer} className="season-sheet">
      <ol ref={top} className="season-steps" aria-hidden="true">
        {STEPS.map((label, i) => <li key={label} className={cx(i + 1 === step && 'is-on', i + 1 < step && 'is-done')} />)}
      </ol>
      {step === 1 && <StepSeason draft={draft} setDraft={setDraft} current={current} />}
      {step === 2 && <StepGroups draft={draft} setDraft={setDraft} summary={summary} />}
      {step === 3 && <StepPlayers draft={draft} setDraft={setDraft} summary={summary} />}
      {step === 4 && <StepReview draft={draft} summary={summary} current={current} />}
    </Sheet>
  );
}

// ── 1. Kausi ─────────────────────────────────────────────────────────────────

function StepSeason({ draft, setDraft, current }) {
  const set = (patch) => setDraft((d) => {
    const next = { ...d, ...patch };
    // the name follows the start date until the coach writes their own
    if (patch.startsOn && d.name === seasonName(d.startsOn)) next.name = seasonName(patch.startsOn);
    return next;
  });
  const toggle = (key) => setDraft((d) => ({ ...d, breaks: d.breaks.map((b) => (b.key === key ? { ...b, on: !b.on } : b)) }));
  const weeks = seasonWeeks(draft);
  return (
    <div className="stack-5">
      <p className="season-lead">
        {current.name} jatkuu {fmt(current.endsOn)} asti. Ryhmät ja pelaajat siirtyvät uudelle kaudelle valmiiksi — muutat vain sen, mikä muuttuu.
      </p>
      <Field label="Kauden nimi" htmlFor="season-name">
        <Input id="season-name" value={draft.name} maxLength={60} onChange={(e) => set({ name: e.target.value })} />
      </Field>
      <div className="k-two">
        <Field label="Alkaa" htmlFor="season-start">
          <Input id="season-start" type="date" value={draft.startsOn} onChange={(e) => set({ startsOn: e.target.value })} />
        </Field>
        <Field label="Loppuu" htmlFor="season-end">
          <Input id="season-end" type="date" value={draft.endsOn} min={draft.startsOn} onChange={(e) => set({ endsOn: e.target.value })} />
        </Field>
      </div>
      {draft.breaks.length > 0 && (
        <Field label="Tauot" hint="Näinä päivinä ei ole treenejä. Napauta pois, jos treenaatte silti.">
          <div className="k-weeks-row">
            {draft.breaks.map((b) => (
              <button key={b.key} type="button" className={cx('planner-chip', b.on && 'is-on')} aria-pressed={b.on} onClick={() => toggle(b.key)}>
                {b.label}<span className="planner-chip-sub">{rangeLabel(b.from, b.to)}</span>
              </button>
            ))}
          </div>
        </Field>
      )}
      {weeks > 0 && <p className="k-faint">{weeks} viikkoa · {fmt(draft.startsOn)}–{fmt(draft.endsOn)}</p>}
    </div>
  );
}

// ── 2. Ryhmät ────────────────────────────────────────────────────────────────

const STATUS = {
  jatkuu: { label: 'Jatkuu', tone: 'neutral' },
  muuttuu: { label: 'Muuttuu', tone: 'lime' },
  loppuu: { label: 'Loppuu', tone: 'clay' },
  uusi: { label: 'Uusi', tone: 'lime' },
};

function StepGroups({ draft, setDraft, summary }) {
  const { state } = useData();
  const [editing, setEditing] = useState(null); // draft group key | 'new'
  const g = summary.groups;
  const counts = [
    `${g.active.length} ryhmää`,
    g.changed.length && `${g.changed.length} muuttuu`,
    g.ended.length && `${g.ended.length} loppuu`,
    g.added.length && `${g.added.length} uusi`,
  ].filter(Boolean).join(' · ');
  const rows = koutsiSortGroupsBySchedule(draft.groups);
  return (
    <div className="stack-4">
      <p className="season-lead">Kaikki ryhmät jatkuvat samoina. Napauta ryhmää, jos sen aika muuttuu tai se ei jatku.</p>
      <div className="k-faint">{counts}</div>
      <div className="k-list">
        {rows.map((dg) => {
          const from = dg.fromId ? allGroupsOf(state).find((x) => x.id === dg.fromId) : null;
          const count = (draft.members[dg.key] || []).length;
          const moved = dg.status === 'muuttuu' && scheduleChanged(dg, from);
          return (
            <button key={dg.key} type="button" className={cx('season-row', dg.status === 'loppuu' && 'is-ended')} onClick={() => setEditing(dg.key)}>
              <span className="season-when"><b>{dg.day}</b>{dg.time}</span>
              <span className="k-row-main">
                <span className="k-row-title truncate">{dg.name}</span>
                <span className="k-row-sub truncate">
                  {dg.status === 'loppuu' ? `Ei jatku ${seasonWord(draft.startsOn, 'ade')}` : moved ? `Ennen ${when(from)}` : `${count} pelaajaa · ${dg.durationMinutes} min`}
                </span>
              </span>
              <Chip tone={STATUS[dg.status].tone} size="sm">{STATUS[dg.status].label}</Chip>
            </button>
          );
        })}
      </div>
      <Button variant="outline" icon="plus" onClick={() => setEditing('new')}>Uusi ryhmä</Button>
      <DraftGroupSheet draft={draft} groupKey={editing} onClose={() => setEditing(null)}
        onSave={(fn) => { setDraft(fn); setEditing(null); }} />
    </div>
  );
}

function DraftGroupSheet({ draft, groupKey, onClose, onSave }) {
  const { state } = useData();
  const isNew = groupKey === 'new';
  const dg = !isNew && groupKey ? draft.groups.find((x) => x.key === groupKey) : null;
  const from = dg?.fromId ? allGroupsOf(state).find((x) => x.id === dg.fromId) : null;
  const [form, setForm] = useState(null);
  const [lastKey, setLastKey] = useState(null);
  // a new group to edit (or none): start the form from it; this render is thrown away
  if (groupKey !== lastKey) {
    setLastKey(groupKey);
    setForm(groupKey && (isNew || dg) ? (isNew
      ? { status: 'uusi', name: '', level: '', day: 'Ma', time: '', durationMinutes: 60 }
      : { status: dg.status, name: dg.name, level: dg.level, day: dg.day, time: dg.time, durationMinutes: dg.durationMinutes }) : null);
    return null;
  }
  if (!form || (!isNew && !dg)) return null;
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const editable = form.status === 'muuttuu' || form.status === 'uusi';
  const valid = !editable || (form.name.trim() && form.time);
  const save = () => {
    if (isNew) { onSave((d) => addDraftGroup(d, { ...form, name: form.name.trim(), level: form.level.trim() })); return; }
    let patch = { ...form, name: form.name.trim() };
    if (form.status === 'muuttuu' && from && !scheduleChanged(patch, from) && patch.name === from.name && (patch.level || '') === (from.level || '')) {
      patch = { status: 'jatkuu' }; // nothing changed after all
    }
    if (form.status === 'jatkuu' || form.status === 'loppuu') {
      patch = { status: form.status, ...(from ? { name: from.name, level: from.level || '', day: from.day, time: from.time, durationMinutes: from.durationMinutes || 60 } : {}) };
    }
    onSave((d) => updateDraftGroup(d, groupKey, patch));
  };
  const remove = () => onSave((d) => ({ ...d, groups: d.groups.filter((x) => x.key !== groupKey) }));
  const count = dg ? (draft.members[dg.key] || []).length : 0;
  const choice = (status, title, text) => (
    <label className={cx('k-pick season-choice', form.status === status && 'is-on')}>
      <input type="radio" name="season-group-status" checked={form.status === status} onChange={() => set({ status })} />
      <span className="grow"><span className="k-pick-title">{title}</span><span className="k-faint">{text}</span></span>
    </label>
  );
  return (
    <Sheet open={Boolean(groupKey)} onClose={onClose} size="md"
      title={isNew ? 'Uusi ryhmä' : dg?.name} subtitle={isNew ? `${draft.name} · pelaajat lisäät seuraavassa vaiheessa` : `${when(from || dg)} · ${count} pelaajaa`}
      footer={<div className="sheet-actions">
        {dg?.status === 'uusi' ? <Button variant="ghost" size="lg" icon="trash" onClick={remove}>Poista</Button> : <Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button>}
        <Button variant="dark" size="lg" disabled={!valid} onClick={save}>{isNew ? 'Lisää ryhmä' : 'Valmis'}</Button>
      </div>}>
      <div className="stack-4">
        {!isNew && dg?.status !== 'uusi' && (
          <div className="k-list">
            {choice('jatkuu', 'Jatkuu samana', 'Sama aika ja samat pelaajat. Siirrot teet seuraavassa vaiheessa.')}
            {choice('muuttuu', 'Muuta aikaa tai nimeä', 'Pelaajat siirtyvät mukana.')}
            {choice('loppuu', `Ei jatku ${seasonWord(draft.startsOn, 'ade')}`, count ? `${count} pelaajaa jää ilman ryhmää — valitset heille uuden seuraavassa vaiheessa.` : 'Ryhmässä ei ole pelaajia.')}
          </div>
        )}
        {editable && (
          <div className="stack-3 season-fields">
            <div className="k-two">
              <Input value={form.name} onChange={(e) => set({ name: e.target.value })} placeholder="Nimi, esim. Juniorit keltainen" maxLength={120} aria-label="Ryhmän nimi" />
              <Input value={form.level} onChange={(e) => set({ level: e.target.value })} placeholder="Taso (valinn.)" maxLength={80} aria-label="Taso" />
            </div>
            <DayPicker value={form.day} onChange={(day) => set({ day })} />
            <div className="k-two">
              <TimeSelect value={form.time} onChange={(time) => set({ time })} />
              <DurationStepper value={form.durationMinutes} onChange={(durationMinutes) => set({ durationMinutes })} />
            </div>
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ── 3. Pelaajat ──────────────────────────────────────────────────────────────

function StepPlayers({ draft, setDraft, summary }) {
  const { state } = useData();
  const [picking, setPicking] = useState(null); // player ref
  const [signups, setSignups] = useState(false);
  const p = summary.players;
  const nameOf = (ref) => state.students.find((s) => s.id === ref)?.name || draft.newPlayers.find((x) => x.key === ref)?.name || '';
  const fromOf = (dg) => (dg.fromId ? allGroupsOf(state).find((g) => g.id === dg.fromId) : null);
  const groupsBefore = (ref) => allGroupsOf(state).filter((g) => draft.groups.some((dg) => dg.fromId === g.id) && g.memberIds.includes(ref));
  const counts = [
    `${p.total} pelaajaa`,
    p.moved.length && `${p.moved.length} siirtyy`,
    p.newPlayers.length && `${p.newPlayers.length} uutta`,
    p.leaving.length && `${p.leaving.length} ei jatka`,
  ].filter(Boolean).join(' · ');
  const chip = (ref, dg) => {
    const isNew = draft.newPlayers.some((x) => x.key === ref);
    const before = isNew ? [] : groupsBefore(ref);
    const movedIn = !isNew && dg && !(dg.fromId && before.some((g) => g.id === dg.fromId));
    return (
      <button key={ref} type="button" className={cx('season-chip', movedIn && 'is-moved', isNew && 'is-new')} onClick={() => setPicking(ref)}>
        {movedIn && <Icon name="arrow-right" size={13} strokeWidth={2.6} />}
        <span className="truncate">{nameOf(ref)}</span>
        {isNew && <span className="season-chip-tag">uusi</span>}
      </button>
    );
  };
  const unplaced = [...p.leaving.map((s) => s.id), ...p.unplacedNew.map((x) => x.key)];
  const ade = seasonWord(draft.startsOn, 'ade');
  return (
    <div className="stack-4">
      <p className="season-lead">Jokainen jatkaa samassa ryhmässä. Napauta pelaajaa, jos hän vaihtaa ryhmää tai ei jatka.</p>
      <div className="row-between season-players-head">
        <span className="k-faint">{counts}</span>
        <Button variant="outline" size="sm" icon="list" onClick={() => setSignups(true)}>Lisää ilmoittautuneet</Button>
      </div>
      {activeGroups(draft).map((dg) => {
        const refs = [...(draft.members[dg.key] || [])].sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'fi'));
        const from = fromOf(dg);
        return (
          <section key={dg.key} className="season-group">
            <div className="season-group-head">
              <span className="season-group-when">{when(dg)}</span>
              <span className="season-group-name truncate">{dg.name}</span>
              {dg.status !== 'jatkuu' && <Chip tone="lime" size="sm">{dg.status === 'uusi' ? 'Uusi' : 'Muuttuu'}</Chip>}
              <span className="season-group-count t-num">{refs.length}</span>
            </div>
            {refs.length ? <div className="season-chips">{refs.map((ref) => chip(ref, dg))}</div>
              : <p className="k-faint">{from ? 'Ei pelaajia.' : 'Ei vielä pelaajia — napauta pelaajaa ja valitse tämä ryhmä, tai lisää ilmoittautuneet.'}</p>}
          </section>
        );
      })}
      {unplaced.length > 0 && (
        <section className="season-group is-out">
          <div className="season-group-head">
            <span className="season-group-name">Ei jatka {ade}</span>
            <span className="season-group-count t-num">{unplaced.length}</span>
          </div>
          <div className="season-chips">{unplaced.map((ref) => chip(ref, null))}</div>
          <p className="k-faint">Tunnus ja kehitys säilyvät. Napauta, jos pelaaja jatkaa jossain ryhmässä.</p>
        </section>
      )}
      <PlaceSheet draft={draft} playerRef={picking} name={picking ? nameOf(picking) : ''} before={picking ? groupsBefore(picking) : []}
        onClose={() => setPicking(null)} onSave={(keys) => { setDraft((d) => placePlayer(d, picking, keys)); setPicking(null); }} />
      <SignupsSheet open={signups} draft={draft} onClose={() => setSignups(false)}
        onSave={(rows) => { setDraft((d) => addSignups(d, rows)); setSignups(false); }} />
    </div>
  );
}

function PlaceSheet({ draft, playerRef, name, before, onClose, onSave }) {
  const [picked, setPicked] = useState([]);
  const [lastRef, setLastRef] = useState(null);
  if (playerRef !== lastRef) {
    setLastRef(playerRef);
    setPicked(playerRef ? placementsOf(draft, playerRef).map((dg) => dg.key) : []);
    return null;
  }
  if (!playerRef) return null;
  const groups = activeGroups(draft);
  const ade = seasonWord(draft.startsOn, 'ade');
  const beforeIds = new Set(before.map((g) => g.id));
  return (
    <Sheet open={Boolean(playerRef)} onClose={onClose} size="md" title={name}
      subtitle={before.length ? `Nyt: ${before.map((g) => `${g.name} (${g.day})`).join(', ')}` : 'Uusi pelaaja'}
      footer={<div className="sheet-actions">
        <Button variant="soft" size="lg" onClick={() => onSave([])}>Ei jatka {ade}</Button>
        <Button variant="dark" size="lg" onClick={() => onSave(picked)}>Valmis</Button>
      </div>}>
      <Field label={`Ryhmät ${ade}`} hint="Valitse yksi tai useampi.">
        <div className="k-pick-list season-pick-list">
          {groups.map((dg) => (
            <label key={dg.key} className={cx('k-pick', picked.includes(dg.key) && 'is-on')}>
              <input type="checkbox" checked={picked.includes(dg.key)} onChange={() => setPicked((p) => (p.includes(dg.key) ? p.filter((x) => x !== dg.key) : [...p, dg.key]))} />
              <span className="grow">
                <span className="k-pick-title">{when(dg)} · {dg.name}</span>
                {dg.fromId && beforeIds.has(dg.fromId) && <span className="k-faint">Pelaa tässä nyt</span>}
                {dg.status === 'uusi' && <span className="k-faint">Uusi ryhmä</span>}
              </span>
            </label>
          ))}
        </div>
      </Field>
    </Sheet>
  );
}

function SignupsSheet({ open, draft, onClose, onSave }) {
  const { state } = useData();
  const [paste, setPaste] = useState('');
  const [assign, setAssign] = useState({});
  const groups = activeGroups(draft);
  const names = [...new Set(koutsiParseNameList(paste))];
  const rows = names.map((name) => {
    const match = exactNameMatch(state.students, name);
    return { name, existingId: match?.id || null, groupKey: assign[name] || '' };
  });
  const ready = rows.filter((r) => r.groupKey);
  const reset = () => { setPaste(''); setAssign({}); };
  return (
    <Sheet open={open} onClose={() => { reset(); onClose(); }} size="md" title="Lisää ilmoittautuneet" subtitle={`${draft.name} · esim. seuran ilmoittautumislistalta`}
      footer={<div className="sheet-actions">
        <Button variant="soft" size="lg" onClick={() => { reset(); onClose(); }}>Peruuta</Button>
        <Button variant="dark" size="lg" disabled={!ready.length} onClick={() => { onSave(ready); reset(); }}>{ready.length ? `Lisää ${ready.length}` : 'Lisää'}</Button>
      </div>}>
      <div className="stack-4">
        <Field label="Nimet" hint="Yksi per rivi — esim. suoraan Excelistä (ensimmäinen sarake). Jo listallasi olevat tunnistetaan, joten kenestäkään ei tule kahta." htmlFor="season-names">
          <Textarea id="season-names" rows={5} value={paste} onChange={(e) => setPaste(e.target.value)} placeholder={'Ville S.\nEmma T.\n…'} />
        </Field>
        {rows.length > 0 && (
          <div className="k-list">
            {rows.map((r) => (
              <div key={r.name} className="k-bulk-row">
                <span className="grow">
                  <span className="k-row-title truncate">{r.name}</span>
                  <span className="k-faint">{r.existingId ? 'On jo listallasi — tunnus ja kehitys jatkuvat' : 'Uusi pelaaja — saa kutsulinkin'}</span>
                </span>
                <Select aria-label={`Ryhmä: ${r.name}`} value={r.groupKey} placeholder="Valitse ryhmä"
                  options={groups.map((dg) => ({ value: dg.key, label: `${when(dg)} · ${dg.name}` }))}
                  onChange={(e) => setAssign((a) => ({ ...a, [r.name]: e.target.value }))} />
              </div>
            ))}
          </div>
        )}
      </div>
    </Sheet>
  );
}

// ── 4. Tarkista ──────────────────────────────────────────────────────────────

function StepReview({ draft, summary, current }) {
  const { state } = useData();
  const g = summary.groups;
  const p = summary.players;
  const fromOf = (dg) => (dg.fromId ? allGroupsOf(state).find((x) => x.id === dg.fromId) : null);
  const names = (list) => (list.length > 3 ? `${list.slice(0, 3).join(', ')} ja ${list.length - 3} muuta` : list.join(', '));
  // "Juniorit kilpa (Ma, To)" — two groups can share a name, the days tell them apart
  const withDays = (groups) => {
    const by = new Map();
    for (const x of groups) by.set(x.name, [...(by.get(x.name) || []), x.day]);
    return [...by].map(([name, days]) => `${name} (${days.join(', ')})`).join(', ');
  };
  const ade = seasonWord(draft.startsOn, 'ade');
  const changes = [
    ...g.changed.map((dg) => ({ icon: 'clock', text: <><b>{dg.name}</b> {when(fromOf(dg) || dg)} → {when(dg)}</> })),
    ...g.added.map((dg) => ({ icon: 'plus', text: <>Uusi ryhmä <b>{dg.name}</b> {when(dg)}</> })),
    ...g.ended.map((dg) => ({ icon: 'close', text: <><b>{dg.name}</b> ei jatku</> })),
    ...p.moved.map((m) => ({ icon: 'arrow-right', text: <><b>{m.student?.name}</b> {withDays(m.from) || '—'} → {withDays(m.to) || '—'}</> })),
    ...(p.newPlayers.length ? [{ icon: 'user', text: <>Uudet pelaajat: <b>{names(p.newPlayers.map((x) => x.name))}</b></> }] : []),
    ...(p.leaving.length ? [{ icon: 'logout', text: <>Ei jatka {ade}: {names(p.leaving.map((s) => s.name))}</> }] : []),
  ];
  // an example notification: Maria (the demo player) or the first player with groups
  const allRefs = g.active.flatMap((dg) => draft.members[dg.key] || []);
  const example = state.students.find((s) => s.id === 'demo-s-maria' && allRefs.includes(s.id)) || state.students.find((s) => allRefs.includes(s.id));
  const exampleGroups = example ? placementsOf(draft, example.id) : [];
  return (
    <div className="stack-5">
      <section className="season-hero on-dark">
        <span className="eyebrow">Uusi kausi</span>
        <h3 className="season-hero-title">{draft.name}</h3>
        <span className="season-hero-sub">{fmt(draft.startsOn)}–{fmt(draft.endsOn)} · {summary.weeks} viikkoa</span>
        <div className="season-stats">
          <span><b className="t-num">{g.active.length}</b>ryhmää</span>
          <span><b className="t-num">{summary.sessions}</b>treeniä</span>
          <span><b className="t-num">{p.total}</b>pelaajaa</span>
        </div>
      </section>
      <section className="stack-2">
        <h3 className="t-h3">Mikä muuttuu</h3>
        {changes.length === 0 ? <Quiet icon="check-circle">Ei muutoksia — kaikki jatkaa kuten nyt.</Quiet> : (
          <ul className="season-changes">
            {changes.map((c, i) => <li key={i}><span className="season-change-icon"><Icon name={c.icon} size={15} /></span><span>{c.text}</span></li>)}
          </ul>
        )}
      </section>
      {example && exampleGroups.length > 0 && (
        <section className="stack-2">
          <h3 className="t-h3">Pelaajat näkevät</h3>
          <div className="season-notice">
            <span className="season-notice-icon"><Icon name="bell" size={17} /></span>
            <span className="grow">
              <span className="season-notice-title">{draft.name}: ryhmäsi ovat valmiina</span>
              <span className="season-notice-text">{playerSeasonMessage(draft, exampleGroups, fmt)}</span>
            </span>
          </div>
          <p className="k-faint">Jokainen saa yhden ilmoituksen omista ryhmistään. Esimerkki: {example.name}</p>
        </section>
      )}
      {p.noAccount > 0 && (
        <div className="season-invite">
          <span className="k-alert-icon is-lime"><Icon name="send" size={18} /></span>
          <span className="grow">
            <span className="k-row-title">{p.noAccount} pelaajaa ilman tunnusta</span>
            <span className="k-row-sub">Kauden alku on hyvä hetki kutsua heidät. Julkaisun jälkeen jokaisen oma linkki on Kutsu pelaajat -listalla.</span>
          </span>
        </div>
      )}
      <p className="k-fine"><Icon name="info" size={14} /> {current.name} ei muutu: treenit, läsnäolot ja teemat jäävät talteen. Pelaajat eivät näe uutta kautta ennen julkaisua.</p>
    </div>
  );
}


// ── Muokkaa kautta ───────────────────────────────────────────────────────────
// The running season's name and end. Moving the end later continues every group's calendar to
// it (one notification per group, like "Jatka kalenteria"); break days in the added weeks are
// suggested and left out. Shortening is not offered: it would cancel sessions one by one.

export function SeasonEditSheet({ open, onClose, season }) {
  const { state, run } = useData();
  const toast = useToast();
  const [name, setName] = useState('');
  const [endsOn, setEndsOn] = useState('');
  const [extra, setExtra] = useState([]);
  const [busy, setBusy] = useState(false);
  const [lastOpen, setLastOpen] = useState(false);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open && season) { setName(season.name); setEndsOn(season.endsOn); setExtra([]); }
  }
  // only groups that run to the season's end follow it; a shorter series (a fall match night that
  // already ended) stays as the coach made it
  const groups = season ? groupsOfSeason(state, season).filter((g) => (lastSessionDate(state, g.id) || '') >= koutsiAddDays(season.endsOn, -6)) : [];
  // breaks suggested for the weeks the season grows by (the ones it already had stay as they were)
  const added = useMemo(() => {
    if (!season || !endsOn || endsOn <= season.endsOn) return [];
    const have = new Set((season.breaks || []).map((b) => b.key));
    return suggestedBreaks(season.startsOn, endsOn).filter((b) => !have.has(b.key) && b.to > season.endsOn && b.from <= endsOn);
  }, [season, endsOn]);
  const offKeys = new Set(extra);
  const breaks = [...(season?.breaks || []), ...added.map((b) => ({ ...b, on: !offKeys.has(b.key) }))];
  const longer = Boolean(season && endsOn > season.endsOn);
  const valid = Boolean(season && name.trim() && endsOn && endsOn >= season.endsOn && endsOn > koutsiTodayStr());
  const save = async () => {
    if (!valid || busy) return;
    setBusy(true);
    let addedCount = 0;
    const res = await run(async () => {
      await api.seasons.update(season.id, { name: name.trim(), endsOn, breaks });
      if (longer) {
        const skip = [...breakDates(breaks)];
        for (const g of groups) {
          const r = await api.groups.extendSeries(g.id, endsOn, skip);
          addedCount += Number(r?.added || 0);
        }
      }
    });
    setBusy(false);
    if (res.ok) {
      toast(longer ? `${name.trim()} jatkuu ${fmt(endsOn)} asti — ${addedCount} treeniä lisätty.` : 'Kausi tallennettu.');
      onClose();
    }
  };
  if (!season) return null;
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} size="md" title="Muokkaa kautta" subtitle={`${fmt(season.startsOn)}–${fmt(season.endsOn)}`} dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!valid} loading={busy} onClick={save}>Tallenna</Button></div>}>
      <div className="stack-5">
        <Field label="Kauden nimi" htmlFor="season-edit-name">
          <Input id="season-edit-name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Kausi loppuu" htmlFor="season-edit-end" hint="Kautta voi pidentää: ryhmien treenit jatkuvat samaan aikaan uuteen loppuun asti.">
          <Input id="season-edit-end" type="date" value={endsOn} min={season.endsOn} onChange={(e) => setEndsOn(e.target.value)} />
        </Field>
        {added.length > 0 && (
          <Field label="Tauot lisäviikoilla" hint="Näinä päivinä ei lisätä treenejä.">
            <div className="k-weeks-row">
              {added.map((b) => (
                <button key={b.key} type="button" className={cx('planner-chip', !offKeys.has(b.key) && 'is-on')} aria-pressed={!offKeys.has(b.key)}
                  onClick={() => setExtra((p) => (p.includes(b.key) ? p.filter((x) => x !== b.key) : [...p, b.key]))}>
                  {b.label}<span className="planner-chip-sub">{rangeLabel(b.from, b.to)}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        {longer && <p className="field-msg">{groups.length} ryhmän treenit jatkuvat {fmt(endsOn)} asti. Pelaajat saavat yhden ilmoituksen ryhmää kohden — ei jokaisesta treenistä.</p>}
      </div>
    </Sheet>
  );
}
