// groupForms.jsx — sheets for creating and changing groups: the group itself, an extra weekly
// time, members, a group invite link, continuing the calendar, and the annual plan.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { navigate } from '../app/router.js';
import { Avatar, Button, Field, Icon, Input, Sheet, useConfirm, useToast } from '../ui/index.js';
import { CopyButton, QrCode, ShareTextButton, Quiet } from '../shared/bits.jsx';
import { DayPicker, DurationStepper, TimeSelect, optionalAge, FilePick } from '../shared/fields.jsx';
import {
  koutsiTimeRangeLabel, koutsiInviteLink, koutsiInviteMessage, koutsiFmtShortDate, koutsiTodayStr,
  koutsiAddDays, koutsiIsoWeekOfDateStr, koutsiIsoWeekKey, koutsiDateFromStr,
} from '../domain/core.js';
import { exactNameMatch, matchStudents } from '../domain/roster.js';
import { weekDates, themeWeekShort } from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath } from './nav.js';
import { weeksLeftInSeason } from '../domain/season.js';

const cx = (...c) => c.filter(Boolean).join(' ');

/**
 * How many weeks of sessions a new group (or weekly time) gets. With seasons the first choice is
 * "Kauden loppuun" — the sessions run to the season's end instead of a round number of weeks.
 */
export function useDefaultWeeks() {
  const { state } = useData();
  const left = weeksLeftInSeason(state);
  return { left, initial: left || 12 };
}

export function WeeksChips({ value, onChange, left }) {
  const rest = [8, 12, 20, 30].filter((w) => w !== left);
  return (
    <div className="k-weeks-row">
      {left && (
        <button type="button" className={cx('planner-chip', value === left && 'is-on')} onClick={() => onChange(left)}>
          Kauden loppuun<span className="planner-chip-sub">{left} vk</span>
        </button>
      )}
      {rest.map((w) => <button key={w} type="button" className={cx('planner-chip', value === w && 'is-on')} onClick={() => onChange(w)}>{w} vk</button>)}
    </div>
  );
}

