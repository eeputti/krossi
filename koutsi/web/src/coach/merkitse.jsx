// merkitse.jsx — the coach's "Merkitse": the big middle button of the phone tab bar (the side
// nav's button on a desktop) and everything it opens. The menu leads with today: every session
// side by side with where it stands (over, on now, to come), the one on now or just over — or
// the next — already picked, so the four tiles below say and do it for its group: "Huomio
// ryhmälle", "Kotiläksy ryhmälle", "Video ryhmälle" (the players who were there) and its
// Läsnäolo, with "Avaa koko ryhmä" under them. A tap adds a session to the picked ones or takes
// it off, so one note can go to two or three groups at once ("Huomio ryhmille"); "Koko viikon
// ryhmät" under the strip picks every group with a session this week instead. Nothing picked:
// the tiles are for anyone the coach chooses. Läsnäolo stays one session's: with several picked
// it asks which. The rarer things sit below as small "Muut" rows: the day's or week's summary
// when it is due, the week's themes, the diary.
//
// RecordProvider also lets any page open the note/homework/video sheets with players picked
// (a session's players, a group's members, one player): useRecord().open('note', { ids }), and
// the menu with a session picked: useRecord().openMenu({ trainingId }).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useNow } from '../app/hooks.js';
import { navigate, useRoute } from '../app/router.js';
import { Icon, Sheet, useToast } from '../ui/index.js';
import { VideoShareSheet } from '../shared/videos.jsx';
import { groupsCovering, libraryItems, libraryLine } from '../domain/sends.js';
import { koutsiCurrentIsoWeek, koutsiFmtShortDate, koutsiTodayStr, koutsiWeekThemeStatus } from '../domain/core.js';
import {
  attendanceSession, dayRecap, groupMemberIds, merkitseContext, plannerDefaultWeek, presentPlayerIdsOf, sessionStatus, todayTimeline,
  weekGroups, weekRecap,
} from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath, openPlanner, sessionPath } from './nav.js';
import { RecordSheet } from './RecordSheet.jsx';
import { MerkintaSheet } from './MerkintaSheet.jsx';
import { ContinueThemesSheet } from './ContinueThemesSheet.jsx';
import { AbsencePickerSheet } from './AbsencePlanner.jsx';
import { DaySummarySheet } from './DaySummarySheet.jsx';
import { WeekRecapSheet } from './WeekRecapSheet.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const percent = (x) => `${Math.round(x * 100)} %`;
const average = (x) => x.toFixed(1).replace('.', ',');
const KIND_EVENT = { note: 'huomio', homework: 'laksy', video: 'video' };

const RecordContext = createContext(null);
/**
 * { openMenu({ trainingId? }), open('note' | 'homework' | 'video', { ids, source: 'treeni' | 'ryhma' | 'pelaaja' | 'harjoite' | 'viikko', text?, scope? }),
 *   openMerkinta({ trainingId?, ids?, kind?, groupIds?, date? }), openContinue(week) }
 * scope ({ name, text, icon }) shows on top of the form which group or session it is for.
 */
export function useRecord() {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error('useRecord must be used inside RecordProvider');
  return ctx;
}

const sessionName = (item) => item.group?.name || item.student?.name || item.training.type;
// A count and its word never part at a line break.
const playersLabel = (n) => (n === 1 ? '1\u00a0pelaaja' : `${n}\u00a0pelaajaa`);
const groupsLabel = (n) => (n === 1 ? '1\u00a0ryhmä' : `${n}\u00a0ryhmää`);
const STRIP_STATE = { past: 'Ohi', now: 'Nyt', upcoming: 'Tulossa' };

/** The session the menu opens with: the one on now, just over or next today, else none. */
export function defaultPick(state, now = new Date()) {
  const ctx = merkitseContext(state, now);
  return ctx && (ctx.kind === 'now' || ctx.kind === 'ended' || ctx.kind === 'next') ? ctx.items[0].training.id : null;
}

