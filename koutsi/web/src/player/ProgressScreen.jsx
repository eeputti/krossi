// ProgressScreen (player) — "Kehitys": the player's whole development. Goals first (this season's,
// what kind of player they aim to be and where they are heading, the wish to the coach), then this
// month's numbers and the weekly streak, the theme path (what the groups have worked on, week by
// week), and the whole timeline with the player's own entries editable. "Muokkaa" lets the player
// move anything off the timeline into their own "Arkisto" (domain/archive.js); "Tämä viikko" opens
// the month calendar (MonthSheet).
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Link } from '../app/router.js';
import { Button, Card, Icon, IconButton, Page, PageHeader, StatTile, useConfirm, useToast } from '../ui/index.js';
import { Timeline } from '../shared/Timeline.jsx';
import { Block } from '../shared/bits.jsx';
import {
  koutsiCurrentIsoWeek, koutsiCompareIsoWeeks, koutsiGroupsForStudent, koutsiTrainingsForStudent, koutsiGroupById,
  koutsiThemeForDate, koutsiMonthlySummary, KOUTSI_MONTHS,
} from '../domain/core.js';
import { activityStreak, themePath } from '../domain/player.js';
import { ambitionById } from '../domain/playerNow.js';
import { archiveMap } from '../domain/archive.js';
import { koutsiBuildTimeline } from '../domain/timeline.js';
import { ArchiveSheet } from './ArchiveSheet.jsx';
import { MonthSheet, WeekCard } from './MonthSheet.jsx';
import { DRILL_COUNT } from '../shared/drills/useLibrary.js';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** Every goal change keeps the old one on the timeline below; the card says so. */
function earlierGoalsLabel(student) {
  const n = [...(student.goalHistory || []), ...(student.longGoalHistory || [])].filter((h) => h.previousValue).length;
  if (n === 0) return 'Kun vaihdat tavoitetta, vanha jää talteen aikajanalle.';
  return n === 1 ? '1 aiempi tavoite tallessa aikajanalla' : `${n} aiempaa tavoitetta tallessa aikajanalla`;
}

/** Tavoitteet: this season's goal and the long-term aim in one card (pencil → GoalsSheet), the wish beside it. */
function Goals({ student, longReady }) {
  const actions = usePlayerActions();
  const ambition = ambitionById(student.ambition);
  const hasLong = longReady && (ambition || student.longGoal);
  return (
    <div className="two-cards goals-cards">
      <Card interactive onClick={() => actions.openGoals()} className="goal-card">
        <span className="goal-edit"><Icon name="edit" size={14} /><span className="sr-only">Muokkaa</span></span>
        <div className="eyebrow"><Icon name="target" size={13} /> Tavoitteeni</div>
        {student.goal ? <p className="goal-text">{student.goal}</p> : <p className="k-faint">Aseta tavoite — mitä haluat oppia tällä kaudella?</p>}
        {hasLong && (
          <div className="goal-long">
            {ambition && <span className="chip chip-sm goal-aim">{ambition.label}</span>}
            {student.longGoal && <p className="goal-long-text"><span className="k-faint">Pitkällä aikavälillä:</span> {student.longGoal}</p>}
          </div>
        )}
        {longReady && !hasLong && <p className="k-faint goal-long-empty">Mihin tähtäät? Kerro myös pitkän ajan tavoitteesi.</p>}
        {(student.goal || hasLong) && <span className="goal-card-foot">{earlierGoalsLabel(student)}</span>}
      </Card>
      <Card interactive onClick={() => actions.openText('wish')} className="goal-card">
        <span className="goal-edit"><Icon name="edit" size={14} /><span className="sr-only">Muokkaa</span></span>
        <div className="eyebrow"><Icon name="chat" size={13} /> Toive valmentajalle</div>
        {student.playerWish ? <p className="goal-text">{student.playerWish}</p> : <p className="k-faint">Mitä haluaisit harjoitella seuraavaksi?</p>}
      </Card>
    </div>
  );
}

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

