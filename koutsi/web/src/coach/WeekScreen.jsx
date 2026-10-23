// WeekScreen — the coach's home ("Koti"): what a weekly visit needs, in order. On a phone the
// avatar in the corner is the way to Profiili (the tab bar's middle is "Merkitse").
//   1. this week's theme coverage, with the one- or two-tap fix
//   2. today on a timeline — over, running, still to come — then tomorrow in one line
//   3. things that need the coach: calendars running out, players who haven't joined
//   4. what players did lately
import { useMemo, useState } from 'react';
import { useData } from '../app/data.jsx';
import { useIsDesktop, useNow } from '../app/hooks.js';
import { Avatar, Button, Card, Icon, Page } from '../ui/index.js';
import { Link, navigate } from '../app/router.js';
import { NotificationsButton } from '../shared/Notifications.jsx';
import { Block, Quiet } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiCompareIsoWeeks, koutsiIsoWeekRangeLabel, koutsiTodayStr, koutsiAddDays,
  koutsiWeekThemeStatus, koutsiFmtShortDate, koutsiIsoWeekOfDateStr,
} from '../domain/core.js';
import { calendarEndings, coachSessionsOn, playerActivity, plannerDefaultWeek, unjoinedPlayers, weekParam } from '../domain/week.js';
import { weekGlance } from '../domain/glance.js';
import { firstName } from '../domain/roster.js';
import { useCoach } from './CoachRoot.jsx';
import { openInvites, openSeason, playerPath } from './nav.js';
import { currentSeason, draftSummary, groupsOfSeason, nextSeasonPreset, seasonNudge, seasonWord } from '../domain/season.js';
import { ActivityRow, SessionRow } from './parts.jsx';
import { useContinueThemes } from './themeActions.js';
import { ExtendCalendarSheet, GroupFormSheet } from './groupForms.jsx';
import { SeasonEditSheet } from './SeasonSheet.jsx';
import { WeekRecapSheet } from './WeekRecapSheet.jsx';
import { MOOD_LABELS } from '../lib/constants.js';
import { BulkSetupSheet } from './BulkSetupSheet.jsx';
import { TodayTimeline } from './today.jsx';
import { useRecord } from './merkitse.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');
const pct = (x) => (x == null ? '–' : `${Math.round(x * 100)}\u00a0%`);
const dec = (x) => (x == null ? '–' : x.toFixed(1).replace('.', ','));