/** Today's sessions side by side; a tap picks one more or takes it off. focusId: kept in view. */
function SessionStrip({ items, pickedIds, focusId, onToggle }) {
  const ref = useRef(null);
  // Keep the session the menu opened on in view when the strip is wider than the sheet — not
  // the one just tapped, so the strip doesn't jump under the coach's finger.
  useEffect(() => {
    const box = ref.current;
    const chip = focusId && box?.querySelector(`[data-id="${focusId}"]`);
    if (box && chip) box.scrollLeft = Math.max(0, chip.offsetLeft - box.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2);
  }, [focusId, items.length]);
  return (
    <div className="ms-strip" ref={ref} role="group" aria-label="Tämän päivän treenit">
      {items.map((it) => {
        const picked = pickedIds.includes(it.training.id);
        return (
          <button key={it.training.id} type="button" data-id={it.training.id} aria-pressed={picked}
            className={cx('ms-chip', `is-${it.status}`, picked && 'is-picked')} onClick={() => onToggle(it.training.id)}>
            <span className="ms-chip-check" aria-hidden="true">{picked && <Icon name="check" size={12} />}</span>
            <span className="ms-chip-time t-num">{it.training.time}–{it.end}</span>
            <span className="ms-chip-name">{sessionName(it)}</span>
            <span className="ms-chip-state">{it.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{STRIP_STATE[it.status]}</span>
          </button>
        );
      })}
    </div>
  );
}

// The tiles' names say who a record is for: the picked session's group (or its one player),
// the picked groups (or players), the week's groups, or — nothing picked — anyone the coach
// chooses next.
const TITLES = {
  group: { huomio: 'Huomio ryhmälle', laksy: 'Kotiläksy ryhmälle', video: 'Video ryhmälle' },
  player: { huomio: 'Huomio pelaajalle', laksy: 'Kotiläksy pelaajalle', video: 'Video pelaajalle' },
  groups: { huomio: 'Huomio ryhmille', laksy: 'Kotiläksy ryhmille', video: 'Video ryhmille' },
  players: { huomio: 'Huomio pelaajille', laksy: 'Kotiläksy pelaajille', video: 'Video pelaajille' },
  week: { huomio: 'Huomio viikon ryhmille', laksy: 'Kotiläksy viikon ryhmille', video: 'Video viikon ryhmille' },
  any: { huomio: 'Huomio', laksy: 'Kotiläksy', video: 'Video' },
};

/**
 * Who the tiles are for → { ids, titles, sub, picked, groups }: the week's groups, or the picked
 * sessions' players (those there or coming, each once), or nobody yet.
 */
function recordTarget(state, today, pickedIds, week) {
  if (week) {
    const ids = groupMemberIds(state, week.groups);
    return { ids, titles: TITLES.week, sub: `${groupsLabel(week.groups.length)} · ${playersLabel(ids.length)}`, picked: [], groups: [] };
  }
  const picked = today.filter((it) => pickedIds.includes(it.training.id));
  if (!picked.length) return { ids: [], titles: TITLES.any, sub: 'Yhdelle pelaajalle tai ryhmälle', picked, groups: [] };
  const ids = presentPlayerIdsOf(state, picked.map((it) => it.training));
  // A group picked twice (two sessions today) is still one group.
  const groups = [...new Map(picked.filter((it) => it.group).map((it) => [it.group.id, it])).values()];
  const privates = new Set(picked.filter((it) => !it.group && it.student).map((it) => it.student.id));
  if (groups.length + privates.size <= 1) {
    const one = picked[0];
    return { ids, titles: one.group ? TITLES.group : TITLES.player, sub: one.group ? playersLabel(ids.length) : sessionName(one), picked, groups };
  }
  const count = privates.size ? `${picked.length} treeniä` : groupsLabel(groups.length);
  return { ids, titles: groups.length ? TITLES.groups : TITLES.players, sub: `${count} · ${playersLabel(ids.length)}`, picked, groups };
}

/** Which session's Läsnäolo to open, when the picked ones leave a choice. */
function AttendancePicker({ open, items, onPick, onClose }) {
  return (
    <Sheet open={open} onClose={onClose} title="Läsnäolo" subtitle="Minkä treenin läsnäolon kirjaat?" size="sm">
      <div className="ms-others-list">
        {items.map((it) => (
          <button key={it.training.id} type="button" className="ms-row" onClick={() => onPick(it)}>
            <span className="ms-row-icon"><Icon name="user-check" size={16} /></span>
            <span className="ms-row-main">
              <span className="ms-row-title">{sessionName(it)}</span>
              <span className="ms-row-sub">{it.training.time}–{it.end} · {STRIP_STATE[it.status]}</span>
            </span>
            <Icon name="chevron-right" size={16} className="k-chevron" />
          </button>
        ))}
      </div>
    </Sheet>
  );
}

/** Once the day (or, on a Sunday, the week) is over: its summary, as one of the "Muut" rows. */
function summaryRow(state, ctx, now, onPick) {
  if (!ctx || (ctx.kind !== 'day' && ctx.kind !== 'week')) return null;
  if (ctx.kind === 'day') {
    const today = koutsiTodayStr();
    const recap = dayRecap(state, today, now);
    const parts = [recap.expected ? `Läsnä ${recap.present}/${recap.expected}` : '', recap.moodAverage != null ? `fiilis ${average(recap.moodAverage)} (${recap.moodCount})` : 'ei fiiliksiä vielä'].filter(Boolean);
    return { id: 'paiva', icon: 'check-circle', title: 'Päivän yhteenveto', sub: parts.join(' · '), run: () => onPick({ kind: 'day', date: today }) };
  }
  const week = koutsiCurrentIsoWeek();
  const recap = weekRecap(state, week, now);
  const sub = recap.sessions
    ? [`${recap.held}/${recap.sessions} treeniä`, recap.attendance != null ? `läsnä ${percent(recap.attendance)}` : '', recap.moodAverage != null ? `fiilis ${average(recap.moodAverage)}` : ''].filter(Boolean).join(' · ')
    : 'Ei treenejä tällä viikolla';
  return { id: 'viikko', icon: 'trophy', title: `Viikko ${week.week} paketissa`, sub, run: () => onPick({ kind: 'week', week }) };
}

function MerkitseSheet({ open, onClose, onPick, pickedIds, week: weekOn, focusId, onToggleSession, onToggleWeek }) {
  const { state } = useData();
  const nowMs = useNow(30_000);
  const now = new Date(nowMs);
  const ctx = merkitseContext(state, now);
  const today = todayTimeline(state, now);
  const [attendOpen, setAttendOpen] = useState(false);
  useEffect(() => { if (!open) setAttendOpen(false); }, [open]);
  const thisWeek = koutsiCurrentIsoWeek();
  const groupsThisWeek = weekGroups(state, thisWeek);
  const week = weekOn && groupsThisWeek.length ? { groups: groupsThisWeek } : null;
  const target = recordTarget(state, today, pickedIds, week);
  const { picked } = target;
  // Läsnäolo is one session's: the picked one; with several picked (or the week) the coach
  // chooses which; nothing picked, the one on now or just over, else today's latest held one.
  const attendChoices = week ? today : picked.length > 1 ? picked : [];
  const attend = picked.length === 1 ? picked[0] : !week && !picked.length ? attendanceSession(state, now) : null;
  const themeWeek = plannerDefaultWeek(now);
  const themes = koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek);
  const attendNow = attend && sessionStatus(attend.training, attend.group, now) === 'now';
  const attendSub = attendChoices.length > 1 ? 'Valitse treeni'
    : attendChoices.length === 1 ? `klo ${attendChoices[0].training.time} · ${sessionName(attendChoices[0])}`
      : !attend ? 'Ei treeniä tänään'
        : picked.length ? (attendNow ? 'Nyt käynnissä' : `klo ${attend.training.time}`)
          : `${attendNow ? 'Nyt' : `klo ${attend.training.time}`} · ${sessionName(attend)}`;
  const openAttendance = (it) => { onClose(); navigate(it ? sessionPath(it.training.id) : '/valmentaja/ryhmat'); };
  const preset = target.ids;
  const tiles = [
    { id: 'huomio', icon: 'chat', tone: 'blue', title: target.titles.huomio, sub: target.sub, run: () => onPick({ kind: 'note', ids: preset }) },
    { id: 'laksy', icon: 'check-circle', tone: 'green', title: target.titles.laksy, sub: target.sub, run: () => onPick({ kind: 'homework', ids: preset }) },
    { id: 'video', icon: 'play', tone: 'clay', title: target.titles.video, sub: target.sub, run: () => onPick({ kind: 'video', ids: preset }) },
    { id: 'lasnaolo', icon: 'user-check', tone: 'sand', title: 'Läsnäolo', sub: attendSub,
      run: () => (attendChoices.length > 1 ? setAttendOpen(true) : openAttendance(attendChoices[0] || attend)) },
  ];
  const others = [
    summaryRow(state, ctx, now, onPick),
    { id: 'teemat', icon: 'sparkles', title: 'Viikon teemat',
      sub: themes.pool.length ? `${themes.covered}/${themes.pool.length} ryhmällä · vko ${themeWeek.week}` : 'Usealle ryhmälle kerralla',
      run: () => { onClose(); openPlanner({ week: themeWeek }); } },
    { id: 'paivakirja', icon: 'book', title: 'Oma viikkomuistio', sub: 'Vain sinulle', run: () => onPick({ kind: 'week', week: koutsiCurrentIsoWeek() }) },
  ].filter(Boolean);
  const openGroup = (group) => { track('merkitse.ryhma'); onClose(); navigate(groupPath(group.id), { state: { tab: 'ryhmat' } }); };
  const weekPlayers = week ? preset.length : groupMemberIds(state, groupsThisWeek).length;
  return (
    <Sheet open={open} onClose={onClose} title="Mitä kirjataan?" size="md">
      <div className="stack-4">
        {(today.length > 0 || groupsThisWeek.length > 0) && (
          <div className="ms-today">
            {today.length > 0 && (
              <>
                <div className="ms-today-head">
                  <span className="eyebrow">Tänään · {koutsiFmtShortDate(koutsiTodayStr())}</span>
                  <span className="ms-today-count">{picked.length > 1 ? `${picked.length} valittu` : today.length === 1 ? '1 treeni' : `${today.length} treeniä`}</span>
                </div>
                <SessionStrip items={today} pickedIds={week ? [] : pickedIds} focusId={focusId}
                  onToggle={(id) => {
                    track('merkitse.valitse');
                    if (!week && !pickedIds.includes(id) && picked.length >= 1) track('merkitse.monta');
                    onToggleSession(id);
                  }} />
              </>
            )}
            {groupsThisWeek.length > 0 && (
              <button type="button" className={cx('ms-week', week && 'is-on')} aria-pressed={Boolean(week)}
                onClick={() => { if (!week) track('merkitse.koko-viikko'); onToggleWeek(); }}>
                <span className="ms-week-icon"><Icon name="calendar" size={18} /></span>
                <span className="ms-row-main">
                  <span className="ms-row-title">Koko viikon ryhmät</span>
                  <span className="ms-row-sub">Vko {thisWeek.week} · {groupsLabel(groupsThisWeek.length)} · {playersLabel(weekPlayers)}</span>
                </span>
                <span className="ms-week-check" aria-hidden="true">{week && <Icon name="check" size={14} />}</span>
              </button>
            )}
            {today.length > 0 && !picked.length && !week && <p className="ms-hint">Valitse yksi tai useampi treeni, niin kirjaus menee suoraan niiden pelaajille.</p>}
          </div>
        )}
        <div className="ms-grid">
          {tiles.map((t) => (
            <button key={t.id} type="button" className="k-merkitse-tile ms-tile" onClick={() => { track(`merkitse.${t.id}`); t.run(); }}>
              <span className={cx('k-merkitse-icon', `is-${t.tone}`)}><Icon name={t.icon} size={22} /></span>
              <span className="k-merkitse-title">{t.title}</span>
              <span className="k-merkitse-sub">{t.sub}</span>
            </button>
          ))}
        </div>
        {target.groups.length > 0 && (
          <div className="ms-open-groups">
            {target.groups.map((it) => (
              <button key={it.group.id} type="button" className="ms-open-group" onClick={() => openGroup(it.group)}>
                <span className="ms-open-group-icon"><Icon name="users" size={18} /></span>
                <span className="ms-row-main">
                  <span className="ms-row-title">{target.groups.length === 1 ? 'Avaa koko ryhmä' : 'Avaa ryhmä'}</span>
                  <span className="ms-row-sub">{target.groups.length === 1 ? it.group.name : `${it.training.time} · ${it.group.name}`}</span>
                </span>
                <Icon name="chevron-right" size={18} className="k-chevron" />
              </button>
            ))}
          </div>
        )}
        <section className="ms-others" aria-label="Muut">
          <div className="eyebrow">Muut</div>
          <div className="ms-others-list">
            {others.map((o) => (
              <button key={o.id} type="button" className="ms-row" onClick={() => { track(`merkitse.${o.id}`); o.run(); }}>
                <span className="ms-row-icon"><Icon name={o.icon} size={16} /></span>
                <span className="ms-row-main">
                  <span className="ms-row-title">{o.title}</span>
                  <span className="ms-row-sub">{o.sub}</span>
                </span>
                <Icon name="chevron-right" size={16} className="k-chevron" />
              </button>
            ))}
          </div>
        </section>
      </div>
      <AttendancePicker open={open && attendOpen} items={attendChoices} onClose={() => setAttendOpen(false)}
        onPick={(it) => { setAttendOpen(false); openAttendance(it); }} />
    </Sheet>
  );
}

