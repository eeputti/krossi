// WeekScreen — the coach's home ("Koti"): what a weekly visit needs, in order. On a phone the
// avatar in the corner is the way to Profiili (the tab bar's middle is "Merkitse").
//   1. this week's theme coverage, with the one- or two-tap fix
//   2. today on a timeline — over, running, still to come — then tomorrow in one line
//   3. things that need the coach: calendars running out, players who haven't joined
//   4. what players did lately
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { Avatar, Button, Card, Icon, Page, ProgressRing } from '../ui/index.js';
import { Link } from '../app/router.js';
import { NotificationsButton } from '../shared/Notifications.jsx';
import { Block, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiCompareIsoWeeks, koutsiIsoWeekRangeLabel, koutsiTodayStr, koutsiAddDays,
  koutsiWeekThemeStatus, koutsiFmtShortDate,
} from '../domain/core.js';
import { calendarEndings, coachSessionsOn, playerActivity, plannerDefaultWeek, unjoinedPlayers, relativeDay } from '../domain/week.js';
import { firstName } from '../domain/roster.js';
import { useCoach } from './CoachRoot.jsx';
import { openInvites, openPlanner } from './nav.js';
import { ActivityRow, SessionRow } from './parts.jsx';
import { useContinueThemes } from './themeActions.js';
import { ExtendCalendarSheet, GroupFormSheet } from './groupForms.jsx';
import { WeekRecapSheet } from './WeekRecapSheet.jsx';
import { MOOD_LABELS } from '../lib/constants.js';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { TodayTimeline } from './today.jsx';

function CoverageHero({ state }) {
  const { uid, acting } = useCoach();
  const isDesktop = useIsDesktop();
  const continueThemes = useContinueThemes();
  const [busy, setBusy] = useState(false);
  const week = plannerDefaultWeek();
  const now = koutsiCurrentIsoWeek();
  const isNow = koutsiCompareIsoWeeks(week, now) === 0;
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, week);
  const { covered, pool, missing, upcoming } = status;
  const carry = status.carry;
  const all = pool.length > 0 && covered === pool.length;
  const next = upcoming[0];
  const nextGroup = next ? state.groups.find((g) => g.id === next.groupId) : null;
  const go = async () => { setBusy(true); await continueThemes(carry, week); setBusy(false); };
  return (
    <section className="week-hero on-dark court-lines rise">
      <div className="week-hero-top">
        <span className="eyebrow">{isNow ? `Viikko ${week.week}` : `Ensi viikko · vko ${week.week}`} · {koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
        {!acting && (
          <span className="week-hero-tools">
            <NotificationsButton uid={uid} home="/valmentaja/koti" variant="on-dark" />
            {!isDesktop && (
              <Link to="/valmentaja/profiili" className="week-hero-me" aria-label="Profiili ja asetukset">
                <Avatar person={state.coach} size={36} />
              </Link>
            )}
          </span>
        )}
      </div>
      <h1 className="week-hero-title">Moi, {firstName(state.coach.name) || 'valmentaja'}!</h1>
      {state.groups.length === 0 ? (
        <p className="week-hero-sub">Aloita luomalla ryhmä — sen treenit ilmestyvät kalenteriin ja voit asettaa niille viikon teeman.</p>
      ) : (
        <>
          <div className="week-cover">
            <ProgressRing value={pool.length ? covered / pool.length : 0} size={68} stroke={7} tone="lime">
              <span className="week-cover-num t-num">{covered}/{pool.length}</span>
            </ProgressRing>
            <div className="week-cover-text">
              <div className="week-cover-title">{all ? 'Kaikilla ryhmillä on teema' : `${covered}/${pool.length} ryhmällä on viikon teema`}</div>
              <div className="week-cover-sub">
                {all ? 'Pelaajat näkevät, mitä tällä viikolla harjoitellaan.'
                  : next ? `${missing.length} ilman teemaa. ${isNow ? 'Seuraava' : 'Ensimmäinen'}: ${next.date === koutsiTodayStr() ? 'tänään' : relativeDay(next.date).toLowerCase()} klo ${next.time}${nextGroup ? ` · ${nextGroup.name}` : ''}.`
                    : `${missing.length} ryhmää ilman teemaa.`}
              </div>
            </div>
          </div>
          <div className="week-hero-actions">
            {!all && carry.length > 0 && (
              <Button variant="lime" icon="repeat" loading={busy} onClick={go}>Jatka edellisillä ({carry.length})</Button>
            )}
            <Button variant={!all && carry.length > 0 ? 'on-dark' : 'lime'} icon="sparkles" onClick={() => openPlanner({ week })}>
              {all ? 'Viikon teemat' : 'Aseta viikon teemat'}
            </Button>
          </div>
        </>
      )}
    </section>
  );
}

