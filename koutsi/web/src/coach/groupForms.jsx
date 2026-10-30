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
  koutsiAddDays, koutsiIsoWeekOfDateStr, koutsiDateFromStr,
} from '../domain/core.js';
import {
  BREAK_MESSAGE_MAX, BREAK_NAME, BREAK_NAME_MAX, MAX_DAYS_AHEAD, breakDays, breakNotice, breakProblem, fmtDay, nextTermEnd, noticeDay, planContinue,
} from '../domain/continueGroups.js';
import { exactNameMatch, matchStudents } from '../domain/roster.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath } from './nav.js';
import { currentSeason, weeksLeftInSeason } from '../domain/season.js';
import { SEASON_LINK_USES, joinedCount, seasonLinkDays, seasonLinkFor } from '../domain/groupLinks.js';
import { GroupQrSheet } from './GroupLinks.jsx';

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
  const [place, setPlace] = useState('');
  const [day, setDay] = useState('Ma');
  const [time, setTime] = useState('');
  const [duration, setDuration] = useState(60);
  const [weeks, setWeeks] = useState(12);
  const [memberIds, setMemberIds] = useState([]);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false); // a double tap must not create two groups with two series
  useEffect(() => {
    if (!open) return;
    setName(editing?.name || ''); setLevel(editing?.level || ''); setPlace(editing?.place || ''); setDay(editing?.day || 'Ma');
    setTime(editing?.time || ''); setDuration(editing?.durationMinutes || 60); setWeeks(seasonWeeks.initial); setMemberIds([]);
  }, [open, editing]); // eslint-disable-line react-hooks/exhaustive-deps
  const scheduleChanged = isEdit && (editing.day !== day || editing.time !== time || (editing.durationMinutes || 60) !== duration);
  const ready = name.trim() && time;
  const submit = async () => {
    if (!ready || busyRef.current) return;
    busyRef.current = true; setBusy(true);
    const fields = { name: name.trim(), level: level.trim() || 'Kaikki tasot', place: place.trim(), day, time, durationMinutes: duration, weeksAhead: weeks };
    const res = isEdit
      ? await run(() => api.groups.update(editing.id, fields), 'Ryhmä päivitetty.')
      : await run(() => api.groups.create(coachId, { ...fields, memberIds }), 'Ryhmä luotu — treenit ovat kalenterissa.', { waitForRefresh: true });
    busyRef.current = false; setBusy(false);
    if (res.ok) {
      onClose();
      if (!isEdit && res.result) navigate(groupPath(res.result));
    }
  };
  const players = state.students.slice().sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title={isEdit ? 'Muokkaa ryhmää' : 'Uusi ryhmä'} size="md" dismissible={!busy} confirmClose={isEdit ? (name.trim() !== (editing.name || '') || place.trim() !== (editing.place || '')) : Boolean(name.trim() || place.trim())}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!name.trim() ? 'Anna ryhmälle nimi.' : !time ? 'Valitse kellonaika.' : null} loading={busy} onClick={submit}>{isEdit ? 'Tallenna' : 'Luo ryhmä'}</Button></div>}>
      <div className="stack-4">
        <Field label="Nimi" htmlFor="g-name"><Input id="g-name" size="lg" value={name} onChange={(e) => setName(e.target.value)} placeholder="Esim. tiistai aikuiset" maxLength={120} /></Field>
        <Field label="Taso" optional htmlFor="g-level"><Input id="g-level" value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Esim. Keskitaso" maxLength={80} /></Field>
        <Field label="Paikka" optional htmlFor="g-place" hint="Näkyy pelaajille ryhmän sivulla ja treenipäivän muistutuksessa.">
          <Input id="g-place" value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Esim. Lahden tennishalli, kenttä 3" maxLength={120} />
        </Field>
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
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={!time ? 'Valitse kellonaika.' : null} loading={busy} onClick={submit}>Lisää</Button></div>}>
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
  const confirmLeave = useConfirm();
  useEffect(() => { if (open) { setSelected([]); setQuery(''); setName(''); setAge(''); setLevel(''); } }, [open]);
  if (!group) return null;
  const available = state.students.filter((s) => !group.memberIds.includes(s.id)).sort((a, b) => a.name.localeCompare(b.name, 'fi'));
  const filtered = query.trim() ? matchStudents(available, query, { limit: 50 }) : available;
  const existing = name.trim() ? exactNameMatch(state.students, name) : null;
  const suggestions = name.trim() ? matchStudents(available, name) : [];
  const { age: parsedAge, valid: ageValid } = optionalAge(age);
  const createReady = name.trim() && ageValid && !existing && !creating;
  const toggle = (id) => setSelected((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  // makes the typed player and puts them in the group; resolves whether it worked
  const createTyped = async () => {
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
    }
    return res.ok;
  };
  const create = async (e) => {
    e.preventDefault();
    if (!createReady) return;
    if (await createTyped()) setTimeout(() => nameRef.current?.focus(), 0);
  };
  // The footer adds the ticked players — and a name typed above but not yet created, so it is
  // never thrown away silently.
  const typedPending = Boolean(name.trim()) && createReady;
  const save = async () => {
    if (saving || creating) return;
    if (typedPending && !(await createTyped())) return;
    if (!selected.length) { onClose(); return; }
    setSaving(true);
    const res = await run(() => api.groups.addMembers(group.id, selected), selected.length === 1 ? 'Pelaaja lisätty ryhmään.' : `${selected.length} pelaajaa lisätty ryhmään.`);
    setSaving(false);
    if (res.ok) onClose();
  };
  return (
    <Sheet open={open} onClose={onClose} title="Lisää pelaajia" subtitle={group.name} size="md" dismissible={!creating && !saving}
      confirmClose={name.trim() ? { title: 'Hylätäänkö kirjoittamasi nimi?', message: `${name.trim()} ei ole vielä listallasi.` } : false}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={async () => {
        if (name.trim() && !(await confirmLeave({ title: 'Hylätäänkö kirjoittamasi nimi?', message: `${name.trim()} ei ole vielä listallasi.`, confirmLabel: 'Hylkää', cancelLabel: 'Jatka', danger: true }))) return;
        onClose();
      }}>Valmis</Button><Button variant="dark" size="lg" missing={!selected.length && !typedPending ? (name.trim() ? 'Tarkista uuden pelaajan tiedot yllä.' : 'Valitse pelaajat listasta tai kirjoita uuden pelaajan nimi.') : null} loading={saving || creating} onClick={save}>Lisää ({selected.length + (typedPending ? 1 : 0)})</Button></div>}>
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
          {existing && !group.memberIds.includes(existing.id) && <p className="k-warn-text">Sinulla on jo pelaaja nimeltä {existing.name.replace(/\.+$/, '')}. Valitse hänet yltä — luominen on estetty, ettei hänelle synny toista profiilia.</p>}
          <div className="k-two">
            <Input value={age} onChange={(e) => setAge(e.target.value.replace(/[^0-9]/g, '').slice(0, 3))} inputMode="numeric" placeholder="Ikä (valinn.)" aria-label="Ikä" />
            <Input value={level} onChange={(e) => setLevel(e.target.value)} placeholder="Taso (valinn.)" maxLength={80} aria-label="Taso" />
          </div>
          {!ageValid && <p className="field-msg field-msg-error">Iän pitää olla 1–119 vuotta.</p>}
          <Button type="submit" variant="dark" size="md" block missing={!name.trim() ? 'Kirjoita pelaajan nimi.' : !ageValid ? 'Iän pitää olla 1–119 vuotta.' : existing ? `${existing.name} on jo listallasi — valitse hänet yltä.` : null} loading={creating} icon="plus">Luo ja lisää ryhmään</Button>
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
  const [codes, setCodes] = useState([]);
  const [busy, setBusy] = useState(null);
  const [shown, setShown] = useState(null); // a one-off code opened from the list
  const [big, setBig] = useState(false);
  const season = (group?.seasonId && (state.seasons || []).find((x) => x.id === group.seasonId)) || (state.seasonsReady ? currentSeason(state) : null);
  const load = async () => {
    try { setCodes((await api.invites.list(coachId)).filter((c) => c.active && c.groupId === group?.id)); } catch { /* list is optional */ }
  };
  useEffect(() => { if (open && group) { setShown(null); load(); } }, [open, group?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!group) return null;
  const seasonLink = seasonLinkFor(codes, group.id);
  const others = codes.filter((c) => c.code !== seasonLink?.code);
  const create = async (kind) => {
    setBusy(kind);
    try {
      const opts = kind === 'season'
        ? { expiresDays: seasonLinkDays(season), maxUses: SEASON_LINK_USES }
        : { expiresDays: 14, maxUses: 1 };
      const result = await api.invites.create(group.id, { ...opts, coachId: acting ? coachId : null });
      await load();
      if (kind === 'one') setShown(typeof result === 'string' ? { code: result } : { code: result.code, expiresAt: result.expires_at });
    } catch (err) { toast(err); }
    setBusy(null);
  };
  const revoke = async (code) => {
    if (!(await confirm({ title: `Poista koodi ${code} käytöstä?`, message: 'Koodi lakkaa toimimasta heti. Jo liittyneet pelaajat pysyvät ryhmässä.', confirmLabel: 'Poista käytöstä', danger: true }))) return;
    try { await api.invites.revoke(code); toast('Koodi poistettu käytöstä.'); setShown(null); load(); } catch (err) { toast(err); }
  };
  const current = shown || (seasonLink ? { code: seasonLink.code, expiresAt: seasonLink.expiresAt, season: true, used: seasonLink.useCount } : null);
  const link = current ? koutsiInviteLink(current.code) : '';
  const message = current ? koutsiInviteMessage(current.code, state.coach.name, group.name) : '';
  const count = joinedCount(state, group);
  return (
    <Sheet open={open} onClose={onClose} title="Kutsu ryhmään" subtitle={`${group.name}, ${count.joined}/${count.total} liittynyt`} size="md">
      <div className="stack-5">
        {current ? (
          <div className="k-invite stack-4">
            <div className="k-invite-head">
              <QrCode text={link} size={156} />
              <div className="stack-2">
                <div className="field-label">{current.season ? 'Kauden linkki' : 'Kertakäyttöinen linkki'}</div>
                <div className="k-code">{current.code}</div>
                <div className="k-link-text">{link}</div>
              </div>
            </div>
            <div className="row wrap">
              <ShareTextButton text={message} title="Liity Koutsiin" label="Jaa viesti" />
              <CopyButton text={link} label="Kopioi linkki" />
              <Button variant="ghost" size="sm" icon="grid" onClick={() => setBig(true)}>Näytä isona</Button>
            </div>
            <p className="field-msg">
              {current.season ? 'Toimii koko kauden koko ryhmälle — jaa kerran myClubin tiedotteessa tai ryhmän WhatsAppissa, tai näytä QR-koodi treeneissä.' : 'Yhdelle pelaajalle.'}
              {current.expiresAt ? ` Voimassa ${koutsiFmtShortDate(String(current.expiresAt).slice(0, 10))} asti.` : ''}
            </p>
            <p className="k-warn-text"><strong>Alaikäiselle</strong> lähetetään aina oma henkilökohtainen linkki pelaajan sivulta.</p>
            {shown && <Button variant="soft" onClick={() => setShown(null)}>Takaisin kauden linkkiin</Button>}
          </div>
        ) : (
          <div className="stack-3">
            {/* the same date the link will show once made: a week past the season's end (seasonLinkDays) */}
            <p className="k-quiet-text">Yksi linkki koko kaudeksi: aikuiset pelaajat liittyvät sillä suoraan tähän ryhmään{season ? ` (${season.name}; linkki toimii ${koutsiFmtShortDate(koutsiAddDays(koutsiTodayStr(), seasonLinkDays(season)))} asti)` : ''}.</p>
            <Button variant="dark" icon="link" loading={busy === 'season'} onClick={() => create('season')}>Luo kauden linkki</Button>
          </div>
        )}
        <section className="stack-2">
          <div className="row-between">
            <div className="field-label">Muut linkit</div>
            <Button variant="ghost" size="sm" icon="plus" loading={busy === 'one'} onClick={() => create('one')}>Kertakäyttöinen</Button>
          </div>
          {others.length === 0 ? <p className="k-faint">Ei muita voimassa olevia linkkejä.</p> : others.map((c) => (
            <div key={c.code} className="k-code-row">
              <span className="k-code-small">{c.code}</span>
              <span className="k-faint grow">{c.useCount}/{c.maxUses ?? '∞'} käytetty{c.expiresAt ? `, ${koutsiFmtShortDate(c.expiresAt.slice(0, 10))} asti` : ''}</span>
              <Button variant="ghost" size="sm" onClick={() => setShown({ code: c.code, expiresAt: c.expiresAt })}>Näytä</Button>
              <Button variant="ghost" size="sm" onClick={() => revoke(c.code)}>Poista</Button>
            </div>
          ))}
          {seasonLink && !shown && <Button variant="ghost" size="sm" onClick={() => revoke(seasonLink.code)}>Poista kauden linkki käytöstä</Button>}
        </section>
      </div>
      <GroupQrSheet open={big} onClose={() => setBig(false)} group={group} code={current?.code} expiresAt={current?.expiresAt} />
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

/** The day a group's weekly calendar is meant to reach: the end of its season when Koutsi knows
 *  the seasons (and it is still ahead), else the usual end of the term. */
export function calendarGoal(state, group, today = koutsiTodayStr()) {
  const season = (group?.seasonId && (state.seasons || []).find((x) => x.id === group.seasonId)) || (state.seasonsReady ? currentSeason(state) : null);
  return season?.endsOn && season.endsOn > today ? season.endsOn : seasonEnd(today);
}

/** True when the weekly sessions already reach `until`: the next one would fall after it. */
export const calendarReaches = (last, until) => Boolean(last && until && last > koutsiAddDays(until, -7));

/**
 * "Jatka kalenteria": the chosen groups go on with the same weekdays and times up to a day, with
 * breaks (tauko) as day ranges. The summary says what will happen before saving
 * (domain/continueGroups.js); saving cancels the sessions already inside a break, then continues
 * each group with one server call (the players get one notification per group). A break is also kept as a
 * club event (kind 'tauko') with its name and the coach's greeting: the players of those groups see it in
 * their calendar and get a notice the morning before it starts; the sheet shows that notice first.
 */
export function ExtendCalendarSheet({ open, onClose, groups }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const confirm = useConfirm();
  const today = koutsiTodayStr();
  const list = groups || [];
  const lastOf = (g) => state.trainings.filter((t) => t.groupId === g.id && t.loggedBy !== 'player').map((t) => t.date).sort().pop() || null;
  // the season's end, or the next term's end when every group's calendar already reaches it
  const firstUntil = () => {
    const goal = calendarGoal(state, list[0]);
    return list.length && list.every((g) => calendarReaches(lastOf(g), goal)) ? nextTermEnd(goal) : goal;
  };
  const [until, setUntil] = useState(firstUntil);
  const [chosen, setChosen] = useState([]);
  const [breaks, setBreaks] = useState([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const nextKey = useRef(1);
  useEffect(() => {
    if (!open) return;
    setChosen(list.map((g) => g.id)); setBreaks([]); setUntil(firstUntil()); setPicking(list.length <= 4);
  }, [open, groups]); // eslint-disable-line react-hooks/exhaustive-deps
  const picked = list.filter((g) => chosen.includes(g.id));
  const plan = useMemo(() => planContinue({ groups: picked, trainings: state.trainings, until, breaks, today }), [chosen, list, state.trainings, until, breaks, today]); // eslint-disable-line react-hooks/exhaustive-deps
  const problem = breakProblem(breaks, today);
  const day = (d) => fmtDay(d, today);
  const missing = !picked.length ? 'Valitse ainakin yksi ryhmä.'
    : !(until > today) ? 'Valitse päivä tämän päivän jälkeen.'
      : until > koutsiAddDays(today, MAX_DAYS_AHEAD) ? 'Kalenteria voi jatkaa enintään vuoden eteenpäin.'
        : problem || (!plan.added && !plan.cancel.length && !plan.breaks.length ? `Treenit ovat jo kalenterissa ${day(until)} asti. Valitse myöhäisempi päivä tai lisää tauko.` : null);
  const setBreak = (key, patch) => setBreaks((p) => p.map((b) => (b.key === key ? { ...b, ...patch } : b)));
  const addBreak = () => { const key = nextKey.current; nextKey.current += 1; setBreaks((p) => [...p, { key, from: '', to: '', name: '', message: '' }]); };
  const groupsAdded = plan.groups.filter((g) => g.add.length).length;

  const submit = async () => {
    if (missing || busy) return;
    const n = plan.cancel.length;
    if (n && !(await confirm({
      title: n === 1 ? 'Perutaanko 1 treeni tauon ajalta?' : `Perutaanko ${n} treeniä tauon ajalta?`,
      message: `${n === 1 ? 'Se on' : 'Ne ovat'} jo kalenterissa. Pelaajat saavat tiedon perutuista treeneistä.`,
      confirmLabel: 'Peru treenit', danger: true,
    }))) return;
    setBusy(true);
    const skip = breakDays(breaks, today, until);
    let added = 0;
    const res = await run(async () => {
      if (n) await api.trainings.removeMany(plan.cancel.map((t) => t.id));
      for (const g of plan.groups) {
        if (!g.add.length) continue;
        const r = await api.groups.extendSeries(g.group.id, until, skip);
        added += Number(r?.added || 0);
      }
      // the break itself in the players' calendar, with its name and greeting
      for (const b of plan.breaks) {
        await api.events.add(coachId, {
          title: (b.name || '').trim() || BREAK_NAME, date: b.from, endDate: b.to > b.from ? b.to : null, kind: 'tauko',
          message: b.message || '', groupIds: picked.map((g) => g.id),
        });
      }
    }, undefined, { waitForRefresh: true });
    setBusy(false);
    if (res.ok) {
      const many = (k, word) => `${k} ${k === 1 ? word : `${word}ä`}`;
      const done = [added ? `${many(added, 'treeni')} lisätty ${day(until)} asti` : '', n ? `${many(n, 'treeni')} peruttu tauon ajalta` : '',
        plan.breaks.length ? (plan.breaks.length === 1 ? 'tauko näkyy pelaajien kalenterissa' : 'tauot näkyvät pelaajien kalenterissa') : ''].filter(Boolean);
      toast(done.length ? `Kalenteri tallennettu: ${done.join(', ')}.` : `Treenit olivat jo kalenterissa ${day(until)} asti. Mitään ei muutettu.`, done.length ? undefined : { tone: 'info' });
      onClose();
    }
  };

  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Jatka kalenteria" subtitle="Ryhmät jatkuvat samoina päivinä ja aikoina. Väliin voit lisätä tauon." size="md" dismissible={!busy}
      footer={<div className="sheet-actions"><Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button><Button variant="dark" size="lg" missing={missing} loading={busy} onClick={submit}>{!plan.added && (plan.cancel.length || plan.breaks.length) ? (plan.breaks.length > 1 ? 'Tallenna tauot' : 'Tallenna tauko') : picked.length > 1 ? `Jatka ${picked.length} ryhmää` : 'Jatka kalenteria'}</Button></div>}>
      <div className="stack-4">
        <Field label="Treenit jatkuvat asti" htmlFor="extend-until" hint="Kauden viimeinen treenipäivä.">
          <Input id="extend-until" type="date" value={until} min={koutsiAddDays(today, 1)} max={koutsiAddDays(today, MAX_DAYS_AHEAD)} onChange={(e) => setUntil(e.target.value)} />
        </Field>
        <div className="k-breaks">
          <div className="k-breaks-head">
            <span className="field-label">Tauko <span className="k-faint">(valinnainen)</span></span>
            {!breaks.length && <span className="field-msg">Päivät, joina ei ole treenejä, esim. joululoma.</span>}
          </div>
          {breaks.map((b, i) => (
            <div key={b.key} className="k-break">
              <div className="row-between">
                <span className="k-break-title">{breaks.length > 1 ? `Tauko ${i + 1}` : 'Tauko'}</span>
                <button type="button" className="k-break-remove" onClick={() => setBreaks((p) => p.filter((x) => x.key !== b.key))}>Poista</button>
              </div>
              <Field label="Nimi" optional htmlFor={`break-name-${b.key}`} hint="Näkyy pelaajien kalenterissa.">
                <Input id={`break-name-${b.key}`} value={b.name} maxLength={BREAK_NAME_MAX} placeholder="Esim. Joululoma" onChange={(e) => setBreak(b.key, { name: e.target.value })} />
              </Field>
              <div className="k-two">
                <Field label="Alkaa" htmlFor={`break-from-${b.key}`}>
                  <Input id={`break-from-${b.key}`} type="date" value={b.from} min={today} onChange={(e) => setBreak(b.key, { from: e.target.value })} />
                </Field>
                <Field label="Päättyy" htmlFor={`break-to-${b.key}`}>
                  <Input id={`break-to-${b.key}`} type="date" value={b.to} min={b.from || today} onChange={(e) => setBreak(b.key, { to: e.target.value })} />
                </Field>
              </div>
              <Field label="Tervehdys pelaajille" optional htmlFor={`break-msg-${b.key}`}>
                <Input id={`break-msg-${b.key}`} value={b.message} maxLength={BREAK_MESSAGE_MAX} placeholder="Esim. Hyvää joulua!" onChange={(e) => setBreak(b.key, { message: e.target.value })} />
              </Field>
            </div>
          ))}
          <Button variant="outline" size="sm" icon="plus" onClick={addBreak}>{breaks.length ? 'Lisää toinen tauko' : 'Lisää tauko'}</Button>
        </div>
        <Field label="Ryhmät">
          {!picking ? (
            <div className="k-pick-summary">
              <span className="grow">{picked.length === list.length ? `Kaikki ${list.length} ryhmää` : `${picked.length}/${list.length} ryhmää`}</span>
              <Button variant="ghost" size="sm" onClick={() => setPicking(true)}>Valitse ryhmät</Button>
            </div>
          ) : (
            <div className="k-pick-list">
              {list.map((g) => {
                const last = lastOf(g);
                return (
                  <label key={g.id} className={cx('k-pick', chosen.includes(g.id) && 'is-on')}>
                    <input type="checkbox" checked={chosen.includes(g.id)} onChange={() => setChosen((p) => (p.includes(g.id) ? p.filter((x) => x !== g.id) : [...p, g.id]))} />
                    <span className="grow">
                      <span className="k-pick-title">{g.day} {g.time}, {g.name}</span>
                      <span className="k-faint">{last ? `Kalenterissa ${koutsiFmtShortDate(last)} asti` : 'Ei treenejä kalenterissa'}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </Field>
        {picked.length > 0 && until > today && !problem && (
          <div className="k-note k-continue-sum" aria-live="polite">
            <strong>Näin ryhmät jatkuvat</strong>
            <ul>
              {plan.breaks.map((b) => (
                <li key={`${b.from}-${b.to}`}>
                  {(b.name || '').trim() || 'Tauko'} {b.to > b.from ? `${day(b.from)}–${day(b.to)}` : day(b.from)}.
                  {b.cancelled > 0 && ` Tauon ajalta perutaan ${b.cancelled === 1 ? '1 treeni, joka on' : `${b.cancelled} treeniä, jotka ovat`} jo kalenterissa.`}
                  {b.next && ` Treenit jatkuvat ${day(b.next)}.`}
                </li>
              ))}
              <li>{plan.added
                ? `${plan.added === 1 ? '1 uusi treeni' : `${plan.added} uutta treeniä`} ${groupsAdded === 1 ? '1 ryhmälle' : `${groupsAdded} ryhmälle`} samoina päivinä ja aikoina ${day(until)} asti.`
                : `Treenit ovat jo kalenterissa ${day(until)} asti, joten uusia ei lisätä.`}</li>
              {(plan.added > 0 || plan.cancel.length > 0) && <li>Pelaajat näkevät muutokset kalenterissaan ja saavat niistä ilmoituksen.</li>}
            </ul>
          </div>
        )}
        {picked.length > 0 && !problem && plan.breaks.map((b) => {
          const notice = breakNotice({ name: b.name, from: b.from, to: b.to, next: b.example, message: b.message });
          const when = noticeDay(b.from, today);
          return (
            <div key={`n-${b.key}`} className="k-notice-preview">
              <div className="k-notice-when">
                {when > today ? `Pelaajat saavat tämän ilmoituksen ${day(when)} aamulla` : 'Pelaajat saavat tämän ilmoituksen pian'}
                {picked.length > 1 && b.example && <span className="k-faint">{` (esimerkkinä ryhmän ${b.example.group.name} pelaaja)`}</span>}
              </div>
              <div className="k-notice-card">
                <span className="k-notice-icon"><Icon name="bell" size={16} /></span>
                <div className="grow">
                  <div className="k-notice-title">{notice.title}</div>
                  <p className="k-notice-body">{notice.body}</p>
                </div>
              </div>
            </div>
          );
        })}
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
  // The tab opens in the tap itself (an iPhone blocks a window opened after waiting for the
  // network) and gets its address when the signed link arrives.
  const open = async () => {
    const tab = window.open('', '_blank');
    try {
      const url = await api.plans.url(plan.storagePath);
      if (url && tab) tab.location.href = url; else if (url) window.location.href = url; else tab?.close();
    } catch (err) { tab?.close(); toast(err); }
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
        <FilePick accept=".pdf,.xlsx,.xls,.doc,.docx,.csv" onPick={(f) => { if (!busy) upload(f); }} className="btn btn-outline btn-sm">{busy ? 'Lähetetään…' : plan ? 'Vaihda tiedosto' : 'Lähetä tiedosto'}</FilePick>
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