function Month({ state, student, calendar }) {
  const now = new Date();
  const m = koutsiMonthlySummary(state, student.id, now.getFullYear(), now.getMonth());
  const count = (keys) => m.categories.filter((c) => keys.includes(c.key)).reduce((s, c) => s + c.count, 0);
  const name = KOUTSI_MONTHS[now.getMonth()];
  const streak = activityStreak(state, student);
  return (
    <Block eyebrow="Tämä kuukausi" title={name.charAt(0).toUpperCase() + name.slice(1)}>
      {calendar}
      <div className="k-stats">
        <StatTile label="Valmennukset" value={count(['ryhmatreeni', 'valmennus'])} />
        <StatTile label="Omat treenit" value={count(['omatoiminen', 'fysiikka', 'muu', 'turnaus'])} tone="lime" />
        <StatTile label="Ottelut" value={m.categories.find((c) => c.key === 'ottelu').count} sub={m.matchWins || m.matchLosses ? `${m.matchWins} V – ${m.matchLosses} T` : undefined} />
        <StatTile label="Treeniaikaa" value={fmtMinutes(m.totalMinutes)} />
      </div>
      <p className="k-streak"><Icon name="flame" size={15} />
        {streak.weeks > 0
          ? <><strong>{streak.weeks === 1 ? '1 viikon putki' : `${streak.weeks} viikon putki`}</strong>{streak.thisWeek ? ' — tämä viikko on jo kirjattu.' : ' — merkitse jotain tällä viikolla, niin putki jatkuu.'}</>
          : 'Merkitse oma treeni, fiilis tai ottelu — siitä alkaa putki.'}
      </p>
    </Block>
  );
}

