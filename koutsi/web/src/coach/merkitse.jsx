// merkitse.jsx — the coach's "Merkitse": the big middle button of the phone tab bar (the side
// nav's button on a desktop) and everything it opens. The menu leads with today: every session
// side by side with where it stands (over, on now, to come), the one on now or just over — or
// the next — already picked, so the tiles below are for its players: a note, homework or a video
// for the ones who were there, its attendance. Tapping another session picks it instead (again
// unpicks it: then the tiles are for anyone). The day's summary shows once the last session is
// over, the week's on Sundays; the week's themes and the week diary are tiles too.
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
import { koutsiCurrentIsoWeek, koutsiFmtShortDate, koutsiTodayStr, koutsiWeekThemeStatus } from '../domain/core.js';
import {
  attendanceSession, dayRecap, merkitseContext, plannerDefaultWeek, presentPlayerIds, sessionStatus, todayTimeline, weekRecap,
} from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { groupPath, openPlanner, sessionPath } from './nav.js';
import { RecordSheet } from './RecordSheet.jsx';
import { DaySummarySheet } from './DaySummarySheet.jsx';
import { WeekRecapSheet } from './WeekRecapSheet.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const percent = (x) => `${Math.round(x * 100)} %`;
const average = (x) => x.toFixed(1).replace('.', ',');
const KIND_EVENT = { note: 'huomio', homework: 'laksy', video: 'video' };

const RecordContext = createContext(null);
/** { openMenu({ trainingId? }), open('note' | 'homework' | 'video', { ids, source: 'treeni' | 'ryhma' | 'pelaaja' }) } */
export function useRecord() {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error('useRecord must be used inside RecordProvider');
  return ctx;
}

const sessionName = (item) => item.group?.name || item.student?.name || item.training.type;
const forPlayers = (n) => (n === 1 ? '1 pelaajalle' : `${n} pelaajalle`);
const STRIP_STATE = { past: 'Ohi', now: 'Nyt', upcoming: 'Tulossa' };

/** The session the menu opens with: the one on now, just over or next today, else none. */
export function defaultPick(state, now = new Date()) {
  const ctx = merkitseContext(state, now);
  return ctx && (ctx.kind === 'now' || ctx.kind === 'ended' || ctx.kind === 'next') ? ctx.items[0].training.id : null;
}

