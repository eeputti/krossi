// merkitse.jsx — the coach's "Merkitse": the big middle button of the phone tab bar (the side
// nav's button on a desktop) and everything it opens. The menu leads with what is happening
// today — the session on now or just over (one tap opens it), the next one, the day's summary
// once the last session is over, the week's on Sundays — and then six tiles: the week's themes,
// a note, homework or a video for one player or a whole group, attendance and the week diary.
//
// RecordProvider also lets any page open the note/homework/video sheets with players picked
// (a session's players, a group's members, one player): useRecord().open('note', { ids }).
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useNow } from '../app/hooks.js';
import { navigate, useRoute } from '../app/router.js';
import { Icon, Sheet, useToast } from '../ui/index.js';
import { VideoShareSheet } from '../shared/videos.jsx';
import {
  koutsiCurrentIsoWeek, koutsiThemeForDate, koutsiTimeRangeLabel, koutsiTodayStr, koutsiWeekThemeStatus,
} from '../domain/core.js';
import {
  attendanceSession, dayRecap, merkitseContext, plannerDefaultWeek, presentPlayerIds, sessionRoster, sessionStatus, weekRecap,
} from '../domain/week.js';
import { useCoach } from './CoachRoot.jsx';
import { openPlanner, sessionPath } from './nav.js';
import { RecordSheet } from './RecordSheet.jsx';
import { DaySummarySheet } from './DaySummarySheet.jsx';
import { WeekRecapSheet } from './WeekRecapSheet.jsx';
import { track } from './usage.js';

const cx = (...c) => c.filter(Boolean).join(' ');
const percent = (x) => `${Math.round(x * 100)} %`;
const average = (x) => x.toFixed(1).replace('.', ',');
const KIND_EVENT = { note: 'huomio', homework: 'laksy', video: 'video' };

const RecordContext = createContext(null);
/** { openMenu(), open('note' | 'homework' | 'video', { ids, source: 'treeni' | 'ryhma' | 'pelaaja' }) } */
export function useRecord() {
  const ctx = useContext(RecordContext);
  if (!ctx) throw new Error('useRecord must be used inside RecordProvider');
  return ctx;
}

const sessionName = (item) => item.group?.name || item.student?.name || item.training.type;

