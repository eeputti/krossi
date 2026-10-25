// HomeScreen (player) — Koti: what is happening now. First "Ajankohtaista" — the sessions that
// just ended to rate (the same slides as in Merkitse), the coach's latest note, new notifications
// and the club's coming events — then the coming sessions with "En pääse", open homework, and the
// player's groups (Ryhmä is a page under Koti, not a tab). Goals and numbers live on Kehitys;
// logging anything is the Merkitse button's job.
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Button, Card, Icon, Page } from '../ui/index.js';
import { NotificationsButton, targetOf } from '../shared/Notifications.jsx';
import { Block, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiIsoWeekRangeLabel, koutsiThemeForDate, koutsiGroupById, koutsiCoachById,
  koutsiGroupsForStudent, koutsiTimeRangeLabel, koutsiTodayStr, koutsiAddDays, koutsiFmtShortDate, KOUTSI_EVENT_KINDS,
  koutsiGroupThemeForWeek,
} from '../domain/core.js';
import { relativeDay, shortDay, themeWeekShort } from '../domain/week.js';
import { homeThemeCards, upcomingSessions } from '../domain/player.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { planSummary, readPlan } from '../domain/plan.js';
import { firstName } from '../domain/roster.js';
import { usePlayerActions } from './PlayerApp.jsx';
import { AfterSessions, useLead } from './MerkitseSheet.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const DAY_MS = 24 * 60 * 60 * 1000;

/** The dark top card: the week, hello, the bell, and this week's theme (the first group's; each
 *  group's own theme is on its "Ryhmäsi" row). */
function Head({ student, groups }) {
  const week = koutsiCurrentIsoWeek();
  const main = homeThemeCards(groups, week)[0];
  return (
    <section className="week-hero on-dark court-lines home-hero">
      <div className="week-hero-top">
        <span className="eyebrow">Viikko {week.week} · {koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
        <NotificationsButton uid={student.id} home="/pelaaja/koti" variant="on-dark" />
      </div>
      <h1 className="week-hero-title">Moi, {firstName(student.name) || 'pelaaja'}!</h1>
      {main && (
        <div className="hero-theme">
          <div className="hero-theme-eyebrow">
            {main.current ? 'Viikon teema' : `Viimeisin teema · ${themeWeekShort(main.theme)}`}{groups.length > 1 ? ` · ${[...new Set(main.groups.map((g) => g.name))].join(', ')}` : ''}
          </div>
          <div className="hero-theme-title">{main.theme.title}</div>
          {main.theme.lead && <p className="hero-theme-lead">{main.theme.lead}</p>}
        </div>
      )}
    </section>
  );
}

function JoinCard() {
  return (
    <Card className="stack-3">
      <h2 className="t-h3">Et ole vielä valmentajan ryhmässä</h2>
      <p className="k-quiet-text">Kun liityt, näet täällä treenisi, viikon teeman ja valmentajan huomiot.</p>
      <div><Button variant="lime" icon="users" onClick={() => navigate('/pelaaja/ryhma')}>Liity ryhmään koodilla</Button></div>
    </Card>
  );
}

/** Unread notifications, newest first (the bell marks them read when opened). */
function useUnread(uid) {
  const [items, setItems] = useState([]);
  const load = useCallback(() => api.notifications.list(uid).then(setItems).catch(() => {}), [uid]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => api.notifications.subscribe(uid, load), [uid, load]);
  return items.filter((n) => !n.read);
}

const kindLabel = (kind) => KOUTSI_EVENT_KINDS.find((k) => k.value === kind)?.label || 'Tapahtuma';
const eventIcon = (kind) => ({ kilpailu: 'trophy', leiri: 'compass', seura: 'users' }[kind] || 'flag');

/**
 * Ajankohtaista: one list of what is new or coming, each row once — the coach's latest note
 * (two weeks), unread notifications (not the note again, not "Miten meni?", which has its card),
 * and the club's events in the next three weeks.
 */
function News({ state, student }) {
  const unread = useUnread(student.id);
  const today = koutsiTodayStr();
  const note = student.diary[0] && Date.now() - new Date(student.diary[0].at).getTime() < 14 * DAY_MS ? student.diary[0] : null;
  const rows = [];
  if (note) {
    rows.push({ id: `note-${note.id}`, icon: 'chat', title: 'Valmentajalta', body: note.text, meta: koutsiFmtEventDate(note.at), to: '/pelaaja/kehitys' });
  }
  unread
    .filter((n) => !(note && n.kind === 'diary_added') && !String(n.linkPath || '').includes('fiilis='))
    .slice(0, 3)
    .forEach((n) => rows.push({ id: `n-${n.id}`, icon: 'bell', title: n.title, body: n.body || '', meta: koutsiFmtEventDate(n.createdAt), to: targetOf(n.linkPath, '/pelaaja/koti'), isNew: true }));
  (state.clubEvents || [])
    .filter((e) => (e.endDate || e.date) >= today && e.date <= koutsiAddDays(today, 21))
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(0, 2)
    .forEach((e) => rows.push({
      id: `e-${e.id}`, icon: eventIcon(e.kind), title: e.title,
      meta: `${kindLabel(e.kind)} · ${koutsiFmtShortDate(e.date)}${e.endDate && e.endDate !== e.date ? `–${koutsiFmtShortDate(e.endDate)}` : ''}`,
      to: '/pelaaja/treenit',
    }));
  if (!rows.length) return null;
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
        return (
          <li key={r.id}>
            {r.to ? <button type="button" className="home-news-row" onClick={() => navigate(r.to)}>{inner}</button> : <div className="home-news-row">{inner}</div>}
          </li>
        );
      })}
    </ul>
  );
}

