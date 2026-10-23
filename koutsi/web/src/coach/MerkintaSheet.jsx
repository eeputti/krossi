// MerkintaSheet.jsx — the new Merkitse, the big middle button (haara koutsi-selkeys). Everything a
// coach records goes through this one sheet, in the order a coach thinks it:
//   1. what: a Tiedote (a practical notice — another coach tomorrow, a different court — on the
//      players' Koti until a date, never on their Kehitys), a Huomio (feedback that stays on the
//      player's Kehitys, optionally as a homework or with a video), the Läsnäolo of a session, or
//      the week's Teema for some groups
//   2. for whom: today's and tomorrow's sessions as chips (the one just over, on now or next is
//      already picked), the week's groups, or anyone from the full list — for a Teema, the groups
//      still without one this week
//   3. the text (or, for Läsnäolo, the players to tap away).
// It opens on what the moment needs: during a session Läsnäolo, after one Huomio, before one
// Tiedote; on a day without sessions, while some groups lack this week's theme, Teema.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Button, Icon, IconButton, Input, Segmented, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import { RecipientPicker, recipientSummary } from '../shared/recipients.jsx';
import {
  koutsiAddDays, koutsiCurrentIsoWeek, koutsiFmtShortDate, koutsiTodayStr, koutsiWeekThemeStatus, KOUTSI_THEME_LEAD_MAX, KOUTSI_THEME_TITLE_MAX,
} from '../domain/core.js';
import {
  coachSessionsOn, groupMemberIds, JUST_ENDED_MINUTES, plannerDefaultWeek, presentPlayerIds, sessionEnd, sessionRoster, sessionStatus, weekDates, weekGroups,
} from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { AttendanceChips } from './attendance.jsx';
import { openPlanner } from './nav.js';
import { useContinueThemes, useSaveThemes } from './themeActions.js';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';
const players = (n) => (n === 1 ? '1 pelaajalle' : `${n} pelaajalle`);

const KINDS = {
  tiedote: {
    icon: 'info',
    help: 'Käytännön asia, esim. toinen valmentaja tai eri kenttä. Pelaajat saavat ilmoituksen. Ei jää kehitykseen.',
    placeholder: 'Esim. Huomenna valmentajana Juho. Treeni alkaa normaalisti.',
  },
  huomio: {
    icon: 'flame',
    help: 'Palautetta pelaajalle. Jää hänen Kehitys-sivulleen, ja hän saa ilmoituksen.',
    placeholder: 'Esim. Hyvä nousu syötössä — heitto pysyy jo samassa kohdassa.',
  },
  lasnaolo: {
    icon: 'user-check',
    help: 'Kaikki ovat paikalla, ellet napauta toisin. Pelaajan oma "En pääse" on jo merkitty.',
  },
  teema: {
    icon: 'sparkles',
    help: 'Viikon teema näkyy ryhmän pelaajille etusivulla koko viikon. Kirjoita se kerran ja valitse ryhmät.',
  },
};

const toMinutes = (hhmm) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };

/** Today's and tomorrow's sessions as chips. */
function sessionChips(state, now) {
  const today = koutsiTodayStr();
  const tomorrow = koutsiAddDays(today, 1);
  const minutesNow = now.getHours() * 60 + now.getMinutes();
  const chip = (it, day) => {
    const status = day === today ? sessionStatus(it.training, it.group, now) : 'upcoming';
    const ago = status === 'past' ? minutesNow - toMinutes(sessionEnd(it.training, it.group)) : null;
    const when = day === tomorrow ? `Huomenna ${it.training.time}`
      : status === 'now' ? 'Nyt käynnissä'
        : status === 'past' && ago <= JUST_ENDED_MINUTES ? 'Juuri päättyi'
          : `Tänään ${it.training.time}`;
    return {
      key: it.training.id, training: it.training, group: it.group, status, day, when,
      justEnded: ago != null && ago <= JUST_ENDED_MINUTES,
      name: it.group?.name || it.student?.name || it.training.type,
      roster: sessionRoster(state, it.training).map((s) => s.id),
      present: presentPlayerIds(state, it.training),
    };
  };
  return [
    ...coachSessionsOn(state, today).map((it) => chip(it, today)),
    ...coachSessionsOn(state, tomorrow).map((it) => chip(it, tomorrow)),
  ];
}

