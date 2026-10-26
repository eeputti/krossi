// MerkintaSheet.jsx — the new Merkitse, the big middle button (haara koutsi-selkeys). Everything a
// coach records goes through this one sheet, in the order a coach thinks it:
//   1. what: a Tiedote (a practical notice — another coach tomorrow, a different court — on the
//      players' Koti until a date, never on their Kehitys), a Huomio (feedback that stays on the
//      player's Kehitys, optionally as a homework or with a video), or the Läsnäolo of a session.
//      Teema opens Viikon teemat (PlannerSheet: teema → ryhmät → valmis, as in the old Koutsi).
//   2. for whom: today's and tomorrow's sessions as chips (only a session on now or just over is
//      already picked — nothing is guessed), the week's groups, or anyone from the full list
//   3. the text (or, for Läsnäolo, the players to tap away).
// Opened from the big button it first asks what (six choices, none of them marked as a
// suggestion: the coach knows what they came to do) and only then shows the form; "Vaihda" goes
// back. Opened with a kind (the drawer's Tiedote, a player's Huomio) it goes straight to the form.
// For whom: group cards — the groups training today or tomorrow first, the rest behind
// "+ N ryhmää", all of the week's groups at once, or single players.
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Avatar, Button, Icon, IconButton, Sheet, Textarea, useConfirm, useToast } from '../ui/index.js';
import { navigate } from '../app/router.js';
import { RecipientPicker, recipientSummary } from '../shared/recipients.jsx';
import { sendLogFor } from '../domain/sends.js';
import {
  koutsiAddDays, koutsiCurrentIsoWeek, koutsiFmtShortDate, koutsiSortGroupsBySchedule, koutsiTodayStr, koutsiWeekThemeStatus,
} from '../domain/core.js';
import {
  coachSessionsOn, dayRecap, groupMemberIds, JUST_ENDED_MINUTES, merkitseContext, plannerDefaultWeek, presentPlayerIds, sessionEnd, sessionRoster, sessionStatus, weekDates, weekGroups, weekRecap,
} from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { AttendanceChips } from './attendance.jsx';
import { openPlanner } from './nav.js';
import { ChoiceGrid, ChoiceRows, RECORD_LOOK } from './tiles.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const HEALTH_NOTE = 'Älä kirjoita vammoja, sairauksia, diagnooseja, lääkityksiä tai muita terveystietoja.';
const players = (n) => (n === 1 ? '1 pelaajalle' : `${n} pelaajalle`);