function NextSession({ state }) {
  const today = koutsiTodayStr();
  const after = koutsiAddDays(today, 1);
  const next = state.trainings.filter((t) => t.loggedBy !== 'player' && t.date > after).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  if (!next) return <Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet>;
  const group = next.groupId ? state.groups.find((g) => g.id === next.groupId) : null;
  return (
    <Block eyebrow="Seuraavaksi">
      <SessionRow item={{ training: next, group, student: state.students.find((s) => s.id === next.studentId) }} showDate />
    </Block>
  );
}

function Alerts({ state }) {
  const [extendOpen, setExtendOpen] = useState(false);
  const endings = useMemo(() => calendarEndings(state, 42), [state]);
  const unjoined = useMemo(() => unjoinedPlayers(state), [state]);
  if (!endings.length && !unjoined.length) return null;
  const lasts = endings.map((e) => e.last).filter(Boolean).sort();
  const range = lasts.length ? (lasts[0] === lasts[lasts.length - 1] ? koutsiFmtShortDate(lasts[0]) : `${koutsiFmtShortDate(lasts[0])}–${koutsiFmtShortDate(lasts[lasts.length - 1])}`) : '';
  return (
    <div className="k-alerts stagger">
      {endings.length > 0 && (
        <Card className="k-alert k-alert-warn" style={{ '--i': 0 }}>
          <span className="k-alert-icon"><Icon name="calendar" size={20} /></span>
          <div className="k-alert-body">
            <div className="k-alert-title">Kalenteri loppuu pian</div>
            <p className="k-alert-text">
              {endings.length === 1 ? `Ryhmän ”${endings[0].group.name}” treenit` : `${endings.length} ryhmän treenit`} ovat kalenterissa enää {range} asti. Jatka kalenteria, niin pelaajat näkevät treenit ja teemat jatkossakin.
            </p>
            <Button variant="dark" size="sm" icon="repeat" onClick={() => setExtendOpen(true)}>Jatka kalenteria</Button>
          </div>
        </Card>
      )}
      {unjoined.length > 0 && (
        <Card className="k-alert" style={{ '--i': 1 }}>
          <span className="k-alert-icon is-lime"><Icon name="send" size={19} /></span>
          <div className="k-alert-body">
            <div className="k-alert-title">{unjoined.length === 1 ? '1 pelaaja ei ole vielä liittynyt' : `${unjoined.length} pelaajaa ei ole vielä liittynyt`}</div>
            <p className="k-alert-text">Lähetä jokaiselle oma linkki WhatsAppiin. Liittynyt pelaaja näkee viikon teeman, treenit ja oman kehityksensä.</p>
            <Button variant="dark" size="sm" icon="share" onClick={openInvites}>Lähetä kutsut</Button>
          </div>
        </Card>
      )}
      <ExtendCalendarSheet open={extendOpen} onClose={() => setExtendOpen(false)} groups={endings.map((e) => e.group)} />
    </div>
  );
}