/** Today's sessions side by side; the picked one is who the tiles below are for. */
function SessionStrip({ items, pickedId, onPick }) {
  const ref = useRef(null);
  // Keep the picked session in view when the strip is wider than the sheet.
  useEffect(() => {
    const box = ref.current;
    const chip = box?.querySelector('.is-picked');
    if (box && chip) box.scrollLeft = Math.max(0, chip.offsetLeft - box.offsetLeft - (box.clientWidth - chip.offsetWidth) / 2);
  }, [pickedId, items.length]);
  return (
    <div className="ms-strip" ref={ref} role="radiogroup" aria-label="Tämän päivän treenit">
      {items.map((it) => {
        const picked = it.training.id === pickedId;
        return (
          <button key={it.training.id} type="button" role="radio" aria-checked={picked}
            className={cx('ms-chip', `is-${it.status}`, picked && 'is-picked')} onClick={() => onPick(picked ? null : it.training.id)}>
            <span className="ms-chip-time t-num">{it.training.time}–{it.end}</span>
            <span className="ms-chip-name">{sessionName(it)}</span>
            <span className="ms-chip-state">{it.status === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{STRIP_STATE[it.status]}</span>
          </button>
        );
      })}
    </div>
  );
}

function SummaryCard({ eyebrow, title, sub, onOpen }) {
  return (
    <button type="button" className="k-ctx is-soft" onClick={onOpen}>
      <span className="k-ctx-main">
        <span className="k-ctx-eyebrow">{eyebrow}</span>
        <span className="k-ctx-title truncate">{title}</span>
        <span className="k-ctx-sub truncate">{sub}</span>
      </span>
      <Icon name="chevron-right" size={20} />
    </button>
  );
}

/** Once the day (or, on a Sunday, the week) is over: its summary. */
function SummaryCards({ state, ctx, now, onPick }) {
  if (!ctx || (ctx.kind !== 'day' && ctx.kind !== 'week')) return null;
  if (ctx.kind === 'day') {
    const today = koutsiTodayStr();
    const recap = dayRecap(state, today, now);
    const parts = [recap.expected ? `Läsnä ${recap.present}/${recap.expected}` : '', recap.moodAverage != null ? `fiilis ${average(recap.moodAverage)} (${recap.moodCount})` : 'ei fiiliksiä vielä'].filter(Boolean);
    return (
      <SummaryCard eyebrow="Päivän yhteenveto" title={`Tänään ${recap.sessions === 1 ? '1 treeni' : `${recap.sessions} treeniä`}`} sub={parts.join(' · ')}
        onOpen={() => { track('merkitse.paiva'); onPick({ kind: 'day', date: today }); }} />
    );
  }
  const week = koutsiCurrentIsoWeek();
  const recap = weekRecap(state, week, now);
  const sub = recap.sessions
    ? [`${recap.held}/${recap.sessions} treeniä`, recap.attendance != null ? `läsnä ${percent(recap.attendance)}` : '', recap.moodAverage != null ? `fiilis ${average(recap.moodAverage)}` : ''].filter(Boolean).join(' · ')
    : 'Ei treenejä tällä viikolla · kirjaa viikkopäiväkirja';
  return (
    <SummaryCard eyebrow="Viikon yhteenveto" title={`Viikko ${week.week} paketissa`} sub={sub}
      onOpen={() => { track('merkitse.viikko'); onPick({ kind: 'week', week }); }} />
  );
}

function MerkitseSheet({ open, onClose, onPick, pickedId, onPickSession }) {
  const { state } = useData();
  const nowMs = useNow(30_000);
  const now = new Date(nowMs);
  const ctx = merkitseContext(state, now);
  const today = todayTimeline(state, now);
  const picked = today.find((it) => it.training.id === pickedId) || null;
  // Default "Läsnäolo" (nothing picked): the session on now or just over, else today's latest held one.
  const attend = picked || attendanceSession(state, now);
  const themeWeek = plannerDefaultWeek(now);
  const themes = koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek);
  // A note for a session is most likely for the players who were there (or are coming).
  const preset = picked ? presentPlayerIds(state, picked.training) : [];
  const recordSub = picked ? forPlayers(preset.length) : 'Yhdelle tai koko ryhmälle';
  const attendSub = !attend ? 'Ei treeniä tänään'
    : `${sessionStatus(attend.training, attend.group, now) === 'now' ? 'Nyt' : `klo ${attend.training.time}`} · ${sessionName(attend)}`;
  const tiles = [
    { id: 'teemat', icon: 'sparkles', tone: 'lime', title: 'Viikon teemat',
      sub: themes.pool.length ? `${themes.covered}/${themes.pool.length} ryhmällä · vko ${themeWeek.week}` : 'Usealle ryhmälle kerralla',
      run: () => { onClose(); openPlanner({ week: themeWeek }); } },
    { id: 'huomio', icon: 'chat', tone: 'blue', title: 'Huomio', sub: recordSub, run: () => onPick({ kind: 'note', ids: preset }) },
    { id: 'laksy', icon: 'check-circle', tone: 'green', title: 'Kotiläksy', sub: recordSub, run: () => onPick({ kind: 'homework', ids: preset }) },
    { id: 'video', icon: 'play', tone: 'clay', title: 'Video', sub: recordSub, run: () => onPick({ kind: 'video', ids: preset }) },
    { id: 'lasnaolo', icon: 'user-check', tone: 'sand', title: 'Läsnäolo', sub: attendSub,
      run: () => { onClose(); navigate(attend ? sessionPath(attend.training.id) : '/valmentaja/kalenteri'); } },
    { id: 'paivakirja', icon: 'book', tone: 'ink', title: 'Viikkopäiväkirja', sub: 'Vain sinulle', run: () => onPick({ kind: 'week', week: koutsiCurrentIsoWeek() }) },
  ];
  const openGroup = () => { track('merkitse.ryhma'); onClose(); navigate(groupPath(picked.group.id), { state: { tab: 'ryhmat' } }); };
  return (
    <Sheet open={open} onClose={onClose} title="Mitä kirjataan?" size="md">
      <div className="stack-4">
        {today.length > 0 && (
          <div className="ms-today">
            <div className="ms-today-head">
              <span className="eyebrow">Tänään · {koutsiFmtShortDate(koutsiTodayStr())}</span>
              <span className="ms-today-count">{today.length === 1 ? '1 treeni' : `${today.length} treeniä`}</span>
            </div>
            <SessionStrip items={today} pickedId={pickedId} onPick={(id) => { track('merkitse.valitse'); onPickSession(id); }} />
            <p className="ms-picked">
              {picked ? (
                <>
                  <span className="grow">Kirjaat treeniin <strong>{sessionName(picked)}</strong> · {preset.length === 1 ? '1 pelaaja' : `${preset.length} pelaajaa`}</span>
                  {picked.group && <button type="button" className="k-textlink" onClick={openGroup}>Avaa ryhmä</button>}
                </>
              ) : <span className="grow">Valitse treeni, niin kirjaus menee sen pelaajille.</span>}
            </p>
          </div>
        )}
        <SummaryCards state={state} ctx={ctx} now={now} onPick={onPick} />
        <div className="k-merkitse-grid">
          {tiles.map((t) => (
            <button key={t.id} type="button" className="k-merkitse-tile" onClick={() => { track(`merkitse.${t.id}`); t.run(); }}>
              <span className={cx('k-merkitse-icon', `is-${t.tone}`)}><Icon name={t.icon} size={22} /></span>
              <span className="k-merkitse-title">{t.title}</span>
              <span className="k-merkitse-sub">{t.sub}</span>
            </button>
          ))}
        </div>
      </div>
    </Sheet>
  );
}

