// ProgressScreen (player) — "Kehitys", at one glance: this season's goal (a tap opens the rest —
// what kind of player the player aims to be, the long-term goal, the earlier goals), the wish to
// the coach, this week (it opens the month calendar with its numbers), and the timeline. The
// timeline filters in four: Kaikki · Treenit (every session with its theme — the theme history) ·
// Valmentajalta · Omat. "Muokkaa" lets the player move anything off the timeline into their own
// "Arkisto" (domain/archive.js).
import { useCallback, useMemo, useState } from 'react';
import { api } from '../api/index.js';
import { useData } from '../app/data.jsx';
import { Button, Card, Icon, IconButton, Page, PageHeader, useConfirm, useToast } from '../ui/index.js';
import { Timeline } from '../shared/Timeline.jsx';
import { Block } from '../shared/bits.jsx';
import { koutsiTrainingsForStudent, koutsiGroupById, koutsiThemeForDate, koutsiFmtShortDate } from '../domain/core.js';
import { ambitionById } from '../domain/playerNow.js';
import { archiveMap } from '../domain/archive.js';
import { koutsiBuildTimeline } from '../domain/timeline.js';
import { ArchiveSheet } from './ArchiveSheet.jsx';
import { MonthSheet, WeekCard } from './MonthSheet.jsx';
import { usePlayerActions } from './PlayerApp.jsx';

const cx = (...c) => c.filter(Boolean).join(' ');

/** The goals the player has changed away from, newest first: { text, at }. */
function earlierGoals(student) {
  return (student.goalHistory || []).filter((h) => h.previousValue)
    .map((h) => ({ id: h.id, text: h.previousValue, at: h.at }))
    .sort((a, b) => String(b.at).localeCompare(String(a.at)));
}

/**
 * Tavoitteeni: only this season's goal at a glance. A tap opens the rest in place — "Mihin
 * tähtäät?", the long-term goal and the earlier goals; the pencil (or "Muokkaa") edits them.
 */
function GoalCard({ student, longReady }) {
  const actions = usePlayerActions();
  const [open, setOpen] = useState(false);
  const ambition = longReady ? ambitionById(student.ambition) : null;
  const longGoal = longReady ? student.longGoal : '';
  const earlier = earlierGoals(student);
  const hasMore = Boolean(ambition || longGoal || earlier.length || longReady);
  if (!student.goal) {
    return (
      <Card interactive onClick={() => actions.openGoals()} className="goal-card pk-goal">
        <span className="goal-edit"><Icon name="edit" size={14} /><span className="sr-only">Muokkaa</span></span>
        <div className="eyebrow"><Icon name="target" size={13} /> Tavoitteeni</div>
        <p className="k-faint">Aseta tavoite — mitä haluat oppia tällä kaudella?</p>
      </Card>
    );
  }
  return (
    <Card className={cx('goal-card pk-goal', open && 'is-open')}>
      <button type="button" className="pk-goal-head" onClick={() => hasMore && setOpen((v) => !v)} aria-expanded={hasMore ? open : undefined}>
        <span className="eyebrow"><Icon name="target" size={13} /> Tavoitteeni</span>
        <span className="goal-text">{student.goal}</span>
        {hasMore && <span className="pk-goal-more">{open ? 'Piilota' : 'Näytä tähtäin ja pitkän ajan tavoite'}<Icon name={open ? 'chevron-up' : 'chevron-down'} size={15} /></span>}
      </button>
      <button type="button" className="goal-edit" onClick={() => actions.openGoals()} aria-label="Muokkaa tavoitteita"><Icon name="edit" size={14} /></button>
      {open && (
        <div className="pk-goal-body">
          <div className="pk-goal-row">
            <span className="field-label">Mihin tähtäät?</span>
            {ambition ? <span className="pk-aim"><span className="chip chip-sm goal-aim">{ambition.label}</span><span className="k-faint">{ambition.sub}</span></span>
              : <span className="k-faint">Ei vielä valittu.</span>}
          </div>
          <div className="pk-goal-row">
            <span className="field-label">Pitkän ajan tavoite</span>
            {longGoal ? <p className="goal-long-text">{longGoal}</p> : <span className="k-faint">Mihin haluat tenniksessä päästä parin vuoden päästä?</span>}
          </div>
          {earlier.length > 0 && (
            <div className="pk-goal-row">
              <span className="field-label">Aiemmat tavoitteet</span>
              <ul className="pk-earlier">
                {earlier.slice(0, 3).map((g) => <li key={g.id}><span>{g.text}</span><span className="k-faint t-num">{g.at ? `vaihdettu ${koutsiFmtShortDate(String(g.at).slice(0, 10))}` : ''}</span></li>)}
              </ul>
              {earlier.length > 3 && <span className="k-faint">Loput löytyvät aikajanalta (Omat).</span>}
            </div>
          )}
          <div><Button variant="outline" size="sm" icon="edit" onClick={() => actions.openGoals()}>Muokkaa tavoitteita</Button></div>
        </div>
      )}
    </Card>
  );
}

/** Toive valmentajalle: what the player would like to work on next (every coach sees it). */
function WishCard({ student }) {
  const actions = usePlayerActions();
  return (
    <Card interactive onClick={() => actions.openText('wish')} className="goal-card pk-wish">
      <span className="goal-edit"><Icon name="edit" size={14} /><span className="sr-only">Muokkaa</span></span>
      <div className="eyebrow"><Icon name="chat" size={13} /> Toive valmentajalle</div>
      {student.playerWish ? <p className="goal-text">{student.playerWish}</p> : <p className="k-faint">Mitä haluaisit harjoitella seuraavaksi?</p>}
    </Card>
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
      <PageHeader title="Kehitys" subtitle="Tavoitteesi ja kaikki, mitä olet tehnyt." />
      <div className="stack-6">
        <div className="two-cards goals-cards">
          <GoalCard student={student} longReady={Boolean(state.longGoalReady)} />
          <WishCard student={student} />
        </div>
        <WeekCard hidden={hidden} onOpen={() => setSheet('month')} />
        <Block title="Aikajana">
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