/** One of today's sessions as the menu's lead card; a tap opens the session. */
function SessionCard({ state, item, kind, now, onOpen }) {
  const { training, group } = item;
  const roster = sessionRoster(state, training);
  const absent = (training.absences || []).length;
  const theme = group ? koutsiThemeForDate(group, training.date) : null;
  const eyebrow = kind === 'now' ? 'Käynnissä nyt' : kind === 'ended' ? 'Juuri päättyi' : 'Seuraavaksi tänään';
  const who = kind === 'ended' && roster.length
    ? `Läsnä ${roster.length - absent}/${roster.length}`
    : `${roster.length === 1 ? '1 pelaaja' : `${roster.length} pelaajaa`}${absent ? ` · ${absent} poissa` : ''}`;
  return (
    <button type="button" className={cx('k-ctx', kind === 'next' ? 'is-soft' : 'is-strong')} onClick={onOpen}>
      <span className="k-ctx-main">
        <span className="k-ctx-eyebrow">{kind === 'now' && sessionStatus(training, group, now) === 'now' && <span className="k-ctx-live" aria-hidden="true" />}{eyebrow}</span>
        <span className="k-ctx-title truncate">{sessionName(item)}</span>
        <span className="k-ctx-sub truncate">klo {koutsiTimeRangeLabel(training.time, training.durationMinutes || group?.durationMinutes)} · {who}{theme ? ` · ${theme.title}` : ''}</span>
      </span>
      <Icon name="chevron-right" size={20} />
    </button>
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

function ContextCards({ state, ctx, now, onPick, onClose }) {
  if (!ctx) return null;
  const event = { now: 'merkitse.nyt', ended: 'merkitse.paattyi', next: 'merkitse.seuraava' }[ctx.kind];
  if (event) {
    return (
      <div className="k-ctx-list">
        {ctx.items.map((item) => (
          <SessionCard key={item.training.id} state={state} item={item} kind={ctx.kind} now={now}
            onOpen={() => { track(event); onClose(); navigate(sessionPath(item.training.id)); }} />
        ))}
      </div>
    );
  }
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

function MerkitseSheet({ open, onClose, onPick }) {
  const { state } = useData();
  const nowMs = useNow(30_000);
  const now = new Date(nowMs);
  const ctx = merkitseContext(state, now);
  const attend = attendanceSession(state, now);
  const themeWeek = plannerDefaultWeek(now);
  const themes = koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek);
  // After (or during) a session, a note is most likely for the players who were there.
  const preset = ctx && (ctx.kind === 'now' || ctx.kind === 'ended') ? presentPlayerIds(state, ctx.items[0].training) : [];
  const attendSub = !attend ? 'Ei treeniä tänään'
    : `${sessionStatus(attend.training, attend.group, now) === 'now' ? 'Nyt' : `klo ${attend.training.time}`} · ${sessionName(attend)}`;
  const tiles = [
    { id: 'teemat', icon: 'sparkles', tone: 'lime', title: 'Viikon teemat',
      sub: themes.pool.length ? `${themes.covered}/${themes.pool.length} ryhmällä · vko ${themeWeek.week}` : 'Usealle ryhmälle kerralla',
      run: () => { onClose(); openPlanner({ week: themeWeek }); } },
    { id: 'huomio', icon: 'chat', tone: 'blue', title: 'Huomio', sub: 'Yhdelle tai koko ryhmälle', run: () => onPick({ kind: 'note', ids: preset }) },
    { id: 'laksy', icon: 'check-circle', tone: 'green', title: 'Kotiläksy', sub: 'Yhdelle tai koko ryhmälle', run: () => onPick({ kind: 'homework', ids: preset }) },
    { id: 'video', icon: 'play', tone: 'clay', title: 'Video', sub: 'Yhdelle tai koko ryhmälle', run: () => onPick({ kind: 'video', ids: preset }) },
    { id: 'lasnaolo', icon: 'user-check', tone: 'sand', title: 'Läsnäolo', sub: attendSub,
      run: () => { onClose(); navigate(attend ? sessionPath(attend.training.id) : '/valmentaja/kalenteri'); } },
    { id: 'paivakirja', icon: 'book', tone: 'ink', title: 'Viikkopäiväkirja', sub: 'Vain sinulle', run: () => onPick({ kind: 'week', week: koutsiCurrentIsoWeek() }) },
  ];
  return (
    <Sheet open={open} onClose={onClose} title="Mitä kirjataan?" size="md">
      <div className="stack-4">
        <ContextCards state={state} ctx={ctx} now={now} onPick={onPick} onClose={onClose} />
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
  // { kind: 'menu' | 'note' | 'homework' | 'video' | 'day' | 'week', ids?, date?, week? }
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
  const openMenu = useCallback(() => { track('merkitse.avaa'); setSheet({ kind: 'menu' }); }, []);

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
      <MerkitseSheet open={kind === 'menu'} onClose={close} onPick={setSheet} />
      <RecordSheet open={kind === 'note' || kind === 'homework'} kind={last.current.record?.kind || 'note'} initialIds={sheet?.ids || []} onClose={close} />
      <VideoShareSheet open={kind === 'video'} onClose={close} recipients={state.students} initialIds={sheet?.ids || []} groups={state.groups} onSave={shareVideo} />
      <DaySummarySheet open={kind === 'day'} date={last.current.day?.date} onClose={close} />
      <WeekRecapSheet open={kind === 'week'} week={last.current.week?.week} onClose={close} />
    </RecordContext.Provider>
  );
}