export function RecordProvider({ children }) {
  const { state, reload } = useData();
  const { coachId } = useCoach();
  const toast = useToast();
  const route = useRoute();
  // { kind: 'menu' | 'note' | 'homework' | 'video' | 'day' | 'week', ids?, date?, week?, trainingId? }
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

  const open = useCallback((kind, { ids = [], source } = {}) => {
    if (source) track(`${source}.${KIND_EVENT[kind]}`);
    setSheet({ kind, ids });
  }, []);
  // The menu opens on the session asked for, else the one on now, just over or next today.
  const stateRef = useRef(state);
  stateRef.current = state;
  const openMenu = useCallback(({ trainingId } = {}) => {
    track('merkitse.avaa');
    setSheet({ kind: 'menu', trainingId: trainingId || defaultPick(stateRef.current) });
  }, []);
  const pickSession = useCallback((trainingId) => setSheet((s) => (s?.kind === 'menu' ? { ...s, trainingId } : s)), []);

  // The video sheet shows a failed upload itself (and keeps the form), so no toast for errors.
  const shareVideo = async (payload) => {
    await api.videos.share({ ...payload, addedById: coachId });
    await reload().catch(() => {});
    const n = payload.studentIds.length;
    toast(n > 1 ? `Video jaettu ${n} pelaajalle.` : 'Video jaettu.');
    track('tallennettu.video');
    if (n > 1) track('tallennettu.video-monelle');
  };

  const value = useMemo(() => ({ open, openMenu }), [open, openMenu]);
  const kind = sheet?.kind;
  return (
    <RecordContext.Provider value={value}>
      {children}
      <MerkitseSheet open={kind === 'menu'} onClose={close} onPick={setSheet} pickedId={last.current.menu?.trainingId || null} onPickSession={pickSession} />
      <RecordSheet open={kind === 'note' || kind === 'homework'} kind={last.current.record?.kind || 'note'} initialIds={sheet?.ids || []} onClose={close} />
      <VideoShareSheet open={kind === 'video'} onClose={close} recipients={state.students} initialIds={sheet?.ids || []} groups={state.groups} onSave={shareVideo} />
      <DaySummarySheet open={kind === 'day'} date={last.current.day?.date} onClose={close} />
      <WeekRecapSheet open={kind === 'week'} week={last.current.week?.week} onClose={close} />
    </RecordContext.Provider>
  );
}