function Activity({ state }) {
  const items = useMemo(() => playerActivity(state, 14).slice(0, 8), [state]);
  return (
    <Block eyebrow="Pelaajilta" title="Viimeiset kaksi viikkoa">
      {items.length === 0 ? (
        <Quiet icon="heart">Pelaajien omat merkinnät näkyvät tässä: fiilikset treenien jälkeen, omat treenit, toiveet ja ottelut.</Quiet>
      ) : (
        <div className="k-list">{items.map((item, i) => <ActivityRow key={`${item.kind}-${item.student.id}-${i}`} item={item} />)}</div>
      )}
    </Block>
  );
}

// The coach's private weekly diary ("Miten treeniviikko sujui?"): the latest weeks, and a way to
// write this week's entry any time (the recap also opens by itself after the week's last session).
function WeekDiary({ state }) {
  const [openWeek, setOpenWeek] = useState(null);
  const current = koutsiCurrentIsoWeek();
  const notes = [...(state.weekNotes || [])].sort((a, b) => b.year - a.year || b.week - a.week);
  const hasCurrent = notes.some((n) => n.year === current.year && n.week === current.week);
  return (
    <Block eyebrow="Vain sinulle" title="Viikkopäiväkirja"
      action={<Button variant="outline" size="sm" icon="edit" onClick={() => setOpenWeek(current)}>{hasCurrent ? 'Tämä viikko' : 'Kirjaa viikko'}</Button>}>
      {notes.length === 0 ? (
        <Quiet icon="edit">Kirjaa viikon päätteeksi, miten treeniviikko sujui. Merkinnät näkyvät vain sinulle, ja niistä näet kauden kulun.</Quiet>
      ) : (
        <div className="k-list">
          {notes.slice(0, 4).map((n) => (
            <button key={`${n.year}-${n.week}`} type="button" className="k-row" onClick={() => setOpenWeek({ year: n.year, week: n.week })}>
              <span className="k-diary-score t-num" data-score={n.score}>{n.score}</span>
              <span className="k-row-main">
                <span className="k-row-title">Vko {n.week} · {MOOD_LABELS[n.score]}</span>
                {n.note && <span className="k-row-sub truncate">{n.note}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <WeekRecapSheet open={Boolean(openWeek)} week={openWeek} onClose={() => setOpenWeek(null)} />
    </Block>
  );
}

function FirstSteps() {
  const [groupOpen, setGroupOpen] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  return (
    <Card className="k-first-steps">
      <h2 className="k-block-title">Aloitetaan</h2>
      <p className="k-quiet-text">Luo ryhmät ja lisää pelaajat — yksitellen tai kaikki kerralla listasta.</p>
      <div className="row wrap">
        <Button variant="dark" icon="plus" onClick={() => setGroupOpen(true)}>Luo ryhmä</Button>
        <Button variant="outline" icon="list" onClick={() => setBulkOpen(true)}>Lisää monta kerralla</Button>
      </div>
      <GroupFormSheet open={groupOpen} onClose={() => setGroupOpen(false)} />
      <BulkSetupSheet open={bulkOpen} onClose={() => setBulkOpen(false)} />
    </Card>
  );
}

export function WeekScreen() {
  const { state } = useData();
  const isDesktop = useIsDesktop();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const today = koutsiTodayStr();
  const tomorrow = koutsiAddDays(today, 1);
  const hasToday = coachSessionsOn(state, today).length > 0;
  const hasTomorrow = coachSessionsOn(state, tomorrow).length > 0;

  const sessions = (
    <div className="stack-5">
      <TodayTimeline state={state} now={now} />
      {!hasToday && !hasTomorrow && <NextSession state={state} />}
    </div>
  );
  const side = (
    <div className="stack-5">
      <Alerts state={state} />
      <Activity state={state} />
      {state.groups.length > 0 && <WeekDiary state={state} />}
    </div>
  );
  return (
    <Page width="wide" className="week-page">
      <div className={isDesktop ? 'week-grid' : 'stack-5'}>
        <div className="stack-5">
          <CoverageHero state={state} />
          {state.groups.length === 0 && state.students.length === 0 ? <FirstSteps /> : sessions}
        </div>
        {side}
      </div>
    </Page>
  );
}