/** Create or edit a group. Creating generates its weekly sessions for `weeks` weeks. */
export function GroupFormSheet({ open, onClose, editing }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const seasonWeeks = useDefaultWeeks();
  const isEdit = Boolean(editing);
  const [name, setName] = useState('');
  const [level, setLevel] = useState('');
  const [day, setDay] = useState('Ma');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [weeks, setWeeks] = useState(12);
  const [memberIds, setMemberIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap must not create two groups with two series
  useEffect(() => {
    if (!open) return;
    setName(editing?.name || ''); setLevel(editing?.level || ''); setDay(editing?.day || 'Ma');
    setTime(editing?.time || ''); setDuration(editing?.durationMinutes || 60); setWeeks(seasonWeeks.initial); setMemberIds([]);
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleChanged = isEdit && (editing.day !== day || editing.time !== time || (editing.durationMinutes || 60) !== duration);
  const ready = name.trim() && time;
  const submit = async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const fields = { name: name.trim(), level: level.trim() || 'Kaikki tasot', day, time, durationMinutes: duration, weeksAhead: weeks };
    const res = isEdit
      ? await run(() => api.groups.update(editing.id, fields), 'Ryhmä päivitetty.')
      : await run(() => api.groups.create(coachId, { ...fields, memberIds }), 'Ryhmä luotu — treenit ovat kalenterissa.');
    busyRef.current = false; setBusy(false);
    if (res.ok) {
      onClose();
      if (!isEdit && res.result) navigate(groupPath(res.result));
    }
  };
  const players = state.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={isEdit ? 'Muokkaa ryhmää' : 'Uusi ryhmä'} size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={submit}>{isEdit ? 'Tallenna' : 'Luo ryhmä'}</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="g-name"><Input id="g-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. tiistai aikuiset" maxLength={120} /></Field>
        <Field label="Taso" optional htmlFor="g-level"><Input id="g-level" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Esim. Keskitaso" maxLength={80} /></Field>
        <Field label="Viikonpäivä"><DayPicker value={day} onChange={setDay} /></Field>
        <div className="k-two">
          <Field label="Kellonaika"><TimeSelect value={time} onChange={setTime} /></Field>
          <Field label="Kesto"><DurationStepper value={duration} onChange={setDuration} /></Field>
        </div>
        {time && <p className="field-msg">{day} klo {koutsiTimeRangeLabel(time, duration)} viikoittain</p>}
        {(!isEdit || scheduleChanged) && (
          <Field label="Treenit kalenteriin" hint={isEdit ? 'Aikataulun muutos poistaa tulevat treenit ja luo uudet. Menneet treenit ja niiden läsnäolot säilyvät.' : 'Viikoittaiset treenit ilmestyvät kalenteriin heti. Kalenteria voi myöhemmin jatkaa.'}>
            <WeeksChips value={weeks} onChange={setWeeks} left={seasonWeeks.left} />
          </Field>
        )}
        {!isEdit && players.length > 0 && (
          <Field label={`Pelaajat (${memberIds.length} valittu)`} optional>
            <div className="k-pick-list">
              {players.map((s) => (
                <label key={s.id} className={cx('k-pick', memberIds.includes(s.id) && 'is-on')}>
                  <input type="checkbox" checked={memberIds.includes(s.id)} onChange={() => setMemberIds((p) => (p.includes(s.id) ? p.filter((x) => x !== s.id) : [...p, s.id]))} />
                  <Avatar person={s} size={28} />
                  <span className="truncate">{s.name}</span>
                </label>
              ))}
            </div>
          </Field>
        )}
      </div>
    </Sheet>
  );
}

/** A second (or third) weekly time for a group, with its own series. */
export function SlotFormSheet({ open, onClose, group }) {
  const { run } = useData();
  const { coachId } = useCoach();
  const seasonWeeks = useDefaultWeeks();
  const [day, setDay] = useState('Ma');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [weeks, setWeeks] = useState(12);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDay('Ma'); setTime(''); setDuration(group?.durationMinutes || 60); setWeeks(seasonWeeks.initial); } }, [open, group]); // eslint-disable-line react-hooks/exhaustive-deps
  const submit = async () => {
    if (!time || busy) return;
    setBusy(true);
    const res = await run(() => api.groups.addSlot({ groupId: group.id, coachId, day, time, durationMinutes: duration, weeksAhead: weeks }), 'Harjoitusaika lisätty.');
    setBusy(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Lisää harjoitusaika" subtitle="Toinen viikoittainen aika samalle ryhmälle." size="sm"
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!time} loading={busy} onClick={submit}>Lisää</Button></div>}>
      <div className="stack-4">
        <Field label="Viikonpäivä"><DayPicker value={day} onChange={setDay} /></Field>
        <div className="k-two">
          <Field label="Kellonaika"><TimeSelect value={time} onChange={setTime} /></Field>
          <Field label="Kesto"><DurationStepper value={duration} onChange={setDuration} /></Field>
        </div>
        <Field label="Treenit kalenteriin">
          <WeeksChips value={weeks} onChange={setWeeks} left={seasonWeeks.left} />
        </Field>
      </div>
    </Sheet>
  );
}

/**
 * Add members: pick existing players, or create a new one straight into the group (one atomic
 * RPC: player + membership). An exact existing name blocks creation — that is how one real
 * player ends up as two profiles.
 */