// EHDOTUS (haara koutsi-selkeys): the dark top card is the week at one glance — every day with a
// dot per session (lime = held, ring = on now, outline = to come, clay = still without a theme),
// four numbers (held, attendance, the players' own trainings, feeling) and the theme status
// with its one-tap fix. A day opens Viikkohallinta on that week.
function WeekHero({ state, glance, week }) {
  const { uid, acting } = useCoach();
  const isDesktop = useIsDesktop();
  const continueThemes = useContinueThemes();
  const record = useRecord();
  const [busy, setBusy] = useState(false);
  const themeWeek = plannerDefaultWeek();
  const isNow = koutsiCompareIsoWeeks(themeWeek, week) === 0;
  const status = koutsiWeekThemeStatus(state.groups, state.trainings, themeWeek);
  const { covered, pool, carry } = status;
  const all = pool.length > 0 && covered === pool.length;
  const go = async () => { setBusy(true); await continueThemes(carry, themeWeek); setBusy(false); };
  const openWeek = () => navigate(`/valmentaja/ryhmat?vko=${weekParam(week)}`);
  return (
    <section className="week-hero on-dark wk-hero rise">
      <div className="week-hero-top">
        <span className="eyebrow">Viikko {week.week} · {koutsiIsoWeekRangeLabel(week.year, week.week)}</span>
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
          <div className="wk-days" role="list" aria-label="Viikon päivät">
            {glance.days.map((d) => (
              <button key={d.date} type="button" role="listitem" onClick={openWeek}
                className={cx('wk-day', d.isToday && 'is-today', d.isPast && 'is-past', !d.sessions.length && 'is-empty')}
                aria-label={`${d.label} ${d.day}.: ${d.sessions.length} treeniä`}>
                <span className="wk-day-name">{d.label}</span>
                <span className="wk-day-num t-num">{d.day}</span>
                <span className="wk-day-dots" aria-hidden="true">
                  {d.sessions.slice(0, 4).map((x) => <span key={x.id} className={cx('wk-dot', `is-${x.status}`, x.themeMissing && x.status !== 'past' && 'is-warn')} />)}
                </span>
              </button>
            ))}
          </div>
          <div className="wk-stats">
            <div className="wk-stat"><span className="wk-stat-num t-num">{glance.held}/{glance.sessions}</span><span className="wk-stat-label">treeniä pidetty</span></div>
            <div className="wk-stat"><span className="wk-stat-num t-num">{pct(glance.attendance)}</span><span className="wk-stat-label">läsnä</span></div>
            <div className="wk-stat"><span className="wk-stat-num t-num">{glance.own}</span><span className="wk-stat-label">omaa treeniä</span></div>
            <div className="wk-stat"><span className="wk-stat-num t-num">{dec(glance.moodAverage)}</span><span className="wk-stat-label">fiilis</span></div>
          </div>
          <div className={cx('wk-theme', all && 'is-ok')}>
            <button type="button" className="wk-theme-open" onClick={() => record.openMerkinta({ kind: 'teema' })}>
              <span className="wk-theme-icon"><Icon name={all ? 'check' : 'sparkles'} size={15} strokeWidth={all ? 3 : 2} /></span>
              <span className="wk-theme-text">
                <span className="wk-theme-title">Viikon teemat{isNow ? '' : ` · vko ${themeWeek.week}`}<Icon name="chevron-right" size={15} /></span>
                <span className="wk-theme-sub">{all ? 'Kaikilla ryhmillä on teema' : `${covered}/${pool.length} ryhmällä`}</span>
              </span>
            </button>
            {!all && (carry.length > 0 ? (
              <Button variant="lime" size="sm" icon="repeat" loading={busy} onClick={go}>Jatka edellisillä</Button>
            ) : (
              <Button variant="lime" size="sm" icon="sparkles" onClick={() => record.openMerkinta({ kind: 'teema' })}>Aseta</Button>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

// Who trained the most this week, and who missed their last two sessions — facts, one tap to
// the player's card.
function WeekPlayers({ glance }) {
  if (!glance.active.length && !glance.missedTwice.length) return null;
  const chip = (s, extra) => (
    <Link key={s.id} to={playerPath(s.id)} className="wp-chip">
      <Avatar person={s} size={24} />
      <span className="wp-chip-name">{s.name}</span>
      {extra}
    </Link>
  );
  return (
    <Block eyebrow="Pelaajat" title="Tällä viikolla">
      <div className="wp">
        {glance.active.length > 0 && (
          <div className="wp-row">
            <span className="wp-label"><Icon name="flame" size={14} />Ahkerimmat</span>
            <div className="wp-people">{glance.active.map((a) => chip(a.student, <strong className="wp-chip-count t-num">{a.times} krt</strong>))}</div>
          </div>
        )}
        {glance.missedTwice.length > 0 && (
          <div className="wp-row">
            <span className="wp-label is-warn"><Icon name="alert" size={14} />Poissa kahdesti peräkkäin</span>
            <div className="wp-people">{glance.missedTwice.slice(0, 4).map((s) => chip(s, null))}</div>
          </div>
        )}
      </div>
    </Block>
  );
}

function NextSession({ state }) {
  const today = koutsiTodayStr();
  const after = koutsiAddDays(today, 1);
  const next = state.trainings.filter((t) => t.loggedBy !== 'player' && t.date > after).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`))[0];
  if (!next) return <Quiet icon="calendar">Ei tulevia treenejä kalenterissa.</Quiet>;
  const group = next.groupId ? (state.allGroups || state.groups).find((g) => g.id === next.groupId) : null;
  return (
    <Block eyebrow="Seuraavaksi">
      <SessionRow item={{ training: next, group, student: state.students.find((s) => s.id === next.studentId) }} showDate />
    </Block>
  );
}

// The season is ending: plan the next one (a copy of this one, see SeasonSheet), carry on with
// the saved draft, or — once it is published — see when it starts.
function SeasonCard({ state, nudge }) {
  const { season, next, draft, kind } = nudge;
  const [editOpen, setEditOpen] = useState(false);
  const preset = next || draft || nextSeasonPreset(season);
  const base = seasonWord(preset.startsOn);
  if (kind === 'published') {
    const count = groupsOfSeason(state, next).length;
    return (
      <>
      <Card className="k-alert season-alert">
        <span className="k-alert-icon is-lime"><Icon name="check" size={20} /></span>
        <div className="k-alert-body">
          <div className="k-alert-title">{next.name} on julkaistu</div>
          <p className="k-alert-text">Alkaa {koutsiFmtShortDate(next.startsOn)} · {count} ryhmää. {season.name} jatkuu {koutsiFmtShortDate(season.endsOn)} asti.</p>
          <div className="row wrap season-alert-actions">
            <Button variant="outline" size="sm" icon="calendar" onClick={() => navigate(`/valmentaja/ryhmat?vko=${weekParam(koutsiIsoWeekOfDateStr(next.startsOn))}`)}>Kauden ensimmäinen viikko</Button>
            <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Muuta {seasonWord(season.startsOn, 'gen')} loppua</Button>
          </div>
        </div>
      </Card>
      <SeasonEditSheet open={editOpen} onClose={() => setEditOpen(false)} season={season} />
      </>
    );
  }
  const changes = kind === 'draft' ? draftSummary(state, draft).changes : 0;
  return (
    <>
    <Card className="k-alert season-alert">
      <span className="k-alert-icon is-lime"><Icon name="repeat" size={19} /></span>
      <div className="k-alert-body">
        <div className="k-alert-title">{kind === 'draft' ? `${draft.name} · luonnos` : `${season.name} loppuu ${koutsiFmtShortDate(season.endsOn)}`}</div>
        <p className="k-alert-text">
          {kind === 'draft'
            ? `${changes === 1 ? '1 muutos' : `${changes} muutosta`} tallessa. Pelaajat eivät näe luonnosta — julkaise, kun ryhmät ovat valmiit.`
            : `Tee ${seasonWord(preset.startsOn, 'gen')} ryhmät valmiiksi jo nyt: ryhmät ja pelaajat jatkavat sellaisinaan, muutat vain sen mikä muuttuu. Pelaajat näkevät ${seasonWord(preset.startsOn, 'gen')} vasta kun julkaiset.`}
        </p>
        <div className="row wrap season-alert-actions">
          <Button variant="dark" size="sm" icon={kind === 'draft' ? 'edit' : 'calendar-plus'} onClick={openSeason}>{kind === 'draft' ? 'Jatka suunnittelua' : `Suunnittele ${base}`}</Button>
          <Button variant="ghost" size="sm" onClick={() => setEditOpen(true)}>Muuta loppua</Button>
        </div>
      </div>
    </Card>
    <SeasonEditSheet open={editOpen} onClose={() => setEditOpen(false)} season={season} />
    </>
  );
}

function Alerts({ state }) {
  const [extendOpen, setExtendOpen] = useState(false);
  const nudge = useMemo(() => seasonNudge(state), [state]);
  const endings = useMemo(() => {
    const all = calendarEndings(state, 42);
    const season = state.seasonsReady ? currentSeason(state) : null;
    if (!season) return all;
    // a group that runs to the season's end is the season card's business, not a missing calendar
    const seasonLast = koutsiAddDays(season.endsOn, -6);
    return all.filter((e) => (!e.group.seasonId || e.group.seasonId === season.id) && !(e.last && e.last >= seasonLast));
  }, [state]);
  const unjoined = useMemo(() => unjoinedPlayers(state), [state]);
  if (!nudge && !endings.length && !unjoined.length) return null;
  const lasts = endings.map((e) => e.last).filter(Boolean).sort();
  const range = lasts.length ? (lasts[0] === lasts[lasts.length - 1] ? koutsiFmtShortDate(lasts[0]) : `${koutsiFmtShortDate(lasts[0])}–${koutsiFmtShortDate(lasts[lasts.length - 1])}`) : '';
  return (
    <div className="k-alerts stagger">
      {nudge && <SeasonCard state={state} nudge={nudge} />}
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
  const week = koutsiCurrentIsoWeek();
  const glance = useMemo(() => weekGlance(state, week, now), [state, nowMs]); // eslint-disable-line react-hooks/exhaustive-deps

  const sessions = (
    <div className="stack-5">
      <TodayTimeline state={state} now={now} />
      {!hasToday && !hasTomorrow && <NextSession state={state} />}
      <WeekPlayers glance={glance} />
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
          <WeekHero state={state} glance={glance} week={week} />
          {state.groups.length === 0 && state.students.length === 0 ? <FirstSteps /> : sessions}
        </div>
        {side}
      </div>
    </Page>
  );
}
