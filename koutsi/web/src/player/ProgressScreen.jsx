// ProgressScreen (player) — "Kehitys": the theme path (what the groups have worked on, week by
// week), this month's numbers, and the whole timeline with the player's own entries editable.
import { useMemo } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link } from '../app/router.js';
import { Button, Card, Icon, IconButton, Page, PageHeader, StatTile, useConfirm } from '../ui/index.js';
import { Timeline } from '../shared/Timeline.jsx';
import { Block } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiCompareIsoWeeks, koutsiGroupsForStudent, koutsiTrainingsForStudent, koutsiGroupById,
  koutsiThemeForDate, koutsiMonthlySummary, KOUTSI_MONTHS,
} from '../domain/core.js';
import { themePath } from '../domain/player.js';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

function ThemePath({ groups }) {
  const now = koutsiCurrentIsoWeek();
  const path = themePath(groups, now, 14);
  if (!path.length) return null;
  return (
    <Block eyebrow="Teemapolku" title="Mitä olemme harjoitelleet">
      <ol className="theme-path" aria-label="Teemat viikoittain">
        {path.map((w) => {
          const current = koutsiCompareIsoWeeks(w, now) === 0;
          return (
            <li key={`${w.year}-${w.week}`} className={cx('theme-path-step', current && 'is-now')}>
              <span className="theme-path-week">vko {w.week}</span>
              <span className="theme-path-dot" aria-hidden="true" />
              <span className="theme-path-title">{w.titles.join(' / ')}</span>
            </li>
          );
        })}
      </ol>
    </Block>
  );
}

/** 45 → "45 min", 540 → "9 h", 135 → "2 h 15 min" */
function fmtMinutes(min) {
  if (!min) return '0 min';
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rest = min % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

function Month({ state, student }) {
  const now = new Date();
  const m = koutsiMonthlySummary(state, student.id, now.getFullYear(), now.getMonth());
  const count = (keys) => m.categories.filter((c) => keys.includes(c.key)).reduce((s, c) => s + c.count, 0);
  const name = KOUTSI_MONTHS[now.getMonth()];
  return (
    <Block eyebrow="Tämä kuukausi" title={name.charAt(0).toUpperCase() + name.slice(1)}>
      <div className="k-stats">
        <StatTile label="Valmennukset" value={count(['ryhmatreeni', 'valmennus'])} />
        <StatTile label="Omat treenit" value={count(['omatoiminen', 'fysiikka', 'muu', 'turnaus'])} tone="lime" />
        <StatTile label="Ottelut" value={m.categories.find((c) => c.key === 'ottelu').count} sub={m.matchWins || m.matchLosses ? `${m.matchWins} V – ${m.matchLosses} T` : undefined} />
        <StatTile label="Treeniaikaa" value={fmtMinutes(m.totalMinutes)} />
      </div>
    </Block>
  );
}

export function ProgressScreen() {
  const { state, run } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  const student = state.students[0];
  const groups = useMemo(() => koutsiGroupsForStudent(state, student.id), [state, student.id]);
  const trainings = useMemo(() => koutsiTrainingsForStudent(state, student.id).map((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    return { ...t, groupName: group?.name || '', themeTitle: group ? koutsiThemeForDate(group, t.date)?.title || '' : '' };
  }), [state, student.id]);

  const removeMood = async (m) => {
    if (await confirm({ title: 'Poista fiilis?', message: m.note || 'Fiilismerkintä poistetaan.', confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteMood(m.id), 'Fiilis poistettu.');
  };
  const removeMatch = async (n) => {
    if (await confirm({ title: 'Poista ottelumuistiinpano?', message: `Vastustaja ${n.opponentName}`, confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteMatchNote(n.id), 'Muistiinpano poistettu.');
  };
  const renderActions = (event) => {
    if (event.kind === 'mood') {
      const m = event.source;
      return (
        <>
          <IconButton icon={m.hiddenFromCoach ? 'eye' : 'lock'} label={m.hiddenFromCoach ? 'Näytä valmentajalle' : 'Piilota valmentajalta'} size="sm"
            onClick={() => run(() => api.player.setMoodHidden(m.id, !m.hiddenFromCoach), m.hiddenFromCoach ? 'Fiilis näkyy nyt valmentajalle.' : 'Fiilis piilotettu valmentajalta.')} />
          <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeMood(m)} />
        </>
      );
    }
    if (event.kind === 'match') {
      return (
        <>
          <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => actions.openMatch({ editing: event.source })} />
          <IconButton icon="trash" label="Poista" size="sm" onClick={() => removeMatch(event.source)} />
        </>
      );
    }
    return null;
  };

  return (
    <Page>
      <PageHeader title="Kehitys" subtitle="Viikko viikolta: teemat, treenit, valmentajan huomiot, tavoitteet ja ottelut." />
      <div className="stack-6">
        <ThemePath groups={groups} />
        <Card interactive onClick={() => actions.openText('goal')} className="goal-card">
          <div className="eyebrow">Tavoitteeni</div>
          {student.goal ? <p className="goal-text">{student.goal}</p> : <p className="k-faint">Aseta tavoite — se näkyy aikajanalla ja valmentajallesi.</p>}
        </Card>
        <Month state={state} student={student} />
        <Link to="/pelaaja/harjoitteet" className="k-row">
          <span className="k-ex-icon"><Icon name="play" size={16} /></span>
          <span className="k-row-main">
            <span className="k-row-title">Harjoitteet ja videot</span>
            <span className="k-row-sub">{state.exercises.length ? `Valmentajan ${state.exercises.length} harjoitetta ja omat videosi` : 'Omat videosi ja valmentajan jakamat'}</span>
          </span>
          <Icon name="chevron-right" size={18} className="k-chevron" />
        </Link>
        <Block eyebrow="Aikajana" title="Kaikki merkinnät">
          <Timeline
            student={student} trainings={trainings} clubEvents={state.clubEvents} showStats={false}
            onOpenVideo={actions.playVideo} renderActions={renderActions}
            actions={(
              <>
                <Button variant="dark" size="sm" icon="heart" onClick={() => actions.openMood()}>Fiilis</Button>
                <Button variant="outline" size="sm" icon="trophy" onClick={() => actions.openMatch()}>Ottelu</Button>
                <Button variant="outline" size="sm" icon="plus" onClick={() => actions.openSelfTraining()}>Oma treeni</Button>
                <Button variant="ghost" size="sm" icon="play" onClick={() => actions.openVideo()}>Video</Button>
              </>
            )}
            emptyText="Aikajanasi on vielä tyhjä. Tänne kertyvät ryhmäsi teemat, treenit, valmentajan huomiot, tavoitteet, fiilikset ja ottelut."
          />
        </Block>
      </div>
    </Page>
  );
}
