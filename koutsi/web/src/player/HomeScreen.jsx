// HomeScreen (player) — Koti: the player's sessions read from the clock, then what is new.
// A player can have many sessions a week, each with its own group and theme, so there is no single
// "theme of the week" here. Instead, the way the coach's Koti does it:
//   1. the dark card: hello and the week, a dot per session (a tap on a day opens that day's
//      session coming up, or the day in Viikko when it has none)
//   2. the coach's Tiedote, while it is valid, and the coach's latest note (Huomio) in full — the
//      old Koti's "Viimeisin palaute valmentajalta", always there once the coach has written one
//   3. Treenit — the one that just ended ("Miten meni?" right there), the one on now, the next one
//      with its theme, plan and "En pääse", and a few after it; it moves on by itself every minute
//   4. Ajankohtaista — open homework, new notifications, club events
// Goals and the history live on Kehitys; the groups and their players behind Lisää → Ryhmäsi.
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Button, Card, Icon, Page, useToast } from '../ui/index.js';
import { NotificationsButton, notificationKind, targetOf, useNotifications } from '../shared/Notifications.jsx';
import { Block, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiIsoWeekRangeLabel, koutsiGroupById, koutsiCoachById, koutsiTimeRangeLabel, koutsiTodayStr,
  koutsiAddDays, koutsiFmtShortDate, koutsiPad, KOUTSI_EVENT_KINDS, koutsiIsoWeekOfDateStr,
} from '../domain/core.js';
import { minutesLabel, relativeDay, weekParam } from '../domain/week.js';
import { moodFor, sessionForDay, sessionLine, weekDots } from '../domain/playerNow.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { planSummary, readPlan } from '../domain/plan.js';
import { firstName } from '../domain/roster.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { usePlayerActions } from './PlayerApp.jsx';
import { AfterSessions, useLead } from './MerkitseSheet.jsx';
import { CoachSessionSheet } from './weekSheets.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_LONG = ['Maanantai', 'Tiistai', 'Keskiviikko', 'Torstai', 'Perjantai', 'Lauantai', 'Sunnuntai'];
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** The dark top card: the week, hello, the bell, and the days with a dot per session. */
function Head({ student, days, onDay }) {
  const week = koutsiCurrentIsoWeek();
  const count = days.reduce((n, d) => n + d.sessions.length, 0);
  const isDesktop = useIsDesktop();
  return (
    <section className="week-hero on-dark court-lines home-hero ph-hero">
      <div className="week-hero-top">
        <span className="eyebrow">Viikko {week.week}, {koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
        {/* a computer has the bell on the profile card at the foot of the side nav */}
        {!isDesktop && <NotificationsButton uid={student.id} home="/pelaaja/koti" variant="on-dark" />}
      </div>
      <h1 className="week-hero-title">Moi, {firstName(student.name) || 'pelaaja'}!</h1>
      <div className="wk-days" role="list" aria-label="Viikon päivät">
        {days.map((d, i) => (
          <button key={d.date} type="button" role="listitem" onClick={() => onDay(d)}
            className={cx('wk-day', d.isToday && 'is-today', d.isPast && 'is-past', !d.sessions.length && !d.own && 'is-empty')}
            aria-label={`${DAY_LONG[i]} ${d.day}.: ${d.sessions.length === 1 ? '1 treeni' : `${d.sessions.length} treeniä`}`}>
            <span className="wk-day-name">{d.label}</span>
            <span className="wk-day-num t-num">{d.day}</span>
            <span className="wk-day-dots" aria-hidden="true">
              {d.sessions.slice(0, 3).map((x) => <span key={x.training.id} className={cx('wk-dot', `is-${x.status}`, x.absent && 'is-absent')} />)}
              {d.own > 0 && <span className="wk-dot is-own" />}
            </span>
          </button>
        ))}
      </div>
      <p className="ph-hero-sub">
        {count === 0 ? 'Ei valmennuksia tällä viikolla.' : `${count === 1 ? '1 valmennus' : `${count} valmennusta`} tällä viikolla`}
        <span className="ph-legend" aria-hidden="true"><span className="wk-dot is-own" /> oma treeni</span>
      </p>
    </section>
  );
}

function JoinCard() {
  return (
    <Card className="stack-3">
      <h2 className="t-h3">Et ole vielä valmentajan ryhmässä</h2>
      <p className="k-quiet-text">Kun liityt, näet täällä treenisi, niiden teemat ja valmentajan huomiot.</p>
      <div><Button variant="lime" icon="users" onClick={() => navigate('/pelaaja/ryhma')}>Liity ryhmään koodilla</Button></div>
    </Card>
  );
}

// ── Treenit: the line from the clock ──────────────────────────

/** "Päättyi 25 min sitten" / "Eilen klo 18:00–19:30" / "to 22.10. klo 18:00–19:30" */
function pastWhen(it) {
  const day = relativeDay(it.training.date);
  if (day === 'Tänään' && it.minutesAgo < 120) return `Päättyi ${minutesLabel(it.minutesAgo)} sitten`;
  return `${cap(day)} klo ${it.training.time}–${it.end}`;
}

function ThemeLine({ theme, empty }) {
  if (!theme) return empty ? <span className="ph-theme is-empty"><Icon name="sparkles" size={13} />{empty}</span> : null;
  return <span className="ph-theme"><Icon name="sparkles" size={13} />{theme.title}</span>;
}

function nameOf(it) { return it.group?.name || it.training.type; }

/** The session that ended last, once it is rated (or skipped): when, what, how it went. */
function PastItem({ it, student, onOpen }) {
  const mood = moodFor(student, it.training);
  return (
    <li className="tt-item is-past">
      <span className="tt-dot" aria-hidden="true"><Icon name="check" size={11} strokeWidth={3} /></span>
      <button type="button" className="tt-card ph-card" onClick={() => onOpen(it)}>
        <span className="tt-main">
          <span className="ph-label">Edellinen</span>
          <span className="tt-name">{nameOf(it)}</span>
          <span className="tt-state">{pastWhen(it)}{mood ? `, fiilis: ${MOOD_LABELS[mood.score]}` : ''}</span>
          <ThemeLine theme={it.theme} />
        </span>
        <Icon name="chevron-right" size={16} className="k-chevron" />
      </button>
    </li>
  );
}

function NowItem({ it, onOpen }) {
  const actions = usePlayerActions();
  const plan = readPlan(it.training.notes);
  return (
    <li className="tt-item is-now">
      <span className="tt-dot" aria-hidden="true" />
      <div className="tt-card ph-card is-col">
        <button type="button" className="tt-main" onClick={() => onOpen(it)}>
          <span className="ph-label is-live"><span className="k-ctx-live" aria-hidden="true" />Nyt käynnissä</span>
          <span className="tt-name">{nameOf(it)}</span>
          <span className="tt-state"><span className="t-num">{it.training.time}–{it.end},</span> {minutesLabel(it.minutesLeft)} jäljellä{it.absent ? ', ilmoitit poissaolon' : ''}</span>
          <ThemeLine theme={it.theme} />
          <span className="tt-progress" aria-hidden="true"><span style={{ width: `${Math.round(it.progress * 100)}%` }} /></span>
        </button>
        {plan.items.length > 0 && (
          <button type="button" className="tp-link" onClick={() => actions.openPlan(it.training)}>
            <Icon name="list" size={16} /><span className="grow"><strong>Treenin runko</strong>: {planSummary(plan)}</span><Icon name="chevron-right" size={16} />
          </button>
        )}
      </div>
    </li>
  );
}

/** The next session, big: when (and how soon), the group and coach, its theme, plan and "En pääse". */
function NextItem({ it }) {
  const actions = usePlayerActions();
  const plan = readPlan(it.training.notes);
  const day = relativeDay(it.training.date);
  const soon = day === 'Tänään' && it.minutesUntil < 12 * 60 ? `alkaa ${minutesLabel(it.minutesUntil)} päästä` : '';
  return (
    <li className={cx('tt-item is-upcoming is-next', it.absent && 'is-absent')}>
      <span className="tt-dot" aria-hidden="true" />
      <div className="tt-card ph-next">
        <span className="ph-label">Seuraavaksi</span>
        <div className="ph-next-when">
          <span className="ph-next-day">{cap(day)}</span>
          <span className="t-num">klo {koutsiTimeRangeLabel(it.training.time, it.training.durationMinutes || it.group?.durationMinutes)}</span>
          {soon && <span className="ph-next-soon">{soon}</span>}
        </div>
        <div className="ph-next-what">{[nameOf(it), it.group ? it.training.type : '', it.coach?.name].filter(Boolean).join(', ')}</div>
        {it.theme ? (
          <div className="ph-next-theme">
            <div className="eyebrow"><Icon name="sparkles" size={13} /> Treenin teema</div>
            <strong>{it.theme.title}</strong>
            {it.theme.lead && <p>{it.theme.lead}</p>}
          </div>
        ) : it.group && <p className="ph-next-notheme">Valmentaja ei ole vielä asettanut teemaa.</p>}
        {plan.items.length > 0 && (
          <button type="button" className="tp-link" onClick={() => actions.openPlan(it.training)}>
            <Icon name="list" size={16} /><span className="grow"><strong>Treenin runko</strong>: {planSummary(plan)}</span><Icon name="chevron-right" size={16} />
          </button>
        )}
        <div className="row wrap">
          {it.absent ? (
            <>
              <span className="chip chip-md chip-warn">Ilmoitit poissaolon</span>
              <Button variant="ghost" size="sm" onClick={() => actions.openAbsence(it.training)}>Pääsenkin</Button>
            </>
          ) : <Button variant="outline" size="sm" icon="close" onClick={() => actions.openAbsence(it.training)}>En pääse</Button>}
        </div>
      </div>
    </li>
  );
}

/** A session after the next one: one line, with its own theme. */
function LaterItem({ it, onOpen }) {
  return (
    <li className={cx('tt-item is-upcoming ph-later', it.absent && 'is-absent')}>
      <span className="tt-dot" aria-hidden="true" />
      <button type="button" className="tt-card ph-card" onClick={() => onOpen(it)}>
        <span className="tt-main">
          <span className="tt-time t-num">{cap(relativeDay(it.training.date))} {it.training.time}–{it.end}</span>
          <span className="tt-name">{nameOf(it)}{it.absent ? <span className="ph-absent">, poissa</span> : null}</span>
          <ThemeLine theme={it.theme} empty={it.group ? 'Teema tulossa' : ''} />
        </span>
        <Icon name="chevron-right" size={16} className="k-chevron" />
      </button>
    </li>
  );
}

function SessionLine({ student, now, onOpen }) {
  const { state } = useData();
  const { lead, skip } = useLead();
  const line = sessionLine(state, student, { now });
  const waiting = lead.ended.length > 0;
  const hasPast = waiting || Boolean(line.previous);
  const coming = Boolean(line.next) || line.now.length > 0;
  if (!hasPast && !coming) return <Card><Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet></Card>;
  // The "Nyt" line sits between what is over and what is to come; a running session says it itself.
  const nowLine = line.now.length === 0 && (
    <li key="nyt" className="tt-now" aria-label="Nyt">
      <span className="tt-now-label t-num">Nyt {koutsiPad(now.getHours())}:{koutsiPad(now.getMinutes())}</span>
    </li>
  );
  return (
    <ol className="tt-line ph-line">
      {waiting ? (
        <li className="tt-item is-past">
          <span className="tt-dot" aria-hidden="true"><Icon name="check" size={11} strokeWidth={3} /></span>
          <AfterSessions ended={lead.ended} onSkip={skip} className="is-card ph-after" />
        </li>
      ) : line.previous && <PastItem it={line.previous} student={student} onOpen={onOpen} />}
      {hasPast && nowLine}
      {line.now.map((it) => <NowItem key={it.training.id} it={it} onOpen={onOpen} />)}
      {!hasPast && nowLine}
      {line.next ? <NextItem it={line.next} /> : (
        <li className="tt-item is-upcoming"><span className="tt-dot" aria-hidden="true" /><div className="tt-card"><Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet></div></li>
      )}
      {line.later.map((it) => <LaterItem key={it.training.id} it={it} onOpen={onOpen} />)}
    </ol>
  );
}

// ── Ajankohtaista ─────────────────────────────────────────────

/** Unread notifications, newest first — the same list as the bell, so reading them anywhere clears them here. */
function useUnread(uid) {
  return useNotifications(uid).items.filter((n) => !n.read);
}

const kindLabel = (kind) => KOUTSI_EVENT_KINDS.find((k) => k.value === kind)?.label || 'Tapahtuma';
const eventIcon = (kind) => ({ kilpailu: 'trophy', leiri: 'compass', seura: 'users', tauko: 'sun' }[kind] || 'flag');

/**
 * One list of what is new or coming, each row once — unread notifications (not a new note, which
 * the Valmentajalta card shows whole; not "Miten meni?", which is on the session line), and the
 * club's events in the next three weeks.
 */
function newsRows(state, student, unread) {
  const today = koutsiTodayStr();
  const note = student.diary[0] || null;
  const rows = [];
  unread
    .filter((n) => !(note && notificationKind(n.kind) === 'diary_added') && !String(n.linkPath || '').includes('fiilis='))
    .slice(0, 3)
    .forEach((n) => rows.push({ id: `n-${n.id}`, icon: 'bell', title: n.title, body: n.body || '', meta: koutsiFmtEventDate(n.createdAt), to: targetOf(n.linkPath, '/pelaaja/koti', n.kind), isNew: true }));
  (state.clubEvents || [])
    .filter((e) => (e.endDate || e.date) >= today && e.date <= koutsiAddDays(today, 21))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2)
    .forEach((e) => rows.push({
      id: `e-${e.id}`, icon: eventIcon(e.kind), title: e.title, body: e.message || '',
      meta: `${kindLabel(e.kind)}, ${koutsiFmtShortDate(e.date)}${e.endDate && e.endDate !== e.date ? `–${koutsiFmtShortDate(e.endDate)}` : ''}`,
      to: `/pelaaja/treenit?vko=${weekParam(koutsiIsoWeekOfDateStr(e.date < today ? today : e.date))}&pv=${e.date < today ? today : e.date}`,
    }));
  return rows;
}