function Now({ state, student }) {
  const { lead, skip } = useLead();
  const hasAfter = lead.ended.length > 0;
  const news = <News state={state} student={student} />;
  return (
    <Block title="Ajankohtaista" className="home-now">
      <div className="stack-3">
        {hasAfter && <AfterSessions ended={lead.ended} onSkip={skip} className="is-card" />}
        {news}
      </div>
    </Block>
  );
}

function NextSession({ state, student }) {
  const actions = usePlayerActions();
  const nowMs = useNow(60_000);
  const upcoming = upcomingSessions(state, student.id, new Date(nowMs));
  const next = upcoming[0];
  if (!next) return <Card><Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet></Card>;
  const group = next.groupId ? koutsiGroupById(state, next.groupId) : null;
  const coach = koutsiCoachById(state, next.coachId);
  const theme = group ? koutsiThemeForDate(group, next.date) : null;
  const absent = (next.absences || []).some((a) => a.studentId === student.id);
  const plan = readPlan(next.notes);
  return (
    <Card className={cx('next-session', absent && 'is-absent')}>
      <div className="eyebrow">{relativeDay(next.date) === 'Tänään' ? 'Tänään' : 'Seuraava treeni'}</div>
      <div className="next-session-when">
        <span className="next-session-day">{relativeDay(next.date)}</span>
        <span className="t-num">klo {koutsiTimeRangeLabel(next.time, next.durationMinutes || group?.durationMinutes)}</span>
      </div>
      <div className="next-session-what">{next.type}{group ? ` · ${group.name}` : ''}{coach ? ` · ${coach.name}` : ''}</div>
      {theme && <div className="next-session-theme"><Icon name="sparkles" size={14} /> {theme.title}</div>}
      {plan.items.length > 0 && (
        <button type="button" className="tp-link" onClick={() => actions.openPlan(next)}>
          <Icon name="list" size={16} /><span className="grow"><strong>Treenin runko</strong> · {planSummary(plan)}</span><Icon name="chevron-right" size={16} />
        </button>
      )}
      <div className="row wrap">
        {absent ? (
          <>
            <span className="chip chip-md chip-warn">Ilmoitit poissaolon</span>
            <Button variant="ghost" size="sm" onClick={() => actions.openAbsence(next)}>Pääsenkin</Button>
          </>
        ) : <Button variant="outline" size="sm" icon="close" onClick={() => actions.openAbsence(next)}>En pääse</Button>}
      </div>
      {upcoming.length > 1 && (
        <ul className="next-session-rest">
          {upcoming.slice(1, 3).map((t) => {
            const g = t.groupId ? koutsiGroupById(state, t.groupId) : null;
            const hasRunko = readPlan(t.notes).items.length > 0;
            return (
              <li key={t.id}>
                <span className="t-num">{shortDay(t.date)} {t.time}</span> · {t.type}{g ? ` · ${g.name}` : ''}
                {hasRunko && <> · <button type="button" className="tp-inline is-text" onClick={() => actions.openPlan(t)}>Runko</button></>}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function Homework({ student }) {
  const { run } = useData();
  const open = student.homework.filter((h) => !h.done);
  if (!student.homework.length) return null;
  return (
    <Block eyebrow="Kotiläksyt" title={open.length ? `${open.length} tekemättä` : 'Kaikki tehty — hyvää työtä!'}>
      {open.length > 0 && (
        <div className="k-list">
          {open.map((h) => (
            <button key={h.id} type="button" className="k-hw" onClick={() => run(() => api.homework.toggleDone(h.id, true), 'Merkitty tehdyksi — hienoa!')}>
              <span className="k-check-btn"><Icon name="check" size={14} strokeWidth={3} /></span>
              <span className="grow">{h.text}</span>
            </button>
          ))}
        </div>
      )}
    </Block>
  );
}

/** The player's groups, one row each (day, time, coach, this week's theme) → the group page. */
function MyGroups({ state, student }) {
  const groups = koutsiGroupsForStudent(state, student.id);
  const week = koutsiCurrentIsoWeek();
  if (!groups.length) return null;
  return (
    <Block title="Ryhmäsi">
      <div className="ms-others-list">
        {groups.map((g) => {
          const coach = koutsiCoachById(state, g.coachId);
          const theme = koutsiGroupThemeForWeek(g, week);
          return (
            <button key={g.id} type="button" className="ms-row" onClick={() => navigate('/pelaaja/ryhma')}>
              <span className="ms-row-icon"><Icon name="users" size={16} /></span>
              <span className="ms-row-main">
                <span className="ms-row-title">{g.name}</span>
                <span className="ms-row-sub">{[`${(g.day || '').toLowerCase()} ${g.time || ''}`.trim(), coach?.name, theme ? `Teema: ${theme.title}` : ''].filter(Boolean).join(' · ')}</span>
              </span>
              <Icon name="chevron-right" size={16} className="k-chevron" />
            </button>
          );
        })}
      </div>
    </Block>
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
              <div className="an-eyebrow">Tiedote · {coach?.name || 'Valmentaja'}</div>
              <p className="an-text">{a.text}</p>
              <div className="an-foot">{[groups.join(', '), `${koutsiFmtEventDate(a.at)}`, `näkyy ${koutsiFmtShortDate(a.until)} asti`].filter(Boolean).join(' · ')}</div>
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
  const student = state.students[0];
  const hasCoach = (state.coaches || []).length > 0;
  const groups = koutsiGroupsForStudent(state, student.id);
  return (
    <Page width="wide" className="week-page home-page">
      <Head student={student} groups={groups} />
      <div className={isDesktop ? 'week-grid' : 'stack-5'}>
        <div className="stack-5">
          {!hasCoach && <JoinCard />}
          <Notices state={state} />
          <Now state={state} student={student} />
          {hasCoach && (
            <Block title="Tulevat treenit">
              <NextSession state={state} student={student} />
            </Block>
          )}
        </div>
        <div className="stack-5">
          <Homework student={student} />
          <MyGroups state={state} student={student} />
        </div>
      </div>
    </Page>
  );
}