export function ProgressScreen() {
  const { state, run, ownerId } = useData();
  const actions = usePlayerActions();
  const confirm = useConfirm();
  const toast = useToast();
  const student = state.students[0];
  const archiveOn = Boolean(state.archiveReady);
  const archive = useMemo(() => archiveMap(student.archive), [student.archive]);
  const hidden = useMemo(() => new Set(archive.keys()), [archive]);
  const isHidden = useCallback((e) => archive.has(e.id), [archive]);
  const [editing, setEditing] = useState(false);
  const [sheet, setSheet] = useState(null); // 'archive' | 'month'
  const groups = useMemo(() => koutsiGroupsForStudent(state, student.id), [state, student.id]);
  const trainings = useMemo(() => koutsiTrainingsForStudent(state, student.id).map((t) => {
    const group = t.groupId ? koutsiGroupById(state, t.groupId) : null;
    return { ...t, groupName: group?.name || '', themeTitle: group ? koutsiThemeForDate(group, t.date)?.title || '' : '' };
  }), [state, student.id]);

  const removeMood = async (m) => {
    if (await confirm({ title: 'Poista fiilis?', message: m.note || 'Fiilismerkintä poistetaan.', confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteMood(m.id), 'Fiilis poistettu.');
  };
  const removeEntry = async (e) => {
    if (await confirm({ title: 'Poista merkintä?', message: e.text, confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteEntry(e.id), 'Merkintä poistettu.');
  };
  const removeMatch = async (n) => {
    if (await confirm({ title: 'Poista ottelumuistiinpano?', message: `Vastustaja ${n.opponentName}`, confirmLabel: 'Poista', danger: true })) await run(() => api.player.deleteMatchNote(n.id), 'Muistiinpano poistettu.');
  };
  // With the archive, deleting happens there ("Piilota" → Arkisto → Poista); the rows keep only
  // their edit buttons. Without it (no table yet) the old trash buttons stay.
  const trash = (fn) => (archiveOn ? null : <IconButton icon="trash" label="Poista" size="sm" onClick={fn} />);
  const renderActions = (event) => {
    if (event.kind === 'mood') {
      const m = event.source;
      return (
        <>
          <IconButton icon={m.hiddenFromCoach ? 'eye' : 'lock'} label={m.hiddenFromCoach ? 'Näytä valmentajalle' : 'Piilota valmentajalta'} size="sm"
            onClick={() => run(() => api.player.setMoodHidden(m.id, !m.hiddenFromCoach), m.hiddenFromCoach ? 'Fiilis näkyy nyt valmentajalle.' : 'Fiilis piilotettu valmentajalta.')} />
          {trash(() => removeMood(m))}
        </>
      );
    }
    if (event.kind === 'entry') {
      return (
        <>
          <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => actions.openEntry(event.source)} />
          {trash(() => removeEntry(event.source))}
        </>
      );
    }
    if (event.kind === 'match') {
      return (
        <>
          <IconButton icon="edit" label="Muokkaa" size="sm" onClick={() => actions.openMatch({ editing: event.source })} />
          {trash(() => removeMatch(event.source))}
        </>
      );
    }
    return null;
  };
  const toArchive = async (e) => {
    const res = await run(() => api.player.archiveItem(ownerId, e.id));
    if (res.ok) toast('Siirretty arkistoon.', { action: { label: 'Kumoa', onClick: () => run(() => api.player.unarchiveItem(ownerId, e.id)) }, duration: 5000 });
  };
  const allEvents = useMemo(() => koutsiBuildTimeline(student, trainings, state.clubEvents), [student, trainings, state.clubEvents]);
  const archivedCount = (student.archive || []).filter((a) => !a.removedAt && allEvents.some((e) => e.id === a.key)).length;

  return (
    <Page>
      <PageHeader title="Kehitys" subtitle="Tavoitteesi ja kaikki, mitä olet tehnyt — viikko viikolta." />
      <div className="stack-6">
        <Goals student={student} longReady={Boolean(state.longGoalReady)} />
        <Month state={state} student={student} calendar={<WeekCard hidden={hidden} onOpen={() => setSheet('month')} />} />
        <ThemePath groups={groups} />
        <Link to="/pelaaja/harjoitteet" className="k-row">
          <span className="k-ex-icon"><Icon name="play" size={16} /></span>
          <span className="k-row-main">
            <span className="k-row-title">Harjoitteet ja videot</span>
            <span className="k-row-sub">{`${DRILL_COUNT} harjoitetta, valmentajan videot ja omat videosi`}</span>
          </span>
          <Icon name="chevron-right" size={18} className="k-chevron" />
        </Link>
        <Block eyebrow="Aikajana" title="Kaikki merkinnät">
          <Timeline
            student={student} trainings={trainings} clubEvents={state.clubEvents} showStats={false}
            onOpenVideo={actions.playVideo} renderActions={renderActions}
            isHidden={archiveOn ? isHidden : undefined} onArchive={archiveOn && editing ? toArchive : undefined}
            actions={editing ? (
              <>
                <p className="tl-editing-note grow">Piilota, mitä et halua kehitykseesi. Piilotetut siirtyvät arkistoon, jonka vain sinä näet.</p>
                <Button variant="dark" size="sm" icon="check" onClick={() => setEditing(false)}>Valmis</Button>
              </>
            ) : (
              <>
                {state.entriesReady && <Button variant="dark" size="sm" icon="plus" onClick={() => actions.openEntry()}>Merkintä</Button>}
                <Button variant="ghost" size="sm" icon="play" onClick={() => actions.openVideo()}>Video</Button>
                <span className="grow" />
                {archiveOn && <Button variant="outline" size="sm" icon="edit" onClick={() => setEditing(true)}>Muokkaa</Button>}
                {archiveOn && archivedCount > 0 && <Button variant="ghost" size="sm" icon="archive" onClick={() => setSheet('archive')}>Arkisto ({archivedCount})</Button>}
              </>
            )}
            emptyText="Aikajanasi on vielä tyhjä. Tänne kertyvät ryhmäsi teemat, treenit, valmentajan huomiot, tavoitteet, omat merkintäsi, fiilikset ja ottelut."
          />
        </Block>
      </div>
      <MonthSheet open={sheet === 'month'} onClose={() => setSheet(null)} hidden={hidden} />
      {archiveOn && <ArchiveSheet open={sheet === 'archive'} onClose={() => setSheet(null)} events={allEvents} archive={archive} />}
    </Page>
  );
}
