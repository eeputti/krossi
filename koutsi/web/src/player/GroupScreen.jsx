// GroupScreen (player) — Ryhmäsi (Lisää → Ryhmäsi, or "Ryhmä" on a session). One card per group,
// in the order a player asks: when and with whom, what we work on this week (and next), who is
// in the group (names and photos only — another player's level or anything else from their
// coaching is never shown here), and the coming sessions with "En pääse". The theme history is
// on Kehitys (Treenit on the timeline). ?ryhma=<id> puts that group first.
import { useData } from '../app/data.jsx';
import { Avatar, Button, Card, Disclosure, EmptyState, Icon, Page, PageHeader } from '../ui/index.js';
import { ThemeCard } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiGroupsForStudent, koutsiCoachById, koutsiTimeRangeLabel, koutsiTrainingsForGroup,
  koutsiTodayStr, koutsiAddIsoWeeks, koutsiGroupThemeForWeek, koutsiStudentById,
} from '../domain/core.js';
import { DAY_NAMES, sessionStatus, shortDay, themeWeekShort } from '../domain/week.js';
import { firstName } from '../domain/roster.js';
import { JoinCodeForm } from './PlayerRoot.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

function Mates({ state, group, me }) {
  const people = group.memberIds.map((id) => koutsiStudentById(state, id)).filter(Boolean)
    .sort((a, b) => (a.id === me.id ? -1 : b.id === me.id ? 1 : a.name.localeCompare(b.name, 'fi')));
  if (people.length <= 1) return null;
  return (
    <div className="stack-2">
      <div className="field-label">Ryhmässä {people.length} pelaajaa</div>
      <ul className="pg-mates">
        {people.map((p) => (
          <li key={p.id} className={cx('pg-mate', p.id === me.id && 'is-me')}>
            <Avatar person={p} size={40} />
            <span className="pg-mate-name">{p.id === me.id ? 'Sinä' : firstName(p.name) || p.name}</span>
          </li>
        ))}
      </ul>
    </div>
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
  return (
    <Card className="p-group stack-4" id={`ryhma-${group.id}`}>
      <header>
        <div className="eyebrow">{DAY_NAMES[group.day] || ''} klo {koutsiTimeRangeLabel(group.time, group.durationMinutes)}</div>
        <h2 className="t-h2">{group.name}</h2>
        <p className="k-faint">{[group.level, coach ? `Valmentaja ${coach.name}` : '', (group.slots || []).length ? `myös ${group.slots.map((s) => `${s.day} ${s.time}`).join(', ')}` : ''].filter(Boolean).join(' · ')}</p>
      </header>
      {current ? <ThemeCard theme={current} week={now} />
        : latest ? <ThemeCard theme={latest} eyebrow={`Viimeisin teema · ${themeWeekShort(latest)}`} note="Tämän viikon teema puuttuu vielä." />
          : <p className="k-quiet">Viikon teema ilmestyy tähän, kun valmentaja asettaa sen.</p>}
      {next && <p className="k-next-theme"><Icon name="arrow-right" size={14} /> Ensi viikko: <strong>{next.title}</strong></p>}
      <Mates state={state} group={group} me={me} />
      {upcoming.length > 0 && (
        <div className="stack-2">
          <div className="field-label">Seuraavat treenit</div>
          {upcoming.map((t) => {
            const absent = (t.absences || []).some((a) => a.studentId === me.id);
            const started = sessionStatus(t, group) !== 'upcoming';
            return (
              <div key={t.id} className={cx('p-session', absent && 'is-absent')}>
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
    </Card>
  );
}

export function GroupScreen({ query = {} }) {
  const { state, reload } = useData();
  const me = state.students[0];
  const all = koutsiGroupsForStudent(state, me.id);
  const groups = query.ryhma ? [...all].sort((a, b) => Number(b.id === query.ryhma) - Number(a.id === query.ryhma)) : all;
  if ((state.coaches || []).length === 0) {
    return (
      <Page>
        <PageHeader title="Liity ryhmään" />
        <Card className="stack-4">
          <EmptyState compact art="players" title="Et ole vielä valmentajan ryhmässä" text="Syötä valmentajaltasi saamasi liittymiskoodi, niin näet ryhmäsi treenit ja viikon teeman." />
          <JoinCodeForm onJoined={() => reload()} />
        </Card>
      </Page>
    );
  }
  return (
    <Page>
      <PageHeader title="Ryhmäsi" subtitle="Viikon teema, ryhmäläiset ja seuraavat treenit." />
      <div className="stack-5">
        {groups.length === 0 && <p className="k-quiet-text">Valmentajasi ei ole vielä lisännyt sinua ryhmään.</p>}
        {groups.map((g) => <GroupCard key={g.id} state={state} group={g} me={me} />)}
        {(state.coaches || []).map((c) => (
          <Card key={c.id} className="p-coach">
            <Avatar person={c} size={48} />
            <div className="grow">
              <div className="k-row-title">{c.name}</div>
              <div className="k-faint">{c.tagline || 'Valmentaja'}</div>
              {c.bio && <p className="p-coach-bio">{c.bio}</p>}
              {c.experience && <p className="k-faint">{c.experience}</p>}
              {(c.specialties || []).length > 0 && <div className="row wrap p-coach-chips">{c.specialties.map((s) => <span key={s} className="chip chip-sm chip-neutral">{s}</span>)}</div>}
            </div>
          </Card>
        ))}
        <Disclosure title={groups.length ? 'Liity toiseen ryhmään' : 'Liity ryhmään'} summary="Liittymiskoodilla" icon="plus">
          <JoinCodeForm onJoined={() => reload()} />
        </Disclosure>
      </div>
    </Page>
  );
}
