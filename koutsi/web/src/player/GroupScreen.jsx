// GroupScreen (player) — one card per group: schedule, coach, this week's theme and what the
// group has worked on, the next sessions, and the group mates (names only — another player's
// level or anything else from their coaching is never shown here).
import { useData } from '../app/data.jsx';
import { Avatar, AvatarStack, Button, Card, Disclosure, EmptyState, Icon, Page, TopBar } from '../ui/index.js';
import { ThemeCard, useShowMore } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiGroupsForStudent, koutsiCoachById, koutsiTimeRangeLabel, koutsiTrainingsForGroup,
  koutsiTodayStr, koutsiAddIsoWeeks, koutsiGroupThemeForWeek, koutsiStudentById,
} from '../domain/core.js';
import { DAY_NAMES, sessionStatus, shortDay, themeWeekShort } from '../domain/week.js';
import { JoinCodeForm } from './PlayerRoot.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

function History({ themes }) {
  const [shown, more] = useShowMore(themes || [], 8);
  if (!themes?.length) return null;
  return (
    <Disclosure title="Teemahistoria" summary={themes.length === 1 ? '1 viikko' : `${themes.length} viikkoa`} icon="clock">
      <ul className="k-history">{shown.map((t) => <li key={t.id} className="k-history-row"><span className="k-history-week">{themeWeekShort(t)}</span><span className="grow">{t.title}{t.lead && <span className="k-faint"> — {t.lead}</span>}</span></li>)}</ul>
      {more}
    </Disclosure>
  );
}

function GroupCard({ state, group, me }) {
  const actions = usePlayerActions();
  const now = koutsiCurrentIsoWeek();
  const current = koutsiGroupThemeForWeek(group, now);
  const latest = (group.pastThemes || [])[0];
  const next = koutsiGroupThemeForWeek(group, koutsiAddIsoWeeks(now, 1));
  const coach = koutsiCoachById(state, group.coachId);
  // sessions that haven't ended yet; "En pääse" only until a session starts
  const upcoming = koutsiTrainingsForGroup(state, group.id)
    .filter((t) => t.date >= koutsiTodayStr() && sessionStatus(t, group) !== 'past').slice(0, 3);
  const mates = group.memberIds.filter((id) => id !== me.id).map((id) => koutsiStudentById(state, id)).filter(Boolean);
  return (
    <Card className="p-group stack-4">
      <header>
        <div className="eyebrow">{DAY_NAMES[group.day] || ''} klo {koutsiTimeRangeLabel(group.time, group.durationMinutes)}</div>
        <h2 className="t-h2">{group.name}</h2>
        <p className="k-faint">{[group.level, coach ? `Valmentaja ${coach.name}` : '', (group.slots || []).length ? `myös ${group.slots.map((s) => `${s.day} ${s.time}`).join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
      </header>
      {current ? <ThemeCard theme={current} week={now} />
        : latest ? <ThemeCard theme={latest} eyebrow={`Viimeisin teema · ${themeWeekShort(latest)}`} note="Tämän viikon teema puuttuu vielä." />
          : <p className="k-quiet">Viikon teema ilmestyy tähän, kun valmentaja asettaa sen.</p>}
      {next && <p className="k-next-theme"><Icon name="arrow-right" size={14} /> Ensi viikko: <strong>{next.title}</strong></p>}
      <History themes={group.pastThemes} />
      {upcoming.length > 0 && (
        <div className="stack-2">
          <div className="field-label">Seuraavat treenit</div>
          {upcoming.map((t) => {
            const absent = (t.absences || []).some((a) => a.studentId === me.id);
            const started = sessionStatus(t, group) !== 'upcoming';
            return (
              <div key={t.id} className="p-session">
                <span className="grow">
                  <span className="k-row-title">{t.date === koutsiTodayStr() ? 'Tänään' : shortDay(t.date)}</span>
                  <span className="k-faint">klo {koutsiTimeRangeLabel(t.time, t.durationMinutes || group.durationMinutes)}{started ? ' · käynnissä' : ''}</span>
                </span>
                {started ? null : absent
                  ? <Button variant="ghost" size="sm" onClick={() => actions.openAbsence(t)}>Poissa · muuta</Button>
                  : <Button variant="outline" size="sm" onClick={() => actions.openAbsence(t)}>En pääse</Button>}
              </div>
            );
          })}
        </div>
      )}
      {mates.length > 0 && (
        <div className="stack-2">
          <div className="field-label">Ryhmässä ({group.memberIds.length})</div>
          <div className="p-mates">
            <AvatarStack people={mates} max={6} size={30} />
            <span className="k-faint truncate">{mates.slice(0, 4).map((m) => m.name.split(' ')[0]).join(', ')}{mates.length > 4 ? ` ja ${mates.length - 4} muuta` : ''}</span>
          </div>
        </div>
      )}
    </Card>
  );
}

export function GroupScreen() {
  const { state, reload } = useData();
  const me = state.students[0];
  const groups = koutsiGroupsForStudent(state, me.id);
  if ((state.coaches || []).length === 0) {
    return (
      <>
      <TopBar title="Liity ryhmään" back="/pelaaja/koti" />
      <Page className="k-page-pad">
        <Card className="stack-4">
          <EmptyState compact art="players" title="Et ole vielä valmentajan ryhmässä" text="Syötä valmentajaltasi saamasi liittymiskoodi, niin näet ryhmäsi treenit ja viikon teeman." />
          <JoinCodeForm onJoined={() => reload()} />
        </Card>
      </Page>
      </>
    );
  }
  return (
    <>
    <TopBar title="Ryhmäsi" back="/pelaaja/koti" />
    <Page className="k-page-pad">
      <div className="stack-5">
        {groups.length === 0 && <p className="k-quiet-text">Valmentajasi ei ole vielä lisännyt sinua ryhmään.</p>}
        {groups.map((g) => <GroupCard key={g.id} state={state} group={g} me={me} />)}
        {(state.coaches || []).map((c) => (
          <Card key={c.id} className="p-coach">
            <Avatar person={c} size={48} />
            <div className="grow"><div className="k-row-title">{c.name}</div><div className="k-faint">{c.tagline || 'Valmentaja'}</div></div>
          </Card>
        ))}
        <Disclosure title={groups.length ? 'Liity toiseen ryhmään' : 'Liity ryhmään'} summary="Liittymiskoodilla" icon="plus">
          <JoinCodeForm onJoined={() => reload()} />
        </Disclosure>
      </div>
    </Page>
    </>
  );
}
