// HomeScreen (player) — "what's this week": the week's theme, the next session with a one-tap
// "En pääse", a check-in after the last session, the coach's latest note, homework, the goal,
// and the player's own activity.
import { useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { navigate } from '../app/router.js';
import { Button, Card, Icon, IconButton, Page, useToast } from '../ui/index.js';
import { NotificationsButton } from '../shared/Notifications.jsx';
import { Block, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiIsoWeekRangeLabel, koutsiThemeForDate, koutsiGroupById, koutsiCoachById,
  koutsiGroupsForStudent, koutsiTimeRangeLabel,
} from '../domain/core.js';
import { relativeDay, shortDay, themeWeekShort } from '../domain/week.js';
import { activityStreak, checkInCandidate, homeThemeCards, ownThisWeek, upcomingSessions } from '../domain/player.js';
import { koutsiFmtEventDate } from '../domain/timeline.js';
import { firstName } from '../domain/roster.js';
import { MOOD_LABELS } from '../lib/constants.js';
import { MoodPicker } from './sheets.jsx';
import { usePlayerActions } from './PlayerApp.jsx';
import { markSkipped, readSkipped } from './checkin.js';

const cx = (...c) => c.filter(Boolean).join(' ');

function Hero({ state, student, groups }) {
  const week = koutsiCurrentIsoWeek();
  const cards = homeThemeCards(groups, week);
  const main = cards[0];
  return (
    <section className="week-hero on-dark court-lines rise">
      <div className="week-hero-top">
        <span className="eyebrow">Viikko {week.week} · {koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
        <NotificationsButton uid={student.id} home="/pelaaja/koti" variant="on-dark" />
      </div>
      <h1 className="week-hero-title">Moi, {firstName(student.name) || 'pelaaja'}!</h1>
      {(state.coaches || []).length === 0 ? (
        <>
          <p className="week-hero-sub">Et ole vielä valmentajan ryhmässä. Kun liityt, näet täällä viikon teeman ja treenit.</p>
          <div className="week-hero-actions"><Button variant="lime" icon="users" onClick={() => navigate('/pelaaja/ryhma')}>Liity ryhmään koodilla</Button></div>
        </>
      ) : main ? (
        <div className="hero-theme">
          <div className="hero-theme-eyebrow">
            {main.current ? 'Viikon teema' : `Viimeisin teema · ${themeWeekShort(main.theme)}`}{groups.length > 1 ? ` · ${[...new Set(main.groups.map((g) => g.name))].join(', ')}` : ''}
          </div>
          <div className="hero-theme-title">{main.theme.title}</div>
          {main.theme.lead && <p className="hero-theme-lead">{main.theme.lead}</p>}
          {!main.current && <p className="hero-theme-note">Valmentaja ei ole vielä lisännyt tämän viikon teemaa.</p>}
          {cards.slice(1).map((c) => (
            <p key={c.key} className="hero-theme-more"><Icon name="sparkles" size={13} /> {c.groups.map((g) => g.name).join(', ')}: <strong>{c.theme.title}</strong></p>
          ))}
        </div>
      ) : (
        <p className="week-hero-sub">Viikon teema ilmestyy tähän, kun valmentaja asettaa sen.</p>
      )}
    </section>
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
  return (
    <Card className={cx('next-session', absent && 'is-absent')}>
      <div className="eyebrow">{relativeDay(next.date) === 'Tänään' ? 'Tänään' : 'Seuraava treeni'}</div>
      <div className="next-session-when">
        <span className="next-session-day">{relativeDay(next.date)}</span>
        <span className="t-num">klo {koutsiTimeRangeLabel(next.time, next.durationMinutes || group?.durationMinutes)}</span>
      </div>
      <div className="next-session-what">{next.type}{group ? ` · ${group.name}` : ''}{coach ? ` · ${coach.name}` : ''}</div>
      {theme && <div className="next-session-theme"><Icon name="sparkles" size={14} /> {theme.title}</div>}
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
            return <li key={t.id}><span className="t-num">{shortDay(t.date)} {t.time}</span> · {t.type}{g ? ` · ${g.name}` : ''}</li>;
          })}
        </ul>
      )}
    </Card>
  );
}

function CheckIn({ state, student }) {
  const { run, reload } = useData();
  const toast = useToast();
  const [dismissed, setDismissed] = useState(() => readSkipped(student.id));
  const [busy, setBusy] = useState(false);
  const candidate = checkInCandidate(state, student, dismissed);
  if (!candidate) return null;
  const group = candidate.groupId ? koutsiGroupById(state, candidate.groupId) : null;
  const dayWord = relativeDay(candidate.date).toLowerCase();
  const skip = () => setDismissed(markSkipped(student.id, candidate.id));
  const pick = async (score) => {
    if (busy) return;
    setBusy(true);
    const res = await run(() => api.player.addMood(student.id, { score, note: '', hiddenFromCoach: false }));
    setBusy(false);
    if (!res.ok) return;
    const fresh = await reload().catch(() => null);
    const mood = fresh?.students?.[0]?.moods?.[0];
    toast(`Fiilis tallennettu: ${MOOD_LABELS[score]}. Valmentajasi näkee sen.`, mood ? { action: { label: 'Vain minulle', onClick: () => run(() => api.player.setMoodHidden(mood.id, true), 'Fiilis piilotettu valmentajalta.') }, duration: 6000 } : {});
  };
  return (
    <Card className="checkin pop">
      <div className="row-between">
        <div className="eyebrow">Fiilis treenin jälkeen</div>
        <IconButton icon="close" label="Ohita" size="sm" onClick={skip} />
      </div>
      <h2 className="checkin-title">Miten {dayWord === 'tänään' ? 'tämänpäiväinen' : dayWord === 'eilen' ? 'eilinen' : `${shortDay(candidate.date)}`} treeni meni?</h2>
      <p className="k-faint">{candidate.type}{group ? ` · ${group.name}` : ''}{group && koutsiThemeForDate(group, candidate.date) ? ` · teema: ${koutsiThemeForDate(group, candidate.date).title}` : ''}</p>
      <MoodPicker value={null} onChange={pick} size="sm" />
    </Card>
  );
}