export function RecordProvider({ children }) {
  const { state, reload } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const route = useRoute();
  // { kind: 'menu' | 'note' | 'homework' | 'video' | 'day' | 'week', ids?, date?, week?,
  //   menu only: trainingIds (the picked sessions), allWeek (the week's groups), focusId }
  const [sheet, setSheet] = useState(null);
  // The last of each kind stays while its sheet animates away (sheet is already null then).
  const last = useRef({});
  if (sheet) last.current = { ...last.current, [sheet.kind]: sheet, ...(sheet.kind === 'note' || sheet.kind === 'homework' ? { record: sheet } : {}) };
  const close = useCallback(() => setSheet(null), []);

  // A tap that leads to another page (a session, the planner) leaves the menu and the day's
  // summary behind; a half-written note stays.
  useEffect(() => {
    setSheet((s) => (s && (s.kind === 'menu' || s.kind === 'day' || s.kind === 'week') ? null : s));
  }, [route.path]);

  // allowEmpty (video): "Lisää video" on the Videot tab — saving with nobody picked keeps it in the coach's videos
  const open = useCallback((kind, { ids = [], source, text = '', scope = null, allowEmpty = false } = {}) => {
    if (source) track(`${source}.${KIND_EVENT[kind]}`);
    setSheet({ kind, ids, text, scope, allowEmpty });
  }, []);
  // The menu opens on the session asked for, else the one on now, just over or next today.
  const stateRef = useRef(state);
  stateRef.current = state;
  const menuAt = (trainingId) => {
    const id = trainingId || defaultPick(stateRef.current);
    return { kind: 'menu', trainingIds: id ? [id] : [], allWeek: false, focusId: id };
  };
  const openMenu = useCallback(({ trainingId } = {}) => {
    track('merkitse.avaa');
    setSheet(menuAt(trainingId));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // A tap on a session adds it or takes it off (and leaves the week's groups); the week button
  // picks the week's groups instead, and a second tap goes back to where the menu opened.
  const toggleSession = useCallback((id) => setSheet((s) => {
    if (s?.kind !== 'menu') return s;
    const ids = s.allWeek ? [] : s.trainingIds;
    return { ...s, allWeek: false, trainingIds: ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id] };
  }), []);
  const toggleWeek = useCallback(() => setSheet((s) => {
    if (s?.kind !== 'menu') return s;
    return s.allWeek ? menuAt() : { ...s, allWeek: true, trainingIds: [] };
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // The video sheet shows a failed upload itself (and keeps the form), so no toast for errors.
  // With Lähetetyt (state.sendsReady) every video goes to the coach's own videos first (the sheet's
  // shareId is its id, so a retry doesn't upload twice) and is then shared from there; a picked one
  // from "Omista videoista" is only shared.
  const shareVideo = async (payload) => {
    const n = payload.studentIds.length;
    if (state.sendsReady) {
      const videoId = payload.savedId || await api.videos.save({
        coachId, id: payload.shareId, title: payload.title, tags: payload.tags, file: payload.file, externalUrl: payload.externalUrl,
        onProgress: payload.onProgress, signal: payload.signal,
      });
      if (n) await api.videos.shareSaved({ coachId, videoId, studentIds: payload.studentIds, groupIds: groupsCovering(state.groups, payload.studentIds), date: payload.date });
    } else {
      await api.videos.share({ ...payload, addedById: coachId });
    }
    // like run(): the sheet closes once the list has caught up, or after 1.5 s on a slow connection
    await Promise.race([reload().catch(() => {}), new Promise((r) => setTimeout(r, 1500))]);
    toast(n === 0 ? 'Video tallennettu Videoihin.' : n > 1 ? `Video jaettu ${n} pelaajalle.` : 'Video jaettu.');
    track(n === 0 ? 'tallennettu.video-omiin' : payload.savedId ? 'tallennettu.video-omista' : 'tallennettu.video');
    if (n > 1) track('tallennettu.video-monelle');
  };
  const library = useMemo(() => (state.sendsReady ? libraryItems(state).map((v) => ({ ...v, line: libraryLine(state, v) })) : null), [state]);

  // EHDOTUS: the new Merkitse (MerkintaSheet.jsx) — a Tiedote, a Huomio or the Läsnäolo, for a
  // session's players (trainingId), some players (ids) or whoever the coach picks.
  const openMerkinta = useCallback(({ trainingId = null, ids = [], kind = null, groupIds = [], date = null } = {}) => {
    track('viesti.avaa');
    setSheet({ kind: 'viesti', trainingId, ids, messageKind: kind, groupIds, date });
  }, []);

  // "Jatka edellisillä": every group's own previous theme, editable before saving (ContinueThemesSheet)
  const openContinue = useCallback((week) => { track('teemat.jatka-avaa'); setSheet({ kind: 'continue', week }); }, []);
  const value = useMemo(() => ({ open, openMenu, openMerkinta, openContinue }), [open, openMenu, openMerkinta, openContinue]);
  const kind = sheet?.kind;
  return (
    <RecordContext.Provider value={value}>
      {children}
      <MerkintaSheet open={kind === 'viesti'} onClose={close} trainingId={last.current.viesti?.trainingId || null}
        initialIds={last.current.viesti?.ids || []} initialKind={last.current.viesti?.messageKind || null}
        initialGroupIds={last.current.viesti?.groupIds || []} focusDate={last.current.viesti?.date || null}
        onVideo={(ids) => setSheet({ kind: 'video', ids })}
        onDay={(date) => setSheet({ kind: 'day', date })} onWeek={(week) => setSheet({ kind: 'week', week })} onAbsence={() => setSheet({ kind: 'absence' })} />
      <MerkitseSheet open={kind === 'menu'} onClose={close} onPick={setSheet} pickedIds={last.current.menu?.trainingIds || []}
        week={Boolean(last.current.menu?.allWeek)} focusId={last.current.menu?.focusId || null}
        onToggleSession={toggleSession} onToggleWeek={toggleWeek} />
      <RecordSheet open={kind === 'note' || kind === 'homework'} kind={last.current.record?.kind || 'note'} initialIds={sheet?.ids || []} initialText={sheet?.text || ''}
        scope={last.current.record?.scope || null} onClose={close} />
      <VideoShareSheet open={kind === 'video'} onClose={close} recipients={state.students} initialIds={sheet?.ids || []} groups={state.groups} onSave={shareVideo}
        scope={last.current.video?.scope || null} library={library} allowEmpty={Boolean(last.current.video?.allowEmpty) && Boolean(state.sendsReady)}
        title={last.current.video?.allowEmpty && state.sendsReady ? 'Lisää video' : 'Jaa video'} />
      <DaySummarySheet open={kind === 'day'} date={last.current.day?.date} onClose={close} />
      <WeekRecapSheet open={kind === 'week'} week={last.current.week?.week} onClose={close} />
      <ContinueThemesSheet open={kind === 'continue'} week={last.current.continue?.week || null} onClose={close} />
      <AbsencePickerSheet open={kind === 'absence'} onClose={close} />
    </RecordContext.Provider>
  );
}