function NewsList({ rows }) {
  return (
    <ul className="home-news">
      {rows.map((r) => {
        const inner = (
          <>
            <span className={cx('home-news-icon', r.isNew && 'is-new')}><Icon name={r.icon} size={16} /></span>
            <span className="home-news-main">
              <span className="home-news-title">{r.title}</span>
              {r.body && <span className="home-news-body">{r.body}</span>}
              <span className="home-news-meta">{r.meta}</span>
            </span>
            {r.to && <Icon name="chevron-right" size={16} className="k-chevron" />}
          </>
        );
        return <li key={r.id}>{r.to ? <button type="button" className="home-news-row" onClick={() => navigate(r.to)}>{inner}</button> : <div className="home-news-row">{inner}</div>}</li>;
      })}
    </ul>
  );
}

/** Open homework, one tap to mark it done (with Kumoa in the toast, for a slip of the thumb). */
function HomeworkList({ open }) {
  const { run } = useData();
  const toast = useToast();
  // a tap shows at once (the tick fills) and a second tap on the same row waits for the first
  const [pending, setPending] = useState([]);
  const markDone = async (h) => {
    if (pending.includes(h.id)) return;
    setPending((p) => [...p, h.id]);
    const res = await run(() => api.homework.toggleDone(h.id, true));
    setPending((p) => p.filter((x) => x !== h.id));
    if (res?.ok) toast('Merkitty tehdyksi — hienoa!', { action: { label: 'Kumoa', onClick: () => run(() => api.homework.toggleDone(h.id, false)) }, duration: 5000 });
  };
  return (
    <div className="ph-hw">
      <div className="ph-hw-head"><Icon name="book" size={16} /> Kotiläksyt, {open.length} tekemättä</div>
      <div className="k-list">
        {open.map((h) => (
          <button key={h.id} type="button" className={`k-hw${pending.includes(h.id) ? ' is-done' : ''}`} aria-busy={pending.includes(h.id) || undefined} onClick={() => markDone(h)}>
            <span className="k-check-btn"><Icon name="check" size={14} strokeWidth={3} /></span>
            <span className="grow">{h.text}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function News({ state, student, unread }) {
  const rows = newsRows(state, student, unread);
  const open = student.homework.filter((h) => !h.done);
  if (!rows.length && !open.length) return null;
  return (
    <Block title="Ajankohtaista" className="home-now">
      <div className="stack-3">
        {open.length > 0 && <HomeworkList open={open} />}
        {rows.length > 0 && <NewsList rows={rows} />}
      </div>
    </Block>
  );
}

/**
 * Valmentajalta — the coach's latest note (Huomio) in full, with its day, "Uusi" until the player
 * has seen its notification, and a way to every earlier one (Kehitys, filtered to the coach's).
 */
function CoachNote({ state, student, unread }) {
  const note = student.diary[0];
  if (!note) return null;
  const coaches = state.coaches || [];
  const who = coaches.length === 1 ? coaches[0].name : '';
  const isNew = unread.some((n) => notificationKind(n.kind) === 'diary_added');
  return (
    <article className="cn-card">
      <span className="cn-icon"><Icon name="chat" size={18} /></span>
      <div className="cn-body">
        <div className="cn-eyebrow">
          <span className="truncate">Valmentajalta{who ? `, ${who}` : ''}</span>
          {isNew && <span className="cn-new">Uusi</span>}
        </div>
        <p className="cn-text">{note.text}</p>
        <div className="cn-foot">
          <span>{koutsiFmtEventDate(note.at)}</span>
          {student.diary.length > 1 && (
            <button type="button" className="k-textlink cn-all" onClick={() => navigate('/pelaaja/kehitys?nayta=valmentajalta')}>
              Kaikki huomiot ({student.diary.length})<Icon name="chevron-right" size={14} />
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

// EHDOTUS (haara koutsi-selkeys): a coach's Tiedote — practical news for the group (another coach,
// another court) — first on Koti until its date. It never goes on Kehitys.
function Notices({ state }) {
  const today = koutsiTodayStr();
  const list = (state.announcements || []).filter((a) => a.until >= today);
  if (!list.length) return null;
  return (
    <div className="an-list">
      {list.map((a) => {
        const coach = koutsiCoachById(state, a.coachId) || state.coach;
        const groups = [...new Set((a.groupIds || []).map((id) => koutsiGroupById(state, id)?.name).filter(Boolean))];
        return (
          <article key={a.id} className="an-card">
            <span className="an-icon"><Icon name="info" size={18} /></span>
            <div className="an-body">
              <div className="an-eyebrow">Tiedote, {coach?.name || 'Valmentaja'}</div>
              <p className="an-text">{a.text}</p>
              <div className="an-foot">{[groups.join(', '), `${koutsiFmtEventDate(a.at)}`, `näkyy ${koutsiFmtShortDate(a.until)} asti`].filter(Boolean).join(', ')}</div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

export function HomeScreen() {
  const { state } = useData();
  const isDesktop = useIsDesktop();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const student = state.students[0];
  const hasCoach = (state.coaches || []).length > 0;
  const unread = useUnread(student.id);
  const days = weekDots(state, student, koutsiCurrentIsoWeek(), now);
  // One session sheet over Koti: from a day in the strip or a row on the line.
  const [picked, setPicked] = useState(null);
  const last = useRef(null);
  if (picked) last.current = picked;
  const openDay = (d) => {
    const it = sessionForDay(state, student, d.date, now);
    if (it) setPicked(it);
    else navigate(`/pelaaja/treenit?vko=${weekParam(koutsiCurrentIsoWeek())}&pv=${d.date}`);
  };
  const line = hasCoach && (
    <Block title="Treenit">
      <SessionLine student={student} now={now} onOpen={setPicked} />
    </Block>
  );
  return (
    <Page width="wide" className="week-page home-page">
      <Head student={student} days={days} onDay={openDay} />
      <div className={isDesktop ? 'week-grid' : 'stack-5'}>
        <div className="stack-5">
          {!hasCoach && <JoinCard />}
          <Notices state={state} />
          <CoachNote state={state} student={student} unread={unread} />
          {line}
        </div>
        <div className="stack-5">
          <News state={state} student={student} unread={unread} />
        </div>
      </div>
      <CoachSessionSheet open={Boolean(picked)} item={last.current} onClose={() => setPicked(null)} />
    </Page>
  );
}