export function AddMembersSheet({ open, onClose, group }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const [selected, setSelected] = useState([]);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [level, setLevel] = useState('');
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);
  useEffect(() => { if (open) { setSelected([]); setQuery(''); setName(''); setAge(''); setLevel(''); } }, [open]);
  if (!group) return null;
  const available = state.students.filter((s) => !group.memberIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const filtered = query.trim() ? matchStudents(available, query, { limit: 50 }) : available;
  const existing = name.trim() ? exactNameMatch(state.students, name) : null;
  const suggestions = name.trim() ? matchStudents(available, name) : [];
  const { age: parsedAge, valid: ageValid } = optionalAge(age);
  const createReady = name.trim() && ageValid && !existing && !creating;
  const toggle = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = async (e) => {
    e.preventDefault();
    if (!createReady) return;
    setCreating(true);
    const ref = 'selected-existing-group';
    const res = await run(() => api.students.bulkSetup(coachId, {
      groups: [{ client_id: ref, existing_id: group.id }],
      players: [{ name: name.trim(), age: parsedAge, level: level.trim() || null, group_refs: [ref] }],
      themes: [],
    }));
    setCreating(false);
    if (res.ok) {
      toast(`${name.trim()} luotu ja lisätty ryhmään.`);
      setName(''); setAge(''); setLevel('');
      setTimeout(() => nameRef.current?.focus(), 0);
    }
  };
  const save = async () => {
    if (!selected.length || saving) return;
    setSaving(true);
    const res = await run(() => api.groups.addMembers(group.id, selected), selected.length === 1 ? 'Pelaaja lisätty ryhmään.' : `${selected.length} pelaajaa lisätty ryhmään.`);
    setSaving(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Lisää pelaajia" subtitle={group.name} size="md" dismissible={!creating && !saving}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose}>Valmis</Button><Button variant="dark" size="lg" disabled={!selected.length} loading={saving} onClick={save}>Lisää ({selected.length})</Button></div>}>
      <div className="stack-5">
        <form className="k-subcard stack-3" onSubmit={create}>
          <div className="k-subcard-title">Uusi pelaaja tähän ryhmään</div>
          <p className="field-msg">Nimi riittää. Ikä ja taso ovat valinnaisia. Älä kirjoita terveystietoja.</p>
          <Input ref={nameRef} value={name} onChange={(e) => setName(e.target.value)} placeholder="Pelaajan nimi" maxLength={120} aria-label="Uuden pelaajan nimi" />
          {suggestions.length > 0 && (
            <div className="k-suggest">
              <div className="field-msg">{existing ? 'Tämä on jo listallasi — valitse hänet:' : 'Löytyykö hän jo listaltasi?'}</div>
              {suggestions.map((s) => (
                <button key={s.id} type="button" className="k-suggest-row" onClick={() => { toggle(s.id); setName(''); }}>
                  <Avatar person={s} size={26} /><span className="grow truncate">{s.name}</span><Icon name={selected.includes(s.id) ? 'check' : 'plus'} size={16} />
                </button>
              ))}
            </div>
          )}
          {existing && group.memberIds.includes(existing.id) && <p className="k-warn-text">{existing.name} on jo tässä ryhmässä.</p>}
          {existing && !group.memberIds.includes(existing.id) && <p className="k-warn-text">Sinulla on jo pelaaja nimeltä {existing.name}. Valitse hänet yltä — luominen on estetty, ettei hänelle synny toista profiilia.</p>}
          <div className="k-two">
            <Input value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="Ikä (valinn.)" aria-label="Ikä" />
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Taso (valinn.)" maxLength={80} aria-label="Taso" />
          </div>
          {!ageValid && <p className="field-msg field-msg-error">Iän pitää olla 1–119 vuotta.</p>}
          <Button type="submit" variant="dark" size="md" block disabled={!createReady} loading={creating} icon="plus">Luo ja lisää ryhmään</Button>
        </form>
        <div className="stack-3">
          <div className="field-label">Valitse nykyisistä pelaajista</div>
          {available.length > 6 && <Input icon="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Hae nimellä" aria-label="Hae pelaajaa" />}
          {available.length === 0 ? <Quiet>Kaikki pelaajasi ovat jo tässä ryhmässä.</Quiet> : (
            <div className="k-pick-list">
              {filtered.map((s) => (
                <label key={s.id} className={cx('k-pick', selected.includes(s.id) && 'is-on')}>
                  <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                  <Avatar person={s} size={28} />
                  <span className="truncate">{s.name}</span>
                  {s.isPlaceholder && <span className="k-faint">ei liittynyt</span>}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>
    </Sheet>
  );
}

/** A link that joins straight into this group (expires in 14 days, limited uses). */
export function GroupInviteSheet({ open, onClose, group }) {
  const { state } = useData();
  const { coachId, acting } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const [maxUses, setMaxUses] = useState(20);
  const [issued, setIssued] = useState(null);
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    try { setCodes((await api.invites.list(coachId)).filter((c) => c.active && c.groupId === group?.id)); } catch { /* list is optional */ }
  };
  useEffect(() => { if (open && group) { setIssued(null); load(); } }, [open, group?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!group) return null;
  const create = async () => {
    setBusy(true);
    try {
      const result = await api.invites.create(group.id, { expiresDays: 14, maxUses, coachId: acting ? coachId : null });
      setIssued(typeof result === 'string' ? { code: result } : result);
      load();
    } catch (err) { toast(err); }
    setBusy(false);
  };
  const revoke = async (code) => {
    if (!(await confirm({ title: `Poista koodi ${code} käytöstä?`, message: 'Koodi lakkaa toimimasta heti. Jo liittyneet pelaajat pysyvät ryhmässä.', confirmLabel: 'Poista käytöstä', danger: true }))) return;
    try { await api.invites.revoke(code); toast('Koodi poistettu käytöstä.'); load(); } catch (err) { toast(err); }
  };
  const code = issued?.code;
  const link = code ? koutsiInviteLink(code) : '';
  const message = code ? koutsiInviteMessage(code, state.coach.name, group.name) : '';
  return (
    <Sheet open={open} onClose={onClose} title="Kutsu ryhmään" subtitle={group.name} size="md">
      {code ? (
        <div className="k-invite stack-4">
          <div className="k-invite-head">
            <QrCode text={link} size={156} />
            <div className="stack-2">
              <div className="field-label">Koodi</div>
              <div className="k-code">{code}</div>
              <div className="k-link-text">{link}</div>
            </div>
          </div>
          <div className="row wrap">
            <ShareTextButton text={message} title="Liity Koutsiin" label="Jaa viesti" />
            <CopyButton text={link} label="Kopioi linkki" />
          </div>
          <p className="field-msg">Pelaaja avaa linkin, kirjautuu tai luo tilin ja liittyy suoraan tähän ryhmään.{issued.expires_at ? ` Voimassa ${koutsiFmtShortDate(String(issued.expires_at).slice(0, 10))} asti.` : ''}</p>
          <p className="k-warn-text"><strong>Alaikäiselle</strong> lähetetään aina oma henkilökohtainen linkki pelaajan sivulta.</p>
          <Button variant="soft" onClick={() => setIssued(null)}>Valmis</Button>
        </div>
      ) : (
        <div className="stack-4">
          <p className="k-quiet-text">Luo linkki, jolla aikuiset pelaajat liittyvät suoraan tähän ryhmään. Linkki on voimassa 14 päivää.</p>
          <Field label="Linkki kelpaa">
            <div className="k-weeks-row">
              {[[1, 'yhdelle'], [5, 'viidelle'], [20, 'koko ryhmälle']].map(([n, label]) => (
                <button key={n} type="button" className={cx('planner-chip', maxUses === n && 'is-on')} onClick={() => setMaxUses(n)}>{label}</button>
              ))}
            </div>
          </Field>
          <Button variant="dark" icon="link" loading={busy} onClick={create}>Luo liittymislinkki</Button>
          {codes.length > 0 && (
            <div className="stack-2">
              <div className="field-label">Voimassa olevat linkit</div>
              {codes.map((c) => (
                <div key={c.code} className="k-code-row">
                  <span className="k-code-small">{c.code}</span>
                  <span className="k-faint grow">{c.useCount}/{c.maxUses ?? '∞'} käytetty{c.expiresAt ? ` · ${koutsiFmtShortDate(c.expiresAt.slice(0, 10))} asti` : ''}</span>
                  <Button variant="ghost" size="sm" onClick={() => setIssued({ code: c.code, expires_at: c.expiresAt })}>Näytä</Button>
                  <Button variant="ghost" size="sm" onClick={() => revoke(c.code)}>Poista</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  );
}

// A sensible end for "jatka kalenteria": the end of the autumn or spring season.
function seasonEnd(today = koutsiTodayStr()) {
  const [y, m] = today.split('-').map(Number);
  if (m >= 8) return `${y}-12-20`;
  if (m <= 5) return `${y}-05-31`;
  return `${y}-08-31`;
}

/**
 * Continue the weekly sessions of the chosen groups up to a date, optionally skipping whole
 * weeks (holidays). One server call per group; the players get one summary notification.
 */
export function ExtendCalendarSheet({ open, onClose, groups }) {
  const { state, run } = useData();
  const toast = useToast();
  const [until, setUntil] = useState(seasonEnd());
  const [chosen, setChosen] = useState([]);
  const [skipWeeks, setSkipWeeks] = useState([]);
  const [busy, setBusy] = useState(false);
  const lastOf = (g) => state.trainings.filter((t) => t.groupId === g.id && t.loggedBy !== 'player').map((t) => t.date).sort().pop() || null;
  useEffect(() => { if (open) { setChosen((groups || []).map((g) => g.id)); setSkipWeeks([]); setUntil(seasonEnd()); } }, [open, groups]);
  const earliest = useMemo(() => (groups || []).map(lastOf).filter(Boolean).sort()[0] || koutsiTodayStr(), [groups, state]); // eslint-disable-line react-hooks/exhaustive-deps
  const weeks = useMemo(() => {
    const out = [];
    let d = koutsiAddDays(earliest, 1);
    const seen = new Set();
    while (d <= until && out.length < 30) {
      const w = koutsiIsoWeekOfDateStr(d);
      const key = koutsiIsoWeekKey(w);
      if (!seen.has(key)) { seen.add(key); out.push({ ...w, key }); }
      d = koutsiAddDays(d, 7);
    }
    return out;
  }, [earliest, until]);
  const submit = async () => {
    if (!chosen.length || busy) return;
    setBusy(true);
    const skipDates = weeks.filter((w) => skipWeeks.includes(w.key)).flatMap((w) => weekDates(w));
    let added = 0;
    const res = await run(async () => {
      for (const id of chosen) {
        const r = await api.groups.extendSeries(id, until, skipDates);
        added += Number(r?.added || 0);
      }
    });
    setBusy(false);
    if (res.ok) {
      toast(added > 0 ? `Kalenteria jatkettu — ${added} treeniä lisätty ${koutsiFmtShortDate(until)} asti.` : 'Kalenteri oli jo valmiiksi pidempi.');
      onClose();
    }
  };
  const valid = until > koutsiTodayStr();
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Jatka kalenteria" subtitle="Ryhmien viikoittaiset treenit jatkuvat samaan aikaan." size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" disabled={!chosen.length || !valid} loading={busy} onClick={submit}>{chosen.length > 1 ? `Jatka ${chosen.length} ryhmää` : 'Jatka kalenteria'}</Button></div>}>
      <div className="stack-4">
        <Field label="Jatka asti" htmlFor="extend-until" hint="Esim. kauden viimeinen treeniviikko.">
          <Input id="extend-until" type="date" value={until} min={koutsiAddDays(koutsiTodayStr(), 1)} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <Field label="Ryhmät">
          <div className="k-pick-list">
            {(groups || []).map((g) => {
              const last = lastOf(g);
              return (
                <label key={g.id} className={cx('k-pick', chosen.includes(g.id) && 'is-on')}>
                  <input type="checkbox" checked={chosen.includes(g.id)} onChange={() => setChosen((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : [...p, g.id]))} />
                  <span className="grow">
                    <span className="k-pick-title">{g.day} {g.time} · {g.name}</span>
                    <span className="k-faint">{last ? `Kalenterissa ${koutsiFmtShortDate(last)} asti` : 'Ei treenejä kalenterissa'}</span>
                  </span>
                </label>
              );
            })}
          </div>
        </Field>
        {weeks.length > 0 && (
          <Field label="Taukoviikot" optional hint="Näille viikoille ei lisätä treenejä (esim. joulu- tai hiihtoloma).">
            <div className="k-weeks-row">
              {weeks.map((w) => (
                <button key={w.key} type="button" className={cx('planner-chip', skipWeeks.includes(w.key) && 'is-on')}
                  onClick={() => setSkipWeeks((p) => (p.includes(w.key) ? p.filter((x) => x !== w.key) : [...p, w.key]))}>
                  {themeWeekShort(w)}<span className="planner-chip-sub">{koutsiFmtShortDate(weekDates(w)[0]).split(' ')[1]}</span>
                </button>
              ))}
            </div>
          </Field>
        )}
        <p className="field-msg">Pelaajat saavat yhden ilmoituksen jatkosta — ei jokaisesta treenistä erikseen.</p>
      </div>
    </Sheet>
  );
}

/** The group's annual plan file: send for review, open, replace or remove. */
export function AnnualPlanBlock({ group }) {
  const { run } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const plan = group.annualPlan;
  const upload = async (file) => {
    setBusy(true);
    await run(() => api.plans.upload(group.id, file), 'Vuosisuunnitelma lähetetty — tarkistamme sen ja viemme teemat Koutsiin.');
    setBusy(false);
  };
  const open = async () => {
    try { const url = await api.plans.url(plan.storagePath); if (url) window.open(url, '_blank', 'noopener'); } catch (err) { toast(err); }
  };
  const remove = async () => {
    if (!(await confirm({ title: 'Poista vuosisuunnitelma?', message: plan.filename, confirmLabel: 'Poista', danger: true }))) return;
    await run(() => api.plans.remove(group.id), 'Vuosisuunnitelma poistettu.');
  };
  return (
    <div className="stack-3">
      <p className="field-msg">Lähetä ryhmän vuosisuunnitelma (PDF tai Excel), niin viemme sen viikkoteemat Koutsiin puolestasi. Beta-ominaisuus.</p>
      {plan ? (
        <div className="k-file-row">
          <Icon name="list" size={18} />
          <span className="grow truncate">{plan.filename}</span>
          <span className="chip chip-sm chip-neutral">{plan.status === 'published' ? 'Käytössä' : 'Tarkistettavana'}</span>
        </div>
      ) : <Quiet>Ei vuosisuunnitelmaa.</Quiet>}
      <div className="row wrap">
        {plan && <Button variant="outline" size="sm" icon="external" onClick={open}>Avaa</Button>}
        <FilePick accept=".pdf,.xlsx,.xls,.doc,.docx,.csv" onPick={upload} className="btn btn-outline btn-sm">{busy ? 'Lähetetään…' : plan ? 'Vaihda tiedosto' : 'Lähetä tiedosto'}</FilePick>
        {plan && <Button variant="ghost" size="sm" icon="trash" onClick={remove}>Poista</Button>}
      </div>
    </div>
  );
}

export function useGroupDelete() {
  const { state, run } = useData();
  const confirm = useConfirm();
  return async (group) => {
    const all = state.trainings.filter((t) => t.groupId === group.id);
    const past = all.filter((t) => t.date < koutsiTodayStr()).length;
    const ok = await confirm({
      title: `Poista ryhmä ${group.name}?`,
      message: `Ryhmä ja kaikki sen ${all.length} treeniä poistetaan.${past > 0 ? ` Mukana on ${past} jo pidettyä treeniä, joiden läsnäolomerkinnät poistuvat pysyvästi.` : ''} Pelaajat säilyvät Pelaajat-listallasi.`,
      confirmLabel: 'Poista ryhmä', danger: true, typeToConfirm: past > 0 ? group.name : undefined,
    });
    if (!ok) return false;
    const res = await run(() => api.groups.remove(group.id), 'Ryhmä poistettu.');
    if (res.ok) navigate('/valmentaja/ryhmat', { replace: true });
    return res.ok;
  };
}

export function lastSessionDate(state, groupId) {
  return state.trainings.filter((t) => t.groupId === groupId && t.loggedBy !== 'player').map((t) => t.date).sort().pop() || null;
}

export const isoWeekOf = (dateStr) => koutsiIsoWeekOfDateStr(dateStr);
export const dateObj = (dateStr) => koutsiDateFromStr(dateStr);