function Feedback({ student }) {
  const latest = student.diary[0];
  if (!latest) return null;
  return (
    <Block eyebrow="Valmentajalta" title="Viimeisin huomio">
      <Card className="coach-note">
        <p className="coach-note-text">{latest.text}</p>
        <span className="k-faint">{koutsiFmtEventDate(latest.at)}</span>
      </Card>
      <Button variant="ghost" size="sm" iconRight="arrow-right" onClick={() => navigate('/pelaaja/kehitys')}>Koko kehityshistoria</Button>
    </Block>
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

function Mine({ state, student }) {
  const actions = usePlayerActions();
  const streak = activityStreak(state, student);
  const own = ownThisWeek(state, student.id);
  return (
    <Block eyebrow="Oma tekeminen">
      <Card className="mine">
        <div className="mine-stats">
          <div className="mine-stat"><span className="mine-num t-num">{streak.weeks}</span><span className="mine-label">{streak.weeks === 1 ? 'viikon putki' : 'viikon putki'}</span></div>
          <div className="mine-stat"><span className="mine-num t-num">{own.count}</span><span className="mine-label">omaa treeniä tällä viikolla</span></div>
          <div className="mine-stat"><span className="mine-num t-num">{own.minutes}</span><span className="mine-label">minuuttia</span></div>
        </div>
        <p className="k-faint">{streak.thisWeek ? 'Tämä viikko on jo kirjattu — putki jatkuu.' : streak.weeks > 0 ? 'Kirjaa jotain tällä viikolla, niin putki jatkuu.' : 'Kirjaa oma treeni, fiilis tai ottelu — siitä alkaa putki.'}</p>
        <div className="row wrap">
          <Button variant="dark" size="sm" icon="plus" onClick={() => actions.openSelfTraining()}>Oma treeni</Button>
          <Button variant="outline" size="sm" icon="trophy" onClick={() => actions.openMatch()}>Ottelu</Button>
          <Button variant="outline" size="sm" icon="heart" onClick={() => actions.openMood()}>Fiilis</Button>
        </div>
      </Card>
    </Block>
  );
}

function GoalAndWish({ student }) {
  const actions = usePlayerActions();
  return (
    <div className="two-cards">
      <Card interactive onClick={() => actions.openText('goal')} className="goal-card">
        <div className="eyebrow"><Icon name="target" size={13} /> Tavoitteeni</div>
        {student.goal ? <p className="goal-text">{student.goal}</p> : <p className="k-faint">Aseta tavoite — mitä haluat oppia tällä kaudella?</p>}
      </Card>
      <Card interactive onClick={() => actions.openText('wish')} className="goal-card">
        <div className="eyebrow"><Icon name="chat" size={13} /> Toive valmentajalle</div>
        {student.playerWish ? <p className="goal-text">{student.playerWish}</p> : <p className="k-faint">Mitä haluaisit harjoitella seuraavaksi?</p>}
      </Card>
    </div>
  );
}

function PurposeCard({ student }) {
  const key = `koutsi_purpose_seen_${student.id}`;
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(key) === '1'; } catch { return true; } });
  if (hidden || !student.welcomeSeenAt) return null;
  const close = () => { try { localStorage.setItem(key, '1'); } catch { /* private mode */ } setHidden(true); };
  return (
    <Card className="purpose">
      <IconButton icon="close" label="Sulje" size="sm" className="purpose-close" onClick={close} />
      <h2 className="t-h3">Koutsi seuraa tenniskehitystäsi — ei vain videoita</h2>
      <p className="k-quiet-text">Täältä näet ryhmäsi viikon teeman ja kaiken, mitä olette harjoitelleet. Kehitykseen kertyvät treenit, teemat, valmentajan huomiot, tavoitteet ja ottelut.</p>
      <Button variant="dark" size="sm" iconRight="arrow-right" onClick={() => { close(); navigate('/pelaaja/kehitys'); }}>Katso kehityksesi</Button>
    </Card>
  );
}

export function HomeScreen() {
  const { state } = useData();
  const isDesktop = useIsDesktop();
  const student = state.students[0];
  const groups = useMemo(() => koutsiGroupsForStudent(state, student.id), [state, student.id]);
  const hasCoach = (state.coaches || []).length > 0;
  return (
    <Page width="wide" className="week-page">
      <div className={isDesktop ? 'week-grid' : 'stack-5'}>
        <div className="stack-5">
          <Hero state={state} student={student} groups={groups} />
          <PurposeCard student={student} />
          {hasCoach && <CheckIn state={state} student={student} />}
          {hasCoach && <NextSession state={state} student={student} />}
          <Homework student={student} />
        </div>
        <div className="stack-5">
          <Feedback student={student} />
          <GoalAndWish student={student} />
          <Mine state={state} student={student} />
        </div>
      </div>
    </Page>
  );
}