/** The chip a fresh sheet starts on: on now > just over > next today > first tomorrow. */
function defaultChip(chips) {
  const ended = chips.filter((c) => c.justEnded);
  return chips.find((c) => c.status === 'now') || ended[ended.length - 1] || chips.find((c) => c.status === 'upcoming') || null;
}

const kindFor = (chip) => (!chip ? 'huomio' : chip.status === 'now' ? 'lasnaolo' : chip.status === 'upcoming' ? 'tiedote' : 'huomio');

/**
 * open, onClose, trainingId (start on this session), initialIds (start on these players),
 * initialKind ('tiedote' | 'huomio' | 'lasnaolo' | 'teema'), onVideo(ids) — opens the video sheet for them.
 */
export function MerkintaSheet({ open, onClose, trainingId = null, initialIds = [], initialKind = null, onVideo }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const now = new Date();
  const chips = useMemo(() => sessionChips(state, now), [state, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = koutsiCurrentIsoWeek();
  const weekGroupList = useMemo(() => weekGroups(state, week), [state, week.year, week.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = koutsiTodayStr();
  const tomorrow = koutsiAddDays(today, 1);

  const [kind, setKind] = useState('huomio');
  const [picked, setPicked] = useState([]); // chip keys
  const [allWeek, setAllWeek] = useState(false);
  const [custom, setCustom] = useState([]); // player ids picked from the full list
  const [pickerOpen, setPickerOpen] = useState(false);
  const [text, setText] = useState('');
  const [until, setUntil] = useState(today);
  const [asHomework, setAsHomework] = useState(false);
  const [busy, setBusy] = useState(false);
  // Teema: one theme for the picked groups this week — the planner's quick path.
  const themeWeek = plannerDefaultWeek(now);
  const themeStatus = useMemo(() => koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek), [state, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const themeRows = themeStatus.rows.filter((r) => !r.skips);
  const [themeIds, setThemeIds] = useState([]);
  const [allGroups, setAllGroups] = useState(false);
  const [title, setTitle] = useState('');
  const [lead, setLead] = useState('');
  const saveThemes = useSaveThemes();
  const continueThemes = useContinueThemes();
  const confirm = useConfirm();
  const toast = useToast();

  useEffect(() => {
    if (!open) return;
    const start = trainingId ? chips.find((c) => c.key === trainingId) : (initialIds.length ? null : defaultChip(chips));
    setPicked(start ? [start.key] : []);
    setCustom(initialIds);
    setAllWeek(false);
    setPickerOpen(false);
    setText('');
    setAsHomework(false);
    setThemeIds(themeStatus.missing.map((g) => g.id));
    setAllGroups(!themeStatus.missing.length);
    setTitle('');
    setLead('');
    const first = initialKind || (initialIds.length ? 'huomio' : !start && themeStatus.missing.length ? 'teema' : kindFor(start));
    setKind(first === 'tiedote' && !noticesReady ? 'huomio' : first);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const attendance = kind === 'lasnaolo';
  const theme = kind === 'teema';
  // Tiedotteet need their table (supabase/migrations/20261023114724_koutsi_announcements.sql); until then the
  // choice stays hidden. The coach's notices still in date can be taken back.
  const noticesReady = state.announcementsReady !== false;
  const activeNotices = (state.announcements || []).filter((a) => a.until >= today);
  const noticeAudience = (a) => [...new Set([
    ...(a.groupIds || []).map((id) => state.groups.find((g) => g.id === id)?.name).filter(Boolean),
    ...(a.studentIds || []).map((id) => state.students.find((st) => st.id === id)?.name).filter(Boolean),
  ])].join(', ');
  const removeNotice = async (a) => {
    const ok = await confirm({ title: 'Poistetaanko tiedote?', message: `”${a.text}” katoaa pelaajien etusivulta. Jo lähetetyt ilmoitukset jäävät.`, confirmLabel: 'Poista', danger: true });
    if (ok) await run(() => api.announcements.remove(a.id), 'Tiedote poistettu.');
  };
  // Läsnäolo is one of today's sessions; the others are for anyone.
  const shownChips = attendance ? chips.filter((c) => c.day === today) : chips;
  const attendChip = attendance ? (shownChips.find((c) => picked.includes(c.key)) || defaultChip(shownChips) || shownChips[0] || null) : null;
  const pickedChips = chips.filter((c) => picked.includes(c.key));

  // Who gets it: a Huomio after a session goes to the players who were there; a Tiedote to
  // everyone in the group (the ones away need the practical news most).
  const ids = useMemo(() => {
    const fromChips = pickedChips.flatMap((c) => (kind === 'huomio' && c.status !== 'upcoming' ? c.present : c.roster));
    const fromWeek = allWeek ? groupMemberIds(state, weekGroupList) : [];
    return [...new Set([...fromChips, ...fromWeek, ...custom])];
  }, [pickedChips, allWeek, custom, kind, state, weekGroupList]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupIds = [...new Set([...pickedChips.map((c) => c.group?.id).filter(Boolean), ...(allWeek ? weekGroupList.map((g) => g.id) : [])])];

  // A Tiedote shows until the last picked session's day (tomorrow's news ends tomorrow), else
  // until the end of the week.
  const sunday = weekDates(week)[6];
  useEffect(() => {
    const last = pickedChips.map((c) => c.training.date).sort().pop();
    setUntil(last || sunday);
  }, [picked.join(','), sunday]); // eslint-disable-line react-hooks/exhaustive-deps
  const untilOptions = [
    { value: today, label: 'Tänään' },
    { value: tomorrow, label: 'Huomiseen' },
    ...(sunday > tomorrow ? [{ value: sunday, label: `${koutsiFmtShortDate(sunday)} asti` }] : []),
  ];

  const toggleChip = (key) => {
    track('merkitse.valitse');
    setAllWeek(false);
    if (attendance) { setPicked([key]); return; }
    setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));
  };
  const changeKind = (v) => {
    track(`merkitse.${v}`);
    if (v === 'lasnaolo') {
      // one session: keep a picked one of today's, else the moment's
      const todays = chips.filter((c) => c.day === today);
      const keep = todays.find((c) => picked.includes(c.key)) || defaultChip(todays);
      setPicked(keep ? [keep.key] : []);
      setAllWeek(false);
      setPickerOpen(false);
    }
    setKind(v);
  };

  const dirty = theme ? Boolean(title.trim() || lead.trim()) : Boolean(text.trim());
  const ready = theme ? Boolean(title.trim()) && themeIds.length > 0 && !busy : dirty && ids.length > 0 && !busy;
  const k = KINDS[kind];

  // Teema: groups without a theme first (already picked); the ones with a theme behind a tap.
  const shownThemeRows = allGroups ? themeRows : themeRows.filter((r) => !r.theme || themeIds.includes(r.group.id));
  const hiddenThemeRows = themeRows.length - shownThemeRows.length;
  const toggleThemeGroup = (id) => setThemeIds((v) => (v.includes(id) ? v.filter((x) => x !== id) : [...v, id]));
  const carryOn = async () => {
    track('merkitse.jatka-teemat');
    const n = await continueThemes(themeStatus.carry, themeWeek);
    if (n) onClose();
  };
  const submitTheme = async () => {
    const t = title.trim();
    const l = lead.trim();
    if (!t || !themeIds.length || busy) return;
    const pickedRows = themeRows.filter((r) => themeIds.includes(r.group.id));
    const row = (g) => ({ groupId: g.id, year: themeWeek.year, week: themeWeek.week, title: t, lead: l });
    // A group's own different theme is replaced only after the coach says so.
    const changing = pickedRows.filter((r) => r.theme && (r.theme.title !== t || (r.theme.lead || '') !== l));
    if (changing.length) {
      const ok = await confirm({
        title: changing.length === 1 ? `Vaihdetaanko ryhmän ${changing[0].group.name} teema?` : `Vaihdetaanko ${changing.length} ryhmän teema?`,
        message: `Nykyinen teema (${[...new Set(changing.map((r) => r.theme.title))].slice(0, 3).join(', ')}) korvataan teemalla ${t}.`,
        confirmLabel: 'Vaihda teema',
      });
      if (!ok) return;
    }
    setBusy(true);
    const written = await saveThemes({ fresh: pickedRows.filter((r) => !r.theme).map((r) => row(r.group)), replace: changing.map((r) => row(r.group)) });
    setBusy(false);
    if (written == null) return;
    toast(pickedRows.length === 1 ? 'Teema tallennettu.' : `Teema tallennettu ${pickedRows.length} ryhmälle.`);
    track('tallennettu.teema');
    onClose();
  };

  const submit = async () => {
    if (!ready) return;
    setBusy(true);
    const clean = text.trim();
    const n = ids.length;
    let res;
    if (kind === 'tiedote') {
      // Whole groups are stored as groups (a new member sees the notice too); the rest by player.
      const inGroups = new Set(groupMemberIds(state, state.groups.filter((g) => groupIds.includes(g.id))));
      res = await run(() => api.announcements.add(coachId, { text: clean, groupIds, studentIds: ids.filter((id) => !inGroups.has(id)), until }),
        n === 1 ? 'Tiedote lähetetty.' : `Tiedote lähetetty ${n} pelaajalle.`);
    } else if (asHomework) {
      res = await run(() => api.homework.addMany(ids, clean), n === 1 ? 'Kotiläksy annettu.' : `Kotiläksy annettu ${n} pelaajalle.`);
    } else {
      res = await run(() => api.notes.addMany(coachId, ids, clean), n === 1 ? 'Huomio lähetetty.' : `Huomio lähetetty ${n} pelaajalle.`);
    }
    setBusy(false);
    if (!res.ok) return;
    track(`tallennettu.${kind === 'tiedote' ? 'tiedote' : asHomework ? 'laksy' : 'huomio'}`);
    onClose();
  };

  const shown = ids.map((id) => state.students.find((s) => s.id === id)).filter(Boolean);
  const footer = attendance ? (
    <Button variant="dark" size="lg" block onClick={onClose}>Valmis</Button>
  ) : theme ? (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
      <Button variant="dark" size="lg" disabled={!ready} loading={busy} onClick={submitTheme}>
        {themeIds.length > 1 ? `Tallenna ${themeIds.length} ryhmälle` : 'Tallenna'}
      </Button>
    </div>
  ) : (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
      <Button variant="dark" size="lg" icon="send" disabled={!ready} loading={busy} onClick={submit}>
        {ids.length ? `Lähetä ${players(ids.length)}` : 'Lähetä'}
      </Button>
    </div>
  );
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Merkitse" size="md" dismissible={!busy && !dirty} className="vs-sheet" footer={footer}>
      <div className="stack-5">
        <div className="vs-kind">
          <Segmented ariaLabel="Mitä merkitset" value={kind} onChange={changeKind} options={[
            ...(noticesReady ? [{ value: 'tiedote', label: 'Tiedote' }] : []),
            { value: 'huomio', label: 'Huomio' },
            { value: 'lasnaolo', label: 'Läsnäolo' },
            { value: 'teema', label: 'Teema' },
          ]} />
          <p className="vs-help"><Icon name={k.icon} size={15} />{k.help}</p>
        </div>

        {theme ? (
          <>
            {themeStatus.carry.length > 0 && (
              <button type="button" className="vs-carry" onClick={carryOn}>
                <span className="vs-carry-icon"><Icon name="repeat" size={17} /></span>
                <span className="ms-row-main">
                  <span className="ms-row-title">Jatka viime viikon teemoilla</span>
                  <span className="ms-row-sub">{themeStatus.carry.length === 1 ? '1 ryhmä' : `${themeStatus.carry.length} ryhmää`} · {[...new Set(themeStatus.carry.map((x) => x.from.title))].slice(0, 2).join(', ')}</span>
                </span>
                <Icon name="chevron-right" size={16} className="k-chevron" />
              </button>
            )}
            <section className="vs-to" aria-label="Mille ryhmille">
              <div className="vs-label">Mille ryhmille · vko {themeWeek.week}</div>
              <div className="vs-chips" role="group" aria-label="Valitse ryhmät">
                {shownThemeRows.map(({ group, theme: current }) => {
                  const on = themeIds.includes(group.id);
                  return (
                    <button key={group.id} type="button" aria-pressed={on} className={cx('vs-chip', on && 'is-on')} onClick={() => toggleThemeGroup(group.id)}>
                      <span className="vs-chip-check" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                      <span className="vs-chip-when">{group.day} {group.time}</span>
                      <span className="vs-chip-name">{group.name}</span>
                      <span className={cx('vs-chip-sub', !current && 'is-missing')}>{current ? current.title : 'Ei teemaa'}</span>
                    </button>
                  );
                })}
                {hiddenThemeRows > 0 && (
                  <button type="button" className="vs-chip is-more" onClick={() => setAllGroups(true)}>
                    <span className="vs-chip-when"><Icon name="plus" size={13} /> {hiddenThemeRows} ryhmää</span>
                    <span className="vs-chip-name">Joilla on jo teema</span>
                  </button>
                )}
              </div>
            </section>
            <div className="stack-2">
              <label className="vs-label" htmlFor="merkinta-teema">Teema</label>
              <Input id="merkinta-teema" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Esim. Kakkossyöttö" maxLength={KOUTSI_THEME_TITLE_MAX} />
            </div>
            <div className="stack-2">
              <label className="vs-label" htmlFor="merkinta-tarkennus">Tarkennus <span className="vs-optional">vapaaehtoinen</span></label>
              <Textarea id="merkinta-tarkennus" rows={2} value={lead} onChange={(e) => setLead(e.target.value)} placeholder="Esim. Kierre ja korkeus verkon yli — varmuus ennen vauhtia." maxLength={KOUTSI_THEME_LEAD_MAX} />
            </div>
            <button type="button" className="k-textlink vs-planner-link" onClick={() => { onClose(); openPlanner({ week: themeWeek }); }}>
              Koko teemasuunnittelu ja aiemmat teemat <Icon name="arrow-right" size={14} />
            </button>
          </>
        ) : (
        <>
        <section className="vs-to" aria-label={attendance ? 'Mikä treeni' : 'Kenelle'}>
          <div className="vs-label">{attendance ? 'Mikä treeni' : 'Kenelle'}</div>
          {shownChips.length === 0 && attendance ? <p className="k-quiet">Ei treenejä tänään.</p> : (
            <div className="vs-chips" role="group" aria-label={attendance ? 'Valitse treeni' : 'Valitse ryhmä'}>
              {shownChips.map((c) => {
                const on = attendance ? attendChip?.key === c.key : picked.includes(c.key);
                return (
                  <button key={c.key} type="button" aria-pressed={on} className={cx('vs-chip', on && 'is-on', c.status === 'now' && 'is-now')} onClick={() => toggleChip(c.key)}>
                    <span className="vs-chip-check" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                    <span className="vs-chip-when">{c.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{c.when}</span>
                    <span className="vs-chip-name">{c.name}</span>
                  </button>
                );
              })}
              {!attendance && weekGroupList.length > 0 && (
                <button type="button" aria-pressed={allWeek} className={cx('vs-chip', allWeek && 'is-on')}
                  onClick={() => { track('merkitse.koko-viikko'); setAllWeek((v) => !v); setPicked([]); }}>
                  <span className="vs-chip-check" aria-hidden="true">{allWeek && <Icon name="check" size={12} strokeWidth={3} />}</span>
                  <span className="vs-chip-when">Vko {week.week}</span>
                  <span className="vs-chip-name">Koko viikon ryhmät</span>
                </button>
              )}
              {!attendance && (
                <button type="button" aria-pressed={pickerOpen} className={cx('vs-chip', 'is-more', pickerOpen && 'is-on')} onClick={() => setPickerOpen((v) => !v)}>
                  <span className="vs-chip-when"><Icon name="users" size={13} /> Muut</span>
                  <span className="vs-chip-name">Ryhmä tai pelaaja…</span>
                </button>
              )}
            </div>
          )}
          {!attendance && ids.length > 0 && (
            <div className="vs-summary">
              <span className="vs-summary-avatars" aria-hidden="true">{shown.slice(0, 4).map((s) => <Avatar key={s.id} person={s} size={26} />)}</span>
              <span className="vs-summary-text"><strong>{ids.length === 1 ? '1 pelaaja' : `${ids.length} pelaajaa`}</strong> · {recipientSummary(state.students, ids)}</span>
            </div>
          )}
          {!attendance && pickerOpen && (
            <div className="vs-picker">
              <RecipientPicker students={state.students} groups={state.groups} value={custom} onChange={setCustom} open={pickerOpen} />
            </div>
          )}
        </section>

        {attendance ? (
          attendChip && <AttendanceChips training={attendChip.training} source="merkitse" />
        ) : (
          <>
            <div className="stack-2">
              <label className="vs-label" htmlFor="merkinta-text">{kind === 'tiedote' ? 'Tiedote' : asHomework ? 'Kotiläksy' : 'Huomio'}</label>
              <Textarea id="merkinta-text" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={asHomework && kind === 'huomio' ? 'Esim. 20 rystylyöntiä seinää vasten…' : k.placeholder} maxLength={4000} />
            </div>
            {kind === 'tiedote' ? (
              <div className="stack-2">
                <div className="vs-label">Näkyy pelaajille</div>
                <div className="vs-pills" role="group" aria-label="Näkyy pelaajille">
                  {untilOptions.map((o) => (
                    <button key={o.value} type="button" aria-pressed={until === o.value} className={cx('vs-pill', until === o.value && 'is-on')} onClick={() => setUntil(o.value)}>{o.label}</button>
                  ))}
                </div>
                {activeNotices.length > 0 && (
                  <div className="vs-sent">
                    <div className="vs-label">Voimassa nyt</div>
                    <ul className="vs-sent-list">
                      {activeNotices.map((a) => (
                        <li key={a.id} className="vs-sent-row">
                          <span className="vs-sent-main">
                            <span className="vs-sent-text">{a.text}</span>
                            <span className="vs-sent-sub">{[noticeAudience(a), `${koutsiFmtShortDate(a.until)} asti`].filter(Boolean).join(' · ')}</span>
                          </span>
                          <IconButton icon="trash" label="Poista tiedote" size="sm" onClick={() => removeNotice(a)} />
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : (
              <div className="stack-3">
                <div className="vs-pills" role="group" aria-label="Lisää">
                  <button type="button" aria-pressed={asHomework} className={cx('vs-pill', asHomework && 'is-on')} onClick={() => setAsHomework((v) => !v)}>
                    <Icon name="check-circle" size={15} />Kotiläksyksi
                  </button>
                  <button type="button" className="vs-pill" disabled={!ids.length} onClick={() => onVideo?.(ids)}>
                    <Icon name="play" size={15} />Lisää video
                  </button>
                </div>
                <p className="k-warn-text">{HEALTH_NOTE}</p>
              </div>
            )}
          </>
        )}
        </>
        )}
      </div>
    </Sheet>
  );
}