const LABELS = { tiedote: 'Tiedote', huomio: 'Huomio', video: 'Video', lasnaolo: 'Läsnäolo' };
const KINDS = {
  tiedote: {
    icon: 'info',
    short: 'Käytännön asia ryhmälle, esim. toinen valmentaja tai eri kenttä. Näkyy pelaajien Kodissa.',
    help: 'Käytännön asia, esim. toinen valmentaja tai eri kenttä. Näkyy pelaajien Kodissa. Ei jää kehitykseen.',
    placeholder: 'Esim. Huomenna valmentajana Juho. Treeni alkaa normaalisti.',
  },
  huomio: {
    icon: 'chat',
    short: 'Palautetta pelaajalle. Jää hänen Kehitykseensä, myös kotiläksynä tai videona.',
    help: 'Palautetta pelaajalle. Jää hänen Kehitys-sivulleen.',
    placeholder: 'Esim. Hyvä nousu syötössä — heitto pysyy jo samassa kohdassa.',
  },
  video: {
    icon: 'play',
    short: 'Jaa video pelaajille: lyönnin malli, otteluvideo tai harjoite.',
    help: 'Valitse ryhmät tai pelaajat, sitten video tai linkki. Video näkyy pelaajan Harjoitteet ja videot -sivulla.',
  },
  lasnaolo: {
    icon: 'user-check',
    short: 'Kuka oli paikalla tämän päivän treenissä.',
    help: 'Kaikki ovat paikalla, ellet napauta toisin. Pelaajan oma "En pääse" on jo merkitty.',
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

/** The chip a fresh sheet starts on: the session on now, else the one just over — never a guess. */
function defaultChip(chips) {
  const ended = chips.filter((c) => c.justEnded);
  return chips.find((c) => c.status === 'now') || ended[ended.length - 1] || null;
}

const kindFor = (chip) => (!chip ? 'huomio' : chip.status === 'now' ? 'lasnaolo' : chip.status === 'upcoming' ? 'tiedote' : 'huomio');

/**
 * open, onClose, trainingId (start on this session), initialIds (start on these players),
 * initialGroupIds + focusDate (start on these groups, about their session that day — a Tiedote
 * from a coming session in Viikkohallinta then shows until that day),
 * initialKind ('tiedote' | 'huomio' | 'lasnaolo' | 'teema'), onVideo(ids) — opens the video sheet for them.
 */
export function MerkintaSheet({ open, onClose, trainingId = null, initialIds = [], initialGroupIds = [], focusDate = null, initialKind = null, onVideo, onDay, onWeek, onAbsence }) {
  const { state, run } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const now = new Date();
  const chips = useMemo(() => sessionChips(state, now), [state, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const week = koutsiCurrentIsoWeek();
  const weekGroupList = useMemo(() => weekGroups(state, week), [state, week.year, week.week]); // eslint-disable-line react-hooks/exhaustive-deps
  const today = koutsiTodayStr();
  const tomorrow = koutsiAddDays(today, 1);

  const [kind, setKind] = useState('huomio');
  const [choosing, setChoosing] = useState(false); // phone: "Mitä merkitset?" first
  const [picked, setPicked] = useState([]); // Läsnäolo: the session (chip key)
  const [targets, setTargets] = useState([]); // Tiedote / Huomio: 'g:<groupId>' and 't:<trainingId>' (a private lesson)
  const [allTargets, setAllTargets] = useState(false); // show every group, not only today's and tomorrow's
  const [custom, setCustom] = useState([]); // player ids picked from the full list
  const [pickerOpen, setPickerOpen] = useState(false);
  const [text, setText] = useState('');
  const [until, setUntil] = useState(today);
  const [aboutDate, setAboutDate] = useState(null); // the session day a Tiedote is about
  const [asHomework, setAsHomework] = useState(false);
  const [busy, setBusy] = useState(false);
  // The group of the session on now (or just over) is picked for the coach; "Yksittäin" then means
  // "these players instead", so that a note meant for one player doesn't go to the whole group.
  const autoPicked = useRef(false);
  // Teema opens Viikon teemat; the tile only says how many groups still lack this week's theme.
  const themeWeek = plannerDefaultWeek(now);
  const themeStatus = useMemo(() => koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek), [state, open]); // eslint-disable-line react-hooks/exhaustive-deps
  const confirm = useConfirm();

  useEffect(() => {
    if (!open) return;
    const fromGroups = initialGroupIds.length > 0;
    const start = trainingId ? chips.find((c) => c.key === trainingId)
      : fromGroups ? chips.find((c) => c.group && initialGroupIds.includes(c.group.id) && (!focusDate || c.training.date === focusDate)) || null
        : (initialIds.length ? null : defaultChip(chips));
    setPicked(start ? [start.key] : []);
    setTargets(fromGroups ? initialGroupIds.map((id) => `g:${id}`) : start ? [start.group ? `g:${start.group.id}` : `t:${start.key}`] : []);
    autoPicked.current = Boolean(start) && !trainingId && !fromGroups;
    setAboutDate(focusDate && focusDate >= today ? focusDate : null);
    setAllTargets(false);
    setCustom(initialIds);
    setPickerOpen(false);
    setText('');
    setAsHomework(false);
    const first = initialKind || (initialIds.length ? 'huomio' : kindFor(start));
    setKind(first === 'tiedote' && !noticesReady ? 'huomio' : first);
    setChoosing(!initialKind);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const attendance = kind === 'lasnaolo';
  const video = kind === 'video';
  // Tiedotteet need their table (supabase/migrations/20261023114724_koutsi_announcements.sql); until then the
  // choice stays hidden. The coach's notices still in date can be taken back.
  const noticesReady = state.announcementsReady !== false;
  const activeNotices = (state.announcements || []).filter((a) => a.until >= today);
  const noticeAudience = (a) => [...new Set([
    ...(a.groupIds || []).map((id) => state.groups.find((g) => g.id === id)?.name).filter(Boolean),
    ...(a.studentIds || []).map((id) => state.students.find((st) => st.id === id)?.name).filter(Boolean),
  ])].join(', ');
  const removeNotice = async (a) => {
    const ok = await confirm({ title: 'Poistetaanko tiedote?', message: `”${a.text}” katoaa pelaajien etusivulta.`, confirmLabel: 'Poista', danger: true });
    if (ok) await run(() => api.announcements.remove(a.id), 'Tiedote poistettu.');
  };
  // Läsnäolo is one of today's sessions; the others are for anyone.
  const shownChips = attendance ? chips.filter((c) => c.day === today) : chips;
  const attendChip = attendance ? (shownChips.find((c) => picked.includes(c.key)) || defaultChip(shownChips) || shownChips[0] || null) : null;

  // Who gets it: a Huomio after a session goes to the players who were there; a Tiedote to
  // everyone in the group (the ones away need the practical news most).
  // The cards: every group of the season, with its session today or tomorrow if it has one, and
  // today's and tomorrow's private lessons.
  const cards = useMemo(() => {
    const chipOf = new Map();
    chips.forEach((c) => { if (c.group && !chipOf.has(c.group.id)) chipOf.set(c.group.id, c); });
    const nextDate = (groupId) => (state.trainings || [])
      .filter((t) => t.groupId === groupId && t.loggedBy !== 'player' && t.date >= today).map((t) => t.date).sort()[0] || null;
    const groups = koutsiSortGroupsBySchedule(state.groups).map((g) => {
      const chip = chipOf.get(g.id) || null;
      const next = chip ? chip.training.date : nextDate(g.id);
      return {
        key: `g:${g.id}`, group: g, chip, when: `${g.day} ${g.time}`, name: g.name, next,
        sub: chip ? chip.when : next ? `Seuraava ${koutsiFmtShortDate(next)}` : 'Ei tulevia treenejä',
      };
    });
    const privates = chips.filter((c) => !c.group).map((c) => ({ key: `t:${c.key}`, chip: c, when: c.when, name: c.name, sub: 'Yksityistunti', next: c.training.date }));
    const at = (x) => `${x.chip.training.date}T${x.chip.training.time || ''}`;
    return {
      soon: [...groups.filter((x) => x.chip), ...privates].sort((a, b) => at(a).localeCompare(at(b))),
      rest: groups.filter((x) => !x.chip),
    };
  }, [state, chips, today]);
  const cardOf = (key) => cards.soon.find((x) => x.key === key) || cards.rest.find((x) => x.key === key) || null;
  // A Huomio to a group whose session today has started goes to the players who were there; a
  // Tiedote to everyone in the group (the ones away need the practical news most).
  const ids = useMemo(() => {
    const out = [];
    targets.forEach((key) => {
      const card = cardOf(key);
      if (!card) return;
      const sessionToday = card.chip && card.chip.day === today && card.chip.status !== 'upcoming' ? card.chip : null;
      if ((kind === 'huomio' || kind === 'video') && sessionToday) out.push(...sessionToday.present);
      else if (card.group) out.push(...card.group.memberIds);
      else out.push(...card.chip.roster);
    });
    return [...new Set([...out, ...custom])];
  }, [targets, cards, custom, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const groupIds = targets.filter((k) => k.startsWith('g:')).map((k) => k.slice(2));
  const weekKeys = weekGroupList.map((g) => `g:${g.id}`);
  const allWeek = weekKeys.length > 0 && weekKeys.every((k) => targets.includes(k));

  // A Tiedote shows until the last picked session's day (tomorrow's news ends tomorrow), else
  // until the end of the week; one written for a coming session (Viikkohallinta) until its day.
  const sunday = weekDates(week)[6];
  useEffect(() => {
    const days = targets.map((k) => cardOf(k)?.next).filter((d) => d && d <= sunday);
    if (aboutDate) days.push(aboutDate);
    setUntil(days.sort().pop() || sunday);
  }, [targets.join(','), sunday, aboutDate]); // eslint-disable-line react-hooks/exhaustive-deps
  const untilDay = until > tomorrow && until !== sunday ? [{ value: until, label: `${koutsiFmtShortDate(until)} asti` }] : [];
  const untilOptions = [
    { value: today, label: 'Tänään' },
    { value: tomorrow, label: 'Huomiseen' },
    ...(until < sunday ? untilDay : []),
    ...(sunday > tomorrow ? [{ value: sunday, label: `${koutsiFmtShortDate(sunday)} asti` }] : []),
    ...(until > sunday ? untilDay : []),
  ];

  const toggleChip = (key) => { track('merkitse.valitse'); setPicked([key]); }; // Läsnäolo: one session
  const toggleTarget = (key) => {
    track('merkitse.valitse');
    autoPicked.current = false;
    setTargets((v) => (v.includes(key) ? v.filter((k) => k !== key) : [...v, key]));
  };
  const toggleWeek = () => {
    track('merkitse.koko-viikko');
    autoPicked.current = false;
    setAllTargets(true);
    setTargets((v) => (allWeek ? v.filter((k) => !weekKeys.includes(k)) : [...new Set([...v, ...weekKeys])]));
  };
  const changeKind = (v) => {
    track(`merkitse.${v}`);
    if (v === 'lasnaolo') {
      // one session: keep a picked one of today's, else the moment's
      const todays = chips.filter((c) => c.day === today);
      const keep = todays.find((c) => picked.includes(c.key)) || defaultChip(todays);
      setPicked(keep ? [keep.key] : []);
      setPickerOpen(false);
    }
    setKind(v);
  };

  const dirty = Boolean(text.trim());
  const ready = dirty && ids.length > 0 && !busy;
  const missing = ids.length === 0 ? 'Valitse ensin ryhmät tai pelaajat.' : !dirty ? (kind === 'tiedote' ? 'Kirjoita tiedote ensin.' : 'Kirjoita huomio ensin.') : null;
  const k = KINDS[kind];
  const look = RECORD_LOOK[kind === 'huomio' && asHomework ? 'laksy' : kind] || RECORD_LOOK.huomio;

  // thenVideo: "Lähetä ja lisää video" — the typed text is sent first, then the video sheet opens
  // for the same players (it used to open straight away and the typed text was lost).
  const submit = async ({ thenVideo = false } = {}) => {
    if (!ready) return;
    setBusy(true);
    const clean = text.trim();
    const sentIds = ids;
    const n = ids.length;
    let res;
    if (kind === 'tiedote') {
      // Whole groups are stored as groups (a new member sees the notice too); the rest by player.
      const inGroups = new Set(groupMemberIds(state, state.groups.filter((g) => groupIds.includes(g.id))));
      res = await run(() => api.announcements.add(coachId, { text: clean, groupIds, studentIds: ids.filter((id) => !inGroups.has(id)), until }),
        n === 1 ? 'Tiedote lähetetty.' : `Tiedote lähetetty ${n} pelaajalle.`);
    } else if (asHomework) {
      res = await run(() => api.homework.addMany(ids, clean, sendLogFor(state, coachId, ids)), n === 1 ? 'Kotiläksy annettu.' : `Kotiläksy annettu ${n} pelaajalle.`);
    } else {
      res = await run(() => api.notes.addMany(coachId, ids, clean, sendLogFor(state, coachId, ids)), n === 1 ? 'Huomio lähetetty.' : `Huomio lähetetty ${n} pelaajalle.`);
    }
    setBusy(false);
    if (!res.ok) return;
    track(`tallennettu.${kind === 'tiedote' ? 'tiedote' : asHomework ? 'laksy' : 'huomio'}`);
    if (thenVideo && onVideo) { onVideo(sentIds); return; }
    onClose();
  };

  const shown = ids.map((id) => state.students.find((s) => s.id === id)).filter(Boolean);

  // ── the first step: one line on the moment, six choices, and the rarer things below ──
  const ctx = merkitseContext(state, now);
  const ctxItem = ctx && ['now', 'ended', 'next'].includes(ctx.kind) ? ctx.items[0] : null;
  const fromTraining = trainingId ? state.trainings.find((t) => t.id === trainingId) : null;
  const fromGroup = fromTraining?.groupId ? state.groups.find((g) => g.id === fromTraining.groupId) : null;
  const situation = fromTraining ? {
    live: false,
    label: fromTraining.date === today ? 'Tänään' : koutsiFmtShortDate(fromTraining.date),
    text: `${fromGroup?.name || fromTraining.type} ${fromTraining.time}`,
  } : ctxItem ? {
    live: ctx.kind === 'now',
    label: ctx.kind === 'now' ? 'Nyt käynnissä' : ctx.kind === 'ended' ? 'Juuri päättyi' : 'Seuraavaksi',
    text: `${ctxItem.group?.name || ctxItem.student?.name || ctxItem.training.type} ${ctxItem.training.time}`,
  } : null;
  const pick = (v, homework = false) => { changeKind(v); setAsHomework(homework); setChoosing(false); if (homework) track('merkitse.laksy'); };
  const missingThemes = themeStatus.missing.length;
  const tiles = [
    { id: 'lasnaolo', look: 'lasnaolo', sub: 'Kuka oli paikalla', run: () => pick('lasnaolo') },
    { id: 'huomio', look: 'huomio', sub: 'Palaute, jää kehitykseen', run: () => pick('huomio') },
    { id: 'laksy', look: 'laksy', sub: 'Tehtävä kotiin', run: () => pick('huomio', true) },
    ...(noticesReady ? [{ id: 'tiedote', look: 'tiedote', sub: 'Käytännön asia', run: () => pick('tiedote') }] : []),
    { id: 'teema', look: 'teema', sub: missingThemes ? `Puuttuu ${missingThemes === 1 ? '1 ryhmältä' : `${missingThemes} ryhmältä`}` : 'Viikon teema',
      run: () => { track('merkitse.teemat'); onClose(); openPlanner({ week: themeWeek }); } },
    { id: 'video', look: 'video', sub: 'Jaa pelaajille', run: () => pick('video') },
  ];
  const fmtAvg = (x) => x.toFixed(1).replace('.', ',');
  const summary = (() => {
    if (!ctx || (ctx.kind !== 'day' && ctx.kind !== 'week')) return null;
    if (ctx.kind === 'day') {
      const r = dayRecap(state, today, now);
      const sub = [r.expected ? `Läsnä ${r.present}/${r.expected}` : '', r.moodAverage != null ? `fiilis ${fmtAvg(r.moodAverage)}` : 'ei fiiliksiä vielä'].filter(Boolean).join(' · ');
      return { id: 'paiva', icon: 'check-circle', title: 'Päivän yhteenveto', sub, run: () => { track('merkitse.paiva'); onDay?.(today); } };
    }
    const r = weekRecap(state, week, now);
    const sub = r.sessions
      ? [`${r.held}/${r.sessions} treeniä`, r.attendance != null ? `läsnä ${Math.round(r.attendance * 100)} %` : '', r.moodAverage != null ? `fiilis ${fmtAvg(r.moodAverage)}` : ''].filter(Boolean).join(' · ')
      : 'Ei treenejä tällä viikolla';
    return { id: 'viikko', icon: 'trophy', title: `Viikko ${week.week} paketissa · oma muistio`, sub, run: () => { track('merkitse.viikko'); onWeek?.(week); } };
  })();
  const others = [
    ...(summary ? [summary] : []),
    // on a Sunday the week's recap above holds the coach's own week memo too
    ...(summary?.id === 'viikko' ? [] : [{ id: 'paivakirja', icon: 'edit', title: 'Oma viikkomuistio', sub: 'Vain sinulle', run: () => { track('merkitse.paivakirja'); onWeek?.(week); } }]),
    { id: 'poissaolo', icon: 'calendar', title: 'Poissaolo', sub: 'Pelaaja pois monesta treenistä', run: () => { track('merkitse.poissaolo'); onAbsence?.(); } },
  ];
  const footer = video ? (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={onClose}>Peruuta</Button>
      <Button variant="dark" size="lg" icon="play" onClick={() => { track('merkitse.video'); onVideo?.(ids); }}>
        {ids.length ? `Video ${players(ids.length)}` : 'Valitse video'}
      </Button>
    </div>
  ) : attendance ? (
    <Button variant="dark" size="lg" block onClick={onClose}>Valmis</Button>
  ) : (
    <div className="sheet-actions">
      <Button variant="soft" size="lg" onClick={onClose} disabled={busy}>Peruuta</Button>
      <Button variant="dark" size="lg" icon="send" missing={missing} loading={busy} onClick={() => submit()}>
        {ids.length ? `Lähetä ${players(ids.length)}` : 'Lähetä'}
      </Button>
    </div>
  );
  return (
    <Sheet open={open} onClose={() => !busy && onClose()} title="Merkitse" size="md" dismissible={!busy} confirmClose={dirty} className="vs-sheet" footer={choosing ? null : footer}>
      {choosing ? (
        <div className="vs-choose stack-4">
          {situation && (
            <p className="vs-situation">{situation.live && <span className="k-ctx-live" aria-hidden="true" />}<strong>{situation.label}</strong> · {situation.text}</p>
          )}
          {/* the same tiles and rows as a session's sheet in Viikkohallinta (tiles.jsx) */}
          <ChoiceGrid label="Mitä merkitset?" tiles={tiles} />
          <ChoiceRows rows={others} />
        </div>
      ) : (
      <div className="stack-5">
        <div className="vs-kind">
          <div className="vs-picked">
            <button type="button" className="vs-back" onClick={() => setChoosing(true)} aria-label="Takaisin valintaan"><Icon name="chevron-left" size={18} /></button>
            <span className={cx('vs-picked-icon k-merkitse-icon', `is-${look.tone}`)}><Icon name={look.icon} size={16} /></span>
            <span className="vs-picked-title">{kind === 'huomio' && asHomework ? 'Kotiläksy' : LABELS[kind]}</span>
            <button type="button" className="k-textlink" onClick={() => setChoosing(true)}>Vaihda</button>
          </div>
          <p className="vs-help"><Icon name={look.icon} size={15} />{k.help}</p>
        </div>

        <>
        <section className="vs-to" aria-label={attendance ? 'Mikä treeni' : 'Kenelle'}>
          <div className="vs-label">{attendance ? 'Mikä treeni · tänään' : 'Mille ryhmille'}</div>
          {attendance ? (
            shownChips.length === 0 ? (
              <div className="vs-empty">
                <p>Tänään ei ole treenejä. Aiempien treenien läsnäolon merkitset Viikkohallinnassa: mene siihen päivään, jonka haluat merkitä, ja avaa treeni.</p>
                <Button variant="dark" size="sm" icon="calendar" onClick={() => { track('merkitse.lasnaolo-viikkohallinta'); onClose(); navigate('/valmentaja/ryhmat'); }}>Avaa Viikkohallinta</Button>
              </div>
            ) : (
              <>
                <div className="vs-chips" role="group" aria-label="Valitse treeni">
                  {shownChips.map((c) => {
                    const on = attendChip?.key === c.key;
                    return (
                      <button key={c.key} type="button" aria-pressed={on} className={cx('vs-chip', on && 'is-on', c.status === 'now' && 'is-now')} onClick={() => toggleChip(c.key)}>
                        <span className="vs-chip-check" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                        <span className="vs-chip-when">{c.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{c.when}</span>
                        <span className="vs-chip-name">{c.name}</span>
                      </button>
                    );
                  })}
                </div>
                <p className="vs-note">Aiempien päivien läsnäolot: <button type="button" className="k-textlink" onClick={() => { onClose(); navigate('/valmentaja/ryhmat'); }}>Viikkohallinta</button> → päivä → treeni.</p>
              </>
            )
          ) : (
            <div className="vs-chips" role="group" aria-label="Valitse ryhmät">
              {[...cards.soon, ...((allTargets || cards.soon.length === 0) ? cards.rest : cards.rest.filter((x) => targets.includes(x.key)))].map((x) => {
                const on = targets.includes(x.key);
                return (
                  <button key={x.key} type="button" aria-pressed={on} className={cx('vs-chip', on && 'is-on', x.chip?.status === 'now' && 'is-now')} onClick={() => toggleTarget(x.key)}>
                    <span className="vs-chip-check" aria-hidden="true">{on && <Icon name="check" size={12} strokeWidth={3} />}</span>
                    <span className="vs-chip-when">{x.when}</span>
                    <span className="vs-chip-name">{x.name}</span>
                    <span className={cx('vs-chip-sub', x.chip && 'is-soon')}>{x.chip?.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{x.sub}</span>
                  </button>
                );
              })}
              {!allTargets && cards.soon.length > 0 && cards.rest.some((x) => !targets.includes(x.key)) && (
                <button type="button" className="vs-chip is-more" onClick={() => setAllTargets(true)}>
                  <span className="vs-chip-when"><Icon name="plus" size={13} /> {cards.rest.filter((x) => !targets.includes(x.key)).length} ryhmää</span>
                  <span className="vs-chip-name">Muut ryhmät</span>
                </button>
              )}
              {weekKeys.length > 1 && (
                <button type="button" aria-pressed={allWeek} className={cx('vs-chip', 'is-more', allWeek && 'is-on')} onClick={toggleWeek}>
                  <span className="vs-chip-when">Vko {week.week}</span>
                  <span className="vs-chip-name">Kaikki viikon ryhmät</span>
                </button>
              )}
              <button type="button" aria-pressed={pickerOpen} className={cx('vs-chip', 'is-more', pickerOpen && 'is-on')} onClick={() => {
                if (!pickerOpen && autoPicked.current) { autoPicked.current = false; setTargets([]); }
                setPickerOpen((v) => !v);
              }}>
                <span className="vs-chip-when"><Icon name="user" size={13} /> Yksittäin</span>
                <span className="vs-chip-name">Pelaaja…</span>
              </button>
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
              <RecipientPicker students={state.students} groups={[]} value={custom} onChange={setCustom} open={pickerOpen} boxed />
            </div>
          )}
        </section>

        {video ? (
          <p className="vs-note">Seuraavaksi valitset videon puhelimesta tai koneelta, tai liität linkin (esim. YouTube).</p>
        ) : attendance ? (
          attendChip && <AttendanceChips training={attendChip.training} source="merkitse" />
        ) : (
          <>
            <div className="stack-2">
              <label className="vs-label" htmlFor="merkinta-text">{kind === 'tiedote' ? 'Tiedote' : asHomework ? 'Kotiläksy' : 'Huomio'}</label>
              <Textarea id="merkinta-text" rows={3} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={asHomework && kind === 'huomio' ? 'Esim. 20 rystylyöntiä seinää vasten…' : k.placeholder} maxLength={kind === 'tiedote' ? 2000 : 4000} />
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
                  <button type="button" className={cx('vs-pill', !ids.length && 'is-incomplete')} disabled={busy}
                    onClick={() => { if (!ids.length) { toast('Valitse ensin ryhmät tai pelaajat.', { tone: 'info' }); return; } if (dirty) submit({ thenVideo: true }); else onVideo?.(ids); }}>
                    <Icon name="play" size={15} />{dirty ? 'Lähetä ja lisää video' : 'Lisää video'}
                  </button>
                </div>
                <p className="k-warn-text">{HEALTH_NOTE}</p>
              </div>
            )}
          </>
        )}
        </>
      </div>
      )}
    </Sheet>
  );
}
